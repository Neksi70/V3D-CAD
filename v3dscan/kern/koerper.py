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

    def kopie(self):
        k = Koerper(self.id, self.name, self.shape, [dict(v) for v in self.verlauf],
                    self.sichtbar, self.rev)
        k._cache = self._cache
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
                "verlauf": [{"name": v["name"]} for v in self.verlauf],
                "volumen": round(d["volumen"], 3), "groesse": [round(x, 3) for x in d["groesse"]]}


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


def boolean(ziel, werkzeug, operation):
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
    op = BRepAlgoAPI_Cut(ziel, werkzeug) if operation == "abziehen" else BRepAlgoAPI_Fuse(ziel, werkzeug)
    if not op.IsDone():
        raise ValueError("Boolean-Operation (%s) ist fehlgeschlagen." % operation)
    erg = op.Shape()
    try:
        from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
        u = ShapeUpgrade_UnifySameDomain(erg, True, True, False)
        u.Build()
        erg = u.Shape()
    except Exception:
        pass
    if erg.IsNull():
        raise ValueError("Boolean-Operation lieferte keinen Körper.")
    return erg


# --- Kennwerte, Netz -----------------------------------------------------------------------------
def kennwerte(shape):
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    g = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, g)
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    if box.IsVoid():
        groesse = [0.0, 0.0, 0.0]
    else:
        x0, y0, z0, x1, y1, z1 = box.Get()
        groesse = [x1 - x0, y1 - y0, z1 - z0]
    return {"volumen": abs(float(g.Mass())), "groesse": [float(x) for x in groesse]}


def vernetzen(shape):
    """-> {xyz float32 (n,3), tri uint32 (m,3), kanten float32 (k,2,3)}.
    Toleranz relativ zur Groesse; vernetzt wird eine Kopie."""
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

    groesse = kennwerte(shape)["groesse"]
    diag = max(float(np.linalg.norm(groesse)), 1e-3)
    lin = max(diag * 4e-4, 0.002)
    ang = 0.25
    kopie = BRepBuilderAPI_Copy(shape, True, False).Shape()
    BRepMesh_IncrementalMesh(kopie, lin, False, ang, True)
    punkte, dreiecke, versatz = [], [], 0
    ex = TopExp_Explorer(kopie, TopAbs_FACE)
    while ex.More():
        flaeche = TopoDS.Face_s(ex.Current())
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
            versatz += n
        ex.Next()

    # sichtbare Kanten: ohne entartete (Kugelpole) und ohne Nahtkanten
    karte = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(kopie, TopAbs_EDGE, TopAbs_FACE, karte)
    segmente = []
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
    return {"xyz": (np.concatenate(punkte) if punkte else np.zeros((0, 3))).astype(np.float32),
            "tri": (np.concatenate(dreiecke) if dreiecke else np.zeros((0, 3), np.int64)).astype(np.uint32),
            "kanten": (np.concatenate(segmente) if segmente else np.zeros((0, 2, 3))).astype(np.float32)}


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


def exportieren(shapes, fmt):
    """Liste von Shapes -> Dateiinhalt (bytes), Einheit mm."""
    fmt = (fmt or "step").lower()
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
