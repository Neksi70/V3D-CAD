# Bereinigungs-Werkzeuge.
#
# Jedes Werkzeug rechnet nur und aendert den Scan NICHT: es liefert eine Maske
# der Punkte, die wegfallen wuerden (fuer die rote Vorschau). Erst "Anwenden"
# im Projekt loescht wirklich - so bleibt Vorschau -> Anwenden -> Zuruecksetzen
# fuer jedes Werkzeug gleich.

import numpy as np

from .o3d import o3d


def punktabstand(scan, stichprobe=4000):
    """Mittlerer Abstand zum naechsten Nachbarn (mm), aus einer Stichprobe."""
    n = len(scan)
    if n < 2:
        return 0.0
    baum = o3d.geometry.KDTreeFlann(scan.zu_o3d(normalen=False))
    rng = np.random.default_rng(1)
    idx = rng.choice(n, size=min(n, stichprobe), replace=False)
    werte = []
    for i in idx:
        k, _, d2 = baum.search_knn_vector_3d(scan.xyz[i].astype(np.float64), 2)
        if k == 2:
            werte.append(np.sqrt(d2[1]))
    return float(np.median(werte)) if werte else 0.0


# --- Zusammenhaengende Bereiche ---------------------------------------------
_NACHBARN = np.array([(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                      for dz in (-1, 0, 1) if (dx, dy, dz) > (0, 0, 0)],
                     dtype=np.int64)


def komponenten(xyz, abstand):
    """Beschriftet jeden Punkt mit der Nummer seines zusammenhaengenden
    Bereichs. Zwei Punkte haengen zusammen, wenn ihre Voxel (Kantenlaenge
    `abstand`) sich beruehren. Liefert (labels je Punkt, Groesse je Label)."""
    if len(xyz) == 0:
        return np.zeros(0, np.int64), np.zeros(0, np.int64)
    g = np.floor((xyz - xyz.min(0)) / max(abstand, 1e-6)).astype(np.int64) + 1
    b = int(g.max()) + 2
    schluessel = (g[:, 0] * b + g[:, 1]) * b + g[:, 2]
    voxel, inv = np.unique(schluessel, return_inverse=True)
    m = len(voxel)
    vk = np.stack([voxel // (b * b), (voxel // b) % b, voxel % b], axis=1)

    kanten_a, kanten_b = [], []
    for off in _NACHBARN:
        nk = ((vk[:, 0] + off[0]) * b + vk[:, 1] + off[1]) * b + vk[:, 2] + off[2]
        pos = np.searchsorted(voxel, nk)
        pos[pos >= m] = m - 1
        treffer = voxel[pos] == nk
        kanten_a.append(np.nonzero(treffer)[0])
        kanten_b.append(pos[treffer])
    a = np.concatenate(kanten_a)
    c = np.concatenate(kanten_b)

    # Label-Weitergabe mit Zeigersprung: jedes Voxel uebernimmt das kleinste
    # Label seiner Nachbarn, bis sich nichts mehr aendert.
    lab = np.arange(m, dtype=np.int64)
    while True:
        alt = lab.copy()
        kl = np.minimum(lab[a], lab[c])
        np.minimum.at(lab, a, kl)
        np.minimum.at(lab, c, kl)
        while True:
            neu = lab[lab]
            if np.array_equal(neu, lab):
                break
            lab = neu
        if np.array_equal(alt, lab):
            break
    _, lab = np.unique(lab, return_inverse=True)
    punkt_lab = lab[inv]
    groessen = np.bincount(punkt_lab)
    return punkt_lab, groessen


def verbunden(scan, index, abstand):
    """Maske aller Punkte, die mit Punkt `index` zusammenhaengen."""
    lab, _ = komponenten(scan.xyz, abstand)
    return lab == lab[index]


def kleine_inseln(scan, abstand, max_anteil_prozent):
    """Maske der Punkte in abgetrennten Bereichen, die weniger als
    max_anteil_prozent aller Punkte enthalten (wie Revo "Isolation")."""
    lab, groessen = komponenten(scan.xyz, abstand)
    grenze = len(scan) * max_anteil_prozent / 100.0
    klein = groessen < grenze
    klein[np.argmax(groessen)] = False       # der groesste Bereich bleibt immer
    return klein[lab]


# --- Ausreisser ---------------------------------------------------------------
def ausreisser_statistisch(scan, nachbarn=20, sigma=2.0):
    _, behalten = scan.zu_o3d(normalen=False).remove_statistical_outlier(
        int(nachbarn), float(sigma))
    weg = np.ones(len(scan), bool)
    weg[np.asarray(behalten, dtype=np.int64)] = False
    return weg


def ausreisser_radius(scan, radius, min_punkte):
    _, behalten = scan.zu_o3d(normalen=False).remove_radius_outlier(
        int(min_punkte), float(radius))
    weg = np.ones(len(scan), bool)
    weg[np.asarray(behalten, dtype=np.int64)] = False
    return weg


# --- Ebenen ---------------------------------------------------------------
def ebene_aus_punkten(p1, p2, p3):
    p1, p2, p3 = (np.asarray(p, np.float64) for p in (p1, p2, p3))
    n = np.cross(p2 - p1, p3 - p1)
    laenge = np.linalg.norm(n)
    if laenge < 1e-9:
        raise ValueError("Die drei Punkte liegen auf einer Linie.")
    n /= laenge
    return n, float(-n @ p1)


def seite_der_ebene(xyz, normale, d, versatz=0.0):
    """Maske der Punkte auf der Seite, in die die Normale zeigt."""
    return (xyz.astype(np.float64) @ np.asarray(normale, np.float64) + d) > versatz


def tisch_finden(scan, toleranz, versuch=0, iterationen=1500):
    """Groesste Ebene per RANSAC. versuch=1,2,... liefert die naechstkleinere
    Ebene (die vorherigen werden ausgeblendet). Liefert (normale, d, inlier-Maske),
    Normale zeigt zum Objekt (zur Mehrheit der uebrigen Punkte)."""
    xyz = scan.xyz
    rest = np.ones(len(xyz), bool)
    ergebnis = None
    for _ in range(int(versuch) + 1):
        idx = np.nonzero(rest)[0]
        if len(idx) < 50:
            raise ValueError("Keine weitere Ebene gefunden.")
        # Fuer RANSAC reicht eine Stichprobe; bewertet wird auf allen Punkten.
        wahl = idx if len(idx) <= 300000 else \
            np.random.default_rng(7).choice(idx, 300000, replace=False)
        p = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(
            xyz[wahl].astype(np.float64)))
        modell, _ = p.segment_plane(float(toleranz), 3, int(iterationen))
        n = np.asarray(modell[:3], np.float64)
        d = float(modell[3]) / np.linalg.norm(n)
        n /= np.linalg.norm(n)
        abst = xyz.astype(np.float64) @ n + d
        auf = np.abs(abst) <= toleranz
        ergebnis = (n, d, auf & rest, abst)
        rest &= ~auf
    n, d, auf, abst = ergebnis
    uebrig = abst[~auf]
    if len(uebrig) and np.sum(uebrig > 0) < np.sum(uebrig < 0):
        n, d = -n, -d
    return n, d, auf


def tisch_maske(scan, toleranz, versuch=0, auch_darunter=True):
    n, d, auf = tisch_finden(scan, toleranz, versuch)
    weg = auf.copy()
    if auch_darunter:
        weg |= seite_der_ebene(scan.xyz, -n, -d, 0.0)
    return weg, n, d


# --- Ausduennen / Normalen ------------------------------------------------
def ausduennen(scan, voxel):
    """Neuer Scan mit hoechstens einem Punkt je Voxel (Mittelwert)."""
    from .wolke import Scan
    p = scan.zu_o3d(farbe=True).voxel_down_sample(float(voxel))
    neu = Scan.aus_o3d(scan.name, p)
    if neu.nrm is not None:
        laenge = np.linalg.norm(neu.nrm, axis=1, keepdims=True)
        neu.nrm /= np.maximum(laenge, 1e-9)
    return neu


def normalen_berechnen(scan, radius, nachbarn=30, ausrichtung="aussen"):
    p = scan.zu_o3d(normalen=False)
    p.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(
        radius=float(radius), max_nn=int(nachbarn)))
    nrm = np.asarray(p.normals)
    if ausrichtung == "konsistent" and len(scan) <= 400000:
        p.orient_normals_consistent_tangent_plane(12)
        nrm = np.asarray(p.normals)
        # Gesamtrichtung nach aussen drehen
        mitte = scan.xyz.mean(0)
        if np.sum(np.einsum("ij,ij->i", nrm, scan.xyz - mitte)) < 0:
            nrm = -nrm
    else:
        mitte = scan.xyz.mean(0)
        zeigt = np.einsum("ij,ij->i", nrm, scan.xyz - mitte)
        nrm = np.where((zeigt < 0)[:, None], -nrm, nrm)
        if ausrichtung == "innen":
            nrm = -nrm
    return nrm.astype(np.float32)
