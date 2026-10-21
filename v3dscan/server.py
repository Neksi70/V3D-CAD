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

FASSUNG = "1.1.0"
HIER = os.path.dirname(os.path.abspath(__file__))
if getattr(sys, "frozen", False):
    HIER = getattr(sys, "_MEIPASS", HIER)
WEB = os.path.join(HIER, "web")

from kern import erkennung as er  # noqa: E402
from kern import formen as fo  # noqa: E402
from kern import freiform as ff  # noqa: E402
from kern import koerper as kp  # noqa: E402
from kern import loeser  # noqa: E402
from kern import koordinaten as ko  # noqa: E402
from kern import netz as nz  # noqa: E402
from kern import features as sk_feat  # noqa: E402
from kern import referenz as rf  # noqa: E402
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
    if name == "verlauf/neu":
        k, n = p.koerper_neu_rechnen(d["kid"])
        return {"schritte": n}
    if name == "verlauf/schalten":
        p.verlauf_schalten(d["kid"], int(d["index"]), bool(d.get("aus")))
        return {}
    if name.startswith("referenz/"):
        return referenz_befehl(name.split("/", 1)[1], d)
    if name.startswith("freiform/"):
        return freiform_befehl(name.split("/", 1)[1], d)
    if name.startswith("feature/"):
        return feature_befehl(name.split("/", 1)[1], d)

    if name == "scan/transformieren":
        s = p.scan(d["id"])
        T = np.eye(4)
        art = d.get("art")
        mitte = s.xyz.astype(float).mean(0)
        if art == "skalieren":
            f = d.get("faktor", 1)
            f = np.array(f if isinstance(f, list) else [f, f, f], float)
            if (f <= 0).any():
                raise Fehler("Faktoren müssen größer 0 sein.")
            T[:3, :3] = np.diag(f)
        elif art == "spiegeln":
            k = {"x": 0, "y": 1, "z": 2}[d.get("achse", "x")]
            T[k, k] = -1
        else:
            raise Fehler("Unbekannte Umwandlung „%s“." % art)
        T[:3, 3] = mitte - T[:3, :3] @ mitte          # um die Scanmitte
        p.transformieren({s.id: T.tolist()}, "Scan %s" % ("skaliert" if art == "skalieren" else "gespiegelt"))
        return {}
    if name == "scan/normalen_umdrehen":
        s = p.scan(d["id"])
        p.ersetzen(s.id, neuer_scan=nz.normalen_umdrehen(s), text="Normalen umgedreht")
        return {}
    if name == "scan/abrollen":
        s = p.scan(d["id"])
        el = _erk_element(d["id"], d.get("element"))
        if "achse" not in el:
            raise Fehler("Zum Abrollen einen Zylinder als Bereich wählen.")
        neu = nz.abrollen(s, el["punkt"], el["achse"], zahl(d, "radius", 0) or None)
        p.hinzufuegen(neu)
        return {"neu": neu.id}
    if name == "scan/mittelwert":
        ids = [int(x) for x in d.get("ids") or []] or [x.id for x in p.scans.values() if x.sichtbar]
        if len(ids) < 2:
            raise Fehler("Für ein Mittelwert-Netz mindestens zwei ausgerichtete Scans.")
        neu, bericht = nz.mittelwert_netz([p.scan(i) for i in ids], int(zahl(d, "tiefe", 9)))
        p.hinzufuegen(neu)
        return {"neu": neu.id}
    if name == "scan/mit_koerper":
        s = p.scan(d["id"])
        kids = [int(x) for x in d.get("kids") or []] or [k.id for k in p.koerper.values() if k.sichtbar]
        if not kids:
            raise Fehler("Es gibt keinen (sichtbaren) Körper.")
        m = nz.innen_maske(s, [p.koerper_holen(k).shape for k in kids])
        if not m.any():
            raise Fehler("Kein Scanpunkt liegt im Körper.")
        if d.get("art") == "abziehen":
            p.loeschen({s.id: m}, "Netz: Körper abgezogen")
            return {"anzahl": int(m.sum())}
        neu = p.abtrennen({s.id: m})
        return {"neu": neu.id if neu else None, "anzahl": int(m.sum())}
    if name == "auswahl/speichern":
        masken = masken_lesen(d)
        if not masken:
            raise Fehler("Erst Punkte auswählen.")
        sid, m = next(iter(masken.items()))
        aid = p.naechste_auswahl
        p.naechste_auswahl += 1
        p.auswahlen[aid] = {"id": aid, "name": str(d.get("name") or "Auswahl %d" % aid)[:80], "scan": sid,
                            "anzahl": int(m.sum()), "maske": maske_b64(m)}
        return {"aid": aid}
    if name == "auswahl/holen":
        a = p.auswahlen.get(int(d["aid"]))
        if not a:
            raise Fehler("Diese Auswahl gibt es nicht (mehr).")
        return {"scan": a["scan"], "maske": a["maske"]}
    if name == "auswahl/entfernen":
        p.auswahlen.pop(int(d["aid"]), None)
        return {}
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
            "kanten_id": _b64(netz.get("kanten_id", np.zeros(0)), np.uint32),
            "flaechen_id": _b64(netz.get("flaechen_id", np.zeros(0)), np.uint32)}


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
    if art == "referenz":
        r = projekt.referenz_holen(e.get("rid"))
        if r["art"] == "ebene":
            return sk.ebene_aus_ebene(r, float(e.get("versatz") or 0))
        return sk.ebene_durch_achse({"punkt": r["punkt"], "achse": r["richtung"]}, float(e.get("winkel") or 0))
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


def _teil_scan(s, maske):
    """Scan auf die gewaehlten Punkte beschraenken (Netz: Dreiecke mit allen Ecken gewaehlt)."""
    from kern.wolke import Scan
    if s.tri is not None and len(s.tri):
        tri = s.tri[maske[s.tri].all(1)]
        return Scan(s.name, s.xyz, tri=tri)
    return Scan(s.name, s.xyz[maske], nrm=None if s.nrm is None else s.nrm[maske])


def _kurve_punkte(draht, n=240):
    from OCP.BRepAdaptor import BRepAdaptor_CompCurve
    c = BRepAdaptor_CompCurve(draht)
    u0, u1 = c.FirstParameter(), c.LastParameter()
    aus = []
    for u in np.linspace(u0, u1, n):
        q = c.Value(u)
        aus.append([round(q.X(), 4), round(q.Y(), 4), round(q.Z(), 4)])
    return aus


def _skizze_antwort(skz):
    if skz.get("art") == "3d":
        return {"skizze": dict(skz, kurve=_kurve_punkte(sk_feat.skizze_draht(skz))), "texte": [], "abweichung": [],
                "abweichung_werte": []}
    abw = sk.schnitt_abweichung(skz)
    texte = [[sk.kette_text(e) for e in k["elemente"]] for k in skz["ketten"]]
    kenn = []
    for w in abw:
        kenn.append(None if w is None or not len(w) else
                    {"max": round(float(w.max()), 4), "rms": round(float(np.sqrt(np.mean(w ** 2))), 4)})
    return {"skizze": skz, "texte": texte, "abweichung": kenn,
            "bedingungen": [loeser.text(c) for c in skz.get("bedingungen", [])],
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
        quelle = s
        if d.get("masken"):
            m = masken_lesen(d).get(s.id)
            if m is None or not m.any():
                raise Fehler("Für „nur durch Auswahl“ erst Punkte dieses Scans wählen.")
            quelle = _teil_scan(s, m)
        linien, zu, info = sk.schnitt(quelle, E, zahl(d, "band", 0) or None)
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

    if was == "stapel":
        s = p.scan(d["id"])
        von, bis, anzahl = zahl(d, "von", 0), zahl(d, "bis", 10), int(zahl(d, "anzahl", 5))
        if anzahl < 2 or anzahl > 100:
            raise Fehler("Anzahl der Schnitte: 2 bis 100.")
        tol = max(zahl(d, "toleranz", 0.1), 1e-4)
        liste, leer = [], []
        for v in np.linspace(von, bis, anzahl):
            dd = dict(d, ebene=dict(d.get("ebene") or {}, versatz=float(v)))
            E = _ebene_aus(dd)
            linien, zu, info = sk.schnitt(s, E, zahl(d, "band", 0) or None)
            ketten = sk.skizze_rechnen(linien, zu, tol=tol, luecke=zahl(d, "luecke", 0),
                                       achsen_grad=1.0 if d.get("achsen", True) else 0.0,
                                       radien=bool(d.get("radien", True))) if linien else []
            if not ketten:
                leer.append(round(float(v), 3))
                continue
            skz = sk.skizze_json(ketten, E, info)
            skz["quelle"] = {"scan": s.id, "ebene": dd["ebene"], "toleranz": tol}
            liste.append(skz)
        if not liste:
            raise Fehler("Keiner der Schnitte trifft den Scan.")
        neu = p.skizzen_hinzufuegen(liste, "%d Querschnitte erzeugt" % len(liste))
        return {"sids": [z["id"] for z in neu], "leer": leer}
    if was == "uebernehmen":
        if "skizze" not in skizze_vorschau:
            raise Fehler("Erst einen Schnitt rechnen (Vorschau).")
        daten = skizze_vorschau.pop("skizze")
        ersetzt = skizze_vorschau.pop("ersetzt", None)
        if ersetzt is not None and ersetzt in p.skizzen:
            daten = {k_: v for k_, v in daten.items() if k_ not in ("id", "name", "rev", "sichtbar")}
            z = p.skizze_ersetzen(ersetzt, daten, "bearbeitet")
            # parametrisch: Koerper, die diese Skizze nutzen, nachrechnen
            from kern.verlauf import nutzt_skizze
            neu_gerechnet, fehler_ = [], []
            for k in list(p.koerper.values()):
                if nutzt_skizze(k, z["id"]):
                    try:
                        p.koerper_neu_rechnen(k.id, "nach Skizzenänderung neu aufgebaut")
                        neu_gerechnet.append(k.name)
                    except Exception as ex:
                        fehler_.append("%s: %s" % (k.name, ex))
            return {"sid": z["id"], "neu_gerechnet": neu_gerechnet, "nicht_moeglich": fehler_}
        z = p.skizze_hinzufuegen(daten)
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
        bedingungen = list(skz.get("bedingungen", []))
        if was == "radius" and any(ki in loeser._ketten_von(c) for c in bedingungen):
            # Kontur haengt an Bedingungen: Radius als Mass dazu und alles gemeinsam loesen
            c = {"art": "radius", "e": [ki, ei], "wert": zahl(d, "r")}
            neu_b = [x for x in bedingungen if not (x["art"] == "radius" and x.get("e") == c["e"])] + [c]
            try:
                ketten = loeser.skizze_loesen(ketten, neu_b)
            except (ValueError, KeyError, IndexError) as x:
                raise Fehler(str(x) if isinstance(x, ValueError) else "Bedingung passt nicht zu dieser Kontur.")
            bedingungen = neu_b
            text = "Radius geändert"
        elif was == "radius":
            ketten[ki] = sk.radius_setzen(ketten[ki], ei, zahl(d, "r"),
                                          (skz.get("quelle") or {}).get("toleranz", 0.05))
            text = "Radius geändert"
        else:
            neu = sk.element_entfernen(ketten[ki], ei)
            if neu is None:
                del ketten[ki]
                if ki < len(schnitt):
                    del schnitt[ki]
                bedingungen = loeser.ketten_entfernt(bedingungen, ki)
            else:
                ketten[ki] = neu
                bedingungen = loeser.kette_geaendert(bedingungen, ki)
            text = "Element entfernt"
        daten = {"ketten": ketten, "schnitt": schnitt, "bedingungen": bedingungen}
        if gespeichert:
            skz = p.skizze_ersetzen(skz["id"], daten, text)
        else:
            skz = dict(skz, **daten)
            skizze_vorschau["skizze"] = skz
        return _skizze_antwort(skz)
    if was == "3d":
        P = np.asarray(d.get("punkte") or [], float).reshape(-1, 3)
        if len(P) < 2:
            raise Fehler("Für eine 3D-Skizze mindestens 2 Punkte anklicken.")
        if d.get("auf_scan", True) and d.get("id") is not None:
            sc = p.scan(d["id"])
            if sc.tri is not None and len(sc.tri):
                P = ff._Projektor(sc.xyz, sc.tri)(P)
        z = p.skizze_hinzufuegen({"art": "3d", "punkte3d": np.round(P, 5).tolist(), "glatt": bool(d.get("glatt", True)),
                                  "geschlossen": bool(d.get("geschlossen", False)), "ketten": [], "schnitt": []})
        sk_feat.skizze_draht(z)                       # prueft, ob sich eine Kurve bilden laesst
        return {"sid": z["id"]}
    if was == "neu":
        E = _ebene_aus(d)
        skz = {"ebene": sk.ebene_json(E), "ketten": [], "schnitt": [], "info": {"art": "leer"},
               "quelle": {"scan": d.get("id"), "ebene": d.get("ebene"), "toleranz": zahl(d, "toleranz", 0.1)}}
        skizze_vorschau["skizze"] = skz
        return _skizze_antwort(skz)
    if was == "umriss":
        s = p.scan(d["id"])
        E = _ebene_aus(d)
        tol = max(zahl(d, "toleranz", 0.1), 1e-4)
        linien, zu = sk.umriss(s.xyz, E, tri=s.tri)
        ketten = sk.skizze_rechnen(linien, zu, tol=tol, achsen_grad=1.0 if d.get("achsen", True) else 0.0,
                                   radien=bool(d.get("radien", True)))
        if not ketten:
            raise Fehler("Kein Umriss gefunden.")
        skz = sk.skizze_json(ketten, E, {"art": "umriss"})
        skz["quelle"] = {"scan": s.id, "ebene": d.get("ebene"), "toleranz": tol}
        skizze_vorschau["skizze"] = skz
        return _skizze_antwort(skz)
    if was == "dxf":
        skz, _ = _skizze_ziel(d)
        return {"dxf": sk.dxf(skz), "name": skz.get("name", "skizze")}
    if was in ("zeichnen", "spline", "versatz", "spiegeln", "kopieren", "ecke", "bedingung", "abstand",
               "kette_entfernen", "laenge", "winkel", "hilfe", "bedingung_entfernen", "trennen", "verlaengern"):
        skz, gespeichert = _skizze_ziel(d)
        ketten = [dict(k) for k in skz["ketten"]]
        schnitt = list(skz.get("schnitt", []))
        while len(schnitt) < len(ketten):
            schnitt.append([])
        tol = (skz.get("quelle") or {}).get("toleranz", 0.1)
        bedingungen = list(skz.get("bedingungen", []))

        def kette(i=None):
            i = int(d.get("kette", 0)) if i is None else int(i)
            if not 0 <= i < len(ketten):
                raise Fehler("Kontur %s gibt es nicht." % (i + 1))
            return i, ketten[i]
        if was == "zeichnen":
            ketten.append(sk.kette_json(sk.zeichnen(d.get("art", "linie"), d.get("punkte") or [], d.get("wert"))))
            schnitt.append([])
            text = "Element gezeichnet"
        elif was == "spline":
            i, k = kette()
            ketten[i] = sk.spline_aus_schnitt(k, schnitt[i], int(d.get("von", 0)), int(d.get("bis", 0)),
                                              zahl(d, "toleranz", tol))
            text = "Spline eingepasst"
        elif was == "versatz":
            i, k = kette()
            ketten.append(sk.versatz(k, zahl(d, "abstand", 1), d.get("ecke", "bogen")))
            schnitt.append([])
            text = "Kontur versetzt"
        elif was == "spiegeln":
            i, k = kette()
            achse = d.get("achse", "v")
            if achse == "u":
                pkt, rich = (0, 0), (1, 0)
            elif achse == "v":
                pkt, rich = (0, 0), (0, 1)
            else:
                li = sk.element_lesen(ketten[int(achse["kette"])]["elemente"][int(achse["element"])])
                if li["typ"] != "linie":
                    raise Fehler("Spiegelachse muss eine Linie sein.")
                pkt, rich = li["a"], li["b"] - li["a"]
            ketten.append(sk.spiegeln_2d(k, pkt, rich))
            schnitt.append([])
            text = "Kontur gespiegelt"
        elif was == "kopieren":
            i, k = kette()
            neu = sk.kopieren(k, d.get("art", "linear"), int(zahl(d, "anzahl", 2)), d.get("schritt") or (10, 0),
                              int(zahl(d, "anzahl2", 1)), d.get("schritt2") or (0, 10), d.get("mitte") or (0, 0),
                              zahl(d, "winkel", 360))
            ketten += neu
            schnitt += [[] for _ in neu]
            text = "%d Kopien" % len(neu)
        elif was == "ecke":
            i, k = kette()
            ketten[i] = sk.ecke_runden(k, int(d.get("element", 0)), zahl(d, "r", 1))
            text = "Ecke gerundet"
        elif was in ("bedingung", "abstand", "laenge", "winkel"):
            # alle Bedingungen und Masse bleiben in der Skizze gespeichert und werden gemeinsam geloest
            i, k = kette()
            el = int(d.get("element", 0))
            art = {"abstand": "abstand", "laenge": "laenge", "winkel": "winkel"}.get(was) or d.get("art", "waagrecht")
            c = {"art": art, "e": [i, el]}
            b = d.get("bezug")
            bk = int(d.get("bezug_kette", i))
            if b not in (None, ""):
                c["f"] = [bk, int(b)]
            if art in ("laenge", "radius", "abstand", "winkel", "punkt_abstand"):
                c["wert"] = zahl(d, "wert", 90 if art == "winkel" else 10)
            if not 0 <= el < len(ketten[i]["elemente"]):
                raise Fehler("Element gibt es nicht (mehr).")
            if art in ("fix", "symmetrisch", "punkt_abstand", "auf_kreis"):
                ende = "mitte" if ketten[i]["elemente"][el]["typ"] == "kreis" else d.get("ende", "a")
                c["p"] = [i, el, ende]
                if art == "fix":
                    c["wo"] = ketten[i]["elemente"][el][ende]
                if art in ("symmetrisch", "punkt_abstand"):
                    c["q"] = [bk, int(b if b not in (None, "") else el), d.get("ende2", "b")]
                    c.pop("f", None)
                if art == "symmetrisch":
                    ach = d.get("achse") or {}
                    if "element" not in ach:
                        raise Fehler("Für „symmetrisch“ eine Linie als Achse wählen.")
                    c["achse"] = [int(ach.get("kette", i)), int(ach["element"])]
                if art == "auf_kreis":
                    c["e"] = [bk, int(b)]
            if art in ("parallel", "rechtwinklig", "abstand", "winkel", "gleich", "tangential", "konzentrisch") \
                    and "f" not in c:
                raise Fehler("Als Bezug ein zweites Element wählen.")
            alt = list(skz.get("bedingungen", []))
            # dieselbe Art am selben Element ersetzt die alte Vorgabe (z. B. neue Länge)
            neu_b = [x for x in alt if not (x["art"] == c["art"] and x.get("e") == c["e"] and x.get("f") == c.get("f")
                                             and x.get("p") == c.get("p"))]
            if art == "abstand" and not any(x["art"] == "parallel" and x.get("e") == c["e"] for x in neu_b):
                neu_b.append({"art": "parallel", "e": c["e"], "f": c["f"]})
            neu_b.append(c)
            anker = [[i, el, "a"]] if art == "laenge" else []
            try:
                ketten = loeser.skizze_loesen(ketten, neu_b, anker)
            except (ValueError, KeyError, IndexError) as x:
                raise Fehler(str(x) if isinstance(x, ValueError) else "Bedingung passt nicht zu dieser Kontur.")
            bedingungen = neu_b
            text = {"laenge": "Länge gesetzt", "winkel": "Winkel gesetzt", "abstand": "Abstand gesetzt"}.get(art) \
                or "Bedingung „%s“" % art
        elif was == "hilfe":
            i, k = kette()
            ketten[i] = dict(k, hilfe=bool(d.get("an", not k.get("hilfe"))))
            text = "Hilfslinie" if ketten[i]["hilfe"] else "Kontur"
        elif was == "trennen":
            i, k = kette()
            ketten[i] = sk.trennen(k, int(d.get("element", 0)), zahl(d, "t", 0.5))
            text = "Element getrennt"
        elif was == "verlaengern":
            i, k = kette()
            ketten[i] = sk.verlaengern(ketten, i, int(d.get("element", 0)), zahl(d, "laenge", 0) or None)
            text = "Linie verlängert"
        elif was == "bedingung_entfernen":
            n = int(d.get("index", -1))
            if not 0 <= n < len(bedingungen):
                raise Fehler("Diese Bedingung gibt es nicht.")
            del bedingungen[n]
            text = "Bedingung entfernt"
        else:
            i, _ = kette()
            del ketten[i]
            del schnitt[i]
            bedingungen = loeser.ketten_entfernt(bedingungen, i)
            text = "Kontur entfernt"
        if was in ("spline", "ecke", "trennen"):
            # Elementnummern dieser Kontur haben sich verschoben
            bedingungen = loeser.kette_geaendert(bedingungen, i)
        daten = {"ketten": ketten, "schnitt": schnitt, "bedingungen": bedingungen}
        if gespeichert:
            skz = p.skizze_ersetzen(skz["id"], daten, text)
        else:
            skz = dict(skz, **daten)
            skizze_vorschau["skizze"] = skz
        return _skizze_antwort(skz)
    if was == "bearbeiten":
        # gespeicherte Skizze in die Vorschau holen (Übernehmen ersetzt sie dann)
        z = p.skizze_holen(d["sid"])
        skizze_vorschau["skizze"] = dict(z)
        skizze_vorschau["ersetzt"] = z["id"]
        return _skizze_antwort(z)
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
            elif modus == "beidseitig":
                von, bis = -zahl(d, "laenge2", 0), L
            else:
                von, bis = (0.0, L) if not d.get("umkehren") else (-L, 0.0)
        if d.get("als_flaeche"):
            werkzeug = sk_feat.extrudieren_flaeche(skz, von, bis)
            info = {"operation": "neu", "ziel": None, "volumen": 0, "von": round(von, 3), "bis": round(bis, 3),
                    "laenge": round(bis - von, 3)}
            if d.get("vorschau"):
                return {"vorschau": netz_json(kp.vernetzen(werkzeug)), "info": info}
            k = p.feature(werkzeug, "Extrudierte Fläche", "neu", None, {"typ": "extrusion_flaeche", "skizze": skz["id"],
                          "modus": modus, "von": von, "bis": bis, "laenge": zahl(d, "laenge", 10),
                          "laenge2": zahl(d, "laenge2", 0), "umkehren": bool(d.get("umkehren"))})
            return {"koerper": k.id, "info": info}
        if abs(zahl(d, "schraege", 0)) > 1e-9:
            werkzeug = sk_feat.extrudieren_schraeg(skz, von, bis, zahl(d, "schraege", 0))
        else:
            werkzeug = sk_feat.extrudieren(skz, von, bis)
        erg = _feature_ergebnis(werkzeug, "Extrusion", d, {
            "typ": "extrusion", "skizze": skz["id"], "modus": modus, "von": round(von, 4), "bis": round(bis, 4),
            "laenge": zahl(d, "laenge", 10), "laenge2": zahl(d, "laenge2", 0), "umkehren": bool(d.get("umkehren")),
            "schraege": zahl(d, "schraege", 0)})
        erg["info"].update({"von": round(von, 3), "bis": round(bis, 3), "laenge": round(bis - von, 3)})
        return erg
    if was == "drehen":
        skz = p.skizze_holen(d["sid"])
        el = d.get("element")
        werkzeug = sk_feat.drehen(skz, zahl(d, "winkel", 360), None if el in (None, "") else int(el), zahl(d, "winkel2", 0))
        return _feature_ergebnis(werkzeug, "Drehung", d, {
            "typ": "drehung", "skizze": skz["id"], "winkel": zahl(d, "winkel", 360), "element": el,
            "winkel2": zahl(d, "winkel2", 0)})
    if was in ("runden", "fasen"):
        k = p.koerper_holen(d["kid"])
        kanten = [int(x) for x in d.get("kanten") or []]
        neu = sk_feat.kanten_runden(k.shape, kanten, zahl(d, "radius", 1), fase=(was == "fasen"))
        if d.get("vorschau"):
            return {"vorschau": netz_json(kp.vernetzen(neu)),
                    "info": {"volumen": round(kp.kennwerte(neu)["volumen"], 3)}}
        typ = "Fase" if was == "fasen" else "Rundung"
        from kern.verlauf import kanten_bezug
        p.koerper_aendern(k.id, neu, typ, {"typ": was, "kanten": kanten, "radius": zahl(d, "radius", 1),
                                           "kanten_ref": kanten_bezug(k.shape, kanten)})
        return {"koerper": k.id}
    if was == "aus_flaechen":
        kids = [int(x) for x in d.get("kids") or []]
        sc = p.scan(d["id"]) if d.get("id") is not None else None
        shape, zellen = sk_feat.koerper_aus_flaechen([p.koerper_holen(k).shape for k in kids],
                                                     sc.xyz if sc else None, sc.tri if sc else None)
        info = {"zellen": zellen, "volumen": round(kp.kennwerte(shape)["volumen"], 3)}
        if d.get("vorschau"):
            return {"vorschau": netz_json(kp.vernetzen(shape)), "info": info}
        k = p.koerper_ersetzen_mehrere(kids, shape, "Körper aus Flächen", {"typ": "aus_flaechen", "aus": kids})
        return {"koerper": k.id, "info": info}
    if was == "trennen":
        teile = sk_feat.koerper_trennen(p.koerper_holen(d["kid"]).shape)
        neu = p.koerper_aufteilen(d["kid"], teile)
        return {"koerper": [k.id for k in neu]}
    if was == "gewinde":
        el = _erk_element(d["id"], d.get("element"))
        if "achse" not in el:
            raise Fehler("Für ein Gewinde einen Zylinder, Zapfen oder eine Bohrung wählen.")
        aussen = el.get("typ") not in ("bohrung",)
        r = float(el.get("durchmesser_nenn") or el.get("durchmesser") or 2 * el.get("radius", 0)) / 2
        laenge = zahl(d, "laenge", 0) or float(el.get("hoehe", 10))
        a = np.asarray(el["achse"], float)
        start = np.asarray(el["punkt"], float) - a * float(el.get("hoehe", laenge)) / 2
        werkzeug = sk_feat.gewinde(start, a, r, laenge, zahl(d, "steigung", 1.5), aussen)
        k = p.koerper_holen(d["kid"])
        from kern.koerper import boolean
        shape = boolean(k.shape, werkzeug, "abziehen")
        info = {"durchmesser": round(2 * r, 3), "steigung": zahl(d, "steigung", 1.5), "laenge": round(laenge, 3),
                "art": "Außengewinde" if aussen else "Innengewinde"}
        if d.get("vorschau"):
            return {"vorschau": netz_json(kp.vernetzen(shape)), "info": info}
        p.koerper_aendern(k.id, shape, "Gewinde", dict(info, typ="gewinde", start=start.tolist(), achse_v=a.tolist(),
                                                     r=r, aussen=aussen))
        return {"koerper": k.id, "info": info}
    if was in ("bool", "verschieben", "spiegeln", "muster", "schale", "aufdicken", "schneiden_flaeche",
               "skalieren", "flaeche_verschieben", "flaechen_loeschen", "formschraege", "versetzen",
               "duplizieren", "verlaengern", "projizieren", "ebene_schneiden"):
        return _koerper_werkzeug(was, d)
    if was == "loft":
        sids = [int(x) for x in d.get("sids") or []]
        werkzeug = sk_feat.loft([p.skizze_holen(x) for x in sids], bool(d.get("glatt", True)))
        return _feature_ergebnis(werkzeug, "Loft", d, {"typ": "loft", "skizzen": sids, "glatt": bool(d.get("glatt", True))})
    if was == "sweep":
        werkzeug = sk_feat.sweep(p.skizze_holen(d["profil"]), p.skizze_holen(d["pfad"]))
        return _feature_ergebnis(werkzeug, "Sweep", d, {"typ": "sweep", "profil": d["profil"], "pfad": d["pfad"]})
    if was == "pipe":
        werkzeug = sk_feat.pipe(p.skizze_holen(d["pfad"]), zahl(d, "radius", 2), zahl(d, "innen", 0))
        return _feature_ergebnis(werkzeug, "Rohr", d, {"typ": "rohr", "pfad": d["pfad"], "radius": zahl(d, "radius", 2),
                                                       "innen": zahl(d, "innen", 0)})
    if was == "abwickeln":
        k = p.koerper_holen(d["kid"])
        a = sk_feat.abwickeln(k.shape, [int(x) for x in d.get("flaechen") or []] or None)
        return {"umriss": [[[round(x, 4), round(y, 4)] for x, y in u] for u in a["umriss"]],
                "svg": sk_feat.umriss_svg(a["umriss"]),
                "info": {k_: (round(v, 5) if isinstance(v, float) else [round(x, 3) for x in v])
                         for k_, v in a["info"].items()}}
    if was == "extrudieren_3d":
        z = p.skizze_holen(d["sid"])
        if z.get("art") != "3d":
            raise Fehler("Bitte eine 3D-Skizze wählen.")
        shape = sk_feat.extrudieren_3d(z, d.get("richtung", "mittel"), zahl(d, "laenge", 20), bool(d.get("beidseitig", True)))
        if d.get("vorschau"):
            return {"vorschau": netz_json(kp.vernetzen(shape)), "info": {"flaeche": round(kp.kennwerte(shape)["flaeche"], 2)}}
        k = p.feature(shape, "Extrudierte Kurve", "neu", None, {"typ": "extrusion_3d", "skizze": z["id"],
                      "richtung": d.get("richtung", "mittel"), "laenge": zahl(d, "laenge", 20),
                      "beidseitig": bool(d.get("beidseitig", True))})
        return {"koerper": k.id}
    if was == "fuellen":
        scan_p = None
        nachbar = None
        if d.get("kid") is not None:
            nachbar = p.koerper_holen(d["kid"]).shape
            raender = sk_feat.freie_raender(nachbar)
            if not raender:
                raise Fehler("Der Körper hat keine offenen Ränder.")
            nr = int(zahl(d, "rand", 0))
            if not 0 <= nr < len(raender):
                raise Fehler("Rand %d gibt es nicht (%d offene Ränder)." % (nr + 1, len(raender)))
            rand = raender[nr]
        else:
            z = p.skizze_holen(d["sid"])
            if z.get("art") != "3d" or not z.get("geschlossen"):
                raise Fehler("Bitte eine geschlossene 3D-Skizze oder einen Körper mit offenem Rand wählen.")
            rand = sk_feat.skizze_draht(z)
        if d.get("auf_scan") and d.get("id") is not None:
            sc = p.scan(d["id"])
            # Scanpunkte innerhalb des Randes (Projektion auf die Ausgleichsebene des Randes)
            rp = np.asarray(_kurve_punkte(rand, 120), float)
            c = rp.mean(0)
            _, _, vt = np.linalg.svd(rp - c)
            q2 = (rp - c) @ vt[:2].T
            Q = sc.xyz.astype(float)
            if sc.tri is not None and len(sc.tri):
                # Netz dicht abtasten - grosse ebene Dreiecke haben im Rand oft gar keine Eckpunkte
                from kern.o3d import o3d
                m = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(Q), o3d.utility.Vector3iVector(sc.tri.astype(np.int32)))
                Q = np.r_[Q, np.asarray(m.sample_points_uniformly(200000).points)]
            S2 = (Q - c) @ vt[:2].T
            tief = np.abs((Q - c) @ vt[2])
            # nur Scanpunkte nahe der Randflaeche (sonst zaehlt z. B. die Unterseite einer Platte mit)
            rand_rms = float(np.sqrt(np.mean(((rp - c) @ vt[2]) ** 2)))
            grenze = max(4 * rand_rms, 0.1 * float(np.ptp(q2, axis=0).max()))
            vor = tief < grenze
            drin = np.zeros(len(Q), bool)
            drin[vor] = sk.innen(q2, S2[vor])
            kand = Q[drin]
            if len(kand) > 300:
                kand = kand[np.random.default_rng(0).choice(len(kand), 300, replace=False)]
            scan_p = kand
        shape = sk_feat.flaeche_fuellen(rand, nachbar, scan_p, bool(d.get("stetig", True)))
        info = {"flaeche": round(kp.kennwerte(shape)["flaeche"], 2), "scanpunkte": 0 if scan_p is None else int(len(scan_p))}
        if d.get("vorschau"):
            return {"vorschau": netz_json(kp.vernetzen(shape)), "info": info}
        k = p.feature(shape, "Füllfläche", "neu", None, {"typ": "fuellen"})
        return {"koerper": k.id, "info": info}
    if was == "naehen":
        kids = [int(x) for x in d.get("kids") or []]
        if len(kids) < 2:
            raise Fehler("Mindestens zwei Flächen/Körper zum Nähen wählen.")
        shape, info = sk_feat.naehen([p.koerper_holen(k).shape for k in kids], zahl(d, "toleranz", 0.01))
        if d.get("vorschau"):
            return {"vorschau": netz_json(kp.vernetzen(shape)), "info": info}
        k = p.koerper_ersetzen_mehrere(kids, shape, "Genäht", {"typ": "naehen", "aus": kids})
        return {"koerper": k.id, "info": info}
    if was == "wickeln":
        z = p.skizze_holen(d["sid"])
        el = _erk_element(d["id"], d.get("element"))
        if "achse" not in el:
            raise Fehler("Zum Wickeln einen Zylinder als Bereich wählen.")
        r = float(el.get("durchmesser") or 2 * el.get("radius", 0)) / 2
        werkzeug = sk_feat.skizze_wickeln(z, el["punkt"], el["achse"], r, zahl(d, "dicke", 1), bool(d.get("aussen", True)))
        return _feature_ergebnis(werkzeug, "Wicklung", d, {"typ": "wickeln", "skizze": z["id"], "punkt": list(el["punkt"]),
                                                           "achse": list(el["achse"]), "radius": r, "dicke": zahl(d, "dicke", 1),
                                                           "aussen": bool(d.get("aussen", True))})
    if was == "uebergang":
        ka, kb = p.koerper_holen(d["kid_a"]), p.koerper_holen(d["kid_b"])
        shape = sk_feat.uebergang(ka.shape, int(d["kante_a"]), kb.shape, int(d["kante_b"]))
        info = {"flaeche": round(kp.kennwerte(shape)["flaeche"], 2)}
        if d.get("vorschau"):
            return {"vorschau": netz_json(kp.vernetzen(shape)), "info": info}
        k = p.feature(shape, "Übergangsfläche", "neu", None, {"typ": "uebergang"})
        return {"koerper": k.id, "info": info}
    if was == "radius_vorschlag":
        k = p.koerper_holen(d["kid"])
        elemente = []
        for erk in p.erkennung.values():
            elemente += erk["elemente"]
        r = sk_feat.radius_vorschlag(k.shape, [int(x) for x in d.get("kanten") or []], elemente)
        return {"radius": None if r is None else round(r, 3)}
    raise Fehler("Unbekannter Feature-Befehl %s" % was)


def _koerper_werkzeug(was, d):
    p = projekt
    k = p.koerper_holen(d["kid"])
    vorschau = bool(d.get("vorschau"))

    def antwort(shape, eintrag, typ, neu=False):
        info = {k_: round(v, 3) for k_, v in kp.kennwerte(shape).items() if k_ != "groesse"}
        if vorschau:
            return {"vorschau": netz_json(kp.vernetzen(shape)), "info": info}
        if neu:
            erg = p.feature(shape, typ, "neu", None, eintrag)
        else:
            erg = p.koerper_aendern(k.id, shape, typ, eintrag)
        return {"koerper": erg.id, "info": info}

    if was == "bool":
        b = p.koerper_holen(d["kid2"])
        art = d.get("art", "vereinen")
        if art not in ("vereinen", "abziehen", "schneiden"):
            raise Fehler("Unbekannte Verknüpfung „%s“." % art)
        rf_info = {}
        shape = sk_feat.koerper_bool(k.shape, b.shape, art, rf_info)
        hinweis = None
        if rf_info.get("stufe", "normal") != "normal":
            hinweis = {"repariert": "erst nach Reparatur der Eingangskörper (ShapeFix) gelungen",
                       "unscharf": "nur mit Toleranz %.2g mm gelungen (fast berührende Flächen)" % rf_info.get("fuzzy", 0),
                       "nachrepariert": "Ergebnis musste repariert werden",
                       "maengel": "mit kleinen Topologie-Mängeln (BRepCheck) – für STL unkritisch, STEP im Ziel-CAD prüfen"
                       }[rf_info["stufe"]]
        if vorschau:
            a = antwort(shape, None, None)
            if hinweis:
                a["hinweis"] = "Verknüpfung " + hinweis + "."
            return a
        text = {"vereinen": "vereint mit", "abziehen": "minus", "schneiden": "geschnitten mit"}[art]
        erg = p.koerper_kombinieren(k.id, b.id, shape, text)
        return {"koerper": erg.id, **({"hinweis": "Verknüpfung " + hinweis + "."} if hinweis else {})}
    if was == "verschieben":
        shape = sk_feat.verschieben(k.shape, d.get("versatz") or (0, 0, 0), d.get("drehung") or (0, 0, 0))
        if d.get("kopie"):
            return antwort(shape, {"typ": "kopie", "von": k.id}, "Kopie", neu=True)
        return antwort(shape, {"typ": "verschieben", "versatz": d.get("versatz"), "drehung": d.get("drehung")},
                       "Verschieben")
    if was == "spiegeln":
        ebene = d.get("ebene", "yz")
        if str(ebene).startswith("ref:"):
            r = p.referenz_holen(int(str(ebene)[4:]))
            if r["art"] != "ebene":
                raise Fehler("„%s“ ist keine Ebene." % r["name"])
            ebene = (r["punkt"], r["normale"])
        shape = sk_feat.spiegeln(k.shape, ebene, d.get("durch", "mitte"), bool(d.get("vereinen", True)))
        return antwort(shape, {"typ": "spiegeln", "ebene": d.get("ebene"), "durch": d.get("durch", "mitte"),
                               "vereinen": bool(d.get("vereinen", True))}, "Spiegeln")
    if was == "muster":
        shape = sk_feat.muster(k.shape, d.get("art", "linear"), int(zahl(d, "anzahl", 3)),
                               d.get("versatz") or (10, 0, 0), d.get("achse", "z"), zahl(d, "winkel", 360),
                               d.get("punkt") or (0, 0, 0), int(zahl(d, "anzahl2", 1)), d.get("versatz2") or (0, 10, 0))
        return antwort(shape, {"typ": "muster", "art": d.get("art"), "anzahl": int(zahl(d, "anzahl", 3)),
                               "versatz": d.get("versatz") or (10, 0, 0), "achse": d.get("achse", "z"),
                               "winkel": zahl(d, "winkel", 360), "punkt": d.get("punkt") or (0, 0, 0),
                               "anzahl2": int(zahl(d, "anzahl2", 1)), "versatz2": d.get("versatz2") or (0, 10, 0)}, "Muster")
    if was == "schale":
        shape = sk_feat.schale(k.shape, zahl(d, "dicke", 2), [int(x) for x in d.get("flaechen") or []])
        from kern.verlauf import flaechen_bezug
        return antwort(shape, {"typ": "schale", "dicke": zahl(d, "dicke", 2),
                               "flaechen_ref": flaechen_bezug(k.shape, [int(x) for x in d.get("flaechen") or []])}, "Schale")
    if was == "aufdicken":
        shape = sk_feat.aufdicken(k.shape, zahl(d, "dicke", 2))
        return antwort(shape, {"typ": "aufdicken", "von": k.id, "dicke": zahl(d, "dicke", 2)}, "Aufdickung", neu=True)
    if was == "schneiden_flaeche":
        f = p.koerper_holen(d["fid"])
        from OCP.TopAbs import TopAbs_FACE
        from OCP.TopExp import TopExp_Explorer
        ex = TopExp_Explorer(f.shape, TopAbs_FACE)
        if not ex.More():
            raise Fehler("„%s“ enthält keine Fläche." % f.name)
        shape = ff.koerper_schneiden(k.shape, ex.Current(), d.get("behalten", "unten"))
        return antwort(shape, {"typ": "beschneiden", "flaeche": f.id, "behalten": d.get("behalten")}, "Beschnitt")
    if was == "ebene_schneiden":
        r = p.referenz_holen(d["rid"])
        if r["art"] != "ebene":
            raise Fehler("Bitte eine Referenzebene wählen.")
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
        from OCP.gp import gp_Dir, gp_Pln, gp_Pnt
        gross = 10 * max(kp.kennwerte(k.shape)["groesse"]) + 100
        ebene = BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(*map(float, r["punkt"])), gp_Dir(*map(float, r["normale"]))),
                                        -gross, gross, -gross, gross).Face()
        if d.get("behalten") == "beide":
            if vorschau:
                return antwort(ff.koerper_schneiden(k.shape, ebene, "unten"), None, None)
            oben = ff.koerper_schneiden(k.shape, ebene, "oben")
            unten = ff.koerper_schneiden(k.shape, ebene, "unten")
            neu = p.koerper_aufteilen(k.id, [unten, oben])
            return {"koerper": [x.id for x in neu]}
        shape = ff.koerper_schneiden(k.shape, ebene, d.get("behalten", "unten"))
        return antwort(shape, {"typ": "ebene_schneiden", "referenz": r["id"], "behalten": d.get("behalten", "unten")}, "Schnitt")
    if was == "versetzen":
        shape = sk_feat.flaeche_versetzen(k.shape, zahl(d, "abstand", 1))
        return antwort(shape, {"typ": "versetzen", "von": k.id, "abstand": zahl(d, "abstand", 1)}, "Versatz", neu=True)
    if was == "duplizieren":
        shape = sk_feat.flaechen_kopieren(k.shape, [int(x) for x in d.get("flaechen") or []])
        return antwort(shape, {"typ": "duplizieren", "von": k.id}, "Flächenkopie", neu=True)
    if was == "verlaengern":
        shape = sk_feat.flaeche_verlaengern(k.shape, zahl(d, "laenge", 5))
        return antwort(shape, {"typ": "verlaengern", "laenge": zahl(d, "laenge", 5)}, "Verlängert")
    if was == "projizieren":
        shape = sk_feat.skizze_auf_flaeche(k.shape, p.skizze_holen(d["sid"]), d.get("behalten", "innen"))
        return antwort(shape, {"typ": "projizieren", "skizze": d["sid"], "behalten": d.get("behalten", "innen")}, "Projektion")
    if was == "skalieren":
        f = d.get("faktor", 1)
        shape = sk_feat.skalieren(k.shape, f if isinstance(f, list) else float(f))
        return antwort(shape, {"typ": "skalieren", "faktor": f}, "Skalieren")
    if was == "flaeche_verschieben":
        shape = sk_feat.flaeche_verschieben(k.shape, [int(x) for x in d.get("flaechen") or []], zahl(d, "abstand", 1))
        from kern.verlauf import flaechen_bezug
        return antwort(shape, {"typ": "flaeche_verschieben", "abstand": zahl(d, "abstand", 1),
                               "flaechen_ref": flaechen_bezug(k.shape, [int(x) for x in d.get("flaechen") or []])},
                       "Fläche verschoben")
    if was == "flaechen_loeschen":
        shape = sk_feat.flaechen_loeschen(k.shape, [int(x) for x in d.get("flaechen") or []])
        from kern.verlauf import flaechen_bezug
        return antwort(shape, {"typ": "flaechen_loeschen",
                               "flaechen_ref": flaechen_bezug(k.shape, [int(x) for x in d.get("flaechen") or []])},
                       "Flächen entfernt")
    if was == "formschraege":
        r = {"z": (0, 0, 1), "-z": (0, 0, -1), "y": (0, 1, 0), "-y": (0, -1, 0), "x": (1, 0, 0), "-x": (-1, 0, 0)}[d.get("richtung", "z")]
        shape = sk_feat.formschraege(k.shape, [int(x) for x in d.get("flaechen") or []], zahl(d, "winkel", 1), r)
        from kern.verlauf import flaechen_bezug
        return antwort(shape, {"typ": "formschraege", "winkel": zahl(d, "winkel", 1), "richtung_v": list(r),
                               "flaechen_ref": flaechen_bezug(k.shape, [int(x) for x in d.get("flaechen") or []])},
                       "Formschräge")
    raise Fehler("Unbekanntes Werkzeug %s" % was)


def _erk_element(sid, eid):
    erk = projekt.erkennung.get(int(sid))
    if not erk:
        raise Fehler("Zuerst Bereiche erkennen (BEREICHE → Automatisch).")
    el = next((x for x in erk["elemente"] if x["id"] == eid), None)
    if el is None:
        raise Fehler("Bereich %s gibt es nicht (mehr)." % eid)
    return el


def referenz_befehl(was, d):
    p = projekt
    if was == "symmetrie":
        s = p.scan(d["id"])
        e, rms, kand = rf.symmetrieebene(s.xyz)
        info = {"rms": round(rms, 4), "kandidaten": [round(k["rms"], 4) for k in kand]}
        if d.get("vorschau"):
            return {"vorschau": rf.json_form(e), "info": info}
        r = p.referenz_hinzufuegen(dict(rf.json_form(e), quelle="symmetrie", rms=round(rms, 4)), "Symmetrieebene")
        return {"rid": r["id"], "info": info}
    if was == "bereich":
        el = _erk_element(d["id"], d.get("element"))
        if el.get("art") == "ebene":
            r = p.referenz_hinzufuegen(rf.json_form(rf.ebene_aus_element(el, zahl(d, "versatz", 0))), "Ebene")
        else:
            r = p.referenz_hinzufuegen(rf.json_form(rf.achse_aus_element(el)), "Achse")
        return {"rid": r["id"]}
    if was == "eingabe":
        r = p.referenz_hinzufuegen(rf.json_form(rf.ebene_eingabe(d["punkt"], d["normale"])), "Ebene")
        return {"rid": r["id"]}
    if was == "drei_punkte":
        P = d.get("punkte") or []
        if len(P) < 3:
            raise Fehler("Drei Punkte nötig (Messen → Winkel oder Kreis anklicken).")
        r = p.referenz_hinzufuegen(rf.json_form(rf.ebene_drei_punkte(*P[:3])), "Ebene")
        return {"rid": r["id"]}
    if was in ("achse_ebenen", "punkt_ebenen"):
        es = [p.referenz_holen(x) for x in d.get("rids") or []]
        if any(e["art"] != "ebene" for e in es):
            raise Fehler("Bitte Referenz-EBENEN wählen.")
        if was == "achse_ebenen":
            if len(es) != 2:
                raise Fehler("Zwei Ebenen wählen.")
            r = p.referenz_hinzufuegen(rf.json_form(rf.achse_aus_ebenen(*es)), "Achse")
        else:
            if len(es) != 3:
                raise Fehler("Drei Ebenen wählen.")
            r = p.referenz_hinzufuegen(rf.json_form(rf.punkt_aus_ebenen(*es)), "Punkt")
        return {"rid": r["id"]}
    if was in ("durch_linie", "entlang_pfad", "aus_skizze"):
        z = p.skizze_holen(d["sid"])
        if was == "durch_linie":
            e = sk_feat.ebene_durch_linie(z, int(zahl(d, "element", 0)))
        elif was == "entlang_pfad":
            e = sk_feat.ebene_entlang_pfad(z, zahl(d, "anteil", 0))
        else:
            if z.get("art") == "3d":
                raise Fehler("Eine 3D-Skizze hat keine Ebene.")
            E = sk.ebene_lesen(z["ebene"])
            e = {"art": "ebene", "punkt": E["ursprung"], "normale": E["n"]}
        r = p.referenz_hinzufuegen(rf.json_form(e), "Ebene")
        return {"rid": r["id"]}
    if was == "mitte":
        a = _erk_element(d["id"], d.get("element"))
        b = _erk_element(d["id"], d.get("element2"))
        if a.get("art") != "ebene" or b.get("art") != "ebene":
            raise Fehler("Für die Mittelebene zwei Ebenen-Bereiche wählen.")
        r = p.referenz_hinzufuegen(rf.json_form(rf.mittelebene(a, b)), "Mittelebene")
        return {"rid": r["id"]}
    if was == "setzen":
        sichtbar = d.get("sichtbar")
        p.referenz_setzen(d["rid"], None if sichtbar is None else bool(sichtbar), d.get("name"))
        return {}
    if was == "entfernen":
        p.referenz_entfernen(d["rid"])
        return {}
    raise Fehler("Unbekannter Referenz-Befehl %s" % was)


def freiform_befehl(was, d):
    p = projekt
    if was == "auto":
        s = p.scan(d["id"])
        if s.tri is None or not len(s.tri):
            raise Fehler("Die automatische Flächenrückführung braucht ein Dreiecksnetz – "
                         "Punktwolke erst vernetzen (POLYGONE → Netz aus Punktwolke).")
        flaechen = int(zahl(d, "flaechen", 400))
        if d.get("vorschau"):
            V, F = ff.quad_netz(s.xyz, s.tri, flaechen, zahl(d, "kantenwinkel", 0))
            seg = np.stack([V[F], V[np.roll(F, -1, axis=1)]], 2).reshape(-1, 2, 3)
            return {"vierecke": int(len(F)), "linien": _b64(seg, np.float32),
                    "V": _b64(V, np.float32), "F": _b64(F, np.uint32)}
        kaefig = None
        if d.get("kaefig"):
            kaefig = {"V": np.frombuffer(base64.b64decode(d["kaefig"]["V"]), np.float32).reshape(-1, 3),
                      "F": np.frombuffer(base64.b64decode(d["kaefig"]["F"]), np.uint32).reshape(-1, 4).astype(np.int64)}
        shape, info = ff.auto_flaechen(s.xyz, s.tri, flaechen, int(zahl(d, "raster", 9)), zahl(d, "kantenwinkel", 0),
                                       glatt=bool(d.get("glatt", True)), kaefig=kaefig,
                                       scharf_von_hand=d.get("scharf") or None)
        info.pop("quad", None)
        # Guete: Stichprobe der Scanpunkte gegen die Flaechen
        rng = np.random.default_rng(0)
        idx = rng.choice(len(s.xyz), min(len(s.xyz), 20000), replace=False)
        w = np.abs(kp.abweichung([shape], s.xyz[idx]))
        info.update({"median": round(float(np.median(w)), 4), "p95": round(float(np.percentile(w, 95)), 4),
                     "max": round(float(w.max()), 4)})
        k = p.feature(shape, "Freiform", "neu", None, {"typ": "freiform", "scan": s.id, "flaechen": flaechen})
        return {"koerper": k.id, "info": info}
    if was == "flaeche":
        P, _ = _gewaehlte_punkte(d)
        face, info = ff.flaeche_einpassen(P, int(zahl(d, "raster", 0)) or None, zahl(d, "verlaengern", 10) / 100.0,
                                          int(zahl(d, "glaettung", 0)))
        w = np.abs(kp.abweichung([face], P))
        info.update({"median": round(float(np.median(w)), 4), "p95": round(float(np.percentile(w, 95)), 4)})
        if d.get("vorschau"):
            return {"vorschau": netz_json(kp.vernetzen(face)), "info": info}
        k = p.feature(face, "Fläche", "neu", None, {"typ": "flaeche", "punkte": int(len(P))})
        return {"koerper": k.id, "info": info}
    if was in ("kaefig_neu", "kaefig_wrap", "kaefig_op", "kaefig_obj"):
        s = p.scan(d["id"])
        if s.tri is None or not len(s.tri):
            raise Fehler("Die Freiform braucht ein Dreiecksnetz – Punktwolke erst vernetzen.")
        raster = None
        zuordnung = None
        if was in ("kaefig_neu", "kaefig_wrap"):
            P, _ = _gewaehlte_punkte(d)
            if was == "kaefig_neu":
                V, F, raster = ff.kaefig_auf_auswahl(P, s.xyz, s.tri, int(zahl(d, "nu", 6)), int(zahl(d, "nv", 6)))
            else:
                V, F, raster = ff.kaefig_wrap(P, s.xyz, s.tri, int(zahl(d, "nu", 12)), int(zahl(d, "nv", 6)))
        elif was == "kaefig_obj":
            V, F = ff.obj_kaefig(d.get("text", ""))
            V = ff._Projektor(s.xyz, s.tri)(V)
        else:
            V = np.frombuffer(base64.b64decode(d["V"]), np.float32).reshape(-1, 3).astype(float)
            F = np.frombuffer(base64.b64decode(d["F"]), np.uint32).reshape(-1, 4).astype(np.int64)
            op = d.get("op")
            if op == "feiner":
                V, F = ff.kaefig_feiner(V, F, s.xyz, s.tri)
            elif op == "glaetten":
                V = ff.kaefig_glaetten(V, F, s.xyz, s.tri, d.get("ids"))
            elif op == "symmetrie":
                r = p.referenz_holen(d["rid"])
                if r["art"] != "ebene":
                    raise Fehler("Für Symmetrie eine Referenzebene wählen.")
                V, F = ff.kaefig_symmetrisch(V, F, r["punkt"], r["normale"])
                V = ff._Projektor(s.xyz, s.tri)(V)
            elif op == "einrasten":
                V = ff._Projektor(s.xyz, s.tri)(V)
            elif op in ("extrudieren", "bruecke", "verschmelzen", "schleife", "loeschen", "ausrichten",
                        "verschieben", "umdrehen", "auf_scan"):
                ids = [int(i) for i in d.get("ids") or []]
                kanten = [tuple(int(x) for x in k) for k in d.get("kanten") or []]
                if op == "extrudieren":
                    if not kanten:
                        raise Fehler("Randkanten wählen (Modus Kanten).")
                    laenge = zahl(d, "laenge", 0) or None
                    V, F, zuordnung = ff.kaefig_extrudieren(V, F, kanten, laenge)
                    if d.get("auf_scan", True):
                        neu = np.arange(len(zuordnung), len(V))
                        V[neu] = ff._Projektor(s.xyz, s.tri)(V[neu])
                elif op == "bruecke":
                    if len(kanten) != 2:
                        raise Fehler("Für die Brücke genau zwei Randkanten wählen.")
                    V, F, zuordnung = ff.kaefig_bruecke(V, F, kanten[0], kanten[1])
                elif op == "verschmelzen":
                    if len(kanten) == 2:
                        (a, b), (c, e) = kanten
                        paare = [(a, e), (b, c)] if np.linalg.norm(V[a] - V[e]) + np.linalg.norm(V[b] - V[c]) <= \
                            np.linalg.norm(V[a] - V[c]) + np.linalg.norm(V[b] - V[e]) else [(a, c), (b, e)]
                    elif len(ids) == 2:
                        paare = [tuple(ids)]
                    else:
                        raise Fehler("Zum Verschmelzen zwei Ecken oder zwei Kanten wählen.")
                    V, F, zuordnung = ff.kaefig_verschmelzen(V, F, paare)
                elif op == "schleife":
                    if len(kanten) != 1:
                        raise Fehler("Für „Schleife einfügen“ genau eine Kante wählen.")
                    V, F, zuordnung = ff.kaefig_schleife(V, F, kanten[0], s.xyz, s.tri)
                elif op == "loeschen":
                    if not d.get("flaechen"):
                        raise Fehler("Vierecke wählen (Modus Flächen).")
                    V, F, zuordnung = ff.kaefig_loeschen(V, F, d["flaechen"])
                elif op == "ausrichten":
                    V = ff.kaefig_ausrichten(V, ids)
                elif op == "verschieben":
                    if not ids:
                        raise Fehler("Ecken wählen (Modus Ecken).")
                    V = ff.kaefig_verschieben(V, F, ids, d.get("versatz") or (0, 0, 0), zahl(d, "normal", 0))
                elif op == "umdrehen":
                    F = F[:, ::-1].copy()
                else:
                    wahl = ids or list(range(len(V)))
                    V[wahl] = ff._Projektor(s.xyz, s.tri)(V[wahl])
            else:
                raise Fehler("Unbekannte Käfig-Operation „%s“." % op)
        seg = np.stack([V[F], V[np.roll(F, -1, axis=1)]], 2).reshape(-1, 2, 3)
        aus = {"V": _b64(V, np.float32), "F": _b64(F, np.uint32), "linien": _b64(seg, np.float32),
               "vierecke": int(len(F)), "raster": raster,
               "unregelmaessig": [[int(i), int(n), bool(r)] for i, n, r in ff.kaefig_unregelmaessig(F)]}
        if zuordnung is not None:
            # scharfe Kanten mit umnummerieren; Raster ist nach Topologie-Aenderung nicht mehr gueltig
            neu = []
            for a, b in d.get("scharf") or []:
                a, b = int(zuordnung[a]) if a < len(zuordnung) else -1, int(zuordnung[b]) if b < len(zuordnung) else -1
                if a >= 0 and b >= 0 and a != b:
                    neu.append("%d-%d" % (min(a, b), max(a, b)))
            aus["scharf"] = neu
            aus["topologie"] = True
        return aus
    if was == "eine_flaeche":
        s = p.scan(d["id"])
        V = np.frombuffer(base64.b64decode(d["V"]), np.float32).reshape(-1, 3).astype(float)
        face = ff.raster_eine_flaeche(V, d["raster"], s.xyz, s.tri)
        k = p.feature(face, "Freiform", "neu", None, {"typ": "freiform_raster"})
        return {"koerper": k.id}
    raise Fehler("Unbekannter Freiform-Befehl %s" % was)


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
                name += ".stl" if fmt == "stl" else kp.FORMATE.get(fmt, ".step")
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
                endung = os.path.splitext(name)[1].lower()
                if endung in (".step", ".stp", ".iges", ".igs"):
                    # CAD-Datei -> Koerper (z. B. zum Vergleichen oder als Ausgangsteil)
                    shape = kp.einlesen(daten, "step" if endung in (".step", ".stp") else "iges")
                    if shape is None or shape.IsNull():
                        raise Fehler("Die CAD-Datei enthält keine Geometrie.")
                    with sperre:
                        k = projekt.koerper_hinzufuegen(shape, os.path.splitext(name)[0],
                                                        [{"name": "Import " + name, "typ": "import"}])
                        return self._senden(200, dict(projekt.zustand(), koerper_neu=k.id))
                with tempfile.TemporaryDirectory() as tmp:
                    datei = os.path.join(tmp, "import" + endung)
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
