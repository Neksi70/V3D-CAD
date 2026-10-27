# Projekt = alle geladenen Scans plus Rueckgaengig/Wiederholen.
#
# Rueckgaengig speichert vor jeder Aenderung Kopien der betroffenen Scans
# (nicht Differenzen): einfach und robust. Damit der Speicher nicht vollaeuft,
# gilt eine Obergrenze in Bytes - aelteste Schritte fallen zuerst weg.
#
# Volumenkoerper (kern/koerper.py) stehen im Rueckgaengig-Eintrag unter dem
# Schluessel "koerper" als Stand der ganzen Koerperliste; TopoDS_Shapes sind
# unveraenderlich, darum reichen dort Referenzen statt Kopien.

import copy
import io
import json
import zipfile

import numpy as np

from .wolke import Scan

FARBEN = ["#4fa3e0", "#e0914f", "#6cc36c", "#c96fd6", "#e0cf4f", "#4fd6c9",
          "#e05f6f", "#9aa4ff"]
UNDO_BYTES = 3 * 1024 ** 3
UNDO_SCHRITTE = 30


class Projekt:
    def __init__(self):
        self.scans = {}           # id -> Scan, Reihenfolge = Einfuegen
        self.naechste_id = 1
        self.undo = []            # [(text, {id: Scan-Kopie oder None})]
        self.redo = []
        self.aenderungen = 0      # zaehlt jede Aenderung (Auto-Sicherung)
        # Geometrieerkennung je Scan: {"rev", "elemente" (JSON), "labels" (int32),
        # "zusammenfassung", "freiform"} - gilt nur fuer genau diesen Datenstand
        self.erkennung = {}
        self.koerper = {}         # id -> koerper.Koerper
        self.naechster_koerper = 1
        self.grundkoerper_zaehler = 0   # "Grundkörper<N>" wie in Design X
        self.zaehler = {}               # Feature-Typ -> laufende Nummer ("Extrusion3")
        self.skizzen = {}               # id -> {"id","name","sichtbar","ebene","ketten","schnitt",...} (JSON)
        self.naechste_skizze = 1
        self.referenzen = {}            # id -> {"id","name","sichtbar","art","punkt","normale"|"richtung"}
        self.auswahlen = {}             # id -> {"id","name","scan","anzahl","maske"(b64)} gespeicherte Auswahl
        self.naechste_auswahl = 1
        self.naechste_referenz = 1

    # --- Verwaltung ---------------------------------------------------------
    def hinzufuegen(self, scan, merken=True):
        if merken:
            self._merke("Scan „%s“ hinzugefügt" % scan.name, [], neu=True)
        scan.id = self.naechste_id
        self.naechste_id += 1
        scan.farbe = FARBEN[(scan.id - 1) % len(FARBEN)]
        self.scans[scan.id] = scan
        if merken:
            self.undo[-1][1][scan.id] = None
        return scan

    def scan(self, sid):
        try:
            return self.scans[int(sid)]
        except (KeyError, ValueError, TypeError):
            raise KeyError("Scan %s gibt es nicht (mehr)." % sid)

    def entfernen(self, sid):
        s = self.scan(sid)
        self._merke("Scan „%s“ entfernt" % s.name, [s.id])
        del self.scans[s.id]

    def zustand(self):
        return {
            "scans": [{
                "id": s.id, "name": s.name, "anzahl": len(s), "rev": s.rev,
                "farbe": s.farbe, "sichtbar": s.sichtbar, "fest": s.fest,
                "hat_farbe": s.rgb is not None, "hat_normalen": s.nrm is not None,
                "dreiecke": 0 if s.tri is None else len(s.tri),
            } for s in self.scans.values()],
            "koerper": [dict(k.zustand(), nutzt=self.abhaengigkeiten(k)) for k in self.koerper.values()],
            "skizzen": [skizze_zustand(z) for z in self.skizzen.values()],
            "referenzen": list(self.referenzen.values()),
            "auswahlen": [{k: v for k, v in a.items() if k != "maske"} for a in self.auswahlen.values()],
            "undo": self.undo[-1][0] if self.undo else None,
            "redo": self.redo[-1][0] if self.redo else None,
        }

    # --- Rueckgaengig ---------------------------------------------------------
    def _merke(self, text, ids, neu=False):
        self.aenderungen += 1
        eintrag = {}
        for sid in ids:
            s = self.scans.get(sid)
            eintrag[sid] = s.kopie() if s is not None else None
        self.undo.append((text, eintrag))
        self.redo.clear()
        self._kuerzen()

    def abhaengigkeiten(self, k):
        """Parent-Child: welche Skizzen, Referenzen und Koerper der Verlauf von k benutzt."""
        aus = []

        def dazu(art, nr):
            try:
                nr = int(nr)
            except (TypeError, ValueError):
                return
            quelle = {"skizze": self.skizzen, "referenz": self.referenzen}.get(art)
            if quelle is not None:
                if nr in quelle:
                    eintrag = "%s „%s“" % ("Skizze" if art == "skizze" else "Referenz", quelle[nr]["name"])
                    if eintrag not in aus:
                        aus.append(eintrag)
            elif nr in self.koerper and nr != k.id:
                eintrag = "Körper „%s“" % self.koerper[nr].name
                if eintrag not in aus:
                    aus.append(eintrag)
        for e in k.verlauf:
            for sch in ("skizze", "profil", "pfad"):
                if e.get(sch) is not None:
                    dazu("skizze", e[sch])
            for nr in e.get("skizzen") or []:
                dazu("skizze", nr)
            if e.get("referenz") is not None:
                dazu("referenz", e["referenz"])
            ebene = e.get("ebene")
            if isinstance(ebene, str) and ebene.startswith("ref:"):
                dazu("referenz", ebene[4:])
            for sch in ("flaeche", "von"):
                if e.get(sch) is not None:
                    dazu("koerper", e[sch])
            for nr in e.get("aus") or []:
                dazu("koerper", nr)
        return aus

    def _koerper_stand(self):
        return {"liste": [k.kopie() for k in self.koerper.values()],
                "naechste": self.naechster_koerper, "zaehler": self.grundkoerper_zaehler,
                "feature_zaehler": dict(self.zaehler),
                "skizzen": copy.deepcopy(self.skizzen), "naechste_skizze": self.naechste_skizze,
                "referenzen": copy.deepcopy(self.referenzen), "naechste_referenz": self.naechste_referenz}

    def _merke_koerper(self, text):
        self.aenderungen += 1
        self.undo.append((text, {"koerper": self._koerper_stand()}))
        self.redo.clear()
        self._kuerzen()

    def _kuerzen(self):
        def groesse(e):
            return sum(s.bytes() for s in e[1].values() if isinstance(s, Scan))
        while len(self.undo) > UNDO_SCHRITTE or \
                (len(self.undo) > 1 and sum(map(groesse, self.undo)) > UNDO_BYTES):
            self.undo.pop(0)

    def _tausche(self, von, nach):
        if not von:
            return None
        text, eintrag = von.pop()
        gegen = {}
        for sid, alt in eintrag.items():
            if sid == "koerper":
                gegen["koerper"] = self._koerper_stand()
                neu = {}
                for k in alt["liste"]:
                    jetzt = self.koerper.get(k.id)
                    k.rev = max(k.rev, jetzt.rev if jetzt else 0) + 1
                    neu[k.id] = k
                self.koerper = neu
                self.naechster_koerper = alt["naechste"]
                self.grundkoerper_zaehler = alt["zaehler"]
                self.zaehler = dict(alt.get("feature_zaehler", {}))
                self.skizzen = alt.get("skizzen", {})
                self.naechste_skizze = alt.get("naechste_skizze", 1)
                self.referenzen = alt.get("referenzen", {})
                self.naechste_referenz = alt.get("naechste_referenz", 1)
                continue
            aktuell = self.scans.get(sid)
            gegen[sid] = aktuell
            if alt is None:
                self.scans.pop(sid, None)
            else:
                alt.rev = max(alt.rev, aktuell.rev if aktuell else 0) + 1
                self.scans[sid] = alt
        # Reihenfolge der Scans stabil halten (nach Id)
        self.scans = dict(sorted(self.scans.items()))
        nach.append((text, gegen))
        return text

    def rueckgaengig(self):
        self.aenderungen += 1
        return self._tausche(self.undo, self.redo)

    def wiederholen(self):
        self.aenderungen += 1
        return self._tausche(self.redo, self.undo)

    # --- Aenderungen mit Rueckgaengig ------------------------------------------
    def loeschen(self, masken, text="Punkte gelöscht"):
        """masken: {id: bool-Array, True = loeschen}. Liefert Anzahl."""
        ids = [sid for sid, m in masken.items() if m.any()]
        if not ids:
            return 0
        self._merke(text, ids)
        n = 0
        for sid in ids:
            m = masken[sid]
            n += int(m.sum())
            self.scans[sid].behalte(~m)
        return n

    def abtrennen(self, masken):
        """Markierte Punkte in einen neuen Scan verschieben."""
        ids = [sid for sid, m in masken.items() if m.any()]
        if not ids:
            return None
        teile = []
        for sid in ids:
            s, m = self.scans[sid], masken[sid]
            teil = s.kopie()
            teil.behalte(m)
            teile.append(teil)
        neu = verbinden(teile, "Abgetrennt aus " + self.scans[ids[0]].name)
        self._merke("Auswahl abgetrennt", ids)
        for sid in ids:
            self.scans[sid].behalte(~masken[sid])
        neu.id = self.naechste_id
        self.naechste_id += 1
        neu.farbe = FARBEN[(neu.id - 1) % len(FARBEN)]
        self.scans[neu.id] = neu
        self.undo[-1][1][neu.id] = None
        return neu

    def ersetzen(self, sid, xyz=None, rgb=None, nrm=None, text="Geändert",
                 neuer_scan=None):
        s = self.scan(sid)
        self._merke(text, [s.id])
        if neuer_scan is not None:
            s.xyz, s.rgb, s.nrm, s.tri = \
                neuer_scan.xyz, neuer_scan.rgb, neuer_scan.nrm, neuer_scan.tri
        if xyz is not None:
            s.xyz = xyz
        if rgb is not None:
            s.rgb = rgb
        if nrm is not None:
            s.nrm = nrm
        s.geaendert()

    def transformieren(self, matrizen, text="Ausgerichtet"):
        ids = [int(k) for k in matrizen]
        for sid in ids:
            self.scan(sid)
        self._merke(text, ids)
        for sid in ids:
            T = np.asarray(matrizen[sid] if sid in matrizen else matrizen[str(sid)])
            if not np.allclose(T, np.eye(4)):
                self.scans[sid].transformiere(T)

    def zusammenfuehren(self, ids, voxel=0.0, originale_ausblenden=True):
        from .werkzeuge import ausduennen
        teile = [self.scan(i) for i in ids]
        if len(teile) < 2:
            raise ValueError("Bitte mindestens 2 Scans wählen.")
        neu = verbinden(teile, "Zusammengeführt (%d Scans)" % len(teile))
        if voxel > 0:
            neu = ausduennen(neu, voxel)
            neu.name = "Zusammengeführt (%d Scans)" % len(teile)
        self._merke("Scans zusammengeführt", [s.id for s in teile])
        self.hinzufuegen(neu, merken=False)
        self.undo[-1][1][neu.id] = None
        if originale_ausblenden:
            for s in teile:
                s.sichtbar = False
        return neu

    # --- Volumenkoerper (mit Rueckgaengig) ------------------------------------------
    def koerper_holen(self, kid):
        try:
            return self.koerper[int(kid)]
        except (KeyError, ValueError, TypeError):
            raise KeyError("Körper %s gibt es nicht (mehr)." % kid)

    def standard_ziel(self):
        """Ziel fuer vereinen/abziehen ohne Angabe: letzter sichtbarer Koerper."""
        sichtbar = [k for k in self.koerper.values() if k.sichtbar]
        liste = sichtbar or list(self.koerper.values())
        return liste[-1] if liste else None

    def grundkoerper(self, shape, art_name, operation, ziel=None, quelle=None, parameter=None):
        """Werkzeugkoerper als neuen Koerper anlegen oder mit ziel (Koerper)
        vereinen/von ihm abziehen. Liefert den geaenderten/neuen Koerper."""
        from .koerper import Koerper, boolean, OP_ZUSATZ
        nr = self.grundkoerper_zaehler + 1
        eintrag = {"typ": "grundkoerper", "quelle": quelle, "parameter": parameter,
                   "operation": operation}
        if operation == "neu":
            name = "Grundkörper%d (%s)" % (nr, art_name)
            self._merke_koerper("%s erzeugt" % name)
            k = Koerper(self.naechster_koerper, name, shape, [dict(eintrag, name=name)])
            self.naechster_koerper += 1
            self.koerper[k.id] = k
        else:
            if ziel is None:
                raise ValueError("Kein Zielkörper für „%s“." % operation)
            neu_shape = boolean(ziel.shape, shape, operation)
            name = "Grundkörper%d (%s, %s)" % (nr, art_name, OP_ZUSATZ[operation])
            self._merke_koerper("%s → %s" % (name, ziel.name))
            k = self.koerper[ziel.id]
            k.shape = neu_shape
            k.verlauf = k.verlauf + [dict(eintrag, name=name)]
            k.rev += 1
            k.basis_pruefen()
        self.grundkoerper_zaehler = nr
        return k

    def feature(self, shape, typ_name, operation, ziel=None, eintrag=None):
        """Feature-Koerper (Extrusion, Drehung …) neu anlegen oder mit ziel vereinen/abziehen."""
        from .koerper import Koerper, boolean, OP_ZUSATZ
        nr = self.zaehler.get(typ_name, 0) + 1
        eintrag = dict(eintrag or {}, operation=operation)
        if operation == "neu":
            name = "%s%d" % (typ_name, nr)
            self._merke_koerper("%s erzeugt" % name)
            k = Koerper(self.naechster_koerper, name, shape, [dict(eintrag, name=name)])
            self.naechster_koerper += 1
            self.koerper[k.id] = k
        else:
            if ziel is None:
                raise ValueError("Kein Zielkörper für „%s“." % operation)
            neu_shape = boolean(ziel.shape, shape, operation)
            name = "%s%d (%s)" % (typ_name, nr, OP_ZUSATZ[operation])
            self._merke_koerper("%s → %s" % (name, ziel.name))
            k = self.koerper[ziel.id]
            k.shape = neu_shape
            k.verlauf = k.verlauf + [dict(eintrag, name=name)]
            k.rev += 1
            k.basis_pruefen()
        self.zaehler[typ_name] = nr
        return k

    def koerper_aendern(self, kid, shape, typ_name, eintrag=None):
        """Koerper durch geaenderte Form ersetzen (Rundung/Fase) – ein Verlaufsschritt."""
        k = self.koerper_holen(kid)
        nr = self.zaehler.get(typ_name, 0) + 1
        name = "%s%d" % (typ_name, nr)
        self._merke_koerper("%s an „%s“" % (name, k.name))
        k = self.koerper[k.id]
        k.shape = shape
        k.verlauf = k.verlauf + [dict(eintrag or {}, name=name)]
        k.rev += 1
        k.basis_pruefen()
        self.zaehler[typ_name] = nr
        return k

    def koerper_kombinieren(self, kid, kid2, shape, art_text):
        """Koerper kid bekommt das Ergebnis, kid2 faellt weg - ein Verlaufsschritt."""
        a, b = self.koerper_holen(kid), self.koerper_holen(kid2)
        if a.id == b.id:
            raise ValueError("Bitte zwei verschiedene Körper wählen.")
        nr = self.zaehler.get("Kombination", 0) + 1
        name = "Kombination%d (%s %s)" % (nr, art_text, b.name)
        self._merke_koerper("%s → %s" % (name, a.name))
        k = self.koerper[a.id]
        k.shape = shape
        k.verlauf = k.verlauf + [{"name": name, "typ": "kombination", "mit": b.id}]
        k.rev += 1
        k.basis_pruefen()
        del self.koerper[b.id]
        self.zaehler["Kombination"] = nr
        return k

    def koerper_aufteilen(self, kid, shapes):
        """Koerper durch mehrere Teile ersetzen (Separate bodies) - ein Verlaufsschritt."""
        from .koerper import Koerper
        k = self.koerper_holen(kid)
        if len(shapes) < 2:
            raise ValueError("„%s“ besteht nur aus einem Teil." % k.name)
        self._merke_koerper("„%s“ in %d Teile getrennt" % (k.name, len(shapes)))
        del self.koerper[k.id]
        neu = []
        for i, s in enumerate(shapes):
            t = Koerper(self.naechster_koerper, "%s.%d" % (k.name, i + 1), s,
                        k.verlauf + [{"name": "Getrennt %d/%d" % (i + 1, len(shapes)), "typ": "trennen"}])
            self.naechster_koerper += 1
            self.koerper[t.id] = t
            neu.append(t)
        return neu

    def koerper_ersetzen_mehrere(self, kids, shape, typ_name, eintrag=None):
        """Mehrere Koerper (Flaechen) durch einen neuen ersetzen (Koerper aus Flaechen, Naehen)."""
        from .koerper import Koerper
        alte = [self.koerper_holen(k) for k in kids]
        nr = self.zaehler.get(typ_name, 0) + 1
        name = "%s%d" % (typ_name, nr)
        self._merke_koerper("%s aus %s" % (name, ", ".join(k.name for k in alte)))
        for k in alte:
            del self.koerper[k.id]
        k = Koerper(self.naechster_koerper, name, shape, [dict(eintrag or {}, name=name)])
        self.naechster_koerper += 1
        self.koerper[k.id] = k
        self.zaehler[typ_name] = nr
        return k

    # --- Skizzen ---------------------------------------------------------------
    def skizze_holen(self, sid):
        try:
            return self.skizzen[int(sid)]
        except (KeyError, ValueError, TypeError):
            raise KeyError("Skizze %s gibt es nicht (mehr)." % sid)

    def skizze_hinzufuegen(self, daten):
        typ = "3D-Skizze" if daten.get("art") == "3d" else "Skizze"
        nr = self.zaehler.get(typ, 0) + 1
        name = "%s%d" % (typ, nr)
        self._merke_koerper("%s erzeugt" % name)
        z = dict(daten, id=self.naechste_skizze, name=name, sichtbar=True, rev=1)
        self.skizzen[z["id"]] = z
        self.naechste_skizze += 1
        self.zaehler[typ] = nr
        return z

    def skizzen_hinzufuegen(self, liste, text):
        """Mehrere Skizzen in EINEM Verlaufsschritt (Mehrfachschnitt)."""
        self._merke_koerper(text)
        neu = []
        for daten in liste:
            nr = self.zaehler.get("Skizze", 0) + 1
            z = dict(daten, id=self.naechste_skizze, name="Skizze%d" % nr, sichtbar=True, rev=1)
            self.skizzen[z["id"]] = z
            self.naechste_skizze += 1
            self.zaehler["Skizze"] = nr
            neu.append(z)
        return neu

    def skizze_ersetzen(self, sid, daten, text="geändert"):
        z = self.skizze_holen(sid)
        self._merke_koerper("%s %s" % (z["name"], text))
        neu = dict(z, **daten)
        neu["rev"] = z.get("rev", 1) + 1
        self.skizzen[z["id"]] = neu
        return neu

    def skizze_setzen(self, sid, sichtbar=None, name=None):
        z = self.skizze_holen(sid)
        if sichtbar is None and not name:
            return z
        text = "umbenannt" if name else ("eingeblendet" if sichtbar else "ausgeblendet")
        self._merke_koerper("Skizze „%s“ %s" % (z["name"], text))
        z = dict(self.skizzen[z["id"]])
        if sichtbar is not None:
            z["sichtbar"] = bool(sichtbar)
        if name:
            z["name"] = str(name)[:120]
        z["rev"] = z.get("rev", 1) + 1
        self.skizzen[z["id"]] = z
        return z

    def skizze_entfernen(self, sid):
        z = self.skizze_holen(sid)
        self._merke_koerper("Skizze „%s“ entfernt" % z["name"])
        del self.skizzen[z["id"]]

    # --- Referenzen ------------------------------------------------------------
    def referenz_holen(self, rid):
        try:
            return self.referenzen[int(rid)]
        except (KeyError, ValueError, TypeError):
            raise KeyError("Referenz %s gibt es nicht (mehr)." % rid)

    def referenz_hinzufuegen(self, daten, typ_name):
        nr = self.zaehler.get(typ_name, 0) + 1
        name = "%s%d" % (typ_name, nr)
        self._merke_koerper("%s erzeugt" % name)
        r = dict(daten, id=self.naechste_referenz, name=name, sichtbar=True)
        self.referenzen[r["id"]] = r
        self.naechste_referenz += 1
        self.zaehler[typ_name] = nr
        return r

    def referenz_setzen(self, rid, sichtbar=None, name=None):
        r = self.referenz_holen(rid)
        self._merke_koerper("Referenz „%s“ geändert" % r["name"])
        r = dict(r)
        if sichtbar is not None:
            r["sichtbar"] = bool(sichtbar)
        if name:
            r["name"] = str(name)[:120]
        self.referenzen[r["id"]] = r
        return r

    def referenz_aendern(self, rid, werte):
        """Lage einer Referenz aendern (Griff im Modell): punkt / normale / richtung."""
        r = self.referenz_holen(rid)
        self._merke_koerper("Referenz „%s“ verschoben" % r["name"])
        r = dict(r)
        for k in ("punkt", "normale", "richtung"):
            if werte.get(k) is not None and k in r:
                v = [float(x) for x in werte[k]]
                if k != "punkt":
                    n = sum(x * x for x in v) ** 0.5
                    if n < 1e-12:
                        raise ValueError("Richtung darf nicht 0 sein.")
                    v = [x / n for x in v]
                r[k] = [round(x, 6) for x in v]
        r["quelle"] = r.get("quelle", "") + "+griff" if "griff" not in str(r.get("quelle", "")) else r.get("quelle")
        self.referenzen[r["id"]] = r
        return r

    def referenz_entfernen(self, rid):
        r = self.referenz_holen(rid)
        self._merke_koerper("Referenz „%s“ entfernt" % r["name"])
        del self.referenzen[r["id"]]

    def koerper_neu_rechnen(self, kid, text="neu aufgebaut"):
        """Verlauf eines Koerpers neu rechnen (Rebuild) - ein Rueckgaengig-Schritt."""
        from .verlauf import nachrechnen
        k = self.koerper_holen(kid)
        shape, n = nachrechnen(self, k)
        self._merke_koerper("„%s“ %s" % (k.name, text))
        k = self.koerper[k.id]
        k.shape = shape
        k.rev += 1
        return k, n

    def verlauf_schalten(self, kid, index, aus):
        """Schritt index und alle folgenden aus- (aus=True, "Disable All Next") bzw. alle bis index
        einschalten (aus=False, "Enable to Here"), dann neu rechnen."""
        from .verlauf import nachrechnen
        k = self.koerper_holen(kid)
        if not 0 <= int(index) < len(k.verlauf):
            raise ValueError("Schritt %s gibt es nicht." % index)
        if k.basis and int(index) <= k.basis[0]:
            raise ValueError("Dieser Schritt liegt vor einem festen Zwischenstand und lässt sich nicht ausschalten.")
        neu = []
        for i, e in enumerate(k.verlauf):
            e = dict(e)
            if aus and i >= int(index):
                e["aus"] = True
            elif not aus:
                e["aus"] = i > int(index)
            neu.append(e)
        alt = k.verlauf
        k.verlauf = neu
        try:
            shape, _ = nachrechnen(self, k)
        finally:
            k.verlauf = alt
        self._merke_koerper("„%s“: Verlauf %s Schritt %d" % (k.name, "aus ab" if aus else "an bis", int(index) + 1))
        k = self.koerper[k.id]
        k.verlauf = neu
        k.shape = shape
        k.rev += 1
        return k

    def koerper_hinzufuegen(self, shape, name, verlauf=None):
        """Fertigen Koerper uebernehmen (z. B. Import, Tests)."""
        from .koerper import Koerper
        self._merke_koerper("Körper „%s“ hinzugefügt" % name)
        k = Koerper(self.naechster_koerper, name, shape, verlauf or [{"name": name, "typ": "import"}])
        self.naechster_koerper += 1
        self.koerper[k.id] = k
        return k

    def koerper_setzen(self, kid, sichtbar=None, name=None):
        k = self.koerper_holen(kid)
        if sichtbar is None and not name:
            return k
        text = "Körper „%s“ %s" % (k.name, "umbenannt" if name else
                                    ("eingeblendet" if sichtbar else "ausgeblendet"))
        self._merke_koerper(text)
        k = self.koerper[k.id]
        if sichtbar is not None:
            k.sichtbar = bool(sichtbar)
        if name:
            k.name = str(name)[:120]
        return k

    def koerper_entfernen(self, kid):
        k = self.koerper_holen(kid)
        self._merke_koerper("Körper „%s“ entfernt" % k.name)
        del self.koerper[k.id]

    # --- Speichern / Laden -----------------------------------------------------
    def speichern(self):
        puffer = io.BytesIO()
        with zipfile.ZipFile(puffer, "w", zipfile.ZIP_STORED) as z:
            info = {"format": "v3dscan", "version": 1, "scans": []}
            for s in self.scans.values():
                eintrag = {"id": s.id, "name": s.name, "farbe": s.farbe,
                           "sichtbar": s.sichtbar, "fest": s.fest}
                info["scans"].append(eintrag)
                for teil in ("xyz", "rgb", "nrm", "tri"):
                    arr = getattr(s, teil)
                    if arr is not None:
                        b = io.BytesIO()
                        np.save(b, arr)
                        z.writestr("scan_%d_%s.npy" % (s.id, teil), b.getvalue())
                erk = self.erkennung.get(s.id)
                if erk and erk["rev"] == s.rev:
                    b = io.BytesIO()
                    np.save(b, erk["labels"])
                    z.writestr("scan_%d_labels.npy" % s.id, b.getvalue())
                    eintrag["erkennung"] = {k: v for k, v in erk.items() if k not in ("labels", "rev")}
            if self.koerper:
                from .koerper import brep_text
                info["koerper"] = []
                for k in self.koerper.values():
                    info["koerper"].append({"id": k.id, "name": k.name, "sichtbar": k.sichtbar,
                                            "verlauf": k.verlauf,
                                            "basis": k.basis[0] if k.basis else None})
                    z.writestr("koerper_%d.brep" % k.id, brep_text(k.shape))
                    if k.basis and k.basis[1] is not k.shape:
                        z.writestr("koerper_%d_basis.brep" % k.id, brep_text(k.basis[1]))
                info["naechster_koerper"] = self.naechster_koerper
                info["grundkoerper_zaehler"] = self.grundkoerper_zaehler
            if self.skizzen:
                info["skizzen"] = list(self.skizzen.values())
                info["naechste_skizze"] = self.naechste_skizze
            if self.auswahlen:
                info["auswahlen"] = list(self.auswahlen.values())
            if self.referenzen:
                info["referenzen"] = list(self.referenzen.values())
                info["naechste_referenz"] = self.naechste_referenz
            info["zaehler"] = self.zaehler
            z.writestr("projekt.json", json.dumps(info, ensure_ascii=False, indent=1))
        return puffer.getvalue()

    @staticmethod
    def laden(daten):
        p = Projekt()
        with zipfile.ZipFile(io.BytesIO(daten)) as z:
            info = json.loads(z.read("projekt.json").decode("utf-8"))
            if info.get("format") != "v3dscan":
                raise ValueError("Keine V3D-Scan-Projektdatei.")
            namen = set(z.namelist())
            for e in info["scans"]:
                def teil(t):
                    n = "scan_%d_%s.npy" % (e["id"], t)
                    return np.load(io.BytesIO(z.read(n))) if n in namen else None
                s = Scan(e["name"], teil("xyz"), teil("rgb"), teil("nrm"), teil("tri"))
                s.id, s.farbe = e["id"], e.get("farbe", FARBEN[0])
                s.sichtbar, s.fest = e.get("sichtbar", True), e.get("fest", False)
                p.scans[s.id] = s
                if e.get("erkennung") and "scan_%d_labels.npy" % e["id"] in namen:
                    p.erkennung[s.id] = dict(e["erkennung"], rev=s.rev,
                                             labels=np.load(io.BytesIO(z.read("scan_%d_labels.npy" % e["id"]))))
                p.naechste_id = max(p.naechste_id, s.id + 1)
            if info.get("koerper"):
                from .koerper import Koerper, aus_brep
                for e in info["koerper"]:
                    k = Koerper(int(e["id"]), e["name"], aus_brep(z.read("koerper_%d.brep" % e["id"])),
                                e.get("verlauf") or [], e.get("sichtbar", True))
                    if e.get("basis") is not None:
                        bn = "koerper_%d_basis.brep" % e["id"]
                        k.basis = (int(e["basis"]), aus_brep(z.read(bn)) if bn in namen else k.shape)
                    else:
                        k.basis = None
                    p.koerper[k.id] = k
                p.naechster_koerper = max([info.get("naechster_koerper", 1)] + [k + 1 for k in p.koerper])
                p.grundkoerper_zaehler = int(info.get("grundkoerper_zaehler", 0))
            for z in info.get("skizzen") or []:
                p.skizzen[int(z["id"])] = z
            p.naechste_skizze = max([info.get("naechste_skizze", 1)] + [k + 1 for k in p.skizzen])
            p.zaehler = dict(info.get("zaehler") or {})
            for a in info.get("auswahlen") or []:
                p.auswahlen[int(a["id"])] = a
            p.naechste_auswahl = max([1] + [k + 1 for k in p.auswahlen])
            for r in info.get("referenzen") or []:
                p.referenzen[int(r["id"])] = r
            p.naechste_referenz = max([info.get("naechste_referenz", 1)] + [k + 1 for k in p.referenzen])
        return p


def skizze_zustand(z):
    """Kurzfassung fuer die Oberflaeche (ohne Schnittpunkte)."""
    if z.get("art") == "3d":
        return {"id": z["id"], "name": z["name"], "sichtbar": z.get("sichtbar", True), "rev": z.get("rev", 1),
                "art": "3d", "ketten": 1, "geschlossen": int(bool(z.get("geschlossen"))),
                "elemente": len(z.get("punkte3d", []))}
    return {"id": z["id"], "name": z["name"], "sichtbar": z.get("sichtbar", True), "rev": z.get("rev", 1),
            "ketten": len(z.get("ketten", [])),
            "geschlossen": sum(1 for k in z.get("ketten", []) if k.get("geschlossen")),
            "elemente": sum(len(k.get("elemente", [])) for k in z.get("ketten", []))}


def verbinden(teile, name):
    """Scans aneinanderhaengen. Farbe/Normalen/Dreiecke nur, wenn ALLE Teile
    sie haben (Netz + Punktwolke ergibt eine Punktwolke)."""
    xyz = np.concatenate([t.xyz for t in teile])
    tri = None
    if all(t.tri is not None for t in teile):
        versatz = np.cumsum([0] + [len(t) for t in teile[:-1]])
        tri = np.concatenate([t.tri + v for t, v in zip(teile, versatz)])
    rgb = np.concatenate([t.rgb for t in teile]) \
        if all(t.rgb is not None for t in teile) else None
    nrm = np.concatenate([t.nrm for t in teile]) \
        if all(t.nrm is not None for t in teile) else None
    return Scan(name, xyz, rgb, nrm, tri)
