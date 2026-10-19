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

## Agent-Monitor (live mitverfolgen)

Sobald der Server läuft, öffnet sich unter **http://127.0.0.1:8831/** (bzw. dem nächsten freien Port bis 8839) der Agent-Monitor der Sitzung (nur von diesem Rechner erreichbar). Mit `--monitor-port N` lässt sich ein anderer Startport wählen, mit `--no-monitor` schaltet man ihn ab. Claude bekommt den Link mitgeteilt und nennt ihn dir.

- **Verlauf:** jeder Werkzeug-Aufruf live mit Parametern, Ergebnis, Fehlern und Dauer, dazu ein Bild nach jedem Bauschritt.
- **Ansicht:** Live folgen oder einen alten Schritt anklicken; Iso/Vorne/Oben/… rendert den aktuellen Stand.
- **Körper:** id, Name, Größe, Volumen.
- **Befehle / MCP-Werkzeuge:** alle Befehle mit Parametern. Über das Formular lassen sie sich selbst ausführen; sie erscheinen dann als „Hand“ im Verlauf.
- **Download:** STL, 3MF, STEP und die Szene (V3D-JSON, in V3D CAD zu öffnen).
- **Protokoll:** jede Sitzung schreibt `ausgabe/protokoll-<Datum-Uhrzeit>.jsonl`.

## Von außen: https://v3da.tailf05fe9.ts.net/cad-agent/ (PIN)

- Der Funnel-Pfad `/cad-agent` zeigt auf den **Hub** (127.0.0.1:8830, `server.mjs --hub`). Der Hub baut selbst nichts. Läuft keine Sitzung, zeigt er „Gerade baut keine Claude-Sitzung“. Startet eine, springt er zur neuesten Sitzung und reicht deren Monitor (8831–8839) unter `p/<port>/` durch.
- Von außen geht es nur mit PIN (`~/.config/v3d-cad-mcp/pin`, eigene PIN einfach dort eintragen). Das Cookie gilt 30 Tage. Nach 5 Fehlversuchen ist 15 Minuten gesperrt.
- Dauerdienst einrichten:
  ```
  cp ~/v3d-cad-mcp/v3d-cad-agent-hub.service ~/.config/systemd/user/
  systemctl --user daemon-reload && systemctl --user enable --now v3d-cad-agent-hub
  ```

## Werkzeuge

`anleitung`, `list_commands`, `execute`, `batch`, `inspect_scene`, `measure`, `screenshot`, `export` (stl/3mf/step), `save`, `open`, `import`, `new_scene`, `undo`, `redo`

Befehle für `execute`/`batch`:
- `scene.new`, `scene.inspect`, `scene.save`, `scene.load`
- `shape.types`, `shape.add`, `sketch.extrude`
- `body.edges`, `body.fillet`, `body.chamfer`
- `gen.list`, `gen.run`, `gen.edit` (Kinder-/Spielwelt-Generatoren)
- `revolve`, `body.shell`, `body.mirror`, `body.pattern`, `file.import`
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

Stufe 2 (Skizzen, Runden/Fasen, Generatoren): `node test_stufe2.mjs`. Formwerkzeuge: `node test_formen.mjs`. Die Bausteine liegen in `stufe2/` und werden mit `stufe2/einsetzen.py volme3d.html` eingearbeitet (idempotent).

Anleitung für Agenten: `ANLEITUNG.md` (MCP-Werkzeug `anleitung` bzw. Ressource `v3d-cad://anleitung`).


```
node test_gehaeuse.mjs
```

Der Test baut das Gehäuse aus der SolidCraft-Demo über das MCP-Protokoll und prüft Volumen, Rollback, Undo, Export, Drehungen sowie Speichern und Laden.
