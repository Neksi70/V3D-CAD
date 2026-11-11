# V3D Mail MCP-Connector

Claude (Web, Desktop, Handy, Cowork) greift über einen eigenen MCP-Endpunkt auf die
V3D-Mail-Postfächer und den goneo-Kalender zu. **Kein zweites Mailsystem**: Konten,
IMAP, SMTP und CalDAV kommen aus `~/volmemail/server.py` (per Import, siehe `v3dmcp/core.py`).
Passwörter bleiben in `~/.config/v3dmail/config.json` und tauchen in keiner Antwort und keinem Log auf.

## Weg einer Anfrage
Claude (Anthropic-Cloud) → `https://mcp.volme3dakademie.de` (netcup, nginx + Let's Encrypt,
nur `/mcp`, OAuth-Pfade, Metadaten) → Tailscale → V3DA `100.125.34.44:8446` (`tailscale serve`,
tailnet only) → `127.0.0.1:8802` (dieser Dienst, `v3d-mail-mcp.service`).

## Befehle
    v3d-mail-mcp set-password   # Login-Passwort (argon2), ohne Echo, wirkt sofort
    v3d-mail-mcp revoke-all     # alle Tokens ungültig → Claude muss neu verbinden
    v3d-mail-mcp status
    systemctl --user restart v3d-mail-mcp

## Absicherung
OAuth 2.1 Authorization Code + PKCE (S256), Dynamic Client Registration nur mit
`https://claude.ai/api/mcp/auth_callback` bzw. `claude.com`. Access-Token 1 h, Refresh 30 Tage
rotierend (Wiederverwendung sperrt die ganze Anmeldung). Tokens nur als SHA-256 in
`~/.local/share/v3d-mail-mcp/state.db`. Sperre 15 min nach 5 Fehl-Logins je IP bzw. 10 insgesamt.
Rate-Limit im Dienst und in nginx. Audit-Log `~/.local/share/v3d-mail-mcp/audit.log`
(nur Metadaten: Werkzeug, Postfach, Ordner, UID, Dauer — keine Inhalte/Suchbegriffe).

## Werkzeuge
Lesen: list_accounts, list_folders, search_messages, get_message, get_thread, get_attachment, list_events.
Schreiben: create_draft, send_message (destructiveHint), move_message, set_flags, create_event, update_event.
Löschen: delete_event (destructiveHint) — nur Termine mit Titel „vorläufig: …“, keine Serientermine,
CalDAV DELETE mit `If-Match`. Mails kennen kein endgültiges Löschen (move_message nach trash).
Termine legt der Connector nur „vorläufig: …“ (TENTATIVE) an.
**goneo-Falle:** ein PUT mit `STATUS:CANCELLED` löscht den Termin sofort — Absagen setzt
deshalb Titel „… (abgesagt)“ + `TRANSP:TRANSPARENT` und lässt den Termin stehen.

## Tests
`tests/oauth_flow.py` (offizieller SDK-Client, OAuth + Werkzeugaufrufe) und `tests/security.py`
(PKCE, Sperre, Rotation, revoke-all) — **nur gegen eine Test-Instanz** mit eigenem `DATA_DIR`,
`ISSUER_URL=http://127.0.0.1:<port>` und `V3DMCP_TEST_HASH`. Schreibende Aufrufe wirken auf die echten Postfächer.

## Gemeinsames Gedächtnis (seit 13.10.2026)

Der Connector stellt Claude Chat/Cowork auch das Auto-Gedächtnis von Claude Code bereit
(`~/.claude/projects/-home-v3da/memory`, per `GEDAECHTNIS_DIR` änderbar), Modul `v3dmcp/gedaechtnis.py`:

- `gedaechtnis_index`, `gedaechtnis_suchen`, `gedaechtnis_lesen` — nur lesend; PINs, Codes,
  Tokens und zufällig aussehende Schlüssel werden beim Ausliefern durch `[ausgeblendet]` ersetzt
  (die Dateien selbst bleiben unverändert).
- `gedaechtnis_merken` — legt nur NEUE Dateien `eingang-<titel>.md` an (max. 100) und hängt je
  eine Zeile unter „## Eingang aus Claude Chat/Cowork" an `MEMORY.md`. Bestehende Einträge
  werden nie geändert. Einsortieren/Aufräumen macht Claude Code.
- Die Server-Anleitung weist Chat/Cowork an, bei Fragen zu Volkers Tools zuerst zu suchen.

## V3D-Familie-Kalender (seit 13.10.2026)

Modul `v3dmcp/familie.py`, Werkzeuge `familie_list_events`, `familie_get_event`,
`familie_create_event`, `familie_update_event`, `familie_delete_event`. Schreibt direkt in
`~/v3dfamilie/daten.db` (wie die Web-App, WAL), Serien klappt `kalenderlogik.py` der App auf.
Zeiten: Eingabe ISO-8601 mit/ohne Offset (ohne = Europe/Berlin), Ausgabe mit Berliner Offset.
Termine sind sofort fest. Serientermine löschen nur mit `confirm_series=true`; jeder gelöschte
Termin steht zusätzlich in `DATA_DIR/familie-geloescht.jsonl`. Feiertage/Schulferien NRW
kommen in `familie_list_events` als `read_only` mit. Pfad per `FAMILIE_DIR` änderbar.
Präfix `familie_`, weil `list_events` usw. schon für den Mail-Kalender (CalDAV) vergeben sind.

## Server-Browser (seit 14.10.2026)

Claude Chat/Cowork bekommt über diesen Connector einen eigenen, unsichtbaren Chrome auf V3DA
(nicht Volkers PC-Browser, eigene Anmeldungen im Profil `~/.local/share/v3d-browser/profil`).
Werkzeuge `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`,
`browser_fill_form`, `browser_select_option`, `browser_press_key`, `browser_hover`,
`browser_find`, `browser_wait_for`, `browser_tabs`, `browser_handle_dialog`,
`browser_take_screenshot`, `browser_navigate_back`, `browser_close` (Modul `v3dmcp/browser.py`).

Aufbau: Connector → `v3d-browser.service` (Playwright MCP 0.0.83 aus `browser/node_modules`,
127.0.0.1:8812, Konfiguration `browser/config.json`) → Chrome → `v3d-browser-proxy.service`
(`browser/sperrproxy.py`, 127.0.0.1:8813). Der Sperr-Proxy löst Namen selbst auf und verbindet nur
zu öffentlichen IPs (gesperrt: localhost, Heimnetz, Tailnet 100.64/10, Link-Local …);
`<-loopback>` zwingt auch localhost durch den Proxy. Gesperrte Aufrufe stehen im Journal
(`journalctl --user -u v3d-browser-proxy | grep GESPERRT`).

Nicht weitergereicht: Datei-Upload/-Drop, `browser_run_code_unsafe`, `browser_evaluate`,
Netzwerk-/Konsolen-Mitschnitte, `filename`-Parameter. Die MCP-Sitzung zu Playwright bleibt
dauerhaft offen (eigener Thread) — eine Sitzung je Aufruf landete jedes Mal auf about:blank.
Nach Aktionen liefert Playwright im HTTP-Modus den Snapshot nur als Datei; `browser.py` holt ihn
dann per `browser_snapshot` und setzt ihn in die Antwort ein.

Unit-Dateien liegen in `browser/` und sind nach `~/.config/systemd/user/` verlinkt.

## 3D-Drucker SV08 Max (seit 05.11.2026)

`v3dmcp/drucker.py` spricht Moonraker direkt per HTTP an (V3DA im selben LAN, kein Notebook nötig).
Einstellungen in `.env`: `DRUCKER_URL` (Standard `http://192.168.178.155`), optional `DRUCKER_API_KEY`,
`DRUCKER_UPLOAD_DIRS` (Standard `~/tools/orcaslicer/ausgabe,~/Ablage,/srv/v3dmail/files`).

Werkzeuge: `drucker_status`, `drucker_gcode`, `drucker_dateien`, `drucker_datei_loeschen`,
`drucker_upload`, `drucker_druck`, `drucker_kamera`, `drucker_mesh`.

Schutz: Start nur mit `bett_frei=true` und nicht während eines Drucks; Bewegungs-/Kalibrier-/
Neustart-G-Code während eines Drucks nur mit `erzwingen=true` (M112 geht immer); Upload nur
G-Code-Endungen aus den freigegebenen Ordnern; die gerade gedruckte Datei lässt sich nicht löschen.
Während eines Makros (z. B. Heat Soak) stellt Klipper G-Code hinten an → `fertig: false`, läuft später.

## Claude Code headless: code_* (11.11.2026)
`code_auftrag(auftrag, ordner?, titel?)` → sofort `job_id`; `code_status`, `code_ergebnis`, `code_liste`, `code_abbrechen`.
- Jobs unter `~/code-auftraege/<id>/` (auftrag.md, meta.json, ausgabe.jsonl = stream-json, ergebnis.md, stderr.txt).
- Jeder Job = eigene systemd-User-Unit `code-auftrag-<id>` (`systemd-run --user`): überlebt MCP-Neustarts,
  RuntimeMaxSec = Zeitlimit + 2 min, Abbruch = `systemctl --user stop`. Höchstens 1 parallel (CODE_AUFTRAG_PARALLEL),
  60 min (CODE_AUFTRAG_MINUTEN); der fertige Läufer startet den nächsten wartenden.
- `claude -p --permission-mode auto --output-format stream-json` + angehängte Regel „folgenreiche Schritte nur
  unter ‚Wartet auf Bestätigung‘ listen“ + `--disallowedTools` (sudo, git push, ssh/rsync, ausrollen, Drucker-Neustart/
  Druckstart, Mail senden, code_auftrag selbst gegen Rekursion …).
- Kurzbericht je Job ins Gedächtnis: `code-auftraege-protokoll.md` (eine Datei, neueste oben, max. 30).
- Läufer lädt den Mail-Kern (Kontodaten) bewusst nicht (`python -m v3dmcp.code laeufer <id>`).

## Notebook-Agent: notebook_* (11.11.2026)
Volkers Windows-Notebook (DESKTOP-T4DI2AS, Tailscale 100.79.71.92) direkt, ohne Browser:
`notebook_download` (direkt laden, SHA-256, optional ZIP entpacken), `notebook_befehl` (PowerShell,
Admin, max. 150 s, Ausgabe ~20 KB), `notebook_starten` (sichtbar auf dem Desktop), `notebook_dateien`,
`notebook_winget`. Modul `v3dmcp/notebook.py`, Gegenstück `notebook-agent/agent.js` (Node, nur
Standardbibliothek) auf Port **8933**, nur Tailscale-IP, Firewall + Agent nur für 100.125.34.44.

- Einrichten: `notebook-agent/bauen.sh` erzeugt `~/Ablage/v3d-notebook-agent-einrichten.ps1`
  (Vorlage + agent.js eingebettet). Auf dem Notebook im Admin-PowerShell:
  `irm "https://v3da.tailf05fe9.ts.net/ablage/api/datei?pfad=v3d-notebook-agent-einrichten.ps1" -OutFile $env:TEMP\v3d-agent.ps1`
  dann `powershell -ExecutionPolicy Bypass -File $env:TEMP\v3d-agent.ps1`.
- Notebook-Seite: `%ProgramData%\V3D\` (agent.js, agent-config.json mit Token, start.vbs, agent.log),
  ACL nur Admins/SYSTEM/V3D; Aufgabenplanung `\V3D\V3D Notebook-Agent` bei Anmeldung, höchste Rechte,
  interaktiv (Programme erscheinen auf dem Desktop, keine UAC-Abfrage).
- Token: entsteht beim Einrichten auf dem Notebook (Skript ist öffentlich → kein Token darin).
  Der Connector holt ihn beim ersten Aufruf per `POST /kopplung` (einmalig, ≤ 24 h nach Einrichten)
  und schreibt `NOTEBOOK_AGENT_TOKEN` in die `.env`. Skript erneut ausführen = neuer Token, neue Kopplung.
- netcup kappt nach 180 s: download/winget antworten nach 150 s mit `status: laeuft`; derselbe Aufruf
  holt später das Ergebnis.
- Lokal testen: Agent mit `V3D_AGENT_DIR=<testordner>` (Config ip 127.0.0.1, eigener Port,
  erlaubt 127.0.0.1) + `NOTEBOOK_AGENT_URL=… V3DMCP_ENV=<test.env>` (echte .env bleibt unberührt).
