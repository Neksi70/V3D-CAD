// Regressionstest: Bild-Box — das Deckelmotiv darf auf dem fertigen Teil nicht
// spiegelverkehrt sein (Ralf: „Schrift ist spiegelverkehrt").
// Die Motiv-Sichtseite liegt beim Drucken auf der Platte, also muss die Analyse
// das Bild gegenspiegeln: was im Bild LINKS liegt, muss im flachen Layout bei
// +x landen — von der Sichtseite (unten) betrachtet erscheint es dann links.
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const fehler = [];
pg.on('pageerror', e => fehler.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof _ibxProcess === 'function', { timeout: 60000 });

// Testbild: opakes Rechteck auf transparentem Grund, linkes Drittel rot
await pg.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 200; c.height = 200;
  const x = c.getContext('2d');
  x.fillStyle = '#1030d0'; x.fillRect(20, 20, 160, 160);
  x.fillStyle = '#e01010'; x.fillRect(20, 20, 50, 160);
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = c.toDataURL('image/png'); });
  _ibx.img = img;
  _ibxP.ncol = 2; _ibxP.smooth = 0;
});

// Schwerpunkt-x der roten Farbplatte im flachen Layout
const rotX = () => pg.evaluate(() => {
  _ibxProcess();
  const B = _ibxBuildParts();
  const teile = B.colParts.map(cp => {
    let sx = 0, n = 0;
    for (const g of cp.geos) { const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { sx += p.getX(i); n++; } }
    return { hex: B.palHex[cp.k], cx: sx / Math.max(1, n) };
  });
  // rot = größter Rot-Anteil in der Palette
  const rot = teile.slice().sort((a, c) =>
    (parseInt(c.hex.slice(1, 3), 16) - parseInt(c.hex.slice(3, 5), 16)) -
    (parseInt(a.hex.slice(1, 3), 16) - parseInt(a.hex.slice(3, 5), 16)))[0];
  return { rot, teile };
});

await pg.evaluate(() => { _ibxP.mir = false; });
const norm = await rotX();
await pg.evaluate(() => { _ibxP.mir = true; });
const gesp = await rotX();
await b.close();

console.log('Standard  (Wie Vorlage):', JSON.stringify(norm));
console.log('Gespiegelt            :', JSON.stringify(gesp));

const probleme = [];
if (fehler.length) probleme.push('Seitenfehler: ' + fehler.join(' | '));
if (!(norm.rot.cx > 0.05)) probleme.push(`Standard: rotes Feld müsste bei +x liegen, ist bei ${norm.rot.cx.toFixed(3)}`);
if (!(gesp.rot.cx < -0.05)) probleme.push(`Gespiegelt: rotes Feld müsste bei −x liegen, ist bei ${gesp.rot.cx.toFixed(3)}`);

if (probleme.length) { console.error('FEHLGESCHLAGEN:\n- ' + probleme.join('\n- ')); process.exit(1); }
console.log('OK — Motiv wird gegengespiegelt, Umschalter kehrt es um.');
