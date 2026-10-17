# Belege & Abläufe (Masken + eingebaute Online-Hilfe, gekürzt)

## Belegarten
Verkauf (30): Angebot, Anzahlungsrechnung, Auftragsbestätigung, Barverkauf, Direktrechnung, Gesamtstorno, Gesamtstorno Barverkauf, Gutschrift, Konsignationslieferung, Konsignationsretour, Lieferschein, Proformarechnung, Rahmenauftrag, Rechnung, Reparaturlieferung, Rücklieferschein, Sammelrechnung, Schlussrechnung, Sofortauftrag, Sofortlieferschein, Sofortrechnung, Storno Anzahlungsrechnung, Stornorechnung, Stornorechnung Barverkauf, Teilrechnung, Teilrechnung kumuliert, Vorkasserechnung, Vorlagebeleg, Webshopbestellung, Webshop-Verkauf
Einkauf (13): Bestellmahnung, Bestellung, Bestellvorlage, Gesamtstorno, Gutschrift, Preisanfrage, Rahmenauftrag, Rechnungseingang, Retoure, Sofortrechnung, Stornorechnung, Warenbegleitschein, Wareneingang

Belegart-Einstellungen (Verkauf): Belegart [TypeDesc] | Nummernkreis [NumberRange] | Abweichende Druckbezeichnung | Dialoganlage | Lieferterminanzeige | Artikelbewertung [ValuationPriceType] + aktualisieren | Belegversionen nachverfolgen [SaveVersions] | Währungskurs aktualisieren | Standardbelegstatus | Zahlungskonditionen | Standard-Mailvorlage | Abw. Belegpreisliste / Rabattliste | Dokumentenart ZUGFeRD/XRechnung | Barverkauf | Standardlager (+ bei Weiterverarbeitung setzen) | Projekte gemäß Projektphase abschließen
Reiter: Grundlagen | Folgebelege (Belegart → erlaubte Folgebelegart + Mengenangabe: „Menge übernehmen / Menge zurücksetzen / Vorzeichenumkehr“) | Betriebsstätten (je Betriebsstätte: Mailvorlage, verboten, Ziel-Betriebsstätte) | Intrastat | Historie
Einkauf zusätzlich: „Bestellmengendialog anzeigen“.
Demo: Folgebelege fast leer gepflegt, nur Anzahlungs-/Vorkasserechnung → Storno Anzahlungsrechnung (Vorzeichenumkehr).

## Verkaufsbelegerfassung (Sales_OrderProcessing)
- WYSIWYG: Der Beleg wird direkt in einer Ansicht erfasst, die wie der Ausdruck aussieht (Briefkopf, Absenderzeile, Anschriftfeld, Belegkopf-Kasten Belegnummer/Kundennummer/Datum/Betreff/Bearbeiter, Kopftext, Positionstabelle Typ|Pos|Artikel|Bezeichnung|Menge|ME|Einzelpreis|Gesamtpreis + Rabatt %, Zwischensumme/Endsumme, Fußtext). Unten: Bestand / Verfügbar des aktuellen Artikels.
- Werkzeugleiste: Neu (Belegart wählen) | Suchen | Direktsuche | Beleg | Positionen | Dokumente | Memotext | Verarbeiten | Drucken | Druckansicht
- Positions-Kontextmenü: Details, Langtext, Handelsset, Positionstyp, Neu, Artikel einfügen, Kopieren, Einfügen, Löschen, Preisinformation, Preishistorie, Geräte
- Artikel-Kontextmenü in Position: Suchen, Bearbeiten, Memotext, Periodenumsätze, Kundenumsätze, Kundenkartei, Lieferantenumsätze/-kartei, Lagerbestände, Dispositionsstatus, Umsatzplanung, Kalkulation, Schnellinventur, Etikettendruck, „AI Zolltarifnummer ermitteln“, „AI Meldebestand ermitteln“, Neue Aufgabe
- Interessenten-Kontextmenü: Suchen, Neu, Bearbeiten, Memotext, Angebote, Kontakt-Manager, Dublettenanalyse, Neue Aufgabe
- Hilfe: Belege steuern Prozesse (Rechnung → Umsatzstatistik; Lieferschein → Lagerbuchung). Vorgang = Kette von Belegen, Folgebeleg entsteht per „Weiterverarbeitung“ (Positionen werden übernommen) → Vorgang später rekonstruierbar. Nach Kundenwahl: offene Belege des Kunden werden angeboten. Preis über Preisfindung, manuell änderbar. Anzahlungsartikel: Eingabe „20%“ im Einzelpreis rechnet Anteil der Bruttosumme. Kopf-/Fußtexte aus Stammdaten. Status: Systemstatus (neu/geändert/verarbeitet/gedruckt) + individueller Status. [Verarbeiten] vergibt endgültige Belegnummer + bucht Statistik.

## Einkaufsbelegerfassung (Purchase_Orders)
Analog Verkauf. Rechnungseingang → automatisch Offene Posten; Wareneingang → Lagerbuchung. Kette Preisanfrage → Bestellung → Wareneingang → Rechnungseingang. Bestellvorlage = Vorlagebeleg für wiederkehrende Bestellungen.

## Disposition: Bestellvorschläge erstellen (Purchase_Disposition_Suggestions)
Erzeugt Bestellvorschläge, Fertigungsaufträge (Stücklistenfertigung), Fremdfertigungsaufträge, PPS-Fertigungsdispositionen – abhängig von Dispositionsmethode am Artikel. Filter: Artikelnr, Hauptlieferant, Artikelgruppe, Stückliste. „Disposition bis“ (wichtig bei Verkaufsmengenplanung aus Umsatzplanung), Karenzzeit (Tage vorziehen), Zusammenfassen (einzeln / max. 1 Bestellung pro Woche / alles in einer).
## AI Meldebestände bestimmen
Sammelermittlung Melde-/Maximalbestand per KI aus Lagerbuchungen ab Datum; Artikel wählen → ermitteln → Vorschläge vs. aktuelle Werte vergleichen → übernehmen.

## Lagerbewegungen buchen (Stock_Shiftings)
Sitzung/Stapel; Verarbeitung „Dialog“ (sofort buchen) oder „Stapel“ (sammeln, dann buchen). Belegarten: Entnahme interne Umbuchung, Entnahme manuell, Lagermittelumbuchung (Lagerplatzverwaltung), Zugang interne Umbuchung, Zugang manuell, Zugang manuell (EK-wirksam).
## Inventur Eröffnung
Bezeichnung; Methode: Artikelbestände | Bestände + Hauptlager | Alle Artikel; Bewertung: MEK, Durchschn. Bestand, Letzter EK, Durchschn. EK, Kalkulatorischer EK, Interner Wert; Filter Artikelnr von/bis, Gruppe, Hauptlieferant, Hersteller, Lager. Danach Zähllisten → Erfassung → Abschluss/Abbruch, Differenzen, Bewertungsliste.
## Reservierung für Adressen
Reservierungsstapel je Adresse, Positionen mit Varianten-Logik, Lieferdatum (für Dispo), „Erl.“ automatisch bei Entnahme, Bestandszuordnung nach Lagerentnahme-Methode.

## Lieferungen erstellen (Sammellieferung)
Vorschläge nach Kunde/Artikel/Liefertermin/Belegherkunft (Amazon, eBay, Webshop) → bearbeiten → Lieferscheine erzeugen.
## Sammelrechnungen
Je Kunde: gelieferte, nicht berechnete Positionen; Filter Belegherkunft + Rechnungskreis (am Kunden hinterlegt).
## Vertragsverwaltung
Vertrag = Kunde + Vorlagebeleg (Positionen) + Vertragskreis, Kündigungsfrist, Beginn/Ende, Intervall; Generierungslauf erzeugt periodische Belege; Register Grundlagen, Belege, Dokumente, Memotext, Beleghistorie, Kennzeichen, Ansprechpartner, Unterbrechungen, Historie. Preisanpassungslauf, USt-Korrekturassistent.
## Rahmenaufträge
Anlage über Belegerfassung (Belegart Rahmenauftrag); Rahmen-Nr, Gruppe, Laufzeit; Register Artikel: Rahmenmenge vs. bestellt/geliefert/berechnet; „Tagespreis“ statt Rahmenpreis; Abrufplanung (Termine/Mengen), aus Rahmen neuer Auftrag/Lieferschein.

## Produktion (PPS)
- Fertigungsdisposition: alle Bedarfe an Produktion; je Eintrag Make-or-Buy (Produktionsauftrag oder Bestellung, auch Teilmengen); Sammelaktion, Zusammenführen. Register Positionen (Stücklistenstruktur), Allgemein, Dispo, Kennzeichen, Dokumente, Belege, Referenzen.
- Planungs-Manager: nach Grobplanung Feinplanung per Drag-and-drop (Aufträge/Arbeitsgänge verschieben); temporäre Planungsdaten erzeugen/verwerfen, IST-Planung aus Rückmeldungen, Ressourcen aktualisieren (Krankheit), Daten übernehmen.
- Produktionsauftrag bearbeiten: Liste + Detail (Register Positionen/Allgemein/Buchungsarten), Unteraufträge, Toolbar Neu/Auftrag/Kalkulation/Position/Aktion/Memotext.
- Ablauf laut Menü: anlegen → anpassen → einplanen → disponieren → freigeben → Materialbereitstellung → rückmelden → fertigmelden; Terminals (Zeitmeldung, Entnahme, Rückmeldung); Verlängerte Werkbank (Fremdfertigung mit Beistellung).
