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
| `smoke_ui.py` | Browser-Durchlauf: Anmeldung, Kontodialog, Server-Suche |

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

## Mehrere Postfächer

Beliebig viele Konten nebeneinander: **⚙️ Konten → + Konto hinzufügen** (der Knopf
sitzt unten links in der Seitenleiste, auf dem Handy hinter ☰). Umgeschaltet wird
oben links im Auswahlfeld; die zuletzt benutzte Wahl merkt sich der Browser.

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
python3 smoke_ui.py                            # Browser-Durchlauf
tailscale funnel --set-path=/mail off          # öffentlichen Zugang abschalten
```

Das Zertifikat stammt von `tailscale cert v3da.tailf05fe9.ts.net` (im Home-Verzeichnis)
und wird mit den anderen V3D-Diensten geteilt.

## Noch offen

* Entwürfe serverseitig speichern (bisher nur senden)
* Mehrere Nachrichten auf einmal auswählen und verschieben/löschen
* Adressbuch / Empfänger-Vervollständigung
* Desktop-Fassung (später geplant, gleicher Codestand)
