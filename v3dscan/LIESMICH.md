# V3D Scan

Windows-Programm zum Nachbearbeiten von 3D-Scans (Punktwolken), gedacht für
Exporte aus Revo Scan (Revopoint MIRACO/POP) und CrealityScan (PiKa).
Stand 1.4.3 = Scan → CAD für echte Scans (Löcher im Netz, Bauart „Ansichten“, verdeckte Bohrungen); 1.4.2 = Bauplan ohne Verlauf (Freiform …) enthält ein fertiges STL statt STEP – V3D CAD hing beim Einlesen großer STEP-Dateien; 1.4.1 = Bauplan: Drehprofil an der Achse halbiert (Drehteile kamen in V3D CAD ohne Volumen an), V3D CAD öffnet Baupläne jetzt selbst (☰ Menü → 🪄 Bauplan aus V3D Scan öffnen, v1.18.236); 1.4.0 = **Scan → CAD mit einem Klick** (START → 🪄, bzw. großer Knopf im leeren Projekt: Datei wählen, Rest läuft allein; `kern/automatik.py`, siehe unten); 1.3.0 = Netzrand bearbeiten (Bucht füllen, Brücke, Rand glätten, Zacken entfernen, Rand verlängern) und Punkt als Skizzenelement; 1.2.0 = Freiform-Editor (Ecken/Kanten/Vierecke wählen, Extrudieren, Brücke, Verschmelzen, Schleife, Pinsel-Glätten), Auswahl (Pinsel, Kreis, Linie, Zauberstab, Vergrößern/Verkleinern, Verbergen), Skizze (Klick-Spline, Trennen, Verlängern, IGES), E57-Import, Auto-Sicherung, Navigationsschemata, Ansichtswürfel, Bauplan für V3D CAD, Grundkörper per Eingabe, Referenz aus Körperfläche, Übergangskurve, Netz an 3D-Skizze teilen, G1 an Ecken verbessert; 1.1.0 = eigener Skizzen-Bedingungs-Löser (gekoppelte Bedingungen + Maße, gespeichert) und Rückfallebene für Boolesche Operationen (Reparatur, Toleranz, Plausibilität); 1.0.0 = Funktionsumfang nach QuickSurface 8 (Vergleich: docs/quicksurface-vergleich.md): Menüband KONSTRUKTION/SKIZZE/CAD/FLÄCHEN/FREIFORM/ANALYSE, Skizzen-Editor, Flächenwerkzeuge, Freiform von Hand, parametrischer Verlauf, STL/STEP/PTX; davor 0.9: Messen, Symmetrie-/Referenzebenen, Mehrfachschnitt, Loft/Sweep/Rohr, Abwickeln (SVG), glatte (G1) Freiform + Käfig von Hand, Zebra/Formschräge + Freiform (automatische Flächen, Fläche aus Auswahl, Beschneiden, Aufdicken) + Körper-Werkzeuge (Verknüpfen, Verschieben/Kopie, Spiegeln, Muster, Schale) + Querschnitt-Skizze → Extrudieren/Drehen → Runden/Fasen (MODELL, Etappen D/E) + Abweichung Scan ↔ Körper (Etappe F) + Oberfläche nach Arbeitsschritten (Design-X-Vorbild, siehe docs/designx-bauplan.md) +
Körper (Grundkörper aus Bereich, Vereinen/Abziehen, STEP/IGES) + Punktwolke (Grundgerüst, Bereinigen, Zusammenführen) + Scan→CAD Etappe 1
(Netzbearbeitung), Etappe 2 (Ausrichten am Koordinatensystem), Etappe 3 (Geometrieerkennung). Ziel: Scan → Geometrieerkennung → parametrisches CAD → STEP/IGES,
Geometriekern dafür wird OpenCASCADE (OCP) – Entscheidung des Users 14.09.2026 (Variante A).

## Scan → CAD mit einem Klick (1.4.0)
`kern/automatik.py`, Befehl `assistent/start` (Fortschritt ohne Sperre: GET `/api/assistent/stand`). Ablauf:
1. Bereinigen: Ausreißer (statistisch, σ 3) + Inseln < 3 % (nur Punktwolken); Tisch nur, wenn seine Ebene in
   beiden Richtungen ≥ 1,3× so weit reicht wie das Objekt.
2. Ausrichten: Formerkennung auf 60 000-Punkte-Stichprobe (nur Ebene/Zylinder/Kegel, ≥ 2 %). Umlaufender
   Zylinder/Kegel mit > 25 % der Punkte, um dessen Achse der Scan symmetrisch ist → Achse = Z; sonst größte Ebene =
   Boden + größte Seitenwand = X/Y; sonst Hauptachsen. Ursprung unten Mitte.
3. Kandidaten: **Drehteil** (Symmetrietest: um 57°/141° gedrehter Scan liegt auf sich selbst, Median-Abstand
   ≤ 1,6 × Punktabstand → Schnitt durch die Achse, größte Kontur drehen); **Prisma** je Achse Z/X/Y (40 Querschnitte,
   Folgen von ≥ 3 gleichen Schnitten = Abschnitt, gleich = Konturzahl + Fläche ± 1,2 % + Box ± 1 % der Diagonale,
   einzelne Ausreißer-Schnitte übersprungen; Grenzen per Halbierung, auf erkannte Ebenen eingerastet; je Abschnitt
   Skizze aus dem Mittelschnitt → Extrusion, vereint); beim besten Prisma erkannte Kugeln/Kegel/Zapfen/Bohrungen dazu
   bzw. ab, wenn der mittlere Fehler um ≥ 2 % sinkt; **Freiform** (automatische Flächen) nur, wenn das Beste > 2,5 ×
   Ziel ist, und sie gewinnt nur bei < 0,6 × Fehler.
4. Bewertung: p95 Scan → Körper + ½ × p90 Körper → Scan („Zusatzmaterial“, erfundene Flächen). Ziel = max(0,25 mm;
   0,4 % der Diagonale; 4 × Rauschen) → „sehr gut“ / „brauchbar“ (≤ 2,5 × Ziel) / „grob“.
Ergebnis = normaler Körper mit Verlauf (Skizzen änderbar) → STEP/IGES/Bauplan wie bisher; alles rückgängig machbar.
Tests: `tests/test_automatik.py` (Testteil, Drehteil, L-Winkel, Torus = Drehteil, Knolle = Freiform; je zufällig
gedreht, 0,02 mm Rauschen; p95 0,03–0,05 mm, Volumen ±0,12 %), `tests/test_oberflaeche_assistent.py`.
- **Falle Querschnitt in einer Planfläche:** Tausende Splitter → `_ordnen` war quadratisch (Grad je Kette neu,
  Minuten je Schnitt) → CSR + numpy; Automatik verwirft Schnitte mit > 60 Konturen.
- **Falle Umfang als Merkmal:** grobe Netze/Zickzack der Punktwolke ändern den Umfang je Höhe um 15 % → Box statt Umfang.
- **Falle p95 beim Ergänzen:** kleine Formen (Kegel) bewegen das 95-%-Quantil nicht mehr → mittlerer Fehler (gekappt).
- Bauplan: Kegel mit senkrechter Achse → `revolve` (V3D CAD hat keinen freien Kegelstumpf).
- **Echte Scans (21.10., Volkers MIRACO-Klotz, `tests/daten/echt_klotz_volker.stl`, nur lokal):** Netz mit 30 Löchern →
  exakte Netzschnitte reißen ab. `kern/schnitt_robust.py`: Innen/Außen-Raster (compute_occupancy, 7 Strahlen, außerhalb
  der Hüllbox immer außen) + exakter Abstand → Marching Squares (immer geschlossen, Splitter < 0,5 % weg). Neue Bauart
  **Ansichten**: Umriss je Achse als *Schattenwurf* der Oberflächenpunkte (der Innen/Außen-Test schloss Durchgangsbohrungen,
  deren Wand kaum gescannt war), je Achse extrudiert (Überstand), Schnittmenge; ungültige Einpassung (selbstüberschneidend)
  → Vieleck-Rückfall. Danach Ergänzen (auch Teil-Zylinder ≥ 150°) und **Hohlräume nachschneiden** (Scanpunkte im Körper
  gruppieren → Kreis je Weltachse → Zylinder bis zur Außenseite; sonst Tasche aus „im Körper, im Scan hohl“ über 3 Tiefen).
  „Zusatzmaterial“ zählt Körperstellen an Scanlöchern nicht mehr. Ergebnis: p95 0,45 mm, Bauplan 22 Schritte (bool.intersect,
  liegende Zylinder = Zylinder + body.transform rotate), V3D CAD baut ihn auf −0,13 % nach.

## Aufbau
- `kern/` Rechenkern in Python mit Open3D + numpy
  - `wolke.py` Scan-Datentyp, Einlesen (PLY/PCD/XYZ/ASC/TXT/CSV, OBJ/STL/OFF/GLTF → Eckpunkte), Export (PLY/PCD/XYZ/ASC)
  - `werkzeuge.py` Tisch (RANSAC), Ausreißer statistisch/Radius, kleine Inseln + „Verbunden“ (Voxel-Zusammenhang), Ausdünnen, Normalen
  - `registrierung.py` automatisch (FPFH+RANSAC), Punktpaare (Kabsch), ICP 3-stufig mit Tukey-Kern, Abweichung, global (Posen-Graph)
  - `netz.py` Netz: Analyse (eigene Selbstschnitt-Prüfung per Raycasting – Open3Ds ist quadratisch),
    Reparieren, Löcher schließen flach/gewölbt (Ringe + Laplace/Bi-Laplace per CG), Glätten (Taubin/Laplace),
    Vereinfachen (Quadrik), Beschneiden (exakter Ebenenschnitt), Netz aus Punktwolke (Poisson/Kugel-Abrollen)
  - `formen.py` robuste Einpassung Ebene/Kugel/Zylinder/Kreis (Zylinder: Startachse aus Normalen, Gauss-Newton)
  - `erkennung.py` RANSAC mit Normalen (Ebene/Kugel/Zylinder/Kegel aus Minimalstichproben, größter
    zusammenhängender Bereich, exakt nachgepasst), Deutung Bohrung/Zapfen/Rundung/Hohlkehle/Kugel/Kegel/Senkung,
    Nennmaß-Rundung, Achsen einrasten, Zusammenfassung „Erkannt: …“; ohne Normalen werden sie geschätzt und
    konsistent ausgerichtet (sonst sind Bohrung und Zapfen nicht unterscheidbar); Netze werden gleichmäßig abgetastet
  - `koordinaten.py` Hauptachsen, auf größte Ebene stellen, 3-2-1 aus Elementen (rechtshändig für jede
    Achsenzuordnung), Verschieben/Drehen um Werte – Matrix gilt für alle sichtbaren Scans
  - `projekt.py` Scans, Rückgängig/Wiederholen (Kopien, max. 30 Schritte / 3 GB), Projektdatei `.v3dscan` (ZIP mit .npy)
- `kern/skizze.py` Querschnitt → Skizze: Ebene (Welt XY/XZ/YZ + Versatz, erkannte Ebene, durch Zylinder-/Kegelachse),
  Netz exakt geschnitten, Punktwolke als Scheibe (±1,5 × Punktabstand) gierig geordnet; Zerlegen in Linie/Bogen/Kreis
  (Teilen an größter Sehnenabweichung, Zusammenfassen, 3→2-Reduktion, Naht in der Mitte der längsten Linie, robust:
  95 % in Toleranz); Rundungen zwischen zwei Linien tangential mit nur dem Radius als Unbekannter eingepasst
  (freie Kreispassung streut an kurzen Bögen ±0,1); Nennmaß + achsparallel; Anschlüsse als Schnitt-/Berührpunkte,
  damit die OCP-Kontur exakt zu ist; Radius ändern (bleibt tangential), Element → Gerade
- `kern/features.py` Profil (Außen-/Innenkonturen) → Extrusion (Länge/symmetrisch/bis Scan = Tiefe der Scanpunkte im
  Profil), Drehung (Profil an der Achse auf eine Seite beschnitten), Rundung/Fase an Kanten (Nummern = TopExp-Map,
  im Anzeige-Netz je Kantensegment mitgeliefert), Radius-Vorschlag aus erkannten Rundungen
- `kern/freiform.py` Automatische Flächen: Instant Meshes (pynanoinstantmeshes, BSD) → reines Vierecksnetz;
  Kanten auf den Scan gelegt (Strahl entlang der Normale, sonst springt der nächste Punkt an engen Krümmungen auf die
  Gegenseite), von beiden Nachbarn geteilt; je Viereck Coons-Raster auf den Scan → bikubische Interpolation mit
  gleichmäßiger Parametrisierung (gleiche Randpunkte ⇒ identische Randkurven, C0 dicht) → Nähen → Volumenkörper.
  Fläche aus Auswahl: Höhenraster über der Ausgleichsebene (lokale quadratische Passung je Knoten), über den Rand
  linear fortgesetzt (GeomLib.ExtendSurfByLength gibt in OCP das Ergebnis nicht zurück!), Beschneiden per Halbraum.
- `kern/features.py` zusätzlich Körper verknüpfen (vereinen/abziehen/Schnittmenge), Verschieben/Drehen/Kopie,
  Spiegeln, lineares/Kreis-Muster, Schale (offene Flächen per Klick, sonst geschlossen hohl), Aufdicken
- Vernetzen: unbeschnittene B-Spline-Flächen über ein eigenes Parameterraster (BRepMesh brauchte für eine
  Freiform-Fläche bei Messtoleranz 216 s, jetzt 0,5 s); Kennwerte adaptiv (eps 1e-5) statt fester Integration
- `kern/referenz.py` Symmetrieebene (Spiegelung je Hauptachse + ICP, Ebene aus M = T·S), Ebene/Achse aus Bereich,
  Mittelebene; Referenzen im Projekt (Skizzenebene „Referenz“, Spiegelebene `ref:<id>`)
- Freiform G1: je Kante gemeinsame kubische B-Spline-Randkurve (7 Kontrollpunkte), zweite Kontrollreihe beider
  Nachbarn ±Querrichtung in der Tangentialebene → G1 entlang der Kante; ecknahe Punkte + Drillpunkte in die
  Ecktangentialebene; scharfe Bauteilkanten (Scan-Normalen beidseits > 35°) bleiben scharf. Käfig von Hand:
  Vorschau liefert V/F, Ecken im Browser über den Scan ziehen, `kaefig` an `freiform/auto`
- `features.py`: Loft (ThruSections), Sweep/Rohr (PipeShell), Abwickeln (LSCM, eigener CG ohne scipy; Naht innerhalb
  einer Fläche nicht verschweißen, sonst wird der Zylinder zum Rohr), SVG in mm
- Skizze: Kontur vor dem Einpassen nach Bogenlänge gleichmäßig abgetastet (Netzschnitte: gerade Wände fast punktlos)
- Oberfläche: Messen (Abstand/Winkel/Kreis, Klick auf Scan oder Körper), Zebra-Streifen (Shader), Formschräge
  (Normalen-Farben zur Entformungsrichtung)
- v1.0: `kern/verlauf.py` parametrischer Verlauf (Neu aufbauen, Schritte aus/an, Kanten/Flächen über
  Bezugspunkte, fester Zwischenstand bei nicht nachrechenbaren Schritten, Skizzenänderung rechnet Körper nach);
  `features.py` Körper aus Flächen (BOPAlgo_MakerVolume, Zelle mit bester Scan-Deckung), Formschräge, Fläche
  verschieben/löschen (Defeaturing), Gewinde (Helix-Sweep), Trennen, Skalieren, Füllen, Nähen, Übergangsfläche,
  Wickeln, Projizieren; `skizze.py` Zeichnen, Spline, Versatz, Spiegeln, Kopieren, Ecke, Bedingungen,
  Länge/Winkel/Abstand, Umriss, DXF; `freiform.py` Raster-Käfig, Wrap, feiner, glätten, Symmetrie, Crease;
  `netz.py` Abrollen, Mittelwert-Netz, Normalen; `wolke.py` PTX
- `server.py` lokaler Dienst (nur 127.0.0.1, Port 8797), JSON-Befehle + binäre Punktdaten
- `kern/koerper.py` OCP-Körper: Grundkörper aus erkanntem Bereich (Zylinder/Kugel/Kegel, Nennmaß, Verlängern),
  Vereinen/Abziehen, Vernetzen für die Anzeige (Flächen + B-Rep-Kanten), BRep im Projekt, STEP/IGES,
  Abweichung Scan ↔ Körper mit Vorzeichen (+ = Scan hat mehr Material): fein vernetzt (Sehne ~0,003 mm an R10),
  Open3D-Closest-Point + exakte float64-Nachrechnung im Dreiecks-Umfeld (Open3D greift an Fächer-Planflächen
  sonst das Nachbardreieck, Fehler bis 0,01 mm); Kennwerte Mittel/σ/RMS/p95/% in Toleranz, „grau ab“ = ohne Gegenstück
- `web/` Oberfläche (Three.js r170 lokal in `web/lib`, keine CDN-Abhängigkeit), hell im Design-X-Aufbau:
  Menüband (START/PUNKTE/POLYGONE/BEREICHE/AUSRICHTEN/MODELL/ANSICHT) → schwebendes Werkzeugfenster
  (👁 Vorschau · ✓ Übernehmen · ✕ Zurücksetzen+Schließen); die Werkzeug-Abschnitte liegen in `#werkzeugablage`
  und werden über `data-wf="id id …"` ins Fenster geholt. Links Verlauf + Modellbaum (Scans, Bereiche, Körper),
  rechts Eigenschaften/Anzeige, unten Konsole. Klick im Modell (Drehen-Werkzeug) wählt den Bereich.
- `exe_start.py` Einstieg der EXE: Dienst + Edge/Chrome im App-Modus, beendet sich 60 s nach Schließen des Fensters

Jedes Werkzeug folgt **Vorschau → Anwenden → Zurücksetzen**; Vorschau färbt die
wegfallenden Punkte rot, erst „Anwenden“ ändert Daten (rückgängig machbar).

## Starten
- Linux/Entwicklung: `./start.sh` → http://127.0.0.1:8797/
- Windows: `V3DScan.exe` (Dateien können per Drag & Drop auf die EXE oder ins Fenster)
  Protokoll: `%LOCALAPPDATA%\V3DScan\protokoll.txt`

## Tests
- `python3 tests/testdaten.py` erzeugt künstliche Scans (3 Teilansichten mit Tisch,
  Rauschen, Ausreißern, „Hand“-Insel, zufällig verschoben; Sollmatrizen in `soll.json`)
- `python3 tests/test_kern.py` Rechenkern gegen die Sollwerte
- `python3 tests/test_netz.py` Netz-Werkzeuge (Kugel mit Löchern/Störungen als Sollform)
- `python3 tests/test_oberflaeche_netz.py` Netz-Reiter per Playwright (auch gegen EXE)
- `python3 tests/test_koordinaten.py` Formen + Koordinatensystem (Bohrung Ø 10,03 schräg im Raum)
- `python3 tests/test_oberflaeche_achsen.py` Bauteil per 3-2-1 ins Bauteil-System (0,002° / 0,004 mm)
- `python3 tests/cad_testteil.py` baut mit OCP ein Testteil (Platte mit Bohrungen, Zapfen, Kuppel, Kegel, R5)
  und tastet es als Scan ab; `tests/test_erkennung.py` prüft die Erkennung (schräg, verrauscht, ohne Normalen, als Netz)
- `python3 tests/test_oberflaeche_formen.py` Formen-Reiter (auch gegen EXE)
- `python3 tests/test_koerper.py` Körper: Maße, Kegelrichtung, Abziehen/Vereinen exakt, Rückgängig, Speichern, STEP/IGES
- `python3 tests/test_oberflaeche_koerper.py` Grundkörper über Menüband, Klick im Modell, Vereinen, STEP-Download
- `python3 tests/test_skizze.py` Skizze/Extrusion/Drehung/Runden gegen Sollteile (Platte R5+Ø12 als Netz und Wolke,
  Welle Ø20/Ø12), Bearbeiten, Speichern, Server-Ablauf mit Rückgängig
- `python3 tests/test_oberflaeche_skizze.py` MODELL-Werkzeuge per Klick (Kante mit echter Maus gewählt)
- `python3 tests/test_freiform.py` Torus → geschlossener Körper (Volumen ±0,2 %, 95 % unter 0,02 mm), verrauscht,
  offene Kuppel, Wellenfläche + Beschneiden gegen ∫, Verknüpfen/Spiegeln/Muster/Schale/Aufdicken mit Sollvolumen
- `python3 tests/test_oberflaeche_freiform.py` Freiform + Körper-Werkzeuge per Klick
- `python3 tests/test_flaechen2.py` Loft/Sweep/Rohr/Abwickeln gegen Formeln, G1-Knickwerte, Käfig, Symmetrie, Mehrfachschnitt
- `python3 tests/test_oberflaeche_v09.py` Referenz, Messen (echte Maus), Loft, Zebra, Abwickeln per Klick, Rohr, Käfig ziehen
- `python3 tests/test_cad2.py`, `test_v10.py`, `test_v10b.py`, `test_verlauf.py` – v1.0-Rechenkern + Dienst
- `python3 tests/test_oberflaeche_v10.py` – v1.0-Bedienwege per Klick (Skizzen-Editor, Verlauf, 3D-Skizze …)
- `python3 tests/test_abweichung.py` Abweichung Scan ↔ Körper gegen Sollwerte (±0,1/0,2/0,3 mm, 1e-4 genau; 1 Mio Punkte < 10 s)
- `python3 tests/test_oberflaeche_abweichung.py` MODELL → Abweichung: Farben (grün im Toleranzband, grau ohne Gegenstück), Kennwerte, Legende
- UI-Tests öffnen Werkzeuge wie ein Nutzer über das Menüband (Helfer `oeffne(band, id)`)
- `python3 tests/test_oberflaeche.py` Playwright-Durchlauf über echte Maus-/Tastatureingaben
  (gegen die EXE: `V3DSCAN_TEST_PORT=8797`, EXE vorher mit `V3DSCAN_KEIN_FENSTER=1` starten)

## EXE bauen (unter Linux mit Wine)
`./bau_exe.sh` → `dist/V3DScan.exe` (~65 MB, onefile)

Einmalige Einrichtung:
1. Portable Wine 11 nach `~/tools/wine-11.17-amd64` (Kron4ek/Wine-Builds).
   **Ubuntu-Wine 6 geht nicht**: Open3D ruft `fetestexcept` aus der UCRT, Wine 6 bricht ab.
2. Prefix `~/.wine-v3dscan` (`wineboot -u`), darin `C:\Py311e` = Python 3.11 embeddable mit
   PyInstaller 5.13 (Kopie aus `~/.wine-volmestick`).
3. Wheels für win_amd64/cp311 laden und nach `Lib\site-packages` **entpacken** (kein pip) – seit 0.8.0 auch
   `pynanoinstantmeshes-0.0.3-cp311-cp311-win_amd64.whl` (Instant Meshes, BSD; `include/` und `lib/` weglassen):
   `pip3 download --platform win_amd64 --python-version 3.11 --only-binary=:all: --no-deps open3d==0.19.0 numpy`

Fallen beim Build:
- open3d.visualization importiert plotly/dash → `kern/o3d.py` setzt Platzhalter-Module.
- numpy 2 + PyInstaller 5.13: numpy-eigenen Hook (`numpy/_pyinstaller`) per `hookspath` einbinden,
  sonst „No module named numpy._core._exceptions“.
- `open3d/__init__` importiert `open3d.ml` immer → darf nicht ausgeschlossen werden.
- Poisson-Rekonstruktion mehrfädig bricht unter Windows/Wine mit „Failed to close loop“ ab →
  `n_threads=1` bei `os.name == "nt"` (einfädig 0,5 s für 127 000 Punkte).
- OCP (für Etappe 3+): `cadquery-ocp==7.8.1.1.post1` + `vtk==9.3.1` (OCP lädt die VTK-DLLs zwingend)
  als Wheels entpackt; unter Linux ist dieselbe Version installiert, weil `cadquery 2.7` sie braucht
  – **nicht auf 7.9 hochziehen**.
- Fehlerfenster (MessageBox) blockieren unsichtbar unter Wine → Traceback steht vorher im Protokoll;
  `V3DSCAN_STAPEL=30` schreibt bei Hängern alle Python-Stapel ins Protokoll,
  `V3DSCAN_KONSOLE=1 ./bau_exe.sh` baut mit Konsole.
