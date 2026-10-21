# Querschnitt fuer offene Scan-Netze (Loecher, fehlende Boeden, unsaubere Raender).
#
# Der exakte Netzschnitt (skizze._schnitt_netz) folgt den Dreieckskanten und reisst an jedem Loch ab -
# an einem echten Scan (Volker 21.10., 30 Loecher bis 170 mm Umfang) waren entlang einer Achse nur
# 26 von 40 Schnitten geschlossen. Hier stattdessen: Raster in der Schnittebene, je Punkt
#   innen/aussen  = Mehrheit mehrerer Strahlen (RaycastingScene.compute_occupancy, nsamples) – robust
#                   gegen Loecher, weil ein Loch nur wenige Strahlen verfaelscht
#   Abstand       = exakter Abstand zur Oberflaeche (compute_distance)
# -> vorzeichenbehaftetes Feld -> Marching Squares mit linearer Interpolation (Kontur liegt zwischen den
# Rasterpunkten genau auf der Flaeche, nicht auf Pixelkanten) -> immer geschlossene Schleifen.

import numpy as np

from .o3d import o3d
from . import skizze as sk


class Feld:
    def __init__(self, xyz, tri, strahlen=7):
        self.szene = o3d.t.geometry.RaycastingScene()
        self.szene.add_triangles(o3d.core.Tensor(np.ascontiguousarray(xyz, np.float32)),
                                 o3d.core.Tensor(np.ascontiguousarray(tri, np.uint32)))
        self.strahlen = int(strahlen)
        self.xyz = np.asarray(xyz, np.float64)
        self._tri = np.asarray(tri)
        # an grossen Oeffnungen (offener Boden) stimmen auch mehrere Strahlen falsch fuer „innen“ –
        # ausserhalb der Huellbox des Scans ist aber sicher aussen
        rand = 1e-3 * float(np.ptp(self.xyz, axis=0).max())
        self.box = (self.xyz.min(0) - rand, self.xyz.max(0) + rand)

    def werte(self, P):
        q = o3d.core.Tensor(np.ascontiguousarray(P, np.float32))
        d = self.szene.compute_distance(q).numpy()
        innen = self.szene.compute_occupancy(q, nsamples=self.strahlen).numpy() > 0.5
        P = np.asarray(P)
        innen &= ((P >= self.box[0]) & (P <= self.box[1])).all(1)
        return np.where(innen, -d, d)

    def schnitt(self, E, aufloesung=None):
        """-> (linien [(k,2)], geschlossen [bool], info) wie skizze.schnitt."""
        q = sk.zu2d(self.xyz[:: max(1, len(self.xyz) // 200000)], E)
        lo, hi = q.min(0), q.max(0)
        groesse = float((hi - lo).max())
        h = float(aufloesung or max(groesse / 360.0, 0.05))
        lo, hi = lo - 2 * h, hi + 2 * h
        us = np.arange(lo[0], hi[0] + h, h)
        vs = np.arange(lo[1], hi[1] + h, h)
        U, V = np.meshgrid(us, vs, indexing="ij")
        P = E["ursprung"] + U.reshape(-1, 1) * E["u"] + V.reshape(-1, 1) * E["v"]
        f = self.werte(P).reshape(U.shape)
        linien = _marching_squares(f, us, vs)
        # Splitter (Rauschen an Lochraendern, Inselchen) weg: unter 0,5 % der groessten Kontur bzw. 2 mm²
        if linien:
            fl = [abs(sk.flaeche(L)) for L in linien]
            grenze = max(2.0, 0.005 * max(fl))
            linien = [L for L, a in zip(linien, fl) if a >= grenze]
        return linien, [True] * len(linien), {"art": "raster", "aufloesung": round(h, 4), "punkte": int(f.size)}


    def schatten(self, E, aufloesung=None):
        """Umriss als Schattenwurf: dicht auf die Scan-Oberflaeche gesetzte Punkte in die Ebene projiziert,
        getroffene Rasterzellen = Schatten (kleine Abtastluecken per Schliessen gefuellt). Anders als der
        Innen/Aussen-Test bleibt eine durchgehende Bohrung offen, auch wenn ihre Wand kaum gescannt ist
        (Volkers Scan 21.10.: Ø-18-Bohrungen verschwanden im Umriss)."""
        if getattr(self, "_probe", None) is None:
            m = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(self.xyz),
                                          o3d.utility.Vector3iVector(np.asarray(self._tri, np.int32)))
            flaeche = m.get_surface_area()
            n = int(np.clip(flaeche * 60, 300000, 3000000))
            self._probe = np.asarray(m.sample_points_uniformly(n).points)
        q = sk.zu2d(self._probe, E)
        lo, hi = q.min(0), q.max(0)
        groesse = float((hi - lo).max())
        h = float(aufloesung or max(groesse / 260.0, 0.05))
        lo, hi = lo - 3 * h, hi + 3 * h
        us, vs = np.arange(lo[0], hi[0] + h, h), np.arange(lo[1], hi[1] + h, h)
        iu = np.clip(((q[:, 0] - lo[0]) / h).astype(int), 0, len(us) - 1)
        iv = np.clip(((q[:, 1] - lo[1]) / h).astype(int), 0, len(vs) - 1)
        maske = np.zeros((len(us), len(vs)), bool)
        maske[iu, iv] = True
        def dehnen(m):
            r = m.copy()
            r[1:] |= m[:-1]; r[:-1] |= m[1:]; r[:, 1:] |= m[:, :-1]; r[:, :-1] |= m[:, 1:]
            return r
        def schrumpfen(m):
            return ~dehnen(~m)
        maske = schrumpfen(dehnen(maske))                      # Schliessen: Abtastluecken zu
        # Zellmitten -> Kontur auf halber Hoehe zwischen den Zellen
        linien = _marching_squares(np.where(maske, -1.0, 1.0), us + h / 2, vs + h / 2)
        if linien:
            fl = [abs(sk.flaeche(L)) for L in linien]
            grenze = max(2.0, 0.005 * max(fl))
            linien = [L for L, a in zip(linien, fl) if a >= grenze]
        return linien, [True] * len(linien), {"art": "schatten", "aufloesung": round(h, 4)}

    def umriss(self, E, von, bis, schritt=None, aufloesung=None):
        """Umriss beim Blick entlang E["n"] zwischen den Tiefen von..bis: Minimum des Abstandsfelds ueber
        viele Tiefen = Vereinigung aller Schnitte -> geschlossene Konturen (wie schnitt)."""
        q = sk.zu2d(self.xyz[:: max(1, len(self.xyz) // 200000)], E)
        lo, hi = q.min(0), q.max(0)
        groesse = float((hi - lo).max())
        h = float(aufloesung or max(groesse / 260.0, 0.05))
        lo, hi = lo - 2 * h, hi + 2 * h
        us, vs = np.arange(lo[0], hi[0] + h, h), np.arange(lo[1], hi[1] + h, h)
        U, V = np.meshgrid(us, vs, indexing="ij")
        P0 = E["ursprung"] + U.reshape(-1, 1) * E["u"] + V.reshape(-1, 1) * E["v"]
        schritt = float(schritt or max((bis - von) / 80.0, h))
        f = np.full(len(P0), np.inf)
        for w in np.arange(von + schritt / 2, bis, schritt):
            f = np.minimum(f, self.werte(P0 + w * E["n"]))
        f = f.reshape(U.shape)
        linien = _marching_squares(f, us, vs)
        if linien:
            fl = [abs(sk.flaeche(L)) for L in linien]
            grenze = max(2.0, 0.005 * max(fl))
            linien = [L for L, a in zip(linien, fl) if a >= grenze]
        return linien, [True] * len(linien), {"art": "umriss", "aufloesung": round(h, 4)}


def _marching_squares(f, us, vs):
    """Nulllinie von f (nu x nv) als geschlossene Polylinien (Weltkoordinaten der Ebene)."""
    f = np.array(f, dtype=np.float64)
    f[0, :] = f[-1, :] = f[:, 0] = f[:, -1] = np.abs(f).max() + 1.0   # Rand = aussen -> Konturen schliessen
    nu, nv = f.shape
    innen = f < 0
    # Kantenpunkte: horizontale Kanten (i,j)-(i+1,j) und vertikale (i,j)-(i,j+1), linear interpoliert
    def punkt(art, i, j):
        if art == 0:
            a, b = f[i, j], f[i + 1, j]
            t = a / (a - b) if a != b else 0.5
            return (us[i] + t * (us[i + 1] - us[i]), vs[j])
        a, b = f[i, j], f[i, j + 1]
        t = a / (a - b) if a != b else 0.5
        return (us[i], vs[j] + t * (vs[j + 1] - vs[j]))
    c = (innen[:-1, :-1].astype(np.int8) | (innen[1:, :-1].astype(np.int8) << 1) |
         (innen[1:, 1:].astype(np.int8) << 2) | (innen[:-1, 1:].astype(np.int8) << 3))
    zellen = np.argwhere((c != 0) & (c != 15))
    # Kanten einer Zelle (i,j): unten (0,i,j), rechts (1,i+1,j), oben (0,i,j+1), links (1,i,j)
    nach = {}
    for i, j in zellen:
        k = int(c[i, j])
        unten, rechts, oben, links = (0, i, j), (1, i + 1, j), (0, i, j + 1), (1, i, j)
        if k in (5, 10):                                  # Sattel: nach Zellmitte entscheiden
            mitte_innen = (f[i, j] + f[i + 1, j] + f[i + 1, j + 1] + f[i, j + 1]) < 0
            # Mitte innen: die beiden Innenecken haengen zusammen, abgeschnitten werden die Aussenecken
            aussen_ecken = {5: [(unten, rechts), (oben, links)], 10: [(links, unten), (rechts, oben)]}
            innen_ecken = {5: [(unten, links), (oben, rechts)], 10: [(unten, rechts), (oben, links)]}
            paare = aussen_ecken[k] if mitte_innen else innen_ecken[k]
        else:
            seg = {1: (links, unten), 2: (unten, rechts), 3: (links, rechts), 4: (rechts, oben),
                   6: (unten, oben), 7: (links, oben), 8: (oben, links), 9: (oben, unten),
                   11: (oben, rechts), 12: (rechts, links), 13: (rechts, unten), 14: (unten, links)}[k]
            paare = [seg]
        for a, b in paare:
            nach.setdefault(a, []).append(b)
            nach.setdefault(b, []).append(a)
    linien, gesehen = [], set()
    for start in list(nach):
        if start in gesehen:
            continue
        weg, cur, vor = [start], start, None
        gesehen.add(start)
        while True:
            weiter = [x for x in nach[cur] if x != vor and x not in gesehen]
            if not weiter:
                break
            vor, cur = cur, weiter[0]
            gesehen.add(cur)
            weg.append(cur)
        if len(weg) >= 4:
            linien.append(np.array([punkt(*e) for e in weg], np.float64))
    return linien


def offen(scan):
    """Netz mit offenen Raendern (Scan mit Loechern)?"""
    if scan.tri is None or not len(scan.tri):
        return False
    t = np.sort(np.asarray(scan.tri, np.int64), axis=1)
    kanten = np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [0, 2]]])
    schl = kanten[:, 0] * (int(len(scan.xyz)) + 1) + kanten[:, 1]
    _, anz = np.unique(schl, return_counts=True)
    return bool((anz == 1).sum() > 0)
