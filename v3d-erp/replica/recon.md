# Recon map: myfactory Cloud ERP (Web)

Scope: Der Ausschnitt „ERP + PPS für Fertigungsunternehmen“, so wie ihn ein kleiner Lohnfertiger nutzt.
Er umfasst die Belegkette Verkauf/Einkauf, Lager mit Chargen, Offene Posten/Mahnwesen/Bank, E-Rechnung,
Projekte und eine schlanke Produktionsrückmeldung, dazu Startseite, Suche und Favoriten.
FiBu, Webshop, Kasse, HR, DMS und CRM-Marketing sind bewusst draußen (siehe unten).
For: GSB Hagen (Lohnbearbeitung Sintermetall, 3 Benutzer), danach verkaufbar an ähnliche kleine Lohn-/Auftragsfertiger.
Der Nachbau existiert bereits: V3D ERP (`~/v3d-erp`). Diese Map ist die Messlatte für `/replica-diff`.
Date: 2026-11-02

## Regeln, die hier gelten
- Nur öffentliche Quellen + Volkers eigener Demo-Zugang (17.10., inzwischen abgelaufen) + von Tommi freigegebene Abläufe.
- Kein Code, keine Texte, keine Formulare von myfactory. Begriffe/Abläufe sind vertraut gehalten, die Umsetzung ist eigen.
- Keine Screenshots im Ordner `screens/`. Die Demo ist abgelaufen, und Bilder aus der GSB-Datenbank enthalten Personendaten.
  Referenz sind die Textnotizen in `~/myfactory-analyse`.
- Die AGB des Testzugangs haben wir nicht geprüft. Weitere Recon deshalb nur aus öffentlichen Quellen.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Link aus dem Auftrag | https://pages.myfactory.com/de | **404**, ist tot (geprüft 02.11.) |
| 2 | Marketing-Startseite | https://www.myfactory.com/de | Module, Zielgruppe „bis 100 Mitarbeiter, Handel + Produktion“, 22.000+ Nutzer |
| 3 | Preise/Abos | https://www.myfactory.com/de/preise | 3 Abos (Handel+DL / +E-Commerce / +PPS). Die Funktionstabelle zeigt, was je Abo enthalten ist. Euro-Beträge werden per JS geladen und stehen nicht im HTML |
| 4 | Online-Hilfe (je Maske) | demo…/ie50/help/OnlineHelp/HelpMain.aspx?HelpWindowName=<Cmd> | beste Quelle; ausgewertet 17.10. → `~/myfactory-analyse/rohdaten/` |
| 5 | Eigener Demo-Zugang | demo.myfactory.myforterro.com | 17.10., nur angesehen, nichts gespeichert; ~1.900 Menüpunkte, Stammdatenfelder, Belegarten |
| 6 | Einstiegsvideo | (in der Demo) | Untertitel `rohdaten/einstiegsvideo.vtt`: Startseite, Suche, Favoriten, Mail, Kalender, Aufgaben |
| 7 | GSB-Menü + Favoriten | GSB-Mandant, nur Menüstruktur | `gsb/menue-gsb.md`, Zusatzmodul „TM Plus“ (Partner) |
| 8 | Ablauf-Video Tommi | (gelöscht nach Auswertung) | `gsb/ablaeufe-video.md`, ein Lohnauftrag AB → WE → PA → LS |
| 9 | Gespräche Tommi | — | `gsb/anforderungen.md`, was an myfactory nervt |
| 10 | Neuerungsinfos / Branchenseite PPS | https://www.myfactory.com/de/neuerungsinfos, /de/erp-produktion | Seiten liefern ihren Inhalt nur per JS, deshalb nicht ausgewertet |

## Core loop

Ein Kundenauftrag läuft als Kette von Belegen (AB → Wareneingang Kundenmaterial → Fertigung → Lieferschein → Rechnung).
„Verarbeiten“ bucht dabei automatisch Lager, Charge und Offene Posten. Das Ergebnis ist eine rechtssichere (E-)Rechnung.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Anmeldung | /ie50/system/loginnew/login.aspx | Login, Mandant | Formular | leer, Fehler, Sitzung abgelaufen (Video Schritt 9) |
| S02 | Startseite / Cockpit | nach Login | Kacheln: Umsatz, Fälligkeiten, Aufgaben, Mails | Kachel, Diagramm, Liste | gefüllt, leer |
| S03 | Navigation + Reiterleiste | immer | 21 Bereiche, jede Anwendung als Reiter, „Mein Menü“/Favoriten | Baum, Reiter, Stern | — |
| S04 | Business-Suche | Kopfzeile | Volltext über Adressen/Artikel/Belege | Suchfeld, Trefferliste nach Typ | leer, keine Treffer |
| S05 | Kunden (Stammdaten-Muster) | Verkauf → Kunden | Liste oben, Reiter unten | Liste+Filter, Reiter, Neu/Kopieren/Löschen/Memotext | leer, gefüllt, Pflichtfeld-Fehler |
| S06 | Lieferanten | Einkauf → Lieferanten | wie S05 | wie S05 | wie S05 |
| S07 | Kontakt-Manager (360°) | Adresse → Kontakt-Manager | alle Belege/OPs/Mails/Aufgaben einer Adresse | 23 Reiter | gefüllt |
| S08 | Artikel | Stammdaten → Artikel | Artikel, Preise, Lager, Dispo, Arbeitsplan, Kalkulation | Reiter, Preisliste, Kennzeichen | leer, gefüllt |
| S09 | Verkaufsbelegerfassung | Verkauf → Belegerfassung | Beleg in WYSIWYG-Ansicht erfassen | Belegkopf, Positionstabelle, Unterpositionen (Arbeitsplan), Summen, Bestandszeile, Werkzeugleiste | neu, geändert, verarbeitet (gesperrt), gedruckt |
| S10 | Positionsdetails / -kennzeichen | Position → Details | Charge, Behälter, Ladungsträger, Ausschuss, Pos-Referenzen | Seitenleiste, Formular | — |
| S11 | Neu → Belegart wählen | Werkzeugleiste „Neu“ | Belegart + Kunde | Auswahl | — |
| S12 | Lieferschein erfassen (Sammel) | Neu → Lieferschein | offene AB-Positionen des Kunden über mehrere Aufträge auswählen | Auswahltabelle mit Charge, Menge, Ampel Bestand | leer, gefüllt |
| S13 | Einkaufsbelegerfassung | Einkauf → Belegerfassung | PA/BE/WE/ER; WE auch für Kundenmaterial | wie S09 + Varianten-/Chargendialog | wie S09 |
| S14 | Drucken / Druckansicht | Werkzeugleiste | Formularvariante, PDF / XRechnung | Dialog, Vorschau | — |
| S15 | Verkaufs-/Einkaufsbelegauskunft | Favoriten | Belegliste mit Filtern | Liste, gespeicherte Filter | leer, gefüllt |
| S16 | Belegart-Einstellungen | Administration | Nummernkreis, Folgebelege, Mengenverhalten | Reiter, Tabelle | — |
| S17 | Produktionsauftrag | Produktion → PA bearbeiten | Arbeitsgänge, Entnahme, Rückmeldung, Fertigmelden | Liste+Detail | Fehler Lagerprüfung 10007 (Video) |
| S18 | Lagerbewegungen / Inventur | Lager | Buchen, Inventur eröffnen/zählen/abschließen | Stapel, Zählliste | — |
| S19 | Offene Posten / Fälligkeiten Kunden & Lieferanten | Favoriten | Fälligkeiten, Zahlungseingang | Liste, Summen | leer, überfällig |
| S20 | Mahnwesen (Stapel) | Verkauf → Mahnungen | Vorschlag → bearbeiten → drucken | Stapel-Muster | — |
| S21 | Zahlungsverkehr / Kontoauszug | FiBu/OP | Kontoauszug importieren, Zuordnung | Import, Vorschläge | — |
| S22 | Projekte / Projekt-Explorer | Projekte | Phasen, Zeiten, Budgets (keine Meilensteine!) | Baum, Reiter | — |
| S23 | Umsatzübersicht / -vergleich, Liquiditätsplanung | Favoriten (MIS) | Auswertungen der Geschäftsführung | Diagramm, Tabelle | — |
| S24 | Kennzeichen-Verwaltung | Administration | frei definierbare Zusatzfelder | Tabelle, Typen | — |
| S25 | Smart-Report-/Formular-Designer | Administration | Belegformulare gestalten | Designer | — |
| S26 | Kommunikations-Manager (Mail) | Favoriten | Mails einer Adresse zuordnen | Postfach, Zuordnung | bei GSB nie freigeschaltet |
| S27 | Mobile Lagerbuchung / Terminals | Mobile-App / PPS-Terminal | Rückmeldung in der Halle | Kacheln | — |

## Flows

```
F01 Lohnauftrag vom Eingang bis zur Rechnung (GSB-Kern)
    S09 AB anlegen -> S13 Wareneingang Kundenmaterial je Position (Charge, Menge korrigieren)
    -> S09 AB-Menge von Hand nachziehen -> S17 PA: Entnahme/Rückmeldung -> S11/S12 LS aus offenen Pos.
    -> S10 Behälter/Ausschuss eintragen -> Verarbeiten -> S14 Druck -> S09 Rechnung aus LS
    happy path clicks: ~45 (aus Video geschätzt, nur bis LS ~30)
    edge: Mindermenge beim WE (3.830 → 3.750 an 3 Stellen), Teillieferungen, Lagerprüfung 10007,
          Sitzung bricht ab, Charge (5-teilig) mehrfach tippen
F02 Angebot → Auftrag (Weiterverarbeiten)
    S09 Angebot -> Verarbeiten -> Weiterverarbeiten -> AB
    happy path clicks: ~8
    edge: Preis aus Preisfindung manuell überschrieben, Kunde hat offene Belege
F03 Einkaufskette
    S13 Preisanfrage -> Bestellung -> Wareneingang (Lager) -> Rechnungseingang (Kreditoren-OP)
    happy path clicks: ~20
    edge: Teil-WE, abweichende Rechnungssumme
F04 Sammelrechnung
    S09/Stapel: Kunde wählen -> gelieferte, nicht berechnete LS -> Rechnung
    happy path clicks: ~6
    edge: LS mit Kundenmaterial ohne Preis, Rechnungskreis am Kunden
F05 Zahlungseingang zuordnen
    S21 Kontoauszug (CAMT/CSV) -> Vorschläge -> S19 OP ausgeglichen
    happy path clicks: ~5
    edge: Skonto, Teilzahlung, Betrag ohne Belegnummer
F06 Mahnlauf
    S20 Vorschlag -> bearbeiten -> drucken/mailen -> Mahnstufe +1
    happy path clicks: ~6
F07 Beleg korrigieren nach Verarbeiten
    S09 verarbeiteter Beleg gesperrt -> Storno/Gutschrift -> neuer Beleg
    edge: GoBD, Nummernkreis lückenlos
F08 Tagesblick Geschäftsführung
    S02/S03 Favorit -> S23 Umsatz / S19 Fälligkeiten / Liquidität
    happy path clicks: 2 je Auswertung
F09 Produktion meldet in der Halle zurück
    S27 Terminal/Mobile -> Arbeitsgang erledigt / Fertigmelden
    edge: Ausschuss, falsche Charge, Übermeldung
F10 Kunde fragt nach dem Termin
    myfactory: keine Lösung (nur Projektphasen) -> Mail von Hand
    -> in V3D ERP der eigene Mehrwert: Zeitstrahl + Kunden-PDF
F11 E-Rechnung ausgeben / einlesen
    S14 PDF+ZUGFeRD / XRechnung  |  ER: XML importieren -> Rechnungseingang
F12 Stammdaten anlegen
    S05/S06/S08 Neu -> Reiter füllen -> Speichern
    edge: Kunde zugleich Lieferant (eigene Nummer je Rolle), Dubletten
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Reiterleiste (Anwendungen) | Anwendung, Unterreiter | aktiv, ungespeichert | alle |
| Navigationsbaum + Mein Menü | Bereich, Ordner, Favorit | auf/zu, Stern | S03 |
| Stammdaten-Muster | Liste oben + Reiter unten | leer, Auswahl, Bearbeiten | S05, S06, S08, S24, >100 Stammdaten |
| Listenansicht | Suche, Volltext, Filter, Spaltenwahl, gespeicherte Filter | leer, laden, gefüllt | S05–S08, S15, S19 |
| Beleg-Werkzeugleiste | Neu, Suchen, Beleg, Positionen, Dokumente, Memotext, Verarbeiten, Drucken, Druckansicht | aktiv/inaktiv je Status | S09, S13 |
| WYSIWYG-Belegblatt | Verkauf, Einkauf | neu, geändert, verarbeitet, gedruckt | S09, S13 |
| Positionstabelle | Artikel-, Text-, Unterposition | Fehler, gesperrt | S09, S13 |
| Kontextmenü | Position, Artikel, Adresse | — | S09 |
| Auswahldialog offene Positionen | Charge, Menge, Ampel | — | S12 |
| Stapel-Ansicht | Vorschlag → bearbeiten → ausführen → Protokoll | — | S20, S21, Sammel-LS/-RE |
| Kennzeichen-Feld | Ja/Nein, Text, Zahl, Datum, Auswahl | — | S08, S10, S24 |
| Kachel / Diagramm | Umsatz, Vorjahr | leer | S02, S23 |
| Druckdialog | Formularvariante, PDF/XRechnung | — | S14 |
| Fehlermeldung | Hinweis, Fehler mit Code | — | überall (z. B. 10007) |

## Inferred data model

```
Adresse      id, adressnr, name, anschrift, kommunikation, kennzeichen
             evidence: S05/S06/S07, Hilfe „Adressen“, Stammdatenfelder rohdaten/01
             confidence: high
Kunde/Lieferant  adresse_id, kundennr | lieferantennr, zahlungsbedingung, preisliste, rechnungskreis
             evidence: S05/S06, Video (Kunde zugleich Lieferant mit K-Nr.)
             confidence: high
Ansprechpartner  adresse_id, name, mail, telefon        confidence: high
Artikel      id, nr, bezeichnung, me, preise[], lager-/dispodaten, arbeitsplan (Arbeitsgänge mit Toleranz), kalkulation, gewicht
             evidence: S08, Video Schritt 1, Tommi „Kosten zu Artikeln“
             confidence: high (Arbeitsplan: medium)
Belegart     code, bereich VK|EK, nummernkreis, folgebelegarten[], mengenverhalten, wirkung (Lager/OP/Statistik)
             evidence: S16, rohdaten/02   confidence: high
Beleg        id, belegart, nummer (erst bei Verarbeiten), adresse, datum, status (neu|geändert|verarbeitet|gedruckt), projekt, texte
             evidence: S09, Hilfe Belegerfassung   confidence: high
Belegposition  beleg, pos, artikel|text, menge, me, preis, rabatt, unterpositionen, kennzeichen (Behälter, Ladungsträger, Ausschuss, Charge)
             evidence: S09/S10, Video   confidence: high
Belegverknüpfung  quell_pos → ziel_pos, menge (Teillieferungen, Pos-Referenzen)
             evidence: Video Schritt 2+4 (PA/WE/LS/RE an einer AB-Position)   confidence: high
Charge       nummer (5-teiliger Text bei GSB), artikel, menge, eigentümer (Kunde), dokumente
             evidence: Video, Tommi   confidence: medium (Bedeutung der 5 Teile offen)
Lager/Lagerbewegung  lager, artikel, menge, beleg, betriebsstätte
             evidence: S18, Fehler 10007   confidence: high
Produktionsauftrag  artikel, menge, status (erstellt/eingeplant/freigegeben/fertig), arbeitsgänge, entnahmen
             evidence: S17   confidence: high
Offener Posten  beleg, adresse, betrag, fällig, skonto, mahnstufe   confidence: high
Projekt      nr, kunde, phasen, zeiten, budgets (keine Meilensteine)   confidence: high
Kennzeichen-Def/Wert  objekttyp, typ, auswahlwerte / objekt_id, wert   confidence: high
Mail         postfach, adresse_id, beleg/projekt   evidence: Einstiegsvideo   confidence: medium
Benutzer     login, rolle, betriebsstätte, favoriten   confidence: medium
```

Relationships: Adresse 1-n Kunde/Lieferant (Rollen), Adresse 1-n Ansprechpartner, Beleg n-1 Adresse, Beleg 1-n Position,
Position n-m Position (Verknüpfung mit Menge), Position n-1 Charge, Charge 1-n Lagerbewegung, Beleg 1-n OP,
Beleg n-1 Projekt, Artikel 1-n Arbeitsgang, Produktionsauftrag n-1 AB-Position.

## Feature matrix

See `features.csv`. Must: 32, should: 20, could: 12, skip: 9.
Die Spalte `clone` ist hier schon befüllt, weil V3D ERP existiert. Grundlage sind Code und Commits bis 31.10.
Jedes Feature einzeln im laufenden System nachgeprüft habe ich nicht. Das übernimmt `/replica-diff`.

## Out of scope (cannot or should not be cloned)

- Partner-Ökosystem und Zusatzmodule (TM Plus, Technologie-Partner), Shipcloud-/Konfipay-Verträge, Amazon/eBay-Anbindungen
- MyForterro.ai / KI-Plattform und Rechenzentrum („Cloud auf Weltklasseniveau“): ersetzt durch den Server bei GSB im Haus
- Die Breite von 1.546 Anwendungen. Nicht das Ziel, sondern genau Tommis Problem
- Komplette FiBu mit Bilanz/ELSTER (regulatorisch, Steuerberater bleibt mit DATEV)
- Formularvorlagen und Texte von myfactory, Logo, Hilfe-Texte
- Kassensystem (POS, TSE-Pflicht) und HR (bei GSB nicht lizenziert)

## Size

Screens 27, flows 12, entities 15.
Hard parts:
1. GoBD-saubere Belegkette (Verarbeiten-Sperre, lückenlose Nummern, Archiv, Storno)
2. Mengen-/Chargenfluss über Teillieferungen und Mindermengen
3. E-Rechnung (XRechnung/ZUGFeRD, KoSIT-geprüft) und DATEV-Export
4. Outlook/M365-Anbindung
5. Datenübernahme aus myfactory

Size: **L** für den GSB-Ausschnitt (ein Quartal). Davon ist laut Matrix der größte Teil schon gebaut.
Ganz myfactory wäre **XL**, dann müsste der Umfang neu geschnitten werden.
