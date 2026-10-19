# Vertrag zur Auftragsverarbeitung gemäß Art. 28 DSGVO – ENTWURF

> **Hinweis:** Entwurf als Arbeitsgrundlage, keine Rechtsberatung. Vor der Unterschrift bitte prüfen lassen (z. B. Steuerberater, IHK-Muster abgleichen oder Anwalt). Felder `[ … ]` ausfüllen.

**zwischen**

[Firma des Bekannten], [Anschrift], vertreten durch [Name]
– nachfolgend **„Auftraggeber“** –

**und**

Volme 3D, [Inhaber/Rechtsform], [Anschrift]
– nachfolgend **„Auftragnehmer“** –

## § 1 Gegenstand und Dauer
(1) Der Auftragnehmer analysiert die Nutzung der ERP-Software „myfactory“ beim Auftraggeber. Er entwickelt eine Ersatzlösung und übernimmt auf Weisung die Daten des Auftraggebers in diese Lösung (Migration).
(2) Der Vertrag beginnt mit Unterzeichnung und endet mit Abschluss des Projekts, spätestens am [Datum]. Er verlängert sich, wenn sich ein Betriebs- oder Wartungsvertrag für die Ersatzlösung anschließt; dafür gilt dann gesonderte Regelung.

## § 2 Art, Zweck und Umfang der Verarbeitung
(1) **Zweck:** Analyse von Programmstruktur und Arbeitsabläufen, später Übernahme der Daten in die Ersatzlösung.
(2) **Art:** Lesender Zugriff auf myfactory über einen eigenen Benutzer mit Leserechten. Später Entgegennahme von Datenexporten, Umwandlung und Import.
(3) **Datenminimierung:** In der Analysephase hält der Auftragnehmer nur Strukturinformationen fest (Masken, Felder, Abläufe, Mengengerüst). Personenbezogene Inhalte werden weder kopiert noch gespeichert.
(4) **Kategorien von Daten:** Stammdaten (Name, Anschrift, Kontaktdaten), Ansprechpartner, Vertrags- und Belegdaten, Zahlungsdaten (Bankverbindung, offene Posten), Kommunikationsdaten (E-Mails im Kommunikations-Manager), ggf. Mitarbeiterdaten [nur falls Personal-Modul genutzt].
(5) **Betroffene Personen:** Kunden, Interessenten, Lieferanten und deren Ansprechpartner, Mitarbeiter des Auftraggebers.

## § 3 Weisungen
Der Auftragnehmer verarbeitet Daten nur auf dokumentierte Weisung des Auftraggebers (E-Mail genügt). Hält er eine Weisung für rechtswidrig, teilt er das unverzüglich mit.

## § 4 Pflichten des Auftragnehmers
(1) Vertraulichkeit: Alle Personen mit Zugriff sind zur Vertraulichkeit verpflichtet.
(2) Technische und organisatorische Maßnahmen gemäß **Anlage 1**.
(3) Unterstützung des Auftraggebers bei Anfragen Betroffener (Auskunft, Löschung usw.) und bei Meldepflichten.
(4) Meldung von Datenschutzverletzungen unverzüglich, spätestens binnen 24 Stunden nach Kenntnis.
(5) Der Benutzerzugang wird nicht weitergegeben. Zugangsdaten werden sicher aufbewahrt (Passwortmanager).

## § 5 Unterauftragsverarbeiter
(1) Der Auftraggeber genehmigt die in **Anlage 2** genannten Unterauftragsverarbeiter.
(2) Weitere oder geänderte Unterauftragsverarbeiter werden vorher mitgeteilt. Der Auftraggeber kann widersprechen.

## § 6 Kontrollrechte
Der Auftraggeber darf die Einhaltung dieses Vertrags nach Absprache prüfen. Der Auftragnehmer erteilt die nötigen Auskünfte.

## § 7 Löschung und Rückgabe
Nach Projektende löscht der Auftragnehmer alle personenbezogenen Daten des Auftraggebers (Exporte, Zwischendateien, Testkopien) oder gibt sie zurück. Er bestätigt die Löschung schriftlich. Der Analyse-Benutzer in myfactory wird gesperrt.

## § 8 Haftung, Schlussbestimmungen
Es gilt Art. 82 DSGVO. Änderungen bedürfen der Textform. Ist eine Bestimmung unwirksam, bleibt der übrige Vertrag wirksam.

[Ort, Datum] ______________________  [Ort, Datum] ______________________
Auftraggeber                                      Auftragnehmer

---

## Anlage 1 – Technische und organisatorische Maßnahmen (Kurzfassung)
- **Zugang:** eigener Analyse-Benutzer nur mit Leserechten, zeitlich befristet, nach Projektende gesperrt
- **Zugriff:** Zugangsdaten im Passwortmanager, Arbeitsrechner mit Festplattenverschlüsselung und Bildschirmsperre
- **Übertragung:** Datenexporte nur verschlüsselt (HTTPS/SFTP oder verschlüsseltes Archiv), nicht per unverschlüsselter E-Mail
- **Speicherung:** Exporte nur auf dem Server des Auftragnehmers in [Rechenzentrum/Standort Deutschland] in einem gesonderten, zugriffsbeschränkten Verzeichnis; keine Kopien auf USB-Sticks oder in privaten Cloud-Speichern
- **Trennung:** Testsysteme mit echten Daten nur intern erreichbar, nicht öffentlich
- **Datensicherung:** [z. B. tägliche verschlüsselte Sicherung]
- **Löschung:** nach Projektende vollständig, mit Bestätigung

## Anlage 2 – Unterauftragsverarbeiter
| Anbieter | Leistung | Ort |
|---|---|---|
| [Hoster, z. B. netcup GmbH] | Server für Ersatzlösung und Testdaten | Deutschland |
| Anthropic (KI-Assistent „Claude“) | Unterstützung bei Analyse und Entwicklung: Bildschirminhalte und Dateien, die der Assistent ansieht, werden an den Anbieter übertragen | USA (EU-Standardvertragsklauseln / Data Privacy Framework – **vorher prüfen**) |

> **Wichtig zu Anlage 2:** Wenn ich (Claude) mich in seinem myfactory umsehe, werden die angezeigten Bildschirminhalte an Anthropic übertragen. Zwei saubere Möglichkeiten:
> 1. **Offen regeln:** Anthropic wie oben als Unterauftragsverarbeiter aufnehmen. Der Bekannte stimmt bewusst zu; die passenden Vertragsunterlagen (DPA) von Anthropic dazulegen.
> 2. **Vermeiden:** Ich schaue nur Masken an, auf denen keine personenbezogenen Daten stehen, etwa Konfiguration, Belegarten, Grundlagen und leere Neuanlage-Masken. Kundenlisten öffnest du selbst und beschreibst mir nur den Aufbau. Bei Migrationsdaten verarbeite ich keine Echtdaten, sondern schreibe nur die Import-Skripte. Die laufen dann bei dir auf dem Server.
>
> Variante 2 ist datenschutzrechtlich am einfachsten und reicht für unser Ziel fast vollständig.
