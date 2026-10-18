# V3D CAD MCP-Server

KI-Agenten (Claude) bauen in V3D CAD. Vorbild ist die MCP-Schicht von SolidCraft (MIT/Apache).

- `server.mjs`: MCP-Server über stdio (JSON-RPC). Er startet einen eigenen Dev-Server (nur 127.0.0.1, ohne Login) und einen unsichtbaren Chromium und ruft dort `window.v3dApi` auf.
- Der Befehlssatz liegt in `volme3d.html`, Block „V3D-API“ (am Dateiende): `v3dApi.execute(befehl, params)`, `v3dApi.batch([...])`, `v3dApi.commands()`.
- Außen gilt: mm, Z oben. `center` ist die Mitte der Bounding-Box.

## In Claude Code eintragen

```
claude mcp add v3d-cad -- node /home/v3da/v3d-cad-mcp/server.mjs
```

Optionen:
- `--url http://127.0.0.1:8766/volme3d.html`: eine laufende App statt eines eigenen Dev-Servers verwenden
- `--allow-path DIR`: weitere Ordner zum Speichern und Laden freigeben (Standard: `~/v3d-cad-mcp/ausgabe`)
- `--show`: den Browser sichtbar öffnen

## Werkzeuge

`list_commands`, `execute`, `batch`, `inspect_scene`, `measure`, `screenshot`, `export` (stl/3mf/step), `save`, `open`, `new_scene`, `undo`, `redo`

Befehle für `execute`/`batch`:
- `scene.new`, `scene.inspect`, `scene.save`, `scene.load`
- `shape.types`, `shape.add`
- `body.transform`, `body.set`, `body.duplicate`, `body.delete`
- `bool.union`, `bool.subtract`, `bool.intersect`
- `measure`, `measure.distance`
- `edit.undo`, `edit.redo`
- `view.screenshot`
- `file.export`

Regeln:
- Ein `execute` oder ein ganzer `batch` ist **ein** Undo-Schritt. Bei einem Fehler bleibt die Szene unverändert.
- Boolesche Operationen liefern einen **neuen** Körper mit neuer id (`created`).

## Test

```
node test_gehaeuse.mjs
```

Der Test baut das Gehäuse aus der SolidCraft-Demo über das MCP-Protokoll und prüft Volumen, Rollback, Undo, Export, Drehungen sowie Speichern und Laden.
