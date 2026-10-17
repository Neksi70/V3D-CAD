# Rechnungswesen, CRM, Service, Projekte, Plattform (eingebaute Hilfe, gekürzt)

## Rechnungswesen (myfactory.FMS)
- Buchungserfassung (Accounting_Booking_Main): zentraler Dialog; Kopfbereich / Liste / Erfassung. Jede Übergabe aus Belegen legt eine Buchungssitzung an; Buchungen aus Belegen nur im Ursprungsbereich änderbar. Kennzeichen auch an Buchungspositionen; Buchungsnachweis.
- Zahlungseingänge buchen: Erfassung je OP-Nummer (kein Splitten eines Sammelbetrags); Felder MS (Mahnstufe), Z-Konto, Beleg, Zahlbetrag, Skonto, Ausbuchen + A-Konto; Zahlbetrag/Skonto werden aus Zahlungskondition vorgeschlagen.
- Mahnwesen: Vorschlagsstapel aller überfälligen OPs → bearbeiten → Mahnungen; Filter OP-Fälligkeit bis, Verzugszinsen bis, „Zahlungen berücksichtigt bis“, Druckgruppe (Papier vs. E-Mail), Kunden-Nr von/bis, Mahnstufe von/bis, Mahnkondition. Grundlagen: Mahnkonditionen, Mahnstufen/-texte, Kontaktanlage.
- Kontoauszug-Import: Hausbank, Importformat (frei definierbar), Datei, Name/Datum, optional in bestehende Buchungssitzung; danach Dialog „Kontoauszug“; Buchungserkennung = Regeln zur automatischen Kontierung; Erkennung von Kunden/Lieferanten auch über DATEV-Kontonummer.
- Zahlungsverkehr: Zahlungsvorschläge Lieferanten, Lastschriften (SEPA), Kundengutschriften; Konfipay-Anbindung.
- Liquiditätsplanung: Schema, Planung bis, Intervall Monat/Woche/Tag, ab 1. oder ab heute, alle Betriebsstätten, Belege ab Datum; Quellen: OPs, offene Belege, periodische Werte.
- Übergabe Buchhaltung (für externe FiBu/DATEV): Übergabelauf nach Buchungsdatum, nur noch nicht übertragene Belege, Warnung bei offenen Vorperioden, Protokoll; DATEV-Buchungsdatenservice (Belege + Stammdaten), Digitale Betriebsprüfung (GDPdU-Export), euBP.
- Weitere: Anlagenverwaltung (AfA), Kassenbuch, Kostenrechnung (KSt/KTr/Profitcenter, Umlageschlüssel, Budgets), USt-Voranmeldung, ZM, OSS, Periodenabschluss/Jahresabschluss, Bilanz/GuV/BWA-Definition, Unternehmensbericht.

## Vertrieb / CRM
- Kontakt-Manager (CRM_Main): Schnellerfassung Adresse + Ansprechpartner + Kontakt in einem Dialog. Register: Übersicht, Verlauf, Kontakte, Notizen, Dokumente, Kennzeichen, Klassifizierung, VK-/EK-Belege, Projekte, Aufgaben, Chancen, Adressnachweis, Verträge, Leaddaten, Support, Branchen, Offene Posten, Termine, Social, Portalbesuche, Geräte, Ansprechpartner, VK-/EK-Positionen, Veranstaltungen → „360°-Sicht“ auf eine Adresse.
- Auftragschancen: Beschreibung, Adresse/Kunde, Vertreter, Referenzadresse, Chancenbewertung, Belegwert (Verknüpfung zu Angebot), Vertriebsphase, Status, Verlustgrund.
- Lead-Manager: Leadbezeichnung, Erstkontakt, Leadherkunft (Pflicht); Ergebnis „Verloren“ → Mitbewerber + Verlustgrund; Partner-Leads mit automatischer Weiterleitung; Karte.
- Weitere: Besuche/Touren/Verkaufsgebiete, Geo-Report, Dublettenprüfung, Vertriebspartner.

## Marketing
Zielgruppen, Serien-E-Mail/-briefe, Kampagnen-Manager (Zielgruppe → Kampagne → Aktionen; Adress-/Aktionsergebnisse grafisch), Newsletter mit Klick-Auswertung, Umfragen, Veranstaltungen mit Teilnehmerlisten, E-Mail-Sequenzen, Marketing-Score.

## Service
Service-Manager (Support_Supportmanager): Adresse + Ansprechpartner oben, darunter Supportfall; Register Fälle, Detaildaten, Aktionen, Verträge, Kennzeichen, Notizen, Dokumente, Kontakte, Klassifizierung, Projekte, Aufgaben, Verknüpfungen, Systeminfos, Adressdokumente, VK-/EK-Belege. Zeitkontingente + Zeitabrechnung, Wissensdatenbank, Geräteverwaltung (Seriennummern, Geräte-Service), Support-E-Mails.

## Projekte
Register: Grundlagen, Ressourcen, Abschnitte, Dokumente, Zeiten, Festkosten, VK-Belege, EK-Belege, Zeitstrahl, Zeitanteile, Kontakte, Kennzeichen, Statistik, Budgets, Aufgaben, Historie, Produktion, Chancen, Supportfälle, Termine, Umlageschlüssel. Projektnummer per „*“+Tab automatisch. Projektstatus frei definierbar (PreSales, In Bearbeitung, Beendet…).
Zeiterfassung: Zeiten auf Zeittyp/Projekt/Kunde/Belegposition; Abrechnung per Lauf; Aktivität steuert Abrechenbarkeit; Belegpositions-Abrechnung braucht Dienstleistungsartikel mit „Projekt-Zeitabrechnung“.

## Personal
Zeiterfassung je Mitarbeiter/Tag/Überlassung (Arbeitnehmerüberlassung!), Kunden- und Personalabrechnungsassistent, Abwesenheiten, Lohnarten, Zulagen, Qualifikationen.

## Plattform / Administration
- REST-API-Verbindungen: Benutzer+Kennwort je Verbindung, Eigentümer; primär zum Auslesen (Power BI). Außerdem SOAP-API mit Protokoll/Konfiguration.
- Dialogdesigner: je Dialog beliebig viele Designs (Standard / je Benutzer / je Gruppe); Felder ein-/ausblenden, Eigenschaften setzen; Vorschau.
- Berechtigungen: Betriebsstätten, Geschäftsjahre, Anwendungen, Methoden, Funktionalitäten, Stammdaten-Register, Workplace, Infoviews, Dialogfelder, Regeln, Datensatz-Lese-/Schreibrechte, Simulation eines Benutzers.
- Belegfreigaben / Freigaberouten: mehrstufig nach Betrag (z. B. >1000 € Gruppenleiter, >2000 € Abteilungsleiter), je Belegart/Projekt/Kostenstelle/Kostenträger, optional 4-Augen-Prinzip.
- Workflow-Folgeaktionen: Ereignis (z. B. „Verkaufsbeleg verarbeitet“) + Benutzer/Betriebsstätte + Bedingungen (Parameter, Operator, Vergleichswert, UND-Verknüpfung) → Aktion.
- Druck: Smart Reports (Sektionen/Felder/Formate, Datenfelder, Bilder, Barcodes 1D/2D, Übersetzungs-Platzhalter, WYSIWYG) + Report-Designer (eigene Auswertungen auf DataViews, Ausgabe Druck/Mail/PDF/HTML/Excel, erscheinen unter „Eigene Berichte“); Pooldruck, Stapeldruck, Beleg-Mailversand.
- E-Rechnung: Ausgang ZUGFeRD/XRechnung (je Kunde: Leitweg-ID, XRechnung ja/nein, Anhänge einbetten); Eingang: PDF hochladen → Einkaufsbeleg (Belegart, Status wählbar), auch per E-Mail-Rechnungseingang.
- Kommunikations-Manager: vollwertiger E-Mail-Client (eigene/gemeinsame Postfächer, IMAP/POP3/SMTP inkl. OAuth2, Regeln, Vorlagen, Textbausteine, Spamfilter, XSS-Filter), Mails werden Adressen zugeordnet.
- Webportal/Webshop: CMS mit Layoutdesigner, SEO-Assistent, Webshops (Betriebsstätte, Standardbelegart z. B. Auftragsbestätigung, Vorlagekunde, Startkatalog, Preisliste), Bewertungen, Forum, Besucherstatistik.
- Kasse (POS), Marktplätze (eBay, Amazon), Versand (Shipcloud), Intrastat, Exchange-Connector, Mobile-/Tablet-Apps (Lieferübersicht, Wareneingänge, Etiketten, Schnellinventur, Service-Berichte, Produktionsaufträge), DSGVO (Anonymisieren, Aufbewahrungsgründe), Änderungsprotokoll, Datenbankkopien.
- KI-Funktionen: AI Meldebestände, AI Zolltarifnummer, KI-Nutzungsstatistik.

## Oberfläche / Technik (Beobachtung)
- ASP.NET (.aspx/.asp), jede Anwendung als eigener Reiter (iframe) im „Workplace“; viele alte synchrone XHR-Aufrufe, Baum-Daten als XML. Datenbank-Mandant „wfData_demo“.
- Einheitliches Stammdaten-Muster „BaseEditMain“: oben Liste (Filter/Suche, Erweiterte Suche, Volltext, Kennzeichen, umschaltbare Ansichten, Paging), unten Reiter mit Detail; Knöpfe Neu/Kopieren/Löschen/Memotext + Menüs Daten/Info/Aktionen.
- Startseite mit konfigurierbaren Widgets (Periodenumsatz, Umsatzübersicht, Neukundenanteil, Top-Kunden, Top-Artikel, Auftragsbestand, Finanzinfo), Business-Suche über alles, Favoriten-Menü + Autostart, Fenster abdockbar auf zweiten Bildschirm.
- Einarbeitung: Willkommensvideo, „Mini-Tutorials“ (GuideChimp) je Rolle (Rolle „Geschäftsführung“: 10 Touren – Willkommen, Liquiditätsplanung, Unternehmensbericht, Kontakt-Manager, Verkaufsschnellerfassung, Adressenstamm, Artikel suchen/anlegen, Favoriten, Demo-Phase), Live-Chat (Crisp, „kein Chatbot“), Testphasen-Countdown (14 Tage).
- Freie Zusatzfelder („Kennzeichen“) an Artikeln, Adressen, Buchungen usw. – Typ Ja/Nein, Text, Zahl, Datum, Auswahl.
