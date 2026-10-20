# Funktionsabgleich QuickSurface Pro 8.0.127 ↔ V3D Scan

Grundlage: Screenshots aller Menüreiter von Volker (20.10.2026), Funktionsliste aus
`knowledgebase_general.md` der Testversion, Handbuch QSHelp.pdf. Nachbau nur nach Funktion/Bedienung –
kein Code von KVS (Kern dort: Parasolid, Freiform über Quad Remesher/Instant Meshes).

Legende: ✔ vorhanden · ◐ teilweise · ✗ fehlt · – bewusst weggelassen

## Main / Edit-View
| QuickSurface | V3D Scan |
|---|---|
| Open / Save | ✔ Projekt `.v3dscan`, Import PLY/OBJ/STL/… |
| Undo / Redo / Rebuild | ✔ / ✔ / – (kein Neuaufbau des Verlaufs) |
| Zoom to Fit, Isometric, Top/Bottom/Left/Right/Front/Back | ✔ Ansicht-Band |
| Background Linear/Studio | – |

## Scan Data
| QuickSurface | V3D Scan |
|---|---|
| Edit (Auswahl löschen), Show/Invert Hidden | ✔ Auswahl-Werkzeuge, Löschen/Abtrennen |
| Reduce polygons / Reduce noise / Re-polygonize | ✔ Vereinfachen, Glätten, Netz aus Punktwolke |
| Scale / Flip Normals / Mirror / Average Mesh | ◐ (Normalen ja, Skalieren/Spiegeln am Scan fehlen) |
| Unroll | ✗ |
| Align by Coordinate System / Interactive / By N points | ✔ Ausrichten 3-2-1, Hauptachsen, Punktpaare |
| Fine-align / Global Fine Align | ✔ ICP, Posen-Graph |
| Auto colorize / Default Color | ✔ Farbmodi |
| Export visible | ✔ |

## Construct (Referenzen)
| QuickSurface | V3D Scan |
|---|---|
| Extract primitives (Plane/Cylinder/Cone/Sphere) | ✔ Bereiche automatisch + manuell |
| Middle plane, Plane along path, Plane through sketch line, Plane from 2D sketch | ✔ v0.9 Referenzebene aus Bereich (+Versatz), Mittelebene / ◐ übrige |
| Symmetry Plane | ✔ v0.9 automatisch (Spiegel-ICP) |
| Reference Line / Point | ✔ v0.9 Referenzachse aus Bereich / ✗ Punkt |
| Plane/Cylinder/Cone from CAD | ✗ |

## Freeform
| QuickSurface | V3D Scan |
|---|---|
| Auto Freeform | ✔ v0.8 Automatische Flächenrückführung (Vierecksnetz → B-Spline-Flächen → Körper) |
| New Freeform (Käfig von Hand ziehen), Wrap Surface, From 3D Sketch, From quad OBJ | ◐ v0.9 Käfig aus Auto-Netz von Hand verschieben / ✗ / ✗ / ◐ |
| Thicken / Offset | ✔ v0.8 Aufdicken einer Fläche |
| Convert to CAD body | ✔ automatisch (geschlossene Schale → Volumenkörper) |

## Surfacing
| QuickSurface | V3D Scan |
|---|---|
| Fit Surface | ✔ v0.8 Fläche aus Punktauswahl (B-Spline, verlängerbar) |
| Loft / Sweep / Pipe / Fill Surface / From 2D sketch | ✔ v0.9 Loft, Sweep, Rohr (auch hohl) / ✗ Fill |
| 3D Sketch / Helix / Roll Sketch | ✗ |
| Duplicate Face / Offset / Thicken / Extend Surface / Sew surfaces | ◐ Verlängern beim Einpassen, Aufdicken |
| Project sketch / Flatten | ✗ / ✔ v0.9 Abwickeln (längentreu bzw. konform) als SVG |

## CAD
| QuickSurface | V3D Scan |
|---|---|
| 2D Sketch (Querschnitt) / Multiple sections | ✔ v0.7 / ✔ v0.9 Mehrfachschnitt |
| Extrude / Revolve | ✔ v0.7 (bis Scan, Länge, symmetrisch; Achse) |
| Trim | ◐ Element → Gerade, Radius ändern |
| Combine / Cut / Intersect | ✔ v0.8 Körper mit Körper |
| Shell / Draft / Delete faces | ✔ v0.8 Schale / ✗ / ✗ |
| Move body / Move face / Scale body | ✔ v0.8 Verschieben / ✗ / ✗ |
| Separate bodies | ✗ |
| Split solid (mit Fläche) | ✔ v0.8 Körper mit Fläche beschneiden |
| Fillet / Chamfer | ✔ v0.7 Kantenwahl per Klick, Radius aus Scan |
| Circular / Linear pattern, Mirror | ✔ v0.8 |
| Export (STEP/IGES) | ✔ + „An V3D CAD“ (STEP speichern, V3D CAD öffnen; dort echtes B-Rep) |

## Analysis
| QuickSurface | V3D Scan |
|---|---|
| Compare (Scan ↔ CAD) | ✔ v0.6 Abweichungskarte mit Toleranz/Kennwerten |
| Compare to other meshes | ✔ Abweichungskarte Scan ↔ Scan (Ausrichten) |
| Measure / Surface Area / Volume | ✔ v0.9 Messen (Abstand/Winkel/Kreis) + Volumen/Fläche |
| Zebra Stripes / Environment Map / Draft | ✔ v0.9 / – / ✔ v0.9 Formschräge |
| Snapshot | – (Bildschirmfoto des Systems) |

## Settings / Help
| QuickSurface | V3D Scan |
|---|---|
| Lizenz, Einheiten mm/inch/m, Sprache, Optionen | – nur mm, Deutsch |
| Video-Tutorials, Hilfe-PDF, Shortcuts, Beispiele | ◐ Tastenkürzel-Dialog |
| KI-Assistent (Gemini, verweist auf Tutorials) | ✗ – mit Claude möglich |

## Stand v0.9.0 – was noch fehlt
- Fläche füllen (Fill Surface), Fläche verlängern/nähen als eigene Werkzeuge, Projektion von Skizzen
- Freiform ganz neu von Hand zeichnen (ohne Auto-Netz), Wrap Surface, 3D-Skizze, Helix/Gewinde, Unroll eines Scans
- G1 auch an unregelmäßigen Ecken (Valenz ≠ 4; dort Restknicke bis ~30°), G2
- Flächen löschen / Fläche verschieben / Formschräge anbringen (Draft als Feature)
