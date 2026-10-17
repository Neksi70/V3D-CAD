# myfactory (Forterro) – Funktionsanalyse

Stand 17.10.2026. Grundlage: Demo-Zugang (demo.myfactory.myforterro.com, Mandant wfData_demo, 14 Tage Testphase), Einstiegsvideo, eingebaute Online-Hilfe.
Methode: nur angesehen und Masken/Hilfe ausgelesen. Nichts gespeichert, kein Code übernommen (gemeinsame Demo-Datenbank!).
Grundsatz wie bei SindriCAD/Layerling: **Ideen ja, Code und Texte nein.** Diese Notizen sind interne Referenz, keine Vorlage zum Abschreiben.

## Dateien
- `rohdaten/00-menuebaum.md` – alle 21 Bereiche mit Unterpunkten (~1.900 Einträge)
- `rohdaten/01-stammdaten-artikel-kunden-lieferanten.md` – alle Reiter und Felder inkl. interner Feldnamen
- `rohdaten/02-belege-und-ablaeufe.md` – Belegarten, Belegerfassung, Disposition, Lager, Produktion
- `rohdaten/03-fibu-crm-service-plattform.md` – FiBu, CRM, Service, Projekte, Admin/Plattform, Technik
- `rohdaten/einstiegsvideo.vtt` – Untertitel des Einstiegsvideos (6 min, Startseite/Suche/Favoriten/Mail/Kalender/Aufgaben)

## Das Produkt in einem Satz
Ein Komplett-ERP für kleine und mittlere Unternehmen im Browser: Warenwirtschaft, Finanzbuchhaltung, CRM, Produktion (PPS), Projekte, Service, Webshop/CMS, Kasse und Personal (Zeiterfassung/Überlassung) – alles auf **einer** Datenbank mit gemeinsamen Adressen und Artikeln.

## Die tragenden Ideen (das eigentlich Lernenswerte)
1. **Eine Adresse, viele Rollen.** Kunde, Lieferant, Interessent, Vertreter und Mitarbeiter hängen an einer gemeinsamen Adresse (eigene Adressnummer + rollenspezifische Nummer). CRM, Mails, Termine und Belege zeigen alle auf die Adresse → „360°-Sicht“ im Kontakt-Manager (23 Reiter: Belege, OPs, Chancen, Support, Verträge, Geräte …).
2. **Vorgang = Kette von Belegen.** Angebot → Auftragsbestätigung → Lieferschein → Rechnung (Einkauf: Preisanfrage → Bestellung → Wareneingang → Rechnungseingang). Folgebelege entstehen per „Weiterverarbeiten“ und übernehmen die Positionen. Die Belegart steuert die Nebenwirkungen: Lieferschein bucht Lager, Rechnung bucht Umsatz und Offene Posten, Rechnungseingang erzeugt einen Kreditoren-OP. Erlaubte Folgebelege und das Mengenverhalten (übernehmen/zurücksetzen/Vorzeichen umkehren) sind je Belegart konfigurierbar. 30 Verkaufs- und 13 Einkaufsbelegarten.
3. **„Verarbeiten“ als harter Schnitt.** Ein Beleg ist erst ein Entwurf (Status neu/geändert). „Verarbeiten“ vergibt die endgültige Nummer aus dem Nummernkreis und bucht Statistik, Lager und OPs. Danach sind Korrekturen nur noch per Storno-/Gutschriftbeleg möglich (GoBD).
4. **WYSIWYG-Belegerfassung.** Man tippt direkt in eine Ansicht, die wie der gedruckte Beleg aussieht (Briefkopf, Anschriftfeld, Positionen, Summen). Unten werden Bestand und Verfügbarkeit des gerade erfassten Artikels angezeigt.
5. **Ein einheitliches Stammdaten-Muster.** Oben eine Liste mit Suche, Volltext, Filter und umschaltbaren Ansichten, darunter Reiter mit dem Detail. Dazu die Knöpfe Neu/Kopieren/Löschen/Memotext und die Menüs Daten/Info/Aktionen. Dasselbe Muster gilt für über 100 Stammdaten.
6. **„Kennzeichen“ = frei definierbare Zusatzfelder.** Typen Ja/Nein, Text, Zahl, Datum und Auswahl, an Artikeln, Adressen, Buchungen usw. So entsteht Flexibilität ohne Programmierung.
7. **Preisfindung als eigenes Teilsystem.** Preislisten (je Artikel mehrere), Rabattlisten, Schwellenpreise, Preis-/Rabattmatrix (Artikel- × Kundenpreisgruppe), Kundenrabatt + Zusatzrabatt, Abweichungen je Belegart. Dazu Assistenten für Massenänderungen.
8. **Stapel-Prinzip für Massenläufe.** Vorschlag erstellen → bearbeiten → ausführen → Protokoll. So laufen Bestellvorschläge, Sammellieferungen, Sammelrechnungen, Mahnungen, Zahlungsvorschläge, Lastschriften, Provisionsabrechnung, Vertragsgenerierung und FiBu-Übergabe.
9. **Disposition.** Je Artikel Dispositionsmethode, Melde-/Maximalbestand, Beschaffungszeit, Mindestmenge und Faktor. Daraus entstehen Bestellvorschläge oder Fertigungsaufträge (Make-or-Buy). Neu: Meldebestände per KI aus der Lagerhistorie.
10. **Konfigurieren statt Programmieren.** Dialogdesigner (Masken je Benutzer/Gruppe), Workflow-Folgeaktionen (Ereignis + Bedingungen → Aktion), mehrstufige Belegfreigaben mit Betragsgrenzen und 4-Augen-Prinzip, Smart-Report-Designer für Belegformulare, Report-Designer für eigene Auswertungen, REST- und SOAP-API.
11. **Deutsche Pflichtthemen eingebaut.** ZUGFeRD/XRechnung (Ausgang + Import), DATEV-Übergabe und Buchungsdatenservice, USt-Voranmeldung/ZM/OSS, GoBD-Export (Digitale Betriebsprüfung), SEPA, Intrastat, DSGVO-Anonymisierung.
12. **Einarbeitung als Produktbestandteil.** Willkommensvideo, rollenbasierte Mini-Touren (GuideChimp), Live-Chat mit Menschen („kein Chatbot“), Testphasen-Countdown mit Beratungs-Link. Das ist der Verkaufstrichter der Demo.

## Schwächen (Ansatzpunkte für etwas Eigenes)
- Technik sichtbar alt: ASP.NET WebForms, jede Anwendung als iframe-Reiter, synchrone XHR, tabellenbasierte Layouts. Bedienung per Automatisierung zäh, auf dem Handy kaum nutzbar (eigene Mobile-Apps nur für Teilbereiche).
- Enorme Breite (1.546 Anwendungen) → hohe Einstiegshürde. Myfactory kompensiert das mit Favoriten, Rollen-Touren und Beratung.
- Einstellungen zum Belegfluss liegen verstreut (Belegart, Folgebelege, Konfigurationsdialoge, Administration).

## Bezug zu deinen eigenen Tools (Vorschlag)
| myfactory-Bereich | bei dir vorhanden | lohnende Idee |
|---|---|---|
| Verkaufsbelege / E-Rechnung | VolmeRechnung (Angebote/Rechnungen) | Belegkette mit „Weiterverarbeiten“, Verarbeiten-Schnitt + Storno statt Ändern, XRechnung/ZUGFeRD-Ausgang, Sammelrechnung |
| Einkauf / Disposition | Marchi Einkauf (Preisspiegel) | Preisanfrage → Bestellung → Wareneingang → Rechnungseingang als Kette, E-Rechnung-Import, Meldebestand/Bestellvorschlag |
| Kontakt-Manager / CRM | V3D Kurse, V3D Mail | gemeinsame Adresse mit Rollen, Mail-Zuordnung zur Adresse (myfactory macht das wie du), Chancen/Leads |
| Lager | V3D Vorrat, Filament | Lagerbuchung als Folge von Belegen, Inventur, Chargen/MHD |
| Webshop | VolmeShop | Shop-Bestellung → Belegart „Auftragsbestätigung“ (reserviert Bestand), Vorlagekunde |
| Projekte / Zeiterfassung | – | Zeiten auf Projekt/Belegposition, Abrechnungslauf |
| Workflow / Freigaben | – | Ereignis → Bedingung → Aktion als kleines Regelsystem |

Nächster sinnvoller Schritt: einen Kernbereich festlegen (z. B. Belegkette Verkauf für VolmeRechnung oder Einkaufskette für Marchi). Dazu ein eigenes Datenmodell entwerfen (Adresse, Rolle, Artikel, Beleg, Belegposition, Belegverknüpfung, Buchung).
