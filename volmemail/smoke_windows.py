#!/usr/bin/env python3
"""Prüft die Installierbarkeit als Windows-App (PWA) und die mailto-Anbindung.

Als Programm installiert meldet sich V3D Mail für mailto:-Links an; Windows
startet die App dann mit ?compose=<kodiertes mailto>. Beide Schreibweisen
(kodiert wie von Windows, im Klartext wie beim Selbertippen) müssen gehen.
"""
import json
import os
import sys
import urllib.parse

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'https://127.0.0.1:8783/'
KEY = json.load(open(os.path.expanduser('~/.config/v3dmail/config.json')))['adminKey']

fails = []


def check(name, cond, detail=''):
    print(('  ok  ' if cond else '  FEHLER ') + name + (' — ' + detail if detail and not cond else ''))
    if not cond:
        fails.append(name)


# (mailto, erwartete Empfänger, Betreff, Textschnipsel, Kopie)
FAELLE = [
    ('mailto:kunde@beispiel.de', 'kunde@beispiel.de', '', None, ''),
    ('mailto:a@b.de?subject=Angebot Nr. 42&body=Moin,\nanbei das Angebot.',
     'a@b.de', 'Angebot Nr. 42', 'anbei das Angebot.', ''),
    ('mailto:a@b.de,c@d.de?cc=chef@firma.de&subject=Test',
     'a@b.de, c@d.de', 'Test', None, 'chef@firma.de'),
    ('mailto:info@volme3dakademie.de?subject=Anfrage%20%C3%BCber%20Gr%C3%B6%C3%9Fen',
     'info@volme3dakademie.de', 'Anfrage über Größen', None, ''),
]

with sync_playwright() as p:
    br = p.chromium.launch()
    page = br.new_context(ignore_https_errors=True).new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(URL, wait_until='networkidle')
    page.fill('#lkey', KEY)
    page.click('text=Anmelden')
    page.wait_for_timeout(5000)

    # --- Installierbarkeit ---
    m = page.evaluate("""async () => {
        const l = document.querySelector('link[rel=manifest]');
        if (!l) return null;
        const r = await fetch(l.href);
        return { ok: r.ok, text: await r.text(), href: l.href };
    }""")
    check('Manifest wird ausgeliefert', m and m['ok'])
    man = json.loads(m['text']) if m and m['ok'] else {}
    check('Eigenes Fenster ohne Browserleiste', man.get('display') == 'standalone',
          str(man.get('display')))
    gross = [i for i in man.get('icons', [])
             if i.get('type') == 'image/png' and
             max(int(x) for x in i.get('sizes', '0x0').split('x')) >= 192]
    check('PNG-Symbol ab 192 px vorhanden (Windows verlangt das)', len(gross) >= 1,
          '%d gefunden' % len(gross))
    check('Zugeschnittenes Symbol für Kacheln',
          any(i.get('purpose') == 'maskable' for i in man.get('icons', [])))
    check('Meldet sich für mailto an',
          any(h.get('protocol') == 'mailto' for h in man.get('protocol_handlers', [])))
    check('Sprungliste "Neue Nachricht"', len(man.get('shortcuts', [])) >= 1)

    basis = m['href'].rsplit('/', 1)[0] + '/'
    for i in man.get('icons', []):
        r = page.evaluate("async (u) => (await fetch(u)).status", basis + i['src'])
        check('Symbol %s erreichbar' % i['src'], r == 200, 'HTTP %s' % r)

    # --- mailto, wie Windows es übergibt (kodiert) ---
    for roh, to, subj, text, cc in FAELLE:
        page.goto(URL + '?compose=' + urllib.parse.quote(roh, safe=''), wait_until='networkidle')
        page.wait_for_timeout(3500)
        ok = (page.is_visible('#compose') and page.input_value('#cto') == to
              and (not subj or page.input_value('#csubj') == subj)
              and (not text or text in page.input_value('#ctext'))
              and (not cc or page.input_value('#ccc') == cc))
        check('mailto (kodiert): %s' % roh.split('?')[0][:38], ok,
              'an=%r betreff=%r kopie=%r' % (page.input_value('#cto'),
                                             page.input_value('#csubj'),
                                             page.input_value('#ccc')))

    # --- dasselbe im Klartext in der Adresse ---
    roh, to, subj, text, cc = FAELLE[1]
    page.goto(URL + '?compose=' + roh.replace(' ', '%20').replace('\n', '%0A'),
              wait_until='networkidle')
    page.wait_for_timeout(3500)
    check('mailto im Klartext: Betreff und Text kommen an',
          page.input_value('#csubj') == subj and text in page.input_value('#ctext'),
          'betreff=%r' % page.input_value('#csubj'))

    # --- Sprungliste ---
    page.goto(URL + '?compose=1', wait_until='networkidle')
    page.wait_for_timeout(3500)
    check('Sprungliste öffnet ein leeres Fenster',
          page.is_visible('#compose') and page.input_value('#cto') == '')
    check('Adresse wird bereinigt', '?compose' not in page.url, page.url)

    check('Keine JavaScript-Fehler', not errors, '; '.join(errors[:2]))
    br.close()

print()
if fails:
    print('FEHLGESCHLAGEN: ' + ', '.join(fails))
    sys.exit(1)
print('Als Windows-App installierbar, mailto-Anbindung in Ordnung.')
