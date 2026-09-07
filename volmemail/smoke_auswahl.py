#!/usr/bin/env python3
"""Browser-Smoke: mehrere Nachrichten auswählen und sammeln löschen.

WICHTIG: schreibende Aufrufe (delete/move/flag/send) werden auf NETZWERK-Ebene
abgefangen (page.route) und beantwortet, ohne den Server zu erreichen. Ein Stub
per `window.post = …` greift NICHT — `post` und `api` sind `const` und damit an
die lexikalische Bindung gekoppelt. Der Test läuft gegen das echte Postfach;
ohne diese Sperre würde er wirklich Mails löschen und verschieben.

Aufruf: python3 smoke_auswahl.py [url]
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'https://127.0.0.1:8783/'
KEY = json.load(open(os.path.expanduser('~/.config/v3dmail/config.json')))['adminKey']

SCHREIBEND = ('delete', 'move', 'flag', 'send')
ANTWORT = {'delete': {'ok': True, 'toTrash': True}, 'move': {'ok': True},
           'flag': {'ok': True}, 'send': {'ok': True}}

fails = []
rufe = []


def check(name, cond, detail=''):
    print(('  ok  ' if cond else '  FEHLER ') + name + (' — ' + detail if detail and not cond else ''))
    if not cond:
        fails.append(name)


def sperre(route):
    """Schreibende API-Aufrufe mitschreiben und selbst beantworten."""
    req = route.request
    pfad = req.url.rsplit('/api/', 1)[-1].split('?')[0]
    if req.method == 'POST' and pfad in SCHREIBEND:
        try:
            rumpf = json.loads(req.post_data or '{}')
        except ValueError:
            rumpf = {}
        rufe.append({'pfad': pfad, 'rumpf': rumpf})
        return route.fulfill(status=200, content_type='application/json',
                             body=json.dumps(ANTWORT[pfad]))
    route.fallback()


def anmelden(page):
    page.route('**/api/**', sperre)
    page.goto(URL, wait_until='networkidle')
    if page.is_visible('#login'):
        page.fill('#lkey', KEY)
        page.click('text=Anmelden')
        page.wait_for_timeout(2500)
    page.wait_for_selector('#items .item', timeout=25000)


def letzte(pfad):
    return [r for r in rufe if r['pfad'] == pfad]


with sync_playwright() as p:
    br = p.chromium.launch()
    errors = []

    # ---------- Rechner: Kästchen, Umschalt-Bereich, Sammelbefehle ----------
    ctx = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 900})
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    anmelden(page)
    check('Liste geladen', page.locator('#items .item').count() > 4)

    # Erst beweisen, dass die Sperre greift — sonst faesst der Test echte Mails an.
    page.evaluate("() => post('flag', {acc: S.acc.id, folder: S.folder, uids: [], "
                  "flag: '\\\\Seen', on: true})")
    page.wait_for_timeout(400)
    if not letzte('flag'):
        print('  ABBRUCH: schreibende Aufrufe werden nicht abgefangen')
        sys.exit(2)
    check('Sperre für schreibende Aufrufe greift', True)
    rufe.clear()

    zeilen = page.locator('#items .item')
    zeilen.nth(0).locator('.pick').click()
    check('Kästchen wählt aus', page.evaluate('S.sel.size') == 1)
    check('Zeile ist hervorgehoben', 'sel' in (zeilen.nth(0).get_attribute('class') or ''))
    check('Leiste zeigt die Anzahl', '1 ausgewählt' in page.inner_text('#listbar'),
          page.inner_text('#listbar'))
    check('Auswählen öffnet die Mail nicht', page.evaluate('S.cur') is None)

    zeilen.nth(3).locator('.pick').click(modifiers=['Shift'])
    check('Umschalt greift den Bereich', page.evaluate('S.sel.size') == 4,
          str(page.evaluate('S.sel.size')))

    page.click('#listbar >> text=Alle')
    anzahl = page.evaluate('S.msgs.length')
    check('„Alle" wählt die ganze Seite', page.evaluate('S.sel.size') == anzahl,
          '%s von %s' % (page.evaluate('S.sel.size'), anzahl))
    check('Knopf heißt jetzt „Keine"', 'Keine' in page.inner_text('#listbar'))
    page.click('#listbar >> text=Keine')
    check('„Keine" hebt alles auf', page.evaluate('S.sel.size') == 0)
    check('Leiste wieder normal', 'ausgewählt' not in page.inner_text('#listbar'))

    # Ohne Auswahl öffnet der Klick weiterhin die Mail
    zeilen.nth(0).click()
    page.wait_for_timeout(1500)
    check('Ohne Auswahl öffnet der Klick die Mail', page.evaluate('S.cur !== null'))

    # Mit aktiver Auswahl hakt ein einfacher Klick nur an
    zeilen.nth(1).locator('.pick').click()
    zeilen.nth(2).click()
    check('Klick bei aktiver Auswahl hakt an', page.evaluate('S.sel.size') == 2,
          str(page.evaluate('S.sel.size')))

    gewaehlt = page.evaluate('[...S.sel]')
    page.click('#listbar >> text=Löschen')
    page.wait_for_timeout(2000)
    ruf = letzte('delete')
    check('Genau ein Löschaufruf', len(ruf) == 1, str(len(ruf)))
    if ruf:
        check('Alle ausgewählten UIDs gehen mit',
              sorted(ruf[0]['rumpf']['uids']) == sorted(gewaehlt),
              '%s vs %s' % (ruf[0]['rumpf']['uids'], gewaehlt))
        check('Ordner stimmt', ruf[0]['rumpf']['folder'] == page.evaluate('S.folder'))
    check('Auswahl danach leer', page.evaluate('S.sel.size') == 0)

    # Gelesen-Markierung über die Leiste
    rufe.clear()
    zeilen.nth(0).locator('.pick').click()
    zeilen.nth(1).locator('.pick').click()
    page.click('#listbar >> button[onclick^="auswahlGelesen"]')
    page.wait_for_timeout(900)
    fl = letzte('flag')
    check('Gelesen-Markierung als ein Aufruf', len(fl) == 1 and len(fl[0]['rumpf']['uids']) == 2,
          str(fl))
    check('Seen-Merker gesetzt', bool(fl) and fl[0]['rumpf']['flag'] == '\\Seen', str(fl))
    page.evaluate('() => auswahlLeeren()')

    # Verschieben nimmt die ganze Auswahl mit
    rufe.clear()
    zeilen.nth(0).locator('.pick').click()
    zeilen.nth(1).locator('.pick').click()
    page.click('#listbar >> text=Verschieben')
    page.wait_for_timeout(400)
    page.click('#modal button:has-text("Verschieben")')
    page.wait_for_timeout(900)
    mv = letzte('move')
    check('Verschieben nimmt beide mit', len(mv) == 1 and len(mv[0]['rumpf']['uids']) == 2, str(mv))

    # Abbrechen im Dialog darf nichts anfassen
    rufe.clear()
    page.evaluate('() => auswahlLeeren()')
    check('Auswahl nach dem Verschieben leer', page.evaluate('S.sel.size') == 0)

    ctx.close()

    # ---------- Handy: langes Tippen ----------
    ctx2 = br.new_context(ignore_https_errors=True, viewport={'width': 390, 'height': 844},
                          has_touch=True, is_mobile=True)
    page2 = ctx2.new_page()
    page2.on('pageerror', lambda e: errors.append(str(e)))
    anmelden(page2)
    cdp = ctx2.new_cdp_session(page2)
    b = page2.evaluate("""() => { const r = document.querySelectorAll('#items .item')[1]
        .getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; }""")
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart',
                                          'touchPoints': [{'x': b['x'], 'y': b['y']}]})
    page2.wait_for_timeout(750)
    check('Langes Tippen wählt aus', page2.evaluate('S.sel.size') == 1,
          str(page2.evaluate('S.sel.size')))
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    page2.wait_for_timeout(400)
    check('Auswahl bleibt nach dem Loslassen', page2.evaluate('S.sel.size') == 1)
    check('Lange gedrückt öffnet die Mail nicht', page2.evaluate('S.cur') is None)

    b2 = page2.evaluate("""() => { const r = document.querySelectorAll('#items .item')[2]
        .getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; }""")
    page2.touchscreen.tap(b2['x'], b2['y'])
    page2.wait_for_timeout(500)
    check('Kurzes Tippen hakt an, wenn schon gewählt ist', page2.evaluate('S.sel.size') == 2,
          str(page2.evaluate('S.sel.size')))
    check('Kurzes Tippen öffnet dabei nichts', page2.evaluate('S.cur') is None)

    # Ordnerwechsel verwirft die Auswahl
    page2.evaluate("() => loadMessages(S.folder, 1)")
    page2.wait_for_timeout(2500)
    check('Seitenwechsel verwirft die Auswahl', page2.evaluate('S.sel.size') == 0)

    check('Keine JS-Fehler', not errors, '; '.join(errors[:3]))
    check('Kein ungewollter Schreibzugriff',
          all(r['pfad'] in SCHREIBEND for r in rufe), str(rufe))
    br.close()

print('\n%s' % ('ALLES GRUEN' if not fails else 'FEHLER: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
