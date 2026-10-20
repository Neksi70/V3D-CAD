# Parametrischer Verlauf (QuickSurface "Rebuild", "Disable All Next / Enable to Here").
#
# Jeder Koerper fuehrt eine Liste von Schritten (Koerper.verlauf). Nachrechenbare Schritte tragen alle
# Eingaben (Skizzen-Id, Laengen, Radien …); Kanten/Flaechen werden ueber Bezugspunkte statt ueber
# Nummern wiedergefunden (die Nummern aendern sich, sobald vorher etwas anders gerechnet wird).
# Nicht nachrechenbare Schritte (Freiform, Import, Kombination mit einem anderen Koerper …) legen einen
# festen Zwischenstand ab (Koerper.basis = (index, shape)); nachgerechnet wird ab dort.

import numpy as np

from . import features as ft
from . import freiform as ff
from . import koerper as kp
from . import skizze as sk

# Schritte, die sich aus ihren Parametern neu rechnen lassen
NACHRECHENBAR = {"grundkoerper", "extrusion", "drehung", "loft", "sweep", "rohr", "wickeln", "rundung", "fase",
                 "runden", "fasen", "gewinde", "verschieben", "spiegeln", "muster", "schale", "skalieren",
                 "flaeche_verschieben", "flaechen_loeschen", "formschraege", "ebene_schneiden", "beschneiden",
                 "verlaengern", "projizieren", "extrusion_flaeche", "extrusion_3d"}


# --- Bezugspunkte ----------------------------------------------------------------------------------------
def kanten_bezug(shape, nummern):
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.TopoDS import TopoDS
    m = ft.kanten_karte(shape)
    aus = []
    for i in nummern:
        c = BRepAdaptor_Curve(TopoDS.Edge_s(m.FindKey(int(i))))
        q = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()))
        aus.append([q.X(), q.Y(), q.Z()])
    return aus


def flaechen_bezug(shape, nummern):
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.TopoDS import TopoDS
    m = ft.flaechen_karte(shape)
    aus = []
    for i in nummern:
        g = GProp_GProps()
        BRepGProp.SurfaceProperties_s(TopoDS.Face_s(m.FindKey(int(i))), g)
        c = g.CentreOfMass()
        aus.append([c.X(), c.Y(), c.Z()])
    return aus


def _naechste(punkte_ist, punkte_soll, art):
    nummern = []
    P = np.asarray(punkte_ist, float)
    for q in np.asarray(punkte_soll, float):
        d = np.linalg.norm(P - q, axis=1)
        i = int(np.argmin(d))
        if d[i] > max(1.0, 0.05 * float(np.ptp(P, axis=0).max())):
            raise ValueError("%s bei %s nicht mehr gefunden – der Körper hat sich zu stark geändert."
                             % (art, np.round(q, 2).tolist()))
        nummern.append(i + 1)
    return nummern


def kanten_finden(shape, bezug):
    m = ft.kanten_karte(shape)
    return _naechste(kanten_bezug(shape, range(1, m.Extent() + 1)), bezug, "Kante")


def flaechen_finden(shape, bezug):
    m = ft.flaechen_karte(shape)
    return _naechste(flaechen_bezug(shape, range(1, m.Extent() + 1)), bezug, "Fläche")


# --- Nachrechnen ------------------------------------------------------------------------------------------
def _werkzeug(e, projekt):
    """Werkzeugkoerper eines skizzen-/parametergetriebenen Schritts."""
    t = e["typ"]
    if t == "grundkoerper":
        return kp.baue(e["parameter"])
    if t in ("extrusion", "extrusion_flaeche"):
        skz = projekt.skizze_holen(e["skizze"])
        von, bis = e["von"], e["bis"]
        modus = e.get("modus")
        if modus == "laenge":
            L = e.get("laenge", bis - von)
            von, bis = (0.0, L) if not e.get("umkehren") else (-L, 0.0)
        elif modus == "mitte":
            L = e.get("laenge", bis - von)
            von, bis = -L / 2, L / 2
        elif modus == "beidseitig":
            von, bis = -e.get("laenge2", 0), e.get("laenge", bis)
        if t == "extrusion_flaeche":
            return ft.extrudieren_flaeche(skz, von, bis)
        if abs(e.get("schraege", 0) or 0) > 1e-9:
            return ft.extrudieren_schraeg(skz, von, bis, e["schraege"])
        return ft.extrudieren(skz, von, bis)
    if t == "extrusion_3d":
        z = projekt.skizze_holen(e["skizze"])
        return ft.extrudieren_3d(z, e.get("richtung", "mittel"), e.get("laenge", 20), e.get("beidseitig", True))
    if t == "drehung":
        el = e.get("element")
        return ft.drehen(projekt.skizze_holen(e["skizze"]), e.get("winkel", 360), None if el in (None, "") else int(el),
                         e.get("winkel2", 0))
    if t == "loft":
        return ft.loft([projekt.skizze_holen(s) for s in e["skizzen"]], e.get("glatt", True))
    if t == "sweep":
        return ft.sweep(projekt.skizze_holen(e["profil"]), projekt.skizze_holen(e["pfad"]))
    if t == "rohr":
        return ft.pipe(projekt.skizze_holen(e["pfad"]), e["radius"], e.get("innen", 0))
    if t == "wickeln":
        return ft.skizze_wickeln(projekt.skizze_holen(e["skizze"]), e["punkt"], e["achse"], e["radius"],
                                 e.get("dicke", 1), e.get("aussen", True))
    raise ValueError("Schritt „%s“ hat kein Werkzeug." % t)


def schritt(shape, e, projekt):
    """Einen Verlaufsschritt auf shape anwenden (shape None = erster Schritt)."""
    t = e["typ"]
    op = e.get("operation", "neu")
    if t in ("grundkoerper", "extrusion", "drehung", "loft", "sweep", "rohr", "wickeln", "extrusion_flaeche",
             "extrusion_3d"):
        w = _werkzeug(e, projekt)
        if shape is None or op == "neu":
            return w
        return kp.boolean(shape, w, op)
    if shape is None:
        raise ValueError("Schritt „%s“ braucht einen vorhandenen Körper." % e.get("name", t))
    if t in ("rundung", "fase", "runden", "fasen"):
        kanten = kanten_finden(shape, e["kanten_ref"])
        return ft.kanten_runden(shape, kanten, e["radius"], fase=t in ("fase", "fasen"))
    if t == "gewinde":
        w = ft.gewinde(e["start"], e["achse_v"], e["r"], e["laenge"], e["steigung"], e["aussen"])
        return kp.boolean(shape, w, "abziehen")
    if t == "verschieben":
        return ft.verschieben(shape, e.get("versatz") or (0, 0, 0), e.get("drehung") or (0, 0, 0))
    if t == "spiegeln":
        ebene = e.get("ebene", "yz")
        if isinstance(ebene, str) and ebene.startswith("ref:"):
            r = projekt.referenz_holen(int(ebene[4:]))
            ebene = (r["punkt"], r["normale"])
        return ft.spiegeln(shape, ebene, e.get("durch", "mitte"), e.get("vereinen", True))
    if t == "muster":
        return ft.muster(shape, e.get("art", "linear"), e.get("anzahl", 3), e.get("versatz") or (10, 0, 0),
                         e.get("achse", "z"), e.get("winkel", 360), e.get("punkt") or (0, 0, 0))
    if t == "schale":
        return ft.schale(shape, e["dicke"], flaechen_finden(shape, e.get("flaechen_ref") or []))
    if t == "skalieren":
        return ft.skalieren(shape, e["faktor"])
    if t == "flaeche_verschieben":
        return ft.flaeche_verschieben(shape, flaechen_finden(shape, e["flaechen_ref"]), e["abstand"])
    if t == "flaechen_loeschen":
        return ft.flaechen_loeschen(shape, flaechen_finden(shape, e["flaechen_ref"]))
    if t == "formschraege":
        return ft.formschraege(shape, flaechen_finden(shape, e["flaechen_ref"]), e["winkel"], e["richtung_v"])
    if t == "ebene_schneiden":
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
        from OCP.gp import gp_Dir, gp_Pln, gp_Pnt
        r = projekt.referenz_holen(e["referenz"])
        gross = 10 * max(kp.kennwerte(shape)["groesse"]) + 100
        f = BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(*map(float, r["punkt"])), gp_Dir(*map(float, r["normale"]))),
                                    -gross, gross, -gross, gross).Face()
        return ff.koerper_schneiden(shape, f, e.get("behalten", "unten"))
    if t == "beschneiden":
        from OCP.TopAbs import TopAbs_FACE
        from OCP.TopExp import TopExp_Explorer
        fk = projekt.koerper_holen(e["flaeche"])
        ex = TopExp_Explorer(fk.shape, TopAbs_FACE)
        return ff.koerper_schneiden(shape, ex.Current(), e.get("behalten", "unten"))
    if t == "verlaengern":
        return ft.flaeche_verlaengern(shape, e["laenge"])
    if t == "projizieren":
        return ft.skizze_auf_flaeche(shape, projekt.skizze_holen(e["skizze"]), e.get("behalten", "innen"))
    raise ValueError("Schritt „%s“ lässt sich nicht nachrechnen." % e.get("name", t))


def nachrechnen(projekt, k):
    """Koerper k ab seinem festen Zwischenstand neu rechnen; ausgeschaltete Schritte ('aus') werden
    uebersprungen. -> (shape, Anzahl gerechneter Schritte)."""
    start, shape = getattr(k, "basis", None) or (-1, None)
    n = 0
    for i, e in enumerate(k.verlauf):
        if i <= start or e.get("aus"):
            continue
        if e.get("typ") not in NACHRECHENBAR:
            raise ValueError("Schritt „%s“ ist fest (nicht nachrechenbar) – Verlauf davor ist eingefroren."
                             % e.get("name"))
        try:
            shape = schritt(shape, e, projekt)
        except Exception as ex:
            raise ValueError("Schritt „%s“: %s" % (e.get("name"), ex))
        n += 1
    if shape is None:
        raise ValueError("Alle Schritte sind ausgeschaltet.")
    return shape, n


def nutzt_skizze(k, sid):
    sid = int(sid)
    for e in k.verlauf:
        if e.get("skizze") == sid or e.get("profil") == sid or e.get("pfad") == sid or sid in (e.get("skizzen") or []):
            return True
    return False
