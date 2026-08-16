#!/usr/bin/env python3
# VolmeStick - Fenster fuer Windows. Aufbau wie Rufus: oben der Datentraeger,
# darunter die Quelle, dann die Formatierungsoptionen, unten der Startknopf.
#
# Braucht Administratorrechte (Datentraeger beschreiben). Die gebaute EXE
# fordert sie ueber das Manifest an - beim Start aus Python bitte die
# Eingabeaufforderung als Administrator oeffnen.

import os
import queue
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HIER)
sys.path.insert(0, os.path.dirname(HIER))     # Kern liegt eine Ebene hoeher
if hasattr(sys, "_MEIPASS"):                  # in der gebauten EXE
    sys.path.insert(0, sys._MEIPASS)

import vstick        # noqa: E402
import unattend      # noqa: E402
import download      # noqa: E402

GIB = 1024 ** 3


class Anwendung(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("VolmeStick – Windows-Medien bauen")
        self.geometry("560x680")
        self.resizable(False, True)
        self.meldungen = queue.Queue()
        self.iso = None
        self.info = None
        self.wue = dict(unattend.STANDARD)
        self.wue["benutzer"] = ""
        self._bauen()
        self.geraete_laden()
        self.after(120, self._pumpe)

    # ---------------------------------------------------------- Aufbau
    def _bauen(self):
        pad = {"padx": 10, "pady": 4}
        rahmen = ttk.Frame(self)
        rahmen.pack(fill="both", expand=True)

        g = ttk.LabelFrame(rahmen, text="Laufwerkseigenschaften")
        g.pack(fill="x", **pad)
        ttk.Label(g, text="Datenträger").grid(row=0, column=0, sticky="w", padx=8, pady=4)
        self.geraet_feld = ttk.Combobox(g, state="readonly", width=44)
        self.geraet_feld.grid(row=0, column=1, padx=8, pady=4)
        ttk.Button(g, text="Neu suchen", command=self.geraete_laden)\
            .grid(row=0, column=2, padx=6)

        ttk.Label(g, text="Startmedium").grid(row=1, column=0, sticky="w", padx=8, pady=4)
        self.iso_feld = ttk.Entry(g, width=46)
        self.iso_feld.grid(row=1, column=1, padx=8, pady=4)
        ttk.Button(g, text="Auswählen", command=self.iso_waehlen)\
            .grid(row=1, column=2, padx=6)

        ttk.Label(g, text="Schreibmodus").grid(row=2, column=0, sticky="w", padx=8, pady=4)
        self.modus = ttk.Combobox(g, state="readonly", width=44, values=[
            "Automatisch (Windows erkennen)",
            "Windows-Installation (Dateien + autounattend.xml)",
            "Abbild 1:1 schreiben (Linux-ISOs)",
            "Nur formatieren"])
        self.modus.current(0)
        self.modus.grid(row=2, column=1, padx=8, pady=4)

        ttk.Label(g, text="Partitionsschema").grid(row=3, column=0, sticky="w", padx=8, pady=4)
        self.schema = ttk.Combobox(g, state="readonly", width=44,
                                   values=["GPT – UEFI", "MBR – UEFI + altes BIOS"])
        self.schema.current(0)
        self.schema.grid(row=3, column=1, padx=8, pady=4)

        f = ttk.LabelFrame(rahmen, text="Formatierungsoptionen")
        f.pack(fill="x", **pad)
        ttk.Label(f, text="Dateisystem").grid(row=0, column=0, sticky="w", padx=8, pady=4)
        self.dateisystem = ttk.Combobox(f, state="readonly", width=20,
                                        values=["Automatisch", "FAT32", "NTFS", "exFAT"])
        self.dateisystem.current(0)
        self.dateisystem.grid(row=0, column=1, sticky="w", padx=8, pady=4)
        ttk.Label(f, text="Bezeichnung").grid(row=0, column=2, sticky="e", padx=4)
        self.label_feld = ttk.Entry(f, width=16)
        self.label_feld.insert(0, "V3D_WIN")
        self.label_feld.grid(row=0, column=3, padx=8)
        self.schnell = tk.BooleanVar(value=True)
        ttk.Checkbutton(f, text="Schnellformatierung", variable=self.schnell)\
            .grid(row=1, column=1, sticky="w", padx=8, pady=2)

        w = ttk.Frame(rahmen)
        w.pack(fill="x", **pad)
        ttk.Button(w, text="Windows-Anpassungen …", command=self.wue_dialog)\
            .pack(side="left")
        ttk.Button(w, text="ISO bei Microsoft holen", command=self.ms_dialog)\
            .pack(side="left", padx=6)
        ttk.Button(w, text="Prüfsummen", command=self.pruefsummen)\
            .pack(side="left")

        self.info_feld = tk.Text(rahmen, height=6, wrap="word", state="disabled",
                                 background="#f4f6f9", relief="flat")
        self.info_feld.pack(fill="x", **pad)

        s = ttk.Frame(rahmen)
        s.pack(fill="x", **pad)
        self.start = ttk.Button(s, text="START", command=self.starten)
        self.start.pack(side="left")
        ttk.Button(s, text="Beenden", command=self.destroy).pack(side="right")

        self.balken = ttk.Progressbar(rahmen, maximum=100)
        self.balken.pack(fill="x", padx=10, pady=(8, 2))
        self.status = ttk.Label(rahmen, text="Bereit")
        self.status.pack(fill="x", padx=12)
        self.protokoll = tk.Text(rahmen, height=10, wrap="none", background="#111418",
                                 foreground="#cfd8e3", relief="flat")
        self.protokoll.pack(fill="both", expand=True, padx=10, pady=8)

    # ---------------------------------------------------------- Hilfen
    def _melden(self, prozent, text=""):
        self.meldungen.put((prozent, text))

    def _pumpe(self):
        while not self.meldungen.empty():
            prozent, text = self.meldungen.get()
            self.balken["value"] = prozent
            if text:
                self.status["text"] = f"{prozent}% – {text}"
                self.protokoll.insert("end", text + "\n")
                self.protokoll.see("end")
        self.after(120, self._pumpe)

    def _info(self, text):
        self.info_feld["state"] = "normal"
        self.info_feld.delete("1.0", "end")
        self.info_feld.insert("1.0", text)
        self.info_feld["state"] = "disabled"

    def _im_hintergrund(self, arbeit, fertig):
        def lauf():
            try:
                ergebnis = arbeit()
                self.after(0, lambda: fertig(ergebnis, None))
            except Exception as e:
                self.after(0, lambda e=e: fertig(None, e))
        self.start["state"] = "disabled"
        threading.Thread(target=lauf, daemon=True).start()

    # ---------------------------------------------------------- Aktionen
    def geraete_laden(self):
        try:
            self.geraete = vstick.geraete()
        except Exception as e:
            self.geraete = []
            self._info(f"Datenträger nicht lesbar: {e}")
        self.geraet_feld["values"] = [
            f"{g['pfad']}  {g['name']}  ({g['groesse'] / GIB:.1f} GB)" for g in self.geraete]
        if self.geraete:
            self.geraet_feld.current(0)

    def iso_waehlen(self):
        pfad = filedialog.askopenfilename(
            title="Windows-ISO wählen",
            filetypes=[("Abbilddateien", "*.iso *.img"), ("Alle Dateien", "*.*")])
        if not pfad:
            return
        self.iso_feld.delete(0, "end")
        self.iso_feld.insert(0, pfad)
        self.iso = pfad
        try:
            self.info = vstick.analysiere(pfad)
        except Exception as e:
            self.info = None
            return self._info(f"ISO nicht lesbar: {e}")
        i = self.info
        editionen = ", ".join(f"{e['index']}: {e['name']}" for e in i["editionen"]) or "–"
        self._info(
            f"{i['datei']}  ({i['groesse'] / GIB:.2f} GB)\n"
            f"Datenträgername: {i['volid']}\n"
            f"Windows-Installation: {'ja' if i['ist_windows'] else 'nein'} | "
            f"Start: {'UEFI' if i['uefi'] else ''}{' + BIOS' if i['bios'] else ''}\n"
            f"Editionen: {editionen}\n"
            + ("\n".join("⚠ " + w for w in i["warnungen"])))

    def wue_dialog(self):
        d = tk.Toplevel(self)
        d.title("Windows-Anpassungen")
        d.geometry("520x520")
        d.transient(self)
        d.grab_set()
        felder = {}
        haken = [
            ("bypass_hardware", "Hardware-Sperren umgehen (TPM 2.0, Secure Boot, RAM, CPU)"),
            ("bypass_konto", "Kein Microsoft-Konto verlangen"),
            ("bypass_netzwerk", "Installation ohne Internet erlauben"),
            ("keine_datenerhebung", "Datenerhebung aus (Datenschutzfragen überspringen)"),
            ("kein_bitlocker", "Keine automatische Geräteverschlüsselung"),
            ("qol", "Aufgeräumtes Windows (Copilot, OneDrive, Outlook, Schnellstart …)"),
            ("dateiendungen", "Dateiendungen im Explorer anzeigen"),
            ("wtg_platten_offline", "Interne Platten des Wirt-PCs offline lassen"),
            ("passwort_aendern", "Kennwort beim ersten Anmelden setzen lassen"),
            ("sprachauswahl_ueberspringen", "Sprach- und Tastaturauswahl überspringen"),
        ]
        for name, text in haken:
            v = tk.BooleanVar(value=bool(self.wue.get(name)))
            ttk.Checkbutton(d, text=text, variable=v).pack(anchor="w", padx=12, pady=3)
            felder[name] = v

        eing = ttk.Frame(d)
        eing.pack(fill="x", padx=12, pady=8)
        texte = {}
        for i, (name, beschriftung) in enumerate(
                [("benutzer", "Lokales Konto"), ("passwort", "Kennwort"),
                 ("computername", "Computername"), ("sprache", "Sprache"),
                 ("produkt_key", "Produktschlüssel")]):
            ttk.Label(eing, text=beschriftung).grid(row=i, column=0, sticky="w", pady=2)
            e = ttk.Entry(eing, width=34,
                          show="*" if name == "passwort" else "")
            e.insert(0, str(self.wue.get(name, "")))
            e.grid(row=i, column=1, padx=8, pady=2)
            texte[name] = e

        def uebernehmen():
            for name, v in felder.items():
                self.wue[name] = v.get()
            for name, e in texte.items():
                self.wue[name] = e.get().strip()
            if self.wue["sprache"]:
                self.wue["tastatur"] = {
                    "de-DE": "0407:00000407", "en-US": "0409:00000409",
                    "en-GB": "0809:00000809", "fr-FR": "040c:0000040c",
                    "tr-TR": "041f:0000041f"}.get(self.wue["sprache"], self.wue["tastatur"])
            d.destroy()
        ttk.Button(d, text="Übernehmen", command=uebernehmen).pack(pady=8)

    def ms_dialog(self):
        d = tk.Toplevel(self)
        d.title("Windows bei Microsoft holen")
        d.geometry("560x220")
        d.transient(self)
        zustand = {"sitzung": None}
        produkt = ttk.Combobox(d, state="readonly", values=["windows11", "windows10"])
        produkt.current(0)
        produkt.pack(fill="x", padx=12, pady=6)
        ausgabe = ttk.Combobox(d, state="readonly")
        ausgabe.pack(fill="x", padx=12, pady=6)
        sprache = ttk.Combobox(d, state="readonly")
        sprache.pack(fill="x", padx=12, pady=6)
        hinweis = ttk.Label(d, text="", wraplength=520)
        hinweis.pack(fill="x", padx=12)

        def suchen():
            try:
                liste = download.ausgaben(produkt.get())
                ausgabe["values"] = [a["name"] for a in liste]
                ausgabe.current(0)
                zustand["ausgaben"] = liste
                sid, sprachen = download.sprachen(liste[0]["id"], produkt.get())
                zustand["sitzung"] = sid
                zustand["sprachen"] = sprachen
                sprache["values"] = [s["name"] for s in sprachen]
                deutsch = next((i for i, s in enumerate(sprachen)
                                if "German" in s["name"]), 0)
                sprache.current(deutsch)
                hinweis["text"] = "Sprache wählen und herunterladen."
            except Exception as e:
                hinweis["text"] = str(e)

        def laden():
            try:
                s = zustand["sprachen"][sprache.current()]
                treffer = download.links(zustand["sitzung"], s["id"], produkt.get())
                ziel = filedialog.askdirectory(title="Wohin soll die ISO?")
                if not ziel:
                    return
                d.destroy()
                self._im_hintergrund(
                    lambda: download.herunterladen(treffer[0]["uri"], ziel,
                                                   treffer[0]["name"], self._melden),
                    lambda e, f: self._fertig(e, f, "ISO geladen"))
            except Exception as e:
                hinweis["text"] = str(e)

        knoepfe = ttk.Frame(d)
        knoepfe.pack(pady=8)
        ttk.Button(knoepfe, text="Suchen", command=suchen).pack(side="left", padx=6)
        ttk.Button(knoepfe, text="Herunterladen", command=laden).pack(side="left")

    def pruefsummen(self):
        if not self.iso:
            return messagebox.showinfo("VolmeStick", "Erst eine ISO auswählen.")
        self._im_hintergrund(
            lambda: vstick.pruefsummen(self.iso, self._melden),
            lambda e, f: self._fertig(e, f, "Prüfsummen: " + (
                "\n".join(f"{k.upper()} {v}" for k, v in (e or {}).items()))))

    def starten(self):
        if not self.geraete:
            return messagebox.showerror("VolmeStick", "Kein Datenträger gewählt.")
        modus = ("auto", "windows", "dd", "leer")[self.modus.current()]
        if modus != "leer" and not self.iso:
            return messagebox.showerror("VolmeStick", "Keine ISO gewählt.")
        g = self.geraete[self.geraet_feld.current()]
        if not messagebox.askyesno(
                "Wirklich?",
                f"{g['pfad']} – {g['name']} ({g['groesse'] / GIB:.1f} GB)\n\n"
                "Der Datenträger wird VOLLSTÄNDIG gelöscht. Fortfahren?"):
            return
        self.protokoll.delete("1.0", "end")
        self._im_hintergrund(
            lambda: vstick.stick_schreiben(
                self.iso, g["pfad"], self.wue, self._melden,
                label=self.label_feld.get().strip() or "V3D_WIN",
                modus=modus,
                schema=("gpt", "mbr")[self.schema.current()],
                dateisystem=("auto", "fat32", "ntfs", "exfat")[self.dateisystem.current()],
                schnell=self.schnell.get()),
            lambda e, f: self._fertig(e, f, "Fertig – der Stick kann raus."))

    def _fertig(self, ergebnis, fehler, text):
        self.start["state"] = "normal"
        if fehler:
            self.status["text"] = "Fehler"
            messagebox.showerror("VolmeStick", str(fehler))
            return
        for w in (ergebnis or {}).get("warnungen", []) if isinstance(ergebnis, dict) else []:
            self.protokoll.insert("end", "Hinweis: " + w + "\n")
        self.status["text"] = text.splitlines()[0]
        messagebox.showinfo("VolmeStick", text)


if __name__ == "__main__":
    Anwendung().mainloop()
