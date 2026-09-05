#!/usr/bin/env python3
"""Browser-Smoke: Ziehen zum Aktualisieren am oberen Ende der Nachrichtenliste.

Simuliert echte Finger-Ereignisse (CDP Input.dispatchTouchEvent) auf einem
Handy-Viewport. Aufruf: python3 smoke_ziehen.py [url]
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
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 390, 'height': 844},
                         has_touch=True, is_mobile=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(URL, wait_until='networkidle')
    if page.is_visible('#login'):
        page.fill('#lkey', KEY)
        page.click('text=Anmelden')
        page.wait_for_timeout(2500)
    check('Angemeldet', not page.is_visible('#login'))
    if not page.evaluate('S.accounts.length > 0'):
        print('  (kein Postfach eingerichtet — Rest uebersprungen)')
        sys.exit(0)
    page.wait_for_selector('#items .item', timeout=20000)

    # Aktualisieren abfangen, damit der Test kein echtes IMAP anfasst.
    page.evaluate("""() => {
      window.__ptrRufe = 0;
      window.sendenEmpfangen = () => { window.__ptrRufe++;
        return new Promise(r => setTimeout(r, 400)); };
    }""")

    cdp = ctx.new_cdp_session(page)
    box = page.evaluate("() => { const b = document.getElementById('items').getBoundingClientRect();"
                        "return {x: b.x + b.width / 2, y: b.y + 20}; }")

    def touch(typ, y=None):
        pts = [] if typ == 'touchEnd' else [{'x': box['x'], 'y': y}]
        cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': pts})

    touch('touchStart', box['y'])
    zwischen = 0
    for dy in (12, 40, 80, 130, 180):
        touch('touchMove', box['y'] + dy)
        page.wait_for_timeout(40)
        zwischen = max(zwischen, page.evaluate(
            "() => parseFloat(getComputedStyle(document.getElementById('ptr')).opacity)"))
    verschoben = page.evaluate(
        "() => new DOMMatrix(getComputedStyle(document.getElementById('items')).transform).m42")
    check('Liste folgt dem Finger', verschoben > 30, 'Versatz %.1f px' % verschoben)
    check('Anzeige wird sichtbar', zwischen > 0.5, 'Deckkraft %.2f' % zwischen)

    touch('touchEnd')
    page.wait_for_timeout(120)
    check('Spinner laeuft waehrend der Pruefung',
          page.evaluate("() => document.getElementById('ptr').classList.contains('laeuft')"))
    check('Aktualisieren ausgeloest', page.evaluate('window.__ptrRufe') == 1,
          str(page.evaluate('window.__ptrRufe')))
    page.wait_for_timeout(900)
    zurueck = page.evaluate(
        "() => new DOMMatrix(getComputedStyle(document.getElementById('items')).transform).m42")
    check('Liste federt zurueck', abs(zurueck) < 1, 'Versatz %.1f px' % zurueck)
    check('Anzeige wieder aus', page.evaluate(
        "() => parseFloat(getComputedStyle(document.getElementById('ptr')).opacity)") < 0.05)

    # Kurzes Ziehen darf NICHT ausloesen.
    page.evaluate('window.__ptrRufe = 0')
    touch('touchStart', box['y'])
    for dy in (12, 25, 35):
        touch('touchMove', box['y'] + dy)
        page.wait_for_timeout(40)
    touch('touchEnd')
    page.wait_for_timeout(600)
    check('Kurzes Ziehen loest nichts aus', page.evaluate('window.__ptrRufe') == 0)

    # Mitten in der Liste (schon gescrollt) bleibt es beim normalen Scrollen.
    page.evaluate("() => { document.getElementById('items').scrollTop = 200; }")
    if page.evaluate("() => document.getElementById('items').scrollTop") > 0:
        touch('touchStart', box['y'] + 100)
        for dy in (40, 90, 150):
            touch('touchMove', box['y'] + 100 + dy)
            page.wait_for_timeout(40)
        touch('touchEnd')
        page.wait_for_timeout(600)
        check('Ziehen mitten in der Liste scrollt nur', page.evaluate('window.__ptrRufe') == 0)
    else:
        print('  (Liste zu kurz zum Scrollen — Test uebersprungen)')

    check('Keine JS-Fehler', not errors, '; '.join(errors[:3]))
    br.close()

print('\n%s' % ('ALLES GRUEN' if not fails else 'FEHLER: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
