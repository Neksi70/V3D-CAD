# V3D CAD modellieren: Anleitung für Agenten

## Grundregeln
- **Einheiten:** mm. **Z zeigt nach oben**, die Bauplatte liegt bei Z = 0. X geht nach rechts, Y nach hinten.
- **`center`** ist immer die Mitte der Bounding-Box. Ein Körper der Höhe h steht auf der Platte, wenn center[2] = h/2.
- **ids:** Jeder Körper hat eine Zahl als id.
  - `bool.*`, `sketch.extrude` mit op join/cut und `gen.edit` erzeugen **neue** Körper mit **neuen** ids. Nimm die id aus `created`.
  - `body.fillet`/`body.chamfer`, `body.transform` und `body.set` **behalten** die id.
- **Undo:** Ein `execute` oder ein ganzer `batch` ist **ein** Undo-Schritt. Bei einem Fehler bleibt die Szene unverändert, und die Meldung sagt, was fehlte.
- **Live-Ansicht:** Der Nutzer sieht im Agent-Monitor live zu. Nenne ihm den Link, sobald du anfängst.

## Vorgehen
1. **Erst rechnen, dann bauen:** Maße und Positionen jedes Teils festlegen und das **erwartete Volumen** überschlagen.
2. **In wenigen `batch`-Aufrufen bauen**, Stufe für Stufe:
   1. Grundkörper
   2. Aushöhlen und Abziehen
   3. Kanten runden
   4. Details
3. **Nach jeder Stufe `measure`** und mit deiner Rechnung vergleichen.
   - Ein Abzug, der danebengeht, meldet trotzdem `ok`. Erst das Volumen zeigt, ob er getroffen hat.
   - Liegt ein Werkzeug nur bündig an einer Fläche, gibt es Mini-Splitter. Lass Abzieh-Körper deshalb 0,5–1 mm über die Fläche hinausragen (durchgehende Löcher etwas höher als die Wand).
4. **Zum Schluss** einen `screenshot` (klein, z. B. 480×320, `view: iso`) zur Sichtkontrolle, dann `export` (3MF für den Druck, STEP für andere CAD-Programme).

## Live im Tab des Nutzers
- Der Nutzer öffnet in V3D CAD **☰ Menü → 🤖 Claude live**. Der Tab zeigt dann einen 6-stelligen Code.
- `live_connect {code}`: Danach laufen **alle** Befehle sichtbar in seinem Tab statt im unsichtbaren Browser. `live_disconnect` schaltet zurück.
- In seinem Tab liegt **sein** Modell. Nicht ungefragt `scene.new` ausführen oder Körper löschen.
- Ändert er nebenbei etwas von Hand, friert der Bauplan ein (siehe unten). Das ist so gewollt.
- Beendet er „Claude live“, scheitern die Befehle mit einer klaren Meldung. Dann `live_disconnect`.

## Parametrisch bauen (Bauplan)
- **Parameter zuerst anlegen:** `param.set {name:"breite", value:80}`; auch Formeln wie `{name:"rand", value:"d + 4"}`. Sie erscheinen im 𝑥-Panel des Editors.
- **In jedem Befehl** darf statt einer Zahl eine Formel stehen: `size:["breite","tiefe","hoehe"]`, `center:["breite/2 - wand - 5", 0, "wand + 5"]`, `radius:"R"`, `step:[0, "-(B - 2*rand)", 0]`.
- Jeder bauende Befehl landet mit seinen Formeln im **Bauplan** (`timeline.list`). **`param.set` mit neuem Wert baut alles neu.**
  - Die Antwort enthält `recomputed`, `volume_before` und `volume_after`.
  - Die ids bleiben gleich.
  - Scheitert ein Schritt (z. B. Radius zu groß), kommt eine Meldung mit der Schrittnummer, und alles bleibt beim alten Wert.
- **Bauplan bearbeiten:**
  - `timeline.edit {step, params}` ändert einen Schritt.
  - `timeline.delete {step}` entfernt einen; hängen spätere Schritte davon ab, wird das verweigert.
  - `timeline.rebuild` rechnet zur Kontrolle neu.
- **Gute Praxis:**
  - Alles, was der Nutzer später ändern könnte (Außenmaße, Wand, Lochdurchmesser, Abstände), als Parameter anlegen.
  - Positionen relativ dazu formulieren, damit Löcher und Dome beim Ändern mitwandern.
  - Spiegeln und Muster mit Formel-Schritten halten die Symmetrie.
  - Nach `param.set` das neue Volumen kurz gegen die Erwartung prüfen.
- **Handänderung:** Ändert der Nutzer die Szene im Editor (ziehen, löschen, Undo), friert der Bauplan ein. Die Antwort enthält dann einen Hinweis. Der jetzige Stand wird neuer Ausgangspunkt, die Parameter bleiben, und neue Schritte werden wieder aufgezeichnet. Importe beginnen ebenfalls einen neuen Bauplan.

## Bausteine
| Ziel | Befehl |
|---|---|
| Quader, Zylinder, Kugel, Kegel, Rohr … | `shape.add {type, size:[x,y,z], center, rotation?, hole?}`; die Liste liefert `shape.types` |
| beliebige 2D-Kontur extrudieren | `sketch.extrude {outer, holes?, height, plane?, offset?, op?, target?}` |
| Loch, Tasche, Durchbruch | Werkzeugkörper mit `hole:true` anlegen, dann `bool.subtract {target, tools:[…]}`; oder `sketch.extrude` mit `op:"cut"` |
| Teile verschmelzen | `bool.union {ids}` oder `sketch.extrude` mit `op:"join"` |
| Kanten runden oder fasen | `body.fillet {id, radius, edges}` bzw. `body.chamfer {id, distance, edges}` |
| Kanten ansehen | `body.edges {id, filter?}` |
| fertige Spielzeug-/Kindermodelle | `gen.list`, dann `gen.list {id}`, dann `gen.run {id, vorlage?, params}`; nachträglich ändern mit `gen.edit` |
| Rotationskörper (Vase, Knauf, Becher) | `revolve {profile:[[r,z], …], center?, wall?}`; Profil auf der Achse (r = 0) beginnen und enden lassen |
| aushöhlen (Wand nach innen, Seite offen) | `body.shell {id, thickness, open:"top"}`; gleiche Grenzen wie Runden |
| spiegeln | `body.mirror {id, plane:"YZ"/"XZ"/"XY", at?, copy?}` |
| Reihen, Lochkreise | `body.pattern {id, linear:{count, step}}` oder `{circular:{count, axis?, center?, angle?}}`, mit `union:true` gleich vereint |
| vorhandene Datei weiterbearbeiten | MCP-Werkzeug `import {path}` (STL, 3MF, OBJ, STEP) |
| auf eine Fläche skizzieren (Tasche, Zapfen, Gravur) | `body.faces {id}`, dann `sketch.extrude {face:{id, face:"top"/"+x"/index/[x,y,z]}, outer, height, op}`; `cut` geht nach innen, das Ziel ist automatisch der Körper |
| Skizze mit Bedingungen (bemaßt) | `sketch.solve` zum Prüfen (dof 0 = voll bestimmt), dann `sketch.extrude {sketch:{entities, constraints}}` |
| fertige Teile mit eigenem Generator-Fenster (Schraube/Mutter, Zahnrad, Gehäuse, Vase, Laterne …, 57 Stück) | `starter.list`, dann `starter.inspect {name}` (Regler mit key, Bereich, Auswahl), dann `starter.run {name, params:{key: wert}, center?}`; bei Knopfgruppen ist der Wert der Knopf-Text, z. B. `{"sbg-type":"Mutter", "sbg-size":"M8"}` |
| verschieben, drehen, Größe ändern | `body.transform {id, center?, move?, rotate?, size?, drop?}`; `rotate` dreht *um* den Winkel, das absolute `rotation` geht nur bei Grundformen |
| kopieren, Reihen | `body.duplicate {id, move}` |

### Skizzen
- **Konturen** in mm, in Skizzen-Koordinaten `[x, y]`:
  - `{rect:{center, size:[b,h], corner_radius?}}`
  - `{circle:{center, r}}`
  - `{ngon:{center, r, sides}}`
  - `{polygon:[[x,y], …]}`
- **Ebenen:**
  - `XY`: Draufsicht (x→X, y→Y), extrudiert nach +Z. `offset` ist die Starthöhe.
  - `XZ`: Vorderansicht (x→X, y→Z), extrudiert nach **−Y**. `offset` = Abstand von Y=0 in Richtung −Y.
  - `YZ`: Seitenansicht (x→Y, y→Z), extrudiert nach +X. `offset` = Start-X.
- `fillet_top`/`fillet_bottom` bzw. `chamfer_top`/`chamfer_bottom` runden oder fasen die Deckkanten gleich mit. Das ist der Weg für abgerundete Platten mit beliebiger Kontur.

### Runden und Fasen: Grenzen
- Geht nur an **Quader, Zylinder, Kegel und Rohr**, bevor sie vereint oder abgezogen werden, und an schon gerundeten Körpern.
- **Nicht an gedrehten Körpern:** erst runden, dann drehen.
- **Reihenfolge:** Grundkörper runden, **dann** Bool-Operationen. Bool-Ergebnisse lassen sich nicht mehr runden.
- Kantenwahl über `edges`: `"all"`, `"top"`, `"bottom"`, `"vertical"`, eine Liste von index-Zahlen aus `body.edges` oder Punkte `[[x,y,z]]`; ein Punkt wählt die nächste Kante.
- Nochmals `body.fillet` auf dieselben Kanten **ändert** den Radius, statt ihn doppelt anzusetzen.
- An einer Ecke nur Rundungen **oder** nur Fasen; gemischt scheitert OCCT.

## Rezepte

**Box mit Deckel (außen B×T×H, Wand w):**
1. Außenkörper: `shape.add box size [B,T,H] center [0,0,H/2]`
2. Senkrechte Kanten runden: `body.fillet {edges:"vertical", radius:3}`
3. Innenraum: `shape.add box size [B-2w, T-2w, H] center [0,0,w+H/2] hole:true`, dann `bool.subtract`.
   - Volumen-Probe: B·T·H − (B−2w)(T−2w)(H−w), weniger die Eck-Rundungen
4. Deckel: `sketch.extrude {outer:{rect:{size:[B,T], corner_radius:3}}, height:w}` neben der Box (`center` per `body.transform` verschieben)
5. Steg darunter: `sketch.extrude {outer:{rect:{size:[B-2w-0.6, T-2w-0.6]}}, height:3, offset:w, op:"join", target:<deckel>}` (0,3 mm Spiel je Seite). Danach den Deckel umdrehen: `body.transform {rotate:[180,0,0], drop:true}`.

**Gehäuse mit Schraubdomen:**
1. Schale: Quader, dann `body.shell {thickness:w, open:"top"}`. Das ist einfacher als Innenraum-Abziehen.
2. Dome: einen `shape.add cylinder size [6,6,h]` innen an eine Ecke stellen, auf den Boden (Z = w). `body.pattern` bzw. `body.mirror` mit `copy` für die anderen Ecken, dann alles mit der Schale `bool.union`
3. Schraublöcher: Zylinder Ø2,5 als `hole:true`, 0,5 mm über die Domoberkante hinaus, dann `bool.subtract`
4. Öffnung für die Buchse: Quader `hole:true`, der die Wand ganz durchstößt (Tiefe = 2·w), dann `bool.subtract`

**Platte mit Lochraster:**
1. Platte: `sketch.extrude` mit `rect` und `corner_radius`
2. **Alle** Löcher als `holes` in **derselben** Skizze. Das ist schneller und robuster als viele einzelne Abzüge.

### Skizzen mit Bedingungen
- **Elemente** (ungefähre Startlage genügt, der Löser zieht sie zurecht):
  - `{id:"l1", type:"line", a:[x,y], b:[x,y]}`
  - `{id:"c1", type:"circle", c:[x,y], r}`
  - `{id:"a1", type:"arc", c, r, a0, a1}` (Winkel in Grad)
- **Bezüge:** `"l1"` (ganzes Element), `"l1.a"`/`"l1.b"` (Linienenden), `"c1.c"` (Mitte), `"a1.s"`/`"a1.e"` (Bogenenden). Enden, die schon aufeinanderliegen, gelten als verbunden.
- **Bedingungen:** `horizontal`, `vertical`, `parallel`, `perpendicular`, `equal`, `coincident`, `on`, `tangent`, `concentric`, `midpoint`, `collinear`, `symmetric`, `fix`.
- **Maße mit `value`:** `length`, `radius`, `diameter`, `distance` (Punkt–Punkt oder Punkt–Linie senkrecht), `angle` (Grad). Werte dürfen Parameter sein (`value:"breite/2"`), dann rechnet `param.set` die Skizze neu.
- **Mindestens einen Punkt mit `fix` festlegen**, sonst „schwimmt“ die Skizze, und `dof` ist größer als 0.

## Prüfen
- `measure {}` liefert Gesamtvolumen und Bounding-Box, `measure {id}` die Werte eines Körpers, `measure {a, b}` den Abstand/die Lücke zwischen zwei Körpern (negativ = Überlappung).
- `measure {a, b}` liefert zusätzlich den **echten kleinsten Abstand** (`min_distance_mm`). Ist er 0, berühren oder überlappen sich die Körper, und `overlap_mm3` ist das Volumen der Überschneidung.
- `measure.interference {}` prüft alle Körper auf Kollision.
- `measure.section {id, axis, at}` liefert Querschnittsfläche und Konturen, z. B. zur Prüfung der Wandstärke oder ob ein Loch durchgeht. Das Bild dazu: `screenshot {section:{axis, at}}`.
- `screenshot {camera:{target, yaw, pitch, distance, fov?}}` ist eine freie Kamera: yaw 0 = von vorn, 90 = von rechts; pitch 90 = von oben; fov 0 = orthografisch.
- Antworten kurz halten: `execute`/`batch` mit `verbose:false` liefern je Körper nur id, Name, Größe, Mitte und Volumen.
- `scene.inspect` listet alle Körper. Übrig gebliebene Werkzeuge (`hole:true`) werden nicht exportiert, stören aber; lösche sie mit `body.delete`.
- Toleranzen: Rundungen und Kreise sind vernetzt, also Abweichung bis ca. 1 % gegenüber der Formel. Eckige Teile stimmen auf 0,01 %.
