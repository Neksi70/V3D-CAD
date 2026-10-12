# V3D Druckcheck

Slicer-Einstellungen prüfen und verbessern: Datei hineinziehen, der Druckcheck
gleicht die Werte mit Material, Düse, Platte und Modell ab, zeigt Fehler, Warnungen
und Hinweise und schlägt konkrete Korrekturen vor. Die gewählten Korrekturen gibt es
als korrigiertes 3MF oder als Änderungsliste. Läuft komplett im Browser.

- Lokal: `http://127.0.0.1:8810/` (Dienst `v3ddruckcheck.service`)
- Offline: `…/v3d-druckcheck.html` liefert dieselbe Datei als Download (Doppelklick genügt)

## Was geht hinein

| Datei | Einstellungen | Modell | Ausgabe |
|---|---|---|---|
| `.gcode` (Bambu Studio / OrcaSlicer) | aus dem CONFIG_BLOCK | – | Änderungsliste |
| `.gcode.3mf` / Projekt-3MF | `Metadata/project_settings.config` | ja (inkl. Bambu-Komponenten) | **korrigiertes 3MF** + Liste |
| `.stl` | Formular (Material, Düse, Platte, Drucker) | ja | Empfehlungsliste |

Das korrigierte 3MF enthält Modell + gepatchte project_settings, aber keinen alten
Slice (plate_N.gcode, slice_info fliegen raus) → in Bambu Studio/Orca öffnen und neu
slicen. **Geprüft 12.10.2026:** Bambu Studio 02.08 (CLI) slict ein so gepatchtes
Gartenstecker-3MF mit den neuen Werten (layer_height, nozzle_temperature, top_shell_layers).

## Regeln (Prüfkern)

Der Prüfkern ist `~/orca-wasm/web/print-check.js` — derselbe wie im V3D Slicer unter
„Druck-Check [P]". Nach Änderungen dort hier neu bauen:

```
python3 bauen.py      # → index.html (three.js + Prüfkern inline, ~670 KB)
```

server.py liest index.html je Aufruf → kein Neustart nötig.

## Test

```
cd ~ && node v3ddruckcheck/tests/ui-test.mjs        # Server :8810 muss laufen
cd ~/orca-wasm && node test/print-check-test.mjs    # Regeln des Prüfkerns
```
