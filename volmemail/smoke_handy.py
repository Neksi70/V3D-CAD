#!/usr/bin/env python3
"""Browser-Smoke für die Handy-Ansicht von V3D Mail.

Prüft, dass man aus einer geöffneten Mail wieder herauskommt — über den
Zurück-Knopf UND über die System-Zurück-Geste von Android (die auf
history.back() hinausläuft). Öffnet nur bereits gelesene Mails.
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'https://127.0.0.1:8783/'
KEY = json.load(open(os.path.expanduser('~/.config/v3dmail/config.json')))['adminKey']
HANDY = {'width': 412, 'height': 915}
UA = ('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36')

fails = []


def check(name, cond, detail=''):
    print(('  ok  ' if cond else '  FEHLER ') + name + (' — ' + detail if detail and not cond else ''))
    if not cond:
        fails.append(name)


with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(ignore_https_errors=True, viewport=HANDY, is_mobile=True,
                         has_touch=True, user_agent=UA)
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)

    def leiste_auf():
        if 'open' not in (page.get_attribute('#side', 'class') or ''):
            page.click('#menubtn')
            page.wait_for_timeout(400)

    def leiste_zu():
        page.evaluate("document.getElementById('side').classList.remove('open')")
        page.wait_for_timeout(300)

    def zurueck_geste():
        """Die System-Zurück-Taste von Android. Playwrights go_back() wartet auf
        einen Ladevorgang, den es bei Sprüngen im selben Dokument nicht gibt —
        deshalb direkt über das Browser-Protokoll."""
        h = cdp.send('Page.getNavigationHistory')
        i = h['currentIndex']
        if i <= 0:
            return False
        cdp.send('Page.navigateToHistoryEntry', {'entryId': h['entries'][i - 1]['id']})
        return True
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(URL, wait_until='networkidle')
    page.fill('#lkey', KEY)
    page.click('text=Anmelden')
    page.wait_for_timeout(7000)
    check('Angemeldet', not page.is_visible('#login'))
    check('Liste ist die Startansicht', 'v-list' in page.evaluate('document.body.className'))
    check('Seitenleiste eingeklappt',
          page.evaluate("document.getElementById('side').getBoundingClientRect().right") <= 0)

    uid = page.evaluate('(S.msgs.find(m => m.seen) || {}).uid ?? null')
    if uid is None:
        print('  (übersprungen: keine gelesene Mail vorhanden)')
    else:
        # --- Weg 1: der Zurück-Knopf ---
        page.click('.item[data-uid="%d"]' % uid)
        page.wait_for_timeout(3000)
        check('Mail füllt den Bildschirm', 'v-read' in page.evaluate('document.body.className'))
        check('Zurück-Knopf sichtbar', page.is_visible('#back'))
        kasten = page.evaluate("JSON.stringify(document.getElementById('back').getBoundingClientRect())")
        kasten = json.loads(kasten)
        check('Zurück-Knopf ohne Scrollen erreichbar', kasten['top'] < 200,
              'liegt bei y=%d' % kasten['top'])
        check('Zurück-Knopf ist daumengroß', kasten['height'] >= 40,
              '%d px hoch' % kasten['height'])
        page.click('#back')
        page.wait_for_timeout(700)
        check('Zurück-Knopf führt zur Liste', 'v-list' in page.evaluate('document.body.className'))

        # --- Weg 2: die System-Zurück-Geste von Android ---
        page.click('.item[data-uid="%d"]' % uid)
        page.wait_for_timeout(3000)
        check('Chronik-Eintrag für die Mail angelegt', page.evaluate('S.layers.length') == 1,
              'Ebenen: %s' % page.evaluate('JSON.stringify(S.layers)'))
        zurueck_geste()
        page.wait_for_timeout(700)
        check('Zurück-Geste führt zur Liste', 'v-list' in page.evaluate('document.body.className'))
        check('App bleibt geöffnet', page.evaluate('typeof S !== "undefined"'))
        check('Ebenenstapel wieder leer', page.evaluate('S.layers.length') == 0)

        # --- Weg 3: Verfassen schließen ---
        leiste_auf()
        page.click('text=✉️ Neue Nachricht')
        leiste_zu()
        page.wait_for_timeout(500)
        check('Verfassen-Fenster offen', page.is_visible('#compose'))
        zurueck_geste()
        page.wait_for_timeout(700)
        check('Zurück-Geste schließt das Verfassen-Fenster', not page.is_visible('#compose'))

        # --- Weg 4: Dialog schließen ---
        leiste_auf()
        page.click('text=⚙️ Konten')
        leiste_zu()
        page.wait_for_timeout(500)
        check('Dialog offen', page.is_visible('#modal'))
        zurueck_geste()
        page.wait_for_timeout(700)
        check('Zurück-Geste schließt den Dialog', not page.is_visible('#modal'))

        # --- Weg 5: Mail, darin Verfassen — zweimal zurück ---
        page.click('.item[data-uid="%d"]' % uid)
        page.wait_for_timeout(2500)
        page.click('text=↩ Antworten')
        page.wait_for_timeout(600)
        check('Antwort-Fenster über der Mail', page.is_visible('#compose'))
        check('Zwei Ebenen gestapelt', page.evaluate('S.layers.length') == 2,
              page.evaluate('JSON.stringify(S.layers)'))
        zurueck_geste()
        page.wait_for_timeout(600)
        check('Erstes Zurück schließt nur die Antwort',
              not page.is_visible('#compose') and 'v-read' in page.evaluate('document.body.className'))
        zurueck_geste()
        page.wait_for_timeout(600)
        check('Zweites Zurück führt zur Liste', 'v-list' in page.evaluate('document.body.className'))

    page.screenshot(path='/tmp/v3dmail-handy.png', full_page=False)
    check('Keine JavaScript-Fehler', not errors, '; '.join(errors[:2]))
    br.close()

print()
if fails:
    print('FEHLGESCHLAGEN: ' + ', '.join(fails))
    sys.exit(1)
print('Handy-Ansicht in Ordnung. Screenshot: /tmp/v3dmail-handy.png')
