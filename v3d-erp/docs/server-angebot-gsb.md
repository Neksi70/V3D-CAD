# Server für GSB – Vorschlag & Kalkulation (Entwurf 22.10.2026)

> **Richtwerte!** Die Hardwarepreise stammen aus Händlerlistungen ohne gesichertes Datum (Quellen unten). Vor dem Angebot an Tommi
> beim Händler aktuell konfigurieren und dabei **Betrag, Abrechnungsweise, Lieferzeit und Gewährleistung** prüfen.
> Größe noch unter Vorbehalt: Benutzerzahl, Mailsystem (M365?) und vorhandene IT kommen mit Tommis Antworten.

## 1. Was der Server leisten muss
- V3D ERP (Webanwendung) + PostgreSQL für ca. 3–10 gleichzeitige Benutzer im Haus
- Dokumente/Anhänge (PDF-Belege, Zeichnungen) – Annahme: bis 500 GB in 5 Jahren
- Später: Outlook-/Microsoft-365-Anbindung, Kundenlink für den Projekt-Zeitstrahl (nur dieser Teil von außen erreichbar)
- GoBD: Belege 8–10 Jahre unveränderbar und lesbar aufbewahren → Datensicherung mit Versionen + außer Haus

## 2. Empfohlene Ausstattung
| Teil | Empfehlung | Warum |
|---|---|---|
| Server | Tower-Server, z. B. **Dell PowerEdge T160** oder Lenovo ThinkSystem ST50 V3: Xeon E-2400 (4–6 Kerne), **32 GB ECC-RAM**, **2 × 960 GB Enterprise-SSD gespiegelt (RAID 1)**, 3 Jahre Vor-Ort-Service | ECC + Spiegelung = keine stillen Datenfehler, eine SSD darf ausfallen. Herstellerservice statt Bastel-PC. |
| USV | **APC Back-UPS Pro 900** (BR900MI) mit USB-Abschaltung | Stromausfall → Server fährt sauber herunter, Datenbank bleibt heil |
| Sicherung im Haus | **Synology DS224+** mit 2 × 4 TB (gespiegelt), anderer Raum/Brandabschnitt als der Server | stündliche Datenbank-Sicherung + tägliche Dateisicherung mit Versionen (30 Tage, 12 Monate) |
| Sicherung außer Haus | verschlüsselte Sicherung in deutsches Rechenzentrum (z. B. Hetzner Storage Box) **oder** zwei rotierende USB-Platten | Schutz gegen Brand, Diebstahl, Verschlüsselungstrojaner |
| Software | Ubuntu Server LTS, PostgreSQL, nginx mit TLS, automatische Sicherheitsupdates, restic-Sicherung, Überwachung | alles quelloffen, keine Lizenzkosten |
| Fernwartung | verschlüsselter Zugang nur für Volme 3D (WireGuard/Tailscale), kein offener Port | Wartung ohne Anfahrt, nichts Unnötiges im Internet |

## 3. Kalkulation (Richtwerte, netto)
| Posten | EK ca. | VK-Vorschlag |
|---|---|---|
| Server T160, 32 GB ECC, 2 × 960 GB SSD, 3 J. Service | 1.500 – 2.200 € | 2.400 € |
| USV APC BR900MI | 210 – 260 € | 320 € |
| NAS DS224+ inkl. 2 × 4 TB NAS-Platten | 550 – 650 € | 790 € |
| Kleinteile (Netzwerkkabel, Steckdosenleiste) | 50 € | 80 € |
| **Hardware gesamt** | **≈ 2.300 – 3.150 €** | **3.590 €** |
| Einrichtung: Betriebssystem, Härtung, Datenbank, Sicherung, USV, Fernwartung, Test der Rücksicherung | – | 8 Std. × [Stundensatz] |
| Installation vor Ort + Einweisung | – | 4 Std. × [Stundensatz] |
| Datenübernahme aus myfactory (Probelauf, Abgleich, Übernahme zum Stichtag) | – | nach Aufwand, Schätzung 6–10 Std. |
| **Wartungsvertrag** (Updates, Sicherung prüfen, Rücksicherungstest je Quartal, Überwachung, Fernwartung bis X Std./Monat) | – | [Betrag] € / Monat |
| Externe Sicherung (Storage Box o. Ä.) | ca. 4–15 € / Monat beim Anbieter | durchreichen oder im Wartungsvertrag |

Die Software (V3D ERP: Lizenz/Miete) und der Entwicklungsaufwand sind **nicht** enthalten. Das muss separat entschieden werden: Kaufpreis plus Wartung oder Monatsmiete.

## 4. Abrechnung & Vertrag – vor dem Angebot klären
- **Hardware:** Einmalig mit Lieferung oder Anzahlung bei Bestellung? Eigentumsvorbehalt bis zur Zahlung.
- **Wartung:** monatlich oder jährlich im Voraus? Mindestlaufzeit (z. B. 12 Monate), Kündigungsfrist. Firmenkunde, also **kein Widerrufsrecht** → Laufzeit klar ins Angebot schreiben.
- **Externe Sicherung:** Läuft der Vertrag beim Anbieter auf GSB (empfohlen, Daten gehören GSB) oder auf Volme 3D (dann AVV-Anlage 2 ergänzen)?
- **USt:** Falls Volme 3D noch Kleinunternehmer (§ 19 UStG) ist, ohne USt-Ausweis anbieten. Bei Hardware-Weiterverkauf prüfen, ob die Umsatzgrenze dadurch gerissen wird.
- **Gewährleistung:** Herstellergarantie (3 J. Vor-Ort) läuft auf GSB als Eigentümer. Volme 3D übernimmt die Abwicklung im Wartungsvertrag.

**Pflichtkontrolle vor Bestellung:** Betrag ☐ · Abrechnungsperiode ☐ · Laufzeit/Kündigung ☐ · Lieferzeit ☐ · Gewährleistung/Service-Level ☐

## 5. Offene Fragen (aus der WhatsApp an Tommi)
- Anzahl Benutzer, Microsoft 365 ja/nein, vorhandene Server/NAS/Firewall, Internetanschluss (feste IP?), Serverraum/Klima
- Soll der Kundenlink zum Zeitstrahl über den GSB-Anschluss laufen oder über einen kleinen vorgeschalteten Cloud-Server?

## Quellen der Richtwerte (Stand der Listungen unklar)
- Dell PowerEdge T160 bei Servermall: https://servermall.com/de/sets/dell-poweredge-t160-server/ (1.464 € netto Grundausstattung), Ausstattung laut https://www.storagereview.com/pt/review/dell-poweredge-t160-server-review
- APC BR900MI: https://www.saturn.de/de/product/_apc-br900mi-usv-schwarz-168518347.html (292,45 € brutto), https://www.ebay.de/p/4033842411
- Synology DS224+: https://www.computerbase.de/2023-08/synology-ds224-test-nas/ (UVP 355,81 € zum Start 2023), https://www.mediamarkt.de/de/product/_synology-ds224-0-tb-25-zoll-123405440.html
