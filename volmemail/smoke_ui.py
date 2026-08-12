#!/usr/bin/env python3
"""Browser-Smoke für V3D Mail: Anmeldung, Kontodialog, Server-Suche.

Ohne echtes Postfach — prüft, dass die Oberfläche lädt und der erste Schritt
(Konto anlegen) fehlerfrei durchläuft. Aufruf: python3 smoke_ui.py [url]
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'https://127.0.0.1:8783/'
KEY = json.load(open(os.path.expanduser('~/.config/v3dmail/config.json')))['adminKey']

fails = []


def check(name, cond, detail=''):
    print(('  ok  ' if cond else '  FEHLER ') + name + (' — ' + detail if detail and not cond else ''))
    if not cond:
        fails.append(name)


with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(ignore_https_errors=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

    page.goto(URL, wait_until='networkidle')
    check('Seite lädt', page.title() == 'V3D Mail', page.title())
    check('Anmeldemaske sichtbar', page.is_visible('#login'))

    # Falscher Schlüssel
    page.fill('#lkey', 'falsch')
    page.click('text=Anmelden')
    page.wait_for_timeout(900)
    check('Falscher Schlüssel wird abgewiesen', 'Falscher Schlüssel' in page.inner_text('#lerr'),
          page.inner_text('#lerr'))

    # Richtiger Schlüssel
    page.fill('#lkey', KEY)
    page.click('text=Anmelden')
    page.wait_for_timeout(1200)
    check('Anmeldung erfolgreich', not page.is_visible('#login'))

    hat_konto = page.evaluate('S.accounts.length > 0')
    if hat_konto:
        # Echtes Postfach vorhanden: Ordner, Liste und Darstellung prüfen.
        page.wait_for_timeout(4000)
        check('Ordner geladen', page.evaluate('S.folders.length') > 0)
        check('Nachrichtenliste geladen', page.evaluate('S.msgs.length') > 0,
              'keine Nachrichten')

        # Nur eine bereits gelesene Mail öffnen — sonst verändern wir echte Daten.
        uid = page.evaluate('(S.msgs.find(m => m.seen) || {}).uid ?? null')
        if uid is None:
            print('  (übersprungen: keine bereits gelesene Mail vorhanden)')
        else:
            page.evaluate('openMsg(%d)' % uid)
            page.wait_for_timeout(3500)
            check('Betreff angezeigt', len(page.inner_text('#rsubj')) > 0)
            # Der Kern der Sache: im Anzeige-iframe muss lesbarer Text stehen.
            sichtbar = page.evaluate("""() => {
                const s = document.getElementById('frame').srcdoc || '';
                const b = s.replace(/^[\\s\\S]*?<body>/, '').replace(/<[^>]*>/g, '');
                return b.trim().length;
            }""")
            check('Mail-Rumpf ist nicht leer', sichtbar > 0,
                  'iframe enthält keinen lesbaren Text (%d Zeichen)' % sichtbar)
            try:
                gerendert = page.frame_locator('#frame').locator('body').inner_text(timeout=4000)
                check('Rumpf wird tatsächlich dargestellt', len(gerendert.strip()) > 0,
                      'iframe rendert leer')
            except Exception as e:
                print('  (Rendering-Prüfung nicht möglich: %s)' % type(e).__name__)
        page.click('text=⚙️ Konten')
        page.wait_for_timeout(600)
        check('Kontoverwaltung erreichbar', page.is_visible('#modal'))
    else:
        check('Kontodialog erscheint bei leerem Konto', page.is_visible('#modal'))
        check('Hinweis auf erstes Konto', 'Konto' in page.inner_text('#modalbox'))

    # Kontoformular öffnen
    page.click('text=+ Konto hinzufügen')
    page.wait_for_timeout(400)
    check('Formular offen', page.is_visible('#a_email'))

    # Server-Suche gegen eine Domain mit bekannten Einstellungen
    page.fill('#a_email', 'jemand@posteo.de')
    page.click('text=Server suchen')
    page.wait_for_timeout(6000)
    imap = page.input_value('#a_ih')
    smtp = page.input_value('#a_sh')
    check('IMAP-Server gefunden', imap == 'posteo.de', imap)
    check('SMTP-Server gefunden', smtp == 'posteo.de', smtp)
    check('Quelle angezeigt', 'Anbieterdatenbank' in page.inner_text('#a_ac'), page.inner_text('#a_ac'))

    # Zweiter Fall: Domain ohne eigene imap.-Namen — hier hilft nur Autodiscover
    # über den SRV-Eintrag, genau wie bei Outlook.
    page.fill('#a_email', 'info@volme3dakademie.de')
    page.click('text=Server suchen')
    page.wait_for_timeout(8000)
    check('Fremdgehostete Domain: IMAP gefunden', page.input_value('#a_ih') == 'imap.goneo.de',
          page.input_value('#a_ih'))
    check('Fremdgehostete Domain: SMTP gefunden', page.input_value('#a_sh') == 'smtp.goneo.de',
          page.input_value('#a_sh'))
    check('Fremdgehostete Domain: SSL-Versand erkannt', page.input_value('#a_sp') == '465',
          page.input_value('#a_sp'))
    check('Weg wird benannt', 'Autodiscover' in page.inner_text('#a_ac'), page.inner_text('#a_ac'))

    # Speichern ohne Passwort muss abgelehnt werden
    page.click('#a_save')
    page.wait_for_timeout(600)
    check('Speichern ohne Passwort abgelehnt', 'Passwort' in page.inner_text('#a_err'),
          page.inner_text('#a_err'))

    # Falsches Passwort: die Prüfung muss den IMAP-Fehler melden, nicht abstürzen
    page.fill('#a_pass', 'garantiert-falsch')
    page.click('#a_save')
    page.wait_for_timeout(15000)
    err = page.inner_text('#a_err')
    check('Falsche Zugangsdaten werden gemeldet', len(err) > 0, '(keine Meldung)')
    check('Kein Konto gespeichert', page.is_visible('#a_email'))

    real_errors = [e for e in errors if 'Failed to load resource' not in e]
    check('Keine JavaScript-Fehler', not real_errors, '; '.join(real_errors[:3]))

    page.screenshot(path='/tmp/v3dmail-smoke.png', full_page=True)
    br.close()

print()
if fails:
    print('FEHLGESCHLAGEN: ' + ', '.join(fails))
    sys.exit(1)
print('Alle UI-Prüfungen bestanden. Screenshot: /tmp/v3dmail-smoke.png')
