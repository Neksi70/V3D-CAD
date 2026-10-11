// V3D Kids: /kids leitet auf ?kids=1, Kachelseite statt Startdialog, Kachel öffnet den
// Generator, nach dem Erstellen erscheint die Leiste, „Noch etwas bauen“ und „Große Werkstatt“.
// Start: python3 volme3d_server.py 18871 --dev   →   V3D_BASE=http://127.0.0.1:18871 node tests/kids_test.mjs
import { chromium } from 'playwright';

const BASE = process.env.V3D_BASE || 'http://127.0.0.1:8766';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));

const r = await fetch(BASE + '/kids', { redirect: 'manual' });
ok('/kids leitet auf volme3d.html?kids=1', r.status === 302 && (r.headers.get('location') || '').startsWith('/volme3d.html?kids=1'), [r.status, r.headers.get('location')]);

await pg.goto(BASE + '/volme3d.html?kids=1', { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { localStorage.removeItem('volme3d_cur'); document.getElementById('auth-overlay')?.classList.add('hidden'); _newCreate(false); _maybeShowStarter(); });
await pg.waitForTimeout(400);
const s1 = await pg.evaluate(() => ({
  seite: document.getElementById('kids-page')?.classList.contains('show'),
  start: document.getElementById('start-modal')?.classList.contains('show'),
  karten: [...document.querySelectorAll('#kids-page .kd-card .kd-t')].map(e => e.textContent),
  kids: document.body.classList.contains('kids'),
}));
ok('Kachelseite offen, Startdialog zu', s1.seite && !s1.start && s1.kids, s1);
ok('alle Wunsch-Generatoren als Kachel', ['Straße', 'Häuser', 'Landschaft', 'Pflanzen', 'Brücke', 'Schienen', 'Zug', 'Fahrzeug', 'Flugzeug', 'U-Boot', 'Ständer', 'Dinosaurier', 'Becher'].every(t => s1.karten.includes(t)), s1.karten);

await pg.click('#kids-page .kd-card:has-text("Flugzeug")');
await pg.waitForFunction(() => document.getElementById('kg-modal')?.classList.contains('show'), { timeout: 10000 });
await pg.waitForTimeout(1500);
await pg.click('#kg-go');
await pg.waitForFunction(() => objects.length > 0 && !document.getElementById('kg-modal').classList.contains('show'), { timeout: 60000 });
const s2 = await pg.evaluate(() => ({ n: objects.length, bar: document.getElementById('kids-bar')?.classList.contains('show'), seite: document.getElementById('kids-page')?.classList.contains('show') }));
ok('Flugzeug gebaut, Leiste unten sichtbar', s2.n > 0 && s2.bar && !s2.seite, s2);

await pg.click('#kids-bar button:has-text("Noch etwas bauen")');
ok('„Noch etwas bauen“ öffnet die Kachelseite wieder', await pg.evaluate(() => document.getElementById('kids-page').classList.contains('show') && !document.getElementById('kids-bar').classList.contains('show')));
await pg.click('#kids-page .kd-zu');
ok('✕ schließt die Kachelseite, Leiste kommt zurück', await pg.evaluate(() => !document.getElementById('kids-page').classList.contains('show') && document.getElementById('kids-bar').classList.contains('show')));

const dl = pg.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await pg.click('#kids-bar .kd-pri');
const d = await dl;
ok('„Für den Drucker speichern“ lädt eine 3MF-Datei', !!d && /\.3mf$/i.test(d.suggestedFilename()), d && d.suggestedFilename());

await pg.click('#kids-bar button:has-text("Große Werkstatt")');
const s3 = await pg.evaluate(() => ({ kids: document.body.classList.contains('kids'), bar: document.getElementById('kids-bar').classList.contains('show'), url: location.search }));
ok('„Große Werkstatt“ verlässt den Kinder-Modus', !s3.kids && !s3.bar && !s3.url.includes('kids'), s3);

// ohne ?kids bleibt alles wie gewohnt
const pg2 = await b.newPage({ viewport: { width: 1400, height: 900 } });
await pg2.goto(BASE + '/volme3d.html', { waitUntil: 'load' });
await pg2.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
ok('ohne ?kids keine Kachelseite', await pg2.evaluate(() => !_kidsOn() && !document.getElementById('kids-page')));

ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
