# VolmeKarte

Klapp- und Postkarten drucken, ohne sich mit dem Ausschießen zu plagen:
Maße eingeben, Bild und Text setzen, PDF erzeugen.

Windows-Programm (eine EXE, keine Installation). Die Oberfläche läuft im
Browser gegen einen mitgelieferten lokalen Dienst auf Port 8785 — nur
`127.0.0.1`, nichts davon geht ins Netz.

## Wofür das gut ist

Wer eine Klappkarte selbst druckt, scheitert fast immer an zwei Dingen:

1. **Querfalz** (Karte klappt nach oben): Rückseite *und* der komplette
   Innenteil müssen um 180° gedreht auf den Bogen — sonst steht entweder
   die Rückseite oder der Innentext auf dem Kopf.
2. **Wenderichtung**: der Drucker wendet das Blatt über die lange oder über
   die kurze Kante. Passt die Einstellung nicht zum Bogenformat, steht die
   zweite Bogenseite kopf.

Beides rechnet `karte.py` aus. Der Nutzer gibt nur Maße ein.

## Bedienung

1. **Vorlage** wählen oder Bogen-/Kartenmaße in mm eintippen. Angegeben
   wird immer der **flache Bogen**; die Kartengröße ergibt sich aus dem
   Falz. Beispiel: Bogen 200 × 150 mm mit Längsfalz → Karte 100 × 150 mm.
2. **Testdruck** drucken (einmal je Drucker):
   * Das 100-mm-Lineal nachmessen. Stimmt es nicht, steht der Druckdialog
     auf „An Seite anpassen“ statt auf **100 % / Tatsächliche Größe**.
   * Der Pfeil muss auf dem *gedruckten* Blatt auf **beiden** Seiten nach
     oben zeigen. Zeigt er auf der Rückseite nach unten: Wenderichtung
     umstellen und noch einmal testen.
3. Panels füllen: Bild hineinziehen (mit der Maus verschieben, Mausrad
   zoomt), `+ Text` für Textkästen, Doppelklick zum Ändern.
4. **PDF erzeugen** oder **Drucken**. Die PDFs landen in
   `Downloads\VolmeKarte`.

Die Vorschau ist maßstabsgetreu: Die Oberfläche misst die Schriftbreiten im
Browser und schickt fertig umbrochene Zeilen an das PDF. Arial, Times New
Roman und Courier New sind metrisch gleich zu den PDF-Standardschriften
Helvetica, Times und Courier — deshalb sieht der Ausdruck aus wie die
Vorschau.

## Sonderfälle

* **Rohling kleiner als der Bogen** (gekaufte Karten): Kartenmaße eintragen.
  Die Karte wird in der Bogenhälfte zentriert und bekommt Schnittmarken.
* **Rohling schon gefalzt**: Haken bei „Rohling ist schon gefalzt“. Dann
  kommt jedes Panel auf eine eigene Seite in Kartengröße, weil der Drucker
  eine gefaltete Karte je Durchlauf nur einseitig bedrucken kann. Die
  Reihenfolge ist Titel → Rückseite → Innen links → Innen rechts: erst beide
  Außenseiten, dann beide Innenseiten, damit die Karte nur einmal
  gegenläufig gefaltet werden muss. Die Vorschau zeigt in diesem Fall die
  vier Einzelseiten statt der zwei Bogenseiten.

  Wie herum der Drucker eine kleine, gefalzte Karte einzieht, ist von Gerät
  zu Gerät verschieden — den ersten Durchlauf auf normalem Papier proben.
* **Einseitiger Drucker**: Wenderichtung auf „von Hand wenden“.
* **Drucker legt die Rückseite versetzt aufs Blatt**: Feinabgleich X/Y.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `karte.py` | Ausschießen: welches Panel landet wo, mit welcher Drehung |
| `pdf.py` | eigener PDF-Schreiber, mm-genau, ohne Fremdpakete |
| `render.py` | Panel-Inhalte → Bogenseiten; Testdruck |
| `server.py` | HTTP-Dienst und API |
| `web/ui.html` | Oberfläche (Editor, Vorschau, Textsatz) |
| `exe_start.py` | Einstieg der EXE (Port belegt, Protokoll, Meldefenster) |
| `tests/test_karte.py` | spielt Drucken → Wenden → Falzen physikalisch nach |

Keine Fremdpakete — nur die Python-Standardbibliothek.

## Ausschieß-Regeln

    Längsfalz (Falz senkrecht, klappt wie ein Buch zur Seite):
        Bogenseite 1:  links = Rückseite (0°)   | rechts = Titel (0°)
        Bogenseite 2:  links = Innen links (0°) | rechts = Innen rechts (0°)

    Querfalz (Falz waagerecht, klappt nach oben):
        Bogenseite 1:  oben = Rückseite (180°)  | unten = Titel (0°)
        Bogenseite 2:  oben = Innen unten (180°)| unten = Innen oben (180°)

Danach wird — je nach Wenderichtung und Bogenformat — die ganze zweite
Bogenseite noch einmal um 180° gedreht.

`tests/test_karte.py` glaubt dieser Herleitung nicht, sondern rechnet den Weg
jedes Punktes durch Druck, Wenden und Falzen nach und prüft, dass am Ende
jedes Panel aufrecht und unge­spiegelt an der richtigen Stelle sitzt.

## Entwickeln

    python3 server.py --port 8785 --browser
    python3 -m unittest discover -s tests -v

## Bauen (Windows-EXE, unter Wine)

    export WINEPREFIX=~/.wine-volmestick
    rsync -a --delete --exclude __pycache__ --exclude tests \
        ~/volmekarte/ ~/.wine-volmestick/drive_c/karte/
    cd ~/.wine-volmestick/drive_c/karte
    wine ~/.wine-volmestick/drive_c/Py311e/python.exe \
        -m PyInstaller --noconfirm --clean VolmeKarte.spec

Ergebnis: `dist/VolmeKarte.exe` (~7 MB).

Hinweis zum Testen unter Wine: die fensterlose EXE braucht ein echtes
Terminal, sonst bricht Python beim Anlegen der Standardströme ab
(`init_sys_streams`). Das ist eine Wine-Eigenheit, kein Fehler des
Programms — auf Windows tritt sie nicht auf. Zum Prüfen:

    setsid script -qfc 'wine "C:\karte\dist\VolmeKarte.exe"' /tmp/vk.log &
