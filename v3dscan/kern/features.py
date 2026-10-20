# Koerper aus Skizzen (Design X "Extrude/Revolve", QuickSurface "Extruded/Revolved Feature")
# und Kantenbearbeitung (Fillet/Chamfer) mit OpenCASCADE.
#
# Skizze -> geschlossene Ketten -> Draehte (exakte Anschlusspunkte aus kern/skizze.py) ->
# Flaechen mit Loechern (aeussere Kette enthaelt innere) -> Prisma / Rotation.
# "Bis Scan" misst die Ausdehnung der Scanpunkte innerhalb des Profils entlang der Normale.

import math

import numpy as np

from . import skizze as sk


def _pnt(E, q):
    from OCP.gp import gp_Pnt
    p = sk.zu3d(q, E)[0]
    return gp_Pnt(*map(float, p))


def _kante(el, E):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge
    from OCP.GC import GC_MakeArcOfCircle, GC_MakeSegment
    from OCP.gp import gp_Ax2, gp_Circ, gp_Dir
    if el["typ"] == "linie":
        a, b = np.asarray(el["a"]), np.asarray(el["b"])
        if np.linalg.norm(b - a) < 1e-7:
            return None
        return BRepBuilderAPI_MakeEdge(GC_MakeSegment(_pnt(E, a), _pnt(E, b)).Value()).Edge()
    if el["typ"] == "kreis":
        m = sk.zu3d(el["mitte"], E)[0]
        from OCP.gp import gp_Pnt
        ax = gp_Ax2(gp_Pnt(*map(float, m)), gp_Dir(*map(float, E["n"])), gp_Dir(*map(float, E["u"])))
        return BRepBuilderAPI_MakeEdge(gp_Circ(ax, float(el["r"]))).Edge()
    return BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(_pnt(E, el["a"]), _pnt(E, el["m"]),
                                                      _pnt(E, el["b"])).Value()).Edge()


def kette_draht(kette, E):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire
    w = BRepBuilderAPI_MakeWire()
    for el in kette["elemente"]:
        e = _kante(sk.element_lesen(el), E)
        if e is not None:
            w.Add(e)
    if not w.IsDone():
        raise ValueError("Die Kontur lässt sich nicht schließen (Lücke zwischen zwei Elementen).")
    return w.Wire()


def profil(skz):
    """-> Liste [(aeussere Kette, [innere Ketten])] aller geschlossenen Ketten, 2D-Polygone dazu."""
    zu = [k for k in skz["ketten"] if k["geschlossen"]]
    if not zu:
        raise ValueError("Die Skizze hat keine geschlossene Kontur – Lücken schließen oder Toleranz erhöhen.")
    polys = [sk.kette_polygon({"elemente": [sk.element_lesen(e) for e in k["elemente"]]}) for k in zu]
    flaechen = [abs(sk.flaeche(p)) for p in polys]
    # Verschachtelungstiefe: Anzahl der Ketten, die einen Punkt der Kette enthalten
    tiefe = []
    for i, p in enumerate(polys):
        t = sum(1 for j, q in enumerate(polys) if j != i and flaechen[j] > flaechen[i] and sk.innen(q, p[:1])[0])
        tiefe.append(t)
    gruppen = []
    for i in sorted(range(len(zu)), key=lambda i: -flaechen[i]):
        if tiefe[i] % 2 == 0:
            gruppen.append([i, []])
        else:
            # innere Kette gehoert zur kleinsten aeusseren, die sie enthaelt
            eltern = [g for g in gruppen if sk.innen(polys[g[0]], polys[i][:1])[0]]
            if eltern:
                min(eltern, key=lambda g: flaechen[g[0]])[1].append(i)
    return [(zu[a], [zu[b] for b in innen]) for a, innen in gruppen], zu, polys


def flaechen(skz):
    """Skizze -> Liste ebener OCP-Flaechen (mit Loechern)."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
    from OCP.ShapeFix import ShapeFix_Face
    E = sk.ebene_lesen(skz["ebene"])
    aus = []
    for aussen, innere in profil(skz)[0]:
        mf = BRepBuilderAPI_MakeFace(kette_draht(aussen, E), True)
        if not mf.IsDone():
            raise ValueError("Aus der Kontur lässt sich keine Fläche bilden.")
        for k in innere:
            mf.Add(kette_draht(k, E))
        fix = ShapeFix_Face(mf.Face())
        fix.FixOrientation()
        fix.Perform()
        aus.append(fix.Face())
    return aus


def _verbund(shapes):
    from OCP.BRep import BRep_Builder
    from OCP.TopoDS import TopoDS_Compound
    if len(shapes) == 1:
        return shapes[0]
    b = BRep_Builder()
    c = TopoDS_Compound()
    b.MakeCompound(c)
    for s in shapes:
        b.Add(c, s)
    return c


def scan_tiefe(skz, xyz, rand=0.0):
    """Ausdehnung (min, max) entlang der Skizzennormale der Scanpunkte, die innerhalb
    der Profilflaeche liegen (Loecher ausgenommen). None, wenn keine."""
    E = sk.ebene_lesen(skz["ebene"])
    gruppen, zu, polys = profil(skz)
    idx = {id(k): i for i, k in enumerate(zu)}
    q = sk.zu2d(xyz, E)
    d = (np.asarray(xyz, float) - E["ursprung"]) @ E["n"]
    # grob vorfiltern ueber die Box
    alle = np.concatenate(polys)
    lo, hi = alle.min(0) - rand, alle.max(0) + rand
    vor = np.nonzero(((q >= lo) & (q <= hi)).all(1))[0]
    if len(vor) > 400000:
        vor = vor[np.random.default_rng(0).choice(len(vor), 400000, replace=False)]
    drin = np.zeros(len(vor), bool)
    for aussen, innere in gruppen:
        m = sk.innen(polys[idx[id(aussen)]], q[vor])
        for k in innere:
            m &= ~sk.innen(polys[idx[id(k)]], q[vor])
        drin |= m
    if drin.sum() < 10:
        return None
    w = d[vor][drin]
    return float(np.percentile(w, 0.2)), float(np.percentile(w, 99.8))


def extrudieren(skz, von, bis):
    """Profil von -> bis (mm entlang der Skizzennormale, bis > von) aufziehen."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
    from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
    from OCP.gp import gp_Trsf, gp_Vec
    if bis - von < 1e-4:
        raise ValueError("Die Extrusionslänge ist 0.")
    E = sk.ebene_lesen(skz["ebene"])
    n = E["n"]
    teile = []
    for f in flaechen(skz):
        t = gp_Trsf()
        t.SetTranslation(gp_Vec(*map(float, n * von)))
        f2 = BRepBuilderAPI_Transform(f, t, True).Shape()
        teile.append(BRepPrimAPI_MakePrism(f2, gp_Vec(*map(float, n * (bis - von)))).Shape())
    return _verbund(teile)


def drehachse(skz, element=None):
    """-> (punkt3d, richtung3d). element = Index einer Linie der Skizze (flach durchnummeriert),
    sonst die u-Achse der Skizzenebene (bei "durch Achse" = Zylinderachse)."""
    E = sk.ebene_lesen(skz["ebene"])
    if element is None:
        return E["ursprung"], E["u"]
    els = [e for k in skz["ketten"] for e in k["elemente"]]
    if not 0 <= element < len(els) or els[element]["typ"] != "linie":
        raise ValueError("Als Drehachse bitte eine Linie der Skizze wählen.")
    el = els[element]
    a, b = sk.zu3d(el["a"], E)[0], sk.zu3d(el["b"], E)[0]
    return a, (b - a) / np.linalg.norm(b - a)


def _flaeche_inhalt(shape):
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    g = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape, g)
    return abs(float(g.Mass()))


def _halbseite(f, E, p, r):
    """Profil, das ueber die Drehachse reicht (Schnitt durch die Achse liefert beide
    Seiten), auf die groessere Seite beschneiden - sonst entsteht beim Drehen Unsinn."""
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon
    from OCP.gp import gp_Pnt
    w = np.cross(E["n"], r)
    gross = 1e4
    seiten = []
    for vz in (1.0, -1.0):
        ecken = [p - r * gross, p + r * gross, p + r * gross + vz * w * gross, p - r * gross + vz * w * gross]
        poly = BRepBuilderAPI_MakePolygon()
        for e in ecken:
            poly.Add(gp_Pnt(*map(float, e)))
        poly.Close()
        halb = BRepBuilderAPI_MakeFace(poly.Wire(), True).Face()
        teil = BRepAlgoAPI_Common(f, halb).Shape()
        seiten.append((_flaeche_inhalt(teil), teil))
    ganz = _flaeche_inhalt(f)
    gross_seite = max(seiten, key=lambda x: x[0])
    if gross_seite[0] >= ganz * (1 - 1e-6):
        return f, False
    return gross_seite[1], True


def drehen(skz, winkel_grad=360.0, element=None):
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol
    from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt
    E = sk.ebene_lesen(skz["ebene"])
    p, r = drehachse(skz, element)
    ax = gp_Ax1(gp_Pnt(*map(float, p)), gp_Dir(*map(float, r)))
    w = math.radians(max(0.1, min(360.0, float(winkel_grad))))
    teile = []
    for f in flaechen(skz):
        f, _ = _halbseite(f, E, np.asarray(p, float), np.asarray(r, float))
        teile.append(BRepPrimAPI_MakeRevol(f, ax, w, True).Shape())
    erg = _verbund(teile)
    if len(teile) > 1:
        # mehrere Profilteile (z. B. beide Seiten getrennt geschnitten) zu einem Koerper
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse
        erg = teile[0]
        for t in teile[1:]:
            erg = BRepAlgoAPI_Fuse(erg, t).Shape()
    return erg


# --- Kanten -------------------------------------------------------------------------------------------
def kanten_karte(shape):
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopExp import TopExp
    from OCP.TopTools import TopTools_IndexedMapOfShape
    m = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(shape, TopAbs_EDGE, m)
    return m


def kanten_runden(shape, kanten, radius, fase=False):
    """kanten = Indizes (1-basiert) aus kanten_karte. fase=True: gleichschenklige Fase."""
    from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer, BRepFilletAPI_MakeFillet
    from OCP.TopoDS import TopoDS
    if not kanten:
        raise ValueError("Erst Kanten wählen (im Modell anklicken).")
    if radius <= 0:
        raise ValueError("Radius/Fase muss größer 0 sein.")
    m = kanten_karte(shape)
    op = BRepFilletAPI_MakeChamfer(shape) if fase else BRepFilletAPI_MakeFillet(shape)
    for i in kanten:
        if not 1 <= int(i) <= m.Extent():
            raise ValueError("Kante %s gibt es nicht (mehr)." % i)
        e = TopoDS.Edge_s(m.FindKey(int(i)))
        op.Add(float(radius), e)
    try:
        op.Build()
    except Exception:
        pass
    if not op.IsDone():
        raise ValueError("%s mit %s mm ist an diesen Kanten nicht möglich (zu groß?)."
                         % ("Fase" if fase else "Rundung", radius))
    return op.Shape()


def radius_vorschlag(shape, kanten, elemente):
    """Radius aus dem Scan: erkannte Rundung/Hohlkehle, deren Achse parallel zur Kante
    liegt und nahe an ihr verlaeuft (Design X "Radius aus Netz")."""
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_Line
    from OCP.TopoDS import TopoDS
    m = kanten_karte(shape)
    vorschlaege = []
    for i in kanten:
        c = BRepAdaptor_Curve(TopoDS.Edge_s(m.FindKey(int(i))))
        if c.GetType() != GeomAbs_Line:
            continue
        p0 = c.Value(c.FirstParameter())
        p1 = c.Value(c.LastParameter())
        a = np.array([p0.X(), p0.Y(), p0.Z()])
        b = np.array([p1.X(), p1.Y(), p1.Z()])
        d = (b - a) / max(np.linalg.norm(b - a), 1e-12)
        mitte = 0.5 * (a + b)
        for el in elemente:
            if el.get("typ") not in ("rundung", "hohlkehle") or "achse" not in el:
                continue
            ax = np.asarray(el["achse"], float)
            if abs(ax @ d) < math.cos(math.radians(5)):
                continue
            r = float(el.get("radius_nenn") or el.get("radius") or 0)
            q = mitte - np.asarray(el["punkt"], float)
            abst = np.linalg.norm(q - (q @ ax) * ax)
            if r > 0 and abst < 2.5 * r:
                vorschlaege.append(r)
    if not vorschlaege:
        return None
    return float(np.median(vorschlaege))
