"""Prüfen (v1.6): Wandstärke eines Netzes und Volumenfehler-Regionen einer Abweichungskarte.
Nur numpy + Open3D (die EXE bringt kein scipy mit)."""
import math

import numpy as np

from .o3d import o3d


def _szene(xyz, tri):
    s = o3d.t.geometry.RaycastingScene()
    s.add_triangles(o3d.core.Tensor(np.ascontiguousarray(xyz, np.float32)),
                    o3d.core.Tensor(np.ascontiguousarray(tri, np.uint32)))
    return s


def _normalen(xyz, tri):
    """Eckpunkt-Normalen, nach außen gedreht (geschlossene Netze: Volumen > 0)."""
    m = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(xyz.astype(np.float64)),
                                  o3d.utility.Vector3iVector(tri.astype(np.int32)))
    m.compute_vertex_normals()
    n = np.asarray(m.vertex_normals)
    P = xyz.astype(np.float64)
    a, b, c = P[tri[:, 0]], P[tri[:, 1]], P[tri[:, 2]]
    vol = float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6)
    return -n if vol < 0 else n


def _kegel(d, grad, anzahl):
    """anzahl Richtungen auf einem Kegelmantel (halber Öffnungswinkel grad) um d, plus d selbst."""
    hilf = np.where(np.abs(d[:, :1]) < 0.9, np.array([[1.0, 0, 0]]), np.array([[0, 1.0, 0]]))
    u = np.cross(d, hilf)
    u /= np.linalg.norm(u, axis=1, keepdims=True)
    v = np.cross(d, u)
    s, c = math.sin(math.radians(grad)), math.cos(math.radians(grad))
    aus = [d]
    for k in range(anzahl):
        w = 2 * math.pi * k / anzahl
        aus.append(c * d + s * (math.cos(w) * u + math.sin(w) * v))
    return aus


def wandstaerke(xyz, tri, methode="strahl", max_dicke=10.0, strahlen=1, rueckseite=True, max_winkel=30.0):
    """Dicke an jedem Eckpunkt (mm, float32, NaN = kein Gegenüber bis max_dicke).
    strahl: von der Oberfläche entgegen der Normale bis zur Gegenfläche; mit Kegel (6/12 Strahlen)
    gilt der kürzeste. rueckseite: die Gegenfläche muss zurückzeigen (Normale höchstens max_winkel
    vom Strahl weg) – sonst trifft man bei Löchern im Scan eine falsche Fläche.
    kugel: größte Innenkugel, die den Punkt berührt (Shrinking-Ball), Dicke = Durchmesser."""
    if tri is None or not len(tri):
        raise ValueError("Wandstärke braucht ein Netz – erst unter NETZ eines erzeugen.")
    xyz = np.asarray(xyz, np.float64)
    n = _normalen(xyz, tri)
    szene = _szene(xyz, tri)
    diag = float(np.linalg.norm(np.ptp(xyz, axis=0)))
    eps = max(1e-4, diag * 1e-6)
    innen = -n
    if methode == "kugel":
        return _kugel(szene, xyz, innen, max_dicke, eps)
    ergebnis = np.full(len(xyz), np.inf)
    cos_max = math.cos(math.radians(max_winkel))
    richtungen = _kegel(innen, 15.0, 0 if strahlen <= 1 else (6 if strahlen <= 6 else 12))
    for d in richtungen:
        o = xyz + innen * eps
        rays = o3d.core.Tensor(np.hstack([o, d]).astype(np.float32))
        h = szene.cast_rays(rays)
        t = h["t_hit"].numpy().astype(np.float64)
        ok = np.isfinite(t) & (t <= max_dicke) & (t > max(eps * 20, 0.01))   # Selbsttreffer am Nachbardreieck verwerfen
        if rueckseite:
            nh = h["primitive_normals"].numpy().astype(np.float64)
            ok &= np.einsum("ij,ij->i", nh, d) >= cos_max   # Austritt: Flächennormale zeigt mit dem Strahl
        t = np.where(ok, t * np.einsum("ij,ij->i", d, innen), np.inf)   # schräger Strahl → senkrechte Dicke
        ergebnis = np.minimum(ergebnis, t)
    ergebnis[~np.isfinite(ergebnis)] = np.nan
    return ergebnis.astype(np.float32)


def _kugel(szene, P, innen, max_dicke, eps, schritte=14):
    r = np.full(len(P), max_dicke / 2)
    fertig = np.zeros(len(P), bool)
    for _ in range(schritte):
        c = P + innen * r[:, None]
        q = szene.compute_closest_points(o3d.core.Tensor(c.astype(np.float32)))["points"].numpy().astype(np.float64)
        abst = np.linalg.norm(c - q, axis=1)
        weiter = (~fertig) & (abst < r - eps * 10)
        if not weiter.any():
            break
        v = q - P
        nenner = 2 * np.einsum("ij,ij->i", v, innen)
        r_neu = np.where(nenner > 1e-9, np.einsum("ij,ij->i", v, v) / np.maximum(nenner, 1e-9), r)
        r = np.where(weiter, np.clip(r_neu, 0, r), r)
        fertig |= ~weiter
    d = 2 * r
    d[d >= max_dicke * 0.999] = np.nan
    return d.astype(np.float32)


def kennwerte(werte, bins=20):
    w = werte[np.isfinite(werte)]
    if not len(w):
        return {"anzahl": 0, "ohne": int(len(werte))}
    h, kanten = np.histogram(w, bins=bins)
    return {"anzahl": int(len(w)), "ohne": int(len(werte) - len(w)),
            "min": round(float(w.min()), 4), "p5": round(float(np.percentile(w, 5)), 4),
            "median": round(float(np.median(w)), 4), "max": round(float(w.max()), 4),
            "histogramm": [int(x) for x in h], "kanten": [round(float(x), 4) for x in kanten]}


def volumenfehler(xyz, werte, toleranz, abstand, min_punkte=12, max_anzahl=15):
    """Zusammenhängende Gebiete außerhalb ±toleranz (Mehr- bzw. Fehlmaterial).
    abstand = mittlerer Punktabstand; Fläche ≈ Punkte × abstand², Volumen ≈ Σ |Abweichung| × abstand²."""
    gebiete = []
    for vz in (1, -1):
        m = np.nonzero(np.isfinite(werte) & (werte * vz > toleranz))[0]
        if len(m) < min_punkte:
            continue
        pc = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(xyz[m].astype(np.float64)))
        lab = np.asarray(pc.cluster_dbscan(eps=abstand * 2.5, min_points=4))
        for k in range(lab.max() + 1 if len(lab) else 0):
            i = m[lab == k]
            if len(i) < min_punkte:
                continue
            w = werte[i].astype(np.float64)
            gebiete.append({"art": "mehr" if vz > 0 else "weniger", "punkte": int(len(i)),
                            "flaeche": round(float(len(i) * abstand ** 2), 2),
                            "volumen": round(float(np.abs(w).sum() * abstand ** 2), 3),
                            "max": round(float(w[np.argmax(np.abs(w))]), 4),
                            "mitte": [round(float(x), 3) for x in xyz[i].mean(0)]})
    gebiete.sort(key=lambda g: -g["volumen"])
    return gebiete[:max_anzahl]
