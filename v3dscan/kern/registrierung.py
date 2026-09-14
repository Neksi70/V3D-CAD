# Scans zueinander ausrichten.
#
# Ablauf wie bei den grossen Programmen, nur mit sichtbaren Stellschrauben:
#   grob  = Merkmale (FPFH) + RANSAC  oder  >= 3 Punktpaare (Kabsch)
#   fein  = ICP (Punkt-zu-Ebene), Restfehler in mm wird ausgegeben
#   global= Posen-Graph ueber alle Scans (Open3D Multiway Registration)
# Alle Funktionen liefern eine 4x4-Matrix, die den BEWEGTEN Scan auf den
# festen legt. Angewendet wird erst im Projekt.

import numpy as np

from .o3d import o3d, reg


def _vorbereiten(scan, voxel):
    p = scan.zu_o3d(normalen=False).voxel_down_sample(float(voxel))
    p.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(
        radius=voxel * 2.5, max_nn=30))
    merkmale = reg.compute_fpfh_feature(
        p, o3d.geometry.KDTreeSearchParamHybrid(radius=voxel * 5, max_nn=100))
    return p, merkmale


def _mit_normalen(scan, voxel):
    p = scan.zu_o3d(normalen=False)
    if voxel > 0:
        p = p.voxel_down_sample(float(voxel))
    p.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(
        radius=max(voxel, 0.2) * 3, max_nn=30))
    return p


def ergebnis(T, fitness, rmse, **mehr):
    d = {"matrix": np.asarray(T, np.float64).reshape(4, 4).tolist(),
         "ueberlappung": round(float(fitness) * 100, 1),
         "rmse": round(float(rmse), 4)}
    d.update(mehr)
    return d


def grob_automatisch(bewegt, fest, voxel, versuche=3):
    """Merkmalsbasiert. Mehrere RANSAC-Laeufe, der mit der besten Ueberlappung
    gewinnt - ein einzelner Lauf verfehlt bei symmetrischen Teilen oefter."""
    q, qf = _vorbereiten(bewegt, voxel)
    z, zf = _vorbereiten(fest, voxel)
    bestes = None
    for i in range(int(versuche)):
        o3d.utility.random.seed(1000 + i)
        r = reg.registration_ransac_based_on_feature_matching(
            q, z, qf, zf, True, voxel * 1.5,
            reg.TransformationEstimationPointToPoint(False), 3,
            [reg.CorrespondenceCheckerBasedOnEdgeLength(0.9),
             reg.CorrespondenceCheckerBasedOnDistance(voxel * 1.5)],
            reg.RANSACConvergenceCriteria(100000, 0.999))
        if bestes is None or r.fitness > bestes.fitness:
            bestes = r
    return ergebnis(bestes.transformation, bestes.fitness, bestes.inlier_rmse)


def _icp_stufen(q_scan, z_scan, max_abstand, voxel, start, methode="ebene",
                iterationen=60):
    """ICP in drei Stufen von grob nach fein (Fangabstand und Aufloesung
    schrumpfen), mit robustem Tukey-Kern gegen Punkte ohne Gegenstueck.
    Einstufig blieben auf den Testdaten 0,24 deg Restfehler, so 0,002 deg."""
    T = np.eye(4) if start is None else np.asarray(start, np.float64)
    stufen = [(max_abstand, voxel), (max_abstand * 0.375, voxel / 2),
              (max_abstand * 0.15, voxel / 4)]
    r = None
    for abst, vox in stufen:
        q = _mit_normalen(q_scan, vox)
        z = _mit_normalen(z_scan, vox)
        kern = reg.TukeyLoss(k=abst / 2)
        schaetzer = reg.TransformationEstimationPointToPlane(kern) \
            if methode == "ebene" else reg.TransformationEstimationPointToPoint(False)
        r = reg.registration_icp(
            q, z, float(abst), T, schaetzer,
            reg.ICPConvergenceCriteria(1e-7, 1e-7, int(iterationen)))
        T = r.transformation
    return r


def fein_icp(bewegt, fest, max_abstand, iterationen=60, methode="ebene",
             start=None, voxel=1.0):
    r = _icp_stufen(bewegt, fest, float(max_abstand), float(voxel), start,
                    methode, iterationen)
    return ergebnis(r.transformation, r.fitness, r.inlier_rmse)


def aus_punktpaaren(punkte_bewegt, punkte_fest):
    """Starre Transformation (Kabsch/Umeyama ohne Skalierung) aus Punktpaaren.
    Liefert zusaetzlich den Restfehler je Paar in mm."""
    a = np.asarray(punkte_bewegt, np.float64).reshape(-1, 3)
    b = np.asarray(punkte_fest, np.float64).reshape(-1, 3)
    if len(a) < 3 or len(a) != len(b):
        raise ValueError("Es braucht mindestens 3 Punktpaare.")
    ma, mb = a.mean(0), b.mean(0)
    H = (a - ma).T @ (b - mb)
    U, S, Vt = np.linalg.svd(H)
    D = np.diag([1, 1, np.sign(np.linalg.det(Vt.T @ U.T))])
    R = Vt.T @ D @ U.T
    if S[1] < 1e-9 * max(S[0], 1e-12):
        raise ValueError("Die Punkte liegen auf einer Linie - bitte weiter verteilen.")
    T = np.eye(4)
    T[:3, :3] = R
    T[:3, 3] = mb - R @ ma
    rest = np.linalg.norm(a @ R.T + T[:3, 3] - b, axis=1)
    return {"matrix": T.tolist(), "rest_je_paar": [round(float(x), 3) for x in rest],
            "rmse": round(float(np.sqrt(np.mean(rest ** 2))), 4)}


def abweichung(bewegt, fest, T=None):
    """Abstand jedes Punkts des bewegten Scans zum festen Scan (mm)."""
    q = bewegt.zu_o3d(normalen=False)
    if T is not None:
        q.transform(np.asarray(T, np.float64))
    d = np.asarray(q.compute_point_cloud_distance(fest.zu_o3d(normalen=False)))
    return d.astype(np.float32)


def global_ausrichten(scans, voxel, max_abstand, min_ueberlappung=0.1):
    """Alle Scans gemeinsam - sie muessen schon grob ausgerichtet sein, es
    wird nur fein nachgezogen und der Fehler ueber alle verteilt. Der erste
    feste Scan (sonst der erste) bleibt liegen. Paare ohne ausreichende
    Ueberlappung fallen weg, Querverbindungen gelten als unsicher und werden
    vom Optimierer abgeschwaecht. Liefert Matrizen je Scan-Id."""
    n = len(scans)
    if n < 2:
        raise ValueError("Es braucht mindestens 2 sichtbare Scans.")
    anker = next((i for i, s in enumerate(scans) if s.fest), 0)
    wolken = [_mit_normalen(s, voxel / 4) for s in scans]
    graph = reg.PoseGraph()
    paare = []
    for i in range(n):
        for j in range(i + 1, n):
            r = _icp_stufen(scans[j], scans[i], float(max_abstand), float(voxel),
                            None)
            if r.fitness < min_ueberlappung and j != i + 1:
                continue
            info = reg.get_information_matrix_from_point_clouds(
                wolken[j], wolken[i], float(max_abstand) * 0.15, r.transformation)
            unsicher = j != i + 1
            graph.edges.append(reg.PoseGraphEdge(j, i, r.transformation, info,
                                                 uncertain=unsicher))
            paare.append({"von": scans[j].id, "zu": scans[i].id,
                          "ueberlappung": round(r.fitness * 100, 1),
                          "rmse": round(r.inlier_rmse, 4)})
    # Startposen entlang der Kette (Nachbar j=i+1)
    kette = [np.eye(4)]
    for i in range(n - 1):
        kante = next(e for e in graph.edges
                     if e.source_node_id == i + 1 and e.target_node_id == i)
        kette.append(kette[i] @ kante.transformation)
    for i in range(n):
        graph.nodes.append(reg.PoseGraphNode(kette[i]))
    reg.global_optimization(
        graph, reg.GlobalOptimizationLevenbergMarquardt(),
        reg.GlobalOptimizationConvergenceCriteria(),
        reg.GlobalOptimizationOption(max_correspondence_distance=float(max_abstand) * 0.15,
                                     edge_prune_threshold=0.25,
                                     reference_node=anker))
    ref = np.linalg.inv(np.asarray(graph.nodes[anker].pose))
    matrizen = {scans[i].id: (ref @ np.asarray(graph.nodes[i].pose)).tolist()
                for i in range(n)}
    return {"matrizen": matrizen, "paare": paare}
