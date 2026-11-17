"""Messplan (v1.6): Maße zwischen erkannten/eingepassten Elementen mit Nennmaß ± Toleranz,
Form- und Lagetoleranzen (GD&T) mit Bezug, Abweichung gegen ein einzelnes Element, Bericht.

Elemente sind die Bereiche aus erkennung.py (JSON, wie sie die Oberfläche bekommt); ihre
Scanpunkte sind die mit labels == id. Gespeichert werden nur die Definitionen der Einträge –
die Werte rechnet auswerten() jedes Mal neu, damit sie nach einer neuen Erkennung oder einem
nachgepassten Element stimmen.

Toleranzzonen (vereinfachte, für Scans übliche Auswertung – wie Formabweichung in erkennung.py
ohne die äußersten 0,5 % der Punkte):
- Form (Ebenheit, Zylinderform, Kugelform, Kegelform): Spannweite der Abstände zur Ausgleichsform.
- Parallelität / Rechtwinkligkeit / Neigung einer Fläche: Spannweite ihrer Punkte senkrecht zur
  ideal ausgerichteten Ebene (Richtung aus dem Bezug).
- … einer Achse: Endpunkte der Achse über die Elementhöhe; Zonendurchmesser bzw. -breite aus deren
  Versatz quer zur Sollrichtung (abgeleitete Mittellinie als Gerade).
- Koaxialität: 2 × größter Abstand der Achsen-Endpunkte von der Bezugsachse (Zonendurchmesser).
"""
import math

import numpy as np

from . import erkennung as er

# --- Arten ---------------------------------------------------------------------------------------
MASSE = {
    "auto": "automatisch",
    "abstand": "Abstand",
    "winkel": "Winkel",
    "durchmesser": "Durchmesser",
    "radius": "Radius",
    "kegelwinkel": "Kegelwinkel",
    "spalt": "Spalt (Kugel–Kugel)",
    "spannweite": "Spannweite (Kugel–Kugel)",
}
TOLERANZEN = {
    "ebenheit": "Ebenheit",
    "zylinderform": "Zylinderform",
    "kugelform": "Kugelform",
    "kegelform": "Kegelform",
    "parallelitaet": "Parallelität",
    "rechtwinkligkeit": "Rechtwinkligkeit",
    "neigung": "Neigung",
    "koaxialitaet": "Koaxialität",
}
FORM_FUER = {"ebenheit": "ebene", "zylinderform": "zylinder", "kugelform": "kugel", "kegelform": "kegel"}
PARALLEL_GRAD = 10.0          # bis hierhin gelten zwei Richtungen als „parallel“ (Abstand statt Winkel)


class MessFehler(ValueError):
    pass


def _einheit(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def name(el):
    return "%s %d" % (er.TYP_NAMEN.get(el.get("typ"), (el.get("art", "?").capitalize(),))[0], int(el["id"]) + 1)


def geom(el):
    """JSON-Element → Geometrie mit numpy-Feldern + Ort/Richtung."""
    g = {"id": int(el["id"]), "art": el["art"], "name": name(el), "typ": el.get("typ")}
    for k in ("punkt", "normale", "achse", "mitte", "c"):
        if k in el and el[k] is not None:
            g[k] = np.asarray(el[k], float)
    for k in ("radius", "r0", "halbwinkel", "hoehe", "winkel_grad", "durchmesser"):
        if k in el and el[k] is not None:
            g[k] = float(el[k])
    if g["art"] == "ebene":
        g["richtung"], g["ort"], g["linie"] = _einheit(g["normale"]), g["punkt"], False
    elif g["art"] in ("zylinder", "kegel"):
        g["richtung"], g["ort"], g["linie"] = _einheit(g["achse"]), g["punkt"], True
    elif g["art"] == "kugel":
        g["richtung"], g["ort"], g["linie"] = None, g["mitte"], False
    return g


def _achs_enden(g, pts=None):
    """Endpunkte der Achse über die Höhe des Elements (aus den Punkten, sonst aus hoehe)."""
    d, o = g["richtung"], g["ort"]
    if pts is not None and len(pts) >= 3:
        t = (pts - o) @ d
        lo, hi = np.percentile(t, [0.5, 99.5])
    else:
        h = g.get("hoehe") or 0.0
        lo, hi = -h / 2, h / 2
    return o + d * lo, o + d * hi


def _abstand_linie(p, o, d):
    v = p - o
    return float(np.linalg.norm(v - (v @ d) * d))


def _spitzwinkel(a, b):
    c = abs(float(np.clip(a @ b, -1, 1)))
    return math.degrees(math.acos(min(1.0, c)))


def _zone(werte):
    if len(werte) < 3:
        raise MessFehler("Zu wenige Punkte am Element für eine Toleranz.")
    lo, hi = np.percentile(werte, [0.5, 99.5])
    return float(hi - lo)


# --- Maße ----------------------------------------------------------------------------------------
def masse_art_auto(a, b):
    if b is None:
        if a["art"] in ("zylinder", "kugel"):
            return "durchmesser"
        if a["art"] == "kegel":
            return "kegelwinkel"
        raise MessFehler("Für ein einzelnes %s gibt es kein Maß – ein zweites Element wählen." % a["name"])
    if a.get("richtung") is not None and b.get("richtung") is not None:
        w = _spitzwinkel(a["richtung"], b["richtung"])
        if a["linie"] == b["linie"]:
            return "abstand" if w <= PARALLEL_GRAD else "winkel"     # Ebene/Ebene, Achse/Achse
        return "abstand" if w >= 90 - PARALLEL_GRAD else "winkel"     # Achse ∥ Ebene ⇔ Normale ⟂ Achse
    return "abstand"


def mass_wert(art, a, b, pa=None, pb=None):
    """-> (Wert, Einheit, Text der Messart)"""
    if art == "durchmesser":
        if a["art"] not in ("zylinder", "kugel"):
            raise MessFehler("Durchmesser gibt es nur an Zylinder, Bohrung, Zapfen oder Kugel.")
        return 2 * a["radius"], "mm", "Ø"
    if art == "radius":
        if a["art"] not in ("zylinder", "kugel"):
            raise MessFehler("Radius gibt es nur an runden Elementen.")
        return a["radius"], "mm", "R"
    if art == "kegelwinkel":
        if a["art"] != "kegel":
            raise MessFehler("Kegelwinkel gibt es nur an Kegel/Senkung.")
        return 2 * math.degrees(a["halbwinkel"]), "°", "Kegelwinkel"
    if b is None:
        raise MessFehler("Für %s ein zweites Element wählen." % MASSE.get(art, art))
    if art == "winkel":
        if a.get("richtung") is None or b.get("richtung") is None:
            raise MessFehler("Winkel brauchen zwei Elemente mit Richtung (Ebene, Achse).")
        w = _spitzwinkel(a["richtung"], b["richtung"])
        if a["linie"] != b["linie"]:          # Achse zu Ebene: Winkel zwischen Achse und Fläche
            w = 90.0 - w
        return w, "°", "Winkel"
    if art in ("spalt", "spannweite"):
        if not (a["art"] == "kugel" and b["art"] == "kugel"):
            raise MessFehler("Spalt/Spannweite gibt es nur zwischen zwei Kugeln.")
        m = float(np.linalg.norm(a["mitte"] - b["mitte"]))
        return (m - a["radius"] - b["radius"], "mm", "Spalt") if art == "spalt" else (m + a["radius"] + b["radius"], "mm", "Spannweite")
    if art != "abstand":
        raise MessFehler("Unbekannte Maßart %s" % art)
    return _abstand(a, b, pa, pb)


def _abstand(a, b, pa, pb):
    # Ebene immer als a (Bezug), dann Achse, dann Kugel
    rang = {"ebene": 0, "zylinder": 1, "kegel": 1, "kugel": 2}
    if rang[b["art"]] < rang[a["art"]]:
        a, b, pa, pb = b, a, pb, pa
    if a["art"] == "ebene":
        n = a["richtung"]
        if b["art"] == "ebene":
            if _spitzwinkel(n, b["richtung"]) > PARALLEL_GRAD:
                raise MessFehler("Die Ebenen sind nicht parallel – Winkel messen.")
            q = pb.mean(0) if pb is not None and len(pb) else b["ort"]
            return abs(float((q - a["ort"]) @ n)), "mm", "Abstand Ebene–Ebene"
        if b["linie"] and _spitzwinkel(n, b["richtung"]) < 90 - PARALLEL_GRAD:
            raise MessFehler("Die Achse durchstößt die Ebene – Winkel messen.")
        return abs(float((b["ort"] - a["ort"]) @ n)), "mm", "Abstand zur Ebene"
    if a["linie"]:
        if b["linie"]:
            d1, d2 = a["richtung"], b["richtung"]
            if _spitzwinkel(d1, d2) <= PARALLEL_GRAD:
                return _abstand_linie(b["ort"], a["ort"], d1), "mm", "Achsabstand"
            c = np.cross(d1, d2)
            return abs(float((b["ort"] - a["ort"]) @ _einheit(c))), "mm", "kürzester Achsabstand"
        return _abstand_linie(b["ort"], a["ort"], a["richtung"]), "mm", "Abstand zur Achse"
    return float(np.linalg.norm(a["ort"] - b["ort"])), "mm", "Mitte–Mitte"


# --- Toleranzen (GD&T) ---------------------------------------------------------------------------
def toleranz_wert(art, f, pf, b=None, pb=None, winkel=None):
    """-> Zonenbreite bzw. -durchmesser in mm"""
    if art in FORM_FUER:
        soll = FORM_FUER[art]
        if f["art"] != soll:
            raise MessFehler("%s gibt es nur an einem Element der Form %s." % (TOLERANZEN[art], soll))
        mod = {k: f[k] for k in ("punkt", "normale", "achse", "mitte", "radius", "c", "r0", "halbwinkel") if k in f}
        d, _ = er.abstand(soll, mod, pf)
        return _zone(d)
    if b is None:
        raise MessFehler("%s braucht ein Bezugselement (B)." % TOLERANZEN.get(art, art))
    if f.get("richtung") is None or b.get("richtung") is None:
        raise MessFehler("Lagetoleranzen brauchen Ebenen oder Achsen (keine Kugeln).")
    r = b["richtung"]
    if art == "koaxialitaet":
        if not (f["linie"] and b["linie"]):
            raise MessFehler("Koaxialität gibt es nur zwischen zwei Achsen (Zylinder/Kegel).")
        e1, e2 = _achs_enden(f, pf)
        return 2 * max(_abstand_linie(e1, b["ort"], r), _abstand_linie(e2, b["ort"], r))
    if art == "parallelitaet":
        soll_winkel = 0.0
    elif art == "rechtwinkligkeit":
        soll_winkel = 90.0
    elif art == "neigung":
        if winkel is None:
            raise MessFehler("Neigung braucht den Sollwinkel.")
        soll_winkel = float(winkel)
    else:
        raise MessFehler("Unbekannte Toleranz %s" % art)
    # Sollrichtung der Zone. Fläche: Normale der ideal ausgerichteten Ebene. Achse: Richtung der Achse.
    # Für eine Fläche zu einem Achsbezug ist die Normale das Komplement (parallel zur Achse ⇔ Normale ⟂ Achse).
    fr = f["richtung"]
    gleich_art = f["linie"] == b["linie"]
    w_rel = soll_winkel if gleich_art else 90.0 - soll_winkel      # Winkel zwischen den beiden Richtungen
    t = fr - (fr @ r) * r
    t = _einheit(t) if np.linalg.norm(t) > 1e-9 else _einheit(np.cross(r, [1, 0, 0] if abs(r[0]) < 0.9 else [0, 1, 0]))
    if (fr @ r) < 0:
        r = -r
    soll = math.cos(math.radians(w_rel)) * r + math.sin(math.radians(w_rel)) * t
    if not f["linie"]:
        return _zone(pf @ soll)                                   # Fläche: Punkte senkrecht zur Sollebene
    e1, e2 = _achs_enden(f, pf)                                   # Achse: Versatz quer zur Sollrichtung
    v = e2 - e1
    return float(np.linalg.norm(v - (v @ soll) * soll))


# --- Messplan auswerten --------------------------------------------------------------------------
def _punkte(scan_xyz, labels, eid):
    return scan_xyz[labels == eid].astype(np.float64) if labels is not None else None


def auswerten(eintraege, elemente, scan_xyz, labels):
    """eintraege: [{nr, art ('mass'|'tol'), mass|tol, a, b, nenn, plus, minus, grenze, winkel}] → dieselben + Werte."""
    nach_id = {int(e["id"]): e for e in elemente}
    aus = []
    for e in eintraege:
        r = dict(e)
        r.pop("fehler", None)
        try:
            ea = nach_id.get(int(e["a"]))
            eb = nach_id.get(int(e["b"])) if e.get("b") is not None else None
            if ea is None or (e.get("b") is not None and eb is None):
                raise MessFehler("Element gibt es nicht mehr (neu erkannt?).")
            ga, gb = geom(ea), geom(eb) if eb else None
            pa, pb = _punkte(scan_xyz, labels, ga["id"]), _punkte(scan_xyz, labels, gb["id"]) if gb else None
            if e["art"] == "mass":
                art = e.get("mass") or "auto"
                if art == "auto":
                    art = masse_art_auto(ga, gb)
                    r["mass_erkannt"] = art
                wert, einheit, wie = mass_wert(art, ga, gb, pa, pb)
                r.update(wert=round(wert, 4), einheit=einheit, wie=wie,
                         titel="%s %s%s" % (MASSE[art], ga["name"], (" – " + gb["name"]) if gb else ""))
                if e.get("nenn") is not None and e.get("nenn") != "":
                    lo = float(e["nenn"]) - abs(float(e.get("minus") or 0))
                    hi = float(e["nenn"]) + abs(float(e.get("plus") or 0))
                    r["status"] = "ok" if lo - 1e-9 <= wert <= hi + 1e-9 else "nok"
                    r["abw"] = round(wert - float(e["nenn"]), 4)
            else:
                wert = toleranz_wert(e["tol"], ga, pa, gb, pb, e.get("winkel"))
                r.update(wert=round(wert, 4), einheit="mm",
                         titel="%s %s%s" % (TOLERANZEN[e["tol"]], ga["name"], (" zu " + gb["name"]) if gb else ""))
                if e.get("grenze") not in (None, ""):
                    r["status"] = "ok" if wert <= float(e["grenze"]) + 1e-9 else "nok"
        except MessFehler as ex:
            r["fehler"] = str(ex)
        aus.append(r)
    return aus


def abweichung_element(el, scan_xyz):
    """Abstand aller Scanpunkte zur Ausgleichsform eines Elements (mit Vorzeichen, mm)."""
    g = geom(el)
    mod = {k: g[k] for k in ("punkt", "normale", "achse", "mitte", "radius", "c", "r0", "halbwinkel") if k in g}
    d, _ = er.abstand(g["art"], mod, scan_xyz.astype(np.float64))
    return d.astype(np.float32)


# --- Bericht -------------------------------------------------------------------------------------
def _z(x, stellen=3):
    return ("%%.%df" % stellen % x).replace(".", ",") if x is not None else ""


def bericht_text(scan_name, werte, datum):
    zeilen = ["Messbericht V3D Scan – %s – %s" % (scan_name, datum), ""]
    masse = [w for w in werte if w["art"] == "mass"]
    tols = [w for w in werte if w["art"] == "tol"]
    zeichen = {"ok": "✔ i.O.", "nok": "✘ n.i.O.", None: ""}

    def zeile(w):
        if w.get("fehler"):
            return "%2d  %s – %s" % (w["nr"], w.get("titel") or "?", w["fehler"])
        soll = ""
        if w["art"] == "mass" and w.get("nenn") not in (None, ""):
            soll = "Soll %s +%s/−%s" % (_z(float(w["nenn"])), _z(abs(float(w.get("plus") or 0))), _z(abs(float(w.get("minus") or 0))))
        if w["art"] == "tol" and w.get("grenze") not in (None, ""):
            soll = "≤ %s" % _z(float(w["grenze"]))
        return "%2d  %-46s %10s %s  %-24s %s" % (w["nr"], w["titel"], _z(w["wert"]), w["einheit"], soll, zeichen[w.get("status")])
    if masse:
        zeilen += ["Maße:"] + [zeile(w) for w in masse] + [""]
    if tols:
        zeilen += ["Form und Lage:"] + [zeile(w) for w in tols] + [""]
    bewertet = [w for w in werte if w.get("status")]
    if bewertet:
        nok = sum(w["status"] == "nok" for w in bewertet)
        zeilen.append("Ergebnis: %d von %d Merkmalen in Toleranz%s" % (len(bewertet) - nok, len(bewertet), "" if not nok else " – %d außerhalb" % nok))
    return "\n".join(zeilen)


def bericht_csv(werte):
    k = ["Nr;Art;Merkmal;Messwert;Einheit;Nennmaß;Plus;Minus;Grenze;Abweichung;Status;Hinweis"]
    for w in werte:
        k.append(";".join([str(w["nr"]), "Maß" if w["art"] == "mass" else "Form/Lage", w.get("titel") or "",
                           _z(w.get("wert"), 4) if w.get("wert") is not None else "", w.get("einheit", ""),
                           _z(float(w["nenn"]), 4) if w.get("nenn") not in (None, "") else "",
                           _z(abs(float(w["plus"])), 4) if w.get("plus") not in (None, "") else "",
                           _z(abs(float(w["minus"])), 4) if w.get("minus") not in (None, "") else "",
                           _z(float(w["grenze"]), 4) if w.get("grenze") not in (None, "") else "",
                           _z(w.get("abw"), 4) if w.get("abw") is not None else "",
                           {"ok": "i.O.", "nok": "n.i.O."}.get(w.get("status"), ""), w.get("fehler", "")]))
    return ("﻿" + "\r\n".join(k) + "\r\n").encode("utf-8")
