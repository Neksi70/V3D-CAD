"""V3D Mail MCP-Connector: Streamable HTTP unter /mcp, OAuth 2.1 davor.

Start: `v3d-mail-mcp serve` (systemd-User-Dienst v3d-mail-mcp.service).
"""
import functools
import imaplib
import json
import socket
import ssl
import sys
import time
import warnings
from typing import Annotated

from pydantic import Field
from starlette.requests import Request
from starlette.responses import JSONResponse

from . import settings  # zuerst: lädt .env
from . import audit, familie, gedaechtnis, mail
from .core import MailError, vm
from .netz import RateLimit
from .oauth import Provider, login

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import (BlobResourceContents, CallToolResult, EmbeddedResource, ImageContent,
                       TextContent, ToolAnnotations)

ANLEITUNG = (
    'Zugriff auf die Postfächer (IMAP) und den Kalender (CalDAV) von Volme 3D / V3D Mail. '
    'Standard-Postfach: %s — andere über den Parameter account (list_accounts). '
    'Eine Nachricht ist eindeutig durch folder + uid; beides liefert search_messages. '
    'Löschen heißt: move_message nach target="trash" (endgültiges Löschen gibt es nicht). '
    'Termine legt Claude nur vorläufig an (Titel "vorläufig: …", Status TENTATIVE); '
    'absagen per update_event(cancel=true), endgültig weg per delete_event (nur vorläufige Termine). '
    'Zeiten ohne Zone gelten als Europe/Berlin. '
    'Vor send_message den Text mit dem Nutzer abstimmen; im Zweifel create_draft. '
    'GEMEINSAMES GEDÄCHTNIS: Volker hat mit Claude Code viele eigene Tools, Apps und Projekte gebaut '
    '(z. B. V3D Familie, V3D CAD, Generatoren, Dienste auf seinem Server). Bei Fragen dazu — oder '
    'wenn ein Name/Tool unbekannt ist — ZUERST gedaechtnis_suchen, dann gedaechtnis_lesen; nicht '
    'nachfragen, ob es das gibt. Geheimnisse (PINs, Codes, Tokens) sind dort ausgeblendet. '
    'Neues Wissen, das Claude Code kennen soll, mit gedaechtnis_merken ablegen. '
    'FAMILIENKALENDER (V3D Familie, Volker/Sylvia/Emma) ist etwas anderes als der Mail-Kalender: '
    'dafür die Werkzeuge familie_* benutzen. Dort angelegte Termine sind sofort fest (kein "vorläufig"). '
    'Bei mehreren Treffern oder Serienterminen vor Ändern/Löschen nachfragen.'
)

mcp = MCPServer(
    name='V3D Mail',
    instructions=ANLEITUNG % (mail.standard_konto() or 'erstes Konto'),
    version='1.0',
    auth_server_provider=Provider(),
    auth=AuthSettings(
        issuer_url=settings.ISSUER_URL,
        resource_server_url=settings.RESOURCE_URL,
        validate_token_resource=True,
        required_scopes=[settings.SCOPE],
        client_registration_options=ClientRegistrationOptions(
            enabled=True, valid_scopes=[settings.SCOPE], default_scopes=[settings.SCOPE]),
        revocation_options=RevocationOptions(enabled=True),
    ),
)

LESEN = ToolAnnotations(read_only_hint=True, open_world_hint=False)
AENDERN = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)
SENDEN = ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=False,
                         open_world_hint=True)
LOESCHEN = ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=True,
                           open_world_hint=False)

Konto = Annotated[str | None, Field(description='Postfach-Adresse oder ID (Standard: %s)'
                                    % (mail.standard_konto() or 'erstes Konto'))]
Ordner = Annotated[str, Field(description='Ordnerpfad aus search_messages/list_folders oder Art '
                                          '(inbox, sent, drafts, trash, junk, archive)')]
Uid = Annotated[int, Field(description='UID der Nachricht im Ordner')]


def _fehlertext(e):
    if isinstance(e, MailError):
        return str(e)
    if isinstance(e, (imaplib.IMAP4.error, ssl.SSLError, socket.gaierror, OSError)):
        return 'Mailserver: ' + vm.readable_error(e, 'IMAP')
    return 'Interner Fehler (%s)' % type(e).__name__


def _ergebnis(wert):
    if isinstance(wert, CallToolResult):
        return wert
    return CallToolResult(content=[TextContent(type='text', text=json.dumps(wert, ensure_ascii=False, indent=1))],
                          structured_content=wert)


def werkzeug(annotations, **umbenennen):
    """Registriert eine Funktion als Tool: Aliase (from/to), Audit-Log ohne
    Inhalte, Fehler als isError-Antwort statt Ausnahme."""
    def deko(fn):
        @functools.wraps(fn)
        def wrapper(**kw):
            for aussen, innen in umbenennen.items():
                if aussen in kw:
                    kw[innen] = kw.pop(aussen)
            tok = get_access_token()
            start = time.monotonic()
            meta = {'tool': fn.__name__, 'client_id': tok.client_id if tok else None,
                    'account': kw.get('account') or mail.standard_konto(),
                    'folder': kw.get('folder'), 'uid': kw.get('uid'),
                    'uids': len(kw['uids']) if isinstance(kw.get('uids'), list) else None}
            try:
                wert = _ergebnis(fn(**kw))
            except Exception as e:
                audit.log('tool_error', error=type(e).__name__,
                          ms=int((time.monotonic() - start) * 1000), **meta)
                if not isinstance(e, MailError):
                    sys.stderr.write('Werkzeugfehler %s: %s\n' % (fn.__name__, type(e).__name__))
                return CallToolResult(content=[TextContent(type='text', text='Fehler: ' + _fehlertext(e))],
                                      is_error=True)
            audit.log('tool_call', ms=int((time.monotonic() - start) * 1000), **meta)
            return wert
        mcp.tool(annotations=annotations)(wrapper)
        return fn
    return deko


# --- Lesen -------------------------------------------------------------------

@werkzeug(LESEN)
def list_accounts() -> CallToolResult:
    """Eingerichtete Postfächer (Adresse, Name, Kalender ja/nein, Standard)."""
    return mail.list_accounts()


@werkzeug(LESEN)
def list_folders(account: Konto = None) -> CallToolResult:
    """Ordner eines Postfachs mit Pfad und Art (inbox/sent/drafts/trash/junk/archive)."""
    return mail.list_folders(account)


@werkzeug(LESEN, **{'from': 'from_', 'to': 'to_'})
def search_messages(
        query: Annotated[str | None, Field(description='Volltext über Kopf und Text')] = None,
        from_: Annotated[str | None, Field(alias='from', description='Absender enthält')] = None,
        to_: Annotated[str | None, Field(alias='to', description='Empfänger enthält')] = None,
        subject: Annotated[str | None, Field(description='Betreff enthält')] = None,
        since: Annotated[str | None, Field(description='ab Datum JJJJ-MM-TT (einschließlich)')] = None,
        before: Annotated[str | None, Field(description='vor Datum JJJJ-MM-TT (ausschließlich)')] = None,
        folder: Annotated[str, Field(description='"alle" (Standard, inkl. Spam/Papierkorb) oder ein Ordner')] = 'alle',
        unread_only: bool = False,
        has_attachment: bool = False,
        limit: Annotated[int, Field(ge=1, le=50, description='Treffer je Seite (Standard 20, max. 50)')] = 20,
        cursor: Annotated[str | None, Field(description='next_cursor der vorigen Seite')] = None,
        account: Konto = None) -> CallToolResult:
    """Nachrichten suchen, neueste zuerst, mit Vorschauzeile. Liefert folder+uid für get_message."""
    return mail.search_messages(account, query, from_, to_, subject, since, before, folder,
                                unread_only, has_attachment, limit, cursor)


@werkzeug(LESEN)
def get_message(folder: Ordner, uid: Uid,
                mark_read: Annotated[bool, Field(description='als gelesen markieren (Standard nein)')] = False,
                account: Konto = None) -> CallToolResult:
    """Nachricht lesen: Kopfzeilen, Text (Links als "Text (URL)", max. 50 000 Zeichen), Anhangsliste."""
    return mail.get_message(folder, uid, account, mark_read)


@werkzeug(LESEN)
def get_thread(folder: Ordner, uid: Uid, account: Konto = None) -> CallToolResult:
    """Ganzen Gesprächsfaden zu einer Nachricht (alle Ordner, chronologisch)."""
    return mail.get_thread(folder, uid, account)


@werkzeug(LESEN)
def get_attachment(folder: Ordner, uid: Uid,
                   part: Annotated[str, Field(description='"part" aus der Anhangsliste von get_message')],
                   account: Konto = None) -> CallToolResult:
    """Anhang holen (bis 10 MB) als Base64; PDFs zusätzlich als Text, Bilder als Bild."""
    meta, daten, text = mail.get_attachment(folder, uid, part, account)
    b64 = __import__('base64').b64encode(daten).decode('ascii')
    inhalt = [TextContent(type='text', text=json.dumps(meta, ensure_ascii=False))]
    if text is not None:
        inhalt.append(TextContent(type='text', text=text))
    if meta['type'].startswith('image/') and meta['type'] in ('image/png', 'image/jpeg', 'image/gif', 'image/webp'):
        inhalt.append(ImageContent(type='image', data=b64, mime_type=meta['type']))
    else:
        inhalt.append(EmbeddedResource(type='resource', resource=BlobResourceContents(
            uri='v3dmail://%s/%s/%s/%s' % (meta['account'], meta['folder'], meta['uid'], meta['part']),
            mime_type=meta['type'], blob=b64)))
    return CallToolResult(content=inhalt)


@werkzeug(LESEN)
def list_events(start: Annotated[str | None, Field(description='Beginn ISO (Standard: jetzt)')] = None,
                end: Annotated[str | None, Field(description='Ende ISO (Standard: +14 Tage)')] = None,
                account: Konto = None) -> CallToolResult:
    """Kalendertermine im Zeitraum; Zeiten in UTC und lokal (Europe/Berlin). href für update_event."""
    return mail.list_events(start, end, account)


# --- Schreiben -----------------------------------------------------------------

@werkzeug(AENDERN, to='to_')
def create_draft(to_: Annotated[str, Field(alias='to', description='Empfänger, mehrere mit Komma')],
                 subject: str, body: Annotated[str, Field(description='Text (Klartext, ohne Signatur)')],
                 cc: str | None = None, bcc: str | None = None,
                 reply_to_folder: Annotated[str | None, Field(description='Ordner der Mail, auf die geantwortet wird')] = None,
                 reply_to_uid: Annotated[int | None, Field(description='UID der Mail, auf die geantwortet wird')] = None,
                 account: Konto = None) -> CallToolResult:
    """Entwurf im Ordner Entwürfe ablegen (wird NICHT gesendet; in V3D Mail prüfen und senden)."""
    return mail.create_draft(to_, subject, body, cc, bcc, reply_to_folder, reply_to_uid, account)


@werkzeug(SENDEN, to='to_')
def send_message(to_: Annotated[str, Field(alias='to', description='Empfänger, mehrere mit Komma')],
                 subject: str, body: Annotated[str, Field(description='Text (Klartext; Signatur wird angehängt)')],
                 cc: str | None = None, bcc: str | None = None,
                 reply_to_folder: str | None = None, reply_to_uid: int | None = None,
                 account: Konto = None) -> CallToolResult:
    """Mail SOFORT senden (mit Signatur, Kopie in Gesendet). Nur nach ausdrücklicher Zustimmung."""
    return mail.send_message(to_, subject, body, cc, bcc, reply_to_folder, reply_to_uid, account)


@werkzeug(AENDERN)
def move_message(folder: Ordner,
                 uids: Annotated[list[int], Field(description='UIDs im Quellordner')],
                 target: Annotated[str, Field(description='Zielordner (Pfad oder trash/archive/junk/inbox)')],
                 account: Konto = None) -> CallToolResult:
    """Nachrichten verschieben. Löschen = target "trash"; endgültiges Löschen gibt es nicht."""
    return mail.move_message(folder, uids, target, account)


@werkzeug(AENDERN)
def set_flags(folder: Ordner, uids: Annotated[list[int], Field(description='UIDs im Ordner')],
              read: Annotated[bool | None, Field(description='gelesen setzen/entfernen')] = None,
              flagged: Annotated[bool | None, Field(description='Fahne setzen/entfernen')] = None,
              account: Konto = None) -> CallToolResult:
    """Gelesen- und Fahnen-Markierung setzen."""
    return mail.set_flags(folder, uids, read, flagged, account)


@werkzeug(AENDERN)
def create_event(title: str,
                 start: Annotated[str, Field(description='ISO, z. B. 2026-09-24T14:00 (Berlin) oder 2026-09-24 für ganztags')],
                 end: Annotated[str | None, Field(description='Ende im selben Format (ganztags: letzter Tag)')] = None,
                 all_day: bool = False, location: str | None = None, description: str | None = None,
                 account: Konto = None) -> CallToolResult:
    """Vorläufigen Termin anlegen (Titel "vorläufig: …", STATUS:TENTATIVE)."""
    return mail.create_event(title, start, end, all_day, location, description, account)


@werkzeug(AENDERN)
def update_event(href: Annotated[str, Field(description='href aus list_events/create_event')],
                 title: str | None = None, start: str | None = None, end: str | None = None,
                 all_day: bool | None = None, location: str | None = None, description: str | None = None,
                 cancel: Annotated[bool, Field(description='Termin absagen: bleibt als "(abgesagt)" stehen, Zeit wird frei')] = False,
                 account: Konto = None) -> CallToolResult:
    """Vorläufigen Termin ändern oder absagen. Echte (nicht vorläufige) Termine bleiben unangetastet."""
    return mail.update_event(href, title, start, end, all_day, location, description, cancel, account)


@werkzeug(LOESCHEN)
def delete_event(href: Annotated[str, Field(description='href aus list_events/create_event')],
                 account: Konto = None) -> CallToolResult:
    """Vorläufigen Termin endgültig löschen. Nur nach ausdrücklicher Zustimmung;
    echte (nicht vorläufige) Termine bleiben unangetastet."""
    return mail.delete_event(href, account)


# --- V3D Familie (Familienkalender) ------------------------------------------

EventId = Annotated[int, Field(description='event_id aus familie_list_events/familie_create_event')]
Person = Annotated[str | None, Field(description='Für wen: Volker, Sylvia oder Emma (Standard: Volker)')]


@werkzeug(LESEN)
def familie_list_events(
        start: Annotated[str | None, Field(description='Beginn ISO-8601, z. B. 2026-11-01 oder 2026-11-01T00:00+01:00 (Standard: heute)')] = None,
        end: Annotated[str | None, Field(description='Ende ISO-8601, einschließlich (Standard: start + 14 Tage)')] = None) -> CallToolResult:
    """Termine im V3D-Familienkalender auflisten (Serien aufgeklappt, dazu Feiertage/Schulferien NRW
    als read_only). Zeiten in Europe/Berlin mit UTC-Offset."""
    return familie.list_events(start, end)


@werkzeug(LESEN)
def familie_get_event(event_id: EventId) -> CallToolResult:
    """Einen Termin des Familienkalenders abrufen."""
    return familie.get_event(event_id)


@werkzeug(AENDERN)
def familie_create_event(
        title: str,
        start: Annotated[str, Field(description='ISO-8601; ohne Offset = Berliner Zeit, z. B. 2026-11-18T15:00. Ganztägig: 2026-11-18')],
        end: Annotated[str | None, Field(description='Ende im selben Format (Standard: +1 h; ganztägig: letzter Tag)')] = None,
        location: str | None = None, description: str | None = None,
        all_day: bool = False, person: Person = None) -> CallToolResult:
    """Termin im V3D-Familienkalender anlegen (sofort fest, erscheint in App und Abo-Feed)."""
    return familie.create_event(title, start, end, location, description, all_day, person)


@werkzeug(AENDERN)
def familie_update_event(
        event_id: EventId, title: str | None = None,
        start: Annotated[str | None, Field(description='neuer Beginn ISO-8601 (nur start → Dauer bleibt)')] = None,
        end: str | None = None, location: str | None = None, description: str | None = None,
        all_day: bool | None = None, person: Person = None) -> CallToolResult:
    """Termin im Familienkalender ändern; nur übergebene Felder ändern sich. Bei Serien gilt es für die ganze Serie."""
    return familie.update_event(event_id, title, start, end, location, description, all_day, person)


@werkzeug(LOESCHEN)
def familie_delete_event(
        event_id: EventId,
        confirm_series: Annotated[bool, Field(description='nur bei Serienterminen: ganze Serie wirklich löschen')] = False) -> CallToolResult:
    """Termin aus dem Familienkalender löschen. Vorher mit dem Nutzer bestätigen."""
    return familie.delete_event(event_id, confirm_series)


# --- Gemeinsames Gedächtnis (Claude Code) ------------------------------------

@werkzeug(LESEN)
def gedaechtnis_index() -> CallToolResult:
    """Übersicht aller Gedächtnis-Einträge aus Claude Code (eine Zeile je Tool/Projekt/Vorgabe)."""
    return gedaechtnis.index()


@werkzeug(LESEN)
def gedaechtnis_suchen(
        stichwort: Annotated[str, Field(description='Ein oder mehrere Stichwörter, z. B. "Familie Kalender"')],
        limit: Annotated[int, Field(ge=1, le=25, description='max. Treffer (Standard 8)')] = 8) -> CallToolResult:
    """Im Gedächtnis von Claude Code suchen (Volkers Tools, Apps, Projekte, Vorlieben). Liefert Namen
    + Fundstellen; ganzen Eintrag mit gedaechtnis_lesen."""
    return gedaechtnis.suchen(stichwort, limit)


@werkzeug(LESEN)
def gedaechtnis_lesen(name: Annotated[str, Field(description='Name aus gedaechtnis_suchen/gedaechtnis_index, z. B. "v3d-familie-tool"')]) -> CallToolResult:
    """Einen Gedächtnis-Eintrag vollständig lesen (Geheimnisse ausgeblendet)."""
    return gedaechtnis.lesen(name)


@werkzeug(AENDERN)
def gedaechtnis_merken(
        titel: Annotated[str, Field(description='Kurzer Titel, z. B. "Anycubic-Kontakt Sharron"')],
        inhalt: Annotated[str, Field(description='Die Notiz (Markdown, max. 8000 Zeichen); bei Vorgaben mit Begründung')],
        beschreibung: Annotated[str | None, Field(description='Eine Zeile für die Übersicht')] = None,
        art: Annotated[str, Field(description='user | feedback | project | reference')] = 'project') -> CallToolResult:
    """Etwas für Claude Code merken. Legt einen NEUEN Eintrag „eingang-…" an (bestehende werden nie
    geändert); Claude Code sieht ihn ab der nächsten Sitzung. Keine Passwörter/PINs ablegen."""
    return gedaechtnis.merken(titel, inhalt, beschreibung, art)


# --- HTTP ----------------------------------------------------------------------

@mcp.custom_route('/login', methods=['GET', 'POST'])
async def _login(request: Request):
    return await login(request)


@mcp.custom_route('/health', methods=['GET'])
async def _health(request: Request):
    return JSONResponse({'ok': True})


def build_app():
    warnings.filterwarnings('ignore', category=DeprecationWarning)
    sicherheit = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=settings.ALLOWED_HOSTS,
        allowed_origins=['https://claude.ai', 'https://claude.com',
                         'http://127.0.0.1:*', 'http://localhost:*'])
    app = mcp.streamable_http_app(streamable_http_path='/mcp', stateless_http=True,
                                  json_response=True, transport_security=sicherheit,
                                  host=settings.BIND_HOST)
    return app, RateLimit(app)


def serve():
    import uvicorn
    if not settings.passwort_hash():
        sys.stderr.write('WARNUNG: kein Login-Passwort gesetzt — `v3d-mail-mcp set-password`\n')
    starlette_app, app = build_app()
    uvicorn.run(app, host=settings.BIND_HOST, port=settings.PORT, access_log=False,
                proxy_headers=False, server_header=False, log_level='warning',
                lifespan='on')
