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
    ctx = br.new_context(ignore_https_errors=True, accept_downloads=True)
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
        check('Postfächer stehen als Knöpfe in der Seitenleiste',
              page.evaluate("document.querySelectorAll('#accs .acc').length") ==
              page.evaluate('S.accounts.length'))
        check('Aktives Postfach ist hervorgehoben',
              page.evaluate("document.querySelectorAll('#accs .acc.act').length") == 1)
        check('Postfach-hinzufügen direkt in der Seitenleiste',
              page.is_visible('#accs .accadd'))
        check('Nachrichtenliste geladen', page.evaluate('S.msgs.length') > 0,
              'keine Nachrichten')

        # Senden/Empfangen prüft alle Postfächer auf einmal
        check('Senden/Empfangen-Knopf vorhanden', page.is_visible('#sendrecv'))
        page.evaluate('S.status = {}')
        page.click('#sendrecv')
        page.wait_for_timeout(6000)
        st = page.evaluate('S.status || {}')
        check('Alle Postfächer geprüft', len(st) == page.evaluate('S.accounts.length'),
              '%d von %d' % (len(st), page.evaluate('S.accounts.length')))
        check('Kein Postfach meldet einen Fehler',
              not [v for v in st.values() if v.get('error')],
              str([v.get('error') for v in st.values() if v.get('error')][:1]))
        check('Zustand enthält Zählwerte',
              all(isinstance(v.get('unread'), int) and isinstance(v.get('total'), int)
                  for v in st.values() if not v.get('error')))
        ungelesen = sum(v.get('unread', 0) for v in st.values())
        check('Ungelesene werden am Postfach angezeigt',
              page.evaluate("document.querySelectorAll('#accs .acc .zahl').length") ==
              len([v for v in st.values() if v.get('unread')]),
              'insgesamt %d ungelesen' % ungelesen)
        check('Knopf ist wieder benutzbar', not page.evaluate("document.getElementById('sendrecv').disabled"))

        # Nur bereits gelesene Mails öffnen — sonst verändern wir echte Daten.
        # Bevorzugt eine mit Anhang, damit die Bilderleiste geprüft wird.
        uid = page.evaluate("""() => {
            const g = S.msgs.filter(m => m.seen);
            return ((g.find(m => m.hasAttachments) || g[0]) || {}).uid ?? null;
        }""")
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

            # Bilder aus der Mail müssen einzeln speicherbar sein. Nicht jede Mail
            # hat welche — unter den gelesenen nach einer passenden suchen.
            bilder = page.evaluate('(S.bilder || []).length')
            if not bilder:
                # Nicht auf hasAttachments filtern: eingebettete Signaturbilder
                # zählen bewusst nicht als Anhang, sind hier aber genau der Fall.
                kandidaten = page.evaluate('S.msgs.filter(m => m.seen).map(m => m.uid).slice(0, 8)')
                for k in kandidaten:
                    if k == uid:
                        continue
                    page.evaluate('openMsg(%d)' % k)
                    page.wait_for_timeout(2500)
                    bilder = page.evaluate('(S.bilder || []).length')
                    if bilder:
                        break
            if bilder:
                check('Bilderleiste sichtbar', page.is_visible('#rimgs'))
                check('Jedes Bild als eigene Kachel',
                      page.evaluate("document.querySelectorAll('#rimgs .bild').length") == bilder)
                page.wait_for_timeout(2500)
                check('Vorschau wird geladen',
                      page.evaluate("""() => [...document.querySelectorAll('#rimgs .vor')]
                          .some(e => (e.style.backgroundImage || '').startsWith('url'))"""))
                with page.expect_download(timeout=15000) as dl:
                    page.click('#rimgs .bild')
                datei = dl.value
                check('Bild lässt sich herunterladen', bool(datei.suggested_filename),
                      'kein Dateiname')
                pfad = datei.path()
                check('Heruntergeladene Datei ist nicht leer',
                      pfad and os.path.getsize(pfad) > 0)
                print('       (gespeichert: %s)' % datei.suggested_filename)
            else:
                print('  (übersprungen: gewählte Mail enthält keine Bilder)')
        # Absenderwahl beim Verfassen: erscheint erst ab zwei Konten. Das zweite
        # Konto wird nur im Browser vorgetäuscht — der Server bleibt unberührt.
        page.evaluate("""() => {
            window._echteKonten = S.accounts;
            S.accounts = S.accounts.concat([{ id: 'test-zweit', email: 'zweit@beispiel.de',
                                              name: 'Zweitkonto', signature: 'Zweite Signatur' }]);
        }""")
        erwartet = page.evaluate('S.accounts.length')      # echte Konten + das vorgetäuschte
        page.evaluate('renderAccounts()')
        page.wait_for_timeout(200)
        check('Zusätzliches Postfach erscheint als eigener Knopf',
              page.evaluate("document.querySelectorAll('#accs .acc').length") == erwartet,
              'erwartet %d' % erwartet)
        check('Nur eines ist hervorgehoben',
              page.evaluate("document.querySelectorAll('#accs .acc.act').length") == 1)
        check('Adresse steht unter dem Namen',
              'zweit@beispiel.de' in page.inner_text('#accs'))

        page.evaluate('compose()')
        page.wait_for_timeout(400)
        check('Absenderzeile bei mehreren Konten sichtbar', page.is_visible('#cfromrow'))
        check('Alle Konten zur Auswahl',
              page.evaluate("document.querySelectorAll('#cfrom option').length") == erwartet,
              'erwartet %d' % erwartet)
        page.select_option('#cfrom', 'test-zweit')
        page.wait_for_timeout(300)
        # Die Signatur steht nicht mehr im Textfeld, sondern wird darunter
        # angekündigt und erst beim Senden angehängt.
        check('Signatur folgt dem Absender', 'Zweite Signatur' in page.inner_text('#csig'),
              repr(page.inner_text('#csig')[:70]))
        check('Signatur bleibt aus dem Textfeld heraus',
              'Zweite Signatur' not in page.input_value('#ctext'))
        page.evaluate('closeCompose()')
        page.wait_for_timeout(500)     # Zurück-Sprung abwarten, sonst überholt der nächste Klick

        # Antwort soll aus dem Postfach kommen, das die Mail empfangen hat
        treffer = page.evaluate("""() => {
            const eigen = window._echteKonten[0];
            return senderFor({ to: [{ email: eigen.email }], cc: [] }) === eigen.id;
        }""")
        check('Antwort nutzt das empfangende Postfach', treffer)
        page.evaluate('S.accounts = window._echteKonten; renderAccounts()')

        page.click('text=⚙️ Konten')
        page.wait_for_timeout(600)
        check('Kontoverwaltung erreichbar', page.is_visible('#modal'))
        check('Vorhandenes Konto wird aufgelistet',
              '@' in page.inner_text('#modalbox'))
        check('Knopf zum Hinzufügen vorhanden',
              'Konto hinzufügen' in page.inner_text('#modalbox'))
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
