#!/usr/bin/env python3
"""Dunkelmodus: Umschalten in 🖼 Ansicht, Flächen dunkel, Textmail dunkel,
HTML-Mail auf weißem Papier, Wahl übersteht Neuladen. Läuft gegen die laufende
Instanz — schreibende Aufrufe (Gelesen-Merker usw.) werden auf Netzebene gesperrt."""
import json, os, sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'https://127.0.0.1:8783/'
KEY = json.load(open(os.path.expanduser('~/.config/v3dmail/config.json')))['adminKey']
fails = []
gesperrt = []

def check(name, cond, detail=''):
    print(('  ok  ' if cond else '  FEHLER ') + name + (' — ' + str(detail) if detail and not cond else ''))
    if not cond:
        fails.append(name)

def sperre(route):
    req = route.request
    if req.method != 'GET' and not req.url.endswith('/api/login'):
        gesperrt.append(req.url)
        return route.fulfill(status=200, content_type='application/json', body='{"ok":true}')
    return route.continue_()

HELL = 'rgb(255, 255, 255)'

def farbe(page, sel, prop='backgroundColor'):
    return page.evaluate("(a) => getComputedStyle(document.querySelector(a[0]))[a[1]]", [sel, prop])

def rahmen_bg(page):
    return page.evaluate("getComputedStyle(document.getElementById('frame').contentDocument.documentElement).backgroundColor")

def lauf(browser, handy):
    print('--- %s ---' % ('Handy' if handy else 'Rechner'))
    ctx = browser.new_context(ignore_https_errors=True, color_scheme='light',
                              **({'viewport': {'width': 390, 'height': 800}, 'is_mobile': True, 'has_touch': True}
                                 if handy else {'viewport': {'width': 1400, 'height': 900}}))
    page = ctx.new_page()
    page.route('**/api/**', sperre)
    page.goto(URL)
    # offenerZugang: die Anmeldemaske blitzt nur kurz auf — erst schauen, ob sie bleibt.
    try:
        page.wait_for_selector('#app:not(.hide)', timeout=4000)
    except Exception:
        page.fill('#lkey', KEY); page.click('#login .btn')
        page.wait_for_selector('#app:not(.hide)')
    page.wait_for_function('S.msgs && S.msgs.length', timeout=30000)
    # Sperre beweisen, bevor irgendetwas geklickt wird.
    n = len(gesperrt)
    page.evaluate("post('flag', {probe: 1}).catch(() => {})")
    page.wait_for_timeout(300)
    if len(gesperrt) <= n:
        print('  ABBRUCH: Schreibsperre greift nicht'); sys.exit(2)

    check('Start hell (Gerät hell)', page.evaluate("document.documentElement.dataset.theme") == 'hell')
    page.evaluate('ansichtDialog()')
    page.click("#modalbox button:has-text('Dunkel')")
    check('Umschalten auf dunkel', page.evaluate("document.documentElement.dataset.theme") == 'dunkel')
    page.evaluate('closeModal()')
    check('Liste ist dunkel', farbe(page, '#list') != HELL, farbe(page, '#list'))
    check('Seitenhintergrund dunkel', farbe(page, 'body') != 'rgb(244, 245, 249)')

    page.reload()
    page.wait_for_function('S.msgs && S.msgs.length', timeout=30000)
    check('Wahl übersteht Neuladen', page.evaluate("document.documentElement.dataset.theme") == 'dunkel')

    # Eine reine Textmail und eine HTML-Mail suchen.
    gefunden = {}
    for uid in page.evaluate('S.msgs.map(m => m.uid).slice(0, 25)'):
        page.evaluate('openMsg(%d, false)' % uid)
        page.wait_for_function('S.cur && S.cur.uid === %d' % uid, timeout=20000)
        page.wait_for_function("(() => { const d = document.getElementById('frame').contentDocument;"
                               " return d && d.body && !/^lädt/.test(d.body.textContent.trim()); })()", timeout=20000)
        page.wait_for_timeout(300)
        plain = page.evaluate("/^\\s*<pre class=\"plain\">/.test(S.cur.html || '')")
        art = 'text' if plain else 'html'
        if art not in gefunden:
            gefunden[art] = uid
            page.screenshot(path='/tmp/v3dmail_dunkel_%s_%s.png' % ('handy' if handy else 'pc', art))
            if art == 'text':
                check('Textmail im Rahmen dunkel', rahmen_bg(page) != HELL, rahmen_bg(page))
            else:
                check('HTML-Mail auf weißem Papier', rahmen_bg(page) == HELL, rahmen_bg(page))
        if len(gefunden) == 2:
            break
    if 'text' not in gefunden: print('  (keine reine Textmail unter den letzten 25)')

    page.evaluate('ansichtDialog()')
    page.click("#modalbox button:has-text('Hell')")
    page.evaluate('closeModal()')
    check('Zurück auf hell', farbe(page, '#read') == HELL)
    page.evaluate('ansichtDialog()')
    page.click("#modalbox button:has-text('Gerät')")
    page.evaluate('closeModal()')
    page.emulate_media(color_scheme='dark')
    page.wait_for_timeout(200)
    check('„Gerät" folgt dunklem System', page.evaluate("document.documentElement.dataset.theme") == 'dunkel')
    ctx.close()

with sync_playwright() as p:
    b = p.chromium.launch()
    lauf(b, False)
    lauf(b, True)
    b.close()
print('gesperrte Schreibaufrufe:', len(gesperrt))
print('FEHLER: ' + ', '.join(fails) if fails else 'alles ok')
sys.exit(1 if fails else 0)
