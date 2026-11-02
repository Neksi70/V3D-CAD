# Testplan: V3D ERP (Replica-Test gegen die myfactory-Recon)

Stand: 2026-11-02 · Umgebung: eigener Testserver (Port 8897, frische Testdaten aus seed.py), Chromium 1440×900 bzw. 390×844
Start: `cd ~/v3d-erp && ~/node_modules/.bin/playwright test -c e2e`. Der Lauf berührt nie die Prototyp-Datenbank.

Jeder Fall schlägt zusätzlich fehl bei JavaScript-Fehlern, Konsolenfehlern oder einer 5xx-Antwort (`e2e/hilfe.mjs`).
Erwartete 4xx-Fachmeldungen (z. B. „Name fehlt.“) zählen nicht als Fehler.

| Fall | Ablauf | Art | Prüft | automatisch | Ergebnis |
| --- | --- | --- | --- | --- | --- |
| Q-N1 | Querschnitt (Anmeldung, Sitzung, Rechte) | Fehlerfall | falsches Kennwort zeigt Meldung, kein Zugang | e2e/01-sitzung.spec.mjs | bestanden |
| Q-H1 | Querschnitt (Anmeldung, Sitzung, Rechte) | Normalfall | Anmelden über das Formular öffnet die Startseite | e2e/01-sitzung.spec.mjs | bestanden |
| Q-E1 | Querschnitt (Anmeldung, Sitzung, Rechte) | Grenzfall | abgelaufene Sitzung führt zurück zur Anmeldung | e2e/01-sitzung.spec.mjs | bestanden |
| Q-N2 | Querschnitt (Anmeldung, Sitzung, Rechte) | Fehlerfall | Werkstatt-Tablet darf keine Belege lesen oder schreiben | e2e/01-sitzung.spec.mjs | bestanden |
| Q-N3 | Querschnitt (Anmeldung, Sitzung, Rechte) | Fehlerfall | POST ohne CSRF-Kopf wird abgelehnt | e2e/01-sitzung.spec.mjs | bestanden |
| Q-N4 | Querschnitt (Anmeldung, Sitzung, Rechte) | Fehlerfall | gelöschter / unbekannter Beleg: Meldung statt Absturz | e2e/01-sitzung.spec.mjs | bestanden |
| Q-E2 | Querschnitt (Anmeldung, Sitzung, Rechte) | Grenzfall | Neuladen mitten im Beleg behält den Beleg | e2e/01-sitzung.spec.mjs | bestanden |
| Q-E3 | Querschnitt (Anmeldung, Sitzung, Rechte) | Grenzfall | Zurück-Taste mitten in der Erfassung führt ohne Fehler zurück | e2e/01-sitzung.spec.mjs | bestanden |
| Q-E4 | Querschnitt (Anmeldung, Sitzung, Rechte) | Grenzfall | Tastatur: Alt+S speichert einen Belegentwurf | e2e/01-sitzung.spec.mjs | bestanden |
| Q-E5 | Querschnitt (Anmeldung, Sitzung, Rechte) | Grenzfall | Formularfelder haben zugeordnete Beschriftungen (Barrierefreiheit) | e2e/01-sitzung.spec.mjs | bestanden |
| F12-H1 | Stammdaten | Normalfall | Kunde zugleich Lieferant anlegen: beide Nummern, Umlaute/Emoji bleiben erhalten | e2e/02-stammdaten.spec.mjs | bestanden |
| F12-N1 | Stammdaten | Fehlerfall | ohne Namen wird nicht gespeichert | e2e/02-stammdaten.spec.mjs | bestanden |
| F12-E1 | Stammdaten | Grenzfall | sehr lange Eingabe: speicherbar, Liste bleibt bedienbar | e2e/02-stammdaten.spec.mjs | bestanden |
| F12-N2 | Stammdaten | Fehlerfall | Adresse mit Belegen lässt sich nicht löschen | e2e/02-stammdaten.spec.mjs | bestanden |
| F12-E2 | Stammdaten | Grenzfall | Artikel mit Arbeitsplan (Toleranz, Prüfschritt) speichern und wieder lesen | e2e/02-stammdaten.spec.mjs | bestanden |
| F02-H1 | Angebot → Auftrag | Normalfall | Angebot in der Oberfläche erfassen, verarbeiten, zur AB weiterverarbeiten | e2e/03-verkauf.spec.mjs | bestanden |
| F07-H1 | Korrektur nach Verarbeiten | Normalfall | verarbeitete Rechnung ist gesperrt, Korrektur nur per Gutschrift | e2e/03-verkauf.spec.mjs | bestanden |
| F02-E1 | Angebot → Auftrag | Grenzfall | Doppelklick auf Verarbeiten vergibt nur eine Nummer | e2e/03-verkauf.spec.mjs | bestanden |
| F02-E2 | Angebot → Auftrag | Grenzfall | zwei Reiter: Entwurf in Reiter 2 speichern, nachdem Reiter 1 verarbeitet hat | e2e/03-verkauf.spec.mjs | bestanden |
| F02-N1 | Angebot → Auftrag | Fehlerfall | Beleg ohne Kunde wird nicht gespeichert | e2e/03-verkauf.spec.mjs | bestanden |
| F01-H1 | Lohnauftrag AB→WK→LS→RE | Normalfall | Lohnauftrag von der AB bis zur Rechnung, Klicks gezählt | e2e/04-lohnauftrag.spec.mjs | bestanden |
| F01-N1 | Lohnauftrag AB→WK→LS→RE | Fehlerfall | Lieferschein über mehr als im Haus ist gesperrt | e2e/04-lohnauftrag.spec.mjs | bestanden |
| F01-E1 | Lohnauftrag AB→WK→LS→RE | Grenzfall | Sammel-Lieferschein über zwei Aufträge eines Kunden | e2e/04-lohnauftrag.spec.mjs | bestanden |
| F03-H1 | Einkaufskette | Normalfall | Bestellung → Wareneingang → Rechnungseingang | e2e/05-einkauf.spec.mjs | bestanden |
| F03-N1 | Einkaufskette | Fehlerfall | Einkaufsbeleg für eine Adresse ohne Lieferantenrolle wird abgelehnt | e2e/05-einkauf.spec.mjs | bestanden |
| F04-H1 | Sammelrechnung | Normalfall | Rechnung aus mehreren Lieferscheinen | e2e/06-finanzen.spec.mjs | bestanden |
| F05-H1 | Zahlungseingang | Normalfall | Kontoauszug einlesen und sichere Zahlungen zuordnen | e2e/06-finanzen.spec.mjs | bestanden |
| F06-H1 | Mahnlauf / Offene Posten | Normalfall | Mahnlauf erzeugt Mahnung als PDF | e2e/06-finanzen.spec.mjs | bestanden |
| LIQ-H1 | Liquidität | Normalfall | Liquidität: Kontostand + feste Zahlung ergeben die Wochenstände | e2e/06-finanzen.spec.mjs | bestanden |
| DATEV-H1 | DATEV-Export | Normalfall | Export nur mit Berater-/Mandantennummer, dann EXTF-Datei | e2e/06-finanzen.spec.mjs | bestanden |
| F11-H1 | E-Rechnung + Steuerfall | Normalfall | Rechnung an EU-Kunden: 0 % USt, Hinweis, XRechnung mit Kategorie AE | e2e/06-finanzen.spec.mjs | bestanden |
| F11-E1 | E-Rechnung + Steuerfall | Grenzfall | eigene XRechnung als Rechnungseingang einlesen, zweites Mal als Dublette erkannt | e2e/06-finanzen.spec.mjs | bestanden |
| F06-E1 | Mahnlauf / Offene Posten | Grenzfall | Mahnsperre-Häkchen in Offene Posten stehen normal in der Zeile (BUG-005) | e2e/06-finanzen.spec.mjs | bestanden |
| F08-H1 | Tagesblick / Handy | Normalfall | Startseite mit Kennzahlen, Umsatz, Fälligkeiten | e2e/07-auswertung.spec.mjs | bestanden |
| F08-E1 | Tagesblick / Handy | Grenzfall | Handybreite 390 px ohne seitliches Verschieben: #/start | e2e/07-auswertung.spec.mjs | bestanden |
| F08-E1 | Tagesblick / Handy | Grenzfall | Handybreite 390 px ohne seitliches Verschieben: #/belege/VK | e2e/07-auswertung.spec.mjs | bestanden |
| F08-E1 | Tagesblick / Handy | Grenzfall | Handybreite 390 px ohne seitliches Verschieben: #/liquiditaet | e2e/07-auswertung.spec.mjs | bestanden |
| F08-E1 | Tagesblick / Handy | Grenzfall | Handybreite 390 px ohne seitliches Verschieben: #/umsatz | e2e/07-auswertung.spec.mjs | bestanden |
| F08-E1 | Tagesblick / Handy | Grenzfall | Handybreite 390 px ohne seitliches Verschieben: #/datev | e2e/07-auswertung.spec.mjs | bestanden |
| F08-E1 | Tagesblick / Handy | Grenzfall | Handybreite 390 px ohne seitliches Verschieben: #/inventur | e2e/07-auswertung.spec.mjs | bestanden |
| F08-E1 | Tagesblick / Handy | Grenzfall | Handybreite 390 px ohne seitliches Verschieben: #/produktion | e2e/07-auswertung.spec.mjs | bestanden |
| F08-E1 | Tagesblick / Handy | Grenzfall | Handybreite 390 px ohne seitliches Verschieben: #/bank | e2e/07-auswertung.spec.mjs | bestanden |
| F08-E1 | Tagesblick / Handy | Grenzfall | Handybreite 390 px ohne seitliches Verschieben: #/mahnwesen | e2e/07-auswertung.spec.mjs | bestanden |
| F08-E1 | Tagesblick / Handy | Grenzfall | Handybreite 390 px ohne seitliches Verschieben: #/op/debitor | e2e/07-auswertung.spec.mjs | bestanden |
| F08-E1 | Tagesblick / Handy | Grenzfall | Handybreite 390 px ohne seitliches Verschieben: #/chargen | e2e/07-auswertung.spec.mjs | bestanden |
| F08-E1 | Tagesblick / Handy | Grenzfall | Handybreite 390 px ohne seitliches Verschieben: #/projekte | e2e/07-auswertung.spec.mjs | bestanden |
| F09-H1 | Werkstatt-Rückmeldung | Normalfall | Palette starten und fertigmelden, Ausschuss geht auf die Charge | e2e/08-werkstatt-projekt.spec.mjs | bestanden |
| F10-H1 | Zeitstrahl-PDF | Normalfall | Projekt mit Zeitstrahl: Kunden-PDF abrufbar | e2e/08-werkstatt-projekt.spec.mjs | bestanden |
| INV-H1 | Inventur | Normalfall | Inventur in der Oberfläche, Differenz wird gebucht | e2e/09-inventur.spec.mjs | bestanden |

**49 Fälle, 49 bestanden.** Dazu 103 Python-Tests (Geschäftslogik, E-Rechnung mit KoSIT, Archiv, Produktion).

## Gemessen
- F01 Lohnauftrag AB → Wareneingang Kundenmaterial (mit Mindermenge) → Lieferschein → Rechnung: **11 Klicks** (Test F01-H1, Grenze im Test ≤ 15).

## Nicht abgedeckt (bewusst bzw. offen)
| Grenzfall aus der Liste | warum nicht | Risiko |
| --- | --- | --- |
| langsames Netz / offline | Server läuft im Haus bzw. Tailnet; kein Offline-Modus vorgesehen | gering |
| Zeitzonen / Sommerzeit | ein Standort (Hagen), Datumswerte ohne Uhrzeit | siehe „zu prüfen“ in bugs.md |
| Screenreader-Prüfung (axe) | `@axe-core/playwright` nicht installiert, neue Abhängigkeit nur nach Rückfrage; Feldbeschriftungen per F12/Q-E5 geprüft | mittel |
| Daten eines zweiten Mandanten | V3D ERP ist einmandantenfähig; Rechte nur Büro/Werkstatt (Q-N2) | – |
| Zahlungsanbieter / Kartenzahlung | gibt es im ERP nicht | – |
| E-Mail-Versand | Mail-Anbindung noch offen (wartet auf M365-Entscheidung) | – |
| DATEV-Import beim Steuerberater | nur Dateiformat geprüft, nicht der Import in DATEV | **hoch** vor Echtbetrieb |
