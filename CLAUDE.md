# Volme3D – Projektvorgaben

## Architektur
- Single-HTML-App: volme3d.html, ausgeliefert auf Port 8765
- OCCT-Backend: occt-server.js (Node), Port 3001, CSG via OpenCASCADE Boolean
- nginx Reverse Proxy (18790, HTTPS), öffentlich via Tailscale Funnel
- Arbeitskopie = volme3d.html (lesbar, hier wird entwickelt).
  Auslieferung = volme3d.dist.html (minified/gehärtet), erzeugt via `npm run build`.
  volme3d_server.py liefert dist aus, wenn vorhanden, sonst Fallback auf volme3d.html.
  dist ist ein Build-Artefakt (.gitignore), nicht versioniert.

## Härtung / Auslieferung
- build.js minified jeden inline <script>-Block mit terser:
  Kommentare/Whitespace raus, lokale Variablen gemangled, Dead Code entfernt.
- Top-Level-Funktionsnamen bleiben ERHALTEN (mangle.toplevel=false), weil
  622 inline onclick="..."-Handler sie global aufrufen — Umbenennen bricht alle Buttons.
- KEINE echte Verschlüsselung: Browser-Code läuft im Klartext. Es ist eine Hürde
  gegen "Quelltext anzeigen"/1:1-Kopie, nicht gegen Reverse Engineering.
- Workflow nach Code-Änderung: `npm run build` → `npm run smoke` (headless Lade-Check)
  → volme3d.service neu starten.

## Konventionen
- Vanilla JS / Three.js, keine neuen Abhängigkeiten ohne Rückfrage
- Koordinaten-Transformation: World-Transform IMMER vor CSG-Operationen anwenden
- Nach jeder funktionierenden Änderung: git commit mit aussagekräftiger Message

## Vorgehen
- Vor Implementierung kurz Plan nennen, dann umsetzen
- Änderungen am OCCT-Backend immer mit Test-STL gegenprüfen
- Bei Tiefen-/Größen-Mismatch beim Boolean Cut: erst Reproduktion, dann Fix
