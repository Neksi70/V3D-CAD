# Vergleich QuickSurface Pro 8 ↔ V3D Scan 1.0

Stand 21.10.2026. Grundlage: komplette Funktions-Checkliste aus dem QuickSurface-Handbuch (262 S.), der
Video-Wissensbasis und den Menüreitern von v8.0.127 (`docs/quicksurface-funktionen.md`). Nachgebaut wurde nur
nach Funktion und Bedienung – kein Code, keine Dateien von KVS.

Legende: ✔ vorhanden · ◐ teilweise / anders gelöst · ✗ fehlt · – bewusst nicht nötig.
„geprüft“ = Test mit nachgerechnetem Sollwert (Volumen, Maß, Fläche) in `tests/`.

## Zusammenfassung

Gezählt nach Vergleichszeilen (eine Zeile kann eng verwandte Befehle bündeln); „–“ = nicht relevant.

| Bereich | Zeilen | ✔ | ◐ | ✗ |
|---|---|---|---|---|
| Programm / Dateien / Ansicht | 13 | 7 | 3 | 3 |
| Scan-Auswahl + Grundformen | 16 | 8 | 4 | 4 |
| Ausrichten | 6 | 5 | 1 | 0 |
| 2D-Skizze (Schnitt + Editor) | 24 | 18 | 4 | 2 |
| CAD-Features | 22 | 19 | 3 | 0 |
| Flächen / 3D-Skizze | 16 | 12 | 2 | 2 |
| Freiform | 22 | 11 | 6 | 5 |
| Netzbearbeitung + Mehrteile | 16 | 13 | 0 | 3 |
| Verlauf / Objektbaum | 5 | 5 | 0 | 0 |
| Analyse | 10 | 8 | 1 | 1 |
| Export / Übergabe | 6 | 4 | 1 | 1 |
| **Summe** | **156** | **110 (71 %)** | **25 (16 %)** | **21 (13 %)** |

**Kern-Arbeitsablauf (Scan → STEP) vollständig:** Scan laden/bereinigen → ausrichten → Grundformen erkennen →
Querschnitt-Skizze (Auto-Fit, Nennmaß) → Extrudieren/Drehen/Loft → Runden/Fasen → Körper aus Flächen
(automatisches Trimmen) → Abweichung prüfen → STEP/IGES/STL. Freiform: automatisch (G1) oder Käfig von Hand.

**Wo V3D Scan mehr kann als QuickSurface:** mehrstufiges Rückgängig (QuickSurface laut Handbuch nur 1 Schritt),
automatische Geometrieerkennung des ganzen Scans in einem Schritt, „Extrudieren bis Scan“ (Tiefe aus dem Scan),
Radius-Vorschlag aus erkannten Rundungen, Punktwolken-Werkzeuge (Ausreißer, Tisch, Registrierung FPFH/ICP),
Abwickeln mit Verzerrungsangabe + SVG, Skizze auf Zylinder wickeln, Übergabe an V3D CAD.

**Was QuickSurface voraus hat:** Freiform-Editor mit Kanten-/Flächenmanipulator (Extrude-Handle, Bridge, Merge,
Split-Loop, Pinsel-Glätten), G1 auch an unregelmäßigen Ecken, Skizzen-Constraint-Solver (gekoppelte Bedingungen),
Live-Übertragung an SolidWorks/Inventor, E57-Import, Mehrsprachigkeit. Geometriekern Parasolid gegenüber
OpenCASCADE (robuster bei schwierigen Booleans/Rundungen).

## Einzelvergleich

### 0. Programm, Dateien, Ansicht
| QuickSurface | V3D Scan |
|---|---|
| Öffnen/Speichern (eigenes Projektformat) | ✔ `.v3dscan` (ZIP), mit Verlauf, Skizzen, Referenzen, Auswahlen |
| Import STL/OBJ/PLY | ✔ + PCD, XYZ/ASC/CSV, OFF, GLTF |
| Import PTX | ✔ v1.0 (Raster → Netz, Matrix, Farbe) — geprüft |
| Import E57 | ✗ (bräuchte libE57) |
| CAD importieren (STEP/IGES) | ✔ v1.0 als Körper — geprüft (Rundreise gleiches Volumen) |
| Einheiten mm/inch/m | ◐ Anzeige in Messen + Eigenschaften; intern mm |
| Undo/Redo | ✔ mehrstufig (30 Schritte) — QuickSurface: 1 Schritt |
| Rebuild | ✔ v1.0 (je Körper ↻) |
| Ansichtswürfel / Standardansichten | ◐ Knöpfe Vorne/Oben/Rechts/Schräg + Achsenkreuz, kein Würfel |
| Hintergrund Linear/Studio | ✔ v1.0 hell/Studio/dunkel |
| Optionen (Navigationsschemata anderer CADs) | ✗ |
| Auto-Backup | ✗ |
| Sprache | – nur Deutsch |
| Hilfe/Tastenkürzel/Beispiele | ◐ Tastenkürzel-Dialog; keine Beispieldateien/Videos |

### 1. Scan-Auswahl + Grundformen
| QuickSurface | V3D Scan |
|---|---|
| Rechteck / Freihand (Lasso) / Polygon | ✔ |
| Zauberstab (Winkel-Empfindlichkeit) | ◐ „Verbunden“-Auswahl (Zusammenhang), ohne Winkel |
| Pinsel / Kreis / Linie | ✗ |
| Select through | ✔ „Durch“ |
| Auswahl vergrößern/verkleinern, isolieren, verbergen | ✗ |
| Auswahl speichern | ✔ v1.0 „Auswahl merken“ |
| Primitive extrahieren (Ebene/Zylinder/Kegel/Kugel) | ✔ automatisch für den ganzen Scan + manuell — geprüft |
| Bedingungen beim Extrahieren (parallel/senkrecht/koaxial) | ◐ Achsen auf Weltachsen einrasten, Nennmaß |
| Auto Constrain | ◐ Nennmaß-Rundung + Achsen-Einrasten |
| Primitiv als Volumen (Solid) | ✔ „Grundkörper aus Bereich“ |
| Primitiv per Eingabe / aus anderem / interaktive Griffe | ✗ (Ebenen ja: Referenz per Eingabe) |
| Symmetrieebene | ✔ automatisch (Spiegel-ICP) — geprüft; interaktiv ✗ |
| Fit Surface (U×V, Auto-Fit nach Toleranz) | ◐ Fläche aus Auswahl (Raster, eben → echte Ebene, Verlängern); Toleranz-Auto ✗ |
| Referenzlinie (Ebene∩Ebene, Zylinderachse) | ✔ v1.0 — geprüft |
| Referenzpunkt (3 Ebenen) | ✔ v1.0 — geprüft |
| Ebene/Zylinder/Kegel aus CAD-Fläche | ✗ |

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
| Punkt | ✗ |
| Tangentenbogen zwischen Linien | ✔ Ecke runden — geprüft |
| Spline (Freiformkurve) | ◐ Spline aus Schnittbereich (Approximate within); Klickpunkte-Spline ✗ |
| Auto Sketch (Linien/Bögen erkennen) | ✔ inkl. Rundungen tangential, robust gegen Rauschen — geprüft |
| Fit per Shift-Ziehen / Pinsel-Fit | ◐ Auto-Fit + Element ersetzen/Spline; kein Pinsel |
| Corner Trim / Auto-Fillet | ✔ automatisch beim Einpassen + Ecke runden |
| Trim (radieren), Break/Extend | ◐ Element entfernen → Gerade; Break/Extend ✗ |
| Hilfslinien (Construction) | ✔ v1.0 — geprüft |
| Bedingungen waagrecht/senkrecht/parallel/rechtwinklig | ✔ — geprüft |
| Tangential / symmetrisch / fixieren, gekoppelter Solver | ◐ tangential automatisch; Solver ✗ |
| Maße: Radius, Abstand, Länge, Winkel | ✔ v1.0 (treibend) — geprüft |
| Offset (rund/spitz) | ✔ — geprüft (Formel exakt) |
| Mirror | ✔ |
| Copy linear / Raster / kreisförmig | ✔ — geprüft |
| Toleranz-Anzeige Skizze ↔ Scan | ✔ Abweichung je Kontur |
| Export DXF | ✔ v1.0 R12 — geprüft |
| Export IGES (Skizze) / Live an SolidWorks | ✗ |
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
| Fillet mit Live-Abweichung | ◐ Radius-Vorschlag aus erkannter Rundung |
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
| Blend Curve | ✗ |
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
| New Freeform (Fläche/Rechteck) | ◐ Raster-Käfig auf Auswahl; Einzel-Vierecke per 4 Klicks ✗ |
| Wrap Surface | ✔ v1.0 — geprüft |
| Snap an Netz (Closest / Ray) | ✔ beides intern |
| Ecken ziehen | ✔ Maus über den Scan |
| Kanten/Flächen wählen, Manipulator World/Local, Extrude-Handle „D“ | ✗ |
| Bridge / Merge (Kante auf Kante) | ✗ |
| Split (Schleife einfügen) | ◐ „feiner“ (alle Vierecke ×4) |
| Increase Resolution | ✔ |
| Smooth (Kette/Pinsel) | ◐ Käfig glätten (global) |
| Align H/V | ✗ |
| Crease Kante/Punkt | ◐ Kanten per Klick; Punkt-Crease ✗ |
| Symmetrie / Set on Symmetry Plane | ✔ v1.0 — geprüft |
| Unregelmäßige Ecken anzeigen/reparieren | ✗ (G1-Restknick dort bis ~30°) |
| Hide / Isolate | ✗ |
| Offset / Thicken / Flip | ✔ / ✔ / ✗ |
| Merge Quad Surfaces / wenige große Patches | ◐ Raster-Käfig „als eine Fläche“ |
| Slicing | ✔ An Ebene schneiden |
| Convert to CAD body | ✔ automatisch (geschlossen → Volumen) |
| Templates speichern/laden | ✔ v1.0 (JSON) |
| From quad OBJ | ✔ v1.0 |
| From 3D Sketch | ◐ Fläche füllen in geschlossene 3D-Skizze |

### 7. Netzbearbeitung + Mehrteile
| QuickSurface | V3D Scan |
|---|---|
| Reduce polygons (mit Abweichungsstatistik) | ✔ Vereinfachen; Statistik ◐ |
| Edit / Löschen / Smooth selected | ✔ |
| Individual meshes / kleine Inseln | ✔ |
| Löcher füllen (Automatic/Tangent/Curvature) | ✔ flach/gewölbt — geprüft |
| Fill semi-hole / Bridge | ✗ |
| Split mesh mit Körper / Cut / Combine | ✔ v1.0 teilen/abziehen — geprüft |
| Split Mesh with 3D Sketch | ✗ |
| Scale / Mirror / Flip normals | ✔ v1.0 (Umlauf + Normalen korrekt) — geprüft |
| Reduce noise | ✔ Glätten (Taubin/Laplace) |
| Average Mesh | ✔ v1.0 Mittelwert-Netz |
| Re-polygonize | ✔ Netz aus Punktwolke (Poisson/Ball Pivoting) |
| Unroll | ✔ v1.0 Abrollen — geprüft |
| Auto colorize / Default color | ✔ Farbmodi |
| Export visible | ✔ |
| Mehrere Scans, Merge, Global Align | ✔ — geprüft |
| Boundary Edit | ✗ |

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
| Übergabe an eigenes CAD | ◐ „An V3D CAD“ (STEP als B-Rep, ohne Verlauf) |
| Lizenz/Aktivierung | – |

## Offene Punkte nach Nutzen
1. Freiform-Editor: Kanten/Flächen wählen, Extrude-Handle, Bridge, Merge, Split-Loop, Pinsel-Glätten
2. Skizzen-Constraint-Solver (gekoppelte Bedingungen), Break/Extend, Klick-Spline
3. Auswahl: Pinsel, Zauberstab mit Winkel, Vergrößern/Verkleinern, Isolieren
4. G1 an unregelmäßigen Ecken
5. Live-Übergabe des Verlaufs an V3D CAD (Feature-Liste statt STEP)
6. E57-Import, Navigationsschemata, Auto-Backup

**Wichtigster nächster Schritt unabhängig von der Liste: Test mit echten Scans (MIRACO).** Alle Prüfungen
laufen bisher mit synthetischen Teilen (Platte, Welle, Torus, Zylinder) mit nachgerechneten Sollwerten.
