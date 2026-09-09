#!/usr/bin/env python3
"""Browser-Smoke: Benachrichtigungen (Web Push) von Anfang bis Ende.

Läuft mit Firefox — der spricht mit Mozillas Push-Dienst, während die
Playwright-Chromium ohne Google-Schlüssel gar keinen Push-Dienst hat. Geprüft
wird der ganze Weg: Gerät anmelden → Server schickt → Service Worker zeigt die
Meldung. Der Zustellweg geht wirklich über das Internet.

Aufruf: python3 smoke_push.py [url]
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


MELDUNGEN = """async () => {
  const r = await navigator.serviceWorker.getRegistration();
  const n = await r.getNotifications();
  return n.map(x => ({titel: x.title, text: x.body, tag: x.tag, ziel: (x.data || {}).ziel}));
}"""


def warte_auf_meldung(page, anzahl=1, versuche=120):   # bis 60 s: der Weg geht
                                                      # wirklich uebers Internet
    for _ in range(versuche):
        m = page.evaluate(MELDUNGEN)
        if len(m) >= anzahl:
            return m
        page.wait_for_timeout(500)
    return page.evaluate(MELDUNGEN)


with sync_playwright() as p:
    br = p.firefox.launch(firefox_user_prefs={
        'dom.push.connection.enabled': True,
        'dom.push.enabled': True,
        'dom.push.serverURL': 'wss://push.services.mozilla.com/',
        'dom.webnotifications.enabled': True,
        'permissions.default.desktop-notification': 1,
    })
    ctx = br.new_context(ignore_https_errors=True, permissions=['notifications'])
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(URL, wait_until='networkidle')
    if page.is_visible('#login'):
        page.fill('#lkey', KEY)
        page.click('text=Anmelden')
        page.wait_for_timeout(2500)
    page.wait_for_timeout(1500)

    check('Browser kann Push', page.evaluate("() => SW_DA"))
    check('Service Worker läuft',
          page.evaluate("async () => !!(await navigator.serviceWorker.getRegistration())"))

    # --- Erlaubnis liegt vor: die App meldet das Gerät von selbst an ---
    for _ in range(120):
        if page.evaluate("async () => (await api('push/key')).geraete") >= 1:
            break
        page.wait_for_timeout(500)
    check('Meldet sich bei erteilter Erlaubnis von selbst an',
          page.evaluate("async () => (await api('push/key')).geraete") >= 1)
    check('Abo liegt im Browser', page.evaluate("async () => !!(await pushAbo())"))

    page.evaluate('() => meldungsDialog()')
    page.wait_for_timeout(800)
    check('Dialog zeigt „an"', 'Auf diesem Gerät an' in page.inner_text('#pushstand'),
          page.inner_text('#pushstand'))
    check('Knopf heißt „Ausschalten"', page.inner_text('#pushknopf').strip() == 'Ausschalten')

    # --- Probe: der ganze Weg über den Push-Dienst ---
    def leeren():
        page.evaluate("() => navigator.serviceWorker.getRegistration()"
                      ".then(r => r.getNotifications()).then(n => n.forEach(x => x.close()))")

    leeren()
    page.evaluate('() => pushProbe()')
    m = warte_auf_meldung(page)
    check('Probe-Meldung kommt an', len(m) == 1, str(m))
    if m:
        check('Titel stimmt', m[0]['titel'] == 'V3D Mail', str(m[0]))
        check('Text stimmt', 'funktioniert' in (m[0]['text'] or ''), str(m[0]))

    # --- Wie bei echter Post: mit Konto und UID, damit der Klick zur Mail führt ---
    leeren()
    page.evaluate("""() => post('push/test', {art: 'mail', titel: 'Frank Finkeldei',
                                              text: 'Kurs 3D-Druck', acc: 'k1', uid: 4711, offen: 3})""")
    m = warte_auf_meldung(page)
    check('Mail-Meldung kommt an', len(m) == 1, str(m))
    if m:
        check('Absender steht als Titel', m[0]['titel'] == 'Frank Finkeldei', str(m[0]))
        check('Betreff steht im Text', m[0]['text'] == 'Kurs 3D-Druck', str(m[0]))
        check('Klick-Ziel führt zur Nachricht', m[0]['ziel'] == '?mail=k1:4711', str(m[0]))
        check('Eigener Merkname je Nachricht', m[0]['tag'] == 'v3dmail-k1-4711', str(m[0]))

    # --- Ausschalten ---
    page.click('#pushknopf')
    for _ in range(40):
        if 'Auf diesem Gerät aus' in page.inner_text('#pushstand'):
            break
        page.wait_for_timeout(500)
    check('Abgemeldet', 'Auf diesem Gerät aus' in page.inner_text('#pushstand'),
          page.inner_text('#pushstand'))
    check('Abo im Browser weg', page.evaluate("async () => !(await pushAbo())"))
    check('Server hat das Gerät vergessen',
          page.evaluate("async () => (await api('push/key')).geraete") == 0)

    # --- Und wieder von Hand an ---
    check('Knopf heißt wieder „Einschalten"', page.inner_text('#pushknopf').strip() == 'Einschalten')
    page.click('#pushknopf')
    for _ in range(120):
        if 'Auf diesem Gerät an' in page.inner_text('#pushstand'):
            break
        page.wait_for_timeout(500)
    check('Von Hand eingeschaltet', 'Auf diesem Gerät an' in page.inner_text('#pushstand'),
          page.inner_text('#pushstand'))
    check('Server kennt das Gerät wieder',
          page.evaluate("async () => (await api('push/key')).geraete") >= 1)

    # Aufräumen: dieses Testgerät soll nicht dauerhaft mitgemeldet werden.
    page.evaluate('() => pushAus()')
    page.wait_for_timeout(1500)
    check('Testgerät wieder abgemeldet',
          page.evaluate("async () => (await api('push/key')).geraete") == 0)

    check('Keine JS-Fehler', not errors, '; '.join(errors[:3]))
    br.close()

print('\n%s' % ('ALLES GRUEN' if not fails else 'FEHLER: ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
