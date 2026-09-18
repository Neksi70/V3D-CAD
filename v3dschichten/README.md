# V3D Schichthöhe

Adaptive Schichthöhe automatisch berechnen (Krümmung + Details) und als 3MF mit
eingebettetem Schichtprofil speichern — Bambu Studio, OrcaSlicer und PrusaSlicer
übernehmen es beim Öffnen. Läuft komplett im Browser, auch offline als einzelne Datei.

- Online: `https://v3da.tailf05fe9.ts.net/schichten` (Dienst `v3dschichten.service`, 127.0.0.1:8798)
- Offline: Link „⬇ Offline-Version" auf der Seite → `V3D-Schichthoehe.html` per Doppelklick öffnen

## Bauen

```
python3 bauen.py            # app.html + lib/three.min.js + Rechenkern → index.html (eine Datei)
systemctl --user restart v3dschichten   # nicht nötig, server.py liest index.html je Aufruf
```

Der Rechenkern kommt aus `~/orca-wasm/web/adaptive-layers.js` (dieselbe Quelle wie im
V3D Slicer). Nach Änderungen dort hier neu bauen.

## Test

```
cd ~ && node v3dschichten/tests/ui-test.mjs
```

Prüft STL/3MF-Import, Plan, Export, Gegen-Slice des Exports mit `orca_native`,
Drehen und den Offline-Start per `file://`.

## Wichtig beim Slicen

Im Slicer muss die **Erste Schicht** gleich der hier eingestellten sein — sonst
verwirft Orca/Studio das Profil still und druckt mit fester Höhe.
