// Druckcheck-Seite: „🌳 Stützen zeigen“ (Volker 9.11.). Pilz mit Stützen an + „Nur auf Druckplatte“:
// vorher rote Säulen (keine Stütze über dem Modell), nach „Alles verbessern“ orange (Stütze steht auf dem Modell).
// Start: python3 volme3d_server.py 8887 --dev  →  node tests/druckcheck_stuetzen_test.mjs
import { chromium } from 'playwright';
const URL0 = process.env.DC_URL || 'http://127.0.0.1:8887/druckcheck.html';
const DATEI = new globalThis.URL('./fixtures/projekt_pilz_nur_platte.3mf', import.meta.url).pathname;
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1500, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL0); await pg.setInputFiles('#file', DATEI);
await pg.waitForSelector('#magic:not([hidden])', { timeout: 20000 });
ok('Schalter „Stützen zeigen“ sichtbar', await pg.isVisible('#supShow'));
await pg.check('#supShow'); await pg.waitForTimeout(300);
const vor = await pg.textContent('#supInfo');
ok('vorher: Stellen ohne Stütze gemeldet', /ohne Stütze/.test(vor), vor);
await pg.screenshot({ path: '/tmp/stuetzen_vorher.png' });
await pg.click('#magic'); await pg.waitForSelector('#improve:not([hidden])'); await pg.waitForTimeout(300);
const nach = await pg.textContent('#supInfo');
ok('nachher: alles gestützt (Stützen stehen auf dem Modell)', /gestützt/.test(nach) && !/ohne Stütze/.test(nach), nach);
await pg.screenshot({ path: '/tmp/stuetzen_nachher.png' });
await pg.uncheck('#supShow'); await pg.waitForTimeout(200);
ok('ausschalten blendet Säulen und Legende aus', await pg.evaluate(() => document.getElementById('supLeg').hidden));
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
