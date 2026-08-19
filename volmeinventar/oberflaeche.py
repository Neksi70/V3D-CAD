#!/usr/bin/env python3
# Fenster fuer VolmeInventar.  Tkinter, weil es in jedem Python steckt und
# die fertige EXE damit klein bleibt.
#
# Die Aufnahme laeuft in einem eigenen Faden: das Durchsuchen des Startmenues
# dauert auf traegen Kurs-PCs mehrere Sekunden, und ein Fenster, das solange
# "Keine Rueckmeldung" anzeigt, sieht nach Absturz aus.

import os
import platform
import queue
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

BASIS = os.path.dirname(os.path.abspath(__file__))
if BASIS not in sys.path:
    sys.path.insert(0, BASIS)

import bericht      # noqa: E402
import inventar     # noqa: E402

PROGRAMM_SPALTEN = [
    ("name", "Programm", 260),
    ("fassung", "Fassung", 100),
    ("hersteller", "Hersteller", 170),
    ("installiert_am", "Installiert", 90),
    ("groesse", "Groesse", 80),
    ("quelle", "Fuer", 110),
    ("bitheit", "Art", 80),
    ("ordner", "Ordner", 300),
]

VERWEIS_SPALTEN = [
    ("anzeigename", "Verknuepfung", 220),
    ("bereich", "Ort", 180),
    ("gruppe", "Gruppe", 140),
    ("ziel", "Ziel", 340),
    ("argumente", "Argumente", 160),
    ("zustand", "Zustand", 90),
]


class Liste(ttk.Frame):
    """Eine Tabelle mit Suchfeld darueber."""

    def __init__(self, eltern, spalten, beim_oeffnen=None):
        super().__init__(eltern)
        self.spalten = spalten
        self.zeilen = []
        self.beim_oeffnen = beim_oeffnen

        kopf = ttk.Frame(self)
        kopf.pack(fill="x", padx=8, pady=(8, 4))
        ttk.Label(kopf, text="Suchen:").pack(side="left")
        self.suchtext = tk.StringVar()
        self.suchtext.trace_add("write", lambda *a: self.filtern())
        ttk.Entry(kopf, textvariable=self.suchtext).pack(
            side="left", fill="x", expand=True, padx=8)
        self.zaehler = ttk.Label(kopf, text="0 Eintraege")
        self.zaehler.pack(side="left")

        rahmen = ttk.Frame(self)
        rahmen.pack(fill="both", expand=True, padx=8, pady=(0, 8))
        self.baum = ttk.Treeview(
            rahmen, columns=[s[0] for s in spalten], show="headings",
            selectmode="extended")
        for feld, titel, breite in spalten:
            self.baum.heading(feld, text=titel,
                              command=lambda f=feld: self.sortieren(f))
            self.baum.column(feld, width=breite, stretch=(feld in
                                                          ("name", "ziel",
                                                           "ordner")))
        senkrecht = ttk.Scrollbar(rahmen, orient="vertical",
                                  command=self.baum.yview)
        waagerecht = ttk.Scrollbar(rahmen, orient="horizontal",
                                   command=self.baum.xview)
        self.baum.configure(yscrollcommand=senkrecht.set,
                            xscrollcommand=waagerecht.set)
        self.baum.grid(row=0, column=0, sticky="nsew")
        senkrecht.grid(row=0, column=1, sticky="ns")
        waagerecht.grid(row=1, column=0, sticky="ew")
        rahmen.rowconfigure(0, weight=1)
        rahmen.columnconfigure(0, weight=1)

        # Zeilen mit Befund faerben, damit sie im Ueberfliegen auffallen.
        self.baum.tag_configure("warnung", foreground="#b3261e")
        self.baum.tag_configure("leise", foreground="#6b7280")
        self.baum.bind("<Double-1>", self._doppelklick)
        self.baum.bind("<Control-c>", self._kopieren)

        self._sortiert_nach = None
        self._absteigend = False

    def fuellen(self, zeilen):
        self.zeilen = zeilen
        self.filtern()

    def filtern(self):
        text = self.suchtext.get().lower().strip()
        self.baum.delete(*self.baum.get_children())
        gezeigt = 0
        for zeile in self.zeilen:
            werte = [bericht._text(zeile.get(f)) for f, _, _ in self.spalten]
            if text and text not in " ".join(werte).lower():
                continue
            marke = ()
            if zeile.get("fehler") or zeile.get("ziel_fehlt"):
                marke = ("warnung",)
            elif zeile.get("art") == "Store-App":
                marke = ("leise",)
            self.baum.insert("", "end", values=werte, tags=marke)
            gezeigt += 1
        gesamt = len(self.zeilen)
        self.zaehler.config(
            text=f"{gezeigt} Eintraege" if gezeigt == gesamt
            else f"{gezeigt} von {gesamt}")

    def sortieren(self, feld):
        self._absteigend = not self._absteigend \
            if self._sortiert_nach == feld else False
        self._sortiert_nach = feld

        def fehlt(zeile):
            return zeile.get(feld) in (None, "")

        def wert(zeile):
            """Muss fuer die GANZE Spalte denselben Typ liefern - sonst
            vergleicht Python beim Sortieren Text mit Zahl und bricht ab.
            Die Groessenspalte ist genau so eine Falle: vorhandene Zeilen
            haetten eine Zahl, leere eine Zeichenkette."""
            if feld == "groesse":
                return zeile.get("groesse_kb") or 0
            roh = zeile.get(feld)
            if hasattr(roh, "isoformat"):
                return roh.isoformat()
            return "" if roh is None else str(roh).lower()

        # Zwei Durchgaenge, damit die Leerwerte trotz umgekehrter Richtung
        # unten bleiben: erst der Wert, dann die Vorhanden-Kennung (stabil).
        self.zeilen.sort(key=wert, reverse=self._absteigend)
        self.zeilen.sort(key=fehlt)
        self.filtern()

    def _auswahl(self):
        gewaehlt = []
        for kennung in self.baum.selection():
            werte = self.baum.item(kennung, "values")
            gewaehlt.append("\t".join(werte))
        return gewaehlt

    def _kopieren(self, ereignis=None):
        zeilen = self._auswahl()
        if not zeilen:
            return
        self.clipboard_clear()
        self.clipboard_append("\n".join(zeilen))

    def _doppelklick(self, ereignis):
        if not self.beim_oeffnen:
            return
        kennung = self.baum.focus()
        if not kennung:
            return
        werte = dict(zip([f for f, _, _ in self.spalten],
                         self.baum.item(kennung, "values")))
        self.beim_oeffnen(werte)


class Fenster(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("VolmeInventar - Bestandsaufnahme")
        self.geometry("1180x680")
        self.minsize(820, 480)
        self.bestand = None
        self.meldungen = queue.Queue()

        try:
            ttk.Style().theme_use("vista" if platform.system() == "Windows"
                                  else "clam")
        except tk.TclError:
            pass

        leiste = ttk.Frame(self)
        leiste.pack(fill="x", padx=10, pady=8)
        self.knopf_aufnehmen = ttk.Button(leiste, text="Aufnehmen",
                                          command=self.aufnehmen)
        self.knopf_aufnehmen.pack(side="left")
        self.mit_store = tk.BooleanVar(value=True)
        ttk.Checkbutton(leiste, text="Store-Apps einbeziehen",
                        variable=self.mit_store).pack(side="left", padx=12)
        ttk.Separator(leiste, orient="vertical").pack(side="left", fill="y",
                                                      padx=8)
        self.speicherknoepfe = []
        for text, form in (("Bericht (HTML)", "html"), ("Tabelle (CSV)", "csv"),
                           ("Daten (JSON)", "json")):
            k = ttk.Button(leiste, text=text, state="disabled",
                           command=lambda f=form: self.speichern(f))
            k.pack(side="left", padx=(0, 6))
            self.speicherknoepfe.append(k)

        self.reiter = ttk.Notebook(self)
        self.reiter.pack(fill="both", expand=True, padx=10)
        self.programme = Liste(self.reiter, PROGRAMM_SPALTEN,
                               beim_oeffnen=self._ordner_oeffnen)
        self.verweise = Liste(self.reiter, VERWEIS_SPALTEN,
                              beim_oeffnen=self._ziel_zeigen)
        self.reiter.add(self.programme, text="Programme")
        self.reiter.add(self.verweise, text="Verknuepfungen")

        self.zustand = tk.StringVar(
            value="Bereit.  'Aufnehmen' liest Programme und Verknuepfungen.")
        ttk.Label(self, textvariable=self.zustand, anchor="w",
                  relief="sunken").pack(fill="x", side="bottom")
        self.after(120, self._meldungen_holen)

    # --------------------------------------------------------------- Ablauf
    def aufnehmen(self):
        self.knopf_aufnehmen.config(state="disabled")
        for k in self.speicherknoepfe:
            k.config(state="disabled")
        self.zustand.set("Aufnahme laeuft ...")
        faden = threading.Thread(target=self._arbeiten, daemon=True)
        faden.start()

    def _arbeiten(self):
        try:
            bestand = inventar.aufnehmen(
                mit_store=self.mit_store.get(),
                melden=lambda t: self.meldungen.put(("hinweis", t)))
            self.meldungen.put(("fertig", bestand))
        except Exception as e:                         # noqa: BLE001
            self.meldungen.put(("fehler", e))

    def _meldungen_holen(self):
        """Tkinter vertraegt keine Zugriffe aus fremden Faeden - der
        Arbeitsfaden schiebt deshalb nur in die Schlange, angezeigt wird hier."""
        try:
            while True:
                art, inhalt = self.meldungen.get_nowait()
                if art == "hinweis":
                    self.zustand.set(inhalt)
                elif art == "fertig":
                    self._anzeigen(inhalt)
                elif art == "fehler":
                    self.knopf_aufnehmen.config(state="normal")
                    self.zustand.set("Abgebrochen.")
                    messagebox.showerror(
                        "VolmeInventar",
                        f"Die Aufnahme ist fehlgeschlagen:\n\n{inhalt}")
        except queue.Empty:
            pass
        self.after(120, self._meldungen_holen)

    def _anzeigen(self, bestand):
        self.bestand = bestand
        self.programme.fuellen([bericht._programm_zeile(p)
                                for p in bestand["programme"]])
        self.verweise.fuellen([bericht._verweis_zeile(v)
                               for v in bestand["verknuepfungen"]])
        z = bestand["kennzahlen"]
        self.reiter.tab(0, text=f"Programme ({z['programme']})")
        self.reiter.tab(1, text=f"Verknuepfungen ({z['verknuepfungen']})")
        self.knopf_aufnehmen.config(state="normal")
        for k in self.speicherknoepfe:
            k.config(state="normal")
        teile = [f"{z['programme']} Programme",
                 f"{z['verknuepfungen']} Verknuepfungen",
                 f"{z['autostart']} im Autostart"]
        if z["ziel_fehlt"]:
            teile.append(f"{z['ziel_fehlt']} mit fehlendem Ziel")
        if z["unlesbar"]:
            teile.append(f"{z['unlesbar']} unlesbar")
        self.zustand.set("Fertig: " + ", ".join(teile) + ".")

    # -------------------------------------------------------------- Ausgabe
    def speichern(self, form):
        if not self.bestand:
            return
        endungen = {"html": [("HTML-Bericht", "*.html")],
                    "csv": [("CSV-Tabelle", "*.csv")],
                    "json": [("JSON-Daten", "*.json")]}
        ziel = filedialog.asksaveasfilename(
            title="Bericht speichern", defaultextension="." + form,
            initialfile=bericht.name_vorschlagen(self.bestand, form),
            filetypes=endungen[form] + [("Alle Dateien", "*.*")])
        if not ziel:
            return
        try:
            geschrieben = bericht.schreiben(self.bestand, ziel, form)
        except OSError as e:
            messagebox.showerror("VolmeInventar",
                                 f"Konnte nicht speichern:\n\n{e}")
            return
        self.zustand.set("Gespeichert: " + ", ".join(
            os.path.basename(d) for d in geschrieben))
        if form == "html":
            inventar._oeffnen(geschrieben[0])

    def _ordner_oeffnen(self, zeile):
        ordner = zeile.get("ordner")
        if ordner and os.path.isdir(ordner):
            inventar._oeffnen(ordner)
        else:
            messagebox.showinfo("VolmeInventar",
                                "Fuer diesen Eintrag ist kein Ordner "
                                "hinterlegt.")

    def _ziel_zeigen(self, zeile):
        ziel = zeile.get("ziel")
        if not ziel:
            messagebox.showinfo("VolmeInventar", "Kein Ziel hinterlegt.")
            return
        ordner = os.path.dirname(os.path.expandvars(ziel))
        if os.path.isdir(ordner):
            inventar._oeffnen(ordner)
        else:
            messagebox.showinfo("VolmeInventar",
                                f"Ziel nicht erreichbar:\n\n{ziel}")


def starten():
    fenster = Fenster()
    # Gleich loslegen - wer das Programm oeffnet, will die Liste sehen.
    fenster.after(300, fenster.aufnehmen)
    fenster.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(starten())
