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
    if el["typ"] == "spline":
        from OCP.Geom import Geom_BSplineCurve
        from OCP.TColgp import TColgp_Array1OfPnt
        from OCP.TColStd import TColStd_Array1OfInteger, TColStd_Array1OfReal
        pole = np.asarray(el["pole"], float)
        m = len(pole)
        arr = TColgp_Array1OfPnt(1, m)
        for i, q in enumerate(pole):
            arr.SetValue(i + 1, _pnt(E, q))
        kn = np.linspace(0, 1, m - 2)
        knoten = TColStd_Array1OfReal(1, len(kn))
        vielf = TColStd_Array1OfInteger(1, len(kn))
        for i, k in enumerate(kn):
            knoten.SetValue(i + 1, float(k))
            vielf.SetValue(i + 1, 4 if i in (0, len(kn) - 1) else 1)
        return BRepBuilderAPI_MakeEdge(Geom_BSplineCurve(arr, knoten, vielf, 3)).Edge()
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
    zu = [k for k in skz["ketten"] if k["geschlossen"] and not k.get("hilfe")]
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


def drehen(skz, winkel_grad=360.0, element=None, winkel2_grad=0.0):
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol
    from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt
    E = sk.ebene_lesen(skz["ebene"])
    p, r = drehachse(skz, element)
    ax = gp_Ax1(gp_Pnt(*map(float, p)), gp_Dir(*map(float, r)))
    w2 = math.radians(max(0.0, float(winkel2_grad or 0)))
    w = math.radians(max(0.1, min(360.0, float(winkel_grad)))) 
    if w + w2 > 2 * math.pi:
        raise ValueError("Winkel 1 + Winkel 2 dürfen zusammen höchstens 360° sein.")
    teile = []
    for f in flaechen(skz):
        f, _ = _halbseite(f, E, np.asarray(p, float), np.asarray(r, float))
        if w2 > 0:                                   # zweiter Winkel: Profil erst zurückdrehen
            from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
            from OCP.gp import gp_Trsf
            t = gp_Trsf()
            t.SetRotation(ax, -w2)
            f = BRepBuilderAPI_Transform(f, t, True).Shape()
        teile.append(BRepPrimAPI_MakeRevol(f, ax, w + w2, True).Shape())
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


# --- Koerper-Werkzeuge (QuickSurface CAD-Reiter) -----------------------------------------------------
def koerper_bool(a, b, art):
    """art: vereinen | abziehen | schneiden (Schnittmenge)."""
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
    from . import koerper as kp
    if art == "schneiden":
        op = BRepAlgoAPI_Common(a, b)
        if not op.IsDone():
            raise ValueError("Schnittmenge ist fehlgeschlagen.")
        erg = op.Shape()
    else:
        erg = kp.boolean(a, b, art)
    if kp.kennwerte(erg)["volumen"] < 1e-6:
        raise ValueError("Ergebnis ist leer – berühren sich die Körper überhaupt?")
    return erg


def _trsf_anwenden(shape, t, kopie=True):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
    return BRepBuilderAPI_Transform(shape, t, kopie).Shape()


def verschieben(shape, versatz=(0, 0, 0), drehung=(0, 0, 0), mitte=None):
    """Verschieben (mm) und um die Koerpermitte drehen (Grad, X dann Y dann Z)."""
    from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec
    m = np.asarray(mitte if mitte is not None else _mitte(shape), float)
    erg = shape
    for achse, w in zip(((1, 0, 0), (0, 1, 0), (0, 0, 1)), drehung):
        if abs(w) > 1e-9:
            t = gp_Trsf()
            t.SetRotation(gp_Ax1(gp_Pnt(*m), gp_Dir(*achse)), math.radians(float(w)))
            erg = _trsf_anwenden(erg, t)
    if any(abs(x) > 1e-12 for x in versatz):
        t = gp_Trsf()
        t.SetTranslation(gp_Vec(*map(float, versatz)))
        erg = _trsf_anwenden(erg, t)
    return erg


def _mitte(shape):
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib
    b = Bnd_Box()
    BRepBndLib.Add_s(shape, b)
    x0, y0, z0, x1, y1, z1 = b.Get()
    return [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]


def spiegeln(shape, ebene="yz", durch="mitte", vereinen=True):
    """Spiegeln an einer Weltebene durch den Ursprung oder die Koerpermitte;
    vereinen=True haengt die gespiegelte Kopie an (symmetrische Teile)."""
    from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf
    if isinstance(ebene, tuple):                 # (punkt, normale) einer Referenzebene
        p, n = ebene
    else:
        n = {"yz": (1, 0, 0), "xz": (0, 1, 0), "xy": (0, 0, 1)}[ebene]
        p = _mitte(shape) if durch == "mitte" else [0.0, 0.0, 0.0]
    t = gp_Trsf()
    t.SetMirror(gp_Ax2(gp_Pnt(*map(float, p)), gp_Dir(*n)))
    gespiegelt = _trsf_anwenden(shape, t)
    if not vereinen:
        return gespiegelt
    from . import koerper as kp
    return kp.boolean(shape, gespiegelt, "vereinen")


def muster(shape, art="linear", anzahl=3, versatz=(10, 0, 0), achse="z", winkel=360.0, punkt=(0, 0, 0),
           anzahl2=1, versatz2=(0, 10, 0)):
    """Lineares Muster (Schritt = versatz) oder Kreismuster um eine Weltachse durch punkt.
    Kopien werden mit dem Original vereint."""
    from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec
    from . import koerper as kp
    anzahl = int(anzahl)
    if anzahl < 2:
        raise ValueError("Ein Muster braucht mindestens 2 Exemplare.")
    erg = shape
    if art == "raster":
        for i in range(anzahl):
            for j in range(max(1, int(anzahl2))):
                if i == 0 and j == 0:
                    continue
                t = gp_Trsf()
                t.SetTranslation(gp_Vec(*[float(a) * i + float(b) * j for a, b in zip(versatz, versatz2)]))
                erg = kp.boolean(erg, _trsf_anwenden(shape, t), "vereinen")
        return erg
    for i in range(1, anzahl):
        t = gp_Trsf()
        if art == "linear":
            t.SetTranslation(gp_Vec(*[float(x) * i for x in versatz]))
        else:
            d = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}[achse]
            schritt = float(winkel) / (anzahl if abs(float(winkel) - 360) < 1e-6 else anzahl - 1)
            t.SetRotation(gp_Ax1(gp_Pnt(*map(float, punkt)), gp_Dir(*d)), math.radians(schritt * i))
        erg = kp.boolean(erg, _trsf_anwenden(shape, t), "vereinen")
    return erg


def flaechen_karte(shape):
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp
    from OCP.TopTools import TopTools_IndexedMapOfShape
    m = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(shape, TopAbs_FACE, m)
    return m


def schale(shape, dicke, offene_flaechen=()):
    """Volumenkoerper aushoehlen (Wandstaerke dicke nach innen); offene_flaechen = Nummern
    (flaechen_karte, 1-basiert) der Flaechen, die wegfallen (Oeffnung). Ohne: geschlossen hohl."""
    from OCP.BRepOffset import BRepOffset_Skin
    from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeThickSolid
    from OCP.GeomAbs import GeomAbs_Intersection
    from OCP.TopTools import TopTools_ListOfShape
    from OCP.TopoDS import TopoDS
    if dicke <= 0:
        raise ValueError("Wandstärke muss größer 0 sein.")
    m = flaechen_karte(shape)
    liste = TopTools_ListOfShape()
    for i in offene_flaechen:
        if not 1 <= int(i) <= m.Extent():
            raise ValueError("Fläche %s gibt es nicht (mehr)." % i)
        liste.Append(TopoDS.Face_s(m.FindKey(int(i))))
    if liste.Size() == 0:
        # geschlossen hohl: innen versetzte Haut abziehen
        from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeOffsetShape
        off = BRepOffsetAPI_MakeOffsetShape()
        off.PerformByJoin(shape, -float(dicke), 1e-4, BRepOffset_Skin, False, False, GeomAbs_Intersection)
        if not off.IsDone():
            raise ValueError("Aushöhlen mit %s mm ist nicht möglich." % dicke)
        innen = off.Shape()
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeSolid
        from OCP.TopAbs import TopAbs_SHELL
        from OCP.TopExp import TopExp_Explorer
        ex = TopExp_Explorer(innen, TopAbs_SHELL)
        if not ex.More():
            raise ValueError("Aushöhlen mit %s mm ist nicht möglich." % dicke)
        kern_ = BRepBuilderAPI_MakeSolid(TopoDS.Shell_s(ex.Current())).Solid()
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
        erg = BRepAlgoAPI_Cut(shape, kern_).Shape()
    else:
        mk = BRepOffsetAPI_MakeThickSolid()
        mk.MakeThickSolidByJoin(shape, liste, -float(dicke), 1e-4, BRepOffset_Skin, False, False,
                                GeomAbs_Intersection)
        try:
            mk.Build()
        except Exception:
            pass
        if not mk.IsDone():
            raise ValueError("Schale mit %s mm ist hier nicht möglich (zu dick oder Freiform?)." % dicke)
        erg = mk.Shape()
    from . import koerper as kp
    if kp.kennwerte(erg)["volumen"] <= 1e-6 or kp.kennwerte(erg)["volumen"] >= kp.kennwerte(shape)["volumen"]:
        raise ValueError("Schale mit %s mm ergab keinen gültigen Körper." % dicke)
    return erg


def aufdicken(flaeche, dicke):
    """Flaeche/Schale um dicke zum Volumenkoerper aufdicken (Vorzeichen = Seite)."""
    from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeThickSolid
    if abs(dicke) < 1e-6:
        raise ValueError("Dicke darf nicht 0 sein.")
    mk = BRepOffsetAPI_MakeThickSolid()
    mk.MakeThickSolidBySimple(flaeche, float(dicke))
    try:
        mk.Build()
    except Exception:
        pass
    if not mk.IsDone():
        raise ValueError("Aufdicken mit %s mm ist nicht möglich." % dicke)
    return mk.Shape()


# --- Loft / Sweep / Pipe (QuickSurface "Surfacing") -----------------------------------------------------
def _aussenkette(skz):
    """Groesste geschlossene Kontur einer Skizze."""
    gruppen, zu, polys = profil(skz)
    return gruppen[0][0]


def _pfad_draht(skz):
    """Pfad aus einer Skizze: laengste Kette (offen oder geschlossen) als Draht; 3D-Skizze direkt."""
    if skz.get("art") == "3d":
        return draht_3d(skz["punkte3d"], skz.get("glatt", True), skz.get("geschlossen", False)), None, None
    E = sk.ebene_lesen(skz["ebene"])
    if not skz["ketten"]:
        raise ValueError("Die Pfad-Skizze ist leer.")
    def laenge(k):
        return sum(float(np.linalg.norm(np.diff(sk.diskret(sk.element_lesen(e)), axis=0), axis=1).sum())
                   for e in k["elemente"])
    k = max(skz["ketten"], key=laenge)
    return kette_draht(k, E), k, E


def loft(skizzen, glatt=True):
    """Volumenkoerper durch die Aussenkonturen mehrerer Skizzen (Reihenfolge = Liste)."""
    from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
    if len(skizzen) < 2:
        raise ValueError("Für einen Loft mindestens zwei Skizzen wählen.")
    op = BRepOffsetAPI_ThruSections(True, not glatt, 1e-6)
    op.CheckCompatibility(True)
    for skz in skizzen:
        E = sk.ebene_lesen(skz["ebene"])
        op.AddWire(kette_draht(_aussenkette(skz), E))
    try:
        op.Build()
    except Exception:
        pass
    if not op.IsDone():
        raise ValueError("Loft ist fehlgeschlagen – Konturen zu unterschiedlich oder in falscher Reihenfolge?")
    return op.Shape()


def sweep(profil_skz, pfad_skz):
    """Aussenkontur von profil_skz entlang des Pfads (laengste Kette von pfad_skz) ziehen."""
    from OCP.BRepOffsetAPI import BRepOffsetAPI_MakePipeShell
    E = sk.ebene_lesen(profil_skz["ebene"])
    profil_draht = kette_draht(_aussenkette(profil_skz), E)
    pfad, _, _ = _pfad_draht(pfad_skz)
    op = BRepOffsetAPI_MakePipeShell(pfad)
    op.Add(profil_draht, False, True)
    try:
        op.Build()
    except Exception:
        pass
    if not op.IsDone():
        raise ValueError("Sweep ist fehlgeschlagen – liegt das Profil am Anfang des Pfads?")
    op.MakeSolid()
    return op.Shape()


def pipe(pfad_skz, radius, innen=0.0):
    """Rohr mit Radius entlang des Pfads; innen > 0 macht es hohl."""
    from OCP.BRepAdaptor import BRepAdaptor_CompCurve
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire
    from OCP.BRepOffsetAPI import BRepOffsetAPI_MakePipeShell
    from OCP.gp import gp_Ax2, gp_Circ, gp_Dir, gp_Pnt, gp_Vec
    if radius <= 0 or innen < 0 or innen >= radius:
        raise ValueError("Radius > Innenradius ≥ 0 nötig.")
    pfad, _, _ = _pfad_draht(pfad_skz)
    c = BRepAdaptor_CompCurve(pfad)
    p, v = gp_Pnt(), gp_Vec()
    c.D1(c.FirstParameter(), p, v)

    def rohr(r):
        kreis = BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(p, gp_Dir(v)), float(r))).Edge()
        op = BRepOffsetAPI_MakePipeShell(pfad)
        op.Add(BRepBuilderAPI_MakeWire(kreis).Wire(), False, True)
        try:
            op.Build()
        except Exception:
            pass
        if not op.IsDone():
            raise ValueError("Rohr ist fehlgeschlagen – Pfad zu eng gekrümmt für den Radius?")
        op.MakeSolid()
        return op.Shape()
    aussen = rohr(radius)
    return BRepAlgoAPI_Cut(aussen, rohr(innen)).Shape() if innen > 0 else aussen


# --- Abwickeln (QuickSurface "Flatten", "Unroll") -------------------------------------------------------
def _lscm(X, T, iterationen=4000):
    """Konforme Abwicklung (Least Squares Conformal Maps), CG auf den Normalgleichungen
    (ohne scipy). -> UV (n,2), auf gleiche Gesamtflaeche skaliert."""
    X = np.asarray(X, float)
    T = np.asarray(T, np.int64)
    n = len(X)
    a, b, c = X[T[:, 0]], X[T[:, 1]], X[T[:, 2]]
    e1 = b - a
    l1 = np.linalg.norm(e1, axis=1)
    ok = l1 > 1e-12
    x_ax = e1 / np.maximum(l1, 1e-12)[:, None]
    nrm = np.cross(e1, c - a)
    flaeche2 = np.linalg.norm(nrm, axis=1)
    ok &= flaeche2 > 1e-12
    T, a, b, c, x_ax, nrm, flaeche2 = T[ok], a[ok], b[ok], c[ok], x_ax[ok], nrm[ok], flaeche2[ok]
    y_ax = np.cross(nrm / flaeche2[:, None], x_ax)
    P = np.stack([np.zeros((len(T), 2)), np.c_[np.einsum("ij,ij->i", b - a, x_ax), np.zeros(len(T))],
                  np.c_[np.einsum("ij,ij->i", c - a, x_ax), np.einsum("ij,ij->i", c - a, y_ax)]], 1)
    A2 = flaeche2                                            # 2 x Dreiecksflaeche
    # Gradient-Koeffizienten g_k = rot90(Gegenkante)/(2A)
    G = np.zeros((len(T), 3, 2))
    for k in range(3):
        e = P[:, (k + 2) % 3] - P[:, (k + 1) % 3]
        G[:, k] = np.c_[-e[:, 1], e[:, 0]] / A2[:, None]
    w = np.sqrt(A2 / 2)
    # Residuen je Dreieck: r1 = dv/dx + du/dy, r2 = dv/dy - du/dx  (Unbekannte: u = z[:n], v = z[n:])
    zeilen_u = [G[:, :, 1] * w[:, None], -G[:, :, 0] * w[:, None]]
    zeilen_v = [G[:, :, 0] * w[:, None], G[:, :, 1] * w[:, None]]

    def A_mal(z):
        u, v = z[:n], z[n:]
        return [np.einsum("tk,tk->t", cu, u[T]) + np.einsum("tk,tk->t", cv, v[T]) for cu, cv in zip(zeilen_u, zeilen_v)]

    def At_mal(r):
        g = np.zeros(2 * n)
        for ri, cu, cv in zip(r, zeilen_u, zeilen_v):
            np.add.at(g, T, cu * ri[:, None])
            np.add.at(g, T + n, cv * ri[:, None])
        return g
    # zwei weit entfernte Punkte festhalten
    i0 = 0
    i1 = int(np.argmax(np.linalg.norm(X - X[i0], axis=1)))
    i0 = int(np.argmax(np.linalg.norm(X - X[i1], axis=1)))
    d = float(np.linalg.norm(X[i1] - X[i0]))
    fest = np.array([i0, i1, i0 + n, i1 + n])
    werte = np.array([0.0, d, 0.0, 0.0])
    frei = np.ones(2 * n, bool)
    frei[fest] = False
    z0 = np.zeros(2 * n)
    z0[fest] = werte
    rhs = -At_mal(A_mal(z0))
    rhs[~frei] = 0

    def N(x):
        y = At_mal(A_mal(np.where(frei, x, 0.0)))
        y[~frei] = 0
        return y
    x = np.zeros(2 * n)
    r = rhs - N(x)
    p_ = r.copy()
    rr = r @ r
    ziel = 1e-20 * max(rhs @ rhs, 1e-30)
    for _ in range(iterationen):
        Np = N(p_)
        alpha = rr / max(p_ @ Np, 1e-300)
        x += alpha * p_
        r -= alpha * Np
        rr_neu = r @ r
        if rr_neu < ziel:
            break
        p_ = r + (rr_neu / rr) * p_
        rr = rr_neu
    z = np.where(frei, x, z0)
    UV = np.c_[z[:n], z[n:]]
    # gleiche Gesamtflaeche
    ua, ub, uc = UV[T[:, 0]], UV[T[:, 1]], UV[T[:, 2]]
    f2d = 0.5 * np.abs((ub[:, 0] - ua[:, 0]) * (uc[:, 1] - ua[:, 1]) - (ub[:, 1] - ua[:, 1]) * (uc[:, 0] - ua[:, 0]))
    s = np.sqrt((A2 / 2).sum() / max(f2d.sum(), 1e-30))
    UV *= s
    verzerrung = np.abs(f2d * s * s / (A2 / 2) - 1)
    return UV, T, {"flaeche": float((A2 / 2).sum()), "verzerrung_mittel": float(np.average(verzerrung, weights=A2)),
                   "verzerrung_max": float(np.percentile(verzerrung, 99))}


def abwickeln(shape, flaechen=None):
    """Flaechen (Nummern, sonst alle) eines Koerpers/einer Schale in die Ebene abwickeln.
    -> {"umriss": [[(x,y)...]...], "info"}. Abwickelbare Flaechen (Zylinder, Kegel) bleiben
    laengentreu, gekruemmte werden konform (winkeltreu) mit Flaechenausgleich abgebildet."""
    from . import koerper as kp
    nz = kp.vernetzen(shape, fein=False)
    X = nz["xyz"].astype(float)
    T = nz["tri"].astype(np.int64)
    fid = nz["flaechen_id"]
    if flaechen:
        wahl = np.isin(fid, np.asarray(list(flaechen), np.uint32))
        T, fid = T[wahl], fid[wahl]
    if not len(T):
        raise ValueError("Keine Fläche zum Abwickeln gewählt.")
    # Punkte zwischen verschiedenen Flaechen verschweissen, innerhalb einer Flaeche NICHT -
    # sonst schliesst sich die Naht eines Zylinders zum Rohr, das sich nicht abwickeln laesst
    v_fid = np.zeros(len(X), np.int64)
    v_fid[T.ravel()] = np.repeat(fid, 3)
    _, kid = np.unique(np.round(X / 1e-4).astype(np.int64), axis=0, return_inverse=True)
    kid = kid.ravel()
    paar = kid * (int(v_fid.max()) + 1) + v_fid
    _, paar_anz = np.unique(paar, return_counts=True)
    _, paar_inv = np.unique(paar, return_inverse=True)
    naht = paar_anz[paar_inv] > 1                     # Doppelpunkt innerhalb derselben Flaeche
    key = np.where(naht, -1 - np.arange(len(X)), kid)
    _, idx, inv = np.unique(key, return_index=True, return_inverse=True)
    T = inv.ravel()[T]
    benutzt = np.unique(T)
    neu = -np.ones(len(idx), np.int64)
    neu[benutzt] = np.arange(len(benutzt))
    X, T = X[idx][benutzt], neu[T]
    T = T[(T[:, 0] != T[:, 1]) & (T[:, 1] != T[:, 2]) & (T[:, 0] != T[:, 2])]
    UV, T, info = _lscm(X, T)
    # gerade legen: Drehung mit der kleinsten umschliessenden Box (Huelle in 0,5°-Schritten)
    def box(w):
        R = np.array([[np.cos(w), -np.sin(w)], [np.sin(w), np.cos(w)]])
        q = UV @ R.T
        return float(np.prod(q.max(0) - q.min(0))), R
    w0 = min(np.radians(np.arange(0, 180, 0.5)), key=lambda w: box(w)[0])
    w0 = min(w0 + np.radians(np.arange(-0.5, 0.5, 0.01)), key=lambda w: box(w)[0])
    UV = UV @ box(w0)[1].T
    if np.ptp(UV[:, 1]) > np.ptp(UV[:, 0]):
        UV = UV[:, ::-1] * [1, -1]
    # Randkanten = Kanten mit nur einem Dreieck -> geschlossene Umrisse
    kanten = np.sort(np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]]), axis=1)
    u, anz = np.unique(kanten, axis=0, return_counts=True)
    rand = u[anz == 1]
    nach = {}
    for a_, b_ in rand.tolist():
        nach.setdefault(a_, []).append(b_)
        nach.setdefault(b_, []).append(a_)
    umrisse, gesehen = [], set()
    for start in list(nach):
        if start in gesehen:
            continue
        weg, cur, vor = [start], start, None
        gesehen.add(start)
        while True:
            kand = [x for x in nach[cur] if x != vor and x not in gesehen]
            if not kand:
                break
            vor, cur = cur, kand[0]
            gesehen.add(cur)
            weg.append(cur)
        umrisse.append(UV[weg].tolist())
    lo = UV.min(0)
    umrisse = [[(x - lo[0], y - lo[1]) for x, y in um] for um in umrisse]
    info["groesse"] = (UV.max(0) - lo).tolist()
    return {"umriss": umrisse, "uv": UV - lo, "tri": T, "info": info}


def umriss_svg(umrisse, rand=5.0):
    """Abwicklung als SVG in mm (fuer Laser/Plotter)."""
    alle = np.concatenate([np.asarray(u) for u in umrisse]) if umrisse else np.zeros((1, 2))
    b, h = alle.max(0) + 2 * rand
    pfade = []
    for um in umrisse:
        pts = " ".join("%.3f,%.3f" % (x + rand, h - (y + rand)) for x, y in um)
        pfade.append('<polygon points="%s" fill="none" stroke="#000" stroke-width="0.1"/>' % pts)
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%.2fmm" height="%.2fmm" viewBox="0 0 %.3f %.3f">\n%s\n</svg>\n'
            % (b, h, b, h, "\n".join(pfade)))


# --- CAD-Reiter, Teil 2 (QuickSurface: Draft, Delete faces, Move face, Separate/Scale body,
#     Automatic Trimming, Helix/Gewinde, extrudierte Flaechen) -------------------------------------------
def extrudieren_schraeg(skz, von, bis, winkel_grad):
    """Extrusion mit Formschraege: Seitenflaechen um winkel geneigt (positiv = verjuengt sich),
    neutrale Ebene = Startebene."""
    from OCP.BRepOffsetAPI import BRepOffsetAPI_DraftAngle
    from OCP.gp import gp_Dir, gp_Pln, gp_Pnt
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Plane
    koerper = extrudieren(skz, von, bis)
    if abs(winkel_grad) < 1e-6:
        return koerper
    E = sk.ebene_lesen(skz["ebene"])
    n = E["n"]
    neutral = gp_Pln(gp_Pnt(*map(float, E["ursprung"] + n * von)), gp_Dir(*map(float, n)))
    d = BRepOffsetAPI_DraftAngle(koerper)
    ex = TopExp_Explorer(koerper, TopAbs_FACE)
    while ex.More():
        f = TopoDS.Face_s(ex.Current())
        a = BRepAdaptor_Surface(f)
        deckel = False
        if a.GetType() == GeomAbs_Plane:
            pn = a.Plane().Axis().Direction()
            deckel = abs(pn.X() * n[0] + pn.Y() * n[1] + pn.Z() * n[2]) > 0.999
        if not deckel:
            d.Add(f, gp_Dir(*map(float, n)), math.radians(float(winkel_grad)), neutral)
            if not d.AddDone():
                raise ValueError("Formschräge %s° ist an dieser Kontur nicht möglich." % winkel_grad)
        ex.Next()
    d.Build()
    if not d.IsDone():
        raise ValueError("Formschräge ist fehlgeschlagen.")
    return d.Shape()


def extrudieren_flaeche(skz, von, bis):
    """Offene oder geschlossene Ketten als FLAECHE extrudieren (fuer Koerper aus Flaechen)."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
    from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
    from OCP.gp import gp_Trsf, gp_Vec
    E = sk.ebene_lesen(skz["ebene"])
    n = E["n"]
    teile = []
    for k in skz["ketten"]:
        if not k["elemente"]:
            continue
        w = kette_draht(k, E)
        t = gp_Trsf()
        t.SetTranslation(gp_Vec(*map(float, n * von)))
        w2 = BRepBuilderAPI_Transform(w, t, True).Shape()
        teile.append(BRepPrimAPI_MakePrism(w2, gp_Vec(*map(float, n * (bis - von)))).Shape())
    if not teile:
        raise ValueError("Die Skizze ist leer.")
    return _verbund(teile)


def koerper_aus_flaechen(shapes, scan_xyz=None, scan_tri=None):
    """QuickSurface "Automatic Trimming": Flaechen/Koerper schneiden sich gegenseitig, aus den
    entstehenden Zellen wird die gewaehlt, deren Oberflaeche am besten auf dem Scan liegt
    (ohne Scan: die groesste)."""
    from OCP.BOPAlgo import BOPAlgo_MakerVolume
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopTools import TopTools_ListOfShape
    from . import koerper as kp
    if len(shapes) < 2:
        raise ValueError("Mindestens zwei Flächen/Körper wählen.")
    mv = BOPAlgo_MakerVolume()
    liste = TopTools_ListOfShape()
    for s in shapes:
        liste.Append(s)
    mv.SetArguments(liste)
    mv.SetIntersect(True)
    mv.Perform()
    if mv.HasErrors():
        raise ValueError("Die Flächen ließen sich nicht verschneiden.")
    zellen = []
    ex = TopExp_Explorer(mv.Shape(), TopAbs_SOLID)
    while ex.More():
        zellen.append(ex.Current())
        ex.Next()
    if not zellen:
        raise ValueError("Die Flächen schließen keinen Raum ein.")
    if scan_xyz is None or len(zellen) == 1:
        return max(zellen, key=lambda z: kp.kennwerte(z)["volumen"]), len(zellen)
    # Guete je Zelle: Anteil ihrer Oberflaechenpunkte nahe am Scan - bei Netzen Abstand zur
    # Netzoberflaeche (ebene Scanflaechen haben kaum Eckpunkte), sonst zu den Punkten
    from .o3d import o3d
    P = np.asarray(scan_xyz, float)
    diag = float(np.linalg.norm(P.max(0) - P.min(0)))
    if scan_tri is not None and len(scan_tri):
        szene = o3d.t.geometry.RaycastingScene()
        szene.add_triangles(o3d.core.Tensor(P.astype(np.float32)), o3d.core.Tensor(np.asarray(scan_tri, np.uint32)))

        def abstand(Q):
            return np.abs(szene.compute_distance(o3d.core.Tensor(Q.astype(np.float32))).numpy())
    else:
        if len(P) > 100000:
            P = P[np.random.default_rng(0).choice(len(P), 100000, replace=False)]
        wolke = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(P))

        def abstand(Q):
            return np.asarray(o3d.geometry.PointCloud(o3d.utility.Vector3dVector(Q)).compute_point_cloud_distance(wolke))
    beste = None
    for z in zellen:
        nz = kp.vernetzen(z)
        X, T = nz["xyz"].astype(float), nz["tri"]
        m = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(X), o3d.utility.Vector3iVector(T.astype(np.int32)))
        probe = np.asarray(m.sample_points_uniformly(4000).points)
        guete = float(np.mean(abstand(probe) < 0.01 * diag))
        if beste is None or guete > beste[0]:
            beste = (guete, z)
    return beste[1], len(zellen)


def koerper_trennen(shape):
    """Zusammengesetzten Koerper in einzelne Volumenkoerper zerlegen (Separate bodies)."""
    from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    teile = []
    for art in (TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE):
        ex = TopExp_Explorer(shape, art)
        while ex.More():
            teile.append(ex.Current())
            ex.Next()
        if teile:
            break
    return teile


def skalieren(shape, faktor, mitte=None):
    """Gleichmaessig (Zahl) oder je Achse ([fx, fy, fz]) um die Koerpermitte skalieren."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_GTransform
    from OCP.gp import gp_GTrsf, gp_Mat, gp_Pnt, gp_Trsf, gp_XYZ
    m = np.asarray(mitte if mitte is not None else _mitte(shape), float)
    if np.isscalar(faktor) or len(np.atleast_1d(faktor)) == 1:
        f = float(np.atleast_1d(faktor)[0])
        if f <= 0:
            raise ValueError("Faktor muss größer 0 sein.")
        t = gp_Trsf()
        t.SetScale(gp_Pnt(*m), f)
        return _trsf_anwenden(shape, t)
    fx, fy, fz = map(float, faktor)
    if min(fx, fy, fz) <= 0:
        raise ValueError("Faktoren müssen größer 0 sein.")
    g = gp_GTrsf()
    g.SetVectorialPart(gp_Mat(fx, 0, 0, 0, fy, 0, 0, 0, fz))
    g.SetTranslationPart(gp_XYZ(*(m - np.array([fx, fy, fz]) * m)))
    return BRepBuilderAPI_GTransform(shape, g, True).Shape()


def _flaechen(shape, nummern):
    from OCP.TopoDS import TopoDS
    m = flaechen_karte(shape)
    aus = []
    for i in nummern:
        if not 1 <= int(i) <= m.Extent():
            raise ValueError("Fläche %s gibt es nicht (mehr)." % i)
        aus.append(TopoDS.Face_s(m.FindKey(int(i))))
    if not aus:
        raise ValueError("Erst Flächen im Modell anklicken.")
    return aus


def flaeche_verschieben(shape, nummern, abstand):
    """Flaechen um abstand entlang ihrer Normale versetzen (Move face) - Nachbarn passen sich an."""
    from OCP.BRepOffset import BRepOffset_MakeOffset, BRepOffset_Skin
    from OCP.GeomAbs import GeomAbs_Intersection
    from . import koerper as kp
    mo = BRepOffset_MakeOffset()
    mo.Initialize(shape, 0.0, 1e-5, BRepOffset_Skin, False, False, GeomAbs_Intersection, False, False)
    for f in _flaechen(shape, nummern):
        mo.SetOffsetOnFace(f, float(abstand))
    mo.MakeOffsetShape()
    if not mo.IsDone():
        raise ValueError("Fläche verschieben um %s mm ist hier nicht möglich." % abstand)
    erg = mo.Shape()
    if kp.kennwerte(erg)["volumen"] <= 1e-6:
        raise ValueError("Fläche verschieben ergab keinen gültigen Körper.")
    return erg


def flaechen_loeschen(shape, nummern):
    """Flaechen entfernen und das Loch aus den Nachbarn schliessen (Delete faces / Defeaturing):
    z. B. Rundungen, Fasen, Bohrungen wegnehmen."""
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Defeaturing
    df = BRepAlgoAPI_Defeaturing()
    df.SetShape(shape)
    for f in _flaechen(shape, nummern):
        df.AddFaceToRemove(f)
    df.SetRunParallel(False)
    df.Build()
    if not df.IsDone():
        raise ValueError("Diese Flächen lassen sich nicht entfernen (Nachbarn können die Lücke nicht schließen).")
    return df.Shape()


def formschraege(shape, nummern, winkel_grad, richtung=(0, 0, 1), neutral_punkt=None):
    """Formschraege an gewaehlten Flaechen anbringen (Draft). Neutrale Ebene senkrecht zur
    Entformungsrichtung durch neutral_punkt (Standard: Koerperunterseite)."""
    from OCP.BRepOffsetAPI import BRepOffsetAPI_DraftAngle
    from OCP.gp import gp_Dir, gp_Pln, gp_Pnt
    r = np.asarray(richtung, float) / np.linalg.norm(richtung)
    if neutral_punkt is None:
        from OCP.Bnd import Bnd_Box
        from OCP.BRepBndLib import BRepBndLib
        b = Bnd_Box()
        BRepBndLib.Add_s(shape, b)
        x0, y0, z0, x1, y1, z1 = b.Get()
        ecken = np.array([[x, y, z] for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)])
        neutral_punkt = ecken[np.argmin(ecken @ r)]
    d = BRepOffsetAPI_DraftAngle(shape)
    pln = gp_Pln(gp_Pnt(*map(float, neutral_punkt)), gp_Dir(*map(float, r)))
    for f in _flaechen(shape, nummern):
        d.Add(f, gp_Dir(*map(float, r)), math.radians(float(winkel_grad)), pln)
        if not d.AddDone():
            raise ValueError("Formschräge an dieser Fläche nicht möglich (nur ebene/zylindrische Seitenflächen).")
    d.Build()
    if not d.IsDone():
        raise ValueError("Formschräge ist fehlgeschlagen.")
    return d.Shape()


def gewinde(punkt, achse, radius, laenge, steigung, aussen=True, profilwinkel=60.0):
    """Gewindekoerper (Helix-Sweep eines Dreiecksprofils) an einem Zylinder.
    aussen=True: Gewinde auf einem Bolzen (wird abgezogen: Nut), sonst Muttergewinde (wird
    abgezogen aus der Bohrungswand). Rueckgabe = Werkzeug zum Abziehen.
    Tiefe nach ISO: 0,6134·P (aussen) bzw. 0,5413·P (innen)."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeWire
    from OCP.BRepLib import BRepLib
    from OCP.BRepOffsetAPI import BRepOffsetAPI_MakePipeShell
    from OCP.Geom import Geom_CylindricalSurface
    from OCP.Geom2d import Geom2d_Line
    from OCP.gp import gp_Ax2d, gp_Ax3, gp_Dir, gp_Dir2d, gp_Pnt, gp_Pnt2d
    if steigung <= 0 or laenge <= 0 or radius <= 0:
        raise ValueError("Radius, Länge und Steigung müssen größer 0 sein.")
    a = np.asarray(achse, float) / np.linalg.norm(achse)
    p0 = np.asarray(punkt, float)
    tiefe = (0.6134 if aussen else 0.5413) * steigung
    # Helix auf dem Zylinder am Gewindegrund (aussen: Kern, innen: Bohrung + Tiefe)
    r_helix = radius
    ax3 = gp_Ax3(gp_Pnt(*p0), gp_Dir(*a))
    zyl = Geom_CylindricalSurface(ax3, r_helix)
    windungen = laenge / steigung
    linie = Geom2d_Line(gp_Ax2d(gp_Pnt2d(0, 0), gp_Dir2d(2 * math.pi, steigung)))
    lang = math.hypot(2 * math.pi, steigung) * windungen
    kante = BRepBuilderAPI_MakeEdge(linie, zyl, 0.0, lang).Edge()
    BRepLib.BuildCurves3d_s(kante)
    pfad = BRepBuilderAPI_MakeWire(kante).Wire()
    # Profil (Dreieck) in der Ebene durch Achse und Helix-Anfang
    x = np.asarray([ax3.XDirection().X(), ax3.XDirection().Y(), ax3.XDirection().Z()])
    start = p0 + x * r_helix
    halb = math.tan(math.radians(profilwinkel / 2)) * tiefe * 1.05
    rein = -x if aussen else x                    # aussen: Nut nach innen, innen: nach aussen
    eck = [start - a * halb - rein * 0.05 * tiefe, start + a * halb - rein * 0.05 * tiefe, start + rein * tiefe]
    poly = BRepBuilderAPI_MakePolygon()
    for e in eck:
        poly.Add(gp_Pnt(*map(float, e)))
    poly.Close()
    op = BRepOffsetAPI_MakePipeShell(pfad)
    op.SetMode(gp_Dir(*a))                         # Profil bleibt zur Achse ausgerichtet
    op.Add(poly.Wire(), False, False)
    op.Build()
    if not op.IsDone():
        raise ValueError("Gewinde ließ sich nicht erzeugen.")
    op.MakeSolid()
    return op.Shape()


# === Surfacing (v1.0): 3D-Skizze, Fill, Blend, Extend, Offset, Duplicate, Sew, Project, Roll ===========
def draht_3d(punkte, glatt=True, geschlossen=False):
    """3D-Skizze -> Draht: Spline durch die Punkte (glatt) oder Linienzug."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeWire
    from OCP.GeomAPI import GeomAPI_Interpolate
    from OCP.TColgp import TColgp_HArray1OfPnt
    from OCP.gp import gp_Pnt
    P = np.asarray(punkte, float)
    if len(P) < 2:
        raise ValueError("Eine 3D-Skizze braucht mindestens 2 Punkte.")
    if not glatt or len(P) == 2:
        poly = BRepBuilderAPI_MakePolygon()
        for q in P:
            poly.Add(gp_Pnt(*map(float, q)))
        if geschlossen and len(P) > 2:
            poly.Close()
        return poly.Wire()
    arr = TColgp_HArray1OfPnt(1, len(P))
    for i, q in enumerate(P):
        arr.SetValue(i + 1, gp_Pnt(*map(float, q)))
    ip = GeomAPI_Interpolate(arr, bool(geschlossen), 1e-6)
    ip.Perform()
    if not ip.IsDone():
        raise ValueError("Durch diese Punkte lässt sich keine Kurve legen (doppelte Punkte?).")
    return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(ip.Curve()).Edge()).Wire()


def skizze_draht(z):
    """Pfad/Kontur aus 2D- oder 3D-Skizze."""
    if z.get("art") == "3d":
        return draht_3d(z["punkte3d"], z.get("glatt", True), z.get("geschlossen", False))
    return _pfad_draht(z)[0]


def extrudieren_3d(z, richtung, laenge, beidseitig=True):
    """3D-Skizze in eine Richtung zur Flaeche ziehen ('mittel' = Normale der Ausgleichsebene)."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
    from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
    from OCP.gp import gp_Trsf, gp_Vec
    P = np.asarray(z["punkte3d"], float)
    if isinstance(richtung, str):
        if richtung == "mittel":
            _, _, vt = np.linalg.svd(P - P.mean(0))
            r = vt[2]
        else:
            r = np.array({"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}[richtung], float)
    else:
        r = np.asarray(richtung, float) / np.linalg.norm(richtung)
    w = draht_3d(P, z.get("glatt", True), z.get("geschlossen", False))
    if beidseitig:
        t = gp_Trsf()
        t.SetTranslation(gp_Vec(*map(float, -r * laenge / 2)))
        w = BRepBuilderAPI_Transform(w, t, True).Shape()
    return BRepPrimAPI_MakePrism(w, gp_Vec(*map(float, r * laenge))).Shape()


def freie_raender(shape):
    """Offene Randkanten einer Flaeche/Schale als geschlossene Draehte."""
    from OCP.ShapeAnalysis import ShapeAnalysis_FreeBounds
    from OCP.TopAbs import TopAbs_WIRE
    from OCP.TopExp import TopExp_Explorer
    fb = ShapeAnalysis_FreeBounds(shape, 1e-4, False, False)
    aus = []
    for verbund in (fb.GetClosedWires(), fb.GetOpenWires()):
        ex = TopExp_Explorer(verbund, TopAbs_WIRE)
        while ex.More():
            aus.append(ex.Current())
            ex.Next()
    return aus


def flaeche_fuellen(rand_draht, nachbar=None, scan_punkte=None, stetig=True):
    """Fill Surface: Plattenflaeche in einen geschlossenen Rand. nachbar = Schale, an die tangential
    angeschlossen wird (G1), scan_punkte = innere Punkte, durch die die Flaeche gehen soll (On Scan Data)."""
    from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeFilling
    from OCP.GeomAbs import GeomAbs_C0, GeomAbs_G1
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
    from OCP.TopExp import TopExp, TopExp_Explorer
    from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape
    from OCP.TopoDS import TopoDS
    from OCP.gp import gp_Pnt
    mf = BRepOffsetAPI_MakeFilling(3, 15, 2, False, 1e-5, 1e-4, 0.01, 0.1, 8, 9)
    karte = None
    if nachbar is not None and stetig:
        karte = TopTools_IndexedDataMapOfShapeListOfShape()
        TopExp.MapShapesAndAncestors_s(nachbar, TopAbs_EDGE, TopAbs_FACE, karte)
    ex = TopExp_Explorer(rand_draht, TopAbs_EDGE)
    n = 0
    while ex.More():
        e = TopoDS.Edge_s(ex.Current())
        f = None
        if karte is not None and karte.Contains(e):
            fs = karte.FindFromKey(e)
            if fs.Size() == 1:
                f = TopoDS.Face_s(fs.First())
        if f is not None:
            mf.Add(e, f, GeomAbs_G1, True)
        else:
            mf.Add(e, GeomAbs_C0, True)
        n += 1
        ex.Next()
    if n == 0:
        raise ValueError("Der Rand hat keine Kanten.")
    if scan_punkte is not None:
        for q in np.asarray(scan_punkte, float)[:400]:
            mf.Add(gp_Pnt(*map(float, q)))
    try:
        mf.Build()
    except Exception:
        pass
    if not mf.IsDone():
        raise ValueError("Die Lücke lässt sich nicht füllen.")
    return mf.Shape()


def naehen(shapes, toleranz=0.01):
    """Flaechen/Schalen zusammennaehen (Sew); geschlossen -> Volumenkoerper."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeSolid, BRepBuilderAPI_Sewing
    from OCP.ShapeFix import ShapeFix_Solid
    from OCP.TopAbs import TopAbs_SHELL
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    sw = BRepBuilderAPI_Sewing(float(toleranz))
    for s in shapes:
        sw.Add(s)
    sw.Perform()
    erg = sw.SewedShape()
    info = {"freie_kanten": int(sw.NbFreeEdges()), "geschlossen": False}
    if sw.NbFreeEdges() == 0:
        ex = TopExp_Explorer(erg, TopAbs_SHELL)
        if ex.More():
            mk = BRepBuilderAPI_MakeSolid(TopoDS.Shell_s(ex.Current()))
            if mk.IsDone():
                fix = ShapeFix_Solid(mk.Solid())
                fix.Perform()
                erg = fix.Solid()
                info["geschlossen"] = True
    return erg, info


def flaeche_versetzen(shape, abstand):
    """Flaeche/Schale/Koerper um abstand versetzen (Offset)."""
    from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeOffsetShape
    from OCP.BRepOffset import BRepOffset_Skin
    from OCP.GeomAbs import GeomAbs_Intersection
    off = BRepOffsetAPI_MakeOffsetShape()
    off.PerformByJoin(shape, float(abstand), 1e-4, BRepOffset_Skin, False, False, GeomAbs_Intersection)
    if not off.IsDone():
        raise ValueError("Versetzen um %s mm ist nicht möglich." % abstand)
    return off.Shape()


def flaechen_kopieren(shape, nummern):
    """Gewaehlte Flaechen eines Koerpers als eigene Flaeche(n) (Duplicate Face)."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
    teile = [BRepBuilderAPI_Copy(f, True, False).Shape() for f in _flaechen(shape, nummern)]
    return _verbund(teile)


def flaeche_verlaengern(shape, laenge):
    """Flaeche ueber alle Raender um laenge verlaengern (Extend Surface): Raster der Flaeche
    abtasten, linear ueber den Rand fortsetzen, neu als B-Spline einpassen."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
    from OCP.BRepTools import BRepTools
    from OCP.GeomAPI import GeomAPI_PointsToBSplineSurface
    from OCP.GeomAbs import GeomAbs_C2
    from OCP.TColgp import TColgp_Array2OfPnt
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.gp import gp_Pnt
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    if not ex.More():
        raise ValueError("Kein Flächenkörper.")
    f = TopoDS.Face_s(ex.Current())
    s = BRep_Tool.Surface_s(f)
    u0, u1, v0, v1 = BRepTools.UVBounds_s(f)
    n = 24
    G = np.zeros((n, n, 3))
    for i, u in enumerate(np.linspace(u0, u1, n)):
        for j, v in enumerate(np.linspace(v0, v1, n)):
            q = s.Value(u, v)
            G[i, j] = (q.X(), q.Y(), q.Z())
    lu = float(np.mean(np.linalg.norm(G[-1] - G[0], axis=1)))
    lv = float(np.mean(np.linalg.norm(G[:, -1] - G[:, 0], axis=1)))
    ku = max(1, int(np.ceil(laenge / (lu / (n - 1)))))
    kv = max(1, int(np.ceil(laenge / (lv / (n - 1)))))
    su, sv = laenge / ku, laenge / kv
    # in u fortsetzen (Tangente aus den letzten Zeilen, auf Schrittlaenge normiert)
    def fort(R, rueck, k, schritt):
        t = R[-1] - R[-2] if not rueck else R[0] - R[1]
        t = t / np.maximum(np.linalg.norm(t, axis=-1, keepdims=True), 1e-12) * schritt
        basis = R[-1] if not rueck else R[0]
        neu = np.array([basis + t * (i + 1) for i in range(k)])
        return np.concatenate([R, neu]) if not rueck else np.concatenate([neu[::-1], R])
    G = fort(fort(G, False, ku, su), True, ku, su)
    G = np.swapaxes(fort(fort(np.swapaxes(G, 0, 1), False, kv, sv), True, kv, sv), 0, 1)
    arr = TColgp_Array2OfPnt(1, G.shape[0], 1, G.shape[1])
    for i in range(G.shape[0]):
        for j in range(G.shape[1]):
            arr.SetValue(i + 1, j + 1, gp_Pnt(*map(float, G[i, j])))
    neu = GeomAPI_PointsToBSplineSurface(arr, 3, 3, GeomAbs_C2, 1e-3).Surface()
    a, b, c, d = neu.Bounds()
    return BRepBuilderAPI_MakeFace(neu, a, b, c, d, 1e-6).Face()


def skizze_auf_flaeche(flaeche, skz, behalten="innen"):
    """Project sketch: geschlossene Konturen der Skizze entlang ihrer Normale durch die Flaeche
    druecken und die Flaeche innerhalb (oder ausserhalb) der Konturen behalten."""
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut
    from . import koerper as kp
    groesse = max(kp.kennwerte(flaeche)["groesse"]) + 10
    E = sk.ebene_lesen(skz["ebene"])
    d = float((np.asarray(_mitte(flaeche)) - E["ursprung"]) @ E["n"])
    prisma = extrudieren(skz, d - 2 * groesse, d + 2 * groesse)
    op = BRepAlgoAPI_Common(flaeche, prisma) if behalten == "innen" else BRepAlgoAPI_Cut(flaeche, prisma)
    erg = op.Shape()
    if kp.kennwerte(erg)["flaeche"] < 1e-6:
        raise ValueError("Die Skizze trifft die Fläche nicht.")
    return erg


def skizze_wickeln(skz, zyl_punkt, zyl_achse, radius, dicke=1.0, aussen=True):
    """Roll Sketch: geschlossene Konturen (Skizzen-u = Umfangsrichtung, v = entlang der Achse) auf einen
    Zylinder wickeln und als Relief (aussen = erhaben) oder Gravur aufdicken. -> Koerper."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeWire
    from OCP.BRepLib import BRepLib
    from OCP.Geom import Geom_CylindricalSurface
    from OCP.Geom2d import Geom2d_BSplineCurve
    from OCP.GeomAPI import GeomAPI_PointsToBSpline
    from OCP.ShapeFix import ShapeFix_Face
    from OCP.gp import gp_Ax3, gp_Dir, gp_Pnt, gp_Pnt2d
    a = np.asarray(zyl_achse, float) / np.linalg.norm(zyl_achse)
    zyl = Geom_CylindricalSurface(gp_Ax3(gp_Pnt(*map(float, zyl_punkt)), gp_Dir(*map(float, a))), float(radius))
    teile = []
    gruppen, zu, polys = profil(skz)
    idx = {id(k): i for i, k in enumerate(zu)}
    from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism  # noqa: F401
    for aussen_k, innere in gruppen:
        draehte = []
        for k in [aussen_k] + innere:
            P = polys[idx[id(k)]]
            P = np.r_[P, P[:1]]
            # Bogenlaenge entlang u -> Winkel auf dem Zylinder, v -> Hoehe entlang der Achse
            pkte = [gp_Pnt2d(float(s_) / float(radius), float(t_)) for s_, t_ in P]
            w = BRepBuilderAPI_MakeWire()
            from OCP.GCE2d import GCE2d_MakeSegment
            for i in range(len(pkte) - 1):
                if pkte[i].Distance(pkte[i + 1]) < 1e-9:
                    continue
                seg = GCE2d_MakeSegment(pkte[i], pkte[i + 1]).Value()
                w.Add(BRepBuilderAPI_MakeEdge(seg, zyl).Edge())
            dr = w.Wire()
            BRepLib.BuildCurves3d_s(dr)
            draehte.append(dr)
        mf = BRepBuilderAPI_MakeFace(zyl, draehte[0], True)
        for dr in draehte[1:]:
            mf.Add(dr)
        fix = ShapeFix_Face(mf.Face())
        fix.FixOrientation()
        fix.Perform()
        teile.append(fix.Face())
    from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeThickSolid
    koerper = []
    for f in teile:
        mk = BRepOffsetAPI_MakeThickSolid()
        mk.MakeThickSolidBySimple(f, float(dicke) if aussen else -float(dicke))
        mk.Build()
        if not mk.IsDone():
            raise ValueError("Aufdicken der gewickelten Kontur ist fehlgeschlagen.")
        koerper.append(mk.Shape())
    return _verbund(koerper)


def ebene_durch_linie(skz, element_index):
    """Referenzebene, die eine Skizzenlinie enthaelt und senkrecht auf der Skizzenebene steht."""
    E = sk.ebene_lesen(skz["ebene"])
    els = [e for k in skz["ketten"] for e in k["elemente"]]
    el = sk.element_lesen(els[element_index])
    if el["typ"] != "linie":
        raise ValueError("Bitte eine Linie wählen.")
    a, b = sk.zu3d(el["a"], E)[0], sk.zu3d(el["b"], E)[0]
    d = (b - a) / np.linalg.norm(b - a)
    n = np.cross(d, E["n"])
    return {"art": "ebene", "punkt": a, "normale": n / np.linalg.norm(n)}


def ebene_entlang_pfad(z, anteil=0.0):
    """Referenzebene senkrecht zum Pfad an der Stelle anteil (0 … 1)."""
    from OCP.BRepAdaptor import BRepAdaptor_CompCurve
    from OCP.gp import gp_Pnt, gp_Vec
    c = BRepAdaptor_CompCurve(skizze_draht(z))
    u = c.FirstParameter() + float(anteil) * (c.LastParameter() - c.FirstParameter())
    p, v = gp_Pnt(), gp_Vec()
    c.D1(u, p, v)
    n = np.array([v.X(), v.Y(), v.Z()])
    return {"art": "ebene", "punkt": np.array([p.X(), p.Y(), p.Z()]), "normale": n / np.linalg.norm(n)}


# --- Uebergangsflaeche (Blend Surface) -----------------------------------------------------------------
def uebergang(shape_a, kante_a, shape_b, kante_b):
    """Flaeche zwischen zwei Randkanten, tangential (G1) an die Flaechen, zu denen die Kanten gehoeren.
    Die Enden werden mit Geraden verbunden (ueber Kreuz vermieden)."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge
    from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeFilling
    from OCP.GeomAbs import GeomAbs_C0, GeomAbs_G1
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
    from OCP.TopExp import TopExp
    from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape
    from OCP.TopoDS import TopoDS

    def kante_mit_flaeche(shape, nr):
        m = kanten_karte(shape)
        e = TopoDS.Edge_s(m.FindKey(int(nr)))
        karte = TopTools_IndexedDataMapOfShapeListOfShape()
        TopExp.MapShapesAndAncestors_s(shape, TopAbs_EDGE, TopAbs_FACE, karte)
        fs = karte.FindFromKey(e)
        return e, (TopoDS.Face_s(fs.First()) if fs.Size() >= 1 else None)

    ea, fa = kante_mit_flaeche(shape_a, kante_a)
    eb, fb = kante_mit_flaeche(shape_b, kante_b)

    def enden(e):
        from OCP.BRepAdaptor import BRepAdaptor_Curve
        c = BRepAdaptor_Curve(e)
        p, q = c.Value(c.FirstParameter()), c.Value(c.LastParameter())
        return np.array([p.X(), p.Y(), p.Z()]), np.array([q.X(), q.Y(), q.Z()])
    a0, a1 = enden(ea)
    b0, b1 = enden(eb)
    if np.linalg.norm(a0 - b0) + np.linalg.norm(a1 - b1) > np.linalg.norm(a0 - b1) + np.linalg.norm(a1 - b0):
        b0, b1 = b1, b0
    from OCP.gp import gp_Pnt
    v1 = BRepBuilderAPI_MakeEdge(gp_Pnt(*map(float, a1)), gp_Pnt(*map(float, b1))).Edge()
    v2 = BRepBuilderAPI_MakeEdge(gp_Pnt(*map(float, b0)), gp_Pnt(*map(float, a0))).Edge()
    mf = BRepOffsetAPI_MakeFilling(3, 15, 2, False, 1e-5, 1e-4, 0.01, 0.1, 8, 9)
    for e, f in ((ea, fa), (v1, None), (eb, fb), (v2, None)):
        if f is not None:
            mf.Add(e, f, GeomAbs_G1, True)
        else:
            mf.Add(e, GeomAbs_C0, True)
    try:
        mf.Build()
    except Exception:
        pass
    if not mf.IsDone():
        raise ValueError("Zwischen diesen Kanten lässt sich keine Übergangsfläche bilden.")
    return mf.Shape()
