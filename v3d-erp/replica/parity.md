# Paritätsbericht: V3D ERP gegen myfactory (GSB-Ausschnitt)

Stand 2026-11-02 · Build 2a37d4d9 · Grundlage: `recon.md`, `features.csv`, `test-plan.md`, `bugs.md`

## Ergebnis

| | Wert |
| --- | --- |
| **Gesamt** | **92,2 / 100** (nur Funktionsumfang, siehe Layout) |
| Funktionsumfang | 92,2, Pflicht 30 von 30 erledigt (Gewichtung Pflicht 3, Soll 2, Kann 1, „teilweise“ zählt halb) |
| Layout je Maske | **nicht gemessen**. Es gibt keine Original-Bildschirmfotos: Der Testzugang ist abgelaufen, Bilder aus der GSB-Datenbank enthalten Personendaten. |
| Abläufe getestet | 49 von 49 E2E-Fällen bestanden, dazu 103 Python-Tests |
| Offene Fehler | S1 0 · S2 0 · S3 0 · S4 0 (5 gefunden, alle behoben) |

**Urteil: auslieferbar für den GSB-Ausschnitt.** Alle Pflicht-Funktionen sind erledigt, der Funktionsumfang liegt über 80, und es gibt keine offenen S1/S2-Fehler.
„Besser als das Original“ im Sinne der Replica-Methode ist erst belegt, wenn `/replica-entrepreneur` echte Nutzerkritik ausgewertet hat.
Die eigenen Vorteile unten stammen aus Tommis Rückmeldungen, nicht aus öffentlichen Bewertungen.

Einschränkungen der Zahl:
- Die Spalte „clone“ beruht auf Code, Commits und den E2E-Fällen. Funktionen, die kein E2E-Fall berührt, sind durch Python-Tests abgedeckt (Nummernkreise, GoBD-Archiv, Kundenpreise, Kennzeichen, Import). Durchgeklickt wurden sie nicht.
- Der DATEV-Export ist als „erledigt“ gezählt, der Import beim Steuerberater ist aber ungeprüft (siehe bugs.md, „zu prüfen“).


## Bereiche, schwächster zuerst
- plattform                     25.0  (4 features)
- kommunikation                 50.0  (1 features)
- preise                        66.7  (2 features)
- projekte                      66.7  (2 features)
- lager                         71.4  (4 features)
- produktion                    87.5  (4 features)
- verkauf                       90.0  (4 features)
- belege                        95.5  (8 features)
- basis                        100.0  (5 features)
- stammdaten                   100.0  (8 features)
- einkauf                      100.0  (1 features)
- lohnfertigung                100.0  (6 features)
- finanzen                     100.0  (6 features)
- auswertung                   100.0  (2 features)
- e-rechnung                   100.0  (2 features)
- migration                    100.0  (1 features)
- betrieb                      100.0  (1 features)

## Fehlt noch, in Bau-Reihenfolge
- [should] kommunikation: E-Mail im System / Zuordnung zu Adresse/Projekt, partial  (Tabelle mail vorhanden; Outlook/M365 wartet auf Tommi)
- [could] belege: Freier Formular-Designer (Smart Reports), no  (Baukasten mit Schaltern reicht bisher)
- [could] lager: Disposition / Bestellvorschläge / Meldebestand, no  (Lohnfertiger hat wenig eigenes Material)
- [could] lager: Varianten / Seriennummern, no  (Chargen reichen bei GSB)
- [could] plattform: Dialog-Designer (Masken anpassen), no
- [could] plattform: Workflow-Folgeaktionen / mehrstufige Belegfreigaben, no  (Tommi: in ~5 Jahren Produktion gibt frei)
- [could] preise: Preis-/Rabattmatrix und Preislisten, no  (bei GSB kaum genutzt)
- [could] produktion: Produktionsauftrag mit Grob-/Feinplanung (Planungs-Manager), no  (GSB braucht es laut Video nicht)
- [could] projekte: Projekt-Zeiterfassung und -Abrechnung, no
- [could] verkauf: Rahmenaufträge / Verträge mit Generierungslauf, no
- [could] plattform: Mobile-App für alle Module, partial  (Weboberfläche mobil getestet (test_mobil.mjs); keine eigene App)
- [could] plattform: REST-API für Dritte, partial  (interne JSON-API vorhanden; nicht dokumentiert/abgesichert für Dritte)

## Bewusst weggelassen (nicht gewertet)
- Komplette FiBu mit Bilanz und UStVA/ELSTER: regulatorisch; Steuerberater bleibt (DATEV-Export statt FiBu)
- CRM-Marketing (Kampagnen / Newsletter / Leads / Geo-Reports): 3 Benutzer ohne Vertrieb
- Webshop / E-Commerce: nicht im Ausschnitt; bei Bedarf VolmeShop
- Kassensystem (POS): TSE-Pflicht; bei GSB nicht lizenziert
- HR / Personal: bei GSB nicht lizenziert
- DMS docuvita: Partnerprodukt; eigene Dokumente an Charge/Beleg reichen
- MyForterro.ai / KI-Plattform: Eigentum des Anbieters
- Shipcloud / Konfipay / Marktplatz-Anbindungen: Partnerverträge
- Partner-Zusatzmodul TM Plus: Partnerprodukt; einzelne Auswertungen (Gewährleistungsliste) bei Bedarf als eigenes Feature

## Nur bei V3D ERP (nicht gewertet)
- Mindermenge beim Wareneingang gleicht Auftrag an
- Projekt-Zeitstrahl mit Meilensteinen + Kunden-PDF
- Outlook-Add-in

## Verhaltensvergleich (Abläufe)

Quelle für myfactory: Tommis Bildschirmvideo vom 26.10. und die Demo vom 17.10. Für V3D ERP: E2E-Fälle.

| Ablauf | myfactory | V3D ERP | Bewertung |
| --- | --- | --- | --- |
| F01 Lohnauftrag bis Lieferschein | ca. 30 Klicks bis zum LS (Video, geschätzt) | **11 Klicks bis zur Rechnung** (F01-H1, gemessen) | behalten |
| F01 Mindermenge beim Wareneingang | dieselbe Korrektur 3× von Hand (WE, AB, PA) | einmal, danach Dialog „Auftrag anpassen“ | behalten |
| F01 Charge | 5-teilige Chargennummer mehrfach getippt | einmal beim Wareneingang, danach automatisch auf LS und RE | behalten |
| F01 Entnahme für die Produktion | scheitert mit Lagerprüfung 10007 | keine Entnahme nötig: Rückmeldung je Palette/Charge | behalten |
| F01 Sitzung | im Video endet der Ablauf auf der Login-Seite (Absturz oder Abmeldung, ungeklärt) | Sitzung 12 h, Neuladen behält den Beleg (Q-E2) | behalten |
| F02 Doppelklick „Verarbeiten“ | nicht beobachtet | nur eine Nummer, keine Lücke (F02-E1) | behalten |
| F07 Korrektur verarbeiteter Belege | nur per Storno/Gutschrift | gleich, Server lehnt Änderung ab (F07-H1, F02-E2) | gleich |
| F10 Kunde fragt nach dem Termin | keine Lösung (nur Projektphasen) | Zeitstrahl + Kunden-PDF (F10-H1) | Vorteil |
| E-Mail im System | vorhanden, bei GSB nie freigeschaltet | Tabelle vorhanden, Anbindung offen | **bauen**, sobald M365 entschieden ist |
| Handy | eigene Apps nur für Teilbereiche | Weboberfläche auf 390 px ohne seitliches Verschieben (F08-E1, 12 Seiten) | behalten |

## Die nächsten fünf Schritte

1. **DATEV-Probedatei beim Steuerberater einspielen lassen**, Konten bestätigen. Das ist das einzige Risiko vor dem Echtbetrieb im Finanzteil.
2. **E-Mail-Anbindung** (einziger offener Soll-Punkt): Microsoft Graph, sobald Tommi M365 bestätigt, sonst IMAP wie V3D Mail.
3. **Rückfragen an Tommi** klären: Arbeitsplan auf AB/LS drucken? Bedeutung der 5 Chargenteile?
4. **Barrierefreiheit mit axe prüfen** (braucht `@axe-core/playwright`, nur nach deinem Ok).
5. `/replica-entrepreneur`, falls V3D ERP an weitere Lohnfertiger verkauft werden soll. Die „Kann“-Lücken (Rahmenaufträge, Zeiterfassung, Disposition) erst bauen, wenn ein Kunde sie braucht.
