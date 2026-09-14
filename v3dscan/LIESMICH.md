# V3D Scan

Windows-Programm zum Nachbearbeiten von 3D-Scans (Punktwolken), gedacht für
Exporte aus Revo Scan (Revopoint MIRACO/POP) und CrealityScan (PiKa).
Stand 0.2.0 = Punktwolke (Grundgerüst, Bereinigen, Zusammenführen) + Scan→CAD Etappe 1
(Netzbearbeitung). Ziel: Scan → Geometrieerkennung → parametrisches CAD → STEP/IGES,
Geometriekern dafür wird OpenCASCADE (OCP) – Entscheidung des Users 14.09.2026 (Variante A).

## Aufbau
- `kern/` Rechenkern in Python mit Open3D + numpy
  - `wolke.py` Scan-Datentyp, Einlesen (PLY/PCD/XYZ/ASC/TXT/CSV, OBJ/STL/OFF/GLTF → Eckpunkte), Export (PLY/PCD/XYZ/ASC)
  - `werkzeuge.py` Tisch (RANSAC), Ausreißer statistisch/Radius, kleine Inseln + „Verbunden“ (Voxel-Zusammenhang), Ausdünnen, Normalen
  - `registrierung.py` automatisch (FPFH+RANSAC), Punktpaare (Kabsch), ICP 3-stufig mit Tukey-Kern, Abweichung, global (Posen-Graph)
  - `netz.py` Netz: Analyse (eigene Selbstschnitt-Prüfung per Raycasting – Open3Ds ist quadratisch),
    Reparieren, Löcher schließen flach/gewölbt (Ringe + Laplace/Bi-Laplace per CG), Glätten (Taubin/Laplace),
    Vereinfachen (Quadrik), Beschneiden (exakter Ebenenschnitt), Netz aus Punktwolke (Poisson/Kugel-Abrollen)
  - `projekt.py` Scans, Rückgängig/Wiederholen (Kopien, max. 30 Schritte / 3 GB), Projektdatei `.v3dscan` (ZIP mit .npy)
- `server.py` lokaler Dienst (nur 127.0.0.1, Port 8797), JSON-Befehle + binäre Punktdaten
- `web/` Oberfläche (Three.js r170 lokal in `web/lib`, keine CDN-Abhängigkeit)
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
- `python3 tests/test_oberflaeche.py` Playwright-Durchlauf über echte Maus-/Tastatureingaben
  (gegen die EXE: `V3DSCAN_TEST_PORT=8797`, EXE vorher mit `V3DSCAN_KEIN_FENSTER=1` starten)

## EXE bauen (unter Linux mit Wine)
`./bau_exe.sh` → `dist/V3DScan.exe` (~65 MB, onefile)

Einmalige Einrichtung:
1. Portable Wine 11 nach `~/tools/wine-11.17-amd64` (Kron4ek/Wine-Builds).
   **Ubuntu-Wine 6 geht nicht**: Open3D ruft `fetestexcept` aus der UCRT, Wine 6 bricht ab.
2. Prefix `~/.wine-v3dscan` (`wineboot -u`), darin `C:\Py311e` = Python 3.11 embeddable mit
   PyInstaller 5.13 (Kopie aus `~/.wine-volmestick`).
3. Wheels für win_amd64/cp311 laden und nach `Lib\site-packages` **entpacken** (kein pip):
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
