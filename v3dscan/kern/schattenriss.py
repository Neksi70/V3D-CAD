"""Schattenriss (v1.6): Umriss eines Teils von oben (bzw. längs X/Y), mit Abstand nach außen –
für Einlagen, Schaumstoff-Ausschnitte und Fächer. Export SVG und DXF 1:1 in mm.
Raster + Marching Squares aus schnitt_robust (nur numpy)."""
import math

import numpy as np

from .schnitt_robust import _marching_squares

ACHSEN = {"z": (0, 1), "y": (0, 2), "x": (1, 2)}


def _dilatieren(b, k):
    """Binärraster um k Zellen wachsen lassen (abwechselnd 4er/8er-Nachbarn ≈ Kreis)."""
    for i in range(int(k)):
        n = b.copy()
        n[1:, :] |= b[:-1, :]; n[:-1, :] |= b[1:, :]; n[:, 1:] |= b[:, :-1]; n[:, :-1] |= b[:, 1:]
        if i % 2:
            n[1:, 1:] |= b[:-1, :-1]; n[:-1, :-1] |= b[1:, 1:]; n[1:, :-1] |= b[:-1, 1:]; n[:-1, 1:] |= b[1:, :-1]
        b = n
    return b


def _erodieren(b, k):
    return ~_dilatieren(~b, k)


def _glatt(f, k=1):
    for _ in range(k):
        g = f.copy()
        g[1:-1, 1:-1] = (f[:-2, 1:-1] + f[2:, 1:-1] + f[1:-1, :-2] + f[1:-1, 2:] + 4 * f[1:-1, 1:-1]) / 8
        f = g
    return f


def _vereinfachen(p, tol):
    """Douglas-Peucker für geschlossene Linien."""
    if len(p) < 4:
        return p
    def dp(a, b):
        if b <= a + 1:
            return [a]
        s, e = p[a], p[b]
        d = e - s
        L = math.hypot(*d) or 1e-12
        abst = np.abs((p[a + 1:b, 0] - s[0]) * d[1] - (p[a + 1:b, 1] - s[1]) * d[0]) / L
        i = int(np.argmax(abst))
        if abst[i] > tol:
            return dp(a, a + 1 + i) + dp(a + 1 + i, b)
        return [a]
    idx = dp(0, len(p) - 1) + [len(p) - 1]
    return p[idx]


def _flaechenpunkte(xyz, tri, abstand, grenze=3_000_000):
    """Punkte gleichmäßig auf den Dreiecken (grobe Netze haben auf großen Flächen kaum Eckpunkte)."""
    X = np.asarray(xyz, np.float64)
    a, b, c = X[tri[:, 0]], X[tri[:, 1]], X[tri[:, 2]]
    fl = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    n = np.ceil(fl / max(abstand, 1e-6) ** 2).astype(np.int64)
    if n.sum() > grenze:
        n = np.ceil(n * grenze / n.sum()).astype(np.int64)
    i = np.repeat(np.arange(len(tri)), n)
    r = np.random.default_rng(1).random((len(i), 2))
    spiegel = r.sum(1) > 1
    r[spiegel] = 1 - r[spiegel]
    return a[i] + (b[i] - a[i]) * r[:, :1] + (c[i] - a[i]) * r[:, 1:]


def schattenriss(xyz, achse="z", abstand=1.0, raster=None, tri=None):
    """-> {"konturen": [np.ndarray (n,2)], "achsen": "xy", "box": [u0,v0,u1,v1]} in mm"""
    if achse not in ACHSEN:
        raise ValueError("Achse muss x, y oder z sein.")
    iu, iv = ACHSEN[achse]
    X = np.asarray(xyz, np.float64)
    if tri is not None and len(tri):
        diag0 = float(np.linalg.norm(np.ptp(X, axis=0)))
        X = np.concatenate([X, _flaechenpunkte(X, np.asarray(tri), raster or diag0 / 1500)])
    P = X[:, [iu, iv]]
    lo, hi = P.min(0), P.max(0)
    diag = float(np.linalg.norm(hi - lo))
    if raster is None:
        stich = P[np.random.default_rng(0).choice(len(P), min(len(P), 4000), replace=False)]
        # grober Punktabstand in der Projektion
        raster = max(diag / 1500, float(np.median(np.abs(np.diff(np.sort(stich[:, 0]))))) * 3, diag / 4000)
    rand = abstand + 6 * raster
    us = np.arange(lo[0] - rand, hi[0] + rand + raster, raster)
    vs = np.arange(lo[1] - rand, hi[1] + rand + raster, raster)
    if len(us) * len(vs) > 9e6:
        raise ValueError("Raster zu fein für dieses Teil – Abstand größer wählen.")
    b = np.zeros((len(us), len(vs)), bool)
    i = np.clip(((P[:, 0] - us[0]) / raster).round().astype(int), 0, len(us) - 1)
    j = np.clip(((P[:, 1] - vs[0]) / raster).round().astype(int), 0, len(vs) - 1)
    b[i, j] = True
    b = _erodieren(_dilatieren(b, 2), 2)                    # Abtastlücken schließen
    k = int(round(abstand / raster))
    if k > 0:
        b = _dilatieren(b, k)
    f = _glatt(np.where(b, -1.0, 1.0), 2)
    konturen = [_vereinfachen(np.asarray(c, float), raster * 0.4) for c in _marching_squares(f, us, vs)]
    konturen = [c for c in konturen if len(c) >= 4 and abs(_flaeche(c)) > (raster * 3) ** 2]
    alle = np.concatenate(konturen) if konturen else np.zeros((0, 2))
    return {"konturen": konturen, "achsen": "xyz"[iu] + "xyz"[iv],
            "box": [round(float(x), 3) for x in (alle.min(0).tolist() + alle.max(0).tolist())] if len(alle) else None,
            "raster": raster}


def _flaeche(c):
    x, y = c[:, 0], c[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def svg(konturen):
    alle = np.concatenate(konturen)
    lo, hi = alle.min(0), alle.max(0)
    w, h = hi - lo
    pfade = []
    for c in konturen:
        pts = " ".join("%.3f,%.3f" % (x - lo[0], hi[1] - y) for x, y in c)
        pfade.append('<polygon points="%s"/>' % pts)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="%.3fmm" height="%.3fmm" '
            'viewBox="0 0 %.3f %.3f"><g fill="none" stroke="#000" stroke-width="0.2">%s</g></svg>\n') % (w, h, w, h, "".join(pfade))


def dxf(konturen):
    z = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"]
    for c in konturen:
        z += ["0", "LWPOLYLINE", "8", "UMRISS", "90", str(len(c)), "70", "1"]
        for x, y in c:
            z += ["10", "%.4f" % x, "20", "%.4f" % y]
    z += ["0", "ENDSEC", "0", "EOF"]
    return "\r\n".join(z) + "\r\n"
