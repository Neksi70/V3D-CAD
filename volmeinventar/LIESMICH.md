# VolmeInventar

Liest auf einem Windows-11-Rechner aus, **welche Programme installiert sind**
und **welche Verknüpfungen angelegt wurden**, und schreibt daraus einen
Bericht.

Gedacht für die Kurs-PCs: eine EXE auf den Stick, Doppelklick, fertig.
Es wird **nur gelesen** – nichts installiert, nichts verändert, nichts
gesendet.

---

## Benutzen

Doppelklick auf `VolmeInventar.exe`. Das Fenster nimmt sofort auf und zeigt
zwei Reiter:

* **Programme** – alles aus „Apps & Features", plus Store-Apps
* **Verknüpfungen** – Startmenü, Desktop, Autostart, Taskleiste, „Senden an"

Oben rechts drei Knöpfe zum Speichern:

| Knopf | Ergebnis |
|---|---|
| Bericht (HTML) | eine einzelne Datei mit Suche und Sortierung, öffnet sich gleich |
| Tabelle (CSV) | zwei Dateien für Excel (Semikolon, Umlaute stimmen) |
| Daten (JSON) | alles Roh, zum Weiterverarbeiten |

In den Tabellen: Spaltenkopf anklicken sortiert, Suchfeld filtert,
Doppelklick öffnet den zugehörigen Ordner, `Strg+C` kopiert die Auswahl.

**Administratorrechte braucht das Werkzeug nicht.** Ohne sie fehlen nur
Programme und Verknüpfungen *anderer Benutzerkonten* – darauf weist der
Bericht oben selbst hin.

### Ohne Fenster (für Anmeldeskripte)

```
VolmeInventar.exe -o C:\Berichte\%COMPUTERNAME%.html --leise
VolmeInventar.exe --format csv -o C:\Berichte\bestand.csv
VolmeInventar.exe --nur verknuepfungen --format json -o C:\temp\v.json
```

Sobald ein Argument angegeben ist, öffnet sich kein Fenster.

---

## Was gelesen wird

**Programme** – die Deinstallations-Einträge der Registry, und zwar alle vier
Kombinationen: für den Rechner (HKLM) und für den Benutzer (HKCU), jeweils in
der 64- und der 32-Bit-Sicht. Wer nur eine Sicht liest, übersieht auf einem
64-Bit-Windows sämtliche 32-Bit-Programme.

Herausgefiltert werden Einträge, die keine Programme sind: Updates,
Sprachpakete, ausdrücklich versteckte Systembestandteile, Teilstücke größerer
Pakete und Karteileichen ohne Deinstallationsweg. **Ohne diesen Filter besteht
die Liste zur Hälfte aus Sicherheitsupdates.**

Store-Apps stehen in keinem Deinstallations-Zweig und werden getrennt gelesen.

**Verknüpfungen** – `.lnk` und `.url` in allen üblichen Orten, jeweils auf
beiden Ebenen (alle Benutzer / nur dieser). Der Autostart-Ordner liegt
*innerhalb* des Startmenüs; er wird als eigener Ort geführt und nicht doppelt
gezählt.

Für jede Verknüpfung: Ziel, Argumente, Arbeitsordner, Symbol, Fensterstil,
Tastenkürzel – und ob **das Ziel überhaupt noch existiert**. Letzteres ist der
häufigste Befund nach einer Deinstallation: die Kachel bleibt, das Programm
ist weg.

### Warum ein eigener .lnk-Leser

`lnk.py` liest das Verknüpfungsformat (MS-SHLLINK) direkt, statt Windows über
COM zu fragen. Zwei Gründe: COM liefert nur, was der Shell-Namensraum gerade
auflösen kann – bei einer Verknüpfung auf ein abgezogenes Laufwerk kommen
leere Felder zurück. Und ohne COM lässt sich der Leser auf Linux testen, wo
die Entwicklung stattfindet.

Der Zielpfad wird in dieser Reihenfolge bestimmt: LinkInfo (voller Pfad mit
Laufwerk) → Umgebungsblock (`%ProgramFiles%\…`) → Ziel-IDListe. Die IDListe
zählt nur, wenn sie wie ein Dateipfad aussieht – sie kann auch einen Ort im
Shell-Namensraum beschreiben („Systemsteuerung"), und der gehört nicht in ein
Feld, das anderswo als Pfad weiterverwendet wird.

---

## Aufbau

| Datei | Aufgabe |
|---|---|
| `lnk.py` | liest eine `.lnk`-Datei (eigenständig, ohne Windows benutzbar) |
| `verknuepfungen.py` | geht die Verknüpfungs-Orte ab, prüft die Ziele |
| `programme.py` | liest die Registry; Filter/Datum/Paketnamen ohne Registry-Zugriff |
| `inventar.py` | Kern und Kommandozeile |
| `bericht.py` | HTML / CSV / JSON |
| `oberflaeche.py` | das Fenster (Tkinter) |
| `exe_start.py` | Einstieg der gebauten EXE |

Die Auswertelogik ist überall von den Windows-Aufrufen getrennt – nur deshalb
lässt sich der größte Teil auf Linux prüfen.

---

## Entwickeln

```bash
./pruefen.sh          # alle Tests (braucht Xvfb für die Fenster-Tests)
python3 inventar.py   # läuft auf Linux nur für den Verknüpfungsteil
```

**Die Tests laufen gegen echte Dateien, nicht gegen Nachbauten.** Die Proben
unter `tests/proben/` sind mit `IShellLink` erzeugte `.lnk`-Dateien; der
HTML-Bericht wird in einem echten Browser auf Sortierung und Suche geprüft;
die Oberfläche wird unter Xvfb wirklich gebaut und bedient.

### EXE bauen

```bash
./bauen.sh --python-einrichten    # einmalig
./bauen.sh                        # Tests, Bau, Rauchprobe
```

Gebaut wird unter Wine mit einer **vollständigen** Windows-Python. Die
eingebettete Python aus dem VolmeStick-Bau (`Py311e`) taugt nicht: sie bringt
kein `tkinter` mit, und ohne `tkinter` gibt es keine Oberfläche. `bauen.sh
--python-einrichten` holt deshalb eine vollständige Fassung nach `Py311tk`.

`bauen.sh` schließt mit einer Rauchprobe ab – die frisch gebaute EXE muss
unter Wine einen Bericht schreiben. Ohne diesen Schritt fällt ein vergessenes
Modul erst auf dem Kurs-PC auf.

---

## Grenzen

* **WOW64-Trennung ungeprüft.** Ob ein Programm als 32- oder 64-Bit gemeldet
  wird, folgt der dokumentierten Windows-Semantik, ließ sich unter Wine aber
  nicht gegenprüfen: Wine bildet die getrennten Registry-Sichten nicht
  getreu ab. Auf echtem Windows 11 bitte einmal gegen „Apps & Features"
  vergleichen.
* **Store-Apps** werden aus dem Zweig des angemeldeten Benutzers gelesen.
  Der maschinenweite Paketspeicher gehört SYSTEM und ist auch als
  Administrator nicht ohne Weiteres lesbar.
* **Andere Benutzerkonten** bleiben außen vor (siehe oben).
* **Angelegt-Zeitpunkt** einer Verknüpfung ist der des Dateisystems. Wird eine
  Verknüpfung kopiert statt neu erstellt, steht dort das Kopierdatum.
