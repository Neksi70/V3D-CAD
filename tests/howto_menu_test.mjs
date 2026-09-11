// Test: Howto-Videos sind AUFFINDBAR, ohne dass man vorher das passende
// Fenster erraten muss. Anlass: Josy am 11.9.26 — "Ich finde es nicht".
// Der Knopf saß nur in der Kopfzeile des SVG-Fensters, und das öffnet sich
// erst NACH der Dateiauswahl. Geprüft wird:
//   (1) Kopfleiste zeigt "🎬 Videos", sobald es Videos gibt,
//   (2) die Übersicht listet alle Videos aus /videos/index.json,
//   (3) ein Klick startet den richtigen Film (mp4 + Untertitel),
//   (4) die Suche findet sowohl die Übersicht als auch jedes einzelne Video,
//   (5) Esc schließt erst den Film, dann die Übersicht.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
try {
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('howto-test','test@lokal'))"],
                            { cwd: process.cwd(), encoding: 'utf8' }).trim();
  await ctx.addCookies([{ name: 'v3dsess', value: sess, domain: new global.URL(URL).hostname,
                          path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
} catch (e) { console.log('  (kein Sitzungs-Cookie: ' + e.message.split('\n')[0] + ')'); }
const pg = await ctx.newPage();
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 90000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});
// _howtoInit läuft asynchron (fetch auf /videos/index.json)
await pg.waitForFunction(() => typeof _howtoListe !== 'undefined' && _howtoListe.length > 0, { timeout: 20000 });

const liste = await pg.evaluate(() => _howtoListe.map(v => v.id));
ok('index.json geladen', liste.length > 0, liste);

// ── 1) Kopfleisten-Knopf ───────────────────────────────────────────────────
const tb = await pg.evaluate(() => {
  const el = document.getElementById('howto-tb');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { text: el.textContent.trim(), sichtbar: getComputedStyle(el).display !== 'none',
           breite: r.width, oben: r.top };
});
ok('Kopfleiste hat einen Video-Knopf', !!tb, tb);
ok('Video-Knopf ist sichtbar', tb && tb.sichtbar && tb.breite > 20, tb);
ok('Video-Knopf steht ganz oben (ohne Scrollen erreichbar)', tb && tb.oben < 60, tb && tb.oben);

// ── 2) Übersicht listet alle Videos ────────────────────────────────────────
await pg.click('#howto-tb');
const eintraege = await pg.evaluate(() =>
  [...document.querySelectorAll('#howto-menu-ov div[onclick*="_howtoOpen"]')].map(d => d.textContent.trim()));
ok('Übersicht listet jedes Video', eintraege.length === liste.length, [eintraege.length, liste.length]);
ok('Übersicht nennt das SVG-Video', eintraege.some(t => /Motive auf einen K.rper setzen/.test(t)), eintraege);
ok('Übersicht zeigt Laufzeiten', eintraege.every(t => /\d+:\d\d/.test(t)), eintraege[0]);

// ── 3) Klick startet den richtigen Film ────────────────────────────────────
const idx = eintraege.findIndex(t => /Motive auf einen K.rper setzen/.test(t));
await pg.evaluate(i => document.querySelectorAll('#howto-menu-ov div[onclick*="_howtoOpen"]')[i].click(), idx);
const vid = await pg.evaluate(() => {
  const v = document.getElementById('howto-vid');
  return v ? { src: v.querySelector('source')?.getAttribute('src'),
               vtt: v.querySelector('track')?.getAttribute('src') } : null;
});
ok('Film läuft: richtiges mp4', vid && vid.src === '/videos/svg-aufsetzen.mp4', vid);
ok('Film hat Untertitel', vid && vid.vtt === '/videos/svg-aufsetzen.vtt', vid);
ok('Übersicht ist dabei zugegangen',
   await pg.evaluate(() => document.getElementById('howto-menu-ov').style.display === 'none'));
// mp4 wirklich abrufbar (nicht nur verlinkt)
const st = await pg.evaluate(async () => (await fetch('/videos/svg-aufsetzen.mp4', { headers: { Range: 'bytes=0-999' } })).status);
ok('mp4 wird vom Server ausgeliefert', st === 200 || st === 206, st);

// ── 4) Esc-Reihenfolge ─────────────────────────────────────────────────────
await pg.keyboard.press('Escape');
ok('Esc schließt den Film',
   await pg.evaluate(() => document.getElementById('howto-ov').style.display === 'none'));
await pg.click('#howto-tb');
await pg.keyboard.press('Escape');
ok('Esc schließt auch die Übersicht',
   await pg.evaluate(() => document.getElementById('howto-menu-ov').style.display === 'none'));

// ── 5) Suche ───────────────────────────────────────────────────────────────
const treffer = await pg.evaluate(() => {
  const f = q => CMDK.filter(c => (c.t + ' ' + (c.k || '')).toLowerCase().includes(q)).map(c => c.t);
  return { video: f('video'), anleitung: f('anleitung'), hilfe: f('hilfe'),
           svg: CMDK.filter(c => c._howto && (c.t + ' ' + c.k).toLowerCase().includes('svg')).map(c => c.t),
           vase: CMDK.filter(c => c._howto && (c.t + ' ' + c.k).toLowerCase().includes('vase')).map(c => c.t) };
});
ok('Suche nach "video" findet die Übersicht', treffer.video.includes('Videos (Howto-Filme)'), treffer.video.slice(0, 3));
ok('Suche nach "anleitung" führt zu Videos', treffer.anleitung.length > 0, treffer.anleitung.slice(0, 3));
ok('Suche nach "hilfe" führt zu Videos', treffer.hilfe.length > 0, treffer.hilfe.slice(0, 3));
ok('Jedes Video einzeln suchbar', treffer.video.filter(t => t.startsWith('Video: ')).length === liste.length,
   treffer.video.filter(t => t.startsWith('Video: ')));
ok('Suche nach "svg" findet das SVG-Video', treffer.svg.length > 0, treffer.svg);
ok('Suche nach "vase" findet das Vasen-Video', treffer.vase.length > 0, treffer.vase);

// ── 6) Doppelte Registrierung vermeiden (Init darf mehrfach laufen) ────────
const vorher = await pg.evaluate(() => CMDK.length);
await pg.evaluate(() => _howtoInit());
const nachher = await pg.evaluate(() => CMDK.length);
ok('Zweiter Init legt keine Doppeleinträge an', vorher === nachher, [vorher, nachher]);

ok('keine JS-Fehler auf der Seite', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\nFEHLGESCHLAGEN: ' + fails.join(', ') : '\nAlle Video-Auffindbarkeits-Tests bestanden.');
process.exit(fails.length ? 1 : 0);
