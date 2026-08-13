#!/usr/bin/env python3
"""Prüft den Signatur-Editor und wie die Signatur an die Mail kommt.

Richtet die Signatur am ersten Konto ein und stellt den vorherigen Stand am
Ende wieder her. Es wird nichts versendet — die Anfrage an /api/send wird
abgefangen und nur ihr Inhalt geprüft.
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
    page = br.new_context(ignore_https_errors=True, viewport={'width': 1280, 'height': 900}).new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(URL, wait_until='networkidle')
    page.fill('#lkey', KEY)
    page.click('text=Anmelden')
    page.wait_for_timeout(6000)

    acc_id = page.evaluate('S.accounts[0].id')
    vorher = page.evaluate('({sig: S.accounts[0].signature, html: S.accounts[0].signatureHtml, '
                           'daten: S.accounts[0].signatureData})')

    try:
        # --- Editor öffnen und aus VolmeRechnung füllen ---
        page.evaluate('signaturDialog("%s")' % acc_id)
        page.wait_for_timeout(600)
        check('Signatur-Editor öffnet', page.is_visible('#sig_vor'))
        page.click('text=Daten aus VolmeRechnung übernehmen')
        page.wait_for_timeout(2500)
        check('Name übernommen', page.input_value('#sig_name') == 'Volker Isken',
              page.input_value('#sig_name'))
        check('Firma übernommen', page.input_value('#sig_firma') == 'Volme 3D',
              page.input_value('#sig_firma'))
        check('Anschrift übernommen', page.input_value('#sig_ort') == '58135 Hagen',
              page.input_value('#sig_ort'))
        check('Telefon übernommen', '1512' in page.input_value('#sig_telefon'),
              page.input_value('#sig_telefon'))
        check('E-Mail aus dem Konto vorbelegt', '@' in page.input_value('#sig_email'),
              page.input_value('#sig_email'))

        vor = page.inner_text('#sig_vor')
        check('Vorschau zeigt die Signatur', 'Volme 3D' in vor and 'Hagen' in vor, vor[:60])

        # --- Gestaltung wechseln ---
        for layout in ('balken', 'kompakt', 'schlicht'):
            page.select_option('#sig_layout', layout)
            page.wait_for_timeout(300)
            check('Gestaltung "%s" erzeugt Inhalt' % layout,
                  len(page.inner_text('#sig_vor').strip()) > 20)
        check('Akzentbalken wird gesetzt', page.evaluate(
            "sigBauen({name:'X',layout:'balken'},'balken').html.includes('border-left')"))

        # --- keine gefährlichen Bestandteile ---
        html = page.evaluate("sigBauen(sigDaten(), sigDaten().layout).html")
        check('Signatur enthält keine Skripte', '<script' not in html.lower())
        check('Signatur ohne externe Bilder', 'src=' not in html.lower())
        check('Stile stehen direkt am Element', 'style=' in html and '<style' not in html.lower())
        check('Web-Adresse verlinkt', 'href="https://volme3dakademie.de"' in html, html[:80])


        # --- Logo ---
        page.click('text=Firmenlogo laden')
        page.wait_for_timeout(3000)
        check('Firmenlogo geladen', page.evaluate('!!(S.sigLogo && S.sigLogo.data)'))
        check('Logo als PNG umgewandelt',
              page.evaluate("(S.sigLogo||{}).data||''").startswith('data:image/png'),
              page.evaluate("((S.sigLogo||{}).data||'').slice(0,30)"))
        check('Logo in der Vorschau sichtbar',
              page.evaluate("!!document.querySelector('#sig_vor img')"))
        check('Logo neben den Daten (Tabelle für Outlook)',
              page.evaluate("document.querySelector('#sig_vor table') !== null"))
        page.select_option('#sig_logoPos', 'oben')
        page.wait_for_timeout(300)
        check('Logo lässt sich darüber stellen',
              page.evaluate("document.querySelector('#sig_vor table') === null")
              and page.evaluate("!!document.querySelector('#sig_vor img')"))
        page.select_option('#sig_logoPos', 'links')
        page.wait_for_timeout(300)

        # Spruch eintragen
        page.fill('#sig_slogan', 'Ideen, die man anfassen kann.')
        page.wait_for_timeout(300)
        check('Spruch erscheint in der Vorschau',
              'anfassen' in page.inner_text('#sig_vor'))
        # --- speichern ---
        # exakt den Speichern-Knopf treffen — "Daten aus VolmeRechnung übernehmen"
        # enthält dasselbe Wort
        page.click('#modalbox button.btn:not(.sec):has-text("Übernehmen")')
        page.wait_for_timeout(2500)
        gespeichert = page.evaluate('S.accounts.find(a => a.id === "%s")' % acc_id)
        check('Signatur am Konto gespeichert', bool(gespeichert.get('signatureHtml')))
        check('Textfassung ebenfalls gespeichert',
              'Volme 3D' in (gespeichert.get('signature') or ''),
              repr((gespeichert.get('signature') or '')[:40]))
        check('Angaben für spätere Bearbeitung behalten',
              (gespeichert.get('signatureData') or {}).get('firma') == 'Volme 3D')

        # --- Verfassen: Signatur steht nicht im Textfeld ---
        page.evaluate('closeModal()')
        page.wait_for_timeout(400)
        page.evaluate('compose()')
        page.wait_for_timeout(600)
        check('Textfeld bleibt leer', page.input_value('#ctext') == '',
              repr(page.input_value('#ctext')[:40]))
        check('Signatur wird als Anhang angekündigt', page.is_visible('#csig'))
        check('Vorschau im Verfassen-Fenster', 'Volme 3D' in page.inner_text('#csig'))

        # --- Versand abfangen und Aufbau prüfen ---
        page.route('**/api/send', lambda route: route.fulfill(
            status=200, content_type='application/json',
            body=json.dumps({'ok': True, 'savedToSent': False, 'messageId': '<test>'})))
        gesendet = {}
        page.on('request', lambda r: gesendet.update({'body': r.post_data})
                if r.url.endswith('/api/send') else None)

        page.fill('#cto', 'test@beispiel.de')
        page.fill('#csubj', 'Prüfung Signatur')
        page.fill('#ctext', 'Moin,\n\nkurze Frage.')
        page.click('#csend')
        page.wait_for_timeout(2500)
        daten = json.loads(gesendet.get('body') or '{}')
        check('Nachricht wurde abgeschickt', bool(daten))
        check('Text enthält den getippten Teil', 'kurze Frage.' in (daten.get('text') or ''))
        check('Text endet mit der Signatur', 'Volme 3D' in (daten.get('text') or ''))
        check('Üblicher Trenner "-- " im Text', '\n-- \n' in (daten.get('text') or ''),
              repr((daten.get('text') or '')[-80:]))
        check('Formatierte Fassung mitgeschickt', 'Volme 3D' in (daten.get('html') or ''))
        check('Getippter Text auch formatiert', 'kurze Frage.' in (daten.get('html') or ''))
        check('Signatur nur einmal enthalten',
              (daten.get('html') or '').count('Tückinger') <= 1)

        check('Logo als eingebettetes Bild mitgeschickt',
              len(daten.get('inlineImages') or []) == 1,
              str(len(daten.get('inlineImages') or [])))
        bild = (daten.get('inlineImages') or [{}])[0]
        check('Bild trägt eine Content-ID', bool(bild.get('cid')))
        check('Bilddaten sind vorhanden', len(bild.get('data') or '') > 500,
              '%d Zeichen' % len(bild.get('data') or ''))
        check('HTML verweist auf das eingebettete Bild',
              'cid:' + (bild.get('cid') or 'x') in (daten.get('html') or ''))
        check('Keine data:-URL in der versendeten Fassung',
              'data:image' not in (daten.get('html') or ''),
              'data:-URLs zeigt Outlook nicht an')

        # --- ohne Signatur bleibt alles beim Alten ---
        page.evaluate('S.accounts[0].signature = ""; S.accounts[0].signatureHtml = ""')
        page.evaluate('closeCompose()')
        page.wait_for_timeout(400)
        page.evaluate('compose()')
        page.wait_for_timeout(500)
        gesendet.clear()
        page.fill('#cto', 'test@beispiel.de')
        page.fill('#ctext', 'Nur Text.')
        page.click('#csend')
        page.wait_for_timeout(2000)
        ohne = json.loads(gesendet.get('body') or '{}')
        check('Ohne Signatur kein Trenner', '-- ' not in (ohne.get('text') or ''))
        check('Ohne Signatur keine HTML-Fassung', not (ohne.get('html') or ''))

        check('Keine JavaScript-Fehler', not errors, '; '.join(errors[:2]))
    finally:
        # Ursprünglichen Stand am Konto wiederherstellen
        page.evaluate("""async (v) => {
            await fetch('api/account/save', {
                method: 'POST', credentials: 'same-origin',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ id: %s, signature: v.sig || '',
                                       signatureHtml: v.html || '', signatureData: v.daten || {} })
            });
        }""" % json.dumps(acc_id), vorher)
        page.wait_for_timeout(800)
        print('  (Signatur des Kontos auf den vorherigen Stand zurückgesetzt)')
        br.close()

print()
if fails:
    print('FEHLGESCHLAGEN: ' + ', '.join(fails))
    sys.exit(1)
print('Signatur in Ordnung.')
