# Verlauf eines Koerpers -> Befehlsfolge fuer V3D CAD (dessen Befehls-Schnittstelle: sketch.extrude, revolve,
# shape.add, body.transform, body.mirror, body.pattern, bool.*), damit der Koerper dort parametrisch als
# Bauplan weiterlebt statt als totes STEP.
#
# Format: {"format": "v3dscan-bauplan", "version": 1, "befehle": [{"befehl", "params", "als"?}], "hinweise",
#          "vollstaendig", "volumen"}. Ein Wert "@name" in params steht fuer die id des Koerpers, den ein
# frueherer Befehl mit "als": "name" erzeugt hat (V3D CAD vergibt ids selbst; join/cut/bool liefern neue).
#
# Uebersetzbar: Extrusion (neu/vereinen/abziehen) auf Skizzen parallel zu XY/XZ/YZ, Drehung 360 Grad um eine
# Achse parallel Z, Grundkoerper (Zylinder/Kegel mit Achse Z, Kugel), Verschieben/Drehen, Spiegeln an
# Weltebenen, lineares/Kreis-Muster um Z mit 360 Grad. Alles andere (Rundung nach Bool, Freiform, Loft …)
# -> der ganze Koerper als STEP-Import (vollstaendig = False, Hinweis nennt den Schritt).

import base64
import math

import numpy as np

from . import features as ft
from . import koerper as kp
from . import skizze as sk

_EBENEN = {"XY": (2, (0, 1)), "XZ": (1, (0, 2)), "YZ": (0, (1, 2))}    # Normalenachse, 2D-Achsen


class NichtUebersetzbar(Exception):
    pass


def _ebene_cad(E):
    n = E["n"]
    for name, (achse, _) in _EBENEN.items():
        if abs(abs(n[achse]) - 1) < 1e-6:
            return name, achse
    raise NichtUebersetzbar("Skizzenebene liegt schräg (V3D CAD skizziert nur auf XY/XZ/YZ)")


def _konturen(skz, ebene):
    """Geschlossene Ketten (ohne Hilfslinien) -> V3D-CAD-Skizzenelemente in dessen 2D-Koordinaten."""
    E = sk.ebene_lesen(skz["ebene"])
    i, j = _EBENEN[ebene][1]

    def p2(q):
        P = sk.zu3d(q, E)[0]
        return [round(float(P[i]), 6), round(float(P[j]), 6)]
    els = []
    for k, kette in enumerate(skz["ketten"]):
        if kette.get("hilfe") or not kette.get("geschlossen"):
            continue
        for m, e in enumerate(kette["elemente"]):
            e = sk.element_lesen(e)
            nid = "k%de%d" % (k, m)
            if e["typ"] == "linie":
                els.append({"id": nid, "type": "line", "a": p2(e["a"]), "b": p2(e["b"])})
            elif e["typ"] == "kreis":
                els.append({"id": nid, "type": "circle", "c": p2(e["mitte"]), "r": round(float(e["r"]), 6)})
            elif e["typ"] == "bogen":
                c, a, mm, b = (np.array(p2(x)) for x in (e["mitte"], e["a"], e["m"], e["b"]))
                w = [math.degrees(math.atan2(*(x - c)[::-1])) % 360 for x in (a, mm, b)]
                ccw = (w[1] - w[0]) % 360 <= (w[2] - w[0]) % 360      # a -> m -> b gegen den Uhrzeigersinn?
                a0, a1 = (w[0], w[2]) if ccw else (w[2], w[0])
                a1 = a0 + ((a1 - a0) % 360)             # V3D CAD: a1 > a0, gegen den Uhrzeigersinn
                els.append({"id": nid, "type": "arc", "c": [round(float(x), 6) for x in c],
                            "r": round(float(e["r"]), 6), "a0": round(a0, 6), "a1": round(a1, 6)})
            else:                                   # Spline: als Linienzug (V3D CAD kennt keine Splines)
                P = sk.diskret(e)
                for n_, (a, b) in enumerate(zip(P[:-1], P[1:])):
                    els.append({"id": "%ss%d" % (nid, n_), "type": "line", "a": p2(a), "b": p2(b)})
    if not els:
        raise NichtUebersetzbar("Skizze hat keine geschlossene Kontur")
    return els


def _extrusion(e, skz, von, bis):
    E = sk.ebene_lesen(skz["ebene"])
    ebene, achse = _ebene_cad(E)
    if abs(e.get("schraege", 0) or 0) > 1e-9:
        raise NichtUebersetzbar("Extrusion mit Formschräge")
    lo = float(E["ursprung"][achse] + E["n"][achse] * von)
    hi = float(E["ursprung"][achse] + E["n"][achse] * bis)
    lo, hi = min(lo, hi), max(lo, hi)
    # V3D CAD: XY ab offset nach +Z, YZ ab offset nach +X, XZ ab Y = -offset nach -Y
    offset = -hi if ebene == "XZ" else lo
    return {"sketch": {"entities": _konturen(skz, ebene), "constraints": []}, "height": round(hi - lo, 6),
            "plane": ebene, "offset": round(offset, 6)}


def _von_bis(e):
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
    return von, bis


def _drehung(e, skz):
    if abs(float(e.get("winkel", 360)) - 360) > 1e-6 or abs(float(e.get("winkel2", 0) or 0)) > 1e-6:
        raise NichtUebersetzbar("Drehung unter 360°")
    el = e.get("element")
    p, d = ft.drehachse(skz, None if el in (None, "") else int(el))
    if abs(abs(d[2]) - 1) > 1e-6:
        raise NichtUebersetzbar("Drehachse nicht senkrecht (V3D CAD dreht nur um Z)")
    zu = [k for k in skz["ketten"] if k.get("geschlossen") and not k.get("hilfe")]
    if len(zu) != 1:
        raise NichtUebersetzbar("Drehprofil mit mehreren Konturen")
    E = sk.ebene_lesen(skz["ebene"])
    P = sk.zu3d(sk.kette_polygon({"elemente": [sk.element_lesen(x) for x in zu[0]["elemente"]]}), E)
    r = np.linalg.norm((P - p)[:, :2], axis=1)
    profil = [[round(float(a), 5), round(float(b), 5)] for a, b in zip(r, P[:, 2])]
    return {"profile": profil, "center": [round(float(p[0]), 6), round(float(p[1]), 6)]}


def _grundkoerper(par):
    if par["art"] == "kugel":
        r = par["radius"]
        return {"type": "sphere", "size": [2 * r] * 3, "center": list(map(float, par["mitte"]))}
    a = np.asarray(par["achse"], float)
    a = a / np.linalg.norm(a)
    if abs(abs(a[2]) - 1) > 1e-6 or par["art"] != "zylinder":
        raise NichtUebersetzbar("Grundkörper %s mit schräger Achse" % par["art"])
    b = np.asarray(par["basis"], float)
    h = float(par["hoehe"])
    mitte = b + a * h / 2
    r = float(par["radius"])
    return {"type": "cylinder", "size": [2 * r, 2 * r, h], "center": [float(x) for x in mitte]}


def bauplan(projekt, k):
    """Koerper k -> Befehlsfolge (siehe oben)."""
    befehle, hinweise = [], []
    zaehler = [0]

    def neu_name():
        zaehler[0] += 1
        return "t%d" % zaehler[0]

    def kombiniere(werkzeug_befehle, op):
        """Werkzeug bauen (als neuer Koerper), dann mit @k verknuepfen."""
        befehle.extend(werkzeug_befehle)
        w = werkzeug_befehle[-1]["als"]
        if op == "vereinen":
            befehle.append({"befehl": "bool.union", "params": {"ids": ["@k", "@" + w]}, "als": "k"})
        else:
            befehle.append({"befehl": "bool.subtract", "params": {"target": "@k", "tools": ["@" + w]}, "als": "k"})
    try:
        if getattr(k, "basis", None) is not None:
            raise NichtUebersetzbar("Der Körper beginnt mit einem festen Stand (Import/Freiform/Kombination)")
        da = False
        for e in k.verlauf:
            if e.get("aus"):
                continue
            t = e["typ"]
            op = e.get("operation", "neu")
            if t == "extrusion":
                von, bis = _von_bis(e)
                par = _extrusion(e, projekt.skizze_holen(e["skizze"]), von, bis)
                if not da or op == "neu":
                    befehle.append({"befehl": "sketch.extrude", "params": dict(par, name=k.name), "als": "k"})
                else:
                    befehle.append({"befehl": "sketch.extrude", "params": dict(
                        par, op="join" if op == "vereinen" else "cut", target="@k"), "als": "k"})
            elif t in ("drehung", "grundkoerper"):
                if t == "drehung":
                    b = {"befehl": "revolve", "params": _drehung(e, projekt.skizze_holen(e["skizze"]))}
                else:
                    b = {"befehl": "shape.add", "params": _grundkoerper(e["parameter"])}
                if not da or op == "neu":
                    b["als"] = "k"
                    befehle.append(b)
                else:
                    b["als"] = neu_name()
                    kombiniere([b], op)
            elif not da:
                raise NichtUebersetzbar("Schritt „%s“ braucht einen Körper davor" % e.get("name", t))
            elif t == "verschieben":
                befehle.append({"befehl": "body.transform", "params": {
                    "id": "@k", "move": list(map(float, e.get("versatz") or (0, 0, 0))),
                    "rotate": list(map(float, e.get("drehung") or (0, 0, 0)))}})
            elif t == "spiegeln":
                ebene = e.get("ebene", "yz")
                if not isinstance(ebene, str) or ebene.startswith("ref:"):
                    raise NichtUebersetzbar("Spiegeln an einer Referenzebene")
                p = {"id": "@k", "plane": ebene.upper()}
                if e.get("durch", "mitte") != "mitte":
                    p["at"] = 0.0
                if e.get("vereinen", True):
                    s = neu_name()
                    befehle.append({"befehl": "body.mirror", "params": dict(p, copy=True), "als": s})
                    befehle.append({"befehl": "bool.union", "params": {"ids": ["@k", "@" + s]}, "als": "k"})
                else:
                    befehle.append({"befehl": "body.mirror", "params": p})
            elif t == "muster":
                art = e.get("art", "linear")
                n = int(e.get("anzahl", 3))
                if art == "linear":
                    p = {"linear": {"count": n, "step": list(map(float, e.get("versatz") or (10, 0, 0)))}}
                elif art == "kreis" and e.get("achse", "z") == "z" and abs(float(e.get("winkel", 360)) - 360) < 1e-6:
                    p = {"circular": {"count": n, "axis": "Z", "center": list(map(float, e.get("punkt") or (0, 0, 0)))}}
                else:
                    raise NichtUebersetzbar("Muster „%s“" % art)
                befehle.append({"befehl": "body.pattern", "params": dict(p, id="@k", union=True), "als": "k"})
            else:
                raise NichtUebersetzbar("Schritt „%s“ (%s)" % (e.get("name", t), t))
            da = True
        if not da:
            raise NichtUebersetzbar("Kein Verlauf")
        vollstaendig = True
    except NichtUebersetzbar as x:
        hinweise.append("Nicht als Bauplan übertragbar: %s – der Körper kommt als STEP (ohne Verlauf)." % x)
        daten = kp.exportieren([k.shape], "step")
        befehle = [{"befehl": "file.import", "params": {
            "name": "%s.step" % k.name, "base64": base64.b64encode(daten).decode("ascii")}, "als": "k"}]
        vollstaendig = False
    return {"format": "v3dscan-bauplan", "version": 1, "koerper": k.name, "befehle": befehle,
            "hinweise": hinweise, "vollstaendig": vollstaendig,
            "volumen": round(float(kp.kennwerte(k.shape)["volumen"]), 3)}
