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


def auto_flaechen(X, T, flaechen=300, raster=7, kantenwinkel=0.0, fortschritt=None):
    """Geschlossenes oder offenes Scan-Netz -> (shape, info). raster = Punkte je Kante (>= 4)."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeSolid, BRepBuilderAPI_Sewing
    from OCP.ShapeFix import ShapeFix_Solid
    from OCP.TopAbs import TopAbs_SHELL
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    t0 = time.time()
    X = np.asarray(X, np.float64)
    T = np.asarray(T, np.int64)
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
    t = np.linspace(0, 1, n)
    K = _kanten(F)
    schluessel = {(int(a), int(b)): i for i, (a, b) in enumerate(K)}
    # Kantenpunkte: von kleinerer zu groesserer Ecken-Nummer, Enden = Ecken (exakt geteilt)
    E = V[K[:, 0], None, :] * (1 - t)[None, :, None] + V[K[:, 1], None, :] * t[None, :, None]
    EN = VN[K[:, 0], None, :] * (1 - t)[None, :, None] + VN[K[:, 1], None, :] * t[None, :, None]
    E[:, 1:-1] = proj.entlang(E[:, 1:-1], EN[:, 1:-1], weit)
    E[:, 0], E[:, -1] = V[K[:, 0]], V[K[:, 1]]

    def rand(a, b):
        r = E[schluessel[(min(a, b), max(a, b))]]
        return r if a < b else r[::-1]

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
            s = _flaeche(G)
            sewing.Add(BRepBuilderAPI_MakeFace(s, 1e-6).Face())
        except Exception:
            fehlgeschlagen += 1
        if fi % 50 == 0:
            wenn(fi / len(F))
    sewing.Perform()
    genaeht = sewing.SewedShape()
    info = {"vierecke": int(len(F)), "fehlgeschlagen": fehlgeschlagen, "freie_kanten": int(sewing.NbFreeEdges())}
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
            A = np.c_[np.ones(k), dx, dy, dx * dx, dx * dy, dy * dy] if k >= 12 else np.c_[np.ones(k), dx, dy]
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
    for _ in range(int(glaettung)):
        P_ = np.pad(H, 1, mode="edge")
        H = 0.5 * H + 0.125 * (P_[:-2, 1:-1] + P_[2:, 1:-1] + P_[1:-1, :-2] + P_[1:-1, 2:])
    arr = TColgp_Array2OfPnt(1, nu, 1, nv)
    for i in range(nu):
        for j in range(nv):
            p = c + gu[i] * u_a + gv[j] * v_a + H[i, j] * n_a
            arr.SetValue(i + 1, j + 1, gp_Pnt(*map(float, p)))
    f = GeomAPI_PointsToBSplineSurface(arr, 3, 8, GeomAbs_C2, max(0.002, 0.004 * zelle))
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
