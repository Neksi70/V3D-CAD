// Josy am Mac, 12.9.26: "Safari kann die Seite blob:https://…/d521bb64-… nicht
// öffnen. Fehler: Der Vorgang konnte nicht abgeschlossen werden.
// (WebKitBlobResource-Fehler 1.)"
//
// Die Bauanleitung des Bausatzes öffnete sich als blob:-Seite in einem neuen
// Tab. Das ist gleich doppelt fragil:
//   1. Eine blob:-Adresse lebt nur, solange die erzeugende Seite sie hält.
//      Verwirft Safari den Hintergrund-Tab und lädt ihn neu, ist sie weg.
//   2. window.open nach einer langen Rechnung gilt vielen Browsern nicht mehr
//      als Nutzer-Klick → Pop-up-Blocker.
// Jetzt läuft die Anleitung in einem iframe (srcdoc) im Fenster selbst.
// Der Test fährt BEIDE Engines — WebKit ist die, die es betrifft.
import { chromium, webkit } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL_ = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

for (const [name, engine] of [['WebKit (Safari)', webkit], ['Chromium', chromium]]) {
  const b = await engine.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  try {
    const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('guide-test','test@lokal'))"],
                              { cwd: process.cwd(), encoding: 'utf8' }).trim();
    await ctx.addCookies([{ name: 'v3dsess', value: sess, domain: new global.URL(URL_).hostname,
                            path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
  } catch (e) { /* Dev-Server ohne Cookie */ }
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(URL_, { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 90000 });
  await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show');
                            document.getElementById('auth-overlay')?.classList.add('hidden'); });

  // Bausatz rechnen und Anleitung öffnen — der echte Weg über die Oberfläche
  const r = await pg.evaluate(async () => {
    if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
    addShape('cone'); const o = objects[objects.length-1];
    selectObjs([o]); _lgoOpen(); _lgoSetMode('kit'); _lgoSetOut('built');
    document.getElementById('lgo-studs').value = 7;
    document.getElementById('lgo-guide').checked = true;    // Anleitung AN
    _lgoInfo();
    const vorher = objects.length;
    await _lgoCreate();
    for (let i = 0; i < 300 && objects.length === vorher; i++) await new Promise(r => setTimeout(r, 50));
    const ov = document.getElementById('lgo-guide-ov');
    const fr = ov && ov.querySelector('iframe');
    return { overlay: !!ov, sichtbar: ov && ov.style.display !== 'none',
             iframe: !!fr, hatSrcdoc: !!(fr && fr.srcdoc && fr.srcdoc.length > 500),
             blobUrl: !!(fr && /^blob:/.test(fr.src || '')),
             knoepfe: ov ? [...ov.querySelectorAll('button')].map(b => b.textContent.trim()) : [] };
  });
  ok(name + ': Anleitung öffnet sich im Fenster', r.sichtbar && r.iframe, r);
  ok(name + ': Inhalt steckt im iframe (srcdoc), nicht in einer blob-Adresse',
     r.hatSrcdoc && !r.blobUrl, r);
  ok(name + ': Drucken und Speichern sind da',
     r.knoepfe.some(t => /Drucken/.test(t)) && r.knoepfe.some(t => /Datei/.test(t)), r.knoepfe);

  // Kein zweiter Tab, kein Pop-up nötig
  ok(name + ': es wird kein neuer Tab geöffnet', ctx.pages().length === 1, ctx.pages().length);

  // Inhalt wirklich gerendert? srcdoc wird asynchron geparst — abwarten.
  await pg.waitForFunction(() => {
    const fr = document.querySelector('#lgo-guide-ov iframe');
    const d = fr && (fr.contentDocument || (fr.contentWindow && fr.contentWindow.document));
    return !!(d && d.querySelector('h1'));
  }, { timeout: 15000 }).catch(() => {});
  const inhalt = await pg.evaluate(() => {
    const fr = document.querySelector('#lgo-guide-ov iframe');
    const d = fr && (fr.contentDocument || (fr.contentWindow && fr.contentWindow.document));
    return d ? { titel: (d.querySelector('h1') || {}).textContent || '',
                 schichten: d.querySelectorAll('section').length,
                 svg: d.querySelectorAll('svg').length } : null;
  });
  ok(name + ': Anleitung ist gerendert (Überschrift, Schichten, Pläne)',
     !!inhalt && /Bauanleitung/.test(inhalt.titel) && inhalt.schichten > 0 && inhalt.svg > 0, inhalt);

  // Esc schließt
  await pg.keyboard.press('Escape');
  ok(name + ': Esc schließt die Anleitung',
     await pg.evaluate(() => document.getElementById('lgo-guide-ov').style.display === 'none'));

  ok(name + ': keine JS-Fehler', errs.length === 0, errs.slice(0, 2));
  await b.close();
}
console.log(fails.length ? '\nFEHLGESCHLAGEN: ' + fails.join(', ') : '\nAlle Bauanleitungs-Tests bestanden (beide Engines).');
process.exit(fails.length ? 1 : 0);
