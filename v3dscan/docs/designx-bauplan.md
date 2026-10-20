# Bauplan V3D Scan → Scan-to-CAD nach Vorbild Design X Go

Stand 15.10.2026. Grundlage: offizielle Go-Schulungsreihe (11 Folgen) + Workflow-Video, ausgewertet
in `designx-referenz/notizen/01–12.md`; Funktionsabgleich in `designx-abgleich.md`.
Nachgebaut werden Funktionen und Bedienabläufe – eigener Code, eigene Symbole, eigene Namen.

## Der Kern-Arbeitsablauf (Folge 12, 35 Schritte – immer dieselbe Schleife)

Scan laden → ausrichten → **Regionen** → **Referenzebene/-achse** aus Region →
**Mesh Sketch** (Schnitt) → Linien/Bögen per **Doppelklick anfitten** → Trim/Bemaßen auf Nennmaß →
**Extrude/Revolve** (Blind / Up To Surface / Mid Plane, Insert/Merge/Cut) → **Fillet** (Radius aus
Netz geschätzt) → **Abweichung Körper↔Scan** prüfen → wiederholen → **STEP** / Übergabe an V3D CAD.

Alles, was diese Schleife nicht trägt, kommt später.

## Gemeinsames Bedien-Gerüst (einmal bauen, überall nutzen)

- **Werkzeugfenster** schwebend links oben im Viewport: Titel · Vorschau · ✓ · ✕, zuklappbare
  Abschnitte, „Weitere Optionen“; ✓ grau bis gültig; Vorschau orange → ✓ oder „Zurück“.
- **Vorauswahl** füllt das erste Feld; aktives Auswahlfeld hervorgehoben; Pick im Viewport = Pick im Baum.
- **Feature-Baum** (Verlauf, Doppelklick = Bearbeiten, Rückroll-Leiste) + **Model-Baum** (Netze,
  Punktwolken, Regionen, Referenzen, Skizzen, Körper – je mit Auge). Namen „Extrude2 (Cut)“.
- **Auswahl einheitlich:** Shift = hinzu, Ctrl = abziehen, Esc = nichts; Sichtbar-only / Durch;
  Smart Selection (Klick + Ziehen = Empfindlichkeit), Pinsel (Alt+Ziehen = Größe), Linie/Kreis.
- **Farbschema:** Netz hellblau, Auswahl türkis, Vorschau orange, Schnittspur pink, Skizze blau,
  Hover rot. Ansicht: Normal To, Standardansichten, Ansichtsklammer.

## Etappen (je Etappe: Tests + Commit + Versionssprung)

| # | Inhalt | Belege | Aufwand |
|---|---|---|---|
| **A** | Bedien-Gerüst: Werkzeugfenster, Feature-/Model-Baum, Auswahl-Logik, Smart Selection, Pinsel, Normal To, Ansichtsklammer | 02, 03, 06 | mittel |
| **B** | **Regionen** als eigenes Modell (je Dreieck), Auto-Segmentierung → Region Group; Insert/Merge/Split, Typ umstellen (+Revolution), Typ-Anzeige beim Überfahren, Neu-Fitten nach Änderung | 07, 10 | mittel |
| **C** | **Referenzgeometrie** dauerhaft: Plane (Best Fit/Min/Max Bound, N·Sigma, Offset×Anzahl, Pick Point & Coplanar Axis, Average), Vector (Zylinder-/Kegel-/Drehachse), Axis Constraint; Messen Abstand/Winkel/Radius | 03, 06, 09 | klein–mittel |
| **D** | **Mesh Sketch** Planar + Rotational + Silhouette, Offset-Pfeil live; 2D-Skizze: Linie/Bogen/Kreis/Rechteck/Langloch per Doppelklick-Fit, Tangent Arc, Corner/Power Trim, Disjoined Ends, Constraints, Smart Dimension mit Nennmaß-Rundung | 03, 04, 06, 09, 12 | groß |
| **E** | **Körper** über OCP: Extrude (Blind/Up To Surface/Up To Region/Mid Plane), Revolve, Insert/Merge/Cut, Solid Primitive aus Region, Fillet/Chamfer mit „Radius aus Netz“, Mirror, Cut mit Fläche; STEP/IGES-Export | 04, 05, 07, 10, 12 | groß |
| **F** | **Accuracy Analyzer** Körper↔Scan und Skizze↔Schnitt: Farbskala, Toleranzband, Wert am Zeiger | 04, 11, 12 | mittel |
| **G** | **Übergabe an V3D CAD** mit Verlauf (eigener „LiveTransfer“: Feature-Liste als JSON) | 05 | mittel |
| **H** | Punktwolken-Komfort: Punktpaar-Ausrichten mit geteilter Ansicht, Combine mit Überlappungsentfernung, Sampling nach Krümmung, Box-Filter | 08 | klein–mittel |
| **I** | Flächen: Loft aus Profilen, Mesh Fit (B-Spline auf Region), Auto Surface; **dazu Extend/Trim**, was Go fehlt | 09, 10, 11 | groß |

**Stand 20.10.2026 (v0.7.0):** A weitgehend (Menüband/Werkzeugfenster/Bäume), D (Querschnitt-Skizze mit Auto-Fit,
Nennmaß, Radius ändern, Element→Gerade), E (Extrudieren inkl. „bis Scan“, Drehen, Runden/Fasen mit Kantenpick,
Grundkörper, STEP/IGES), F (Abweichung Körper↔Scan, Skizze↔Schnitt) erledigt. Zusätzliche Vorlage: QuickSurface
(siehe Gedächtnis „quicksurface-analyse“). Offen: B (Regionen je Dreieck), C (dauerhafte Referenzgeometrie), G, H, I.

Reihenfolge A → B → C → D → E → F, danach G/H/I nach Bedarf. Nach E ist der Ablauf aus Folge 12
komplett in V3D Scan machbar (Meilenstein „erstes echtes Teil vom Scan zum STEP“).

## Offene Entscheidungen für Volker

1. **Oberfläche:** helles Design-X-Layout (Menüband oben nach Arbeitsschritten, Bäume links,
   Eigenschaften rechts) oder bisheriges dunkles V3D-Scan-Layout behalten und nur die
   Abläufe übernehmen?
2. **Start:** wirklich mit Etappe A (Gerüst) – oder zuerst ein schnell sichtbares Ergebnis
   (Solid Primitive aus erkannter Form + STEP-Export, wenige Tage)?
3. **Testteil:** ein echter Scan (MIRACO) eines einfachen prismatischen Teils als Referenz für alle Etappen.
