# Abgleich Geomagic Design X Go ↔ V3D Scan

Stand 15.10.2026. Quelle: offizielle Vergleichs-PDF „Geomagic_DesignX_Comparison_DE_2026“
(dl.revopoint3d.com). Nachbau nur der Funktionen, eigener Code (kein Dekompilieren).

Preise (Revopoint-Shop, 15.10.): Go unbefristet 4.723 € (statt 5.556 €), Go Jahresabo 2.114 €,
Classroom Suite permanent (3 J. Wartung) 6.940 €.

Legende: ✔ vorhanden · ◐ teilweise · ✗ fehlt · (Etappe n) = bereits im Scan→CAD-Plan

## Was Design X **Go** kann – und wo V3D Scan steht

| Bereich (Go-Funktion) | V3D Scan | Bemerkung |
|---|---|---|
| **Datei** Punktdaten PTS u. a. | ✔ | ply/pcd/xyz/pts/asc/csv |
| Netze STL u. a. | ✔ | stl/obj/ply/off/glb |
| Scannerformate | ◐ | Revo Scan / CrealityScan-Exporte, keine Rohformate |
| STEP/IGES Import/Export | ✗ | OCP unter Wine belegt (Etappe 5/6) |
| DXF Import/Export | ✗ | für Skizzen (Etappe 4) |
| **Auswahl** Linie/Rechteck/Kreis/Polygon/Lasso | ◐ | Kreis + Linie fehlen |
| Auswahl nach Winkel, Erweitern auf Ähnliches / bis Knick, intelligente Auswahl | ✗ | auf Netz: Region-Growing nach Normalenwinkel – Kern dafür steckt schon in `erkennung.py` |
| Alle / Keine / Invers | ✔ | |
| Benutzerdefinierte Region | ✗ | → Regionen-Konzept (s. u.) |
| **Referenzgeometrie** Ebene, Vektor, KS, Polygon, Punkt | ◐ | nur intern für 3-2-1; keine dauerhaften Referenzelemente im Baum |
| **Scan-Werkzeuge** Triangulieren, Ausrichten, Zusammenführen, Kombinieren, Dezimieren, Transformieren | ✔ | Poisson/Ball-Pivoting, FPFH+ICP, global, Voxel |
| **Netz** Heilungsassistent, Normalen, Löcher füllen, Glätten, Teilen | ✔/◐ | „Teilen“ nur per Ebene, nicht per Kurve/mehrere Werkzeuge |
| Netz versetzen (Offset) | ✗ | |
| Navigation (Fehlerstellen durchgehen) | ◐ | „Problemstellen markieren“, kein Weiter/Zurück-Springen |
| **Region** Einfügen, Zusammenführen, Teilen | ✗ | Go hat KEINE Auto-Segmentierung (erst Pro) – wir schon (Etappe 3) |
| **Punktwolke** Rauschfilter, Abtastung | ✔ | |
| **Ausrichten** Interaktiver Abgleich (Scan → KS) | ✔ | 3-2-1 aus Elementen |
| **Messen** Abstand, Winkel, Radius, Schnitte | ✗ | Radius nur über erkannte Formen |
| Netzabweichung | ✔ | Abweichungskarte Scan↔Scan |
| **Ansicht** Sichtbarkeit, Zoom, Anzeigemodi, Ansichtspunkte | ✔ | |
| Ansichtsklammer (Clipping), Walkthrough | ✗ | |
| **2D-Skizze** Netzskizze (Querschnitt → Skizze) | ✗ | Etappe 4 – Herzstück |
| Linie, Rechteck, Polygon, Kreis, Bogen, Spline, Mittellinie, Punkt, Parallelogramm, Ellipse, Langloch | ✗ | Etappe 4 |
| Verrunden, Fase, Versetzen, Trimmen, Erweitern, Teilen, Spiegeln, Muster | ✗ | Etappe 4 |
| Intelligente Bemaßung, Zwangsbedingungen, Fangen/Smart Snap | ✗ | Etappe 4 |
| **3D-Skizze** 3D-Skizze, Spline, Querschnitt, Elemente umwandeln | ✗ | |
| **Körper** Extrudieren, Rotieren, Sweep, Loft | ✗ | Etappe 6 (OCP) |
| Schnitt, Boolesch | ✗ | Etappe 6 |
| **Modellierung** Festkörper-/Oberflächenprimitiv | ◐ | Formen erkannt, aber kein CAD-Körper daraus (Etappe 6) |
| Verrundung, Fase | ✗ | Etappe 6 (OCCT) |
| **Oberfläche** Mesh Fit, Auto Surface | ✗ | Etappe 7 (Freiform) |
| Oberfläche extrudieren/rotieren/sweepen/loften, Normalen umkehren | ✗ | Etappe 6/7 |
| **Accuracy Analyzer** Abweichung Körper↔Scan, Netz, Skizze | ◐ | nur Netz↔Netz (Etappe 5) |
| **In PDF veröffentlichen** | ✗ | Prüfbericht |
| **LiveTransfer** nach SolidWorks/NX/… | ✗ | Ersatz: STEP + Übergabe an V3D CAD |
| Scanner-Direktsteuerung | – | nicht geplant |

Schon **mehr als Go** (in Design X erst Plus/Pro): automatische Segmentierung + Geometrie-
klassifizierung, Merkmal-Deutung (Bohrung/Zapfen/Senkung …), Nennmaß-Rundung, globale
Mehrfach-Ausrichtung.

## Vorgeschlagene Reihenfolge

1. **Regionen + Modellbaum** – erkannte Formen werden bearbeitbare Regionen (Einfügen,
   Zusammenführen, Teilen, Pinsel/Erweitern nach Winkel); links ein Baum mit Scans,
   Regionen, Referenzelementen, Skizzen, Körpern. Grundlage für alles Weitere.
2. **Netzskizze (Etappe 4)** – Schnittebene (aus Region/Referenzebene) → Schnittpolylinie →
   automatisch Linien/Bögen anpassen → 2D-Skizzeneditor mit Bemaßung, Zwangsbedingungen, Fang.
3. **Körper (Etappe 6)** – Extrudieren/Rotieren aus Skizze, Primitive aus Regionen,
   Boolesch, Verrundung/Fase über OCP; STEP/IGES-Export; Übergabe an V3D CAD.
4. **Accuracy Analyzer (Etappe 5)** – Körper↔Scan live farbig, Werte an Klickpunkten.
5. **Messen** (Abstand/Winkel/Radius/Schnitt) + **Ansichtsklammer**.
6. **PDF-Bericht**, DXF, Netz-Offset, Sweep/Loft, 3D-Skizze.
7. **Freiform / Auto Surface (Etappe 7)**.

## Oberfläche (Look & Feel) – belegt aus offiziellem Video (Design X 2024.3)

Quelle: Geomagic-Video „User Interface | Getting Started“ (youtu.be/7YLutlx5OHs), Standbilder
lokal in `designx-referenz/videos/stand/` (nicht im Git). Handbuch: `designx-referenz/designx-2014-userguide.pdf`
(968 S., Version 2014, Uni Pittsburgh – Aufbau seither weitgehend gleich).

- **Hell**, Windows/Office-Stil: Titelleiste mit Schnellzugriff, roter „MENU“-Knopf links.
- **Ribbon** oben, Reiter = Arbeitsschritte: HOME · LIVECAPTURE · POINTS · POLYGONS · REGION ·
  ALIGNMENT · SKETCH · 3D SKETCH · MODEL · EXACT SURFACING. Gruppen mit Beschriftung darunter
  (z. B. POLYGONS: Scan Process | Wizard | Merge/Combine | Repair Holes/Boss | Optimize | Edit | Navigation).
  Große Symbole mit Text, kleine Symbole in 3er-Spalten.
- **Links** zwei Bäume übereinander: oben *Feature*-Baum (Verlauf: Region Group, Sketch (Mesh),
  Extrude, Mesh Fit, Cut, Plane, Revolve …), unten *Model*-Baum nach Typ (Meshes, Point Clouds,
  Surface Bodies, Solid Bodies, Sketches, Reference Vectors/Planes/Coordinates) mit Augen-Kästchen.
- **Mitte** Ansichtsfenster mit grauem Hintergrund, Netz hellblau, Auswahl orange; schwebende
  Ansichtsleiste oben mittig; Reiter „Model View“ unten; Achsenkreuz + Maßstab unten links.
- **Rechts** Spalte *Properties | Display | Accuracy Analyzer(TM)* als Reiter, Eigenschaften als
  zweispaltige Tabelle mit Gruppen (Common, Appearance, Nominal Geometry …).
- Eingeblendete **Maus-/Tastenhilfe** (dunkles Feld rechts im Viewport: „Select an entity“, „Rotate“…).
- **Console** unten (Protokoll mit Zeitstempel), darunter **Auswahlfilter-Leiste** und Statuszeile.
- Regionen farbig (Region Group), Accuracy Analyzer als Farbskala rechts.

Heute in V3D Scan: dunkles Theme, Reiter rechts, Scanliste links, schwebende Werkzeugleiste
unten. Umbau erst nach Abstimmung mit Volker.

### Offizielle Schulungsreihe „Geomagic Design X Go Training“ (YouTube, Kanal Geomagic)
01 Introduction (25 min, ar1i2HtTgBk) · 02 View Manipulation & Selection (34, 9DVrgpViIH0) ·
03 Reference Geometry & Mesh Sketching (44, QU0Hp8pHwnk) · 04 Extrude, Revolve & Solid Primitives
(40, xtqKIKBbxTM) · 05 Model Finishing & LiveTransfer (9, Q-V5zUZ7NhA) · 06 Alignment &
Coordinate Systems (34, vq6wEDTDkVA) · 07 Regions (61, xb8XmhKChzU) · 08 Point Cloud Data
(35, lErmchuWerY) · 09 Advanced Lofted Surfaces (42, lQQaSgtID88) · 10 Mesh Fit Tools
(32, vZIOOhoBCfY) · 11 Autosurfacing (8, ODUuM-dykuE).
Dazu: Complete Reverse Engineering Workflow | Design X Go (26 min, 6cjzwXqiQlo), What's New 2025.1
(34 min, N54eYz57rCw), Händler-Demo Design X Go (EMS3D, 40 min, FuSRFoQz4Z0).
