# GSB – Anforderungen an das neue System (Stand 22.10.2026, aus Gesprächen mit Volker)

## Muss (Kern)
1. **Verkauf**: Belegkette Angebot → Auftragsbestätigung → Lieferschein → Rechnung (inkl. Projektlieferscheine, Gewährleistung, siehe TM Plus)
2. **Einkauf**: Preisanfrage → Bestellung → Wareneingang → Rechnungseingang
3. **Kommunikation/E-Mail im System**, optimal mit **Outlook-Einbindung**
4. Vertraute Bedienung: gleiche Begriffe, Abläufe und Nummern wie in myfactory, aber kein 1:1-Nachbau

## Hauptverbesserung: Projektierung
- Kunden verlangen einen **Zeitstrahl mit Planterminen und Erfüllung/Nichterfüllung**. Das kann myfactory nicht (nur Projektphasen, Zeiten, Budgets).
- Konzept: Meilensteine mit Plan-/Isttermin, eingefrorenem Ursprungsplan, Verschiebungsgrund, Ampel; automatisch erfüllt durch verknüpfte Belege (AB, Bestellung, Wareneingang, Lieferschein, Rechnung); Kundenansicht als PDF/Link; Erfüllungsquote.

## Tägliche Sicht (Favoriten heute)
Umsatzübersicht, Umsatzvergleich Artikelgruppen, Fälligkeiten Kunden/Lieferanten, Liquiditätsplanung, Verkaufs-/Einkaufsbelegauskunft, Mail.

## E-Mail / Outlook – Konzept
- **Microsoft Graph** (falls Microsoft 365 / Exchange Online): Mails des Postfachs lesen; anhand der Absenderadresse automatisch Kunde/Lieferant/Projekt zuordnen. Belege direkt aus dem System versenden, wobei die Mail in Outlook unter „Gesendet“ landet. Termine und Aufgaben abgleichen.
- **Outlook-Add-in** (Seitenleiste in Outlook): zum Absender den Kunden zeigen, offene Belege, Projekte und Zeitstrahl. Knöpfe „Mail zum Projekt ablegen“, „Angebot anlegen“, „Aufgabe/Meilenstein anlegen“.
- Fallback ohne M365: IMAP/SMTP (Muster: V3D Mail, Zuordnung Mail → Adresse).
- Datenschutz: Die App-Registrierung läuft im Tenant von GSB mit Admin-Zustimmung, die Daten bleiben auf dem GSB-Server. Grundlage ist der AVV.

## Antworten Tommi (22.10.)
- Zeitstrahl „genau richtig“; Produktion soll später auf eigenem Tablet/Rechner abhaken (umgesetzt: Rolle „werkstatt“); Kunde bekommt jederzeit PDF (umgesetzt: Terminbericht-PDF)
- **Microsoft 365**: 3 persönliche Postfächer + info@ + anfrage@, bald auftrag@ → Konzept: `konzept-m365-und-it.md`
- Administration macht bisher ein externer IT-Betreuer → **Volme 3D soll die IT-Betreuung übernehmen können** (Teil B im Konzept)

## Antworten Tommi Teil 3 (22.10.)
- **Benutzer:** 3 (Tommi, Mutter, Schwester), **alle brauchen alle Module** (keine Abteilungstrennung). Mittelfristig (~5 Jahre) soll die **Produktion Arbeiten freigeben** können (Workflow).
- **Buchhaltung:** heute außerhalb des ERP, alles an Steuerberater über **DATEV**; soll sich ändern („wie besprochen“).
- **Was an myfactory nervt:**
  1. Komplexität und **Instabilität**: Dinge werden nicht oder falsch angezeigt → Neustart oder anderer Account nötig
  2. **Chargennummer immer wieder eingeben**, um Dokumente zu verknüpfen und zuzuordnen (will Tommi in der Praxis zeigen)
  3. **Wareneingang Rohware mit Charge**: je Position ein Knopf, statt die ganze Auftragsbestätigung auf einmal als Wareneingang mit Rohmaterial zu buchen
  4. **Kosten zu Artikeln** sehr aufwendig, das System will immer tiefere Positionen
  5. **E-Mail-Anbindung** scheiterte an einer IT-Freischaltung (→ M365-Konzept, Volme 3D übernimmt IT)

## Abgeleitete Kernanforderungen (neu, Priorität hoch)
- **Charge als zentrales Objekt:** einmal beim Wareneingang erfasst, danach automatisch an Fertigung, Lieferschein, Rechnung, Dokumenten. Nie wieder abtippen.
- **Wareneingang für den ganzen Auftrag in einem Schritt:** Tabelle aller Positionen, Charge je Zeile (oder eine für alle), Menge vorbelegt, ein Klick „buchen“.
- **Dokumente an der Charge** (Werkszeugnis, Prüfprotokoll, Kunden-Lieferschein): einmal hochladen, überall sichtbar.
- **Einfache Kalkulation:** Material + Zeit × Stundensatz + Fremdleistung + Aufschlag; Details freiwillig.
- **Stabilität vor Funktionsfülle.**
- **DATEV-Übergabe** (Stufe 1), später OP/Bank.

## Offene Fragen
- Typische Meilensteine eines Projekts? Wie bekommt der Kunde den Zeitstrahl heute? Wer pflegt die Termine?
- ~~Wo soll das System laufen?~~ → **Entschieden 22.10.: läuft bei GSB im Haus auf einem Server, den Volker verkauft.**

## Vorschau
Projekt-Zeitstrahl mit Testdaten: `vorschau/projekt-zeitstrahl.html`, online unter https://v3da.tailf05fe9.ts.net/tools/vorschau/projekt-zeitstrahl.html (nicht im Tools-Index verlinkt)
