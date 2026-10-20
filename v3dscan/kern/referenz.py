# Referenzgeometrie (QuickSurface "Construct": Symmetry Plane, Plane, Reference Line; Design X
# "Ref. Plane/Vector"). Ebenen: {"art": "ebene", "punkt", "normale"}; Achsen: {"art": "achse", "punkt", "richtung"}.

import numpy as np


def _einheit(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-12)


def symmetrieebene(xyz, stichprobe=60000, iterationen=60):
    """Beste Spiegelebene eines Scans. Je Hauptachse: an der Ebene durch den Schwerpunkt spiegeln,
    gespiegelte Wolke per ICP auf das Original ziehen; M = T·S ist dann die eigentliche Spiegelung,
    deren Normale der Eigenvektor zum Eigenwert -1 ist. -> (ebene, rms, kandidaten)"""
    from .o3d import o3d, reg
    P = np.asarray(xyz, np.float64)
    if len(P) > stichprobe:
        P = P[np.random.default_rng(0).choice(len(P), stichprobe, replace=False)]
    c = P.mean(0)
    _, _, vt = np.linalg.svd(P - c, full_matrices=False)
    diag = float(np.linalg.norm(P.max(0) - P.min(0)))
    ziel = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(P))
    kandidaten = []
    for n0 in vt:
        S = np.eye(4)
        S[:3, :3] = np.eye(3) - 2 * np.outer(n0, n0)
        S[:3, 3] = 2 * (n0 @ c) * n0
        quelle = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(P @ S[:3, :3].T + S[:3, 3]))
        T = np.eye(4)
        for fang in (0.05 * diag, 0.015 * diag, 0.005 * diag):
            e = reg.registration_icp(quelle, ziel, fang, T, reg.TransformationEstimationPointToPoint(),
                                     reg.ICPConvergenceCriteria(max_iteration=iterationen))
            T = e.transformation
        M = T @ S
        w, v = np.linalg.eig(M[:3, :3])
        k = int(np.argmin(np.abs(w + 1)))
        n = _einheit(np.real(v[:, k]))
        d = float(n @ M[:3, 3]) / 2
        punkt = d * n
        # Punkt auf der Ebene nahe am Schwerpunkt
        punkt = c - ((c - punkt) @ n) * n
        gesp = P - 2 * ((P - punkt) @ n)[:, None] * n
        dist = np.asarray(o3d.geometry.PointCloud(o3d.utility.Vector3dVector(gesp)).compute_point_cloud_distance(ziel))
        kandidaten.append({"punkt": punkt, "normale": n, "rms": float(np.sqrt(np.mean(dist ** 2))),
                           "deckung": float(np.mean(dist < 0.01 * diag))})
    kandidaten.sort(key=lambda k: k["rms"])
    b = kandidaten[0]
    return {"art": "ebene", "punkt": b["punkt"], "normale": b["normale"]}, b["rms"], kandidaten


def ebene_aus_element(el, versatz=0.0):
    n = _einheit(el["normale"])
    return {"art": "ebene", "punkt": np.asarray(el["punkt"], float) + n * versatz, "normale": n}


def mittelebene(el1, el2):
    """Mitte zwischen zwei (fast) parallelen Ebenen (QuickSurface "Middle plane")."""
    n1, n2 = _einheit(el1["normale"]), _einheit(el2["normale"])
    if n1 @ n2 < 0:
        n2 = -n2
    if n1 @ n2 < np.cos(np.radians(10)):
        raise ValueError("Die beiden Ebenen sind nicht annähernd parallel.")
    n = _einheit(n1 + n2)
    p = 0.5 * (np.asarray(el1["punkt"], float) + np.asarray(el2["punkt"], float))
    return {"art": "ebene", "punkt": p, "normale": n}


def achse_aus_element(el):
    if "achse" not in el:
        raise ValueError("Der Bereich hat keine Achse (Zylinder, Bohrung, Kegel …).")
    return {"art": "achse", "punkt": np.asarray(el["punkt"], float), "richtung": _einheit(el["achse"])}


def json_form(r):
    return {k: ([round(float(x), 6) for x in v] if isinstance(v, (np.ndarray, list, tuple)) else v)
            for k, v in r.items()}
