# V3D Kristall

2D-Foto → 3D-Punktwolke für die Innengravur in K9-Glas (Subsurface-Laser).
Öffentlich: `https://v3da.tailf05fe9.ts.net/kristall` (Dienst `v3dkristall.service`, 127.0.0.1:8799).

## Ablauf

1. Foto laden → Server schätzt die Tiefe (**Depth Anything V2 Small**) und stellt Personen frei
   (**MODNet**), beide per onnxruntime auf der CPU (~1 s). PNG-Transparenz zählt immer als Freistellung.
2. Im Browser: Helligkeit → Punktdichte (Floyd-Steinberg auf dem Punktabstand), Tiefe → z.
   Jede Schicht hat ein eigenes, versetztes Raster (R2-Folge), damit Punkte nicht hintereinander liegen.
   Von vorne ergibt sich wieder das Foto, von der Seite das Relief.
3. Export: DXF (POINT, R12), PLY (binär), XYZ, STL (Relieffläche + Text als Kacheln), Tiefenkarte PNG.
   Achsen wählbar (Bild in X/Y oder X/Z), Nullpunkt Blockmitte oder -ecke. Einheit mm.

Modi: KI-Tiefe · Helligkeit als Tiefe (Logos, Grafik; Ersatz, wenn die KI nicht erreichbar ist) · Flach 2D.

## Modelle (nicht im Git, 125 MB)

```
cd ~/v3dkristall/modelle
curl -L -o tiefe.onnx  https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx
curl -L -o modnet.onnx https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx
```

Lizenz beider Modelle: Apache-2.0. **Achtung:** Depth Anything V2 *Base/Large* sind CC-BY-NC –
nicht einfach „größeres Modell" einsetzen.

## Test

```
cd ~ && node v3dkristall/tests/ui-test.mjs [basis-url]
```

Prüft KI-Anfrage, Punkte im Block, Freistellung, alle Exporte (Inhalt nachgerechnet),
Text, Flach-Modus, gespeicherte Einstellungen und Handy-Breite. Testbild: Mona Lisa (gemeinfrei).

Nach Änderungen an `app.html` reicht Neuladen im Browser; an `server.py`:
`systemctl --user restart v3dkristall`.
