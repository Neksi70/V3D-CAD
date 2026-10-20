# QuickSurface – Funktions-Checkliste (für Clean-Room-Vergleich)

Quellen: QSHelp.pdf (262 S., Stand ca. 2022/v5) + knowledgebase_general.md (Video-Liste 2026) + Ribbon-Screenshots v8.0.
Nur umschrieben, keine Übernahme von Text. Markierung: **[nicht im Handbuch]** = Ribbon-Befehl v8.0, den das Handbuch nicht beschreibt; **[nur Video]** = nur in der Knowledge-Base genannt.

## 0. Programm, Oberfläche, Einstellungen
- Dateien: Neu, Öffnen (.stl .obj .ply .ptx .e57 .qsf, Ribbon auch .svg), Scan importieren (zusätzlich in Szene), CAD importieren (.stp/.step/.igs/.iges), Speichern/Speichern unter (.qsf), Export (STEP, IGES, druckfertige STL), Sichtbare Scans exportieren.
- Import-Dialog fragt Einheiten je Datei; Mesh-Eigenschaften (Punkte, Dreiecke, Maße) per Rechtsklick > Properties.
- .ptx-Import (Punktwolke langreichweitiger Scanner): Einheit (Standard m), Triangulierung max. Kantenlänge Auto/Custom; mehrere Scans pro Datei werden zu einem Netz.
- Optionen (Settings > Options): Navigationsschema wie andere CAD-Programme (mit Maus-Vorschau), Drehverhalten Strg/Alt+Pfeile, Rotationsmethode (relativ zur Ansicht / um Welt-Z), Farbschema + Compare-Farben, Punktzahl für Darstellung beim Drehen, grob/fein Tessellierung, Hardware-Rendering an/aus, Auto-Backup alle n min (.qsfbak), Speichern-Nachfrage, Bildschirm-Hilfe an/aus, „All to defaults".
- Undo/Redo: laut Handbuch nur EIN Schritt, nicht für alle Funktionen.
- Rebuild: gesamte History (Feature-Baum) neu durchrechnen (parametrisch).
- Ansichtswürfel oben rechts: Klick auf Seite/Pfeile, Hover-Menü Standardansichten, Koordinatensystem zeigen.
- Navigation: Zoom Mausrad, Pan Strg+Rad, Rotieren rechte Maus; Kontextmenü überall per Rechtsklick (kontextabhängig).
- Schnellleiste („quick toolbar"/Shortcut-Buttons) erscheint bei Selektion eines Objekts (z. B. Extrude, Revolve, Fillet, Cut, Combine).
- Einheiten je Projekt: mm / m / inch. Sprache. Lizenz aktivieren (MAC-gebunden, online oder per E-Mail-Schlüssel), Lizenz verwalten/übertragen.
- Hilfe: Video-Tutorials (online), Update-Prüfung (nur gleiche Hauptversion, kein Auto-Update), System Log (Windows/GPU/Seriennr.), Credits, About; Beispieldateien über Help > Example Files.

## 1. Basisoperationen am Scan
- Mesh-Auswahl (Mesh Edit / Selection-Werkzeuge): Zauberstab (Magic Wand, Winkel-Empfindlichkeit), Freihand gefüllt (Pinsel, Größe Strg+Rad, Alt+Ziehen = abwählen), Freihand, Linie zeichnen, Rechteck, Kreis, „Select through" (durch das Netz statt nur Sichtbares).
- Gradzahl-Regler (Empfindlichkeit, auch Strg+Rad), Auswahl vergrößern/verkleinern, Isolieren, Ausgewählte verbergen, Alles zeigen, Auswahl umkehren, Alles abwählen.
- Quick-Tools-Dialog beim Klick ins Netz (abschaltbar).
- Auswahl speichern (Selection Status) als benannter Unterknoten des Netzes; später per Doppelklick wieder aktivieren.
- Primitive extrahieren (Extract Primitives): Bereich wählen → Typ Ebene/Zylinder/Kegel/Kugel → Vorschau → Create; Best-Fit über gewählte Dreiecke.
  - Analysis-Checkbox: Abweichungs-Farbkarte des Fits.
  - Bedingungen beim Extrahieren: Not constrained, Senkrecht zu Ebene, Parallel zu Zylinder, Koaxial (Coincident axes), Parallel zu OXY/Achsen usw.
  - Auto Constrain: Neigungstoleranz (Grad) + Koinzidenz-Toleranz (mm) → schnappt automatisch parallel/koaxial zu KS oder anderen Primitiven.
  - „Solid"-Option (Zylinder/Primitiv oben/unten geschlossen) für spätere Booleans.
- Primitive konstruieren/bearbeiten (Construct):
  - Ebene: Type-in (Koordinaten, Offset, Rotation) / From another plane (parallel + Tilt/Rotate/Offset) / Constructed: Mittelebene aus 2 Ebenen, Senkrecht zu Primitiv, aus 2 Primitiven, durch 3 Punkte; „Align to world axis".
  - Zylinder: Type-in / From another cylinder/axis (koaxial + Durchmesser), Solid-Option.
  - Kegel: nur Type-in. Kugel: Type-in / From another sphere.
  - Ebene/Zylinder/Kegel aus gewählter CAD-Fläche (nur wenn Fläche analytisch passt).
  - Interaktiv: Griffe zum Vergrößern, Drehen, Parallel-Verschieben; Doppelklick = Edit-Dialog; Lock (nur noch Größe änderbar, „Locked" im Baum); Ein-/Ausblenden über Baum-Checkbox.
- Symmetrieebene: Ebene aus Freihand-markierten Punkten oder „Define Interactive" (Linie ziehen) → Rebuild optimiert, gespiegelte Punkte gelb live; Pfeile/Drehgriffe, Drag Strength, X/Y/Z/Offset-Felder, Analysis-Farbkarte.
- Fit Surface (NURBS-Fläche aus Netzauswahl): U×V Kontrollpunkte (Start 10×10, max 50×50), Apply, Analysis, Orientierung (Selection bounds / Achsen), Glättungsregler, Automatic Fit nach Zieltoleranz.
- Referenzgeometrie:
  - Referenzlinie: Type-in (Start/End, Pick from scan), Constructed aus 2 Primitiven (Ebene∩Ebene, Zylinderachse auf Ebene projiziert, Transversale zw. 2 Zylindern/Linien), From another primitive (Mittel-/Durchschnittsachse mehrerer Zylinder); Länge per Griffe.
  - Referenzpunkt: Type-in, Linienmitte, aus Primitiven (Schnitt), Schnitt dreier Ebenen.

## 2. Ausrichtung (Align)
- Align by Coordinate System: Primär-/Sekundär-/Tertiär-Feature picken (Punkt, Linie, Achse, Ebene, Kugel…), Zuordnung der KS-Ebene wählbar (OXY/OYZ/OXZ), Flip je Achse, gesperrte Achsen schwarz dargestellt, Zusatz-Translation X/Y/Z, Apply/Reset.
- Align Interactive: Manipulator (Pfeile = schieben, Bögen = drehen, Viereck = frei bewegen), numerische Dreh-/Schiebeschritte, Drag Strength, „As Current View" (aktuelle Bildschirmlage = KS), „Show mirrored mesh" (Spiegelung an OYZ mit gelben Punkten als Symmetriehilfe, Drehung in 1°-Schritten).
- By N Points: ≥3 korrespondierende Punkte in gleicher Reihenfolge auf Scan und Ziel (Scan oder CAD), Remove last/all, Preview, OK.
- Fine Align (Referenznetz an CAD/Scan): ICP-artig mit Suchtoleranz (Standard 3 mm); optional nur vorher markierte Bereiche („areas of interest") verwenden.
- Global Fine Align: alle grob ausgerichteten Scans gleichzeitig gegeneinander optimieren (Suchtoleranz).

## 3. 2D-Skizze
### 3a. Schnitt erzeugen (2D Sketch-Dialog)
- Modus „For Extruded Surface": Schnittebene OXY/OYZ/OXZ, aus Primitiv picken oder interaktiv (2 Klicks), Offset ziehen/tippen; weiße = Schnittpunkte, graue = projizierte Punkte.
- Modus „For Revolved Surface": Schnittebene dreht um wählbare Achse (X/Y/Z oder gepickter Zylinder); legt automatisch Konstruktionslinie als Drehachse an.
- Optionen: Create Sketch on slicing plane (an/aus = auf Schnittebene vs. auf Bezugsebene projiziert), Outline mesh (Umriss/Silhouette des gesamten Netzes projiziert, „Ignore small segments"), Through selection only, Stacked sections (n Schnitte, Bereich über 2 Griffe, alle in eine Skizze projiziert; bei Revolve über 360° verteilt).
- Multiple sections (Ribbon): Serie paralleler Schnitte – Ebene, Offset, Abstand; Kurven direkt als Freiformkurven („Approximate within" Toleranz / „Build with" n Punkte), oder entlang Leitkurve; Ergebnis je Schnitt als eigene Skizze (Basis für Loft).
### 3b. Skizzen-Editor (Edit Sketch)
- Elemente: Linie, Kreis (3 Punkte / Mittelpunkt+Radius), Bogen (3 Punkte), Tangentenbogen zwischen 2 Linien (Radius eingeben), Freiformkurve/Spline (Klickpunkte, Doppelklick Ende), Rechteck, Langloch (Slot), Sechseck (über Fit-Modus), Punkt; Bogen per Symbol zu Vollkreis machen.
- Anzeige-Schalter: Control points, Mesh points (Scanpunkte), Constraints (Auto-Fangen), Dimensions (Maße automatisch), Toleranced (Element grün/rot gegen Scanpunkte, Toleranz + Pass/Fail oder Gradient).
- Fitten aus Punkten: Shift+Ziehen um Punktwolke → Best-Fit Linie/Bogen (achsparallel, wenn innerhalb Toleranz); Kontextmenü „Modify".
- Fit Primitives-Modus (Pinsel): Bereiche anmalen → Linie, Bogen, Kreis, Rechteck, Slot, Hexagon; mehrere getrennte Bereiche zu EINEM Kreis; Pinselgröße, Alt = abwählen, „Instant fit", Auto-Fillet mit Mindestradius.
- Splines fitten: „Approximate within" (Toleranz) oder „Build with" (Punktzahl); Rebuild curve (mehr/weniger Kontrollpunkte); Tangenz über Verschieben des End-Kontrollpunkts.
- Auto Sketch: erkennt automatisch Linien (orange) und Bögen (weiß) nach Krümmung; Regler Merge section polygons (Lücken überbrücken mm), Segmentation, Data Noise; Preview/Reset; Lücken manuell als Linie anmalen; Create.
- Corner Trim (Ecken schließen): Corner trim (verschneiden), Auto Fillet (Radius automatisch, optional Maß anfügen), Fixed size fillet; Bedienung Shift+Ziehen über Ecke. Schnellweg ohne Modus: Strg+Ziehen über Ecke = Schnitt, nochmal = Rundung; Rundung per Ziehen anpassen.
- Trim: mit gedrückter Maustaste über unnötige Teile „radieren".
- Weitere Kontextmenü-Ops: Break/Extend, Undo, Delete, Rebuild curve, For construction (Hilfslinie gestrichelt).
- Bedingungen (Constraints): Horizontal, Vertikal, Tangential, Parallel, Senkrecht, Symmetrisch (zu Konstruktionslinie), Fixieren, Koinzident/Snap der Endpunkte (blau = verknüpft, orange = frei), Bedingung löschen = Entkoppeln. Große Symbole = anwendbar, kleine = aktiv. Mehrfachauswahl mit Strg + Rechtsklick > Constraints.
- Maße (Dimensions-Modus): Radius (Klick auf Bogen), Abstand Punkt–Punkt (schräg/horizontal/vertikal je nach Maßlinienlage), Linienlänge, Winkel zwischen 2 Linien; Doppelklick auf Maß = ändern; Tipp-Video zu Radius vs. Durchmesser.
- Offset: Einzelelement oder ganze Kette (Doppelklick wählt Kette), Abstand, Flip, Eckenabschluss Arc oder Intersection.
- Mirror: Auswahl + Konstruktionslinie → gespiegelte Kopie (ohne Symmetrie-Bedingung).
- Duplicate selected (Kopieren, nicht parametrisch): Linear (Achse oder gepickte Linie, Instanzen inkl. Original, Abstand oder Pfeil ziehen, Flip), Grid (Direction 2), Circular (um Ursprung oder gepickten Punkt, Instanzen, Angle to fill, Retain original orientation).
- Mesh Outline (Umriss statt Schnitt, siehe 3a).
- Project other sketches [nur Video], Individual sketches [nur Video].
- Export aus Skizze: DXF R12/R14 (R14 mit Splines; immer mm), IGES (empfohlen), direkt an SolidWorks (Live-Transfer), Inventor.

## 4. CAD-Features
- Extrude (aus Skizze, Kreis-Symbol „Extruded" oder Schnellleiste): Solid/Surface-Schalter, Depth 1 (oben) + Depth 2 (unten) getrennt (= beidseitig, je ≥0, ziehen per gelbem Pfeil), Draft angle (Verjüngung), Skizze auf Top/Bottom plane verlegen, Advanced „Optimise to selected points" (Ober-/Unterseite einmalig auf markierte Netzbereiche fitten), Snapping (Live-Farbabgleich zum Netz, Andocken an Netzebenen). Kein „Up to surface" im Handbuch.
- Extrude 3D Sketch: Richtung Average plane / X / Y / Z.
- Revolve: Achse picken (oder automatisch die einzige Konstruktionslinie); Full / Partial mit Angle 1 + Angle 2 (Griffe), Inverse (Gegenseite), Snapping-Farbanzeige; Skizze ändern → Feature aktualisiert.
- Trim (manuell): mehrere Objekte wählen → Teilflächen anklicken zum Entfernen; Statusanzeige „Multiple surfaces → Single surface/Solid body"; Reset trim, Show shapes wireframes, Sichtbarkeitsliste je Körper, Swap visible; editierbar im Baum.
- Automatic Trimming (im Trim-Dialog): Tolerance + Regler „Overlap with reference mesh" → entfernt Flächenteile ohne Scan-Überdeckung.
- Combine selected solids (Vereinigung), Cut from selected solid (Subtraktion, mehrere Werkzeuge, auch Pattern als Werkzeug – parametrisch nachgeführt), Intersection of selected solids.
- Fillet / Chamfer: Kante per Hover/Klick, Radius tippen oder Pfeil ziehen, Preview, Reset; Toleranced (Live-Abweichung zum Scan zur Radiusfindung); mehrere Kanten mit Strg auf einmal. Keine variable Rundung im Handbuch.
- Circular pattern (Körper): Achse (X/Y/Z oder gepicktes Objekt/Zylinder), Instanzen, Angle to fill, Flip rotation (<360°), editierbar.
- Linear pattern: Richtung (Achse, Zylinder, Referenzlinie), Instanzen, Spacing, Flip, Direction 2 = Raster.
- Mirror (Körper): an Standardebene oder Benutzerebene/Fläche; Original + Spiegelung werden automatisch verschmolzen.
- Move Body: Manipulator, Drag Strength, numerische Dreh-/Schiebeschritte, „Create copy" (Kopie bleibt parametrisch mit Original verknüpft), Reset.
- Thicken/Offset (CAD-Fläche), Delete Faces (Flächen anklicken und löschen), Sew selected surfaces (Flächen zu Hülle/Solid vernähen).
- Helix (Gewinde): Achse (X/Y/Z oder CAD-Zylinderfläche picken), Steigung tippen oder „Measure Pitch" (2 Punkte), Start-/Endpunkt picken, Auto Adjust, Pitch diameter; Extend Start/End: Straight / Natural (eine Windung mehr) / Radial in / Radial out + Größenregler → dann Sweep mit Profil (Solid) und Combine.
- Move face [nur Video, nicht im Handbuch].

## 5. Surfacing / 3D-Skizze
- 3D Sketch: Add curve (Klick-Ziehen-Klick, Doppelklick/Rechtsklick Finish, Remove last), Modify mit Manipulator Local (Tangente) / World / Screen, Drag Strength; Snap Mode ON = Punkte auf Netz.
- Blend Curve: tangentiale Verbindungskurve zwischen zwei Kurven, Griffe für Radius, bleibt verbunden.
- Kurven-Ops: Join curves, Break curve, Rebuild curve (n Punkte, auf Netz fangen), Fit on surface / Don't fit (interne Punkte automatisch auf Netz), Delete internal points, Punkt einfügen per Doppelklick, Delete.
- Anzeige: Mesh Offset / Transparent (Regler), Toleranced Display (Toleranz, Pass/Fail / Gradient).
- Kurvennetz (Grid network) für Flächen; 3D-Skizze speicherbar/exportierbar.
- Loft: Schnitte manuell nacheinander oder alle vorher gewählt (automatisch); Solid, Ruled, Edge chain, Expand by (mm, zum späteren Trimmen).
- Sweep: Leitkurve + Profil, Solid-Option.
- Pipe: Leitkurve/Kette + Radius, Edge chain, Solid (Enden geschlossen), Reset.
- Fill Surface: Randkurven per Edge chain oder einzeln (als „Contact" nummeriert), Pick internal curves, Restart, Remove last, Planar surface, Untrimmed surface (überstehend), Surface degree, Smooth (tangentialer Übergang an innerer Kante), On Scan Data (auf Netz projiziert/gefittet), Options = U/V-Punkte wie Fit Surface; aktualisiert sich bei Skizzenänderung.
- Blend Surface: Übergangsfläche zwischen zwei Flächen durch Anklicken der benachbarten Randkurven (nur im Handbuch, nicht im v8-Ribbon sichtbar).
- Extend Surface: Ränder nummeriert, je Seite Betrag per Griff/Feld.
- Flatten [nur Video] (Fläche abwickeln), Roll/Unroll [nur Video, Workshop].

## 6. Freiform-Modellierung (SubD-Quads)
- New Freeform → Edit-Surface-Dialog: Add Face (4 Klicks), Add Rectangular face.
- Auswahlmodus: Points/Edges, Points only, Edges only, Faces only, Point/Edge/Face, Boundary (ganze Randkette).
- Manipulator-KS: World / Screen / Local; Doppelklick auf Kante = ganze Kantenkette.
- Duplicate Handle „D": an Kante ziehen = neue Quad-Reihe; alternativ Alt+Pfeil ziehen (Extrude der Kette, seitlich verschiebbar); Strg+Alt+graues Quadrat = tangentiale Verlängerung.
- Control Net anzeigen/bearbeiten; „Don't move neighbours".
- Anzeige: Shaded, Toleranced (Toleranz, Pass/Fail/Gradient), Zebra (Breite/Farbe); Mesh Offset/Transparent; Leertaste = nur Fläche ohne Quad-Netz.
- Symmetrie: Ebene OXY/OYZ/OXZ, Spiegelseite live; „Set on Symmetry Plane" (Mittelkante auf Ebene fixiert, stetiger Übergang); Abschalten mit Rückfrage Symmetrie-Bezug behalten.
- Snap Mode ON/OFF; Snapping type Closest Point / Ray Projection (seit 5.0.54; bei Löchern/verborgenen Bereichen); Kontextmenü Snap to Mesh / Snap all to the mesh.
- Irreguläre Punkte (Extraordinary vertices) rot markiert; Klick auf Hinweis repariert automatisch.
- Bridge Edges (zwei Kantenketten gleicher Anzahl verbinden), Merge (Kante auf Kante ziehen bis „Merge").
- Split (Kante wählen, Taste S: Kontrollschleife einfügen).
- Smooth: Kette automatisch (Taste Q wiederholt) oder Pinsel Strg+Shift+Ziehen (Radgröße), „Brush Smooth"-Werkzeug.
- Increase Resolution (jedes Quad → 4).
- Align Horizontally / Vertically (Kantenkette an Hilfssegment ausrichten).
- Crease auf Kante/Kette und auf Punkt; Remove Crease (auch für ganze Auswahl).
- Hide selected / Isolate / Show hidden (für große Quad-Netze).
- Offset der Freiformfläche (im Options-Menü), Copy, Flip (Orientierung, farbig sichtbar), Merge mehrerer Quad-Flächen (Baum-Rechtsklick).
- Wrap Surface: Zylinder auf Netzauswahl fitten → Quadraster; Details Low/Medium/Fine.
- Auto Freeform (Auto Surfacing): Ziel-Quadzahl Low 1000 / Medium 2000 / Fine 4000 / Custom, Feature Details (… Balanced … Highest), Symmetrieebene, Preview; für organische, wasserdichte Netze.
- Thicken Free Form: Dicke + Outward; Alternativ-Workflow Schale: Kopie → Offset → glätten → Original flip → Merge → Bridge (mit Crease für scharfe Kante).
- Slicing: Freiform mit konstruierter Ebene trimmen → geschlossener Körper.
- Convert to CAD body (für CAD-Kernel-Ops).
- Template: Quad-Fläche als Vorlage speichern / laden (auf neuen Scan übertragen).
- Export: nur Patchgrenzen (weiße Linien) werden zu Flächen, wenige große NURBS-Patches statt je Quad.
- Tipps-Videos: Freiform verlängern, Offset Freiform (auch bis zu anderen Primitiven) [nur Video].

## 7. Mesh-Bearbeitung
- Reduce Polygons: Ziel Dreiecke oder %, Preview, „Deviation of original mesh" (Toleranz, Statistik, gelbe Ausreißer), Keep original mesh / ersetzen.
- Edit-Dialog: Ränder/Probleme schwarz, Zauberstab, Select through, Isolate, Hide, Invert, Delete selected, Smooth selected (entrauschen), Show mesh wireframe.
- Individual meshes (Zähler): Navigation mit Pfeilen, X = löschen, Cleanup nach max. Dreiecksanzahl oder Fläche kleiner als (Messen per Kreis-Aufziehen), „Leave selected only".
- Holes (Zähler): einzeln navigieren, Fill selected hole (auch Doppelklick), Fill all holes of this size (Messwerkzeug), Expand (Nachbardreiecke entfernen), Smooth (Rand rund), Algorithmen Automatic / Tangent / Curvature (<40 Kanten → Tangent), Fill semi-hole (Loch per Linie teilen, Strg-Kürzel), Bridge (zwei Ränder verbrücken, Shift-Kürzel), Randglättung.
- Split mesh: mit anderem Körper/Netz trennen, Cut (nur Solids, Loch exakt ausschneiden), Combine (Netz + Solid vereinigen); Preview; „Defeaturing"-Workflow (Bohrung löschen, füllen, mit Zylinder neu schneiden).
- Split Mesh with 3D Sketch, Boundary Edit, Fill Mesh Holes [Video].
- Scale (gleichmäßig/ungleichmäßig), Flip normals, Hide selected, Show hidden, Set default color, Auto colorize, Export visible.

## 8. Mehrteilige Projekte
- Mehrere Scans importieren (File > Import Scan Data), je Scan Farbe setzen/Default color, ein-/ausblenden.
- Ausrichten: Interactive → N Points → Fine Align → Global Fine Align.
- Merge (Rechtsklick, irreversibel, überlappende Netze bleiben getrennt), Re-polygonize (neues wasserdichtes Einzelnetz, Suchtoleranz z. B. 0,5–0,6 mm).

## 9. Werkzeuge / Objektbaum
- Baum: Checkbox = sichtbar, Rechtsklick-Menü (Edit, Delete, Copy, Merge, Flip, Color, Properties, Extrude …), Doppelklick = bearbeiten.
- Ansichten: chronologisch oder Parent-Child, Expand all / Collapse all.
- Disable All Next / Enable to Here (History-Rollback, deaktivierte kursiv; Rebuild nur bis dort).
- Alles parametrisch: Änderung an Skizze/Primitiv/Pattern rechnet abhängige Features (Cut, Copy, Revolve) nach.

## 10. Analyse
- Compare (Scan vs. CAD): Toleranz, Farbskala, schwarz = außerhalb, Hover zeigt Abweichung, Klick setzt Wertelabel (für Berichte), Clear labels.
- Compare to other meshes (Netz gegen andere Netze).
- Measure (Abstand 2 Punkte auf Scan).
- Zebra Stripes: Streifenbreite, horizontal/vertikal, Farbe.
- Environment Map (Reflexions-Texturen für Flächengüte/Präsentation).
- Draft (Entformungsschrägen): Referenz (KS-Ebene/Primitiv), Flip direction, Winkel, Farben rot/gelb/grün anpassbar.
- Straightness (Fertigungsrundung): Nachkommastellen für Position, Neigungswinkel, Durchmesser → Primitive gelb/grün, Hover-Warnung (nur Handbuch, nicht im v8-Ribbon).
- Snapshot to clipboard.

## 11. Export
- STEP (Solids und Freiform), IGES; STL druckfertig; Skizzen DXF R12/R14 / IGES; sichtbare Scans exportieren.
- QSConnect SolidWorks: Live-Übertragung des parametrischen Baums (Map Z→Y, Pause nach jedem Trim zur Prüfung, Freiform als externe IGES, abschließend Knit zu Solid geführt), Sketch-Transfer mit Live-Update.
- QSConnect Autodesk Inventor: Ein-Klick-Übertragung parametrisch, Änderungen nachgeführt.

## 12. Ribbon v8.0 – Abgleich mit Handbuch
Markierung **✗** = im Handbuch nicht beschrieben (Name/Funktion fehlt), (✓) = nur unter anderem Namen/indirekt.

- Main: Open, Save, Prepare Scan **✗**, Edit Scan (✓ Mesh Edit), Deselect All, Extract primitives, Construct, Align, 2D Sketch, Multiple sections (✓ nur kurz bei Loft), Fit Surface, Surfacing, New Freeform, Auto Freeform (✓ Auto Surfacing), Extrude, Revolve, Move face **✗**, Trim, Pattern, Fillet/Chamfer, Compare, Export.
- Edit/View: Undo, Redo, Rebuild, Zoom to fit **✗**, Isometric/Top/Bottom/Left/Right/Front/Back (✓ Würfel), Coordinate System, Background Linear/Studio **✗**.
- Scan Data: Edit, Deselect All, Show Hidden, Invert Hidden **✗**, Reduce polygons, Reduce noise **✗** (nur „Smooth selected"), Scale, Flip Normals, Re-polygonize, Average Mesh **✗**, Mirror (Mesh) **✗**, Unroll **✗** (Video Roll/Unroll), Align by Coordinate System, Align Interactive, By N points, Fine-align, Global Fine Align, Auto colorize, Set Default Color, Export visible.
- Construct: Extract primitives, Plane, Middle plane (✓ als Option „Constructed"), Plane along path **✗**, Plane through sketch line **✗**, Plane from 2D sketch **✗**, Cylinder, Cone, Sphere, Symmetry Plane, Reference Line, Reference Point, Plane/Cylinder/Cone from CAD.
- Freeform: New Freeform, Auto Freeform, Wrap Surface, From 3D Sketch **✗**, From quad OBJ **✗**, Thicken, Offset (✓ im Edit-Optionsmenü), Convert to CAD body.
- Surfacing: Fit Surface, Loft, Fill Surface, From 2D sketch **✗**, Sweep (✓ nur Gewinde-Beispiel), Pipe, 3D Sketch, Helix, Roll Sketch **✗**, Duplicate Face **✗**, Offset (✓ Thicken/Offset), Thicken, Extend Surface, Sew surfaces (✓ nur Menüzeile), Project sketch **✗**, Flatten **✗** (nur Video).
- CAD: 2D Sketch, Multiple sections, Extrude, Revolve, Trim, Combine, Cut, Intersect, Shell **✗**, Draft (Feature) **✗** (Handbuch nur Draft-Analyse + Extrude-Draftwinkel), Delete faces (✓ nur Menüzeile), Move body, Move face **✗**, Scale body **✗**, Separate bodies **✗**, Split solid **✗**, Fillet/Chamfer, Circular pattern, Linear pattern, Mirror, Export.
- Analysis: Measure, Surface Area **✗**, Volume **✗**, Zebra Stripes, Environment Map, Draft, Snapshot, Compare, Compare to other meshes.
- Settings: Activate Software, Manage license, Millimetres/Inches/Metres, Language, Options. Help: Video Tutorials, Help PDF, Shortcuts **✗**, Examples (✓ Example Files), Check for update, System Log, Reset layout **✗**, Change log **✗**, Credits, About.

## 13. Im Handbuch, aber nicht (sichtbar) im v8-Ribbon
- Blend Surface (Übergangsfläche), Straightness-Analyse, Free-Form-Template speichern/laden, Import CAD / Import Scan Data / Export to SolidWorks/Inventor (Datei-Menü), Hide Selected (Edit), Fill/Bridge/Semi-hole/Split-Mesh (in Edit Scan), Sketch-Copy/Offset/Mirror/Auto Sketch/Corner Trim (im Skizzen-Editor), Bridge/Merge/Crease/Split/Increase Resolution/Align H/V/Smooth (im Freiform-Editor), Disable All Next/Enable to Here (Baum-Kontextmenü).
