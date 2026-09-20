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

## KI-Körper (Modus ③ „KI-Körper")

Foto → **Hunyuan3D-2** (Hugging-Face-ZeroGPU-Space, Token aus `~/.config/volme3d/hf_token`,
derselbe wie bei V3D CAD) → GLB → Server rechnet daraus zwei Tiefenkarten im Raster des Fotos:
Vorderseite und Rückseite. Damit hat der Hinterkopf echte Form statt geratener Kuppel.
Dauer ~20 s, Auftrag mit Warteschlange (`POST /api/koerper`, `GET /api/koerper?id=`).

Fallen, die beim Bauen aufgefallen sind:
- **Ausrichtung ist nicht garantiert.** Der Server probiert 6 Achsdrehungen und nimmt die beste aus
  Umriss-Überdeckung **plus** Korrelation mit der Foto-Tiefenkarte. Der Tiefenteil ist Pflicht:
  Umriss allein kann Vorder- und Rückseite nicht unterscheiden (180°-Drehung + Spiegelung ergibt
  denselben Umriss). Deshalb sind Spiegelungen als Kandidaten ausgeschlossen.
- **Karten müssen bis zum Bildrand aufgefüllt werden** (`fuellen()`, Flutfüllung mit Nachbarwerten).
  Sonst mischt die Interpolation im Browser echte Tiefen mit Nullen → Punktschleier quer durch den Block.
- **Maßstab über robuste Perzentile** (0,5 / 99,5 %), sonst bestimmt ein einzelner Zipfel des Netzes
  die Tiefe des ganzen Motivs.
- Gemälde ergeben korrekterweise eine flache Platte (Mona Lisa: 0,15 von 2,0 Einheiten tief).
- Die Foto-Tiefe bleibt als **Feindetail** (Regler, Standard 1,5 mm) auf dem Modell liegen — das
  erzeugte Netz ist glatter als das Foto.

**Rückseite** (Abschnitt ④): Ohne sie endet das Motiv hinten als flache Wand (Rückmeldung
Kristina, 20.09.2026). „Gerundet" legt eine Wölbung dahinter — Abstand zum Umriss per
Chamfer-Distanztransformation, Kreisprofil, dadurch echte Kuppel statt Plateau. „Gespiegelt"
setzt das Relief seitenverkehrt nach hinten. Die Tiefe wird danach automatisch mittig in den
Block geschoben, „Lage in der Tiefe" verschiebt relativ dazu.

Modi: KI-Tiefe · Helligkeit als Tiefe (Logos, Grafik; Ersatz, wenn die KI nicht erreichbar ist) · Flach 2D.

## Maschinenprofile (⑨ Export → Maschine)

| | xTool F2 Ultra UV | WeCreat Lumos Ultra |
|---|---|---|
| Software | xTool Studio, Modus „Innengravur", PLY → „Punktwolke" | WeCreat MakeIt (oder LightBurn), PLY/STL/OBJ/GLB |
| Arbeitsraum X×Y×Z | 70 × 70 × 150 mm | 70 × 70 × 135 mm |
| Datei-Grenze | PLY < 30 MB (Erfahrungswert) | unbekannt |
| Tempo | ~875 Pkt/s (630k Punkte in 12 min, Erfahrungswert) | unbekannt |

Beide lasern von oben: Block steht, Bild in X/Z (Z = Höhe), Tiefe = Y, Betrachterseite = −Y.
Standard-Export: **PLY als Text** (am sichersten lesbar; ~23 Byte/Punkt → 30 MB ≈ 1,3 Mio. Punkte).
Zeigt das Motiv in der Software nach hinten: „Vorder- und Rückseite tauschen" (180°-Drehung, keine Spiegelung).
DXF lesen beide nur als 2D-Zeichnung.

Quellen: support.xtool.com/article/2716 und /2708, wecreat.com (Lumos-Ultra-Produktseite),
MIT-Fab-Projekt Yufeng Zhao (30-MB-Grenze, Tempo).

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

`--koerper` prüft zusätzlich die ganze Hunyuan3D-Kette (kostet GPU-Kontingent).
Prüft KI-Anfrage, Punkte im Block, Freistellung, alle Exporte (Inhalt nachgerechnet),
Text, Flach-Modus, gespeicherte Einstellungen und Handy-Breite. Testbild: Mona Lisa (gemeinfrei).

Nach Änderungen an `app.html` reicht Neuladen im Browser; an `server.py`:
`systemctl --user restart v3dkristall`.
