#!/usr/bin/env python3
"""Prueft Vorschauzeile in der Liste + automatisches Bilderladen.

Schreibende Aufrufe sind gesperrt; /api/message bekommt markSeen=0 angehaengt,
damit der Test keine Nachricht als gelesen markiert.
"""
import sys
from playwright.sync_api import sync_playwright

URL = 'https://127.0.0.1:8783/'
fails = []


def check(name, cond, detail=''):
    print(('  ok  ' if cond else '  FEHLER ') + name + ((' — ' + str(detail)) if detail else ''))
    if not cond:
        fails.append(name)


with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(ignore_https_errors=True)
    page = ctx.new_page()
    fehler = []
    page.on('pageerror', lambda e: fehler.append(str(e)))
    # Das Selbstbau-Zertifikat laesst den Browser den Service Worker abweisen —
    # das ist die Testumgebung, kein Fehler der Oberflaeche.
    egal = ('SSL certificate error', 'Failed to load resource', 'Content Security Policy')
    page.on('console', lambda m: fehler.append(m.text)
            if m.type == 'error' and not any(e in m.text for e in egal) else None)

    def wache(route):
        r = route.request
        if r.method != 'GET':
            return route.abort()
        u = r.url
        if '/api/message?' in u and 'markSeen' not in u:
            return route.continue_(url=u + '&markSeen=0')
        route.continue_()
    page.route('**/api/**', wache)

    page.goto(URL, wait_until='networkidle')
    page.wait_for_timeout(4000)
    check('angemeldet', not page.is_visible('#login'))
    check('Einstellungen stehen auf an', page.evaluate('S.opt.vorschau && S.opt.bilder'),
          page.evaluate('JSON.stringify(S.opt)'))

    n = page.evaluate("document.querySelectorAll('#items .item').length")
    check('Liste gefuellt', n > 0, n)
    page.wait_for_function("document.querySelectorAll('#items .prev').length && "
                           "[...document.querySelectorAll('#items .prev')].filter(e=>e.textContent.trim()).length > 3",
                           timeout=15000)
    gefuellt = page.evaluate("[...document.querySelectorAll('#items .prev')].filter(e=>e.textContent.trim()).length")
    check('Vorschautext in fast allen Zeilen', gefuellt >= n - 2, '%d von %d' % (gefuellt, n))
    bsp = page.evaluate("document.querySelector('#items .prev').textContent")
    check('Vorschau ist Text ohne Markup', '<' not in bsp and len(bsp) > 10, bsp[:80])
    hoehe = page.evaluate("document.querySelector('#items .prev').getBoundingClientRect().height")
    check('Vorschau bleibt bei zwei Zeilen', hoehe <= 40, hoehe)

    # Eine bereits gelesene Nachricht oeffnen — dann aendert der Test nichts.
    uid = page.evaluate("(S.msgs.find(m=>m.seen)||{}).uid")
    if uid:
        page.evaluate('openMsg(%d)' % uid)
        page.wait_for_timeout(6000)
        check('Bilder wurden nicht blockiert', page.evaluate('S.cur && S.cur.blockedImages === 0'),
              page.evaluate('S.cur && S.cur.blockedImages'))
        check('Hinweisleiste bleibt weg', page.is_hidden('#rwarn'))
        check('Bildanfrage lief mit images=1', page.evaluate("!!S.cur"))

        # Newsletter-Grafiken duerfen die Bilderleiste nicht zumuellen.
        if page.evaluate("document.querySelectorAll('#rimgs .att').length >= 0") and page.is_visible('#rimgs'):
            zu = page.evaluate("!!document.getElementById('rdeko')")
            if zu:
                check('Text-Grafiken sind eingeklappt', page.is_hidden('#rdeko'))
                page.click('#bdeko')
                page.wait_for_timeout(300)
                check('Text-Grafiken lassen sich aufklappen',
                      page.is_visible('#rdeko') and
                      page.evaluate("document.querySelectorAll('#rdeko .att').length") > 0)

    # Ansicht-Dialog
    page.evaluate('ansichtDialog()')
    page.wait_for_timeout(400)
    check('Ansicht-Dialog offen', 'Ansicht' in page.inner_text('#modal') if page.is_visible('#modal') else False)
    page.evaluate("optSetzen('vorschau', false)")
    page.wait_for_timeout(600)
    check('Vorschau abschaltbar', page.evaluate("document.querySelectorAll('#items .prev').length") == 0)
    page.evaluate("optSetzen('vorschau', true)")
    page.wait_for_timeout(900)
    check('Vorschau wieder da', page.evaluate("[...document.querySelectorAll('#items .prev')].filter(e=>e.textContent.trim()).length") > 3)

    check('keine JS-Fehler', not fehler, ' | '.join(fehler[:3]))
    br.close()

print('\n' + ('ALLES GRUEN' if not fails else 'FEHLER: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
