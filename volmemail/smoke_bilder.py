#!/usr/bin/env python3
"""Browser-Smoke für Bilder in V3D Mail.

Prüft den ganzen Weg, nicht nur die Mechanik: eingebettete Bilder (cid:) und
verlinkte Bilder aus dem Netz müssen im Anzeige-iframe wirklich zu sehen sein
UND sich einzeln speichern lassen. Braucht ein echtes Postfach.

Aufruf: python3 smoke_bilder.py [url]
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


def bilder_im_rahmen(page):
    """Nur die Bilder zaehlen, die auch angezeigt werden SOLLEN: blockierte
    Fremdbilder haben gar keine Quelle und wuerden das Bild verfaelschen."""
    return page.frame_locator('#frame').locator('body').evaluate("""b => {
        const im = [...b.querySelectorAll('img')].filter(i => (i.getAttribute('src') || '').startsWith('data:'));
        return { alle: im.length, geladen: im.filter(i => i.naturalWidth > 0).length };
    }""")


with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(ignore_https_errors=True, accept_downloads=True)
    page = ctx.new_page()
    fehler = []
    page.on('pageerror', lambda e: fehler.append(str(e)[:200]))
    page.on('console', lambda m: fehler.append(m.text[:160]) if m.type == 'error' else None)

    page.goto(URL, wait_until='networkidle')
    page.fill('#lkey', KEY)
    page.click('text=Anmelden')
    page.wait_for_timeout(1500)
    if not page.evaluate('S.accounts.length > 0'):
        print('  (übersprungen: kein Postfach eingerichtet)')
        sys.exit(0)
    page.wait_for_timeout(4000)

    # Zwei Fälle suchen: eine Mail mit eingebetteten Bildern (Anhang mit cid)
    # und eine mit verlinkten Bildern (die erst nach "Bilder anzeigen" kommen).
    kandidaten = page.evaluate('S.msgs.map(m => m.uid).slice(0, 20)')
    mit_cid = mit_netz = None
    for uid in kandidaten:
        if mit_cid and mit_netz:
            break
        page.evaluate('openMsg(%d, false)' % uid)
        page.wait_for_timeout(2200)
        if not mit_cid and page.evaluate("((S.cur && S.cur.html) || '').includes('cid-part:')"):
            mit_cid = uid
        elif not mit_netz and page.evaluate('(S.cur && S.cur.blockedImages) || 0') > 0:
            mit_netz = uid

    if mit_cid:
        page.evaluate('openMsg(%d, false)' % mit_cid)
        page.wait_for_timeout(4000)
        st = bilder_im_rahmen(page)
        check('Eingebettete Bilder werden dargestellt', st['alle'] > 0 and st['geladen'] == st['alle'],
              '%d von %d' % (st['geladen'], st['alle']))
        check('Bilderleiste hat Kacheln',
              page.evaluate("document.querySelectorAll('#rimgs .bild').length") > 0)
        with page.expect_download(timeout=20000) as dl:
            page.click('#rimgs .bild')
        datei = dl.value
        check('Eingebettetes Bild lässt sich speichern',
              bool(datei.suggested_filename) and os.path.getsize(datei.path()) > 0,
              datei.suggested_filename)
    else:
        print('  (kein Fall mit eingebetteten Bildern in den letzten 20 Mails)')

    if mit_netz:
        page.evaluate('openMsg(%d, false)' % mit_netz)
        page.wait_for_timeout(2500)
        check('Externe Bilder sind zunächst blockiert',
              page.evaluate('S.cur.blockedImages') > 0)
        vorher = bilder_im_rahmen(page)['geladen']
        page.click('text=Bilder anzeigen')
        page.wait_for_timeout(12000)
        st = bilder_im_rahmen(page)
        check('Nach "Bilder anzeigen" sind sie auch wirklich da',
              st['alle'] > 0 and st['geladen'] == st['alle'],
              '%d von %d geladen (vorher %d)' % (st['geladen'], st['alle'], vorher))
        kacheln = page.evaluate("document.querySelectorAll('#rimgs .bild').length")
        check('Verlinkte Bilder bekommen eigene Kacheln', kacheln > 0)
        if kacheln:
            with page.expect_download(timeout=20000) as dl:
                page.click('#rimgs .bild')
            datei = dl.value
            check('Verlinktes Bild lässt sich speichern',
                  bool(datei.suggested_filename) and os.path.getsize(datei.path()) > 0,
                  datei.suggested_filename)
    else:
        print('  (kein Fall mit verlinkten Bildern in den letzten 20 Mails)')

    check('Keine JavaScript-Fehler', not fehler, ' | '.join(fehler[:3]))
    br.close()

print(('\nALLES GRÜN' if not fails else '\nFEHLGESCHLAGEN: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
