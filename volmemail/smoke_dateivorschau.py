#!/usr/bin/env python3
"""Datei-Betrachter: Klick auf einen PDF-/Text-/Office-Anhang zeigt ihn IN der
App, statt ihn nur herunterzuladen. Laeuft gegen die laufende Instanz.

Nur lesend — es werden weder Mails verschickt noch verschoben oder geloescht."""
import json, os, sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'https://127.0.0.1:8783/'
KEY = json.load(open(os.path.expanduser('~/.config/v3dmail/config.json')))['adminKey']
fails = []


def check(name, cond, detail=''):
    print(('  ok  ' if cond else '  FEHLER ') + name + (' — ' + detail if detail and not cond else ''))
    if not cond:
        fails.append(name)


def finde_mail_mit_art(page, art, hoechstens=60):
    """Erste Mail, in deren Dateiliste ein Anhang der gesuchten Art steckt."""
    uids = page.evaluate('S.msgs.filter(m => m.hasAttachments).map(m => m.uid).slice(0, %d)' % hoechstens)
    for uid in uids:
        page.evaluate('openMsg(%d, false)' % uid)
        page.wait_for_timeout(1200)
        i = page.evaluate("(S.dateien || []).findIndex(a => dateiArt(a) === %r)" % art)
        if i is not None and i >= 0:
            return uid, i
    return None, -1


def schliessen(page):
    page.keyboard.press('Escape')
    page.wait_for_timeout(500)


def pruefe_pdf(page):
    uid, i = finde_mail_mit_art(page, 'pdf')
    if not uid:
        print('  (keine Mail mit PDF-Anhang gefunden — PDF-Teil uebersprungen)')
        return
    name = page.evaluate('S.dateien[%d].filename' % i)
    check('Betrachter ist zu', not page.is_visible('#dviewer'))
    page.evaluate('zeigeDatei(%d)' % i)
    check('Betrachter oeffnet sich', page.is_visible('#dviewer'))
    page.wait_for_function("document.querySelector('#dvinhalt canvas')", timeout=30000)
    page.wait_for_function("document.querySelector('#dvinhalt canvas[data-fertig=\"1\"]')", timeout=30000)
    check('Name steht im Kopf', page.inner_text('#dvname').strip() == name, page.inner_text('#dvname'))
    check('Seitenzahl steht im Kopf', 'Seite' in page.inner_text('#dvseiten'), page.inner_text('#dvseiten'))
    gross = page.evaluate("""() => { const c = document.querySelector('#dvinhalt canvas[data-fertig="1"]');
        return c ? [c.width, c.height] : [0, 0]; }""")
    check('Erste Seite ist gezeichnet', gross[0] > 100 and gross[1] > 100, str(gross))
    # nicht nur weisse Flaeche
    tinte = page.evaluate("""() => { const c = document.querySelector('#dvinhalt canvas[data-fertig="1"]');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k] < 200) n++;
        return n; }""")
    check('Seite hat sichtbaren Inhalt', tinte > 50, 'dunkle Bildpunkte: %s' % tinte)
    check('Seite passt ins Fenster', page.evaluate(
        "() => document.querySelector('#dvinhalt canvas').getBoundingClientRect().width <= innerWidth + 1"))

    breite_vor = page.evaluate("() => document.querySelector('#dvinhalt canvas').getBoundingClientRect().width")
    page.evaluate('vorschauZoom(1)')
    page.wait_for_timeout(1200)
    breite_nach = page.evaluate("() => document.querySelector('#dvinhalt canvas').getBoundingClientRect().width")
    check('Zoom vergroessert die Seite', breite_nach > breite_vor + 5, '%s -> %s' % (breite_vor, breite_nach))

    with page.expect_download(timeout=20000) as dl:
        page.click('#dviewer .dv-kopf .btn:not(.sec)')
    check('Speichern aus dem Betrachter liefert die Datei',
          dl.value.suggested_filename == name and os.path.getsize(dl.value.path()) > 0,
          dl.value.suggested_filename)

    schliessen(page)
    check('Escape schliesst den Betrachter', not page.is_visible('#dviewer'))
    check('Mail bleibt offen', page.evaluate('S.cur && S.cur.uid') == uid)


def pruefe_text(page):
    uid, i = finde_mail_mit_art(page, 'text')
    gestellt = False
    if not uid:
        # Text-Anhaenge sind selten im echten Postfach — dann einen unterschieben,
        # damit dieser Weg trotzdem bei jedem Lauf durchgespielt wird.
        page.route('**/api/attachment*', lambda r: r.fulfill(
            status=200, content_type='text/plain; charset=utf-8', body='Moin\nZweite Zeile\n'))
        page.evaluate("""() => {
          S.blobs = new Map();
          S.dateien = [{ filename: 'notiz.txt', size: 19, part: '98', type: 'text/plain' }];
          zeigeDatei(0);
        }""")
        gestellt = True
    else:
        page.evaluate('zeigeDatei(%d)' % i)
    page.wait_for_function("document.querySelector('#dvinhalt pre.dv-text')", timeout=20000)
    laenge = page.evaluate("() => document.querySelector('#dvinhalt pre.dv-text').textContent.length")
    check('Text-Anhang wird angezeigt%s' % (' (gestellt)' if gestellt else ''), laenge > 0,
          'Zeichen: %s' % laenge)
    schliessen(page)
    if gestellt:
        page.unroute('**/api/attachment*')
        page.evaluate('S.blobs = new Map()')


def pruefe_einordnung(page):
    """Falsch deklarierte Anhaenge muessen trotzdem richtig einsortiert werden."""
    urteil = page.evaluate("""() => ({
      fotoOhneTyp: dateiArt({ filename: 'foto.jpg', type: 'application/octet-stream' }),
      pdfOhneTyp: dateiArt({ filename: 'rechnung.PDF', type: 'application/octet-stream' }),
      xlsx: dateiArt({ filename: 'liste.xlsx', type: '' }),
      docxTyp: dateiArt({ filename: 'anhang', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      zip: dateiArt({ filename: 'archiv.zip', type: 'application/zip' }),
      bildLeiste: istBildDatei({ filename: 'foto.jpg', type: 'application/octet-stream' }),
    })""")
    check('Foto ohne Typangabe gilt als Bild', urteil['fotoOhneTyp'] == 'bild' and urteil['bildLeiste'], str(urteil))
    check('PDF wird an der Endung erkannt', urteil['pdfOhneTyp'] == 'pdf', str(urteil))
    check('Office wird an Endung und Typ erkannt',
          urteil['xlsx'] == 'office' and urteil['docxTyp'] == 'office', str(urteil))
    check('ZIP bekommt keine Vorschau', urteil['zip'] is None, str(urteil))


def pruefe_office(page):
    uid, i = finde_mail_mit_art(page, 'office')
    if not uid:
        print('  (keine Mail mit Office-Anhang gefunden — Office-Teil uebersprungen)')
        return
    page.evaluate('zeigeDatei(%d)' % i)
    page.wait_for_function("document.querySelector('#dvinhalt canvas[data-fertig=\"1\"]')", timeout=90000)
    check('Office-Anhang wird als Seite gezeigt', page.evaluate(
        "() => document.querySelector('#dvinhalt canvas').width > 100"))
    schliessen(page)


def pruefe_unbekannt(page):
    """Dateiarten ohne Vorschau muessen sauber melden statt leer zu bleiben."""
    page.evaluate("""() => {
      S.dateien = [{ filename: 'archiv.zip', size: 1234, part: '99', type: 'application/zip' }];
      zeigeDatei(0);
    }""")
    page.wait_for_timeout(400)
    check('Ohne Vorschau kommt eine Meldung', 'nicht anzeigen' in page.inner_text('#dvinhalt'),
          page.inner_text('#dvinhalt')[:120])
    schliessen(page)


def lauf(page, handy):
    print('--- %s ---' % ('Handy' if handy else 'Rechner'))
    pruefe_einordnung(page)
    pruefe_pdf(page)
    pruefe_text(page)
    pruefe_office(page)
    pruefe_unbekannt(page)
    if handy:
        uid, i = finde_mail_mit_art(page, 'pdf')
        if uid:
            page.evaluate('zeigeDatei(%d)' % i)
            page.wait_for_timeout(1500)
            page.go_back()
            page.wait_for_timeout(700)
            check('Zurueck schliesst nur den Betrachter', not page.is_visible('#dviewer') and
                  page.evaluate("document.body.classList.contains('v-read')"))


with sync_playwright() as p:
    br = p.chromium.launch()
    for handy in (False, True):
        ctx = br.new_context(ignore_https_errors=True, accept_downloads=True,
                             viewport={'width': 390, 'height': 800} if handy else {'width': 1280, 'height': 900})
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        # Sicherheitsnetz: schreibende Zugriffe aufs Postfach werden geblockt.
        page.route('**/api/send*', lambda r: r.abort())
        page.route('**/api/move*', lambda r: r.abort())
        page.route('**/api/delete*', lambda r: r.abort())
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
