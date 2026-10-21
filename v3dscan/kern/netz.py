# Netz-Werkzeuge: analysieren, reparieren, Loecher schliessen, glaetten,
# vereinfachen, beschneiden, Netz aus Punktwolke.
#
# Wie in werkzeuge.py aendert nichts den Scan direkt: Funktionen liefern einen
# NEUEN Scan (Vorschau) oder eine Analyse. Uebernommen wird im Projekt.

import os

import math

import numpy as np

from .o3d import o3d
from .wolke import Scan


def _kopf(scan):
    if not scan.ist_netz:
        raise ValueError("„%s“ ist eine Punktwolke – erst ein Netz erzeugen." % scan.name)


def _neu(scan, m, name=None):
    neu = Scan.aus_o3d_netz(name or scan.name, m, normalen=True)
    return neu


# --- Kanten ------------------------------------------------------------------
def _kanten(tri):
    """Alle Halbkanten (u->v) mit Dreiecksnummer; plus Zaehlung je
    ungerichteter Kante."""
    u = tri.reshape(-1)
    v = tri[:, [1, 2, 0]].reshape(-1)
    welches = np.repeat(np.arange(len(tri)), 3)
    lo, hi = np.minimum(u, v), np.maximum(u, v)
    schluessel = lo.astype(np.int64) * (int(tri.max()) + 1 if len(tri) else 1) + hi
    _, inv, anzahl = np.unique(schluessel, return_inverse=True, return_counts=True)
    return u, v, welches, anzahl[inv]


def randschleifen(scan):
    """Offene Raender als geschlossene Schleifen. Jede Schleife folgt der
    Richtung der vorhandenen Halbkanten (u->v); zum Fuellen wird sie umgedreht.
    Liefert Liste von int-Arrays (Eckpunkt-Indizes)."""
    _kopf(scan)
    if len(scan.tri) == 0:
        return []
    u, v, _, zahl = _kanten(scan.tri)
    rand = zahl == 1
    ru, rv = u[rand], v[rand]
    naechster = {}
    doppelt = set()
    for a, b in zip(ru.tolist(), rv.tolist()):
        if a in naechster:
            doppelt.add(a)
        naechster.setdefault(a, []).append(b)
    besucht = set()
    schleifen = []
    for start in naechster:
        if start in besucht:
            continue
        schleife = [start]
        besucht.add(start)
        akt = start
        ok = False
        for _ in range(len(ru) + 1):
            kandidaten = [k for k in naechster.get(akt, []) if k == start or k not in besucht]
            if not kandidaten:
                break
            nxt = start if start in kandidaten and len(schleife) > 2 else \
                next((k for k in kandidaten if k != start), None)
            if nxt is None:
                break
            if nxt == start:
                ok = True
                break
            schleife.append(nxt)
            besucht.add(nxt)
            akt = nxt
        if ok and len(schleife) >= 3:
            schleifen.append(np.array(schleife, dtype=np.int64))
    return schleifen


def loch_info(scan, schleifen=None):
    schleifen = randschleifen(scan) if schleifen is None else schleifen
    xyz = scan.xyz.astype(np.float64)
    info = []
    for i, s in enumerate(schleifen):
        p = xyz[s]
        umfang = float(np.linalg.norm(p - np.roll(p, -1, axis=0), axis=1).sum())
        info.append({"nr": i, "punkte": int(len(s)), "umfang": round(umfang, 3),
                     "mitte": p.mean(0).round(3).tolist()})
    return info


# --- Analyse -------------------------------------------------------------------
def selbstschnitte(scan):
    """Dreiecke, die andere Dreiecke durchstossen. Open3Ds eigene Pruefung ist
    quadratisch (100 000 Dreiecke = 22 s); hier wird jede Kante als Strahl
    gegen eine BVH geschossen: trifft sie ein Dreieck echt zwischen ihren
    Endpunkten, schneiden sich die beiden Dreiecke."""
    xyz = scan.xyz.astype(np.float32)
    tri = scan.tri
    if len(tri) == 0:
        return np.zeros(0, bool)
    szene = o3d.t.geometry.RaycastingScene()
    szene.add_triangles(o3d.core.Tensor(xyz), o3d.core.Tensor(tri.astype(np.uint32)))
    a = xyz[tri.reshape(-1)]
    b = xyz[tri[:, [1, 2, 0]].reshape(-1)]
    richtung = b - a
    laenge = np.linalg.norm(richtung, axis=1)
    ok = laenge > 0
    einheit = np.zeros_like(richtung)
    einheit[ok] = richtung[ok] / laenge[ok, None]
    rand = np.maximum(laenge * 1e-3, 1e-6)
    start = a + einheit * rand[:, None]
    strahlen = np.hstack([start, einheit]).astype(np.float32)
    treffer = szene.cast_rays(o3d.core.Tensor(strahlen))
    t = treffer["t_hit"].numpy()
    wer = treffer["primitive_ids"].numpy().astype(np.int64)
    eigen = np.repeat(np.arange(len(tri)), 3)
    innen = ok & np.isfinite(t) & (t < laenge - 2 * rand)
    # Treffer auf ein Nachbardreieck (teilt einen Eckpunkt) zaehlt nicht
    kandidat = np.nonzero(innen)[0]
    if len(kandidat):
        getroffen = tri[wer[kandidat]]
        quelle = tri[eigen[kandidat]]
        teilt = (getroffen[:, :, None] == quelle[:, None, :]).any(axis=(1, 2))
        kandidat = kandidat[~teilt]
    maske = np.zeros(len(tri), bool)
    maske[eigen[kandidat]] = True
    maske[wer[kandidat]] = True
    return maske


def analyse(scan):
    _kopf(scan)
    m = scan.zu_o3d_netz(farbe=False)
    tri = scan.tri
    xyz = scan.xyz.astype(np.float64)
    ergebnis = {"eckpunkte": len(scan), "dreiecke": int(len(tri))}
    if len(tri) == 0:
        return ergebnis, {}

    a, b, c = xyz[tri[:, 0]], xyz[tri[:, 1]], xyz[tri[:, 2]]
    flaeche2 = np.linalg.norm(np.cross(b - a, c - a), axis=1)
    kante_max = np.maximum.reduce([np.linalg.norm(b - a, axis=1), np.linalg.norm(c - b, axis=1),
                                   np.linalg.norm(a - c, axis=1)])
    entartet = (flaeche2 <= 1e-9 * np.maximum(kante_max, 1e-9) ** 2) | \
        (tri[:, 0] == tri[:, 1]) | (tri[:, 1] == tri[:, 2]) | (tri[:, 0] == tri[:, 2])
    sortiert = np.sort(tri, axis=1)
    _, erstes, anzahl = np.unique(sortiert, axis=0, return_index=True, return_counts=True)
    doppelt = np.ones(len(tri), bool)
    doppelt[erstes] = False

    _, _, welches, zahl = _kanten(tri)
    nicht_mannig_kante = np.zeros(len(tri), bool)
    nicht_mannig_kante[welches[zahl > 2]] = True
    nm_vertices = np.asarray(m.get_non_manifold_vertices())
    schleifen = randschleifen(scan)
    cluster, groessen, _ = m.cluster_connected_triangles()
    groessen = np.asarray(groessen)

    selbst = selbstschnitte(scan)
    ergebnis["selbstschnitte"] = int(selbst.sum())

    ergebnis.update({
        "entartet": int(entartet.sum()),
        "doppelt": int(doppelt.sum()),
        "nicht_mannigfaltige_kanten": int((zahl > 2).sum() // 3),
        "nicht_mannigfaltige_punkte": int(len(nm_vertices)),
        "loecher": len(schleifen),
        "teile": int(len(groessen)),
        "kleinstes_teil": int(groessen.min()) if len(groessen) else 0,
        # wasserdicht = jede Kante genau 2 Dreiecke, keine Selbstschnitte
        "wasserdicht": bool((zahl == 2).all() and not len(nm_vertices) and not selbst.any()),
        "orientierbar": bool(m.is_orientable()) if len(tri) <= 2000000 else None,
        "flaeche": round(float(flaeche2.sum() / 2), 2),
    })
    if ergebnis["wasserdicht"]:
        # Tetraeder-Summe; Open3Ds get_volume prueft vorher quadratisch.
        ergebnis["volumen"] = round(float(abs(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6), 2)
    # Problemstellen als Eckpunkt-Maske (fuer die rote Markierung)
    problem = entartet | doppelt | nicht_mannig_kante | selbst
    maske = np.zeros(len(scan), bool)
    maske[tri[problem].reshape(-1)] = True
    if len(nm_vertices):
        maske[nm_vertices] = True
    return ergebnis, {"problem": maske}


# --- Reparieren ----------------------------------------------------------------
def reparieren(scan, verschweissen=0.0, kleine_teile_prozent=0.0,
               schnitte_entfernen=False):
    _kopf(scan)
    m = scan.zu_o3d_netz()
    bericht = {"dreiecke_vorher": len(scan.tri)}
    if verschweissen > 0:
        m = m.merge_close_vertices(float(verschweissen))
    m.remove_duplicated_vertices()
    m.remove_duplicated_triangles()
    m.remove_degenerate_triangles()
    m.remove_non_manifold_edges()
    if schnitte_entfernen:
        zwischen = _neu(scan, m)
        m.remove_triangles_by_mask(selbstschnitte(zwischen))
    if kleine_teile_prozent > 0:
        cluster, groessen, _ = m.cluster_connected_triangles()
        cluster, groessen = np.asarray(cluster), np.asarray(groessen)
        grenze = len(cluster) * kleine_teile_prozent / 100.0
        klein = groessen < grenze
        if len(groessen):
            klein[np.argmax(groessen)] = False
        m.remove_triangles_by_mask(klein[cluster])
    m.remove_unreferenced_vertices()
    try:
        m.orient_triangles()
    except RuntimeError:
        pass
    neu = _neu(scan, m)
    bericht["dreiecke_nachher"] = len(neu.tri)
    return neu, bericht


# --- Loecher --------------------------------------------------------------------
def loecher_fuellen(scan, nummern=None, max_umfang=None, art="gewoelbt"):
    """Fuellt gewaehlte Randschleifen (nummern) oder alle bis max_umfang.
    art: "flach" (ebene Membran) oder "gewoelbt" (setzt die umliegende
    Kruemmung fort). Aufbau in konzentrischen Ringen: der Rand selbst wird
    nie unterteilt, damit keine T-Stoesse zum vorhandenen Netz entstehen."""
    _kopf(scan)
    schleifen = randschleifen(scan)
    info = loch_info(scan, schleifen)
    if nummern is None:
        grenze = float("inf") if max_umfang is None else float(max_umfang)
        nummern = [i["nr"] for i in info if i["umfang"] <= grenze]
    # der laengste Rand eines offenen Scans ist oft der Aussenrand: nur fuellen,
    # wenn ausdruecklich gewaehlt oder unter der Grenze
    xyz = scan.xyz.astype(np.float64)
    neue_punkte = [xyz]
    neue_tri = [scan.tri.astype(np.int64)]
    naechster = len(xyz)
    # mittlere Kantenlaenge des Netzes als Zielgroesse
    t = scan.tri
    kl = float(np.mean(np.linalg.norm(xyz[t[:, 0]] - xyz[t[:, 1]], axis=1))) if len(t) else 1.0
    gefuellt = 0
    for nr in nummern:
        if not 0 <= nr < len(schleifen):
            continue
        rand = schleifen[nr][::-1]          # umdrehen -> passende Orientierung
        pts, tris = _ringe(xyz, rand, kl, naechster)
        neue_punkte.append(pts)
        neue_tri.append(tris)
        naechster += len(pts)
        gefuellt += 1
    alle = np.vstack(neue_punkte)
    tri = np.vstack(neue_tri)
    if gefuellt:
        alle[len(xyz):] = _fairen(alle, scan.tri.astype(np.int64), np.vstack(neue_tri[1:]),
                                  len(xyz), art)
    rgb = None
    if scan.rgb is not None:
        extra = len(alle) - len(xyz)
        rgb = np.vstack([scan.rgb, np.tile(scan.rgb.mean(0).astype(np.uint8), (extra, 1))])
    m = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(alle),
                                  o3d.utility.Vector3iVector(tri.astype(np.int32)))
    if rgb is not None:
        m.vertex_colors = o3d.utility.Vector3dVector(rgb / 255.0)
    return _neu(scan, m), {"gefuellt": gefuellt}


def _ringe(xyz, rand, kantenlaenge, erster_index):
    """Konzentrische Ringe vom Rand zur Mitte (gleiche Punktzahl je Ring)."""
    p0 = xyz[rand]
    k = len(rand)
    mitte = p0.mean(0)
    radius = float(np.linalg.norm(p0 - mitte, axis=1).mean())
    ringe = int(np.clip(np.ceil(radius / max(kantenlaenge, 1e-9)), 1, 60))
    stuecke = [p0 * (1 - r / ringe) + mitte * (r / ringe) for r in range(1, ringe)]
    punkte = np.vstack(stuecke + [mitte[None]])
    idx_ring = [rand.astype(np.int64)]
    for r in range(ringe - 1):
        idx_ring.append(erster_index + r * k + np.arange(k))
    zentrum = erster_index + (ringe - 1) * k
    tris = []
    for r in range(ringe - 1):
        a, b = idx_ring[r], idx_ring[r + 1]
        a1, b1 = np.roll(a, -1), np.roll(b, -1)
        tris.append(np.stack([a, a1, b1], 1))
        tris.append(np.stack([a, b1, b], 1))
    letzte = idx_ring[-1]
    tris.append(np.stack([letzte, np.roll(letzte, -1), np.full(k, zentrum)], 1))
    return punkte, np.vstack(tris)


def _fairen(alle, tri_alt, tri_neu, erster, art):
    """Neue Punkte (Index >= erster) so legen, dass die Flaeche moeglichst
    glatt wird; alles andere bleibt fest.
      flach    = min |L p|^2 nur ueber die neuen Punkte (Membran)
      gewoelbt = min |L p|^2 auch ueber die Randpunkte, deren Laplace aus den
                 ECHTEN Nachbarn gebildet wird -> tangentialer Anschluss, die
                 Fuellung setzt die Kruemmung fort (Bi-Laplace).
    Geloest mit konjugierten Gradienten auf den Normalgleichungen; nur das
    lokale Teilnetz wird betrachtet (neue Punkte + Rand + dessen Nachbarn)."""
    rand = np.unique(tri_neu[tri_neu < erster])
    am_rand = np.zeros(len(alle), bool)
    am_rand[rand] = True
    alt_lokal = tri_alt[am_rand[tri_alt].any(axis=1)]
    t = np.vstack([tri_neu, alt_lokal])
    lokal, t_lok = np.unique(t, return_inverse=True)
    t_lok = t_lok.reshape(-1, 3)
    n = len(lokal)
    frei = lokal >= erster
    zeilen = frei | (am_rand[lokal] if art == "gewoelbt" else np.zeros(n, bool))
    i = np.concatenate([t_lok[:, 0], t_lok[:, 1], t_lok[:, 2], t_lok[:, 1], t_lok[:, 2], t_lok[:, 0]])
    j = np.concatenate([t_lok[:, 1], t_lok[:, 2], t_lok[:, 0], t_lok[:, 0], t_lok[:, 1], t_lok[:, 2]])
    kante = np.unique(np.stack([i, j], 1), axis=0)
    i, j = kante[:, 0], kante[:, 1]
    grad = np.bincount(i, minlength=n).astype(np.float64)
    w = 1.0 / np.maximum(grad[i], 1)
    nimm = zeilen[i]                     # nur Zeilen, die in die Energie eingehen
    i, j, w = i[nimm], j[nimm], w[nimm]
    fi = np.nonzero(frei)[0]
    pos = -np.ones(n, np.int64)
    pos[fi] = np.arange(len(fi))
    zi = np.nonzero(zeilen)[0]

    def L(x_voll):                       # (n,3) -> Laplace in allen Zeilen (n,3)
        y = np.empty_like(x_voll)
        for k in range(3):
            y[:, k] = np.bincount(i, weights=w * x_voll[j, k], minlength=n)
        y[zeilen] -= x_voll[zeilen]
        y[~zeilen] = 0
        return y

    def Lt(z):                           # transponiert, Ergebnis nur fuer freie Punkte
        y = np.empty((n, 3))
        for k in range(3):
            y[:, k] = np.bincount(j, weights=w * z[i, k], minlength=n)
        y[zeilen] -= z[zeilen]
        return y[fi]

    def A(x):
        voll = np.zeros((n, 3))
        voll[fi] = x
        return Lt(L(voll))

    fest = alle[lokal].copy()
    fest[fi] = 0
    b = -Lt(L(fest))
    x = alle[lokal][fi].copy()
    r = b - A(x)
    d = r.copy()
    rr = np.sum(r * r)
    grenze = 1e-12 * max(np.sum(b * b), 1e-30)
    for _ in range(4 * len(fi) + 50):
        if rr <= grenze:
            break
        Ad = A(d)
        alpha = rr / max(np.sum(d * Ad), 1e-300)
        x += alpha * d
        r -= alpha * Ad
        rr_neu = np.sum(r * r)
        d = r + (rr_neu / rr) * d
        rr = rr_neu
    return x


# --- Glaetten / Vereinfachen ------------------------------------------------------
def glaetten(scan, iterationen=5, art="taubin", staerke=0.5):
    _kopf(scan)
    m = scan.zu_o3d_netz()
    if art == "laplace":
        m = m.filter_smooth_laplacian(int(iterationen), float(staerke))
    else:
        m = m.filter_smooth_taubin(int(iterationen), float(staerke), -float(staerke) - 0.03)
    return _neu(scan, m), {}


def vereinfachen(scan, ziel_dreiecke):
    _kopf(scan)
    ziel = int(max(4, ziel_dreiecke))
    m = scan.zu_o3d_netz().simplify_quadric_decimation(ziel)
    m.remove_unreferenced_vertices()
    bericht = {"dreiecke_vorher": len(scan.tri), "dreiecke_nachher": len(m.triangles)}
    # Abweichungsstatistik: Abstand der alten Eckpunkte zum vereinfachten Netz
    try:
        szene = o3d.t.geometry.RaycastingScene()
        szene.add_triangles(o3d.t.geometry.TriangleMesh.from_legacy(m))
        P = np.asarray(scan.xyz, np.float32)
        if len(P) > 200000:
            P = P[np.random.default_rng(0).choice(len(P), 200000, replace=False)]
        d = szene.compute_distance(o3d.core.Tensor(P)).numpy()
        bericht.update({"abweichung_median": round(float(np.median(d)), 4),
                        "abweichung_p95": round(float(np.percentile(d, 95)), 4),
                        "abweichung_max": round(float(d.max()), 4)})
    except Exception:
        pass
    return _neu(scan, m), bericht


# --- Beschneiden -----------------------------------------------------------------
def beschneiden(scan, punkt, normale):
    """Sauberer Schnitt: Dreiecke an der Ebene werden geteilt, die Seite, in
    die die Normale zeigt, faellt weg."""
    _kopf(scan)
    tm = o3d.t.geometry.TriangleMesh.from_legacy(scan.zu_o3d_netz())
    n = -np.asarray(normale, np.float64)       # clip_plane behaelt die Normalen-Seite
    geschnitten = tm.clip_plane(point=np.asarray(punkt, np.float64), normal=n).to_legacy()
    geschnitten.remove_duplicated_vertices()
    geschnitten.remove_unreferenced_vertices()
    if len(geschnitten.triangles) == 0:
        raise ValueError("Nach dem Schnitt bliebe nichts übrig – Seite umdrehen?")
    return _neu(scan, geschnitten), {}


# --- Netz aus Punktwolke ------------------------------------------------------------
def netz_erzeugen(scan, verfahren="poisson", tiefe=9, dichte_schnitt=5.0, radius=None,
                  normalen_neu=False):
    if len(scan) < 100:
        raise ValueError("Zu wenige Punkte für ein Netz.")
    p = scan.zu_o3d(farbe=True, normalen=not normalen_neu)
    if scan.nrm is None or normalen_neu:
        from .werkzeuge import punktabstand
        a = punktabstand(scan)
        p.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=a * 6, max_nn=30))
        mitte = np.asarray(p.points).mean(0)
        nrm = np.asarray(p.normals)
        zeigt = np.einsum("ij,ij->i", nrm, np.asarray(p.points) - mitte)
        p.normals = o3d.utility.Vector3dVector(np.where((zeigt < 0)[:, None], -nrm, nrm))
    if verfahren == "kugel":
        from .werkzeuge import punktabstand
        a = radius or punktabstand(scan) * 1.5
        radien = o3d.utility.DoubleVector([a, a * 2, a * 4])
        m = o3d.geometry.TriangleMesh.create_from_point_cloud_ball_pivoting(p, radien)
    else:
        # Unter Windows (getestet mit Wine) bricht die mehrfaedige Poisson-
        # Rekonstruktion von Open3D 0.19 mit "Failed to close loop" ab.
        faeden = 1 if os.name == "nt" else -1
        m, dichte = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
            p, depth=int(tiefe), linear_fit=True, n_threads=faeden)
        dichte = np.asarray(dichte)
        if dichte_schnitt > 0 and len(dichte):
            # Poisson schliesst alles - Flaechen mit wenig Messpunkten dahinter
            # sind erfunden und werden entfernt.
            m.remove_vertices_by_mask(dichte < np.quantile(dichte, dichte_schnitt / 100.0))
    m.remove_degenerate_triangles()
    m.remove_unreferenced_vertices()
    if len(m.triangles) == 0:
        raise ValueError("Es ist kein Netz entstanden – andere Einstellungen versuchen.")
    return _neu(scan, m, name="Netz aus " + scan.name), {"dreiecke": len(m.triangles)}



# === v1.0: Normalen umdrehen, Abrollen, Mittelwert-Netz, Netz mit Koerper teilen ===================
def normalen_umdrehen(scan):
    neu = scan.kopie()
    if neu.tri is not None:
        neu.tri = np.ascontiguousarray(neu.tri[:, [0, 2, 1]])
    if neu.nrm is not None:
        neu.nrm = -neu.nrm
    neu.geaendert()
    return neu


def abrollen(scan, punkt, achse, radius=None):
    """Unroll: Netz um eine Zylinderachse in die Ebene abrollen (x = Bogenlaenge auf dem Bezugsradius,
    y = entlang der Achse, z = Abstand vom Bezugsradius). Dreiecke ueber der Naht fallen weg."""
    a = np.asarray(achse, float) / np.linalg.norm(achse)
    p0 = np.asarray(punkt, float)
    h = np.array([1.0, 0, 0]) if abs(a[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = np.cross(a, h); e1 /= np.linalg.norm(e1)
    e2 = np.cross(a, e1)
    q = scan.xyz.astype(float) - p0
    z = q @ a
    x, y = q @ e1, q @ e2
    r = np.hypot(x, y)
    r0 = float(radius) if radius else float(np.median(r))
    w = np.arctan2(y, x)
    xyz = np.c_[w * r0, z, r - r0]
    tri = scan.tri
    if tri is not None:
        sprung = np.ptp(w[tri], axis=1) > np.pi
        tri = tri[~sprung]
    from .wolke import Scan
    return Scan(scan.name + " (abgerollt)", xyz, scan.rgb, None, tri)


def mittelwert_netz(scans, tiefe=9):
    """Average Mesh: Punkte mehrerer ausgerichteter Scans zusammen, Normalen, Poisson-Netz."""
    from .projekt import verbinden
    teile = []
    for s in scans:
        t = s.kopie()
        if t.tri is not None:
            t.tri = None
        teile.append(t)
    gesamt = verbinden(teile, "Mittelwert-Netz")
    return netz_erzeugen(gesamt, "poisson", tiefe=tiefe)


def innen_maske(scan, shapes):
    """Punkte des Scans, die innerhalb der Koerper liegen (Vorzeichen der Abstandsfunktion)."""
    from . import koerper as kp
    d = kp.abweichung(shapes, scan.xyz)
    return d < 0


# --- Netz an einer geschlossenen 3D-Kurve teilen (v1.2, QuickSurface "Split Mesh with 3D Sketch") ---------
def _teilnetz(scan, wahl, name):
    T = np.asarray(scan.tri)[wahl]
    benutzt = np.unique(T)
    neu_index = -np.ones(len(scan.xyz), np.int64)
    neu_index[benutzt] = np.arange(len(benutzt))
    rgb = None if scan.rgb is None else scan.rgb[benutzt]
    nrm = None if scan.nrm is None else scan.nrm[benutzt]
    return Scan(name, scan.xyz[benutzt], rgb, nrm, tri=neu_index[T])


def teilen_mit_kurve(scan, kurve):
    """Dreiecke, deren Mitte - entlang der mittleren Kurvennormale gesehen - innerhalb der geschlossenen Kurve
    liegt und zur Kurve hin zeigt, werden ein eigenes Netz. -> (innen, aussen) als neue Scans."""
    _kopf(scan)
    K = np.asarray(kurve, float)
    if len(K) < 4:
        raise ValueError("Die Kurve ist zu kurz.")
    if np.linalg.norm(K[0] - K[-1]) > 1e-6 * max(1.0, float(np.ptp(K, axis=0).max())):
        K = np.r_[K, K[:1]]
    X = np.asarray(scan.xyz, float)
    T = np.asarray(scan.tri, np.int64)
    P = X[T]
    mitte = P.mean(1)
    fn = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    fn /= np.maximum(np.linalg.norm(fn, axis=1), 1e-12)[:, None]
    c = K.mean(0)
    _, _, vt = np.linalg.svd(K - c, full_matrices=False)
    u, v, n = vt[0], vt[1], vt[2]
    # Normale zur Netzseite der Kurve ausrichten (Mittel der Flaechennormalen nahe der Kurve)
    nah = np.linalg.norm(mitte - c, axis=1) < 1.2 * float(np.max(np.linalg.norm(K - c, axis=1)))
    if nah.any() and (fn[nah].mean(0) @ n) < 0:
        n = -n
    q = np.c_[(mitte - c) @ u, (mitte - c) @ v]
    k2 = np.c_[(K - c) @ u, (K - c) @ v]
    innen = np.zeros(len(q), bool)
    for (x1, y1), (x2, y2) in zip(k2[:-1], k2[1:]):           # Strahl nach +x, gerade/ungerade Kreuzungen
        kreuzt = (y1 > q[:, 1]) != (y2 > q[:, 1])
        if not kreuzt.any():
            continue
        xs = x1 + (q[kreuzt, 1] - y1) * (x2 - x1) / (y2 - y1)
        idx = np.nonzero(kreuzt)[0]
        innen[idx[q[idx, 0] < xs]] ^= True
    innen &= (fn @ n) > 0.2                                     # Rueckseite und Wände quer dazu gehören nicht dazu
    if not innen.any() or innen.all():
        raise ValueError("Die Kurve umschließt keinen Teil des Netzes – liegt sie auf dem Scan?")
    return _teilnetz(scan, innen, scan.name + " (innen)"), _teilnetz(scan, ~innen, scan.name)


# --- Netzrand (v1.3): Bucht fuellen (Semi-Hole), Bruecke, Rand glaetten/verlaengern, Ausfransungen -------
def _netz_aus(scan, xyz, tri, extra_farbe=True):
    rgb = None
    if scan.rgb is not None:
        extra = len(xyz) - len(scan.xyz)
        rgb = np.vstack([scan.rgb, np.tile(scan.rgb.mean(0).astype(np.uint8), (max(extra, 0), 1))])[:len(xyz)]
    m = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(np.asarray(xyz, float)),
                                  o3d.utility.Vector3iVector(np.asarray(tri, np.int32)))
    if rgb is not None:
        m.vertex_colors = o3d.utility.Vector3dVector(rgb / 255.0)
    m.remove_unreferenced_vertices()
    return _neu(scan, m)


def _kantenlaenge(xyz, tri):
    return float(np.mean(np.linalg.norm(xyz[tri[:, 0]] - xyz[tri[:, 1]], axis=1))) if len(tri) else 1.0


def randpunkte_finden(scan, punkte):
    """Geklickte 3D-Punkte -> (Schleifen-Nr., Position in der Schleife) des naechsten Randpunkts."""
    schleifen = randschleifen(scan)
    if not schleifen:
        raise ValueError("Das Netz hat keinen offenen Rand.")
    alle = np.concatenate(schleifen)
    wo = np.concatenate([np.c_[np.full(len(s_), i), np.arange(len(s_))] for i, s_ in enumerate(schleifen)])
    aus = []
    for q in np.asarray(punkte, float).reshape(-1, 3):
        k = int(np.argmin(np.linalg.norm(scan.xyz[alle] - q, axis=1)))
        aus.append((int(wo[k, 0]), int(wo[k, 1])))
    return schleifen, aus


def bucht_fuellen(scan, punkte, art="gewoelbt"):
    """Fill semi-hole: Randbogen zwischen zwei Randpunkten (der kuerzere) mit einer geraden Verbindung
    schliessen und die Bucht dazwischen fuellen - fuer Einbuchtungen am Aussenrand eines offenen Scans."""
    _kopf(scan)
    schleifen, ((s1, i1), (s2, i2)) = randpunkte_finden(scan, punkte)
    if s1 != s2:
        raise ValueError("Die beiden Punkte liegen auf verschiedenen Rändern.")
    L = schleifen[s1]
    if i1 == i2:
        raise ValueError("Zwei verschiedene Randpunkte wählen.")
    xyz = scan.xyz.astype(np.float64)
    n = len(L)

    def bogen(a, b):                                  # Randpunkte von a bis b in Schleifenrichtung
        return L[np.arange(a, a + (b - a) % n + 1) % n]
    b1, b2 = bogen(i1, i2), bogen(i2, i1)
    laenge = [float(np.linalg.norm(np.diff(xyz[b_], axis=0), axis=1).sum()) for b_ in (b1, b2)]
    arc = b1 if laenge[0] <= laenge[1] else b2       # kuerzerer Bogen = die Bucht
    if len(arc) < 3:
        raise ValueError("Zwischen den Punkten liegt keine Bucht (Nachbarpunkte).")
    pa, pb = xyz[arc[0]], xyz[arc[-1]]
    kl = _kantenlaenge(xyz, scan.tri)
    k = max(int(np.ceil(np.linalg.norm(pb - pa) / kl)), 1)
    steg = np.array([pb + (pa - pb) * t for t in np.linspace(0, 1, k + 1)[1:-1]]).reshape(-1, 3)
    # Stegpunkte zuerst anhaengen: sie gelten beim Fairen als fest (Rand der Fuellung)
    s_idx = np.arange(len(xyz), len(xyz) + len(steg))
    xyz2 = np.vstack([xyz, steg])
    erster = len(xyz2)
    # Fuellung gegen die Halbkanten-Richtung: Bogen rueckwaerts, dann Steg von a nach b
    rand = np.r_[arc[::-1], s_idx[::-1]]
    pts, tris = _ringe(xyz2, rand, kl, erster)
    alle = np.vstack([xyz2, pts])
    tri_alt = scan.tri.astype(np.int64)
    alle[erster:] = _fairen(alle, tri_alt, tris, erster, art)
    return _netz_aus(scan, alle, np.vstack([tri_alt, tris])), {"gefuellt": 1, "dreiecke": int(len(tri_alt) + len(tris))}


def bruecke(scan, punkte):
    """Bridge: Streifen zwischen zwei Randpunkten desselben Lochs - teilt das Loch in zwei."""
    _kopf(scan)
    schleifen, ((s1, i1), (s2, i2)) = randpunkte_finden(scan, punkte)
    if s1 != s2:
        raise ValueError("Die beiden Punkte liegen auf verschiedenen Rändern.")
    L = schleifen[s1]
    n = len(L)
    if (i2 - i1) % n in (0, 1, n - 1):
        raise ValueError("Die Punkte liegen zu dicht beieinander.")
    xyz = scan.xyz.astype(np.float64)
    a, a1, b, b1 = L[i1], L[(i1 + 1) % n], L[i2], L[(i2 + 1) % n]
    kl = _kantenlaenge(xyz, scan.tri)
    k = max(int(np.ceil(np.linalg.norm(xyz[b] - xyz[a]) / kl)), 1)
    # Schienen a -> b1 und a1 -> b; Vierecke [R_j, L_j, L_j+1, R_j+1] nutzen a1->a und b1->b
    t = np.linspace(0, 1, k + 1)[1:-1]
    links = [a] + [len(xyz) + j for j in range(len(t))] + [b1]
    rechts = [a1] + [len(xyz) + len(t) + j for j in range(len(t))] + [b]
    neu = np.vstack([xyz[a] + (xyz[b1] - xyz[a]) * t[:, None], xyz[a1] + (xyz[b] - xyz[a1]) * t[:, None]]).reshape(-1, 3)
    tris = []
    for j in range(k):
        r0, l0, l1, r1 = rechts[j], links[j], links[j + 1], rechts[j + 1]
        tris += [[r0, l0, l1], [r0, l1, r1]]
    tri = np.vstack([scan.tri.astype(np.int64), np.array(tris, np.int64)])
    return _netz_aus(scan, np.vstack([xyz, neu]), tri), {"dreiecke": int(len(tri))}


def _auswahl_schleifen(scan, punkte):
    schleifen = randschleifen(scan)
    if not schleifen:
        raise ValueError("Das Netz hat keinen offenen Rand.")
    if punkte is None or not len(punkte):
        return schleifen, list(range(len(schleifen)))
    _, wahl = randpunkte_finden(scan, punkte)
    return schleifen, sorted({s_ for s_, _ in wahl})


def rand_glaetten(scan, punkte=None, iterationen=10, staerke=0.5):
    """Boundary smooth: Randpunkte entlang ihrer Schleife glaetten (Taubin, schrumpft kaum);
    ohne geklickte Punkte alle Raender."""
    _kopf(scan)
    schleifen, nummern = _auswahl_schleifen(scan, punkte)
    xyz = scan.xyz.astype(np.float64).copy()
    for nr in nummern:
        L = schleifen[nr]
        for _ in range(int(iterationen)):
            for f in (staerke, -staerke - 0.02):
                P = xyz[L]
                xyz[L] = P + f * (0.5 * (np.roll(P, 1, 0) + np.roll(P, -1, 0)) - P)
    return _netz_aus(scan, xyz, scan.tri), {"raender": len(nummern)}


def ausfransungen_entfernen(scan, durchgaenge=5, winkel=45.0):
    """Zacken am Rand weg: Dreiecke, deren zwei Randkanten sich unter weniger als winkel Grad treffen, und
    lose Einzeldreiecke - wiederholt, weil darunter die naechste Zacke frei wird."""
    _kopf(scan)
    tri = scan.tri.astype(np.int64)
    weg_gesamt = 0
    for _ in range(int(durchgaenge)):
        e = np.sort(np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]), axis=1)
        _, inv, zahl = np.unique(e, axis=0, return_inverse=True, return_counts=True)
        randkante = (zahl[inv.ravel()] == 1).reshape(3, -1)       # Kante 0: 0-1, 1: 1-2, 2: 2-0
        rand = randkante.sum(0)
        # Zacke = zwei Randkanten treffen sich unter spitzem Winkel (echte Ecken bleiben)
        P = scan.xyz[tri].astype(float)
        spitz = np.zeros(len(tri), bool)
        for ecke, (k1, k2) in ((1, (0, 1)), (2, (1, 2)), (0, (2, 0))):
            beide = randkante[k1] & randkante[k2]
            if beide.any():
                a_ = P[beide, (ecke + 1) % 3] - P[beide, ecke]
                b_ = P[beide, (ecke + 2) % 3] - P[beide, ecke]
                c = np.einsum("ij,ij->i", a_, b_) / np.maximum(np.linalg.norm(a_, axis=1) * np.linalg.norm(b_, axis=1), 1e-12)
                spitz[np.nonzero(beide)[0][c > math.cos(math.radians(winkel))]] = True
        weg = (rand == 3) | spitz
        if not weg.any():
            break
        weg_gesamt += int(weg.sum())
        tri = tri[~weg]
    if not len(tri):
        raise ValueError("Es bliebe nichts übrig.")
    return _netz_aus(scan, scan.xyz, tri), {"entfernt": weg_gesamt, "dreiecke": int(len(tri))}


def rand_verlaengern(scan, punkte=None, laenge=2.0):
    """Extend boundary: Rand in der Tangentialebene nach aussen um laenge verlaengern (ein Dreiecksstreifen)."""
    _kopf(scan)
    schleifen, nummern = _auswahl_schleifen(scan, punkte)
    xyz = scan.xyz.astype(np.float64)
    tri = scan.tri.astype(np.int64)
    m = scan.zu_o3d_netz()
    m.compute_vertex_normals()
    N = np.asarray(m.vertex_normals)
    neu, tris = [], []
    n0 = len(xyz)
    kl = _kantenlaenge(xyz, tri)
    stufen = max(1, int(np.ceil(float(laenge) / kl)))           # in Ringen von hoechstens einer Kantenlaenge
    for nr in nummern:
        L = schleifen[nr]
        P = xyz[L]
        tang = np.roll(P, -1, 0) - np.roll(P, 1, 0)                 # Schleife folgt den Halbkanten u->v
        aus = np.cross(tang, N[L])                                    # rechts der Laufrichtung = aussen
        aus /= np.maximum(np.linalg.norm(aus, axis=1), 1e-12)[:, None]
        for _ in range(3):                                            # Richtungen glaetten (Ecken)
            aus = aus + 0.5 * (np.roll(aus, 1, 0) + np.roll(aus, -1, 0))
            aus /= np.maximum(np.linalg.norm(aus, axis=1), 1e-12)[:, None]
        vorher = L
        for st in range(1, stufen + 1):
            ring = n0 + len(neu) + np.arange(len(L))
            neu.extend(P + aus * float(laenge) * st / stufen)
            for j in range(len(L)):
                u, v = vorher[j], vorher[(j + 1) % len(L)]
                ru, rv = ring[j], ring[(j + 1) % len(L)]
                tris += [[v, u, ru], [v, ru, rv]]
            vorher = ring
    alle = np.vstack([xyz, np.array(neu)])
    t_neu = np.array(tris, np.int64)
    return _netz_aus(scan, alle, np.vstack([tri, t_neu])), {"raender": len(nummern), "dreiecke": int(len(tri) + len(t_neu))}
