# Übergabe: Strebe → Spline (Colani-Kanzel) – für die Claude-Code-Sitzung auf V3DA

Stand 05.11.2026, gebaut in einer Cloud-Sitzung **ohne Zugriff auf den echten Scan**.
Alles ist gegen einen künstlichen Kanzel-Scan getestet (`tests/strebenspline_testscan.mjs`),
am echten `Colani_001.stl` ist noch **nichts** gelaufen.

## Auftrag (Volker)
Leitkurven (Splines) für beide Streben der Colani-Kanzel automatisch aus dem Scan.
Schritt für Schritt: **nach jedem Schritt Kontrollbild (PNG im Arbeitsordner) + kurze Messwerte, dann auf Volkers OK warten.**
- Scan: `/home/v3da/projekte/colani/Colani_001.stl` (Original NIE verändern)
- Arbeitsordner: `/home/v3da/projekte/colani/`
- Noch **keine Leisten** konstruieren, erst nach Freigabe der Splines.
- **Testversion**, nichts auf netcup, nichts ausrollen vor Volkers „Go“.
- Bei Unklarheiten fragen statt annehmen.

## Wo der Code liegt
GitHub `neksi70/v3d-cad`, Branch **`claude/inspiring-faraday-2rh0g1`** (Basis: v1.15.83 vom 09.09. –
GitHub ist hinter V3DA, dort läuft v1.18.24x). Darum alles in eigenen Dateien, nur kleine Haken:

| Datei | Inhalt |
|---|---|
| `lib/strebenspline-kern.js` | Rechenkern (Browser, Worker, Node). Schritte 0–6, alle Parameter in `PARAM_DEFAULT` |
| `lib/strebenspline-worker.js` | Web-Worker für Schritte 0–2 im CAD |
| `lib/strebenspline-ui.js` | Panel „〰 Strebe→Spline“ in V3D CAD (`openStrebenSpline()`) |
| `tools/strebenspline.mjs` | **Kommandozeile, ein Schritt pro Aufruf**, PNG + TXT in den Arbeitsordner |
| `tests/strebenspline_testscan.mjs` | künstlicher Scan mit Soll-Kammlinie |
| `tests/strebenspline_kern_test.mjs` | Kern-Test (Node, ~15 s) |
| `tests/strebenspline_e2e.mjs` | Browser-Test (eigener Dev-Server :18831, Kontrollbilder in `tests/out/`) |

Haken in bestehenden Dateien (beim Übertragen auf v1.18 von Hand setzen):
- `volme3d.html`: Knopf `〰 Strebe→Spline` in „Form ändern“ (vor „Vereinfachen“), Eintrag in der
  Befehlsliste (vor „Modellieren“), zwei `<script src="lib/strebenspline-kern.js|ui.js">` direkt vor `</body>`.
- `volme3d_server.py`: drei ALLOW-Einträge `/lib/strebenspline-{kern,worker,ui}.js` (sonst 404 live!).
- `.gitignore`: `tests/out/`, `__pycache__/`.

## Vorschlag Ablauf auf V3DA
1. `git fetch origin claude/inspiring-faraday-2rh0g1` und die drei Commits ab `cede8e0a` in einen eigenen
   Worktree/Testzweig auf den aktuellen Stand übernehmen (Muster wie `feature/scan-inlay`). `lib/`, `tools/`,
   `tests/` lassen sich 1:1 übernehmen, die Haken oben von Hand.
2. Kern-Test: `node tests/strebenspline_kern_test.mjs` → muss „✓ alles grün“ zeigen.
3. Echter Scan, **Schritt 0**, dann Volker PNG + TXT zeigen und auf OK warten:
   ```
   node tools/strebenspline.mjs 0 --scan /home/v3da/projekte/colani/Colani_001.stl --ordner /home/v3da/projekte/colani
   ```
   schreibt `Colani_aligned.stl`, `transformation.json`, `0_ausrichtung.png/.txt`, `strebenspline_stand.json`.
4. Nach jedem OK den nächsten Schritt (Scan und Parameter merkt sich `strebenspline_stand.json`):
   ```
   node tools/strebenspline.mjs 1 --ordner /home/v3da/projekte/colani          # [--tauschen]
   node tools/strebenspline.mjs 2 --ordner /home/v3da/projekte/colani
   node tools/strebenspline.mjs 3 --ordner /home/v3da/projekte/colani          # [--modus stuetz]
   node tools/strebenspline.mjs 4 --ordner /home/v3da/projekte/colani          # [--mitteln | --original]
   node tools/strebenspline.mjs 5 --ordner /home/v3da/projekte/colani
   node tools/strebenspline.mjs 6 --ordner /home/v3da/projekte/colani
   node tools/strebenspline.mjs params --ordner /home/v3da/projekte/colani     # alle Parameter anzeigen
   ```
   Parameter ändern: `--param glaettung=6 --param stuetzpunkte=5 --param schnittAbstand=10` (gilt ab dann).
   Kontrollbilder brauchen Playwright/Chromium (`PW_CHROMIUM=/pfad` falls nötig).
5. Stützpunkte per Maus (Schritt 3, Wunsch von Volker): in der Testversion von V3D CAD
   `Colani_aligned.stl` importieren → anklicken → `〰 Strebe→Spline` → `📂 JSON laden` (`leitkurven.json`)
   → Modus „Stützpunkte“ → weiße Punkte ziehen, Spline folgt live → Export (JSON/CSV/STEP/Polylinie).

## Was die Schritte tun (Kurz)
- **0** Spiegel-ICP: Grobsuche über Winkel, Neigung und Lage der Ebene, dann Punkt-paar-ICP, dann Punkt-zu-Fläche
  (Gauß-Newton). Testscan: Ebene auf 0,003 mm, Restfehler 0,14 mm. Spitze = tiefster Punkt nahe der Ebene → Ursprung.
- **1** oberhalb `strebenStartZ` (400) nach Vorzeichen X getrennt, Voxel-Zusammenhang mit `lueckenBruecke`
  (überbrückt Löcher), größter Bereich je Seite. Längere Strebe = links. Grobe Leitlinie per Kugel-Verfolgung.
- **2** Zwei Durchgänge: Schnitte ⟂ Leitlinie, dann ⟂ geglättetem Kamm. Dreieck-Ebene-Schnitt (keine Booleans),
  Scheitel = größter Abstand zur Profilsehne, Feinlage per Parabel über die oberste Kappe. Verwirft: Loch am Kamm,
  halbes Profil (Höhe/Breite passt nicht zu Nachbarn), keine runde Kuppe (`maxKammRadius`), Ausreißer (robuste
  lokale Parabel ±100 mm). Testscan: 95 % der Kammpunkte < 0,3 mm am Soll.
- **3** Ausgleichsspline = P-Spline (kubisch, `kontrollpunkte`, 2.-Differenzen-Strafe). Regler `glaettung` 0–10
  = Glättungslänge 20–2000 mm (5 = 200 mm). Stützpunkt-Vorschlag an den Stellen mit kleinster „Störung“
  (Abstand + Rauigkeit + Nähe zu Loch), Spline dann exakt durch die Stützpunkte.
- **4** rechts an X=0 spiegeln, nur gemeinsamer Bereich; gemittelt = Mitte im gemeinsamen Bereich, danach linke
  Strebe mit Überblendung, volle Länge, auf beide Seiten gespiegelt.
- **5** Abstand Kamm ↔ Spline in Wulstrichtung (+ Beule rot, − Delle blau), max/min mit Ort, Diagramm über s.
- **6** `leitkurven.json` (alles inkl. Matrix und Kammpunkte), `leitkurven_stuetzpunkte.csv`,
  `leitkurven.step` (exakte B-Splines, ausgerichtet) + `leitkurven_scan.step` (Original-Koordinaten),
  `leitkurven_polylinie.csv` (alle 2 mm).

## Offene Fragen an Volker (noch nicht beantwortet)
1. **Hochachse/Nicken:** Die Symmetrie legt die Drehung um X nicht fest. Jetzt: Scan-Z in die Ebene projiziert
   + Parameter `nickWinkel`. Lieber Kegelachse der Spitze oder eine andere Bezugskante?
2. **Links/rechts:** Zuordnung nach Länge (links = länger, laut Vorgabe bis Z ≈ 2100). So lassen oder fest nach
   Seite der Mittelebene (Fahrzeugsicht)?

## Risiken beim echten Scan (worauf achten)
- `strebenStartZ` = 400 setzt voraus, dass die Spitze nach dem Ausrichten bis ca. Z 400 reicht; sonst anpassen.
- Wenn ein Querträger o. Ä. beide Streben verbindet oder Teile über X=0 reichen, kann Schritt 1 zu viel
  erwischen → Kontrollbild 1 genau ansehen, ggf. `strebenStartZ`/`lueckenBruecke` ändern.
- Wulst-Richtung: Scheitel = Seite mit dem größten Ausschlag zur Profilsehne, stetig gehalten. Falls der Kamm
  auf der falschen Seite landet: im CAD auf einen Kammpunkt klicken → Querschnittsbild prüfen.
- Laufzeit: Testscan 254k Dreiecke → Schritt 0 ca. 10 s; 640k grob 25–40 s (Node), Speicher unkritisch.
- Smoke-Test (`npm run smoke`) scheiterte in der Cloud nur an „firebase is not defined“ (CDN gesperrt),
  ohne die Änderungen identisch – auf V3DA normal prüfen.

## Nach Volkers „Go“ (nicht vorher)
Version + Changelog + Hilfe-Texte, `npm run build` → `npm run smoke` → Dienst neu starten, dann netcup.
