# V3D Mail

Eigener Mail-Client für Volme 3D — ersetzt Outlook/M365 als **Programm**.
Die Postfächer bleiben unangetastet beim bisherigen Hoster; V3D Mail spricht
ganz normal IMAP und SMTP.

* Dienst: `volmemail.service`, Port **8783** (nur 127.0.0.1, HTTPS mit Tailscale-Zertifikat)
* Öffentlich: `https://v3da.tailf05fe9.ts.net/mail/`
* Keine Abhängigkeiten — reine Python-Standardbibliothek (`imaplib`, `smtplib`, `email`)

## Dateien

| Datei | Zweck |
|---|---|
| `server.py` | Dienst: HTTP-API, IMAP-Verbindungen, SMTP-Versand, HTML-Säuberung |
| `mail.html` | Oberfläche, eine Datei, Vanilla JS |
| `test_server.py` | 41 Tests ohne echtes Postfach (IMAP wird gestubbt) |
| `smoke_ui.py` | Browser-Durchlauf am Rechner: Anmeldung, Postfächer, Lesen, Bilder |
| `smoke_handy.py` | Browser-Durchlauf im Handy-Format: Zurück-Knopf und Zurück-Geste |
| `smoke_ziehen.py` | Ziehen zum Aktualisieren: Fingergeste auf der Nachrichtenliste |
| `smoke_windows.py` | Installierbarkeit als Windows-App und mailto-Anbindung |
| `smoke_signatur.py` | Signatur-Editor und Aufbau der versendeten Nachricht |
| `smoke_bilder.py` | Bilder im Text: Anzeige (cid und verlinkt) und Speichern |
| `werkzeug/icons_bauen.py` | erzeugt die PNG-Symbole für das Manifest |

Zugangsdaten liegen **nicht** hier, sondern in `~/.config/v3dmail/config.json`
(Modus 0600). Dort steht auch der Anmeldeschlüssel (`adminKey`).

## Bedienung

Anmelden mit dem Schlüssel, dann **Konten → + Konto hinzufügen**. „Server suchen"
geht dieselben Wege wie Outlook und Thunderbird, der Reihe nach:

1. Anbieterdatenbank von Thunderbird (ISPDB)
2. Autodiscover auf `autodiscover.<domain>` und `<domain>` — Microsofts Verfahren
3. Autoconfig beim Hoster (`autoconfig.<domain>`, `.well-known`)
4. **Autodiscover über den SRV-Eintrag `_autodiscover._tcp.<domain>`** — der Weg für
   fremdgehostete Domains. `volme3dakademie.de` etwa hat keine eigenen
   `imap.`-Namen; der SRV-Eintrag zeigt auf `autodiscover.goneo.de`, und der
   verrät `imap.goneo.de:993` und `smtp.goneo.de:465`.
5. SRV-Einträge nach RFC 6186 (`_imaps._tcp`, `_submissions._tcp`)
6. Über den MX-Eintrag zum Hoster (`mx01.goneo.de` → `goneo.de`) und dort erneut suchen
7. Zuletzt die üblichen Servernamen abtasten

Die benutzte Quelle steht unter dem Adressfeld; scheitert alles, listet die Antwort
unter `tried` die einzelnen Versuche. SRV- und MX-Auflösung macht ein kleiner
eigener DNS-Client in `server.py` — die Standardbibliothek kann nur A/AAAA.

„Prüfen & speichern" meldet sich testweise an, bevor gespeichert wird.

Tastatur: `n` neue Nachricht, `r` antworten, `j`/`k` blättern, `Entf` löschen, `Esc` schließen.

## Unter Windows (und am Rechner allgemein)

Adresse in Edge oder Chrome öffnen → **Als App installieren**. Danach eigenes
Fenster ohne Browserleiste, Symbol in Taskleiste und Startmenü, Rechtsklick auf
das Symbol bietet **Neue Nachricht**.

Die App meldet sich dabei als Programm für **`mailto:`-Links** an (Manifest-Eintrag
`protocol_handlers`). Einmal in Windows unter *Standard-Apps → E-Mail* bestätigen,
dann öffnet ein Mailto-Link aus Word, dem Browser oder der Buchhaltung ein
vorausgefülltes Fenster in V3D Mail statt Outlook. Empfänger, Kopie, Betreff und
Text werden übernommen.

Damit Windows die Installation überhaupt anbietet, braucht das Manifest ein
PNG-Symbol ab 192 px — ein SVG allein genügt nicht. Die Symbole liegen als
`icon-192.png`, `icon-512.png` und `icon-512-maskable.png` bei und werden von
`werkzeug/icons_bauen.py` erzeugt.

`smoke_windows.py` prüft Manifest, Symbole und die mailto-Auswertung in beiden
Schreibweisen (kodiert wie von Windows übergeben und im Klartext).

Wer lieber eine echte EXE verteilt: in `windows/` liegt ein kleiner Starter
(`V3DMail.exe`, Bau mit `windows/bauen.sh` im Wine-Prefix wie VolmeInventar).
Er öffnet die Seite über Edge/Chrome `--app=...` als eigenes App-Fenster —
kein eigener Browser-Motor, keine Runtime nötig, Sitzung/Cookies teilen sich
mit dem normalen Browser. Mit einem `mailto:...`-Argument startet er direkt
den Verfassen-Dialog (für die Verknüpfung als Standard-Mailprogramm).

## Auf dem Handy

Grundweg: dieselbe Web-App, über den Funnel-Pfad aufgerufen und bei Bedarf
über „Zum Startbildschirm hinzufügen" als PWA installiert. Alle Funktionen
gelten dort genauso.

Zusätzlich gibt es in `android/` eine **echte Android-App** (WebView-Hülle,
`com.volme3d.mail`): Anhänge hochladen über die System-Dateiauswahl, Anhänge
speichern über eine `blob:`-Brücke in den Download-Ordner (WebView kann
`blob:`-Downloads sonst nicht), Zurück-Taste navigiert im Verlauf, und die App
meldet sich für `mailto:`-Links an (öffnet `?compose=…`). Bau wie bei der
Kartenbox:

    cd android && JAVA_HOME=~/android-toolchain/jdk17 \
      ~/android-toolchain/gradle/bin/gradle --no-daemon assembleRelease

`keystore.jks`/`signing.properties` liegen lokal in `android/` (nicht im Git,
**nicht löschen** — sonst lassen sich keine Updates über die installierte App
spielen). Getestet im Toolchain-Emulator (test34): Anmeldung + Posteingang.

Aus einer geöffneten Mail kommt man auf zwei Wegen zurück: über den orangen
Knopf **‹ Zurück zur Liste** ganz oben und über die **System-Zurück-Geste**.
Letztere funktioniert nur, weil jede Ebene (Mail, Verfassen, Dialog) einen
Eintrag im Verlauf des Browsers anlegt. Zwei Stolpersteine stecken darin:

* Das Anzeige-`iframe` muss bei jeder Nachricht **neu erzeugt** werden. Setzt man
  nur `srcdoc` neu, hängt der Browser jedes Mal einen eigenen Verlaufseintrag an
  — die Zurück-Geste landet dann dort statt bei der Mail, und man sitzt fest.
* Chromium überspringt Verlaufseinträge, die es für Manipulation hält. Deshalb
  wird der vorhandene Seiteneintrag per `replaceState` als Basis markiert, statt
  einen zweiten anzulegen; pro Ebene entsteht genau ein Eintrag.

`smoke_handy.py` prüft beides im Handy-Format und steuert die Zurück-Taste über
das Browser-Protokoll (`Page.navigateToHistoryEntry`) — Playwrights `go_back()`
wartet auf einen Ladevorgang, den es bei Sprüngen im selben Dokument nicht gibt.

## Senden/Empfangen

Drei Wege, dieselbe Wirkung: der orange umrandete Knopf in der Seitenleiste
unter „Neue Nachricht", das **⟳** oben neben dem Suchfeld und — auf dem Handy —
**Ziehen nach unten** am oberen Ende der Nachrichtenliste. Beides prüft **alle Postfächer gleichzeitig** (Thread-Pool,
drei Konten in ~0,2 s) und zeigt die Zahl der Ungelesenen als Marke am jeweiligen
Konto; ein nicht erreichbares Postfach bekommt ein ⚠ mit dem Fehler als Tooltip.
Die offene Nachrichtenliste wird gleich mitgezogen.

**Ziehen zum Aktualisieren:** steht die Liste ganz oben, folgt sie dem Finger
nach unten und ein Ring erscheint darüber; ab 64 px löst das Loslassen dieselbe
Prüfung aus, darunter federt sie folgenlos zurück. Der Widerstand wächst
(`PTR_MAX * (1 - exp(-dy / PTR_MAX))`), bei 96 px ist Schluss. Die Geste wird
erst beansprucht, wenn klar nach unten gezogen wird — waagerechte Wische und
Hochziehen bleiben beim Scrollen, und bei `scrollTop > 0` fasst sie gar nicht
erst an. Ohne `preventDefault` im `touchmove` würde das Gummiband des Browsers
dazwischenfunken, deshalb hängt der Zuhörer dort mit `passive: false`.

Der Ring liegt absolut über `#items`, sein `top` wird beim Start gesetzt:
in einem Flex-Container landet ein absolutes Kind sonst am Kopf des Containers
(über dem Suchfeld) statt am Listenanfang.

Gezählt wird per IMAP-`STATUS` — das fragt den Posteingang ab, ohne die aktuell
gewählte Ordneransicht umzubiegen. Zusätzlich läuft die Prüfung alle drei Minuten
von selbst, aber still: gemeldet wird nur, wenn wirklich etwas Neues ankommt.

„Senden" ist im Namen mitgemeint, hat aber keine Warteschlange: Nachrichten gehen
beim Klick auf *Senden* sofort raus, ein Postausgang existiert nicht.

## Signatur

Pro Konto, unter **⚙️ Konten → Bearbeiten → Signatur → Bearbeiten**. Der Editor
hat Felder für Name, Funktion, Firma, Anschrift, Telefon, E-Mail und Web, drei
Gestaltungen (schlicht mit Trennlinie, Akzentbalken links, kompakt) und eine
Live-Vorschau. **Daten aus VolmeRechnung übernehmen** zieht die Absenderdaten aus
`~/volmerechnung/data/settings.json` — Bank- und Steuerdaten bleiben außen vor,
die gehören nicht in eine Signatur.

Gespeichert werden drei Dinge: die formatierte Fassung (`signatureHtml`), eine
Klartextfassung (`signature`) und die Einzelangaben (`signatureData`), damit sich
die Signatur später weiter bearbeiten lässt.

**Logo:** „Firmenlogo laden" holt `~/volmerechnung/logo.svg` und wandelt es im
Browser über ein Canvas in ein PNG um — auf dem Server liegt kein Rasterer, und
SVG zeigen viele Mailprogramme ohnehin nicht an. Breite und Lage (links daneben
oder darüber) sind einstellbar; eigene Bilddateien gehen auch. Ebenso lässt sich
wählen, ob Telefon, E-Mail und Web in einer Zeile mit Trennpunkten oder
untereinander stehen.

Beim Versand steckt das Logo als **eingebettetes Bild mit Content-ID** in der
Nachricht (`multipart/related`), nicht als Link und nicht als `data:`-URL:
verlinkte Bilder blockieren Mailprogramme bis zum Nachladen, `data:`-URLs zeigt
Outlook gar nicht. Nebeneinander wird per Tabelle gesetzt, weil Outlook kein
modernes Layout beherrscht. Für die Vorschau in der App ersetzt `sigAnzeige()`
den `cid:`-Verweis wieder durch die gespeicherte `data:`-Fassung.

Beim Verfassen steht die Signatur **nicht im Textfeld**, sondern wird darunter
angezeigt und erst beim Senden angehängt. So kann sie nicht versehentlich
zerschrieben werden, und beim Wechsel des Absenders stimmt sie ohne Nachbessern.
Versandt wird beides: Klartext mit dem üblichen Trenner `-- ` und eine formatierte
Fassung. Deren Stile stehen direkt an den Elementen — `<style>`-Blöcke im Kopf
werfen Mailprogramme weg.

## Bilder und Anhänge

Über der Nachricht stehen zwei Leisten: Dateien als Anhang-Zeilen und eine
**einzeilige Bilderleiste** („🖼️ 7 Bilder in dieser Nachricht"). Angeschaut werden
die Bilder in der Nachricht selbst — die Leiste ist zum **Speichern** da und
bleibt deshalb eingeklappt; „Speichern…" klappt die Kacheln mit Vorschau auf, ein
Klick auf eine Kachel sichert das Bild, „Alle speichern" nimmt alle.

**Warum eingeklappt:** aufgeklappte Kacheln drückten auf dem Handy den
Nachrichtentext auf einen 150-px-Streifen zusammen — man sah die Bilder als
Kacheln, aber die Mail nicht mehr.

Der Rahmen der Nachricht **wächst mit dem Inhalt**, die Leseansicht scrollt als
Ganzes. Mails sind meist auf 650 px Breite gebaut; passt das nicht (Handy), wird
der Inhalt passend heruntergezoomt, statt seitlich wegzulaufen. Dafür — und nur
dafür — trägt das iframe `allow-same-origin`: ohne `allow-scripts` läuft darin
trotzdem nichts.

Jeder Teil wird nur einmal vom Server geholt und für die geöffnete Nachricht
behalten — Vorschau, Einbettung im Text und Herunterladen teilen sich denselben
Zwischenspeicher, der beim Wechsel auf eine andere Mail freigegeben wird.

Verlinkte Bilder (Newsletter-Grafiken) bleiben zunächst blockiert. Nach „Bilder
anzeigen" holt sie **der Server stellvertretend** (`/api/bild`) und reicht sie
als `data:`-URL in die Nachricht — der Absender sieht dadurch weder IP noch
Lesezeitpunkt des Lesers, und das abgeschottete iframe muss selbst nie ins Netz.
Auch Hintergrundbilder aus `style="…url(…)"` laufen über diesen Weg. Anschließend
stehen diese Bilder ebenfalls als Kacheln in der Leiste und lassen sich einzeln
speichern; Winzlinge unter 1 kB (Abstandshalter, Zählpixel) bleiben draußen.

Die Weiterleitung nimmt nur `http`/`https` und nur öffentliche Adressen an —
Adressen im eigenen Netz (localhost, 10.x, 192.168.x, …) werden abgewiesen, auch
wenn erst eine Umleitung dorthin zeigt. Obergrenze 12 MB, Inhalt muss ein Bild
sein (Content-Type oder Dateikennung).

## Mehrere Postfächer

Beliebig viele Konten nebeneinander. Sie stehen **untereinander oben in der
Seitenleiste** (auf dem Handy hinter ☰); ein Klick wechselt, das aktive ist orange
umrandet. Darunter sitzt **+ Postfach hinzufügen**. Die zuletzt benutzte Wahl merkt
sich der Browser. Bearbeiten und Löschen weiterhin über **⚙️ Konten** unten links.

Jedes Konto hat eine eigene IMAP-Verbindung, eigene Ordner und eine eigene
Signatur. Beim Verfassen erscheint ab zwei Konten eine **Von**-Zeile; wechselt man
dort den Absender, zieht die Signatur mit — aber nur, solange am Text noch nichts
geändert wurde. Antworten und Weiterleitungen wählen von selbst das Postfach, an
das die Mail gerichtet war.

## Sicherheitsentscheidungen

* **Externe Bilder werden blockiert.** Zählpixel dürfen nicht ungefragt melden,
  dass eine Mail geöffnet wurde. Pro Mail ein Knopf „Bilder anzeigen".
* **HTML-Mails laufen durch einen Allowlist-Filter** (Skripte, `on*`-Attribute,
  `javascript:`, iframes, Formulare raus) und danach in einem abgeschotteten
  iframe mit `Content-Security-Policy: default-src 'none'`.
  Eingebettete Bilder (`cid:`) und über den Server geholte Fremdbilder werden
  deshalb als `data:`-URL nachgereicht.
* **Passwörter im Klartext** in `~/.config/v3dmail/config.json`. Anders geht es
  nicht: der Dienst muss sie an IMAP/SMTP weiterreichen. Schutz ist Modus 0600,
  nicht Verschlüsselung.
* **Anmeldung:** ein Schlüssel, 5 Fehlversuche pro IP → 5 Minuten Sperre,
  Sitzungscookie `HttpOnly`/`SameSite=Lax`.

## Wartung

```bash
systemctl --user restart volmemail.service     # nach Code-Änderung
journalctl --user -u volmemail -f              # Protokoll
python3 test_server.py                         # Tests
python3 smoke_ui.py                            # Browser-Durchlauf am Rechner
python3 smoke_bilder.py                        # Bilder anzeigen und speichern
python3 smoke_handy.py                         # Handy-Ansicht
python3 smoke_windows.py                       # Installation als Windows-App
tailscale funnel --set-path=/mail off          # öffentlichen Zugang abschalten
```

Das Zertifikat stammt von `tailscale cert v3da.tailf05fe9.ts.net` (im Home-Verzeichnis)
und wird mit den anderen V3D-Diensten geteilt.

## KI (Zusammenfassen, Antwort-Entwurf, Text-Hilfe, Diktieren)

Eingerichtet wird unter **✨ KI** unten in der Seitenleiste: dort den
Anthropic-API-Schlüssel (console.anthropic.com → API Keys) hinterlegen und das
Modell wählen (Standard Haiku 4.5, wahlweise Sonnet 5). Der Schlüssel landet im
`ai`-Abschnitt der config.json; der Server ruft die Anthropic-API direkt per
HTTPS auf — bewusst ohne SDK-Paket, der Dienst bleibt reine Standardbibliothek.

* **✨ Zusammenfassen** (Lese-Ansicht): Stichpunkte plus „Zu tun:"-Zeile.
* **✨ Antwort-Entwurf** (Lese-Ansicht): optionale Vorgabe („zusagen, Termin
  vorschlagen"), Entwurf wird angezeigt und erst auf Klick in die Antwort
  übernommen — über dem Zitat, Signatur bleibt Sache des Programms.
* **✨ Text-KI** (Verfassen): Stichpunkte ausformulieren oder Rechtschreibung/Ton
  glätten; der Vorschlag ersetzt den Text erst nach „Übernehmen".
* **🎤 Diktieren** (Verfassen): Spracherkennung des Browsers (Chrome/Edge,
  auch am Handy), braucht keinen Schlüssel und keinen Server.

Mails über 60 000 Zeichen lehnt der Server mit klarer Meldung ab, statt still
zu kürzen.

## Kalender (CalDAV)

**📅 Kalender** in der Seitenleiste zeigt eine Monatsansicht; Termine anlegen,
bearbeiten und löschen läuft über CalDAV direkt beim Mail-Hoster — dieselben
Termine wie am Handy oder in Thunderbird. Bei goneo ist der Endpunkt
`https://goneo.email/dav` (Voraussetzung: „Webmail Plus" im Tarif), angemeldet
wird mit den Postfach-Zugangsdaten.

„Kalender verbinden" sucht den Server selbst (SRV `_caldavs._tcp`, `.well-known`
auf Mail-Domain und Hoster-Domain, goneo als bekannter Sonderfall), hangelt sich
über principal → calendar-home-set zur Kalenderliste und speichert sie im
Konto (`dav`-Abschnitt). Termine kommen per REPORT mit Server-`expand`, damit
Serien aufgeklappt sind; Serientermine sind in der Oberfläche bewusst
schreibgeschützt (ein PUT würde die ganze Serie überschreiben). Ganztags-Termine:
`DTEND` ist exklusiv — die Oberfläche rechnet das beim Anzeigen zurück.
Der iCalendar-Teil (Parser, Zeilen-Faltung, Zeitzonen nach UTC) ist eigener
Code in `server.py`, Tests in `test_server.py`.

## Claude / Cowork (MCP-Connector)

V3D Mail stellt unter `/api/mcp/<mcpKey>` einen MCP-Server (Model Context
Protocol, Streamable HTTP, reines JSON-RPC) bereit. Damit kann Claude —
Cowork, Claude Desktop, claude.ai, Handy-App — das Postfach lesen, Anhänge
holen, Entwürfe ablegen, Nachrichten verschieben/markieren und den Kalender
nutzen.

- **Adresse für den Connector:**
  `https://v3da.tailf05fe9.ts.net/mail/api/mcp/<mcpKey>` — der `mcpKey` steht
  in `~/.config/v3dmail/config.json` (wird beim ersten Start erzeugt).
  In Claude: Einstellungen → Connectors → „Benutzerdefinierten Connector
  hinzufügen", nur die Adresse eintragen (kein OAuth).
- **Warum öffentlich (Funnel) und Schlüssel in der Adresse:** Claude verbindet
  sich von Anthropics Cloud aus, nicht vom eigenen Gerät — ein Tailnet-Endpunkt
  wäre unerreichbar. Der Connector-Dialog kennt nur OAuth oder gar keine
  Anmeldung, deshalb ist der Schlüssel Teil der Adresse (zusätzlich geht
  `Authorization: Bearer <mcpKey>`). Der Schlüssel gilt **unabhängig** von
  `offenerZugang`.
- **Bewusst kein Senden-Werkzeug.** `entwurf_ablegen` legt die Mail im Ordner
  Entwürfe ab (IMAP APPEND, `\Draft`). In V3D Mail: Ordner Entwürfe → Mail
  öffnen → „✏️ Bearbeiten" → prüfen → Senden. Nach dem Senden wandert der
  Entwurf in den Papierkorb. Die Signatur hängt V3D Mail beim Senden an,
  Claude soll sie nicht mitschreiben (steht in der Werkzeugbeschreibung).
- **Werkzeuge:** `konten`, `ordner`, `nachrichten` (Suche, nur ungelesen,
  Seiten), `nachricht` (markiert nicht als gelesen, außer `als_gelesen`),
  `anhang` (Text als Text, Bilder als Bild, Rest als eingebettete Datei, max.
  8 MB), `entwurf_ablegen` (optional als Antwort mit In-Reply-To),
  `verschieben` (Pfad oder Art wie `trash`), `markieren`, `termine`,
  `termin_anlegen` (nur Datum = ganztags).
- **Schlüssel wechseln:** `mcpKey` in der config.json ändern/löschen (leer →
  neu erzeugt beim Start), Dienst neu starten, Connector in Claude mit der
  neuen Adresse neu anlegen.
- Tests: `TestMcp` in `test_server.py` (Stub-IMAP, ohne Postfach).

## Noch offen

* Entwürfe serverseitig speichern (bisher nur senden)
* Mehrere Nachrichten auf einmal auswählen und verschieben/löschen
* Adressbuch / Empfänger-Vervollständigung
* Desktop-Fassung (später geplant, gleicher Codestand)
