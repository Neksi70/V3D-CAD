# Vergleich QuickSurface Pro 8 ↔ V3D Scan 1.3

Stand 21.10.2026. Grundlage: komplette Funktions-Checkliste aus dem QuickSurface-Handbuch (262 S.), der
Video-Wissensbasis und den Menüreitern von v8.0.127 (`docs/quicksurface-funktionen.md`). Nachgebaut wurde nur
nach Funktion und Bedienung – kein Code, keine Dateien von KVS.

Legende: ✔ vorhanden · ◐ teilweise / anders gelöst · ✗ fehlt · – bewusst nicht nötig.
„geprüft“ = Test mit nachgerechnetem Sollwert (Volumen, Maß, Fläche) in `tests/`.

## Zusammenfassung

Gezählt nach Vergleichszeilen (eine Zeile kann eng verwandte Befehle bündeln); „–“ = nicht relevant.

| Bereich | Zeilen | ✔ | ◐ | ✗ |
|---|---|---|---|---|
| Programm / Dateien / Ansicht | 13 | 11 | 2 | 0 |
| Scan-Auswahl + Grundformen | 16 | 12 | 4 | 0 |
| Ausrichten | 6 | 5 | 1 | 0 |
| 2D-Skizze (Schnitt + Editor) | 25 | 22 | 3 | 0 |
| CAD-Features | 22 | 19 | 3 | 0 |
| Flächen / 3D-Skizze | 16 | 11 | 4 | 1 |
| Freiform | 22 | 16 | 6 | 0 |
| Netzbearbeitung + Mehrteile | 16 | 16 | 0 | 0 |
| Verlauf / Objektbaum | 5 | 5 | 0 | 0 |
| Analyse | 10 | 8 | 1 | 1 |
| Export / Übergabe | 6 | 4 | 1 | 1 |
| **Summe** | **157** | **129 (82 %)** | **25 (16 %)** | **3 (2 %)** |

Stand 1.0 zum Vergleich: 156 Zeilen, ✔ 110 (71 %), ◐ 25 (16 %), ✗ 21 (13 %). Hinzu kam die Zeile
„gekoppelter Skizzen-Löser“.

**Kern-Arbeitsablauf (Scan → STEP) vollständig:** Scan laden/bereinigen → ausrichten → Grundformen erkennen →
Querschnitt-Skizze (Auto-Fit, Nennmaß) → Extrudieren/Drehen/Loft → Runden/Fasen → Körper aus Flächen
(automatisches Trimmen) → Abweichung prüfen → STEP/IGES/STL. Freiform: automatisch (G1) oder Käfig von Hand.

**Wo V3D Scan mehr kann als QuickSurface:** mehrstufiges Rückgängig (QuickSurface laut Handbuch nur 1 Schritt),
automatische Geometrieerkennung des ganzen Scans in einem Schritt, „Extrudieren bis Scan“ (Tiefe aus dem Scan),
Radius-Vorschlag aus erkannten Rundungen, Punktwolken-Werkzeuge (Ausreißer, Tisch, Registrierung FPFH/ICP),
Abwickeln mit Verzerrungsangabe + SVG, Skizze auf Zylinder wickeln, Übergabe an V3D CAD.

**Was QuickSurface voraus hat:**
- **Fehlt ganz (✗):**
  - Live-Übertragung an SolidWorks/Inventor
  - KI-Assistent
  - 3D-Kurve nachträglich bearbeiten (Punkt einfügen/verschieben, Join/Break) – heute: neu zeichnen
- **Nur teilweise (◐):**
  - G1 an unregelmäßigen Ecken: halbiert, aber nicht exakt
  - Zieh-Manipulator im Käfig: numerisch statt Griff
  - Mehrsprachigkeit
- **Geometriekern:** Parasolid ist bei schwierigen Booleans und Rundungen robuster als OpenCASCADE. Seit v1.1 fängt eine Rückfallebene
  (Reparatur, Toleranz, Plausibilitätsprüfung) einen Teil davon ab.

## Einzelvergleich

### 0. Programm, Dateien, Ansicht
| QuickSurface | V3D Scan |
|---|---|
| Öffnen/Speichern (eigenes Projektformat) | ✔ `.v3dscan` (ZIP), mit Verlauf, Skizzen, Referenzen, Auswahlen |
| Import STL/OBJ/PLY | ✔ + PCD, XYZ/ASC/CSV, OFF, GLTF |
| Import PTX | ✔ v1.0 (Raster → Netz, Matrix, Farbe) — geprüft |
| Import E57 | ✔ v1.2 eigener Leser (Float/Integer/ScaledInteger, mehrere Scans mit Pose, Farbe/Intensität) — geprüft (Rundreise); echte Scanner-Datei noch nicht |
| CAD importieren (STEP/IGES) | ✔ v1.0 als Körper — geprüft (Rundreise gleiches Volumen) |
| Einheiten mm/inch/m | ◐ Anzeige in Messen + Eigenschaften; intern mm |
| Undo/Redo | ✔ mehrstufig (30 Schritte) — QuickSurface: 1 Schritt |
| Rebuild | ✔ v1.0 (je Körper ↻) |
| Ansichtswürfel / Standardansichten | ✔ v1.2 Würfel oben rechts (Seite anklicken) + Knöpfe + Achsenkreuz |
| Hintergrund Linear/Studio | ✔ v1.0 hell/Studio/dunkel |
| Optionen (Navigationsschemata anderer CADs) | ✔ v1.2 SolidWorks, Fusion/Inventor, Creo/NX/Blender, Mausrad umkehren |
| Auto-Backup | ✔ v1.2 nur nach Änderungen, letzte 5, aus den Optionen ladbar — geprüft |
| Sprache | – nur Deutsch |
| Hilfe/Tastenkürzel/Beispiele | ◐ Tastenkürzel-Dialog, 3 Beispieldateien im Menü (v1.2); keine Videos |

### 1. Scan-Auswahl + Grundformen
| QuickSurface | V3D Scan |
|---|---|
| Rechteck / Freihand (Lasso) / Polygon | ✔ |
| Zauberstab (Winkel-Empfindlichkeit) | ✔ v1.2 Netz über Dreiecke, Wolke über Voxel-Ebenen mit Kantensperre — geprüft |
| Pinsel / Kreis / Linie | ✔ v1.2 — geprüft (Pinsel, Kreis) |
| Select through | ✔ „Durch“ |
| Auswahl vergrößern/verkleinern, isolieren, verbergen | ✔ v1.2 — geprüft |
| Auswahl speichern | ✔ v1.0 „Auswahl merken“ |
| Primitive extrahieren (Ebene/Zylinder/Kegel/Kugel) | ✔ automatisch für den ganzen Scan + manuell — geprüft |
| Bedingungen beim Extrahieren (parallel/senkrecht/koaxial) | ◐ Achsen auf Weltachsen einrasten, Nennmaß |
| Auto Constrain | ◐ Nennmaß-Rundung + Achsen-Einrasten |
| Primitiv als Volumen (Solid) | ✔ „Grundkörper aus Bereich“ |
| Primitiv per Eingabe / aus anderem / interaktive Griffe | ◐ v1.2 per Eingabe (Quader/Zylinder/Kegel/Kugel) — geprüft; Griffe ✗ |
| Symmetrieebene | ✔ automatisch (Spiegel-ICP) — geprüft; interaktiv ✗ |
| Fit Surface (U×V, Auto-Fit nach Toleranz) | ✔ v1.2 Raster oder Toleranz (95 %) — geprüft |
| Referenzlinie (Ebene∩Ebene, Zylinderachse) | ✔ v1.0 — geprüft |
| Referenzpunkt (3 Ebenen) | ✔ v1.0 — geprüft |
| Ebene/Zylinder/Kegel aus CAD-Fläche | ✔ v1.2 Ebene/Achse/Punkt aus angeklickter Körperfläche — geprüft |

### 2. Ausrichten
| QuickSurface | V3D Scan |
|---|---|
| Align by Coordinate System (3-2-1) | ✔ — geprüft (0,002° / 0,004 mm) |
| Align Interactive (Manipulator) | ◐ numerisch (Verschieben/Drehen um Werte) |
| By N Points | ✔ Punktpaare (Kabsch) |
| Fine Align | ✔ ICP 3-stufig, robust |
| Global Fine Align | ✔ Posen-Graph |
| Gespiegeltes Netz als Hilfe | ✔ indirekt über Symmetrieebene |

### 3. 2D-Skizze
| QuickSurface | V3D Scan |
|---|---|
| Schnitt für Extrusion (Ebene, Offset ziehen) | ✔ Welt/Bereich/Referenz + Versatz-Regler live — geprüft |
| Schnitt für Drehung (um Achse) | ✔ „durch Achse“ — geprüft |
| Mesh Outline | ✔ v1.0 Umriss — geprüft |
| Nur durch Auswahl | ✔ v1.0 — geprüft |
| Stacked / Multiple sections | ✔ Mehrfachschnitt (je Schnitt eine Skizze) — geprüft |
| Linie, Kreis (Mitte/3 P.), Bogen 3 P., Rechteck, Langloch, Sechseck | ✔ v1.0 Zeichnen per Klick — geprüft |
| Punkt | ✔ v1.3 Konstruktionspunkt mit Bedingungen (deckungsgleich, auf Linie/Kreis, Abstand, fest), DXF POINT — geprüft |
| Tangentenbogen zwischen Linien | ✔ Ecke runden — geprüft |
| Spline (Freiformkurve) | ✔ v1.2 aus Schnittbereich + durch Klickpunkte — geprüft |
| Auto Sketch (Linien/Bögen erkennen) | ✔ inkl. Rundungen tangential, robust gegen Rauschen — geprüft |
| Fit per Shift-Ziehen / Pinsel-Fit | ◐ Auto-Fit + Element ersetzen/Spline; kein Pinsel |
| Corner Trim / Auto-Fillet | ✔ automatisch beim Einpassen + Ecke runden |
| Trim (radieren), Break/Extend | ◐ Element entfernen → Gerade; Trennen + Verlängern ✔ v1.2 — geprüft |
| Hilfslinien (Construction) | ✔ v1.0 — geprüft |
| Bedingungen waagrecht/senkrecht/parallel/rechtwinklig | ✔ — geprüft |
| Gekoppelte Bedingungen + Maße (Constraint-Solver: gleich, tangential, konzentrisch, symmetrisch, fest, Länge/Radius/Abstand/Winkel, über Konturen) | ✔ v1.1 eigener Löser, gespeichert, Widerspruch wird gemeldet — geprüft |
| Tangential / symmetrisch / fixieren, gekoppelter Solver | ✔ v1.1 eigener Löser — geprüft |
| Maße: Radius, Abstand, Länge, Winkel | ✔ v1.0 (treibend) — geprüft |
| Offset (rund/spitz) | ✔ — geprüft (Formel exakt) |
| Mirror | ✔ |
| Copy linear / Raster / kreisförmig | ✔ — geprüft |
| Toleranz-Anzeige Skizze ↔ Scan | ✔ Abweichung je Kontur |
| Export DXF | ✔ v1.0 R12 — geprüft |
| Export IGES (Skizze) / Live an SolidWorks | ◐ IGES ✔ v1.2 — geprüft; Live an SolidWorks ✗ |
| Skizze nachträglich bearbeiten | ✔ v1.0 (Doppelklick), Körper rechnen nach — geprüft |

### 4. CAD-Features
| QuickSurface | V3D Scan |
|---|---|
| Extrude Depth 1/2, Solid/Surface | ✔ beidseitig, als Fläche — geprüft |
| Draft angle | ✔ — geprüft (Pyramidenstumpf exakt) |
| Optimise to selected points / Snapping | ◐ „bis Scan“ (Tiefe automatisch aus dem Scan) |
| Revolve full/partial, Angle 1/2 | ✔ — geprüft |
| Trim manuell | ◐ Mit Fläche schneiden, An Ebene schneiden |
| Automatic Trimming | ✔ Körper aus Flächen (Zelle mit bester Scan-Deckung) — geprüft |
| Combine / Cut / Intersect | ✔ — geprüft |
| Fillet / Chamfer, mehrere Kanten | ✔ Kanten per Klick — geprüft |
| Fillet mit Live-Abweichung | ✔ v1.2 Vorschau zeigt Abweichung zum Scan im Rundungsbereich (R3-Probe: 0,00 mm, R2/R4 ≈ 0,3) — geprüft |
| Circular / Linear / Raster-Pattern | ✔ — geprüft |
| Mirror (verschmolzen) | ✔ — geprüft |
| Move Body / Copy | ✔ (Kopie nicht parametrisch verknüpft) |
| Thicken / Offset | ✔ |
| Delete Faces | ✔ v1.0 (Defeaturing) — geprüft (Rundungen weg → Quader exakt) |
| Sew surfaces | ✔ v1.0 — geprüft |
| Helix / Gewinde | ✔ v1.0 Außen-/Innengewinde ISO-Profil — geprüft; Measure Pitch ✔; Endverlängerungs-Arten ✗ |
| Move face | ✔ v1.0 — geprüft |
| Shell | ✔ offen/geschlossen — geprüft |
| Draft (Feature) | ✔ v1.0 — geprüft |
| Scale body | ✔ gleichmäßig/je Achse — geprüft |
| Separate bodies | ✔ — geprüft |
| Split solid | ✔ an Ebene (beide Teile) / mit Fläche — geprüft |

### 5. Flächen / 3D-Skizze
| QuickSurface | V3D Scan |
|---|---|
| 3D Sketch auf dem Netz | ✔ v1.0 (Klick, Spline/Linienzug, offen/zu) — geprüft |
| Kurve bearbeiten (Manipulator, Punkt einfügen, Rebuild, Join/Break) | ✗ (neu zeichnen) |
| Blend Curve | ✔ v1.2 Übergangskurve, tangential an beiden Enden — geprüft |
| Loft (Solid/Ruled) | ✔ — geprüft; Expand ✗ |
| Sweep / Pipe (hohl) | ✔ — geprüft; Pfad auch 3D-Skizze |
| Fill Surface (tangential, auf den Scan) | ✔ v1.0 — geprüft; innere Kurven ✗ |
| Blend Surface | ✔ v1.0 Übergangsfläche G1 — geprüft |
| Extend Surface | ◐ alle Ränder gleich (nicht je Seite) |
| Offset / Thicken | ✔ |
| Duplicate Face | ✔ v1.0 |
| Project sketch | ✔ v1.0 (Fläche beschneiden) — geprüft |
| Roll Sketch | ✔ v1.0 Skizze auf Zylinder wickeln — geprüft (exakt) |
| Flatten | ✔ Abwickeln, längentreu/konform, SVG — geprüft |
| Extrude 3D Sketch | ✔ v1.0 — geprüft |
| Plane along path / through sketch line / from 2D sketch | ✔ v1.0 |
| Surface from 2D sketch | ◐ Extrudieren „nur als Fläche“ |

### 6. Freiform
| QuickSurface | V3D Scan |
|---|---|
| Auto Freeform (Quad-Anzahl frei, Feature-Details) | ✔ Instant Meshes + B-Splines, G1, scharfe Kanten erkannt — geprüft (Torus 95 % < 0,02 mm, Knick ⌀ 0,15°) |
| New Freeform (Fläche/Rechteck) | ✔ Raster-Käfig auf Auswahl + Einzel-Vierecke per 4 Klicks (v1.2) |
| Wrap Surface | ✔ v1.0 — geprüft |
| Snap an Netz (Closest / Ray) | ✔ beides intern |
| Ecken ziehen | ✔ Maus über den Scan |
| Kanten/Flächen wählen, Manipulator World/Local, Extrude-Handle „D“ | ◐ v1.2 Wahl + numerisch Welt/Normale + Extrudieren; Zieh-Manipulator ✗ |
| Bridge / Merge (Kante auf Kante) | ✔ v1.2 — geprüft |
| Split (Schleife einfügen) | ✔ v1.2 — geprüft |
| Increase Resolution | ✔ |
| Smooth (Kette/Pinsel) | ✔ v1.2 Pinsel + global |
| Align H/V | ◐ v1.2 Ausrichten auf Gerade (erste→letzte Ecke) |
| Crease Kante/Punkt | ◐ Kanten per Klick; Punkt-Crease ✗ |
| Symmetrie / Set on Symmetry Plane | ✔ v1.0 — geprüft |
| Unregelmäßige Ecken anzeigen/reparieren | ◐ v1.2 anzeigen ✔; G1-Restknick dort halbiert (Torus 16,6° → 8,5°); exakt G1 dort mit bikubisch nicht möglich |
| Hide / Isolate | ✔ v1.2 |
| Offset / Thicken / Flip | ✔ / ✔ / ✔ (v1.2 Käfig umdrehen) |
| Merge Quad Surfaces / wenige große Patches | ◐ Raster-Käfig „als eine Fläche“ |
| Slicing | ✔ An Ebene schneiden |
| Convert to CAD body | ✔ automatisch (geschlossen → Volumen) |
| Templates speichern/laden | ✔ v1.0 (JSON) |
| From quad OBJ | ✔ v1.0 |
| From 3D Sketch | ◐ Fläche füllen in geschlossene 3D-Skizze |

### 7. Netzbearbeitung + Mehrteile
| QuickSurface | V3D Scan |
|---|---|
| Reduce polygons (mit Abweichungsstatistik) | ✔ v1.2 Median/95 %/max |
| Edit / Löschen / Smooth selected | ✔ |
| Individual meshes / kleine Inseln | ✔ |
| Löcher füllen (Automatic/Tangent/Curvature) | ✔ flach/gewölbt — geprüft |
| Fill semi-hole / Bridge | ✔ v1.3 Bucht zwischen 2 Randpunkten füllen (flach/gewölbt), Brücke teilt ein Loch — geprüft |
| Split mesh mit Körper / Cut / Combine | ✔ v1.0 teilen/abziehen — geprüft |
| Split Mesh with 3D Sketch | ✔ v1.2 geschlossene 3D-Skizze teilt das Netz (dreiecksgenau) — geprüft |
| Scale / Mirror / Flip normals | ✔ v1.0 (Umlauf + Normalen korrekt) — geprüft |
| Reduce noise | ✔ Glätten (Taubin/Laplace) |
| Average Mesh | ✔ v1.0 Mittelwert-Netz |
| Re-polygonize | ✔ Netz aus Punktwolke (Poisson/Ball Pivoting) |
| Unroll | ✔ v1.0 Abrollen — geprüft |
| Auto colorize / Default color | ✔ Farbmodi |
| Export visible | ✔ |
| Mehrere Scans, Merge, Global Align | ✔ — geprüft |
| Boundary Edit | ✔ v1.3 Rand glätten, Zacken entfernen, Rand verlängern (an einspringenden Ecken kurz halten) — geprüft |

### 8. Verlauf / Objektbaum
| QuickSurface | V3D Scan |
|---|---|
| Chronologischer Baum / Parent-Child | ✔ Verlauf je Körper; Parent-Child ◐ |
| Disable All Next / Enable to Here | ✔ v1.0 — geprüft |
| Parametrisch: Skizze ändern → Features rechnen nach | ✔ v1.0 — geprüft (Ø12 → Ø20, Rundung bleibt) |
| Rebuild | ✔ |
| Eingefrorene Schritte | ✔ fester Zwischenstand (Freiform, Kombination …) |

### 9. Analyse
| QuickSurface | V3D Scan |
|---|---|
| Compare Scan ↔ CAD (Toleranz, Farbskala, Wertelabels) | ✔ + Kennwerte (Mittel, σ, RMS, % in Toleranz) — geprüft |
| Compare to other meshes | ✔ (Scan ↔ Scan) |
| Measure | ✔ v1.0 Abstand/Winkel/Kreis — geprüft |
| Surface Area / Volume | ✔ |
| Zebra (Breite, Richtung) | ✔ |
| Environment Map | ✔ v1.0 |
| Draft-Analyse | ✔ |
| Straightness (Rundungs-Hinweise) | ◐ Nennmaß-Anzeige je Bereich |
| Snapshot | ✔ (PNG-Datei statt Zwischenablage) |
| KI-Assistent (Gemini → Video-Tipps) | ✗ |

### 10. Export / Übergabe
| QuickSurface | V3D Scan |
|---|---|
| STEP / IGES | ✔ — geprüft |
| STL druckfertig | ✔ v1.0 — geprüft |
| DXF (Skizzen) | ✔ v1.0 |
| Sichtbare Scans exportieren | ✔ |
| QSConnect SolidWorks / Inventor (Live-Baum) | ✗ |
| Übergabe an eigenes CAD | ◐ v1.2 Bauplan (Befehlsfolge, parametrisch) – in V3D CAD nachgebaut und Volumen geprüft; Import-Knopf in V3D CAD wartet auf Freigabe |
| Lizenz/Aktivierung | – |

## Offene Punkte nach Nutzen
Erledigt in v1.1/v1.2 (21.10.26):
- Skizzen-Löser, Break/Extend, Klick-Spline
- Freiform-Editor
- Auswahl-Werkzeuge
- G1 an Ecken verbessert
- Bauplan für V3D CAD
- E57-Import
- Navigationsschemata
- Auto-Sicherung

Noch offen:
1. Import-Knopf „Bauplan öffnen“ in V3D CAD (Änderung an der Produktion, wartet auf Freigabe)
2. Zieh-Manipulator (Griffe) für Käfig-Ecken, Grundkörper-Griffe
3. Exaktes G1 an unregelmäßigen Ecken (Gregory-Flächen oder Unterteilung)
4. E57-Gegenprobe mit einer echten Scanner-Datei

**Wichtigster nächster Schritt unabhängig von der Liste: Test mit echten Scans (MIRACO).** Alle Prüfungen
laufen bisher mit synthetischen Teilen (Platte, Welle, Torus, Zylinder) mit nachgerechneten Sollwerten.
