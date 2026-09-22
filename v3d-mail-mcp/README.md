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
