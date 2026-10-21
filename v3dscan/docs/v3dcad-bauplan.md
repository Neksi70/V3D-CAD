# Bauplan für V3D CAD (`*.v3dcad.json`)

V3D Scan übersetzt den Verlauf eines Körpers in Befehle der V3D-CAD-Befehlsschnittstelle (dieselbe, die der
MCP-Dienst `v3d-cad` und „Claude live“ benutzen). In V3D CAD entsteht daraus ein **parametrischer Bauplan**
statt eines toten STEP-Körpers.

```json
{"format": "v3dscan-bauplan", "version": 1, "koerper": "Extrusion1", "vollstaendig": true,
 "volumen": 29118.23, "hinweise": [],
 "befehle": [{"befehl": "sketch.extrude", "params": {…}, "als": "k"},
             {"befehl": "sketch.extrude", "params": {…, "op": "cut", "target": "@k"}, "als": "k"},
             {"befehl": "body.pattern", "params": {"id": "@k", …, "union": true}, "als": "k"}]}
```

## Ausführen

- Befehle der Reihe nach ausführen.
- `"@name"` in `params` (auch in Listen) durch die id ersetzen, die der Befehl mit `"als": "name"` geliefert hat.
- Die id steht je nach Befehl an verschiedenen Stellen:
  - `result.id` bei `sketch.extrude` (neu), `revolve` und `shape.add`
  - `result.created[0].id` bei `op` join/cut, `bool.*`, `body.pattern` mit union und `body.mirror` mit copy
- `body.transform` und `body.mirror` ohne copy behalten die id.
- Zum Schluss `measure {id}` gegen `volumen` prüfen. Toleranz etwa 1 %, weil V3D CAD Kreise vernetzt.

## Was übertragen wird

| V3D Scan | V3D CAD |
|---|---|
| Extrusion neu/vereinen/abziehen, Skizze parallel zu XY/XZ/YZ | `sketch.extrude` mit `sketch.entities` (line/arc/circle), `plane`, `offset`, `op`, `target` |
| Drehung 360° um eine senkrechte Achse | `revolve {profile: [[r, z]], center}` |
| Zylinder (Achse Z), Kugel | `shape.add` |
| Verschieben/Drehen | `body.transform {move, rotate}` (beide um die BBox-Mitte, X→Y→Z) |
| Spiegeln an YZ/XZ/XY (Mitte oder Ursprung), vereint | `body.mirror {copy}` + `bool.union` |
| Muster linear / Kreis um Z 360° | `body.pattern {union: true}` |

Alles andere geht als STEP-Import (`file.import`) des fertigen Körpers. Dann gilt `vollstaendig: false`, und
der Hinweis nennt den ersten nicht übertragbaren Schritt. Das betrifft:
- Rundung/Fase (V3D CAD rundet nur Grundkörper vor Bool)
- Schale, Loft/Sweep
- Freiform
- schräge Skizzenebenen
- Formschräge

## Fallen (am 21.10.26 mit V3D CAD nachgeprüft)

- **Bögen:** V3D CAD läuft immer gegen den Uhrzeigersinn von `a0` nach `a1` und braucht `a1 > a0` (z. B. 270 → 360,
  nicht 270 → 0). Sonst nimmt es die Gegenseite: Die Eckrundung wurde zum Dreiviertelkreis, die Langloch-Enden zeigten
  beide nach links.
- **XZ-Ebene:** extrudiert nach −Y ab Y = −offset, also `offset = −Y_max`.
- **Spline:** wird zum Linienzug, weil V3D CAD keine Splines kennt.
- **Abgleich:** Platte mit Rundung, Bohrung, Langloch, Tasche (XZ) und Muster: 29 120,0 mm³ in V3D CAD gegenüber 29 118,2
  in V3D Scan. Drehteil: 10 135,2 gegenüber 10 151,5 mm³.

**Offen:** In V3D CAD selbst gibt es noch keinen Knopf „Bauplan öffnen“. Das braucht eine Änderung an
`volme3d.html` (Produktion) und wartet auf die Freigabe.
