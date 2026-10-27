# Freiform (QuickSurface "Automatic Surfacing" / "Fit Surface" / "Cut Solids", Design X "Auto Surface",
# "Mesh Fit"). Eigener Weg, keine fremden Algorithmen uebernommen:
#
# Automatisch:  Scan-Netz -> grobes Vierecksnetz (Instant Meshes, BSD, pynanoinstantmeshes)
#   -> jede Vierecks-Kante wird auf den Scan gelegt (Abtastpunkte, von beiden Nachbarn geteilt)
#   -> je Viereck ein Raster (Rand = geteilte Kantenpunkte, Inneres = Coons-Mischung auf den Scan
#      projiziert) -> bikubische B-Spline-Interpolation mit gleichmaessiger Parametrisierung.
#   Gleiche Randpunkte + gleiche Parameter => beide Nachbarn haben exakt dieselbe Randkurve (C0, dicht).
#   -> Naehen -> Schale -> (wenn geschlossen) Volumenkoerper.
# Flaeche einpassen: Punktauswahl -> Ausgleichsebene -> Hoehenraster -> B-Spline (approximierend),
#   auf Wunsch ueber den Rand hinaus verlaengert. Damit lassen sich Koerper beschneiden.

import contextlib
import os
import sys
import time

import math

import numpy as np


@contextlib.contextmanager
def _ohne_ausgabe():
    """Instant Meshes schreibt seitenweise Fortschritt nach stdout (C++) - stummschalten."""
    try:
        fd = sys.stdout.fileno()
    except Exception:
        yield
        return
    sys.stdout.flush()
    alt = os.dup(fd)
    try:
        with open(os.devnull, "w") as nul:
            os.dup2(nul.fileno(), fd)
            yield
    finally:
        os.dup2(alt, fd)
        os.close(alt)


def quad_netz(X, T, flaechen=300, kantenwinkel=0.0):
    """Scan-Netz -> reines Vierecksnetz (V, F) mit etwa `flaechen` Vierecken."""
    import pynanoinstantmeshes as pim
    ziel = max(6, int(round(flaechen / 4.3)))       # Instant Meshes teilt am Ende jedes Feld in 4
    with _ohne_ausgabe():
        V, F = pim.remesh(np.ascontiguousarray(X, np.float32), np.ascontiguousarray(T, np.uint32),
                          vertex_count=ziel, creaseAngle=float(kantenwinkel), deterministic=True,
                          align_to_boundaries=True)
    V = np.array(V, np.float64)
    F = np.array(F, np.int64)
    gut = (F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 2] != F[:, 3]) & (F[:, 3] != F[:, 0])
    return V, F[gut]


class _Projektor:
    def __init__(self, X, T):
        from .o3d import o3d
        self.szene = o3d.t.geometry.RaycastingScene()
        self.szene.add_triangles(o3d.core.Tensor(np.ascontiguousarray(X, np.float32)),
                                 o3d.core.Tensor(np.ascontiguousarray(T, np.uint32)))
        self.o3d = o3d

    def __call__(self, P):
        P = np.asarray(P, np.float64)
        form = P.shape
        q = self.o3d.core.Tensor(np.ascontiguousarray(P.reshape(-1, 3), np.float32))
        return self.szene.compute_closest_points(q)["points"].numpy().astype(np.float64).reshape(form)

    def mit_normale(self, P):
        P = np.asarray(P, np.float64)
        form = P.shape
        q = self.o3d.core.Tensor(np.ascontiguousarray(P.reshape(-1, 3), np.float32))
        e = self.szene.compute_closest_points(q)
        return (e["points"].numpy().astype(np.float64).reshape(form),
                e["primitive_normals"].numpy().astype(np.float64).reshape(form))

    def entlang(self, P, N, weit):
        """P entlang +-N auf den Scan legen (naechster Treffer innerhalb weit), sonst naechster Punkt.
        An stark gekruemmten Stellen springt der naechste Punkt sonst auf die Gegenseite."""
        P = np.asarray(P, np.float64)
        form = P.shape
        P2 = P.reshape(-1, 3)
        N2 = N.reshape(-1, 3)
        N2 = N2 / np.maximum(np.linalg.norm(N2, axis=1, keepdims=True), 1e-12)
        besten = np.full(len(P2), np.inf)
        ziel = np.zeros_like(P2)
        for vz in (1.0, -1.0):
            strahlen = np.c_[P2, vz * N2].astype(np.float32)
            t = self.szene.cast_rays(self.o3d.core.Tensor(strahlen))["t_hit"].numpy()
            ok = np.isfinite(t) & (t < besten) & (t <= weit)
            besten[ok] = t[ok]
            ziel[ok] = P2[ok] + vz * N2[ok] * t[ok, None]
        rest = ~np.isfinite(besten)
        if rest.any():
            ziel[rest] = self(P2[rest])
        return ziel.reshape(form)


def _kanten(F):
    k = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 3]], F[:, [3, 0]]])
    k = np.sort(k, axis=1)
    return np.unique(k, axis=0)


def _flaeche(gitter):
    from OCP.Approx import Approx_IsoParametric
    from OCP.GeomAPI import GeomAPI_PointsToBSplineSurface
    from OCP.TColgp import TColgp_Array2OfPnt
    from OCP.gp import gp_Pnt
    n, m = gitter.shape[:2]
    arr = TColgp_Array2OfPnt(1, n, 1, m)
    for i in range(n):
        for j in range(m):
            arr.SetValue(i + 1, j + 1, gp_Pnt(*map(float, gitter[i, j])))
    f = GeomAPI_PointsToBSplineSurface()
    f.Interpolate(arr, Approx_IsoParametric)
    if not f.IsDone():
        raise ValueError("Flächeninterpolation fehlgeschlagen.")
    return f.Surface()


def _glatte_normalen(X, T):
    """Funktion P -> Scan-Normale, gemittelt ueber die naechsten Eckpunkte (glatter als eine Facette)."""
    from .o3d import o3d
    m = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(X), o3d.utility.Vector3iVector(np.asarray(T, np.int32)))
    m.compute_vertex_normals()
    VN = np.asarray(m.vertex_normals)
    baum = o3d.geometry.KDTreeFlann(o3d.geometry.PointCloud(o3d.utility.Vector3dVector(X)))

    def normale(P, bezug):
        P = np.asarray(P, float)
        form = P.shape
        P2 = P.reshape(-1, 3)
        B = np.asarray(bezug, float).reshape(-1, 3)
        aus = np.zeros_like(P2)
        for i, q in enumerate(P2):
            _, idx, _ = baum.search_knn_vector_3d(q, 12)
            n = VN[np.asarray(idx)]
            n = n[(n @ B[i]) > 0] if np.any((n @ B[i]) > 0) else n     # Gegenseite duenner Wand ignorieren
            n = n.sum(0)
            aus[i] = n / max(np.linalg.norm(n), 1e-12)
        return aus.reshape(form)
    return normale


def auto_flaechen(X, T, flaechen=300, raster=9, kantenwinkel=0.0, fortschritt=None, glatt=True, kaefig=None,
                  scharf_von_hand=None, scharfe_ecken=None, ecken_ausgleichen=True):
    """Geschlossenes oder offenes Scan-Netz -> (shape, info). raster = Punkte je Kante (>= 4).
    glatt: an jedem Kantenpunkt liegen die ersten Rasterreihen beider Nachbarflaechen in derselben
    Tangentialebene (Scan-Normale) -> annaehernd tangentiale Uebergaenge statt Knicke.
    kaefig: {"V", "F"} eigenes (von Hand verschobenes) Vierecksnetz statt Instant Meshes."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeSolid, BRepBuilderAPI_Sewing
    from OCP.ShapeFix import ShapeFix_Solid
    from OCP.TopAbs import TopAbs_SHELL
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    t0 = time.time()
    X = np.asarray(X, np.float64)
    T = np.asarray(T, np.int64)
    if kaefig is not None:
        V = np.asarray(kaefig["V"], np.float64).reshape(-1, 3)
        F = np.asarray(kaefig["F"], np.int64).reshape(-1, 4)
        if len(F) and (F.min() < 0 or F.max() >= len(V)):
            raise ValueError("Der Käfig passt nicht zusammen (Eckennummern).")
    else:
        V, F = quad_netz(X, T, flaechen, kantenwinkel)
    if len(F) < 4:
        raise ValueError("Das Vierecksnetz ist leer – ist der Scan ein Dreiecksnetz?")
    proj = _Projektor(X, T)
    V, VN = proj.mit_normale(V)
    # Normalen an den Ecken: Mittel der Scan-Normalen in der Umgebung (glatter als eine Facette)
    VN = VN / np.maximum(np.linalg.norm(VN, axis=1, keepdims=True), 1e-12)
    kante_mittel = float(np.mean(np.linalg.norm(V[F[:, 0]] - V[F[:, 1]], axis=1)))
    weit = 0.6 * kante_mittel
    n = max(4, int(raster))
    if glatt:
        n = max(n, M_KP + 4)        # genug Abtastpunkte fuer die Kontrollpunkte (sonst schwingt der Ausgleich)
    if n % 2 == 0:
        n += 1                      # ungerade: Kantenmitte ist ein gemeinsamer Abtastpunkt
    t = np.linspace(0, 1, n)
    K = _kanten(F)
    schluessel = {(int(a), int(b)): i for i, (a, b) in enumerate(K)}
    # Kantenpunkte: von kleinerer zu groesserer Ecken-Nummer, Enden = Ecken (exakt geteilt)
    E = V[K[:, 0], None, :] * (1 - t)[None, :, None] + V[K[:, 1], None, :] * t[None, :, None]
    EN = VN[K[:, 0], None, :] * (1 - t)[None, :, None] + VN[K[:, 1], None, :] * t[None, :, None]
    E[:, 1:-1] = proj.entlang(E[:, 1:-1], EN[:, 1:-1], weit)
    E[:, 0], E[:, -1] = V[K[:, 0]], V[K[:, 1]]
    kp_rand = kp_quer = None
    scharf, ecke_scharf = scharfe_kanten(V, F, K, schluessel, proj)
    for a_, b_ in (scharf_von_hand or []):           # Crease von Hand
        k_ = schluessel.get((min(int(a_), int(b_)), max(int(a_), int(b_))))
        if k_ is not None:
            scharf[k_] = True
            ecke_scharf[[int(a_), int(b_)]] = True
    for v_ in (scharfe_ecken or []):                  # Punkt-Crease: Spitze an der Ecke, Kanten bleiben glatt
        if 0 <= int(v_) < len(ecke_scharf):
            ecke_scharf[int(v_)] = True
    if glatt:
        kp_rand, kp_quer = _g1_kanten(E, EN, K, schluessel, _glatte_normalen(X, T), scharf, ecke_scharf)
        _g1_flaeche.schluessel = schluessel

    def rand(a, b, feld=None):
        r = (E if feld is None else feld)[schluessel[(min(a, b), max(a, b))]]
        return r if a < b else r[::-1]

    flaechen_liste = []

    def wenn(i):
        return fortschritt(i) if fortschritt else None

    sewing = BRepBuilderAPI_Sewing(1e-4 * max(1.0, float(np.ptp(X, axis=0).max())))
    fehlgeschlagen = 0
    u = t[:, None, None]
    v = t[None, :, None]
    for fi, (c0, c1, c2, c3) in enumerate(F.tolist()):
        unten, oben = rand(c0, c1), rand(c3, c2)          # v = 0 / 1, laufen in u
        links, rechts = rand(c0, c3), rand(c1, c2)        # u = 0 / 1, laufen in v
        G = ((1 - v) * unten[:, None, :] + v * oben[:, None, :]
             + (1 - u) * links[None, :, :] + u * rechts[None, :, :]
             - ((1 - u) * (1 - v) * V[c0] + u * (1 - v) * V[c1] + u * v * V[c2] + (1 - u) * v * V[c3]))
        GN = ((1 - u) * (1 - v) * VN[c0] + u * (1 - v) * VN[c1] + u * v * VN[c2] + (1 - u) * v * VN[c3])
        G[1:-1, 1:-1] = proj.entlang(G[1:-1, 1:-1], GN[1:-1, 1:-1], weit)
        G[:, 0], G[:, -1], G[0, :], G[-1, :] = unten, oben, links, rechts
        try:
            if glatt:
                s = _g1_flaeche(G, (c0, c1, c2, c3), kp_rand, kp_quer)
            else:
                s = _flaeche(G)
            flaechen_liste.append((s, (c0, c1, c2, c3)))
        except Exception:
            fehlgeschlagen += 1
        if fi % 50 == 0:
            wenn(fi / len(F))
    if glatt and ecken_ausgleichen:
        info_ecken = _ecken_ausgleichen(flaechen_liste, F, ecke_scharf, kante_mittel)
    else:
        info_ecken = {}
    for s, _ in flaechen_liste:
        try:
            sewing.Add(BRepBuilderAPI_MakeFace(s, 1e-6).Face())
        except Exception:
            fehlgeschlagen += 1
    sewing.Perform()
    genaeht = sewing.SewedShape()
    info = {"vierecke": int(len(F)), "fehlgeschlagen": fehlgeschlagen, "freie_kanten": int(sewing.NbFreeEdges())}
    info.update(info_ecken)
    scharf_menge = {(int(a), int(b)) for (a, b) in K[scharf]}
    info.update(_knicke(flaechen_liste, ausnahmen=scharf_menge))
    info["scharfe_kanten"] = int(scharf.sum())
    info["kantig"] = bool(scharf.sum() > 0.05 * len(K))
    shape = genaeht
    info["geschlossen"] = False
    if sewing.NbFreeEdges() == 0:
        ex = TopExp_Explorer(genaeht, TopAbs_SHELL)
        if ex.More():
            mk = BRepBuilderAPI_MakeSolid(TopoDS.Shell_s(ex.Current()))
            if mk.IsDone():
                fix = ShapeFix_Solid(mk.Solid())
                fix.Perform()
                shape = fix.Solid()
                info["geschlossen"] = True
    info["dauer"] = round(time.time() - t0, 2)
    info["quad"] = (V, F)
    return shape, info


# --- G1: gemeinsames Kontrollnetz an den Kanten -------------------------------------------------------
# Kontrollpunkte je Richtung (kubisch). Innere Knoten naeher an den Ecken (0,15 / 0,85): die Drillpunkte an
# Ecken mit 3 oder 5 Nachbarflaechen koennen G1 zu beiden Kanten nicht exakt erfuellen - die engere erste
# Knotenspanne haelt den Restknick naeher an der Ecke (Torus: max 16,6 -> 9,1 Grad, bei 25 % 6,5 -> 0,9).
# Enger als ~0,1 wird instabil (0,05: Knicke > 80 Grad).
_INNEN = (0.15, 0.35, 0.5, 0.65, 0.85)
M_KP = len(_INNEN) + 4
_KNOTEN = np.r_[[0.0] * 4, _INNEN, [1.0] * 4]


def _basis(t, m=M_KP, p=3, knoten=_KNOTEN):
    """B-Spline-Basis (len(t), m) nach Cox-de Boor."""
    t = np.clip(np.asarray(t, float), 0, 1 - 1e-12)
    N = np.zeros((len(t), len(knoten) - 1))
    for i in range(len(knoten) - 1):
        N[:, i] = (knoten[i] <= t) & (t < knoten[i + 1])
    for k in range(1, p + 1):
        neu = np.zeros((len(t), len(knoten) - 1 - k))
        for i in range(len(knoten) - 1 - k):
            a = knoten[i + k] - knoten[i]
            b = knoten[i + k + 1] - knoten[i + 1]
            if a > 0:
                neu[:, i] += (t - knoten[i]) / a * N[:, i]
            if b > 0:
                neu[:, i] += (knoten[i + k + 1] - t) / b * N[:, i + 1]
        N = neu
    return N[:, :m]


def scharfe_kanten(V, F, K, schluessel, proj=None, grenze=35.0):
    """Kante scharf, wenn die Scan-Normalen dicht links und rechts der Kantenmitte (je 15 % des
    Wegs zur Viereckmitte) mehr als grenze Grad auseinanderliegen (Bauteilkante) - dort wird
    nicht geglaettet. Ohne Projektor: Normalen der beiden Vierecke (grob)."""
    mitte_f = V[F].mean(1)
    nachbarn = [[] for _ in range(len(K))]
    for fi, (c0, c1, c2, c3) in enumerate(F.tolist()):
        for a, b in ((c0, c1), (c1, c2), (c2, c3), (c3, c0)):
            nachbarn[schluessel[(min(a, b), max(a, b))]].append(fi)
    paare = [(k, fs[0], fs[1]) for k, fs in enumerate(nachbarn) if len(fs) == 2]
    scharf = np.zeros(len(K), bool)
    if paare:
        kk = np.array([p[0] for p in paare])
        fa = np.array([p[1] for p in paare])
        fb = np.array([p[2] for p in paare])
        km = 0.5 * (V[K[kk, 0]] + V[K[kk, 1]])
        if proj is not None:
            _, na = proj.mit_normale(km + 0.15 * (mitte_f[fa] - km))
            _, nb = proj.mit_normale(km + 0.15 * (mitte_f[fb] - km))
        else:
            qn = np.cross(V[F[:, 2]] - V[F[:, 0]], V[F[:, 3]] - V[F[:, 1]])
            na, nb = qn[fa], qn[fb]
        na = na / np.maximum(np.linalg.norm(na, axis=1, keepdims=True), 1e-12)
        nb = nb / np.maximum(np.linalg.norm(nb, axis=1, keepdims=True), 1e-12)
        scharf[kk] = np.einsum("ij,ij->i", na, nb) < np.cos(np.radians(grenze))
    ecke_scharf = np.zeros(len(V), bool)
    ecke_scharf[K[scharf].ravel()] = True
    return scharf, ecke_scharf


def _g1_kanten(E, EN, K, schluessel, normale, scharf=None, ecke_scharf=None):
    """Je Kante: Kontrollpunkte der Randkurve (an die Abtastpunkte angepasst, Enden fest) und
    Querrichtung je Kontrollpunkt (in der Tangentialebene, senkrecht zur Kante). Beide Nachbarn
    setzen ihre zweite Kontrollreihe entlang +-Querrichtung -> G1 entlang der ganzen Kante."""
    n = E.shape[1]
    t = np.linspace(0, 1, n)
    B = _basis(t)
    innen = slice(1, M_KP - 1)
    rand = np.zeros((len(K), M_KP, 3))
    for k in range(len(K)):
        P = E[k]
        rest = P - np.outer(B[:, 0], P[0]) - np.outer(B[:, -1], P[-1])
        cp = np.linalg.lstsq(B[:, innen], rest, rcond=None)[0]
        rand[k] = np.r_[P[:1], cp, P[-1:]]
    # Normalen an den Kontrollpunkten (Bezug: interpolierte Scan-Normale)
    bezug = EN[:, np.linspace(0, n - 1, M_KP).round().astype(int)]
    N = normale(rand, bezug)
    # ecknahe Kontrollpunkte in die Tangentialebene der Ecke: alle Flaechen an einer Ecke
    # bekommen dort dieselbe Normale (die Ecknormale ist fuer jede Kante dieselbe)
    for i_rand, i_nah, ende in ((0, 1, 0), (M_KP - 1, M_KP - 2, 1)):
        d = rand[:, i_nah] - rand[:, i_rand]
        nn = N[:, i_rand]
        neu = rand[:, i_nah] - np.einsum("ij,ij->i", d, nn)[:, None] * nn
        ok = np.ones(len(K), bool) if ecke_scharf is None else ~ecke_scharf[K[:, ende]]
        rand[ok, i_nah] = neu[ok]
    tang = np.gradient(rand, axis=1)
    quer = np.cross(N, tang)
    quer /= np.maximum(np.linalg.norm(quer, axis=2, keepdims=True), 1e-12)
    if scharf is not None:
        quer[scharf] = np.nan                      # scharfe Kante: zweite Reihe frei einpassen
    return rand, quer


def _g1_flaeche(G, ecken, kp_rand, kp_quer, schluessel=None):
    from OCP.Geom import Geom_BSplineSurface
    from OCP.TColgp import TColgp_Array2OfPnt
    from OCP.TColStd import TColStd_Array1OfInteger, TColStd_Array1OfReal
    from OCP.gp import gp_Pnt
    c0, c1, c2, c3 = ecken
    sch = _g1_flaeche.schluessel

    def kante(a, b):
        i = sch[(min(a, b), max(a, b))]
        r, q = kp_rand[i], kp_quer[i]
        return (r, q) if a < b else (r[::-1], q[::-1])
    m = M_KP
    Q = np.full((m, m, 3), np.nan)
    seiten = [(kante(c0, c1), "u", 0), (kante(c3, c2), "u", m - 1), (kante(c0, c3), "v", 0), (kante(c1, c2), "v", m - 1)]
    for (r, _), art, idx in seiten:
        if art == "u":
            Q[:, idx] = r
        else:
            Q[idx, :] = r
    mitte = G.reshape(-1, 3).mean(0)
    zweite = {}
    for (r, q), art, idx in seiten:
        if np.isnan(q).any():
            continue
        innen_idx = 1 if idx == 0 else m - 2
        # Laenge quer ueber die Flaeche -> Betrag der Querableitung
        gegen = Q[:, m - 1 - idx] if art == "u" else Q[m - 1 - idx, :]
        L = float(np.mean(np.linalg.norm(gegen - r, axis=1)))
        vz = np.sign((mitte - r.mean(0)) @ q[m // 2]) or 1.0
        reihe = r + vz * q * (L * _INNEN[0] / 3)
        for i in range(1, m - 1):
            pos = (i, innen_idx) if art == "u" else (innen_idx, i)
            zweite.setdefault(pos, []).append(reihe[i])
    for pos, werte in zweite.items():
        Q[pos] = np.mean(werte, axis=0)              # Ecken (1,1) …: Mittel beider Kanten
    # Drillpunkte (1,1) … in die Ebene durch Ecke und ihre beiden Nachbar-Kontrollpunkte
    for (ci, cj), (di, dj) in (((0, 0), (1, 1)), ((m - 1, 0), (-1, 1)), ((0, m - 1), (1, -1)), ((m - 1, m - 1), (-1, -1))):
        if np.isnan(Q[ci + di, cj + dj, 0]):
            continue                                 # an scharfen Kanten frei eingepasst
        ecke = Q[ci, cj]
        a_ = Q[ci + di, cj] - ecke
        b_ = Q[ci, cj + dj] - ecke
        nn = np.cross(a_, b_)
        if np.linalg.norm(nn) > 1e-12:
            nn /= np.linalg.norm(nn)
            q = Q[ci + di, cj + dj]
            Q[ci + di, cj + dj] = q - ((q - ecke) @ nn) * nn
    # restliches Inneres an die Rasterpunkte anpassen
    n = G.shape[0]
    Bt = _basis(np.linspace(0, 1, n))
    frei = [(i, j) for i in range(m) for j in range(m) if np.isnan(Q[i, j, 0])]
    if frei:
        bekannt = np.nan_to_num(Q)
        A = np.einsum("ai,bj->abij", Bt, Bt).reshape(n * n, m * m)
        fix = A @ bekannt.reshape(m * m, 3)
        spalten = [i * m + j for i, j in frei]
        loes = np.linalg.lstsq(A[:, spalten], G.reshape(-1, 3) - fix, rcond=None)[0]
        for (i, j), p in zip(frei, loes):
            Q[i, j] = p
    pole = TColgp_Array2OfPnt(1, m, 1, m)
    for i in range(m):
        for j in range(m):
            pole.SetValue(i + 1, j + 1, gp_Pnt(*map(float, Q[i, j])))
    kn = np.unique(_KNOTEN)
    knoten = TColStd_Array1OfReal(1, len(kn))
    vielf = TColStd_Array1OfInteger(1, len(kn))
    for i, k in enumerate(kn):
        knoten.SetValue(i + 1, float(k))
        vielf.SetValue(i + 1, 4 if i in (0, len(kn) - 1) else 1)
    return Geom_BSplineSurface(pole, knoten, knoten, vielf, vielf, 3, 3)


def _knicke(flaechen_liste, anteile=(0.1, 0.25, 0.5), ausnahmen=()):
    """Knickwinkel (Grad) zwischen Nachbarflaechen an Stellen entlang jeder gemeinsamen Kante
    (Anteil ab der kleineren Ecken-Nummer). knick_mitte nur in der Kantenmitte."""
    from OCP.gp import gp_Pnt, gp_Vec
    seiten = {}
    for s, (c0, c1, c2, c3) in flaechen_liste:
        u0, u1, v0, v1 = s.Bounds()
        for (a, b), art, fest in (((c0, c1), "u", v0), ((c3, c2), "u", v1), ((c0, c3), "v", u0), ((c1, c2), "v", u1)):
            werte = []
            for f in anteile:
                g = f if a < b else 1 - f
                u, v = (u0 + g * (u1 - u0), fest) if art == "u" else (fest, v0 + g * (v1 - v0))
                p, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
                s.D1(u, v, p, du, dv)
                nv = du.Crossed(dv)
                werte.append(None if nv.Magnitude() < 1e-12 else np.array([nv.X(), nv.Y(), nv.Z()]) / nv.Magnitude())
            seiten.setdefault((min(a, b), max(a, b)), []).append(werte)
    alle, mitte = [], []
    for schl, ns in seiten.items():
        if len(ns) != 2 or schl in ausnahmen:
            continue
        for k, f in enumerate(anteile):
            if ns[0][k] is None or ns[1][k] is None:
                continue
            w = float(np.degrees(np.arccos(np.clip(abs(ns[0][k] @ ns[1][k]), -1, 1))))
            alle.append(w)
            if f == 0.5:
                mitte.append(w)
    if not alle:
        return {"knick_max": 0.0, "knick_mittel": 0.0, "knick_mitte_max": 0.0}
    return {"knick_max": round(max(alle), 2), "knick_mittel": round(float(np.mean(alle)), 3),
            "knick_mitte_max": round(max(mitte), 3) if mitte else 0.0,
            "knick_p95": round(float(np.percentile(alle, 95)), 3)}


# --- Flaeche auf Punktauswahl -------------------------------------------------------------------------
def flaeche_einpassen(P, raster=None, verlaengern=0.1, glaettung=0):
    """Punktauswahl -> B-Spline-Flaeche (Hoehenfeld ueber der Ausgleichsebene).
    verlaengern = Anteil der Ausdehnung, um den die Flaeche ueber den Rand hinaus geht
    (zum Beschneiden von Koerpern). glaettung = Glaettungsdurchgaenge des Hoehenrasters."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
    from OCP.GeomAPI import GeomAPI_PointsToBSplineSurface
    from OCP.GeomAbs import GeomAbs_C2
    from OCP.TColgp import TColgp_Array2OfPnt
    from OCP.gp import gp_Pnt
    P = np.asarray(P, np.float64)
    if len(P) < 30:
        raise ValueError("Für eine Fläche bitte mehr Punkte auswählen (mindestens 30).")
    c = P.mean(0)
    _, sv, vt = np.linalg.svd(P - c, full_matrices=False)
    u_a, v_a, n_a = vt[0], vt[1], vt[2]
    q = (P - c) @ np.c_[u_a, v_a, n_a]
    lo, hi = q[:, :2].min(0), q[:, :2].max(0)
    spanne = hi - lo
    # praktisch eben -> echte Ebene (exakt, und Verschneidungen damit sind schnell)
    if float(np.percentile(np.abs(q[:, 2]), 98)) <= max(0.03, 2e-4 * float(spanne.max())):
        from OCP.gp import gp_Dir as _D, gp_Pln, gp_Pnt as _P, gp_Ax3
        rand = verlaengern * spanne
        m2 = 0.5 * (lo + hi)
        mitte = c + m2[0] * u_a + m2[1] * v_a
        pln = gp_Pln(gp_Ax3(_P(*map(float, mitte)), _D(*map(float, n_a)), _D(*map(float, u_a))))
        h = 0.5 * spanne + rand
        face = BRepBuilderAPI_MakeFace(pln, -float(h[0]), float(h[0]), -float(h[1]), float(h[1])).Face()
        return face, {"raster": [0, 0], "punkte": int(len(P)), "normale": n_a.tolist(), "mitte": mitte.tolist(),
                      "zelle": 0.0, "eben": True}
    if raster is None:
        raster = int(np.clip(np.sqrt(len(P)) / 3, 8, 40))
    zelle = float(max(spanne) / (int(raster) - 1))
    # Raster ueber den Rand hinaus (verlaengern), gleich grosse Zellen
    rand = verlaengern * spanne
    nu = int(np.ceil((spanne[0] + 2 * rand[0]) / zelle)) + 1
    nv = int(np.ceil((spanne[1] + 2 * rand[1]) / zelle)) + 1
    gu = lo[0] - rand[0] + zelle * np.arange(nu)
    gv = lo[1] - rand[1] + zelle * np.arange(nv)
    from .o3d import o3d
    baum = o3d.geometry.KDTreeFlann(o3d.geometry.PointCloud(o3d.utility.Vector3dVector(np.c_[q[:, :2], np.zeros(len(q))])))
    H = np.full((nu, nv), np.nan)
    for i, x in enumerate(gu):
        for j, y in enumerate(gv):
            k, idx, d2 = baum.search_radius_vector_3d([x, y, 0.0], 1.6 * zelle)
            if k < 8:
                continue
            Q = q[np.asarray(idx)]
            dx, dy = Q[:, 0] - x, Q[:, 1] - y
            w = np.sqrt(np.exp(-np.asarray(d2) / (zelle * zelle)))
            # lokale quadratische Ausgleichsflaeche: Wert im Knoten = Absolutglied
            # (Mittelwert wuerde Wellenberge um die Kruemmung abflachen)
            # quadratisch nur, wenn der Knoten von Punkten umgeben ist - einseitig (Rand) extrapoliert die
            # Parabel wild (ein Feld lieferte > 1000 mm Hoehe); dort reicht die Ausgleichsebene
            umringt = dx.min() < 0 < dx.max() and dy.min() < 0 < dy.max()
            A = np.c_[np.ones(k), dx, dy, dx * dx, dx * dy, dy * dy] if k >= 12 and umringt else np.c_[np.ones(k), dx, dy]
            try:
                koef = np.linalg.lstsq(A * w[:, None], Q[:, 2] * w, rcond=None)[0]
                H[i, j] = koef[0]
            except np.linalg.LinAlgError:
                H[i, j] = float(np.average(Q[:, 2], weights=w))
    if np.isnan(H).all():
        raise ValueError("Die Auswahl ist zu dünn für ein Raster.")
    for _ in range(nu + nv):
        leer = np.isnan(H)
        if not leer.any():
            break
        neu_h = np.full_like(H, np.nan)
        summe = np.zeros_like(H)
        anzahl = np.zeros_like(H)
        for ax, vz in ((0, 1), (0, -1), (1, 1), (1, -1)):
            h1 = np.roll(H, vz, axis=ax)
            h2 = np.roll(H, 2 * vz, axis=ax)
            # Rand nicht umlaufen lassen
            if ax == 0:
                if vz == 1:
                    h1[:1], h2[:2] = np.nan, np.nan
                else:
                    h1[-1:], h2[-2:] = np.nan, np.nan
            else:
                if vz == 1:
                    h1[:, :1], h2[:, :2] = np.nan, np.nan
                else:
                    h1[:, -1:], h2[:, -2:] = np.nan, np.nan
            lin = 2 * h1 - h2                          # linear fortsetzen
            wert = np.where(np.isnan(lin), h1, lin)
            ok = ~np.isnan(wert)
            summe[ok] += wert[ok]
            anzahl[ok] += 1
        mit = leer & (anzahl > 0)
        neu_h[mit] = summe[mit] / anzahl[mit]
        H = np.where(mit, neu_h, H)
    # Verlaengerung bleibt in der Naehe der Daten (lineares Fortsetzen ueber viele Zellen kann aufschaukeln)
    zlo, zhi = float(q[:, 2].min()), float(q[:, 2].max())
    rand_h = (zhi - zlo) + float(max(rand.max(), zelle))
    H = np.clip(H, zlo - rand_h, zhi + rand_h)
    for _ in range(int(glaettung)):
        P_ = np.pad(H, 1, mode="edge")
        H = 0.5 * H + 0.125 * (P_[:-2, 1:-1] + P_[2:, 1:-1] + P_[1:-1, :-2] + P_[1:-1, 2:])
    arr = TColgp_Array2OfPnt(1, nu, 1, nv)
    for i in range(nu):
        for j in range(nv):
            p = c + gu[i] * u_a + gv[j] * v_a + H[i, j] * n_a
            arr.SetValue(i + 1, j + 1, gp_Pnt(*map(float, p)))
    # bikubisch (Grad 3): hoehere Grade machen spaetere Verschneidungen (Koerper aus Flaechen) sehr langsam
    f = GeomAPI_PointsToBSplineSurface(arr, 3, 3, GeomAbs_C2, max(0.002, 0.004 * zelle))
    if not f.IsDone():
        raise ValueError("Flächeneinpassung fehlgeschlagen.")
    s = f.Surface()
    u0, u1, v0, v1 = s.Bounds()
    face = BRepBuilderAPI_MakeFace(s, u0, u1, v0, v1, 1e-6).Face()
    d = (P - c) @ n_a
    info = {"raster": [nu, nv], "punkte": int(len(P)), "normale": n_a.tolist(), "mitte": c.tolist(),
            "zelle": round(zelle, 3)}
    return face, info


def flaeche_abweichung(face, P):
    """Abstand der Punkte zur Flaeche (mm) - fuer die Anzeige/Kennwerte."""
    from . import koerper as kp
    return kp.abweichung([face], P)


def koerper_schneiden(shape, face, behalten="unten"):
    """Koerper mit einer (verlaengerten) Flaeche teilen und eine Seite behalten.
    'oben' = Seite, in die die Flaechennormale zeigt."""
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeHalfSpace
    from OCP.gp import gp_Pnt, gp_Vec
    from OCP.TopAbs import TopAbs_REVERSED
    from OCP.TopoDS import TopoDS
    f = TopoDS.Face_s(face)
    a = BRepAdaptor_Surface(f)
    um = 0.5 * (a.FirstUParameter() + a.LastUParameter())
    vm = 0.5 * (a.FirstVParameter() + a.LastVParameter())
    p, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
    a.D1(um, vm, p, du, dv)
    n = du.Crossed(dv)
    if f.Orientation() == TopAbs_REVERSED:
        n.Reverse()
    n.Normalize()
    # Halbraum auf der Seite, die WEG soll
    s = 1.0 if behalten == "unten" else -1.0
    ref = gp_Pnt(p.X() + s * n.X() * 1e3, p.Y() + s * n.Y() * 1e3, p.Z() + s * n.Z() * 1e3)
    weg = BRepPrimAPI_MakeHalfSpace(f, ref).Solid()
    op = BRepAlgoAPI_Cut(shape, weg)
    if not op.IsDone():
        raise ValueError("Beschneiden mit der Fläche ist fehlgeschlagen.")
    erg = op.Shape()
    from . import koerper as kp
    if kp.kennwerte(erg)["volumen"] < 1e-6:
        raise ValueError("Nach dem Beschneiden bleibt nichts übrig – andere Seite behalten?")
    return erg


# === Freiform von Hand (v1.0): Raster-Kaefig, Wrap, feiner, glaetten, Symmetrie, eine Flaeche ===========
def _raster_flaechen(nu, nv, offset=0, umlaufend=False):
    F = []
    breite = nv + 1
    for i in range(nu):
        for j in range(nv):
            a = i * breite + j
            i2 = (i + 1) % (nu if umlaufend else nu + 1)
            b = i2 * breite + j
            F.append([a + offset, b + offset, b + 1 + offset, a + 1 + offset])
    return np.array(F, np.int64)


def kaefig_auf_auswahl(P, X, T, nu=6, nv=6):
    """New Freeform: rechteckiges Vierecksraster ueber der Ausgleichsebene der Auswahl, auf den Scan gelegt.
    -> (V, F, raster=(nu, nv))."""
    P = np.asarray(P, float)
    if len(P) < 20:
        raise ValueError("Für eine Freiformfläche bitte einen Bereich auswählen.")
    c = P.mean(0)
    _, _, vt = np.linalg.svd(P - c, full_matrices=False)
    q = (P - c) @ vt[:2].T
    lo, hi = np.percentile(q, 1, axis=0), np.percentile(q, 99, axis=0)
    V = np.array([c + (lo[0] + (hi[0] - lo[0]) * i / nu) * vt[0] + (lo[1] + (hi[1] - lo[1]) * j / nv) * vt[1]
                  for i in range(nu + 1) for j in range(nv + 1)])
    proj = _Projektor(X, T)
    weit = float(np.max(hi - lo))
    V = proj.entlang(V, np.repeat(vt[2][None], len(V), 0), weit)
    return V, _raster_flaechen(nu, nv), (nu, nv)


def kaefig_wrap(P, X, T, n_um=12, n_lang=6):
    """Wrap Surface: Zylinder in die Auswahl einpassen, Kaefig ringsum (geschlossen in Umfangsrichtung)."""
    from .formen import zylinder
    P = np.asarray(P, float)
    z = zylinder(P)
    a = np.asarray(z["achse"], float) / np.linalg.norm(z["achse"])
    p0 = np.asarray(z["punkt"], float)
    t = (P - p0) @ a
    t0, t1 = np.percentile(t, 1), np.percentile(t, 99)
    h = np.array([1.0, 0, 0]) if abs(a[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = np.cross(a, h); e1 /= np.linalg.norm(e1)
    e2 = np.cross(a, e1)
    V, N = [], []
    for i in range(n_um):
        w = 2 * np.pi * i / n_um
        rad = np.cos(w) * e1 + np.sin(w) * e2
        for j in range(n_lang + 1):
            V.append(p0 + a * (t0 + (t1 - t0) * j / n_lang) + rad * z["radius"])
            N.append(rad)
    V, N = np.array(V), np.array(N)
    V = _Projektor(X, T).entlang(V, N, 0.8 * z["radius"])
    return V, _raster_flaechen(n_um, n_lang, umlaufend=True), (n_um, n_lang)


def kaefig_feiner(V, F, X=None, T=None):
    """Increase Resolution: jedes Viereck -> 4 (Kanten- und Flaechenmitten), auf den Scan gelegt."""
    V = np.asarray(V, float)
    F = np.asarray(F, np.int64)
    neuV = list(V)
    kanten = {}

    def mitte(a, b):
        k = (min(a, b), max(a, b))
        if k not in kanten:
            kanten[k] = len(neuV)
            neuV.append(0.5 * (V[a] + V[b]))
        return kanten[k]
    neuF = []
    for c0, c1, c2, c3 in F.tolist():
        m01, m12, m23, m30 = mitte(c0, c1), mitte(c1, c2), mitte(c2, c3), mitte(c3, c0)
        z = len(neuV)
        neuV.append(V[[c0, c1, c2, c3]].mean(0))
        neuF += [[c0, m01, z, m30], [m01, c1, m12, z], [z, m12, c2, m23], [m30, z, m23, c3]]
    neuV = np.array(neuV)
    if X is not None:
        neuV[len(V):] = _Projektor(X, T)(neuV[len(V):])
    return neuV, np.array(neuF, np.int64)


def kaefig_glaetten(V, F, X=None, T=None, ids=None, staerke=0.5, schritte=2):
    """Smooth: Ecken zum Mittel ihrer Nachbarn ziehen (Randecken bleiben), danach auf den Scan."""
    V = np.asarray(V, float).copy()
    F = np.asarray(F, np.int64)
    nb = [set() for _ in range(len(V))]
    kz = {}
    for f in F.tolist():
        for a, b in zip(f, f[1:] + f[:1]):
            nb[a].add(b); nb[b].add(a)
            k = (min(a, b), max(a, b)); kz[k] = kz.get(k, 0) + 1
    rand = set(x for k, n in kz.items() if n == 1 for x in k)
    wahl = set(range(len(V))) if ids is None else set(int(i) for i in ids)
    for _ in range(schritte):
        neu = V.copy()
        for i in wahl:
            if i in rand or not nb[i]:
                continue
            neu[i] = (1 - staerke) * V[i] + staerke * V[list(nb[i])].mean(0)
        V = neu
    if X is not None:
        V = _Projektor(X, T)(V)
    return V


def kaefig_symmetrisch(V, F, punkt, normale, toleranz=None):
    """Symmetrie: Viereck-Haelfte auf der Seite der Normale behalten, an der Ebene spiegeln, Ecken nahe der
    Ebene auf die Ebene setzen und verschweissen (Set on Symmetry Plane)."""
    V = np.asarray(V, float)
    F = np.asarray(F, np.int64)
    n = np.asarray(normale, float) / np.linalg.norm(normale)
    p = np.asarray(punkt, float)
    d = (V - p) @ n
    kante = float(np.mean(np.linalg.norm(V[F[:, 0]] - V[F[:, 1]], axis=1)))
    tol = toleranz or 0.35 * kante
    behalten = F[(d[F].mean(1) > 0)]
    if not len(behalten):
        raise ValueError("Auf der Seite der Ebene liegt kein Käfig.")
    ids = np.unique(behalten)
    V2 = V.copy()
    auf = np.abs(d) <= tol
    V2[auf] = V[auf] - d[auf, None] * n
    alt_neu = {int(i): k for k, i in enumerate(ids)}
    VA = V2[ids]
    gesp = VA - 2 * ((VA - p) @ n)[:, None] * n
    VB_index = {}
    neuV = list(VA)
    for k, i in enumerate(ids):
        if auf[i]:
            VB_index[int(i)] = k                       # Ecke auf der Ebene: geteilt
        else:
            VB_index[int(i)] = len(neuV)
            neuV.append(gesp[k])
    FA = [[alt_neu[int(x)] for x in f] for f in behalten]
    FB = [[VB_index[int(x)] for x in f[::-1]] for f in behalten]     # gespiegelt: Umlauf umkehren
    return np.array(neuV), np.array(FA + FB, np.int64)


def raster_eine_flaeche(V, raster, X, T, umlaufend=False):
    """Merge: Raster-Kaefig (nu x nv) als EINE B-Spline-Flaeche (Kaefig 3x verfeinert, auf den Scan gelegt)."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
    from OCP.GeomAPI import GeomAPI_PointsToBSplineSurface
    from OCP.GeomAbs import GeomAbs_C2
    from OCP.TColgp import TColgp_Array2OfPnt
    from OCP.gp import gp_Pnt
    if umlaufend:
        raise ValueError("Ein umlaufender Käfig wird als mehrere Flächen gebaut.")
    nu, nv = raster
    G = np.asarray(V, float).reshape(nu + 1, nv + 1, 3)
    k = 4
    uu = np.linspace(0, nu, nu * k + 1)
    vv = np.linspace(0, nv, nv * k + 1)
    def bilinear(u, v):
        i, j = min(int(u), nu - 1), min(int(v), nv - 1)
        s, t = u - i, v - j
        return (1 - s) * (1 - t) * G[i, j] + s * (1 - t) * G[i + 1, j] + s * t * G[i + 1, j + 1] + (1 - s) * t * G[i, j + 1]
    D = np.array([[bilinear(u, v) for v in vv] for u in uu])
    D = _Projektor(X, T)(D)
    arr = TColgp_Array2OfPnt(1, D.shape[0], 1, D.shape[1])
    for i in range(D.shape[0]):
        for j in range(D.shape[1]):
            arr.SetValue(i + 1, j + 1, gp_Pnt(*map(float, D[i, j])))
    s = GeomAPI_PointsToBSplineSurface(arr, 3, 3, GeomAbs_C2, 0.005).Surface()
    a, b, c, d = s.Bounds()
    return BRepBuilderAPI_MakeFace(s, a, b, c, d, 1e-6).Face()


def obj_kaefig(text):
    """Quad-OBJ (v/f) -> Kaefig (V, F); Dreiecke werden abgelehnt."""
    V, F = [], []
    for zeile in text.splitlines():
        t = zeile.split()
        if not t:
            continue
        if t[0] == "v":
            V.append([float(x) for x in t[1:4]])
        elif t[0] == "f":
            idx = [int(x.split("/")[0]) for x in t[1:]]
            idx = [i - 1 if i > 0 else len(V) + i for i in idx]
            if len(idx) != 4:
                raise ValueError("Die OBJ-Datei enthält Nicht-Vierecke – bitte als reines Quad-Netz exportieren.")
            F.append(idx)
    if not F:
        raise ValueError("Keine Vierecke in der OBJ-Datei.")
    return np.array(V, float), np.array(F, np.int64)


# --- Freiform-Editor (v1.2): Topologie-Operationen auf dem Vierecks-Kaefig --------------------------------
# Alle Funktionen arbeiten auf (V, F) und liefern zusaetzlich eine Ecken-Zuordnung alt -> neu (-1 = entfallen),
# damit die Oberflaeche ihre scharfen Kanten / Auswahl umnummerieren kann.

def _kanten_flaechen(F):
    kf = {}
    for fi, f in enumerate(F.tolist()):
        for k in range(4):
            a, b = f[k], f[(k + 1) % 4]
            kf.setdefault((min(a, b), max(a, b)), []).append((fi, k))
    return kf


def _flaechen_normale(V, f):
    n = np.cross(V[f[2]] - V[f[0]], V[f[3]] - V[f[1]])
    return n / max(np.linalg.norm(n), 1e-12)


def ecken_normalen(V, F):
    N = np.zeros_like(V, dtype=float)
    for f in F.tolist():
        n = _flaechen_normale(V, f)
        N[f] += n
    return N / np.maximum(np.linalg.norm(N, axis=1), 1e-12)[:, None]


def kaefig_kompakt(V, F):
    """Unbenutzte Ecken entfernen -> (V, F, zuordnung alt->neu)."""
    benutzt = np.unique(F) if len(F) else np.zeros(0, np.int64)
    z = -np.ones(len(V), np.int64)
    z[benutzt] = np.arange(len(benutzt))
    return np.asarray(V, float)[benutzt], z[F] if len(F) else F, z


def kaefig_rand(F):
    """Randkanten (nur einem Viereck zugeordnet) als Menge (min, max)."""
    return {k for k, l in _kanten_flaechen(np.asarray(F, np.int64)).items() if len(l) == 1}


def kaefig_extrudieren(V, F, kanten, laenge=None):
    """Extrude-Handle: Randkanten um laenge (Standard: mittlere Kantenlaenge) in der Flaechenebene nach aussen
    ziehen; zusammenhaengende Kanten teilen sich die neuen Ecken."""
    V = np.asarray(V, float)
    F = np.asarray(F, np.int64)
    kf = _kanten_flaechen(F)
    if laenge is None:
        laenge = float(np.mean(np.linalg.norm(V[F] - V[np.roll(F, -1, axis=1)], axis=2)))
    neuV, neuF = list(V), F.tolist()
    aussen = {}
    gerichtet = []
    for a, b in kanten:
        k = (min(a, b), max(a, b))
        l = kf.get(k)
        if not l or len(l) != 1:
            raise ValueError("Extrudieren geht nur an Randkanten (Kante %d–%d liegt innen)." % (a + 1, b + 1))
        fi, pos = l[0]
        f = F[fi].tolist()
        a, b = f[pos], f[(pos + 1) % 4]                  # Umlaufrichtung im Nachbarviereck
        n = _flaechen_normale(V, f)
        e = V[b] - V[a]
        r = np.cross(e, n)
        r /= max(np.linalg.norm(r), 1e-12)
        if (0.5 * (V[a] + V[b]) - V[f].mean(0)) @ r < 0:
            r = -r
        for x in (a, b):
            aussen.setdefault(x, []).append(r)
        gerichtet.append((a, b))
    neu = {}
    for x, rs in aussen.items():
        r = np.mean(rs, axis=0)
        r /= max(np.linalg.norm(r), 1e-12)
        neu[x] = len(neuV)
        neuV.append(V[x] + r * laenge)
    for a, b in gerichtet:
        neuF.append([b, a, neu[a], neu[b]])
    return np.array(neuV), np.array(neuF, np.int64), np.arange(len(V))


def kaefig_bruecke(V, F, k1, k2):
    """Bridge: neues Viereck zwischen zwei Randkanten."""
    V = np.asarray(V, float)
    F = np.asarray(F, np.int64)
    kf = _kanten_flaechen(F)
    paare = []
    for a, b in (k1, k2):
        l = kf.get((min(a, b), max(a, b)))
        if not l or len(l) != 1:
            raise ValueError("Brücke geht nur zwischen Randkanten.")
        f = F[l[0][0]].tolist()
        paare.append((f[l[0][1]], f[(l[0][1] + 1) % 4]))
    (a, b), (c, d) = paare
    if len({a, b, c, d}) < 3:
        raise ValueError("Die Kanten sind gleich.")
    if np.linalg.norm(V[a] - V[d]) + np.linalg.norm(V[b] - V[c]) <= np.linalg.norm(V[a] - V[c]) + np.linalg.norm(V[b] - V[d]):
        q = [b, a, d, c]
    else:
        q = [b, a, c, d]
    if len(set(q)) == 3:
        raise ValueError("Die Kanten teilen eine Ecke – dafür „Verschmelzen“ nehmen.")
    return V, np.vstack([F, [q]]), np.arange(len(V))


def kaefig_verschmelzen(V, F, paare):
    """Merge: Eckenpaare (i, j) auf ihre Mitte zusammenlegen; entartete Vierecke fallen weg."""
    V = np.asarray(V, float).copy()
    F = np.asarray(F, np.int64).copy()
    ziel = np.arange(len(V))

    def wurzel(i):
        while ziel[i] != i:
            i = ziel[i]
        return i
    for i, j in paare:
        i, j = wurzel(int(i)), wurzel(int(j))
        if i == j:
            continue
        V[i] = 0.5 * (V[i] + V[j])
        ziel[j] = i
    w = np.array([wurzel(i) for i in range(len(V))])
    F = w[F]
    F = F[[len(set(f)) == 4 for f in F.tolist()]]
    V2, F2, z = kaefig_kompakt(V, F)
    return V2, F2, np.where(z[w] >= 0, z[w], -1)


def kaefig_schleife(V, F, kante, X=None, T=None):
    """Split: Kantenschleife quer durch den Vierecksstreifen der Kante einfuegen (Kante wird halbiert, ebenso
    alle gegenueberliegenden Kanten des Rings)."""
    V = np.asarray(V, float)
    F = np.asarray(F, np.int64)
    kf = _kanten_flaechen(F)
    a, b = kante
    start = (min(a, b), max(a, b))
    if start not in kf:
        raise ValueError("Diese Kante gehört zu keinem Viereck.")
    ring = {}                                            # Flaeche -> Position der durchquerten Kante (0 oder 1)
    kanten = {start}
    for fi0, pos0 in kf[start]:
        fi, pos = fi0, pos0
        while fi not in ring:
            ring[fi] = pos % 2
            f = F[fi].tolist()
            o = (f[(pos + 2) % 4], f[(pos + 3) % 4])
            ko = (min(o), max(o))
            kanten.add(ko)
            weiter = [x for x in kf[ko] if x[0] != fi]
            if not weiter:
                break
            fi, pos = weiter[0]
    neuV = list(V)
    mitte = {}
    for k in kanten:
        mitte[k] = len(neuV)
        neuV.append(0.5 * (V[k[0]] + V[k[1]]))
    neuF = []
    for fi, f in enumerate(F.tolist()):
        if fi not in ring:
            neuF.append(f)
            continue
        r = ring[fi]
        v0, v1, v2, v3 = f[r:] + f[:r]
        m01 = mitte[(min(v0, v1), max(v0, v1))]
        m23 = mitte[(min(v2, v3), max(v2, v3))]
        neuF += [[v0, m01, m23, v3], [m01, v1, v2, m23]]
    neuV = np.array(neuV)
    if X is not None and len(neuV) > len(V):
        neuV[len(V):] = _Projektor(X, T)(neuV[len(V):])
    return neuV, np.array(neuF, np.int64), np.arange(len(V))


def kaefig_loeschen(V, F, flaechen):
    weg = set(int(i) for i in flaechen)
    F = np.asarray(F, np.int64)
    F = F[[i not in weg for i in range(len(F))]]
    if not len(F):
        raise ValueError("Es würde kein Viereck übrig bleiben.")
    return kaefig_kompakt(V, F)


def kaefig_ausrichten(V, ids):
    """Align: Ecken einer Kette auf die Gerade zwischen der ersten und letzten gewaehlten Ecke legen."""
    V = np.asarray(V, float).copy()
    ids = [int(i) for i in ids]
    if len(ids) < 3:
        raise ValueError("Zum Ausrichten mindestens 3 Ecken wählen (erste und letzte bleiben liegen).")
    p, q = V[ids[0]], V[ids[-1]]
    d = (q - p) / max(np.linalg.norm(q - p), 1e-12)
    for i in ids[1:-1]:
        V[i] = p + ((V[i] - p) @ d) * d
    return V


def kaefig_verschieben(V, F, ids, versatz=(0, 0, 0), normal=0.0):
    """Manipulator numerisch: Welt-Versatz und/oder Abstand entlang der Eckennormale (lokal)."""
    V = np.asarray(V, float).copy()
    ids = np.asarray([int(i) for i in ids], np.int64)
    V[ids] += np.asarray(versatz, float)
    if normal:
        V[ids] += ecken_normalen(V, np.asarray(F, np.int64))[ids] * float(normal)
    return V


def kaefig_unregelmaessig(F):
    """Unregelmaessige Ecken (Extraordinary Vertices): innen nicht 4 Nachbarvierecke, am Rand nicht 2
    (Randecken mit 1 Viereck = Ecke der Flaeche, gilt als regulaer). -> Liste [(ecke, anzahl, rand)]."""
    F = np.asarray(F, np.int64)
    rand = set(x for k in kaefig_rand(F) for x in k)
    zahl = np.bincount(F.ravel(), minlength=int(F.max()) + 1 if len(F) else 0)
    aus = []
    for i, n in enumerate(zahl.tolist()):
        if n == 0:
            continue
        if (i in rand and n not in (1, 2)) or (i not in rand and n != 4):
            aus.append((i, n, i in rand))
    return aus


# --- v1.5: Ausrichten zur Ansicht, Kaefig aus 3D-Skizze, Teilraster als eine Flaeche ------------------------
def kaefig_ausrichten_richtung(V, ids, richtung):
    """Align H/V: gewaehlte Ecken bekommen entlang richtung (z. B. Bildschirm-Hoch = waagrecht ausrichten) den
    Wert der ersten gewaehlten Ecke; quer dazu bleiben sie, wo sie sind."""
    V = np.asarray(V, float).copy()
    ids = [int(i) for i in ids]
    if len(ids) < 2:
        raise ValueError("Mindestens 2 Ecken wählen (die erste gibt die Lage vor).")
    r = np.asarray(richtung, float)
    r /= max(np.linalg.norm(r), 1e-12)
    soll = V[ids[0]] @ r
    for i in ids[1:]:
        V[i] += (soll - V[i] @ r) * r
    return V


def kaefig_aus_kurve(K, X, T, nu=6, nv=6):
    """New Freeform from 3D sketch: geschlossene Kurve -> vier Seiten (an den vier staerksten Knicken, sonst
    nach Bogenlaenge geviertelt) -> Coons-Raster nu x nv, auf den Scan gelegt. -> (V, F, raster)."""
    K = np.asarray(K, float)
    if np.linalg.norm(K[0] - K[-1]) < 1e-9:
        K = K[:-1]
    n = len(K)
    if n < 8:
        raise ValueError("Die 3D-Skizze ist zu kurz für einen Käfig.")
    # Knickwinkel je Punkt
    a, b = K - np.roll(K, 1, 0), np.roll(K, -1, 0) - K
    cosw = np.einsum("ij,ij->i", a, b) / np.maximum(np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1), 1e-12)
    knick = np.arccos(np.clip(cosw, -1, 1))
    ecken = []
    for i in np.argsort(-knick):
        if knick[i] < math.radians(25) or len(ecken) == 4:
            break
        if all(min(abs(i - j), n - abs(i - j)) > n // 10 for j in ecken):
            ecken.append(int(i))
    if len(ecken) < 4:                                   # glatte Kurve: nach Bogenlaenge vierteln
        L = np.r_[0, np.cumsum(np.linalg.norm(np.diff(np.r_[K, K[:1]], axis=0), axis=1))]
        ecken = [int(np.argmin(np.abs(L[:-1] - L[-1] * q))) for q in (0, 0.25, 0.5, 0.75)]
    ecken = sorted(ecken)

    def seite(i, j, m):
        idx = np.arange(i, i + (j - i) % n + 1) % n
        P = K[idx]
        s_ = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
        t = np.linspace(0, s_[-1], m + 1)
        return np.c_[[np.interp(t, s_, P[:, k]) for k in range(3)]].T
    e0, e1, e2, e3 = ecken
    unten = seite(e0, e1, nu)                            # v = 0, u laeuft
    rechts = seite(e1, e2, nv)                           # u = 1, v laeuft
    oben = seite(e3, e2, nu) if False else seite(e2, e3, nu)[::-1]
    links = seite(e3, e0, nv)[::-1]
    G = np.zeros((nu + 1, nv + 1, 3))
    for i in range(nu + 1):
        for j in range(nv + 1):
            s_, t = i / nu, j / nv
            G[i, j] = ((1 - t) * unten[i] + t * oben[i] + (1 - s_) * links[j] + s_ * rechts[j]
                       - ((1 - s_) * (1 - t) * unten[0] + s_ * (1 - t) * unten[-1] + s_ * t * oben[-1] + (1 - s_) * t * oben[0]))
    V = G.reshape(-1, 3)
    innen = np.array([0 < i < nu and 0 < j < nv for i in range(nu + 1) for j in range(nv + 1)])
    if X is not None and innen.any():
        V[innen] = _Projektor(X, T)(V[innen])            # der Rand bleibt auf der Skizze
    return V, _raster_flaechen(nu, nv), (nu, nv)


def kaefig_teilraster(V, F, flaechen):
    """Merge Quads: gewaehlte Vierecke muessen ein Rechteck aus Vierecken bilden -> Eckraster (nu+1)x(nv+1)
    in fester Reihenfolge, fuer raster_eine_flaeche."""
    F = np.asarray(F, np.int64)
    wahl = [int(f) for f in flaechen]
    if not wahl:
        raise ValueError("Vierecke wählen (Modus Vierecke).")
    menge = set(wahl)
    kf = _kanten_flaechen(F)
    RICHT = [(0, -1), (1, 0), (0, 1), (-1, 0)]          # Bewegung ueber Kante k (lokal) = 0 unten, 1 rechts, …
    lage = {wahl[0]: ((0, 0), 0)}
    stapel = [wahl[0]]
    while stapel:
        f = stapel.pop()
        (i, j), rot = lage[f]
        q = F[f].tolist()
        for k in range(4):
            a, b = q[k], q[(k + 1) % 4]
            for g, kg in kf[(min(a, b), max(a, b))]:
                if g == f or g not in menge:
                    continue
                dg = (k + rot) % 4
                di, dj = RICHT[dg]
                rot_g = ((dg + 2) % 4 - kg) % 4
                if g in lage:
                    if lage[g] != ((i + di, j + dj), rot_g):
                        raise ValueError("Die gewählten Vierecke bilden kein sauberes Raster.")
                    continue
                lage[g] = ((i + di, j + dj), rot_g)
                stapel.append(g)
    if len(lage) != len(menge):
        raise ValueError("Die gewählten Vierecke hängen nicht zusammen.")
    pos = np.array([p for p, _ in lage.values()])
    lo = pos.min(0)
    nu, nv = (pos.max(0) - lo + 1).tolist()
    if nu * nv != len(menge):
        raise ValueError("Die gewählten Vierecke bilden kein Rechteck (%d × %d nötig, %d gewählt)." % (nu, nv, len(menge)))
    G = -np.ones((nu + 1, nv + 1), np.int64)
    ECKE = [(0, 0), (1, 0), (1, 1), (0, 1)]              # v0..v3 lokal
    for f, ((i, j), rot) in lage.items():
        for k, v in enumerate(F[f].tolist()):
            x, y = ECKE[k]
            for _ in range(rot):                         # um die Zellmitte drehen (90 Grad gegen den Uhrzeigersinn)
                x, y = 1 - y, x
            gi, gj = i - lo[0] + x, j - lo[1] + y
            if G[gi, gj] not in (-1, v):
                raise ValueError("Die gewählten Vierecke bilden kein sauberes Raster.")
            G[gi, gj] = v
    return np.asarray(V, float)[G.ravel()], (nu, nv)



# --- v1.5: G1 an unregelmaessigen Ecken nachoptimieren ------------------------------------------------------
def _ecken_ausgleichen(flaechen_liste, F, ecke_scharf, kante, anteile=(0.05, 0.12, 0.25), iterationen=3):
    """Je Ecke mit 3, 5 … Nachbarvierecken: Drillpunkt und die beiden Nachbarpole jedes anliegenden Patches
    so verschieben, dass die Normalen beider Seiten entlang der anliegenden Kanten moeglichst gleich sind
    (Gauss-Newton, Verschiebung schwach bestraft). Exaktes G1 gibt es dort mit bikubischen Flaechen nicht -
    der Restknick wird kleiner und sitzt dichter an der Ecke."""
    from OCP.gp import gp_Pnt, gp_Vec
    F = np.asarray(F, np.int64)
    unregel = [i for i, n, r in kaefig_unregelmaessig(F) if not r and not (ecke_scharf is not None and ecke_scharf[i])]
    if not unregel:
        return {"ecken_ausgeglichen": 0}
    an_ecke = {}
    for pi, (s_, ecken) in enumerate(flaechen_liste):
        for k, c in enumerate(ecken):
            an_ecke.setdefault(c, []).append((pi, k))
    m = flaechen_liste[0][0].NbUPoles()
    # Pole je Ecke k (1-basiert): Drillpunkt + Nachbarn in der 2. Reihe
    POLE = {0: [(2, 2), (3, 2), (2, 3)], 1: [(m - 1, 2), (m - 2, 2), (m - 1, 3)],
            2: [(m - 1, m - 1), (m - 2, m - 1), (m - 1, m - 2)], 3: [(2, m - 1), (3, m - 1), (2, m - 2)]}
    SEITEN = (((0, 1), "u", 0), ((3, 2), "u", 1), ((0, 3), "v", 0), ((1, 2), "v", 1))   # (Ecken-Positionen, Richtung, fest)

    def normale(s_, art, fest, g):
        u0, u1, v0, v1 = s_.Bounds()
        u, v = (u0 + g * (u1 - u0), v0 if fest == 0 else v1) if art == "u" else (u0 if fest == 0 else u1, v0 + g * (v1 - v0))
        p, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
        s_.D1(u, v, p, du, dv)
        n = du.Crossed(dv)
        return np.array([n.X(), n.Y(), n.Z()]) / max(n.Magnitude(), 1e-12)
    vorher, nachher, gezaehlt = [], [], 0
    for v in unregel:
        patches = an_ecke.get(v, [])
        if len(patches) < 3:
            continue
        # Kanten an v: je Nachbarecke w die beiden Patches mit ihrer Seite
        kanten = {}
        for pi, k in patches:
            ecken = flaechen_liste[pi][1]
            for (a, b), art, fest in SEITEN:
                if v in (ecken[a], ecken[b]):
                    w = ecken[b] if ecken[a] == v else ecken[a]
                    vom_anfang = ecken[a] == v
                    kanten.setdefault(w, []).append((pi, art, fest, vom_anfang))
        kanten = [x for x in kanten.values() if len(x) == 2]
        if not kanten:
            continue
        var = [(pi, ij) for pi, k in patches for ij in POLE[k]]
        p0 = np.array([[flaechen_liste[pi][0].Pole(*ij).X(), flaechen_liste[pi][0].Pole(*ij).Y(),
                        flaechen_liste[pi][0].Pole(*ij).Z()] for pi, ij in var])

        def setzen(x):
            for (pi, ij), q in zip(var, x.reshape(-1, 3)):
                flaechen_liste[pi][0].SetPole(ij[0], ij[1], gp_Pnt(*map(float, q)))

        def res_kante(e):
            (pa, aa, fa, va), (pb, ab, fb, vb) = e
            r = []
            for f in anteile:
                na = normale(flaechen_liste[pa][0], aa, fa, f if va else 1 - f)
                nb = normale(flaechen_liste[pb][0], ab, fb, f if vb else 1 - f)
                r.extend(np.cross(na, nb if na @ nb >= 0 else -nb))
            return np.asarray(r)

        def res(x):
            setzen(x)
            return np.concatenate([res_kante(e) for e in kanten])
        # ein Pol wirkt nur auf die Kanten seines Patches: nur diese neu rechnen (schnellere Ableitung)
        n_r = 3 * len(anteile)
        betrifft = [[ki for ki, e in enumerate(kanten) if pi in (e[0][0], e[1][0])] for pi, _ in var]
        x0 = p0.ravel().copy()
        lam = 0.02 / max(kante, 1e-9)                  # 1 Kantenlaenge Verschiebung ~ 1 Grad Knick
        r0 = res(x0)
        vorher.append(float(np.degrees(np.arcsin(min(1.0, np.abs(r0).reshape(-1, 3).__pow__(2).sum(1).max() ** 0.5)))))
        x = x0.copy()
        for _ in range(iterationen):
            r = res(x)
            h = 1e-4 * kante
            J = np.zeros((len(r), len(x)))
            for j in range(len(x)):
                pi, ij = var[j // 3]
                alt = flaechen_liste[pi][0].Pole(*ij)
                q = np.array([alt.X(), alt.Y(), alt.Z()])
                q[j % 3] += h
                flaechen_liste[pi][0].SetPole(ij[0], ij[1], gp_Pnt(*map(float, q)))
                for ki in betrifft[j // 3]:
                    J[ki * n_r:(ki + 1) * n_r, j] = (res_kante(kanten[ki]) - r[ki * n_r:(ki + 1) * n_r]) / h
                flaechen_liste[pi][0].SetPole(ij[0], ij[1], alt)
            A = np.r_[J, lam * np.eye(len(x))]
            b = np.r_[-r, -lam * (x - x0)]
            dx = np.linalg.lstsq(A, b, rcond=None)[0]
            x = x + dx
            if np.linalg.norm(dx) < 1e-6 * kante:
                break
        r1 = res(x)
        k1 = float(np.degrees(np.arcsin(min(1.0, np.abs(r1).reshape(-1, 3).__pow__(2).sum(1).max() ** 0.5))))
        if k1 > vorher[-1]:                          # nie schlechter machen
            setzen(x0)
            k1 = vorher[-1]
        nachher.append(k1)
        gezaehlt += 1
    if not gezaehlt:
        return {"ecken_ausgeglichen": 0}
    return {"ecken_ausgeglichen": gezaehlt, "ecken_knick_vorher": round(max(vorher), 2),
            "ecken_knick_nachher": round(max(nachher), 2)}
