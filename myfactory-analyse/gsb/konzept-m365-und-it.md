# GSB – E-Mail-Anbindung (Microsoft 365) & IT-Betreuung (Entwurf 22.10.2026)

## Ausgangslage (Tommi, 22.10.)
- Microsoft 365, Postfächer: **3 persönliche**, **info@gsb-hagen.de**, **anfrage@gsb-hagen.de**, demnächst **auftrag@gsb-hagen.de**
- Administration bisher durch einen externen IT-Betreuer → **soll künftig von Volme 3D übernommen werden können**

---

## Teil A – E-Mail im ERP (Microsoft Graph)

### Postfächer
| Postfach | Art (Empfehlung) | Rolle im ERP |
|---|---|---|
| 3 × persönlich | Benutzerpostfach (lizenziert) | eigene Korrespondenz, wird Kunden/Projekten automatisch zugeordnet |
| info@ | **freigegebenes Postfach** (kostet keine Lizenz) | allgemeiner Eingang, Zuordnung zu Adresse/Projekt |
| anfrage@ | freigegebenes Postfach | **Anfragen-Eingang** im ERP: Anfrage → mit einem Klick Kunde erkennen/anlegen → **Angebot-Entwurf**, Anhänge (STEP/PDF/Zeichnung) wandern zum Vorgang |
| auftrag@ (neu) | freigegebenes Postfach | **Auftragseingang**: Bestellung des Kunden → **Auftragsbestätigung-Entwurf**; Bestellnummer des Kunden landet in „Ihre Bestellung“ |

### Funktionen
1. **Automatische Zuordnung** eingehender und gesendeter Mails: Absender → Ansprechpartner/Adresse; Beleg- oder Projektnummer im Betreff (z. B. „AN-26-0012“, „P-26-0003“) → direkt an Beleg/Projekt. Im Kunden, im Projekt und im Beleg gibt es einen Reiter „E-Mails“.
2. **Belege aus dem ERP versenden** (Angebot, AB, Lieferschein, Rechnung, Terminbericht-PDF): Die Mail geht über das passende Postfach, je Belegart einstellbar, z. B. Angebot von anfrage@, AB/Rechnung von auftrag@. Sie liegt danach ganz normal in Outlook unter „Gesendet“.
3. **Outlook-Seitenleiste** (Add-in) für alle Benutzer, zentral über das Microsoft-365-Admin-Center verteilt: Beim Lesen einer Mail sieht man rechts Kunde, offene Angebote und Aufträge, Projekte mit Termin-Ampel. Knöpfe: „Zum Projekt ablegen“, „Angebot anlegen“, „Problem/Termin vermerken“.
4. Optional: **Abnahme- und Liefertermine** aus dem Zeitstrahl in einen gemeinsamen Outlook-Kalender.

### Technik & Sicherheit
- **App-Registrierung „V3D ERP“** im Microsoft-365-Konto von GSB (Entra ID), Anwendungsrechte *Mail.ReadWrite* und *Mail.Send* (optional *Calendars.ReadWrite*). Einmalige **Administratorzustimmung** nötig, durch den bisherigen IT-Betreuer oder künftig Volme 3D.
- **Zugriff begrenzen:** Über Exchange „RBAC für Anwendungen“ darf die App **nur diese 6 Postfächer** lesen und senden, nicht alle Postfächer der Firma.
- Anmeldung der App per **Zertifikat** (kein Kennwort). Zertifikat und Daten liegen **nur auf dem GSB-Server**.
- Abgleich alle 1–2 Minuten per Änderungsabfrage (Delta), keine öffentliche Schnittstelle am GSB-Server nötig.
- **Datenschutz:** Die Mails werden ausschließlich auf dem GSB-Server verarbeitet. Bei der Entwicklung arbeitet Volme 3D mit einem **Testpostfach mit erfundenen Mails** (z. B. erp-test@gsb-hagen.de oder ein eigener Test-Mandant). Echte Mails sieht der KI-Assistent nie (AVV Anlage 3).

### Ablauf
1. Freigegebenes Testpostfach + App-Registrierung (1 Termin mit dem Admin, ca. 1 Std.)
2. Entwicklung gegen das Testpostfach: Zuordnung, Anfragen-/Auftragseingang, Versand
3. Outlook-Seitenleiste
4. Freischalten der echten Postfächer, zuerst anfrage@, dann die übrigen

---

## Teil B – IT-Betreuung durch Volme 3D (Übernahme vom bisherigen IT-Betreuer)

### Leistungsumfang (Vorschlag, als Baukasten)
| Bereich | Inhalt |
|---|---|
| **Microsoft 365** | Benutzer anlegen/sperren, Lizenzen, Postfächer und freigegebene Postfächer (z. B. auftrag@), Weiterleitungen, Verteiler, Teams/SharePoint-Grundstruktur |
| **Sicherheit** | Mehrfaktor-Anmeldung für alle, Notfall-Admin-Konto, Basisschutz gegen Phishing/Spam, Prüfung der Anmeldeprotokolle |
| **Domain & Mail-Zustellung** | DNS bei gsb-hagen.de: SPF, DKIM, DMARC (weniger Spam-Verdacht bei Kunden) |
| **Datensicherung** | Microsoft 365 hat **keine** echte Langzeit-Sicherung → zusätzliche Sicherung von Postfächern/OneDrive/SharePoint; ERP-Server-Sicherung (siehe Serverangebot), regelmäßiger Rücksicherungstest |
| **Server (V3D ERP)** | Betrieb, Updates, Überwachung, Sicherung – im Wartungsvertrag des Servers |
| **Arbeitsplätze** (optional) | Windows-Updates, Virenschutz, Einrichtung neuer PCs, Drucker |
| **Netzwerk** (optional) | Router/Firewall, WLAN, Fernzugang |
| **Dokumentation** | Übersicht aller Konten, Lizenzen, Geräte, Zugänge, Notfallplan – gehört GSB |

### Übergabe vom bisherigen IT-Betreuer (Checkliste)
- [ ] Globaler Administrator für Microsoft 365 (Volme 3D bekommt **eigenes** Admin-Konto, keine geteilten Zugänge)
- [ ] **Notfall-Admin-Konto bei GSB** (versiegelt, nur für den Notfall)
- [ ] Zugang Domain-Verwaltung/DNS (Registrar), Router/Firewall, ggf. vorhandene Server/NAS
- [ ] Lizenzübersicht, Laufzeiten, über wen gekauft (Direkt bei Microsoft oder Händler?)
- [ ] Vorhandene Dokumentation, Sicherungen, Sonderlösungen
- [ ] Übergabeprotokoll mit Datum; alte Zugänge des bisherigen Betreuers danach entfernen

### Vertrag & Abrechnung (vor Angebot klären)
- Monatliche **Pauschale** (z. B. je Benutzer/Arbeitsplatz) für Pflege und Überwachung, darüber hinaus **Stundensatz**. Reaktionszeiten festlegen (z. B. Störung am selben Werktag).
- Laufzeit/Kündigung klar ins Angebot. Firmenkunde, also kein Widerrufsrecht.
- **AVV erweitern:** Bei IT-Betreuung hat Volme 3D Zugriff auf alle Daten inkl. E-Mails → Gegenstand in § 1/§ 2 ergänzen (Administration Microsoft 365, Arbeitsplätze, Server). Unterauftragnehmer (z. B. Backup-Anbieter) in Anlage 2.
- **Absicherung von Volme 3D:** Vor Übernahme der Administration eine **IT-/Vermögensschaden-Haftpflicht** prüfen. Ein Admin-Fehler (z. B. gelöschtes Postfach) kann teuer werden.
- **USt/Kleinunternehmergrenze** im Blick behalten (Hardware + Dienstleistung + Pauschalen).
