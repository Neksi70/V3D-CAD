# Volme Draw – Projektvorgaben

## Projektziel
- Browserbasiertes Zeichenprogramm für **Anfänger** (Zielgruppe: Kursteilnehmer der
  Volme 3D Akademie). Einstiegshürde so niedrig wie Tinkercad.
- **Hybrid-Ansatz:** Fabric.js-Objektmodell + Pinselstriche als Pfad-Objekte
  (bearbeitbar UND SVG-exportierbar).
- **SVG-Export muss LightBurn-tauglich bleiben** — harte Anforderung, siehe
  "Bekannte Risiken".

## Architektur
- **Single-HTML-App:** `volmedraw.html` (Vanilla JS, Fabric.js 5.3.0). Alles in einer
  Datei, analog zu `volme3d.html`. Kein Framework, kein Bundler-Zwang.
- **Fabric.Canvas = Source of Truth** für alle Objekte (Formen, Pfade, Text, Bilder).
  Custom-Feld `vName` je Objekt = Ebenen-Label, wird mit-serialisiert.
- **UI-Zustand** in Modul-Globals: `currentTool`, `isDrawingShape`, `tempShape`,
  `undoStack`/`redoStack`, `restoring`.
- **Undo/Redo:** vollständige JSON-Snapshots (`canvas.toJSON`), Cap 60, `restoring`-Flag
  unterdrückt Re-Snapshots beim Neuladen.

## Trennung CAD ↔ Draw (Entscheidung)
- Volme3D CAD und Volme Draw sind **getrennte HTML-Dateien / getrennte Projekte**.
  Sie teilen sich NUR eine gemeinsame Startseite `../start.html` (Launcher mit zwei
  Kacheln: "CAD" → volme3d.html, "Zeichnen" → volmedraw/volmedraw.html).
- Volme Draw hat eine **eigene** CLAUDE.md (diese Datei). Die volme3d-CLAUDE.md unter
  `/home/v3da/CLAUDE.md` NICHT anfassen.
- **Deployment (später):** In `volme3d_server.py` die `ROUTES`-Tabelle um Einträge für
  `/start.html` und `/volmedraw/volmedraw.html` ergänzen. Fabric.js dann **lokal
  vendoren** statt CDN (Offline/Funnel + Reproduzierbarkeit, ggf. SRI-Hash).

## Coding-Regeln
- **Vanilla JS, kein Framework.** Keine neuen Abhängigkeiten ohne Rückfrage.
- **Deutsche UI-Texte** (Buttons, Labels, Tooltips, Hinweise).
- **Volme-Farbschema** (CSS-Variablen, nicht hardcoden):
  - `--orange: #ff7a1a`  (Primär/Aktiv)
  - `--cyan:   #00d4e0`  (Akzent/Hover)
  - `--bg:     #0d0d0f`  (Hintergrund)
- Monospace-UI wie im Prototyp beibehalten.

## Workflow
- Vor Implementierung kurz Plan nennen, dann umsetzen.
- **Nach jedem funktionierenden Schritt: `git commit` mit sprechender Message.**
- Änderungen am SVG-Export IMMER gegen LightBurn-Tauglichkeit prüfen (Test-Export
  öffnen/gegenlesen), bevor committet wird.
- Build/dist analog volme3d (`build.js` → `volmedraw.dist.html`) erst einführen, wenn
  die Datei ~1500–2000 Zeilen überschreitet (z. B. mit Firebase). Bis dahin roh.

## Bekannte Risiken (aus Prototyp-Analyse)
- **Undo-Speicher:** jede Aktion serialisiert den GESAMTEN Canvas. Importierte Bilder
  liegen als Base64 in JEDEM der 60 Snapshots → RAM-Explosion auf Tablets. Vor
  Bild-Features die History-Mechanik entschärfen (z. B. Bilder aus Snapshots
  auslagern / Diff-basiert / Tiefe reduzieren).
- **LightBurn-Falle Hintergrund:** `setBackgroundColor` landet in `toSVG()` als großes
  gefülltes `<rect>` → Laser graviert die ganze Fläche. Beim SVG-Export den
  Hintergrund weglassen/ausblenden.
- **LightBurn: Bilder & Text** — importierte Bilder (`<image>`, Base64) sind nicht
  schneidbar; Text als `<text>` importiert unzuverlässig → bei Bedarf in Pfade wandeln.
- **Kein mm/Einheiten-Mapping** (Canvas = px, keine `viewBox`-Kalibrierung) →
  Zielgröße auf dem Lasertisch unvorhersehbar (siehe Roadmap: Lasergrößen-Presets).
- **Touch:** kein `touch-action`, `#canvas-wrap` mit `overflow:auto` → auf Tablets
  scrollt/zoomt die Seite statt zu zeichnen. Keine Stift-Druckstärke.
- **`restoring`-Flag doppelt belegt** (Laden + Snapshot-Unterdrückung); `loadFromJSON`
  ist async → Race bei schnellem Doppel-Undo. Bei Undo-Umbau berücksichtigen.
- **Keine Persistenz:** Reload = alles weg. Bis Firebase kommt ggf. localStorage-Autosave.

## Feature-Roadmap (geplant, noch NICHT bauen)
- **Leinwandgröße** einstellbar + Presets (A4, Lasergrößen F1/F2 Ultra Arbeitsfläche).
- **Pixel-Radierer** als zweiter Radiermodus (neben Objekt-Radierer).
- **Touch-/Stift-Optimierung** für Tablets im Kurs.
- **Speichern/Laden via Firebase** (Auth + Firestore, gleiches Setup wie Volme3D).
- **nginx-Deployment auf V3DA** analog volme3d.html (Route + Funnel).
