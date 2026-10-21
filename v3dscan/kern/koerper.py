# Volumenkoerper (OpenCASCADE/OCP): Grundkoerper aus erkannten Formen
# ("Solid Primitive" in Design X), Boolean mit bestehenden Koerpern,
# Vernetzen fuer die Anzeige, Kennwerte, BRep-Text fuer die Projektdatei,
# STEP-/IGES-Export.
#
# TopoDS_Shape gilt hier als unveraenderlich: Booleans liefern neue Shapes,
# vernetzt wird immer eine Kopie (BRepMesh schreibt sonst Dreiecke in die
# Flaechen des Originals, die auch im Rueckgaengig-Verlauf stecken).
#
# Konventionen aus der Erkennung (kern/erkennung.py, kern/formen.py):
#   Zylinder: punkt = Achsmitte, achse (Einheitsvektor), hoehe, radius
#   Kugel:    mitte, radius
#   Kegel:    punkt = Achsmitte, achse zeigt in Richtung WACHSENDEN Radius,
#             r_min bei punkt - achse*hoehe/2, r_max bei punkt + achse*hoehe/2,
#             halbwinkel (rad); c/r0 = Radius r0 im Achspunkt c

import io
import math
import os
import tempfile

import numpy as np

ZYLINDER_TYPEN = ("bohrung", "zapfen", "zylinder", "zylinderflaeche", "rundung", "hohlkehle")
KUGEL_TYPEN = ("kugel", "kugelmulde")
KEGEL_TYPEN = ("kegel", "senkung")
ABZIEH_TYPEN = ("bohrung", "kugelmulde", "senkung", "hohlkehle")
OPERATIONEN = ("neu", "vereinen", "abziehen")
ART_NAMEN = {"zylinder": "Zylinder", "kugel": "Kugel", "kegel": "Kegel"}
OP_ZUSATZ = {"vereinen": "vereint", "abziehen": "abgezogen"}


class Koerper:
    """Ein Volumenkoerper im Projekt. shape wird nie veraendert, nur ersetzt."""

    def __init__(self, kid, name, shape, verlauf=None, sichtbar=True, rev=1):
        self.id = kid
        self.name = name
        self.shape = shape
        self.verlauf = list(verlauf or [])
        self.sichtbar = sichtbar
        self.rev = rev
        self._cache = None          # (shape, {netz, volumen, groesse})
        self.basis = None           # (index, shape): fester Zwischenstand des Verlaufs (siehe kern/verlauf.py)
        self.basis_pruefen()

    def basis_pruefen(self):
        """Ist der letzte Schritt nicht nachrechenbar, wird das aktuelle Ergebnis zum festen Zwischenstand."""
        from .verlauf import NACHRECHENBAR
        if self.verlauf and self.verlauf[-1].get("typ") not in NACHRECHENBAR:
            self.basis = (len(self.verlauf) - 1, self.shape)

    def kopie(self):
        k = Koerper(self.id, self.name, self.shape, [dict(v) for v in self.verlauf],
                    self.sichtbar, self.rev)
        k._cache = self._cache
        k.basis = self.basis
        return k

    def daten(self):
        """Netz + Kennwerte, je Shape einmal gerechnet."""
        if self._cache is None or self._cache[0] is not self.shape:
            self._cache = (self.shape, dict(kennwerte(self.shape), netz=vernetzen(self.shape)))
        return self._cache[1]

    def zustand(self):
        d = self.daten()
        return {"id": self.id, "name": self.name, "sichtbar": self.sichtbar,
                "dreiecke": int(len(d["netz"]["tri"])), "rev": self.rev,
                "verlauf": [{"name": v["name"], "aus": bool(v.get("aus")),
                             "fest": i <= (self.basis[0] if self.basis else -1)}
                            for i, v in enumerate(self.verlauf)],
                "volumen": round(d["volumen"], 3), "groesse": [round(x, 3) for x in d["groesse"]],
                "flaeche": round(d.get("flaeche", 0.0), 3)}


# --- Grundkoerper aus Element ----------------------------------------------------------------
def _vek(el, name):
    v = el.get(name)
    if v is None:
        raise ValueError("Element ohne „%s“ – bitte neu erkennen." % name)
    v = np.asarray(v, np.float64)
    if v.shape != (3,) or not np.all(np.isfinite(v)):
        raise ValueError("Element hat ungültige Werte für „%s“." % name)
    return v


def _achse(el, nennmass):
    a = _vek(el, "achse_nenn") if nennmass and el.get("achse_nenn") is not None else _vek(el, "achse")
    n = np.linalg.norm(a)
    if n < 1e-9:
        raise ValueError("Element hat keine gültige Achse.")
    return a / n


def _art(el):
    typ = el.get("typ")
    if el.get("art") == "ebene" or typ == "ebene":
        raise ValueError("Ebene → kommt mit Referenzebenen.")
    if typ in ZYLINDER_TYPEN or (typ is None and el.get("art") == "zylinder"):
        return "zylinder"
    if typ in KUGEL_TYPEN or (typ is None and el.get("art") == "kugel"):
        return "kugel"
    if typ in KEGEL_TYPEN or (typ is None and el.get("art") == "kegel"):
        return "kegel"
    raise ValueError("Aus diesem Element (%s) lässt sich kein Grundkörper bauen." % typ)


def standard_operation(el, hat_koerper):
    return "abziehen" if hat_koerper and el.get("typ") in ABZIEH_TYPEN else "neu"


def _mm(x, stellen=2):
    return ("%%.%df" % stellen % x).replace(".", ",")


def grundkoerper_parameter(el, nennmass=True, verlaengern=0.0):
    """Element (JSON wie erkennung.als_json) -> Bauparameter (nur Zahlen/Listen).
    verlaengern in Prozent der Hoehe, je Ende die Haelfte (Zylinder/Kegel)."""
    art = _art(el)
    verlaengern = float(verlaengern or 0)
    if not math.isfinite(verlaengern) or verlaengern < 0 or verlaengern > 1000:
        raise ValueError("Verlängern muss zwischen 0 und 1000 % liegen.")
    if art == "kugel":
        mitte = _vek(el, "mitte")
        r = float(el["radius"])
        if nennmass and el.get("durchmesser_nenn"):
            r = float(el["durchmesser_nenn"]) / 2
        if not r > 0:
            raise ValueError("Kugelradius ungültig.")
        return {"art": art, "mitte": mitte.tolist(), "radius": r}
    a = _achse(el, nennmass)
    punkt = _vek(el, "punkt")
    h = float(el.get("hoehe") or 0)
    if not h > 0:
        raise ValueError("Element hat keine Höhe/Länge.")
    h_neu = h * (1 + verlaengern / 100.0)
    if art == "zylinder":
        r = float(el["radius"])
        if nennmass:
            if el.get("radius_nenn") is not None:          # Rundung/Hohlkehle
                r = float(el["radius_nenn"])
            elif el.get("durchmesser_nenn"):
                r = float(el["durchmesser_nenn"]) / 2
        if not r > 0:
            raise ValueError("Zylinderradius ungültig.")
        unten = punkt - a * h_neu / 2
        return {"art": art, "basis": unten.tolist(), "achse": a.tolist(), "radius": r,
                "hoehe": h_neu, "punkt": punkt.tolist()}
    # Kegel: Radius in der Achsmitte bleibt, Nennwinkel aendert die Steigung
    w = float(el["halbwinkel"])
    if el.get("c") is not None and el.get("r0") is not None:
        c = np.asarray(el["c"], np.float64)
        r_p = float(el["r0"]) + float((punkt - c) @ _vek(el, "achse")) * math.tan(w)
    else:
        r_p = (float(el["r_min"]) + float(el["r_max"])) / 2
    if nennmass and el.get("winkel_nenn"):
        w = math.radians(float(el["winkel_nenn"]) / 2)
    tw = math.tan(w)
    if not (0 < w < math.radians(89)) or not r_p > 0:
        raise ValueError("Kegel ungültig (Winkel/Radius).")
    # unten = kleiner Radius; dort hoechstens bis zur Spitze verlaengern
    ab_unten = min(h_neu / 2, r_p / tw)
    ab_oben = h_neu / 2
    r1 = max(r_p - ab_unten * tw, 0.0)
    r2 = r_p + ab_oben * tw
    if r1 < 1e-6:
        r1 = 0.0
    unten = punkt - a * ab_unten
    return {"art": art, "basis": unten.tolist(), "achse": a.tolist(), "r_min": r1, "r_max": r2,
            "hoehe": ab_unten + ab_oben, "halbwinkel": w, "punkt": punkt.tolist()}


def baue(par):
    from OCP.BRepPrimAPI import (BRepPrimAPI_MakeCone, BRepPrimAPI_MakeCylinder,
                                 BRepPrimAPI_MakeSphere)
    from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
    if par["art"] == "kugel":
        return BRepPrimAPI_MakeSphere(gp_Pnt(*par["mitte"]), par["radius"]).Shape()
    ax = gp_Ax2(gp_Pnt(*par["basis"]), gp_Dir(*par["achse"]))
    if par["art"] == "zylinder":
        return BRepPrimAPI_MakeCylinder(ax, par["radius"], par["hoehe"]).Shape()
    return BRepPrimAPI_MakeCone(ax, par["r_min"], par["r_max"], par["hoehe"]).Shape()


def beschreibung(par, nennmass):
    zusatz = " (Nennmaß)" if nennmass else ""
    if par["art"] == "kugel":
        return "Kugel Ø %s%s" % (_mm(2 * par["radius"], 3), zusatz)
    if par["art"] == "zylinder":
        return "Zylinder Ø %s × %s mm%s" % (_mm(2 * par["radius"], 3), _mm(par["hoehe"], 2), zusatz)
    return "Kegel %s° · Ø %s → %s × %s mm%s" % (
        _mm(math.degrees(2 * par["halbwinkel"]), 2), _mm(2 * par["r_max"], 3),
        _mm(2 * par["r_min"], 3), _mm(par["hoehe"], 2), zusatz)


def _volumen(shape, vorzeichen=False):
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    g = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, g, 1e-4, False)
    return g.Mass() if vorzeichen else abs(g.Mass())


def _eingabe_ok(shape):
    """Gueltig und richtig orientiert (umgedrehte Huelle = negatives Volumen: der Bool rechnet dann
    still das Gegenteil, z. B. Schnittmenge statt Abziehen)."""
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer
    if not BRepCheck_Analyzer(shape).IsValid():
        return False
    # Flaechenkoerper (Schalen ohne Volumen) haben kein Vorzeichen
    return not TopExp_Explorer(shape, TopAbs_SOLID).More() or _volumen(shape, True) > 0


def _diagonale(*shapes):
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib
    box = Bnd_Box()
    for s in shapes:
        BRepBndLib.Add_s(s, box)
    if box.IsVoid():
        return 1.0
    x0, y0, z0, x1, y1, z1 = box.Get()
    return max(float(np.linalg.norm([x1 - x0, y1 - y0, z1 - z0])), 1e-6)


def _repariert(shape):
    from OCP.ShapeFix import ShapeFix_Shape
    f = ShapeFix_Shape(shape)
    f.Perform()
    return f.Shape()


def _bool_lauf(ziel, werkzeug, operation, fuzzy=0.0):
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
    from OCP.TopTools import TopTools_ListOfShape
    op = {"abziehen": BRepAlgoAPI_Cut, "schneiden": BRepAlgoAPI_Common}.get(operation, BRepAlgoAPI_Fuse)()
    a, b = TopTools_ListOfShape(), TopTools_ListOfShape()
    a.Append(ziel)
    b.Append(werkzeug)
    op.SetArguments(a)
    op.SetTools(b)
    op.SetRunParallel(True)
    if fuzzy > 0:
        op.SetFuzzyValue(fuzzy)
    op.Build()
    if not op.IsDone():
        return None
    erg = op.Shape()
    return None if erg.IsNull() else erg


def _bool_pruefen(erg, va, vb, operation, tol):
    """Ergebnis gueltig (BRepCheck) und das Volumen plausibel? -> Fehlertext oder None."""
    from OCP.BRepCheck import BRepCheck_Analyzer
    if erg is None:
        return "nicht berechenbar"
    if not BRepCheck_Analyzer(erg).IsValid():
        return "ungültige Topologie"
    v = _volumen(erg)
    t = tol * max(va, vb, 1e-9) + 1e-9
    if operation == "abziehen" and not (-t <= v <= va + t):
        return "Volumen unplausibel"
    if operation == "schneiden" and v > min(va, vb) + t:
        return "Volumen unplausibel"
    if operation == "vereinen" and not (max(va, vb) - t <= v <= va + vb + t):
        return "Volumen unplausibel"
    return None


def boolean(ziel, werkzeug, operation, info=None):
    """Vereinen | abziehen | schneiden mit Rueckfallebene: 1. normal, 2. Eingaben mit ShapeFix repariert,
    3. mit wachsender Unschaerfe (Fuzzy, 1e-6 .. 1e-4 der Diagonale - fast beruehrende/koplanare Flaechen),
    4. Ergebnis nachtraeglich repariert. Jede Stufe wird auf gueltige Topologie und plausibles Volumen
    geprueft. info (dict) bekommt "stufe" und ggf. "fuzzy" - fuer die Meldung."""
    va, vb = _volumen(ziel), _volumen(werkzeug)
    diag = _diagonale(ziel, werkzeug)
    gruende = []
    rep = {}

    def repariert():
        if not rep:
            rep["z"], rep["w"] = _repariert(ziel), _repariert(werkzeug)
        return rep["z"], rep["w"]
    stufen = [("repariert", repariert, 0.0)] + [("unscharf", repariert, f * diag) for f in (1e-6, 1e-5, 1e-4)]
    if _eingabe_ok(ziel) and _eingabe_ok(werkzeug):
        stufen.insert(0, ("normal", lambda: (ziel, werkzeug), 0.0))
    else:
        gruende.append("normal: Eingangskörper ungültig oder umgedreht")
    letzter = None
    for name, eingaben, fz in stufen:
        try:
            erg = _bool_lauf(*eingaben(), operation, fz)
        except Exception as x:          # OCCT wirft bei kaputten Eingaben auch Standard_Failure
            erg, grund = None, "Ausnahme: %s" % x
        else:
            grund = _bool_pruefen(erg, va, vb, operation, 1e-3 if fz == 0 else 1e-2)
        if grund is None:
            if info is not None:
                info.update({"stufe": name, "fuzzy": fz, "gruende": gruende})
            return _vereinheitlichen(erg)
        gruende.append("%s: %s" % (name, grund))
        if erg is not None:
            letzter = erg
    if letzter is not None:
        erg = _repariert(letzter)
        if _bool_pruefen(erg, va, vb, operation, 1e-2) is None:
            if info is not None:
                info.update({"stufe": "nachrepariert", "fuzzy": 0.0, "gruende": gruende})
            return _vereinheitlichen(erg)
    raise ValueError("Boolean-Operation (%s) ist fehlgeschlagen – auch mit Reparatur und Toleranz (%s)."
                     % (operation, "; ".join(gruende[-2:])))


def _vereinheitlichen(erg):
    try:
        from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
        u = ShapeUpgrade_UnifySameDomain(erg, True, True, False)
        u.Build()
        neu = u.Shape()
        if not neu.IsNull():
            erg = neu
    except Exception:
        pass
    return erg


# --- Kennwerte, Netz -----------------------------------------------------------------------------
def kennwerte(shape):
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    # adaptiv mit relativer Genauigkeit 1e-5: bei Freiform-Koerpern 10x schneller als die
    # feste Gauss-Integration, bei Grundkoerpern exakt wie vorher
    g = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, g, 1e-5, False)
    gf = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape, gf, 1e-5, False)
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    if box.IsVoid():
        groesse = [0.0, 0.0, 0.0]
    else:
        x0, y0, z0, x1, y1, z1 = box.Get()
        groesse = [x1 - x0, y1 - y0, z1 - z0]
    return {"volumen": abs(float(g.Mass())), "groesse": [float(x) for x in groesse],
            "flaeche": abs(float(gf.Mass()))}


def _raster_flaeche(face, schritt):
    """Unbeschnittene B-Spline-Flaeche -> (punkte, dreiecke) ueber ein gleichmaessiges
    Parameterraster, sonst None. Sehnenfehler ~ schritt²/(8·Kruemmungsradius)."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepTools import BRepTools
    from OCP.Geom import Geom_BSplineSurface
    s = BRep_Tool.Surface_s(face)
    if not isinstance(s, Geom_BSplineSurface):
        return None
    u0, u1, v0, v1 = BRepTools.UVBounds_s(face)
    su0, su1, sv0, sv1 = s.Bounds()
    tol = 1e-7 * max(1.0, abs(su1 - su0), abs(sv1 - sv0))
    if abs(u0 - su0) > tol or abs(u1 - su1) > tol or abs(v0 - sv0) > tol or abs(v1 - sv1) > tol:
        return None

    def laenge(entlang_u):
        m = 0.0
        for k in (0.0, 0.5, 1.0):
            pts = []
            for t in np.linspace(0, 1, 9):
                u, v = (u0 + t * (u1 - u0), v0 + k * (v1 - v0)) if entlang_u else (u0 + k * (u1 - u0), v0 + t * (v1 - v0))
                q = s.Value(u, v)
                pts.append((q.X(), q.Y(), q.Z()))
            m = max(m, float(np.linalg.norm(np.diff(np.array(pts), axis=0), axis=1).sum()))
        return m
    nu = int(np.clip(np.ceil(laenge(True) / schritt) + 1, 4, 300))
    nv = int(np.clip(np.ceil(laenge(False) / schritt) + 1, 4, 300))
    us, vs = np.linspace(u0, u1, nu), np.linspace(v0, v1, nv)
    p = np.empty((nu * nv, 3))
    k = 0
    for u in us:
        for v in vs:
            q = s.Value(u, v)
            p[k] = (q.X(), q.Y(), q.Z())
            k += 1
    i, j = np.meshgrid(np.arange(nu - 1), np.arange(nv - 1), indexing="ij")
    a = (i * nv + j).ravel()
    b, c, d = a + nv, a + nv + 1, a + 1
    t = np.concatenate([np.c_[a, b, c], np.c_[a, c, d]]).astype(np.int64)
    return p, t


def vernetzen(shape, fein=False):
    """-> {xyz float32 (n,3), tri uint32 (m,3), kanten float32 (k,2,3)}.
    Toleranz relativ zur Groesse; vernetzt wird eine Kopie. fein=True fuer Messungen
    (Abweichung): Sehnenfehler an R10 ~0,003 mm statt ~0,08 mm."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.GCPnts import GCPnts_TangentialDeflection
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED
    from OCP.TopExp import TopExp, TopExp_Explorer
    from OCP.TopLoc import TopLoc_Location
    from OCP.TopoDS import TopoDS
    from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape

    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    diag = 1e-3 if box.IsVoid() else max(float(np.sqrt(box.SquareExtent())), 1e-3)
    lin = max(diag * 4e-4, 0.002)
    ang = 0.25
    if fein:
        lin, ang = max(diag * 2e-5, 0.001), 0.05
    kopie = BRepBuilderAPI_Copy(shape, True, False).Shape()
    # Unbeschnittene B-Spline-Flaechen (Freiform) selbst ueber ein Parameterraster zerlegen -
    # BRepMesh braucht dafuer bei feiner Toleranz Minuten; alle anderen Flaechen einzeln mit BRepMesh
    schritt = max(0.25, diag / 600) if fein else max(1.0, diag / 120)
    from OCP.TopTools import TopTools_IndexedMapOfShape as _Map
    fmap = _Map()
    TopExp.MapShapes_s(kopie, TopAbs_FACE, fmap)
    raster_flaechen = {}
    ex = TopExp_Explorer(kopie, TopAbs_FACE)
    while ex.More():
        f = TopoDS.Face_s(ex.Current())
        g = _raster_flaeche(f, schritt)
        if g is not None:
            raster_flaechen[fmap.FindIndex(f)] = g
        else:
            BRepMesh_IncrementalMesh(f, lin, False, ang, True)
        ex.Next()
    punkte, dreiecke, versatz, tri_flaeche = [], [], 0, []
    ex = TopExp_Explorer(kopie, TopAbs_FACE)
    while ex.More():
        flaeche = TopoDS.Face_s(ex.Current())
        g = raster_flaechen.get(fmap.FindIndex(flaeche))
        if g is not None:
            p, t = g
            if flaeche.Orientation() == TopAbs_REVERSED:
                t = t[:, [0, 2, 1]]
            punkte.append(p)
            dreiecke.append(t + versatz)
            tri_flaeche.append(np.full(len(t), fmap.FindIndex(flaeche), np.uint32))
            versatz += len(p)
            ex.Next()
            continue
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(flaeche, loc)
        if tri is not None and tri.NbTriangles():
            trsf = loc.Transformation()
            n = tri.NbNodes()
            p = np.empty((n, 3))
            for i in range(1, n + 1):
                q = tri.Node(i).Transformed(trsf)
                p[i - 1] = (q.X(), q.Y(), q.Z())
            t = np.array([tri.Triangle(i).Get() for i in range(1, tri.NbTriangles() + 1)],
                         np.int64) - 1
            if flaeche.Orientation() == TopAbs_REVERSED:
                t = t[:, [0, 2, 1]]
            punkte.append(p)
            dreiecke.append(t + versatz)
            tri_flaeche.append(np.full(len(t), fmap.FindIndex(flaeche), np.uint32))
            versatz += n
        ex.Next()

    # sichtbare Kanten: ohne entartete (Kugelpole) und ohne Nahtkanten
    karte = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(kopie, TopAbs_EDGE, TopAbs_FACE, karte)
    # Kanten-Nummer wie features.kanten_karte(Original) - die Kopie hat dieselbe Reihenfolge
    from OCP.TopTools import TopTools_IndexedMapOfShape
    kmap = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(kopie, TopAbs_EDGE, kmap)
    segmente, seg_id = [], []
    for i in range(1, karte.Extent() + 1):
        kante = TopoDS.Edge_s(karte.FindKey(i))
        if BRep_Tool.Degenerated_s(kante):
            continue
        naht = False
        for f in karte.FindFromIndex(i):
            if BRep_Tool.IsClosed_s(kante, TopoDS.Face_s(f)):
                naht = True
                break
        if naht:
            continue
        try:
            kurve = BRepAdaptor_Curve(kante)
            disk = GCPnts_TangentialDeflection(kurve, ang, lin)
        except Exception:
            continue
        if disk.NbPoints() < 2:
            continue
        pp = np.array([[v.X(), v.Y(), v.Z()] for v in
                       (disk.Value(j) for j in range(1, disk.NbPoints() + 1))])
        segmente.append(np.stack([pp[:-1], pp[1:]], 1))
        seg_id.append(np.full(len(pp) - 1, kmap.FindIndex(kante), np.uint32))
    return {"xyz": (np.concatenate(punkte) if punkte else np.zeros((0, 3))).astype(np.float32),
            "tri": (np.concatenate(dreiecke) if dreiecke else np.zeros((0, 3), np.int64)).astype(np.uint32),
            "kanten": (np.concatenate(segmente) if segmente else np.zeros((0, 2, 3))).astype(np.float32),
            "kanten_id": (np.concatenate(seg_id) if seg_id else np.zeros(0)).astype(np.uint32),
            "flaechen_id": (np.concatenate(tri_flaeche) if tri_flaeche else np.zeros(0)).astype(np.uint32)}


# --- Abweichung Scan <-> Koerper (Design X "Accuracy Analyzer", QuickSurface "Compare") -----------
def abweichung(shapes, xyz):
    """Abstand jedes Punkts zur naechsten Koerperoberflaeche mit Vorzeichen (mm, float32):
    positiv = Punkt liegt ausserhalb (Scan hat mehr Material), negativ = innerhalb.
    Vorzeichen ueber die Normale am naechsten Punkt statt Strahl-Paritaet: die Flaechen
    aus vernetzen() sind je Flaeche einzeln trianguliert (Naehte nicht verschweisst)."""
    from .o3d import o3d
    netze = [vernetzen(s, fein=True) for s in shapes]
    xyz_k = np.concatenate([n["xyz"] for n in netze]) if netze else np.zeros((0, 3), np.float32)
    if not len(xyz_k):
        raise ValueError("Der Körper hat keine Oberfläche.")
    versatz, tris = 0, []
    for n in netze:
        tris.append(n["tri"].astype(np.int64) + versatz)
        versatz += len(n["xyz"])
    tri = np.concatenate(tris).astype(np.uint32)
    szene = o3d.t.geometry.RaycastingScene()
    szene.add_triangles(o3d.core.Tensor(xyz_k.astype(np.float32)), o3d.core.Tensor(tri))
    q = o3d.core.Tensor(np.ascontiguousarray(xyz, np.float32))
    erg = szene.compute_closest_points(q)
    # Open3D greift bei faecherfoermig vernetzten Planflaechen (lange, schmale Dreiecke)
    # manchmal das Nachbardreieck (Fehler bis ~0,01 mm) -> alle Dreiecke um die drei
    # Ecken des gefundenen exakt (float64) nachrechnen und das naechste nehmen
    ids = erg["primitive_ids"].numpy().astype(np.int64)
    X = xyz_k.astype(np.float64)
    T = tri.astype(np.int64)
    p = np.asarray(xyz, np.float64)
    bester = ids.copy()
    e = X[T[ids]]
    diff = p - _naechster_punkt_dreieck(p, e[:, 0], e[:, 1], e[:, 2])
    abst = np.linalg.norm(diff, axis=1)
    # liegt der naechste Punkt im Dreiecksinneren, steht diff senkrecht -> schon exakt;
    # nur Punkte mit Fusspunkt auf Kante/Ecke nachrechnen
    n_hat = np.cross(e[:, 1] - e[:, 0], e[:, 2] - e[:, 0])
    n_hat /= np.maximum(np.linalg.norm(n_hat, axis=1, keepdims=True), 1e-30)
    seitlich = np.linalg.norm(diff - np.einsum("ij,ij->i", diff, n_hat)[:, None] * n_hat, axis=1)
    pruefen = np.nonzero(seitlich > 1e-6 + 1e-6 * abst)[0]
    # Ecke -> Dreiecke (CSR)
    ecke = T.ravel()
    ordnung = np.argsort(ecke, kind="stable")
    tri_von = ordnung // 3
    start = np.searchsorted(ecke[ordnung], np.arange(len(X)))
    grad = np.bincount(ecke, minlength=len(X))
    for k in range(3):
        v = T[ids[pruefen], k]
        g, s0 = grad[v], start[v]
        for j in range(int(g.max()) if len(g) else 0):
            sub = np.nonzero(g > j)[0]
            m = pruefen[sub]
            kand = tri_von[s0[sub] + j]
            e = X[T[kand]]
            d = np.linalg.norm(p[m] - _naechster_punkt_dreieck(p[m], e[:, 0], e[:, 1], e[:, 2]), axis=1)
            besser = d < abst[m]
            abst[m[besser]] = d[besser]
            bester[m[besser]] = kand[besser]
    e = X[T[bester]]
    naechst = _naechster_punkt_dreieck(p, e[:, 0], e[:, 1], e[:, 2])
    nrm = np.cross(e[:, 1] - e[:, 0], e[:, 2] - e[:, 0])
    diff = p - naechst
    vz = np.where(np.einsum("ij,ij->i", diff, nrm) < 0, -1.0, 1.0)
    return (np.linalg.norm(diff, axis=1) * vz).astype(np.float32)


def _naechster_punkt_dreieck(p, a, b, c):
    """Naechster Punkt auf Dreieck (a,b,c) je Zeile, vektorisiert
    (Ericson, Real-Time Collision Detection 5.1.5)."""
    ab, ac, ap = b - a, c - a, p - a
    d1 = np.einsum("ij,ij->i", ab, ap)
    d2 = np.einsum("ij,ij->i", ac, ap)
    bp = p - b
    d3 = np.einsum("ij,ij->i", ab, bp)
    d4 = np.einsum("ij,ij->i", ac, bp)
    cp = p - c
    d5 = np.einsum("ij,ij->i", ab, cp)
    d6 = np.einsum("ij,ij->i", ac, cp)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    with np.errstate(divide="ignore", invalid="ignore"):
        # Inneres
        nenner = va + vb + vc
        v = vb / nenner
        w = vc / nenner
        erg = a + ab * v[:, None] + ac * w[:, None]
        # Kante BC
        m = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
        t = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        erg = np.where(m[:, None], b + (c - b) * t[:, None], erg)
        # Kante AC
        m = (vb <= 0) & (d2 >= 0) & (d6 <= 0)
        t = d2 / (d2 - d6)
        erg = np.where(m[:, None], a + ac * t[:, None], erg)
        # Kante AB
        m = (vc <= 0) & (d1 >= 0) & (d3 <= 0)
        t = d1 / (d1 - d3)
        erg = np.where(m[:, None], a + ab * t[:, None], erg)
    # Ecken (Vorrang vor den Kanten)
    erg = np.where(((d6 >= 0) & (d5 <= d6))[:, None], c, erg)
    erg = np.where(((d3 >= 0) & (d4 <= d3))[:, None], b, erg)
    erg = np.where(((d1 <= 0) & (d2 <= 0))[:, None], a, erg)
    # entartete Dreiecke: Open3D-Punkt waere hier auch nicht besser -> Ecke a
    return np.where(np.isfinite(erg), erg, a)


def abweichung_kennwerte(werte, toleranz, ausblenden):
    """Statistik nur ueber Punkte mit Gegenstueck (|d| <= ausblenden)."""
    a = np.abs(werte)
    m = a <= ausblenden if ausblenden and ausblenden > 0 else np.ones(len(werte), bool)
    w = werte[m]
    if not len(w):
        return {"anzahl": 0, "ohne_gegenstueck": int(len(werte))}
    return {"anzahl": int(len(w)), "ohne_gegenstueck": int(len(werte) - len(w)),
            "mittel": round(float(w.mean()), 4), "std": round(float(w.std()), 4),
            "rms": round(float(np.sqrt(np.mean(w ** 2))), 4),
            "min": round(float(w.min()), 4), "max": round(float(w.max()), 4),
            "p95": round(float(np.percentile(np.abs(w), 95)), 4),
            "in_toleranz": round(float(np.mean(np.abs(w) <= toleranz) * 100), 2)}


# --- Speichern / Export ----------------------------------------------------------------------------
def brep_text(shape):
    from OCP.BRepTools import BRepTools
    from OCP.TopTools import TopTools_FormatVersion
    b = io.BytesIO()
    BRepTools.Write_s(shape, b, False, False, TopTools_FormatVersion.TopTools_FormatVersion_VERSION_1)
    return b.getvalue()


def aus_brep(daten):
    from OCP.BRep import BRep_Builder
    from OCP.BRepTools import BRepTools
    from OCP.TopoDS import TopoDS_Shape
    shape = TopoDS_Shape()
    BRepTools.Read_s(shape, io.BytesIO(daten), BRep_Builder())
    if shape.IsNull():
        raise ValueError("Körper in der Projektdatei ist beschädigt.")
    return shape


FORMATE = {"step": ".step", "stp": ".step", "iges": ".igs", "igs": ".igs"}


def stl_daten(shapes, fein=True):
    """Koerper -> binaere STL (druckfertig, mm). Feine Vernetzung (Sehnenfehler ~0,003 mm an R10)."""
    import struct
    teile = [vernetzen(s, fein=fein) for s in shapes]
    tris = []
    for n in teile:
        X = n["xyz"].astype(np.float32)
        tris.append(X[n["tri"].astype(np.int64)])
    T = np.concatenate(tris) if tris else np.zeros((0, 3, 3), np.float32)
    nrm = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-20)
    daten = np.zeros(len(T), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    daten["n"], daten["v"] = nrm, T
    return struct.pack("<80sI", b"V3D Scan STL (mm)", len(T)) + daten.tobytes()


def exportieren(shapes, fmt):
    """Liste von Shapes -> Dateiinhalt (bytes), Einheit mm."""
    fmt = (fmt or "step").lower()
    if fmt == "stl":
        if not shapes:
            raise ValueError("Kein Körper zum Exportieren.")
        return stl_daten(shapes)
    if fmt not in FORMATE:
        raise ValueError("Unbekanntes Format „%s“ (step oder iges)." % fmt)
    if not shapes:
        raise ValueError("Kein Körper zum Exportieren.")
    from OCP.IFSelect import IFSelect_RetDone
    with tempfile.TemporaryDirectory() as tmp:
        datei = os.path.join(tmp, "koerper" + FORMATE[fmt])
        if FORMATE[fmt] == ".step":
            from OCP.Interface import Interface_Static
            from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer
            Interface_Static.SetCVal_s("write.step.unit", "MM")
            w = STEPControl_Writer()
            for s in shapes:
                if w.Transfer(s, STEPControl_AsIs) != IFSelect_RetDone:
                    raise ValueError("STEP-Übertragung fehlgeschlagen.")
            ok = w.Write(datei) == IFSelect_RetDone
        else:
            from OCP.IGESControl import IGESControl_Writer
            w = IGESControl_Writer("MM", 1)          # 1 = BRep-Volumen (MSBO), nicht nur Flaechen
            for s in shapes:
                w.AddShape(s)
            w.ComputeModel()
            ok = bool(w.Write(datei))
        if not ok or not os.path.exists(datei):
            raise ValueError("Export (%s) fehlgeschlagen." % fmt.upper())
        with open(datei, "rb") as f:
            return f.read()


def einlesen(daten, fmt):
    """Gegenstueck zu exportieren (fuer Tests/spaeteren Import) -> Shape."""
    endung = FORMATE[(fmt or "step").lower()]
    with tempfile.TemporaryDirectory() as tmp:
        datei = os.path.join(tmp, "x" + endung)
        with open(datei, "wb") as f:
            f.write(daten)
        if endung == ".step":
            from OCP.STEPControl import STEPControl_Reader
            r = STEPControl_Reader()
        else:
            from OCP.IGESControl import IGESControl_Reader
            r = IGESControl_Reader()
        r.ReadFile(datei)
        r.TransferRoots()
        return r.OneShape()
