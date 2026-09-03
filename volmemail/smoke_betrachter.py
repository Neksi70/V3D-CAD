#!/usr/bin/env python3
"""Bild-Anhänge: Dateiname sofort sichtbar, Klick öffnet den Betrachter,
Speichern-Knopf lädt herunter. Läuft gegen die laufende Instanz."""
import json, os, sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'https://127.0.0.1:8783/'
KEY = json.load(open(os.path.expanduser('~/.config/v3dmail/config.json')))['adminKey']
fails = []

def check(name, cond, detail=''):
    print(('  ok  ' if cond else '  FEHLER ') + name + (' — ' + detail if detail and not cond else ''))
    if not cond:
        fails.append(name)

def finde_mail_mit_bildanhang(page, hoechstens=40):
    """Erste Mail, deren Bilderleiste einen ECHTEN Anhang enthält (kein Netz-Bild)."""
    uids = page.evaluate('S.msgs.filter(m => m.hasAttachments).map(m => m.uid).slice(0, %d)' % hoechstens)
    for uid in uids:
        page.evaluate('openMsg(%d, false)' % uid)
        page.wait_for_timeout(2000)
        n = page.evaluate('(S.bilder || []).filter(a => !a.url).length')
        if n:
            return uid, n
    return None, 0

def lauf(page, handy):
    print('--- %s ---' % ('Handy' if handy else 'Rechner'))
    uid, n = finde_mail_mit_bildanhang(page)
    if not uid:
        print('  (keine Mail mit Bild-Anhang unter den letzten Mails gefunden)')
        return
    namen = page.evaluate("[...document.querySelectorAll('#rimgs .namen .att')].map(e => e.textContent.trim())")
    erwartet = page.evaluate('(S.bilder || []).map(a => a.filename)')
    check('Dateinamen stehen ohne Aufklappen in der Leiste', len(namen) == len(erwartet) and
          all(e in t for e, t in zip(erwartet, namen)), '%r vs %r' % (namen, erwartet))
    check('Kacheln bleiben eingeklappt', not page.is_visible('#rraster'))
    check('Betrachter ist zu', not page.is_visible('#lightbox'))

    page.click('#rimgs .namen .att')
    check('Betrachter öffnet sich', page.is_visible('#lightbox'))
    page.wait_for_function("document.getElementById('lbimg').naturalWidth > 0", timeout=15000)
    breite = page.evaluate("document.getElementById('lbimg').naturalWidth")
    check('Bild wird angezeigt', breite > 0, 'naturalWidth=%s' % breite)
    check('Name steht im Betrachter', page.inner_text('#lbname').strip() == erwartet[0],
          page.inner_text('#lbname'))
    # Bild darf nicht aus dem Fenster laufen
    passt = page.evaluate("""() => { const r = document.getElementById('lbimg').getBoundingClientRect();
        return r.width <= innerWidth && r.height <= innerHeight && r.width > 0; }""")
    check('Bild passt ins Fenster', passt)

    with page.expect_download(timeout=15000) as dl:
        page.click('#lightbox .btn')
    check('Speichern aus dem Betrachter liefert die Datei',
          dl.value.suggested_filename == erwartet[0] and os.path.getsize(dl.value.path()) > 0,
          dl.value.suggested_filename)

    if n > 1:
        page.click('#lbnext')
        page.wait_for_timeout(1500)
        check('Blättern zum nächsten Bild', page.inner_text('#lbname').strip() == erwartet[1])

    page.keyboard.press('Escape')
    page.wait_for_timeout(500)
    check('Escape schließt den Betrachter', not page.is_visible('#lightbox'))
    check('Mail bleibt offen', page.evaluate('S.cur && S.cur.uid') == uid)
    if handy:
        check('Leseansicht noch aktiv', page.evaluate("document.body.classList.contains('v-read')"))
        # Zurück-Geste: erst Betrachter, dann Mail
        page.click('#rimgs .namen .att')
        page.wait_for_timeout(800)
        page.go_back()
        page.wait_for_timeout(600)
        check('Zurück schließt nur den Betrachter', not page.is_visible('#lightbox') and
              page.evaluate("document.body.classList.contains('v-read')"))

with sync_playwright() as p:
    br = p.chromium.launch()
    for handy in (False, True):
        ctx = br.new_context(ignore_https_errors=True, accept_downloads=True,
                             viewport={'width': 390, 'height': 800} if handy else {'width': 1280, 'height': 900})
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL, wait_until='networkidle')
        if page.is_visible('#login'):
            page.fill('#lkey', KEY)
            page.click('text=Anmelden')
            page.wait_for_timeout(1200)
        page.wait_for_timeout(4000)
        lauf(page, handy)
        check('Keine JS-Fehler', not errors, '; '.join(errors)[:300])
        ctx.close()
    br.close()

print('\n%d Fehler' % len(fails) if fails else '\nAlles in Ordnung')
sys.exit(1 if fails else 0)
