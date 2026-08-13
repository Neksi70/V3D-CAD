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
| `smoke_windows.py` | Installierbarkeit als Windows-App und mailto-Anbindung |
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

## Auf dem Handy

Es gibt **keine eigene Android-App** — dieselbe Web-App, über den Funnel-Pfad
aufgerufen und bei Bedarf über „Zum Startbildschirm hinzufügen" als PWA
installiert. Alle Funktionen gelten dort genauso.

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

Der Knopf in der Seitenleiste prüft **alle Postfächer gleichzeitig** (Thread-Pool,
drei Konten in ~0,2 s) und zeigt die Zahl der Ungelesenen als Marke am jeweiligen
Konto; ein nicht erreichbares Postfach bekommt ein ⚠ mit dem Fehler als Tooltip.
Die offene Nachrichtenliste wird gleich mitgezogen.

Gezählt wird per IMAP-`STATUS` — das fragt den Posteingang ab, ohne die aktuell
gewählte Ordneransicht umzubiegen. Zusätzlich läuft die Prüfung alle drei Minuten
von selbst, aber still: gemeldet wird nur, wenn wirklich etwas Neues ankommt.

„Senden" ist im Namen mitgemeint, hat aber keine Warteschlange: Nachrichten gehen
beim Klick auf *Senden* sofort raus, ein Postausgang existiert nicht.

## Bilder und Anhänge

Über der Nachricht stehen zwei Leisten: Dateien als Anhang-Zeilen, **Bilder als
Kacheln mit Vorschau** — egal ob sie als Anhang mitkommen oder im Text eingebettet
sind (Logos, Signaturbilder). Ein Klick speichert; ab zwei Bildern gibt es
zusätzlich „Alle speichern".

Jeder Teil wird nur einmal vom Server geholt und für die geöffnete Nachricht
behalten — Vorschau, Einbettung im Text und Herunterladen teilen sich denselben
Zwischenspeicher, der beim Wechsel auf eine andere Mail freigegeben wird.

Extern nachzuladende Bilder bleiben davon unberührt: die werden weiter blockiert
und erst auf Knopfdruck geholt.

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
  Eingebettete Bilder (`cid:`) werden deshalb als `data:`-URL nachgereicht.
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
python3 smoke_handy.py                         # Handy-Ansicht
python3 smoke_windows.py                       # Installation als Windows-App
tailscale funnel --set-path=/mail off          # öffentlichen Zugang abschalten
```

Das Zertifikat stammt von `tailscale cert v3da.tailf05fe9.ts.net` (im Home-Verzeichnis)
und wird mit den anderen V3D-Diensten geteilt.

## Noch offen

* Entwürfe serverseitig speichern (bisher nur senden)
* Mehrere Nachrichten auf einmal auswählen und verschieben/löschen
* Adressbuch / Empfänger-Vervollständigung
* Desktop-Fassung (später geplant, gleicher Codestand)
