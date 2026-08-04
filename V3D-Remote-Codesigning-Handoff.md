# V3D Remote — Code-Signing-Zertifikat besorgen (Übergabe an Claude Cowork)

Stand: 2026-08-04. Auftraggeber: Volker Isken (Volme3D / Volme 3D Akademie), Hagen.

## Ziel in einem Satz

Ein Code-Signing-Zertifikat einer echten Zertifizierungsstelle kaufen, die Identitätsprüfung
durchziehen und damit die Datei `V3D-Remote.exe` signieren, damit Windows beim Start nicht
mehr „Unbekannter Herausgeber" meldet. Budget: max. 129 € (harte Grenze, siehe „Budget").
Der bisherige Weg über Microsoft Azure Artifact Signing wird abgebrochen — zu langwierig.

## Was V3D Remote ist

Ein Fernwartungs-Tool für Kunden der Volme3D-Apps (V3D CAD u. a.): der Kunde lädt eine
23-MB-EXE, startet sie, nennt seine ID, der Support verbindet sich und hilft per Fernsteuerung.
Technisch ein gebrandeter RustDesk-Client (Open Source, AGPL-3.0), der gegen einen
selbst gehosteten RustDesk-Server (Docker auf dem Server „v3da") arbeitet.
Branding ist fertig und getestet: eigenes Icon, eigenes Logo, Name „V3D Remote",
Verbindung nur nach Klick auf „Annehmen".

Verteilt wird die EXE über:
- den Button „Fernwartung" in den Web-Apps (lädt `/V3D-Remote.exe` vom eigenen Server)
- GitHub-Release: https://github.com/Neksi70/creator/releases/tag/v1.0-test

Gebaut wird sie per GitHub Actions im Repo Neksi70/creator (Workflow `generator-windows.yml`),
GitHub-Konto: Neksi70.

## Entscheidung (vom Auftraggeber bereits getroffen)

Gekauft wird: **Certum Cloud Code Signing für Einzelentwickler** (polnische/europäische CA,
Schlüssel liegt im Cloud-HSM, es wird KEIN USB-Token verschickt).

- Händler: SSLmentor, https://www.sslmentor.de/certum/certumcodecloudindividual
- Preis: 117 € netto für 1 Jahr (2 Jahre 109 €/Jahr, 3 Jahre 97 €/Jahr — Mehrjahres-Produkte
  brauchen wegen der 459-Tage-Regel zwischendurch kostenlose Neuausstellungen)
- Nur an Privatpersonen, Rechnung läuft auf den Privatnamen, NICHT auf die Firma
- Im Zertifikat steht dann als Herausgeber: Vor-/Nachname, Stadt, Bundesland, Land
- Alternativ derselbe Artikel direkt bei Certum: https://shop.certum.eu/ (dort teurer)

Bewusst NICHT genommen:
- Certum „Open Source Code Signing" (49 €): Herausgeber hieße „Open Source Developer …" und
  Certum widerruft das Zertifikat bei kommerzieller Nutzung. Zu riskant.
- Firmen-OV auf „Volme 3D Akademie" (ab 155 €): über Budget.
- Azure Artifact Signing: läuft seit 2026-07-04 in der Identitätsprüfung fest, wird abgebrochen.

## Budget

Limit 129 €. 117 € netto + 19 % USt sind ca. 139 € brutto — das liegt knapp darüber.
Vor dem Kauf beim Auftraggeber kurz rückfragen, sobald der echte Endbetrag im Warenkorb steht
(Preis kann je nach Aktion/Umsatzsteuer-Behandlung abweichen). Nichts über 139 € brutto
ohne ausdrückliche Freigabe kaufen. Zahlung mit Karte des Auftraggebers — er muss den
Bezahlschritt selbst machen oder die Daten freigeben.

## Daten, die für Bestellung + Prüfung gebraucht werden

- Name: Volker Isken
- Adresse: Tückinger Höhe 15, 58135 Hagen, NRW, Deutschland
- E-Mail: v.c.isken@gmail.com
- Firma (nur falls doch irgendwo gefragt): Volme 3D Akademie, Kleinunternehmer,
  Ausweis über Steuernummer (keine USt-IdNr vorhanden)

Certum verlangt für dieses Produkt:
1. Online-Identitätsprüfung: Foto/Scan des Ausweises + Gesichts-Scan (läuft per Handy)
2. Adressnachweis: Nebenkostenabrechnung, Strom-/Gasrechnung oder Mietvertrag,
   Name + Adresse müssen zur Bestellung passen
3. ggf. Nachforderungen des Validierungsteams

Diese Dokumente hat nur der Auftraggeber — Cowork soll ihn gezielt danach fragen
(„bitte PDF/Foto von X hochladen"), nicht selbst irgendwo suchen.
Dauer laut Händler: ab 3 Werktage nach vollständiger Einreichung.

## Ablauf, Schritt für Schritt

1. Bestellung bei SSLmentor.de anlegen (Produkt „Certum Cloud CODE Signing Individual",
   Laufzeit 1 Jahr, sofern der Auftraggeber nicht 2 Jahre will — 2 Jahre sind pro Jahr
   günstiger, kosten aber mehr auf einmal). Endbetrag vor dem Bezahlen bestätigen lassen.
2. Bezahlen (durch den Auftraggeber).
3. Certum-Konto wird angelegt; Aktivierungs-Mail kommt an v.c.isken@gmail.com.
4. Identitätsprüfung + Adressnachweis einreichen, Rückfragen des Validierungsteams beantworten.
5. Nach Ausstellung: SimplySign einrichten
   - SimplySign-App auf dem Handy installieren (Android/iOS) — liefert die 6-stelligen Codes
   - SimplySign Desktop auf dem Windows-PC installieren — das Programm täuscht Windows einen
     Kartenleser mit Kryptokarte vor, dadurch sieht `signtool` das Zertifikat
   - Anleitung: https://files.certum.eu/documents/manual_en/CS-Code_Signing_in_the_Cloud_Certificate_activation.pdf
6. EXE signieren (auf dem Windows-Rechner, SimplySign Desktop muss verbunden sein):

   ```
   signtool sign /n "Volker Isken" /fd sha256 /tr http://time.certum.pl /td sha256 V3D-Remote.exe
   signtool verify /pa /v V3D-Remote.exe
   ```

   Der Zeitstempel (`/tr`) ist Pflicht — sonst gilt die Signatur nach Ablauf des Zertifikats
   als ungültig. Prüfen lässt sich das Ergebnis auch per Rechtsklick auf die EXE →
   Eigenschaften → „Digitale Signaturen".
7. Signierte EXE zurückspielen (dafür bitte an Claude Code auf dem Server v3da übergeben):
   - ersetzt `/home/v3da/V3D-Remote.exe` (das ist die Datei hinter dem Fernwartungs-Button)
   - GitHub-Release-Asset `v1.0-test` im Repo Neksi70/creator ersetzen
8. Azure aufräumen, damit dort keine Kosten mehr auflaufen: im Azure-Portal
   (Konto v.c.isken@gmail.com, Subscription 3aa1bbd1-f9fa-4d72-8285-f12ced056957) den
   Artifact-Signing-Account `v3dremote-signing` und die Ressourcengruppe `v3d-signing` löschen
   und die laufende Identitätsprüfung zurückziehen. Vorher Freigabe des Auftraggebers holen.

## Wichtig zu wissen (bitte dem Auftraggeber so sagen)

- Die Signatur beseitigt „Unbekannter Herausgeber" — der Name „Volker Isken" steht dann als
  Herausgeber in der Windows-Abfrage.
- Der SmartScreen-Hinweis „Der Computer wurde durch Windows geschützt" verschwindet NICHT
  sofort. Reputation baut sich über Downloads auf. Seit den Windows-Updates im Frühjahr 2026
  gilt das auch für teure EV-Zertifikate — deshalb lohnt der Aufpreis für EV nicht.
- Code-Signing-Zertifikate sind seit 27.02.2026 maximal 459 Tage gültig.

## Was Cowork NICHT machen soll

- Nichts am Build-Workflow oder am Server ändern — das macht Claude Code auf v3da.
- Keine Zahlung ohne ausdrückliche Freigabe auslösen.
- Keine Ausweis-/Rechnungsdokumente irgendwo anders hochladen als bei Certum/SSLmentor.

## Rückgabe an Claude Code (Server v3da)

Wenn das Zertifikat da ist bzw. die signierte EXE vorliegt, an Claude Code melden:
- signierte `V3D-Remote.exe` (oder Info, wo sie liegt)
- exakter Zertifikats-/Herausgebername, Laufzeit, Certum-Kontodaten-Ort
Dann werden Serverdatei, GitHub-Release und ggf. der Signier-Schritt im Workflow nachgezogen.
