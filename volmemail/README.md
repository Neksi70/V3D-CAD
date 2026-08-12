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
holt die Einstellungen aus der Thunderbird-Datenbank; findet die nichts, werden
`imap.<domain>` / `mail.<domain>` auf den üblichen Ports abgetastet. Sonst manuell
eintragen. „Prüfen & speichern" meldet sich testweise an, bevor gespeichert wird.

Tastatur: `n` neue Nachricht, `r` antworten, `j`/`k` blättern, `Entf` löschen, `Esc` schließen.

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
