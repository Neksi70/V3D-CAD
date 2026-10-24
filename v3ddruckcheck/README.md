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

## Druck-Assistent (Slicer verbunden, ab Druck-Helfer v13)

Läuft auf dem Windows-Rechner der Druck-Helfer (`~/Volme3D-Druck-Helfer.bat`, Port 7777), zeigt die Startseite
eine Slicer-Leiste: erkannt werden **Bambu Studio, Snapmaker Orca, ElegooSlicer, Anycubic Slicer Next, SovolSlicer,
OrcaSlicer** (alle Bambu-/Orca-Ableger: Titel `[*]Projekt - Slicer`, `%APPDATA%\<Slicer>\<Slicer>.conf` mit
`recent_projects`, eigene Profile unter `user\<Konto|default>\process|filament`).

Ablauf: 🪄 → Helfer speichert das Projekt (Strg+S; ungespeichert → „Speichern unter“ nach
`<Bibliothek>\Projekte`) → Seite prüft (mit „🎯 Wofür ist das Teil?“ = `ctx.purpose`) → ✔ Übernehmen:
gepatchtes 3MF zurück (alte Fassung nach `Projekte\Vorher`), Slicer lädt per Strg+O neu, Häkchen „ins Profil“
legt `<Basis> · V3D [Zweck]` an (erbt vom Herstellerprofil, nur Abweichungen; sichtbar nach Slicer-Neustart).
↶ Rückgängig spielt die Sicherung zurück. Rückfragen des Slicers beantwortet der Helfer NIE selbst, er meldet sie.

Helfer-Befehle (nur erlaubte Origins): `GET /slicer/state`, `POST /slicer/save|apply|undo|preset`, `GET /slicer/file` (je `X-Pid`).

Tests:
```
cd ~ && node v3ddruckcheck/tests/assistent-test.mjs   # Seite ↔ Helfer im pwsh-Container, Slicer vorgetäuscht
v3ddruckcheck/tests/preset_check.sh /tmp/x            # Profile mit dem echten Orca-Lader (libslic3r) laden
```
Fensterbedienung (Strg+S/Strg+O, Datei-Dialog) ist nur unter Windows prüfbar.
