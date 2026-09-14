# Scan am Koordinatensystem ausrichten.
#
# Ergebnis ist immer eine 4x4-Matrix, die auf ALLE Scans des Projekts
# angewendet wird (das Koordinatensystem ist global, die Scans bleiben
# zueinander ausgerichtet).
#
#   automatisch: Hauptachsen (PCA) oder "auf groesste Ebene stellen"
#   3-2-1:       primaeres Element -> Achse 1 (z. B. Ebene -> Z),
#                sekundaeres Element -> Achse 2 (z. B. Zylinderachse -> X),
#                Ursprung -> Punkt / Kugelmitte / Schnittpunkt

import numpy as np

from . import formen

ACHSEN = {"x": 0, "y": 1, "z": 2}


def _einheit(v):
    v = np.asarray(v, np.float64)
    n = np.linalg.norm(v)
    if n < 1e-12:
        raise ValueError("Richtung hat die Länge 0.")
    return v / n


def richtung(element):
    art = element["art"]
    if art == "ebene":
        return _einheit(element["normale"])
    if art in ("zylinder", "achse"):
        return _einheit(element["achse"])
    if art == "linie":
        return _einheit(np.subtract(element["bis"], element["von"]))
    raise ValueError("Element „%s“ hat keine Richtung." % art)


def _basis_matrix(e1, e2, ziel1, ziel2):
    i, j = ACHSEN[ziel1], ACHSEN[ziel2]
    if i == j:
        raise ValueError("Primär- und Sekundärachse müssen verschieden sein.")
    e2 = e2 - (e2 @ e1) * e1
    if np.linalg.norm(e2) < 1e-6:
        raise ValueError("Primär- und Sekundärrichtung sind parallel.")
    e2 = _einheit(e2)
    k = 3 - i - j
    vorzeichen = 1.0 if (j - i) % 3 == 1 else -1.0
    S = np.zeros((3, 3))
    S[:, i] = e1
    S[:, j] = e2
    S[:, k] = vorzeichen * np.cross(e1, e2)
    return S.T                     # R: Quellrichtungen -> Zielachsen


def _schnitt_ebene_linie(ebene, punkt, achse):
    n = _einheit(ebene["normale"])
    nenner = n @ achse
    if abs(nenner) < 1e-9:
        return None
    t = (n @ (np.asarray(ebene["punkt"]) - punkt)) / nenner
    return punkt + t * achse


def ursprung_von(ursprung, prim, sek, schwerpunkt):
    art = (ursprung or {}).get("art", "schwerpunkt")
    if art == "punkt":
        return np.asarray(ursprung["punkt"], np.float64)
    if art == "kugel":
        return np.asarray(ursprung["mitte"], np.float64)
    if art == "zylinder":
        return np.asarray(ursprung["punkt"], np.float64)
    if art == "schnitt":
        for eb, ax in ((prim, sek), (sek, prim)):
            if eb and ax and eb["art"] == "ebene" and ax["art"] in ("zylinder", "achse", "linie"):
                p = np.asarray(ax.get("punkt", ax.get("von")), np.float64)
                s = _schnitt_ebene_linie(eb, p, richtung(ax))
                if s is not None:
                    return s
        raise ValueError("Die Elemente schneiden sich nicht (Ebene + Achse nötig).")
    # Schwerpunkt, bei primaerer Ebene auf die Ebene gelotet
    o = np.asarray(schwerpunkt, np.float64)
    if prim and prim["art"] == "ebene":
        n = _einheit(prim["normale"])
        o = o - ((o - prim["punkt"]) @ n) * n
    return o


def aus_elementen(prim, sek, ursprung, schwerpunkt, ziel1="z", ziel2="x"):
    e1 = richtung(prim)
    e2 = richtung(sek)
    R = _basis_matrix(e1, e2, ziel1, ziel2)
    o = ursprung_von(ursprung, prim, sek, schwerpunkt)
    T = np.eye(4)
    T[:3, :3] = R
    T[:3, 3] = -R @ o
    return T


def _stichprobe(xyz, n=200000):
    if len(xyz) <= n:
        return xyz.astype(np.float64)
    return xyz[np.random.default_rng(5).choice(len(xyz), n, replace=False)].astype(np.float64)


def _ursprung_setzen(T, xyz, art, oben):
    if art == "behalten":
        return T
    p = xyz @ T[:3, :3].T + T[:3, 3]
    lo, hi = p.min(0), p.max(0)
    o = (lo + hi) / 2
    if art == "unten":
        o[ACHSEN[oben]] = lo[ACHSEN[oben]]
    T = T.copy()
    T[:3, 3] -= o
    return T


def hauptachsen(xyz, ursprung="mitte", oben="z"):
    """Groesste Ausdehnung -> X, zweitgroesste -> Y, kleinste -> Z. Vorzeichen
    nach der Schiefe der Verteilung, damit das Ergebnis eindeutig ist."""
    p = _stichprobe(xyz)
    m = p.mean(0)
    _, _, vt = np.linalg.svd(p - m, full_matrices=False)
    R = vt.copy()
    for k in range(3):
        if np.mean(((p - m) @ R[k]) ** 3) < 0:
            R[k] = -R[k]
    if np.linalg.det(R) < 0:
        R[2] = -R[2]
    T = np.eye(4)
    T[:3, :3] = R
    T[:3, 3] = -R @ m
    return _ursprung_setzen(T, xyz, ursprung, oben)


def auf_ebene(xyz, ebene, ursprung="unten", oben="z"):
    """Ebene wird Boden: Normale (zum Objekt hin) -> oben-Achse, laengste
    Ausdehnung in der Ebene -> X."""
    p = _stichprobe(xyz)
    n = _einheit(ebene["normale"])
    # Seite des Objekts per Mehrheit - Punkte AUF der Ebene zaehlen nicht
    # (deren Rundungsfehler kippen sonst alle auf eine Seite).
    d = (p - ebene["punkt"]) @ n
    grenze = max(3 * ebene.get("rms", 0.0), 1e-6 * float(np.ptp(p, axis=0).max()))
    if np.sum(d > grenze) < np.sum(d < -grenze):
        n = -n
    flach = (p - p.mean(0)) - np.outer((p - p.mean(0)) @ n, n)
    _, _, vt = np.linalg.svd(flach, full_matrices=False)
    zweite = "x"
    R = _basis_matrix(n, vt[0], oben, zweite)
    T = np.eye(4)
    T[:3, :3] = R
    T[:3, 3] = -R @ np.asarray(ebene["punkt"], np.float64)
    if ursprung == "behalten":
        return T
    # Ursprung: Mitte der Grundflaeche, Hoehe genau auf der Ebene
    q = xyz.astype(np.float64) @ R.T + T[:3, 3]
    lo, hi = q.min(0), q.max(0)
    o = (lo + hi) / 2
    o[ACHSEN[oben]] = 0.0 if ursprung == "unten" else o[ACHSEN[oben]]
    T[:3, 3] -= o
    return T


def aus_werten(verschieben=(0, 0, 0), drehen_grad=(0, 0, 0)):
    """Drehung um X, dann Y, dann Z (feste Weltachsen), danach Verschiebung."""
    ax, ay, az = np.radians(np.asarray(drehen_grad, np.float64))
    cx, sx, cy, sy, cz, sz = np.cos(ax), np.sin(ax), np.cos(ay), np.sin(ay), np.cos(az), np.sin(az)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    T = np.eye(4)
    T[:3, :3] = Rz @ Ry @ Rx
    T[:3, 3] = verschieben
    return T


def form_aus_punkten(art, pts, nrm=None):
    if art == "ebene":
        return formen.ebene(pts)
    if art == "kugel":
        return formen.kugel(pts)
    if art == "zylinder":
        return formen.zylinder(pts, nrm)
    raise ValueError("Unbekannte Form %s" % art)
