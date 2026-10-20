#!/usr/bin/env python3
# V3D Scan - lokaler Dienst: liefert die Oberflaeche (web/) und rechnet.
#
# Nur 127.0.0.1. Alle Projektaenderungen laufen nacheinander unter einer
# Sperre; Anfragen blockieren, bis die Rechnung fertig ist (die Oberflaeche
# zeigt so lange die Sanduhr).
#
# Punktmasken gehen als base64(np.packbits(..., bitorder="little")) hin und
# her, Punktdaten binaer (siehe _punkte_binaer).

import argparse
import base64
import json
import mimetypes
import os
import struct
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

FASSUNG = "0.7.0"
HIER = os.path.dirname(os.path.abspath(__file__))
if getattr(sys, "frozen", False):
    HIER = getattr(sys, "_MEIPASS", HIER)
WEB = os.path.join(HIER, "web")

from kern import erkennung as er  # noqa: E402
from kern import formen as fo  # noqa: E402
from kern import koerper as kp  # noqa: E402
from kern import koordinaten as ko  # noqa: E402
from kern import netz as nz  # noqa: E402
from kern import features as sk_feat  # noqa: E402
from kern import registrierung as rg  # noqa: E402
from kern import skizze as sk  # noqa: E402
from kern import werkzeuge as wz  # noqa: E402
from kern.projekt import Projekt  # noqa: E402
from kern.wolke import AUSGEBBAR, AUSGEBBAR_NETZ, einlesen, ausgeben  # noqa: E402

projekt = Projekt()
sperre = threading.Lock()
letzter_puls = [0.0]
vorschau_cache = {}
netz_vorschau = {}          # id -> (schluessel, Scan, bericht)


class Fehler(Exception):
    pass


# --- Hilfen -------------------------------------------------------------------
def maske_b64(m):
    return base64.b64encode(np.packbits(m.astype(bool), bitorder="little")).decode()


def maske_aus_b64(text, n):
    bits = np.unpackbits(np.frombuffer(base64.b64decode(text), np.uint8),
                         bitorder="little")
    if len(bits) < n:
        raise Fehler("Auswahl passt nicht mehr zum Scan - bitte neu wählen.")
    return bits[:n].astype(bool)


def masken_lesen(d):
    aus = {}
    for sid, text in (d.get("masken") or {}).items():
        s = projekt.scan(sid)
        aus[s.id] = maske_aus_b64(text, len(s))
    return aus


def zahl(d, name, standard=None):
    wert = d.get(name, standard)
    if wert is None:
        raise Fehler("Wert „%s“ fehlt." % name)
    try:
        return float(wert)
    except (TypeError, ValueError):
        raise Fehler("„%s“ ist keine Zahl." % name)


def ziel_scans(d):
    ids = d.get("ids")
    if not ids:
        raise Fehler("Kein Scan gewählt.")
    return [projekt.scan(i) for i in ids]


def _punkte_binaer(s):
    """uint32 n, uint32 flags (1=Farbe, 2=Normalen, 4=Dreiecke), xyz float32*3n,
    rgb uint8*3n auf 4 Byte aufgefuellt, nrm float32*3n,
    [uint32 m, int32*3m]."""
    flags = (1 if s.rgb is not None else 0) | (2 if s.nrm is not None else 0) \
        | (4 if s.tri is not None else 0)
    teile = [struct.pack("<II", len(s), flags), s.xyz.tobytes()]
    if s.rgb is not None:
        b = s.rgb.tobytes()
        teile.append(b + b"\0" * (-len(b) % 4))
    if s.nrm is not None:
        teile.append(s.nrm.tobytes())
    if s.tri is not None:
        teile.append(struct.pack("<I", len(s.tri)))
        teile.append(s.tri.astype(np.int32).tobytes())
    return b"".join(teile)


# --- Netz -------------------------------------------------------------------------
def netz_rechnen(d):
    """Ergebnis eines Netz-Werkzeugs als neuer Scan (noch nicht uebernommen)."""
    s = projekt.scan(d.get("id"))
    w = d.get("werkzeug")
    schluessel = json.dumps([d, s.id, s.rev], sort_keys=True)
    alt = netz_vorschau.get(s.id)
    if alt and alt[0] == schluessel:
        return s, alt[1], alt[2]
    if w == "reparieren":
        neu, bericht = nz.reparieren(s, zahl(d, "verschweissen", 0), zahl(d, "kleine_teile", 0),
                                     bool(d.get("schnitte")))
    elif w == "loecher":
        nummern = d.get("nummern")
        neu, bericht = nz.loecher_fuellen(s, nummern=[int(x) for x in nummern]
                                          if nummern is not None else None,
                                          max_umfang=d.get("max_umfang"),
                                          art=d.get("art", "gewoelbt"))
    elif w == "glaetten":
        neu, bericht = nz.glaetten(s, int(zahl(d, "iterationen", 5)), d.get("art", "taubin"),
                                   zahl(d, "staerke", 0.5))
    elif w == "vereinfachen":
        ziel = int(len(s.tri) * zahl(d, "prozent") / 100.0) if s.ist_netz else 0
        neu, bericht = nz.vereinfachen(s, ziel)
    elif w == "beschneiden":
        p = d.get("punkte") or []
        if len(p) != 3:
            raise Fehler("Bitte genau 3 Punkte für die Schnittebene setzen.")
        n, dd = wz.ebene_aus_punkten(*p)
        if d.get("umdrehen"):
            n = -n
        mitte = np.mean(np.asarray(p, float), axis=0) + n * zahl(d, "versatz", 0)
        neu, bericht = nz.beschneiden(s, mitte, n)
    elif w == "erzeugen":
        neu, bericht = nz.netz_erzeugen(s, d.get("verfahren", "poisson"),
                                        int(zahl(d, "tiefe", 9)), zahl(d, "dichte", 5),
                                        normalen_neu=bool(d.get("normalen_neu")))
    else:
        raise Fehler("Unbekanntes Netz-Werkzeug %s" % w)
    bericht = dict(bericht, dreiecke=len(neu.tri) if neu.ist_netz else 0,
                   eckpunkte=len(neu))
    netz_vorschau.clear()
    netz_vorschau[s.id] = (schluessel, neu, bericht)
    return s, neu, bericht


# --- Bereinigen -----------------------------------------------------------------
def bereinigen_masken(d):
    werkzeug = d.get("werkzeug")
    schluessel = json.dumps([d, [(s.id, s.rev) for s in ziel_scans(d)]],
                            sort_keys=True)
    if schluessel in vorschau_cache:
        return vorschau_cache[schluessel]
    masken, extra = {}, {}
    for s in ziel_scans(d):
        if len(s) == 0:
            continue
        if werkzeug == "tisch":
            m, n, dd = wz.tisch_maske(s, zahl(d, "toleranz"), int(zahl(d, "versuch", 0)),
                                      bool(d.get("darunter", True)))
            extra[s.id] = {"normale": n.tolist(), "d": dd}
            # Liegt unter der Ebene viel, ist es vermutlich kein Tisch, sondern
            # eine Flaeche des Objekts (z. B. Sockel-Oberseite nach dem 2. Mal).
            unter = int(np.sum(wz.seite_der_ebene(s.xyz, -n, -dd, zahl(d, "toleranz"))))
            if unter > 0.15 * len(s):
                extra[s.id]["warnung"] = (
                    "„%s“: unter dieser Ebene liegen %d %% der Punkte – das ist "
                    "wahrscheinlich nicht der Tisch. Vorschau prüfen oder „Andere Ebene“."
                    % (s.name, round(100 * unter / len(s))))
        elif werkzeug == "ebene3":
            p = d.get("punkte") or []
            if len(p) != 3:
                raise Fehler("Bitte genau 3 Punkte setzen.")
            n, dd = wz.ebene_aus_punkten(*p)
            if d.get("umdrehen"):
                n, dd = -n, -dd
            m = wz.seite_der_ebene(s.xyz, n, dd, zahl(d, "versatz", 0))
            extra[s.id] = {"normale": n.tolist(), "d": dd}
        elif werkzeug == "statistisch":
            m = wz.ausreisser_statistisch(s, int(zahl(d, "nachbarn")), zahl(d, "sigma"))
        elif werkzeug == "radius":
            m = wz.ausreisser_radius(s, zahl(d, "radius"), int(zahl(d, "min_punkte")))
        elif werkzeug == "inseln":
            m = wz.kleine_inseln(s, zahl(d, "abstand"), zahl(d, "anteil"))
        else:
            raise Fehler("Unbekanntes Werkzeug %s" % werkzeug)
        masken[s.id] = m
    vorschau_cache.clear()
    vorschau_cache[schluessel] = (masken, extra)
    return masken, extra


NAMEN = {"tisch": "Tisch entfernt", "ebene3": "Schnittebene", "statistisch":
         "Ausreißer entfernt", "radius": "Ausreißer entfernt", "inseln":
         "Kleine Inseln entfernt"}


# --- Befehle -------------------------------------------------------------------
def befehl(name, d):
    p = projekt
    if name == "zustand":
        return {}
    if name == "scan/setzen":
        s = p.scan(d["id"])
        if "sichtbar" in d:
            s.sichtbar = bool(d["sichtbar"])
        if "fest" in d:
            for andere in p.scans.values():
                andere.fest = False
            s.fest = bool(d["fest"])
        if d.get("name"):
            s.name = str(d["name"])[:120]
        if d.get("farbe"):
            s.farbe = str(d["farbe"])[:9]
        return {}
    if name == "scan/entfernen":
        p.entfernen(d["id"])
        return {}
    if name == "rueckgaengig":
        return {"text": p.rueckgaengig()}
    if name == "wiederholen":
        return {"text": p.wiederholen()}
    if name == "auswahl/loeschen":
        return {"geloescht": p.loeschen(masken_lesen(d))}
    if name == "auswahl/abtrennen":
        neu = p.abtrennen(masken_lesen(d))
        return {"neu": neu.id if neu else None}
    if name == "auswahl/verbunden":
        s = p.scan(d["id"])
        idx = int(d["index"])
        if not 0 <= idx < len(s):
            raise Fehler("Punkt nicht gefunden.")
        return {"maske": maske_b64(wz.verbunden(s, idx, zahl(d, "abstand")))}
    if name == "info/punktabstand":
        s = p.scan(d["id"])
        return {"abstand": round(wz.punktabstand(s), 4)}

    if name == "bereinigen/vorschau":
        masken, extra = bereinigen_masken(d)
        return {"masken": {sid: maske_b64(m) for sid, m in masken.items()},
                "anzahl": int(sum(m.sum() for m in masken.values())),
                "extra": extra}
    if name == "bereinigen/anwenden":
        masken, _ = bereinigen_masken(d)
        vorschau_cache.clear()
        return {"geloescht": p.loeschen(masken, NAMEN.get(d.get("werkzeug"), "Bereinigt"))}

    if name in ("ausduennen/vorschau", "ausduennen/anwenden"):
        voxel = zahl(d, "voxel")
        if voxel <= 0:
            raise Fehler("Voxelgröße muss größer als 0 sein.")
        vorher = nachher = 0
        for s in ziel_scans(d):
            neu = wz.ausduennen(s, voxel)
            vorher += len(s)
            nachher += len(neu)
            if name.endswith("anwenden"):
                p.ersetzen(s.id, neuer_scan=neu, text="Ausgedünnt (%.2f mm)" % voxel)
        return {"vorher": vorher, "nachher": nachher}

    if name == "normalen":
        for s in ziel_scans(d):
            if s.ist_netz:
                m = s.zu_o3d_netz(farbe=False)
                m.compute_vertex_normals()
                p.ersetzen(s.id, nrm=np.asarray(m.vertex_normals, np.float32),
                           text="Normalen berechnet")
                continue
            nrm = wz.normalen_berechnen(s, zahl(d, "radius"), int(zahl(d, "nachbarn", 30)),
                                        d.get("ausrichtung", "aussen"))
            p.ersetzen(s.id, nrm=nrm, text="Normalen berechnet")
        return {}

    if name == "netz/analyse":
        s = p.scan(d["id"])
        ergebnis, marken = nz.analyse(s)
        schleifen = nz.randschleifen(s)
        info = nz.loch_info(s, schleifen)
        for i, sch in zip(info, schleifen):
            i["indizes"] = sch.tolist() if len(sch) <= 20000 else sch[::len(sch) // 20000 + 1].tolist()
        return {"analyse": ergebnis, "loecher": info,
                "problem": maske_b64(marken["problem"]) if "problem" in marken else None}
    if name == "netz/vorschau":
        _, neu, bericht = netz_rechnen(d)
        return {"bericht": bericht}
    if name == "netz/anwenden":
        s, neu, bericht = netz_rechnen(d)
        netz_vorschau.clear()
        texte = {"reparieren": "Netz repariert", "loecher": "Löcher geschlossen",
                 "glaetten": "Netz geglättet", "vereinfachen": "Netz vereinfacht",
                 "beschneiden": "Netz beschnitten"}
        if d.get("werkzeug") == "erzeugen":
            p.hinzufuegen(neu)
            return {"bericht": bericht, "neu": neu.id}
        p.ersetzen(s.id, neuer_scan=neu, text=texte.get(d.get("werkzeug"), "Netz geändert"))
        return {"bericht": bericht}
    if name == "netz/verwerfen":
        netz_vorschau.clear()
        return {}

    if name.startswith("ausrichten/"):
        return ausrichten(name.split("/", 1)[1], d)
    if name.startswith("koord/"):
        return koordinaten(name.split("/", 1)[1], d)
    if name.startswith("formen/"):
        return formen_befehl(name.split("/", 1)[1], d)
    if name.startswith("koerper/"):
        return koerper_befehl(name.split("/", 1)[1], d)
    if name.startswith("skizze/"):
        return skizze_befehl(name.split("/", 1)[1], d)
    if name.startswith("feature/"):
        return feature_befehl(name.split("/", 1)[1], d)

    if name == "zusammenfuehren":
        neu = p.zusammenfuehren([int(i) for i in d.get("ids") or []],
                                zahl(d, "voxel", 0))
        return {"neu": neu.id, "anzahl": len(neu)}
    raise Fehler("Unbekannter Befehl %s" % name)


def _erkennung_senden(sid):
    erk = projekt.erkennung.get(sid)
    s = projekt.scan(sid)
    if not erk or erk["rev"] != s.rev:
        return {"erkennung": None}
    return {"erkennung": {
        "id": sid, "rev": s.rev, "elemente": erk["elemente"], "freiform": erk["freiform"],
        "zusammenfassung": erk["zusammenfassung"], "toleranz": erk.get("toleranz"),
        "labels": base64.b64encode(erk["labels"].astype(np.int16).tobytes()).decode()}}


def formen_befehl(was, d):
    s = projekt.scan(d.get("id"))
    if was == "erkennen":
        arten = [a for a in (d.get("arten") or er.ARTEN) if a in er.ARTEN]
        if not arten:
            raise Fehler("Mindestens eine Formart wählen.")
        tol = d.get("toleranz")
        ergebnis = er.erkennen(s, toleranz=float(tol) if tol else None,
                               winkel_grad=zahl(d, "winkel", 20), min_anteil=zahl(d, "min_anteil", 0.08),
                               arten=arten)
        projekt.erkennung[s.id] = {
            "rev": s.rev, "labels": ergebnis["labels"],
            "elemente": [er.als_json(e) for e in ergebnis["elemente"]],
            "freiform": ergebnis["freiform"], "zusammenfassung": ergebnis["zusammenfassung"],
            "toleranz": ergebnis["toleranz"]}
        return _erkennung_senden(s.id)
    if was == "laden":
        return _erkennung_senden(s.id)
    erk = projekt.erkennung.get(s.id)
    if was == "auswahl":
        if not erk or erk["rev"] != s.rev:
            erk = projekt.erkennung[s.id] = {"rev": s.rev, "labels": np.full(len(s), -1, np.int32),
                                             "elemente": [], "freiform": 0, "zusammenfassung": ""}
        maske = masken_lesen(d).get(s.id)
        if maske is None or not maske.any():
            raise Fehler("Erst Punkte dieses Scans auswählen.")
        el = er.aus_auswahl(s, maske, d.get("art", "auto"), erk["elemente"])
        erk["labels"][maske] = el["id"]
        erk["elemente"].append(er.als_json(el))
        _zusammenfassung_neu(erk)
        return _erkennung_senden(s.id)
    if not erk or erk["rev"] != s.rev:
        raise Fehler("Keine aktuelle Erkennung – bitte neu analysieren.")
    if was == "entfernen":
        eid = int(d.get("element"))
        erk["elemente"] = [e for e in erk["elemente"] if e["id"] != eid]
        erk["labels"][erk["labels"] == eid] = -1
        _zusammenfassung_neu(erk)
        return _erkennung_senden(s.id)
    if was == "nennmass":
        eid, feld = int(d.get("element")), d.get("feld")
        el = next((e for e in erk["elemente"] if e["id"] == eid), None)
        if el is None or feld not in ("durchmesser_nenn", "radius_nenn", "winkel_nenn"):
            raise Fehler("Element oder Maß unbekannt.")
        el[feld] = round(zahl(d, "wert"), 4)
        el["nenn_von_hand"] = True
        el["text"] = er.beschreibung({k: (np.asarray(v) if isinstance(v, list) and k in ("punkt", "mitte", "achse", "normale") else v)
                                      for k, v in el.items()})
        _zusammenfassung_neu(erk)
        return _erkennung_senden(s.id)
    raise Fehler("Unbekannter Formen-Befehl %s" % was)


# --- Koerper (OCP) ------------------------------------------------------------------
def _b64(arr, typ):
    return base64.b64encode(np.ascontiguousarray(arr, typ).tobytes()).decode()


def netz_json(netz):
    return {"xyz": _b64(netz["xyz"], np.float32), "tri": _b64(netz["tri"], np.uint32),
            "kanten": _b64(netz["kanten"], np.float32),
            "kanten_id": _b64(netz.get("kanten_id", np.zeros(0)), np.uint32)}


def _element(d):
    s = projekt.scan(d.get("id"))
    erk = projekt.erkennung.get(s.id)
    if not erk or erk["rev"] != s.rev:
        raise Fehler("Keine aktuelle Erkennung – bitte neu analysieren.")
    try:
        eid = int(d.get("element"))
    except (TypeError, ValueError):
        raise Fehler("Kein Element gewählt.")
    el = next((e for e in erk["elemente"] if e["id"] == eid), None)
    if el is None:
        raise Fehler("Element %s gibt es nicht (mehr)." % d.get("element"))
    return s, el


def koerper_befehl(was, d):
    p = projekt
    if was == "aus_form":
        s, el = _element(d)
        nenn = bool(d.get("nennmass", True))
        par = kp.grundkoerper_parameter(el, nenn, zahl(d, "verlaengern", 0))
        op = d.get("operation") or kp.standard_operation(el, bool(p.koerper))
        if op not in kp.OPERATIONEN:
            raise Fehler("Unbekannte Operation „%s“." % op)
        ziel = None
        if op != "neu":
            ziel = p.koerper_holen(d["ziel"]) if d.get("ziel") is not None else p.standard_ziel()
            if ziel is None:
                raise Fehler("Zum %s braucht es einen Körper – erst einen Grundkörper erzeugen."
                             % ("Abziehen" if op == "abziehen" else "Vereinen"))
        werkzeug = kp.baue(par)
        text = kp.beschreibung(par, nenn)
        if op == "abziehen":
            text += " – wird von „%s“ abgezogen" % ziel.name
        elif op == "vereinen":
            text += " – wird mit „%s“ vereint" % ziel.name
        else:
            text += " – neuer Körper"
        info = {"text": text, "operation": op, "ziel": ziel.id if ziel else None}
        if d.get("vorschau"):
            return {"vorschau": netz_json(kp.vernetzen(werkzeug)), "info": info}
        k = p.grundkoerper(werkzeug, kp.ART_NAMEN[par["art"]], op, ziel,
                           quelle={"scan": s.id, "element": el["id"]},
                           parameter=dict(par, nennmass=nenn, verlaengern=zahl(d, "verlaengern", 0),
                                          typ=el.get("typ")))
        return {"koerper": k.id, "info": info}
    if was == "setzen":
        sichtbar = d.get("sichtbar")
        p.koerper_setzen(d.get("kid"), None if sichtbar is None else bool(sichtbar), d.get("name"))
        return {}
    if was == "entfernen":
        p.koerper_entfernen(d.get("kid"))
        return {}
    if was == "abweichung":
        s = p.scan(d.get("id"))
        if d.get("kid") is not None:
            koerper = [p.koerper_holen(d["kid"])]
        else:
            koerper = [k for k in p.koerper.values() if k.sichtbar]
        if not koerper or koerper[0] is None:
            raise Fehler("Es gibt noch keinen (sichtbaren) Körper zum Vergleichen.")
        werte = kp.abweichung([k.shape for k in koerper], s.xyz)
        kw = kp.abweichung_kennwerte(werte, zahl(d, "toleranz", 0.1), zahl(d, "ausblenden", 0))
        return {"werte": _b64(werte, np.float32), "kennwerte": kw,
                "koerper": [k.id for k in koerper]}
    raise Fehler("Unbekannter Körper-Befehl %s" % was)


# --- Skizzen (Querschnitt) + Features -------------------------------------------------------
skizze_vorschau = {}        # "skizze" -> zuletzt gerechnete, noch nicht uebernommene Skizze (JSON)


def _ebene_aus(d):
    e = d.get("ebene") or {}
    art = e.get("art", "welt")
    if art == "welt":
        return sk.ebene_welt(e.get("name", "xy"), float(e.get("versatz") or 0))
    erk = projekt.erkennung.get(int(d["id"]))
    if not erk:
        raise Fehler("Für diese Ebene zuerst Bereiche erkennen (BEREICHE → Automatisch).")
    el = next((x for x in erk["elemente"] if x["id"] == e.get("element")), None)
    if el is None:
        raise Fehler("Bereich %s gibt es nicht (mehr)." % e.get("element"))
    if art == "bereich":
        if el.get("art") != "ebene":
            raise Fehler("Der gewählte Bereich ist keine Ebene – für Zylinder/Kegel „durch Achse“ wählen.")
        return sk.ebene_aus_ebene(el, float(e.get("versatz") or 0))
    if art == "achse":
        if "achse" not in el:
            raise Fehler("Der gewählte Bereich hat keine Achse (Zylinder, Bohrung, Kegel …).")
        return sk.ebene_durch_achse(el, float(e.get("winkel") or 0))
    raise Fehler("Unbekannte Ebene „%s“." % art)


def _skizze_antwort(skz):
    abw = sk.schnitt_abweichung(skz)
    texte = [[sk.kette_text(e) for e in k["elemente"]] for k in skz["ketten"]]
    kenn = []
    for w in abw:
        kenn.append(None if w is None or not len(w) else
                    {"max": round(float(w.max()), 4), "rms": round(float(np.sqrt(np.mean(w ** 2))), 4)})
    return {"skizze": skz, "texte": texte, "abweichung": kenn,
            "abweichung_werte": [None if w is None else _b64(w, np.float32) for w in abw]}


def _skizze_ziel(d):
    """Bearbeitung trifft die Vorschau (ohne sid) oder eine gespeicherte Skizze."""
    if d.get("sid") is not None:
        return projekt.skizze_holen(d["sid"]), True
    if "skizze" not in skizze_vorschau:
        raise Fehler("Erst einen Schnitt rechnen (Vorschau).")
    return skizze_vorschau["skizze"], False


def skizze_befehl(was, d):
    p = projekt
    if was == "schnitt":
        s = p.scan(d["id"])
        E = _ebene_aus(d)
        tol = max(zahl(d, "toleranz", 0.1), 1e-4)
        t = time.time()
        linien, zu, info = sk.schnitt(s, E, zahl(d, "band", 0) or None)
        if not linien:
            raise Fehler("Die Ebene schneidet den Scan nicht (Versatz prüfen).")
        ketten = sk.skizze_rechnen(linien, zu, tol=tol, luecke=zahl(d, "luecke", 0),
                                   achsen_grad=1.0 if d.get("achsen", True) else 0.0,
                                   radien=bool(d.get("radien", True)))
        if not ketten:
            raise Fehler("Im Schnitt ist keine auswertbare Kontur.")
        info["dauer"] = round(time.time() - t, 2)
        skz = sk.skizze_json(ketten, E, info)
        skz["quelle"] = {"scan": s.id, "ebene": d.get("ebene"), "toleranz": tol,
                         "luecke": zahl(d, "luecke", 0)}
        skizze_vorschau["skizze"] = skz
        return _skizze_antwort(skz)
    if was == "verwerfen":
        skizze_vorschau.clear()
        return {}
    if was == "uebernehmen":
        if "skizze" not in skizze_vorschau:
            raise Fehler("Erst einen Schnitt rechnen (Vorschau).")
        z = p.skizze_hinzufuegen(skizze_vorschau.pop("skizze"))
        return {"sid": z["id"]}
    if was == "holen":
        return _skizze_antwort(p.skizze_holen(d["sid"]))
    if was in ("element_entfernen", "radius"):
        skz, gespeichert = _skizze_ziel(d)
        ki, ei = int(d["kette"]), int(d["element"])
        ketten = [dict(k) for k in skz["ketten"]]
        schnitt = list(skz.get("schnitt", []))
        if not 0 <= ki < len(ketten) or not 0 <= ei < len(ketten[ki]["elemente"]):
            raise Fehler("Element gibt es nicht (mehr).")
        if was == "radius":
            ketten[ki] = sk.radius_setzen(ketten[ki], ei, zahl(d, "r"),
                                          (skz.get("quelle") or {}).get("toleranz", 0.05))
            text = "Radius geändert"
        else:
            neu = sk.element_entfernen(ketten[ki], ei)
            if neu is None:
                del ketten[ki]
                if ki < len(schnitt):
                    del schnitt[ki]
            else:
                ketten[ki] = neu
            text = "Element entfernt"
        daten = {"ketten": ketten, "schnitt": schnitt}
        if gespeichert:
            skz = p.skizze_ersetzen(skz["id"], daten, text)
        else:
            skz = dict(skz, **daten)
            skizze_vorschau["skizze"] = skz
        return _skizze_antwort(skz)
    if was == "setzen":
        sichtbar = d.get("sichtbar")
        p.skizze_setzen(d["sid"], None if sichtbar is None else bool(sichtbar), d.get("name"))
        return {}
    if was == "entfernen":
        p.skizze_entfernen(d["sid"])
        return {}
    raise Fehler("Unbekannter Skizzen-Befehl %s" % was)


def _feature_ergebnis(werkzeug, typ_name, d, eintrag):
    p = projekt
    op = d.get("operation") or ("vereinen" if p.koerper else "neu")
    if op not in kp.OPERATIONEN:
        raise Fehler("Unbekannte Operation „%s“." % op)
    ziel = None
    if op != "neu":
        ziel = p.koerper_holen(d["ziel"]) if d.get("ziel") is not None else p.standard_ziel()
        if ziel is None:
            raise Fehler("Zum %s braucht es einen Körper." % ("Abziehen" if op == "abziehen" else "Vereinen"))
    info = {"operation": op, "ziel": ziel.id if ziel else None, "volumen": round(kp.kennwerte(werkzeug)["volumen"], 3)}
    if d.get("vorschau"):
        return {"vorschau": netz_json(kp.vernetzen(werkzeug)), "info": info}
    k = p.feature(werkzeug, typ_name, op, ziel, eintrag)
    return {"koerper": k.id, "info": info}


def feature_befehl(was, d):
    p = projekt
    if was == "extrudieren":
        skz = p.skizze_holen(d["sid"])
        modus = d.get("modus", "auto")
        if modus == "auto":
            sid = d.get("id") if d.get("id") is not None else (skz.get("quelle") or {}).get("scan")
            tiefe = sk_feat.scan_tiefe(skz, p.scan(sid).xyz) if sid is not None else None
            if tiefe is None:
                raise Fehler("Im Profil liegen keine Scanpunkte – Länge von Hand angeben.")
            von, bis = tiefe
        else:
            L = zahl(d, "laenge", 10)
            if modus == "mitte":
                von, bis = -L / 2, L / 2
            else:
                von, bis = (0.0, L) if not d.get("umkehren") else (-L, 0.0)
        werkzeug = sk_feat.extrudieren(skz, von, bis)
        erg = _feature_ergebnis(werkzeug, "Extrusion", d, {
            "typ": "extrusion", "skizze": skz["id"], "modus": modus, "von": round(von, 4), "bis": round(bis, 4)})
        erg["info"].update({"von": round(von, 3), "bis": round(bis, 3), "laenge": round(bis - von, 3)})
        return erg
    if was == "drehen":
        skz = p.skizze_holen(d["sid"])
        el = d.get("element")
        werkzeug = sk_feat.drehen(skz, zahl(d, "winkel", 360), None if el in (None, "") else int(el))
        return _feature_ergebnis(werkzeug, "Drehung", d, {
            "typ": "drehung", "skizze": skz["id"], "winkel": zahl(d, "winkel", 360), "element": el})
    if was in ("runden", "fasen"):
        k = p.koerper_holen(d["kid"])
        kanten = [int(x) for x in d.get("kanten") or []]
        neu = sk_feat.kanten_runden(k.shape, kanten, zahl(d, "radius", 1), fase=(was == "fasen"))
        if d.get("vorschau"):
            return {"vorschau": netz_json(kp.vernetzen(neu)),
                    "info": {"volumen": round(kp.kennwerte(neu)["volumen"], 3)}}
        typ = "Fase" if was == "fasen" else "Rundung"
        p.koerper_aendern(k.id, neu, typ, {"typ": was, "kanten": kanten, "radius": zahl(d, "radius", 1)})
        return {"koerper": k.id}
    if was == "radius_vorschlag":
        k = p.koerper_holen(d["kid"])
        elemente = []
        for erk in p.erkennung.values():
            elemente += erk["elemente"]
        r = sk_feat.radius_vorschlag(k.shape, [int(x) for x in d.get("kanten") or []], elemente)
        return {"radius": None if r is None else round(r, 3)}
    raise Fehler("Unbekannter Feature-Befehl %s" % was)


def _zusammenfassung_neu(erk):
    erk["zusammenfassung"] = er.zusammenfassung(erk["elemente"], erk["freiform"])


def elementliste_csv(sid):
    erk = projekt.erkennung.get(sid)
    s = projekt.scan(sid)
    if not erk or erk["rev"] != s.rev:
        raise Fehler("Keine aktuelle Erkennung.")
    zeilen = ["Nr;Typ;Nennmaß;gemessen;Länge/Tiefe;Achse;X;Y;Z;RMS;Punkte;Beschreibung"]

    def z(v):
        return "" if v is None else ("%.4f" % v).replace(".", ",")
    for e in erk["elemente"]:
        nenn = e.get("durchmesser_nenn", e.get("radius_nenn", e.get("winkel_nenn")))
        gem = e.get("durchmesser", e.get("radius") if "radius_nenn" in e else e.get("winkel_grad"))
        p = e.get("punkt", e.get("mitte")) or [None, None, None]
        zeilen.append(";".join([str(e["id"] + 1), er.TYP_NAMEN[e["typ"]][0], z(nenn), z(gem), z(e.get("hoehe")),
                                e.get("achse_name") or "", z(p[0]), z(p[1]), z(p[2]), z(e["rms"]),
                                str(e["punkte"]), e["text"]]))
    return ("\ufeff" + "\r\n".join(zeilen) + "\r\n").encode("utf-8")


def _gewaehlte_punkte(d):
    """Punkte (und Normalen, falls alle Teile welche haben) der Auswahl."""
    xyz, nrm, alle_nrm = [], [], True
    for sid, m in masken_lesen(d).items():
        s = projekt.scan(sid)
        xyz.append(s.xyz[m])
        if s.nrm is None:
            alle_nrm = False
        else:
            nrm.append(s.nrm[m])
    if not xyz or sum(len(x) for x in xyz) == 0:
        raise Fehler("Erst Punkte auswählen (z. B. mit dem Lasso), dann die Form einpassen.")
    return np.concatenate(xyz).astype(np.float64), \
        (np.concatenate(nrm).astype(np.float64) if alle_nrm and nrm else None)


def _alle_punkte(ids):
    teile = [projekt.scan(i).xyz for i in ids]
    if not teile:
        raise Fehler("Kein sichtbarer Scan.")
    return np.concatenate(teile)


def koordinaten(was, d):
    ids = [int(i) for i in d.get("ids") or []]
    oben = d.get("oben", "z")
    if was == "form":
        art = d.get("art")
        punkte = d.get("punkte")
        if art == "ebene3":
            if not punkte or len(punkte) != 3:
                raise Fehler("Bitte 3 Punkte setzen.")
            form = fo.ebene(np.asarray(punkte, float))
        elif art == "linie2":
            if not punkte or len(punkte) != 2:
                raise Fehler("Bitte 2 Punkte setzen.")
            form = {"art": "linie", "von": np.asarray(punkte[0], float),
                    "bis": np.asarray(punkte[1], float), "rms": 0.0}
        elif art == "punkt":
            if not punkte:
                raise Fehler("Bitte einen Punkt setzen.")
            form = {"art": "punkt", "punkt": np.asarray(punkte[0], float), "rms": 0.0}
        elif art == "schwerpunkt":
            xyz, _ = _gewaehlte_punkte(d)
            form = {"art": "punkt", "punkt": xyz.mean(0), "rms": 0.0}
        else:
            xyz, nrm = _gewaehlte_punkte(d)
            form = ko.form_aus_punkten(art, xyz, nrm)
            form["punkte"] = int(len(xyz))
            if art == "ebene" and ids:
                # Normale vom Bauteil weg: Deckflaeche -> "oben", Seitenflaeche -> "aussen"
                schwer = _alle_punkte(ids).mean(0)
                if (form["punkt"] - schwer) @ form["normale"] < 0:
                    form["normale"] = -form["normale"]
        return {"form": fo.als_json(form)}
    if was == "auto":
        xyz = _alle_punkte(ids)
        if d.get("art") == "ebene":
            from kern.wolke import Scan
            probe = Scan("probe", xyz[np.random.default_rng(3).choice(len(xyz), min(len(xyz), 300000), replace=False)])
            n, dd, auf = wz.tisch_finden(probe, zahl(d, "toleranz", 0.5))
            eb = fo.ebene(probe.xyz[auf])
            T = ko.auf_ebene(xyz, eb, d.get("ursprung", "unten"), oben)
        else:
            T = ko.hauptachsen(xyz, d.get("ursprung", "mitte"), oben)
        return {"matrix": T.tolist()}
    if was == "elemente":
        prim, sek = d.get("primaer"), d.get("sekundaer")
        if not prim or not sek:
            raise Fehler("Primär- und Sekundärelement festlegen.")
        schwer = _alle_punkte(ids).mean(0)
        T = ko.aus_elementen(prim, sek, d.get("ursprung"), schwer,
                             d.get("ziel1", oben), d.get("ziel2", "x"))
        return {"matrix": T.tolist()}
    if was == "werte":
        T = ko.aus_werten(d.get("verschieben") or (0, 0, 0), d.get("drehen") or (0, 0, 0))
        return {"matrix": T.tolist()}
    raise Fehler("Unbekannter Koordinaten-Befehl %s" % was)


def ausrichten(was, d):
    p = projekt
    if was == "anwenden":
        matrizen = {int(k): v for k, v in (d.get("matrizen") or {}).items()}
        if not matrizen:
            raise Fehler("Keine Ausrichtung zum Anwenden.")
        p.transformieren(matrizen, d.get("text") or "Ausgerichtet")
        return {}
    if was == "global":
        scans = ziel_scans(d)
        return rg.global_ausrichten(scans, zahl(d, "voxel"), zahl(d, "fang"))

    bewegt, fest = p.scan(d.get("bewegt")), p.scan(d.get("fest"))
    if bewegt.id == fest.id:
        raise Fehler("Bewegter und fester Scan sind derselbe.")
    if was == "auto":
        grob = rg.grob_automatisch(bewegt, fest, zahl(d, "voxel"))
        fein = rg.fein_icp(bewegt, fest, zahl(d, "fang"), start=grob["matrix"],
                           voxel=zahl(d, "voxel") / 2)
        fein["grob"] = grob
        return fein
    if was == "paare":
        ergebnis = rg.aus_punktpaaren(d.get("punkte_bewegt"), d.get("punkte_fest"))
        if d.get("icp"):
            fein = rg.fein_icp(bewegt, fest, zahl(d, "fang"), start=ergebnis["matrix"],
                               voxel=zahl(d, "voxel"))
            fein["paare"] = ergebnis
            return fein
        return ergebnis
    if was == "icp":
        return rg.fein_icp(bewegt, fest, zahl(d, "fang"),
                           iterationen=int(zahl(d, "iterationen", 60)),
                           methode=d.get("methode", "ebene"), start=d.get("start"),
                           voxel=zahl(d, "voxel"))
    if was == "abweichung":
        abst = rg.abweichung(bewegt, fest, d.get("matrix"))
        return {"werte": base64.b64encode(abst.astype(np.float32).tobytes()).decode(),
                "median": round(float(np.median(abst)), 4) if len(abst) else 0,
                "p95": round(float(np.percentile(abst, 95)), 4) if len(abst) else 0}
    raise Fehler("Unbekannter Ausrichte-Befehl %s" % was)


# --- HTTP -------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "V3DScan/" + FASSUNG

    def log_message(self, fmt, *args):
        if "/api/puls" not in (args[0] if args else ""):
            sys.stderr.write("%s %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    def _senden(self, code, daten, typ="application/json; charset=utf-8", kopf=None):
        if isinstance(daten, (dict, list)):
            daten = json.dumps(daten, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(daten)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (kopf or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(daten)

    def _fehler(self, e):
        text = str(e) if isinstance(e, (Fehler, ValueError, KeyError)) else \
            "Interner Fehler: %s" % e
        if isinstance(e, KeyError) and e.args:
            text = str(e.args[0])
        if not isinstance(e, (Fehler, ValueError, KeyError)):
            traceback.print_exc()
        self._senden(400, {"fehler": text})

    def _koerper(self):
        n = int(self.headers.get("Content-Length") or 0)
        daten = bytearray()
        while len(daten) < n:
            stueck = self.rfile.read(min(4 << 20, n - len(daten)))
            if not stueck:
                break
            daten += stueck
        return bytes(daten)

    def _lokal(self):
        # Nur fuer Aufrufe vom eigenen Rechner gedacht; fremde Host-Header
        # (DNS-Rebinding) abweisen.
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("127.0.0.1", "localhost")

    def do_GET(self):
        if not self._lokal():
            return self._senden(403, {"fehler": "nur lokal"})
        url = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        pfad = url.path
        try:
            if pfad == "/api/puls":
                letzter_puls[0] = time.time()
                return self._senden(200, {"ok": True, "fassung": FASSUNG})
            if pfad == "/api/zustand":
                with sperre:
                    return self._senden(200, dict(projekt.zustand(), fassung=FASSUNG,
                                                  formate=list(AUSGEBBAR),
                                                  formate_netz=list(AUSGEBBAR_NETZ)))
            if pfad.startswith("/api/punkte/"):
                with sperre:
                    s = projekt.scan(pfad.rsplit("/", 1)[1])
                    daten = _punkte_binaer(s)
                return self._senden(200, daten, "application/octet-stream",
                                    {"X-Rev": str(s.rev)})
            if pfad.startswith("/api/vorschau/"):
                with sperre:
                    sid = int(pfad.rsplit("/", 1)[1])
                    if sid not in netz_vorschau:
                        raise Fehler("Keine Vorschau vorhanden.")
                    daten = _punkte_binaer(netz_vorschau[sid][1])
                return self._senden(200, daten, "application/octet-stream")
            if pfad.startswith("/api/export/"):
                fmt = q.get("format", "ply")
                with sperre:
                    s = projekt.scan(pfad.rsplit("/", 1)[1])
                    with tempfile.TemporaryDirectory() as tmp:
                        datei = os.path.join(tmp, "x." + fmt)
                        ausgeben(s, datei, fmt)
                        with open(datei, "rb") as f:
                            daten = f.read()
                name = os.path.splitext(s.name)[0] + "." + fmt
                return self._senden(200, daten, "application/octet-stream", {
                    "Content-Disposition": "attachment; filename*=UTF-8''"
                    + urllib.parse.quote(name)})
            if pfad.startswith("/api/formen/csv/"):
                with sperre:
                    sid = int(pfad.rsplit("/", 1)[1])
                    daten = elementliste_csv(sid)
                    name = os.path.splitext(projekt.scan(sid).name)[0] + "_formen.csv"
                return self._senden(200, daten, "text/csv; charset=utf-8", {
                    "Content-Disposition": "attachment; filename*=UTF-8''" + urllib.parse.quote(name)})
            if pfad.startswith("/api/koerper/netz/"):
                with sperre:
                    k = projekt.koerper_holen(pfad.rsplit("/", 1)[1])
                    daten = netz_json(k.daten()["netz"])
                return self._senden(200, daten, kopf={"X-Rev": str(k.rev)})
            if pfad.startswith("/api/koerper/export/"):
                fmt = q.get("format", "step").lower()
                wer = pfad.rsplit("/", 1)[1]
                with sperre:
                    if wer == "alle":
                        liste = list(projekt.koerper.values())
                        name = "koerper"
                    else:
                        liste = [projekt.koerper_holen(wer)]
                        name = liste[0].name
                    daten = kp.exportieren([k.shape for k in liste], fmt)
                name = "".join(c if c.isalnum() or c in "-_ ()" else "_" for c in name).strip() or "koerper"
                name += kp.FORMATE.get(fmt, ".step")
                return self._senden(200, daten, "application/octet-stream", {
                    "Content-Disposition": "attachment; filename*=UTF-8''" + urllib.parse.quote(name)})
            if pfad == "/api/projekt/speichern":
                with sperre:
                    daten = projekt.speichern()
                return self._senden(200, daten, "application/octet-stream", {
                    "Content-Disposition": "attachment; filename=\"projekt.v3dscan\""})
            return self._datei(pfad)
        except Exception as e:
            self._fehler(e)

    def _datei(self, pfad):
        if pfad in ("", "/"):
            pfad = "/index.html"
        voll = os.path.normpath(os.path.join(WEB, pfad.lstrip("/")))
        if not voll.startswith(os.path.normpath(WEB) + os.sep) or not os.path.isfile(voll):
            return self._senden(404, {"fehler": "nicht gefunden"})
        typ = mimetypes.guess_type(voll)[0] or "application/octet-stream"
        if voll.endswith(".js"):
            typ = "text/javascript; charset=utf-8"
        with open(voll, "rb") as f:
            self._senden(200, f.read(), typ)

    def do_POST(self):
        global projekt
        if not self._lokal():
            return self._senden(403, {"fehler": "nur lokal"})
        url = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        pfad = url.path
        try:
            if pfad == "/api/import":
                name = os.path.basename(q.get("name") or "scan.ply")
                daten = self._koerper()
                with tempfile.TemporaryDirectory() as tmp:
                    datei = os.path.join(tmp, "import" + os.path.splitext(name)[1].lower())
                    with open(datei, "wb") as f:
                        f.write(daten)
                    scan = einlesen(datei, name)
                with sperre:
                    projekt.hinzufuegen(scan)
                    return self._senden(200, dict(projekt.zustand(), neu=scan.id))
            if pfad == "/api/projekt/laden":
                daten = self._koerper()
                neu = Projekt.laden(daten)
                with sperre:
                    projekt = neu
                    vorschau_cache.clear()
                    netz_vorschau.clear()
                    return self._senden(200, projekt.zustand())
            if pfad == "/api/projekt/neu":
                with sperre:
                    projekt = Projekt()
                    vorschau_cache.clear()
                    return self._senden(200, projekt.zustand())
            if pfad.startswith("/api/"):
                roh = self._koerper()
                d = json.loads(roh.decode("utf-8")) if roh else {}
                t = time.time()
                with sperre:
                    ergebnis = befehl(pfad[5:], d)
                    ergebnis["zustand"] = projekt.zustand()
                ergebnis["dauer"] = round(time.time() - t, 2)
                return self._senden(200, ergebnis)
            self._senden(404, {"fehler": "nicht gefunden"})
        except Exception as e:
            self._fehler(e)


def browser_oeffnen(url):
    """Unter Windows als eigenes App-Fenster (Edge/Chrome --app), sonst Browser."""
    if os.name == "nt":
        import subprocess
        kandidaten = []
        for basis in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"),
                      os.environ.get("LOCALAPPDATA")):
            if basis:
                kandidaten += [os.path.join(basis, "Microsoft", "Edge", "Application",
                                            "msedge.exe"),
                               os.path.join(basis, "Google", "Chrome", "Application",
                                            "chrome.exe")]
        for exe in kandidaten:
            if os.path.isfile(exe):
                try:
                    subprocess.Popen([exe, "--app=" + url, "--new-window"])
                    return
                except OSError:
                    pass
    import webbrowser
    webbrowser.open(url)


def waechter(max_stille):
    """Beendet den Dienst, wenn die Oberflaeche geschlossen wurde (kein Puls)."""
    while True:
        time.sleep(5)
        if letzter_puls[0] and time.time() - letzter_puls[0] > max_stille:
            os._exit(0)


def main():
    ap = argparse.ArgumentParser(description="V3D Scan")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8797)
    ap.add_argument("--browser", action="store_true")
    ap.add_argument("--auto-ende", type=int, default=0,
                    help="Sekunden ohne Puls bis zum Beenden (0 = nie)")
    ap.add_argument("--laden", nargs="*", default=[], help="Dateien beim Start laden")
    a = ap.parse_args()
    for datei in a.laden:
        projekt.hinzufuegen(einlesen(datei), merken=False)
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    srv.daemon_threads = True
    url = "http://127.0.0.1:%d/" % a.port
    print("V3D Scan %s läuft auf %s" % (FASSUNG, url))
    if a.auto_ende:
        threading.Thread(target=waechter, args=(a.auto_ende,), daemon=True).start()
    if a.browser:
        threading.Timer(0.3, browser_oeffnen, args=(url,)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
