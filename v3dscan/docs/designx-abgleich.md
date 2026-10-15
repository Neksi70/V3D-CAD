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

## Oberfläche (Look & Feel)

Noch nicht angeglichen – öffentlich gibt es keine brauchbaren Screenshots (Shop-Seite zeigt
nur Packshots). Wartet auf Screenshots aus der Testversion. Vermutetes Grundmuster von
Design X (nicht geprüft): Ribbon mit Reitern nach Arbeitsschritt oben, Feature-/Modellbaum
links, Eigenschaften-/Accuracy-Analyzer-Spalte rechts, heller Verlaufs-Hintergrund im
Ansichtsfenster, farbige Regionen. Heute in V3D Scan: dunkles Theme, Reiter rechts,
Scanliste links, schwebende Werkzeugleiste unten.
