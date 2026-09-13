// Regressionstest: SpaceMouse — vor allem die ALTE 3Dconnexion-Generation
// (SpaceExplorer/SpaceNavigator): Verschieben in Report 1, Drehen in Report 2,
// Tasten in Report 3. Dazu Maßstab-Lernen, Nullpunkt-Abgleich und Tastenlernen.
// Start: npm run dev (Port 8766). Exit-Code 1 bei Fehler.
import { chromium } from 'playwright';
let fails = 0;
const ok = (name, cond, info='') => { console.log((cond?'  OK   ':'FEHLER ')+name.padEnd(42), info); if(!cond) fails++; };

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{width:1400,height:900} });
const errs = [];
pg.on('pageerror', e => errs.push(String(e)));
await pg.goto('http://127.0.0.1:8766/volme3d.html', { waitUntil:'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout:60000 });
await pg.evaluate(() => { hideStarter(); document.getElementById('auth-overlay')?.classList.add('hidden'); addShape('box'); selectObjs([]); setView('iso'); });

// Gerät vortäuschen: WebHID-Pfad aktiv, Reports werden von Hand eingespeist
await pg.evaluate(() => {
  window._tSend = (id, vals, bytes) => {
    const w = (bytes||2) === 2;
    const buf = new ArrayBuffer(vals.length * (w?2:1));
    const dv = new DataView(buf);
    vals.forEach((v,i) => w ? dv.setInt16(i*2, v, true) : dv.setInt8(i, v));
    _smOnReport({ data: dv, reportId: id });
  };
  window._tReset = () => {
    _smDevice = { productName:'SpaceExplorer', vendorId:0x046d, productId:0xc627 };
    _smActive = true; _smPeak = 350;
    for (const k in _sm) _sm[k] = 0;
    for (const k in _smS) _smS[k] = 0;
    for (const k in _smCfg.zero) _smCfg.zero[k] = 0;
    _smCfg.lockRot = _smCfg.lockPan = false;
    setView('iso');
  };
  window._tCam = () => ({ theta: sph.theta, phi: sph.phi, r: sph.r, tx: orbitTarget.x, ty: orbitTarget.y });
});
const frames = async (n=40) => { for (let i=0;i<n;i++) await pg.evaluate(() => new Promise(r => requestAnimationFrame(r))); };
const feed = async (id, vals, bytes) => pg.evaluate(([id,vals,bytes]) => _tSend(id,vals,bytes), [id,vals,bytes]);
const reset = () => pg.evaluate(() => _tReset());

// 1) Report 1 (6 Byte = nur Verschieben) darf die Drehung NICHT anfassen
{
  await reset(); const a = await pg.evaluate(() => _tCam());
  for (let i=0;i<25;i++){ await feed(1,[0,0,300]); await frames(2); }   // tz = heben
  const c = await pg.evaluate(() => _tCam());
  ok('alt: Report 1 hebt die Ansicht', Math.abs(c.ty-a.ty) > 0.1, `dy=${(c.ty-a.ty).toFixed(2)}`);
  ok('alt: Report 1 dreht nicht mit',  Math.abs(c.theta-a.theta) < 1e-6, `dtheta=${(c.theta-a.theta).toExponential(1)}`);
}
// 2) Report 2 (eigener Dreh-Report der alten Generation) muss drehen
{
  await reset(); const a = await pg.evaluate(() => _tCam());
  for (let i=0;i<25;i++){ await feed(2,[0,0,300]); await frames(2); }   // rz = Twist
  const c = await pg.evaluate(() => _tCam());
  ok('alt: Report 2 dreht die Ansicht', Math.abs(c.theta-a.theta) > 0.02, `dtheta=${(c.theta-a.theta).toFixed(3)}`);
  ok('alt: als Split-Gerät erkannt', await pg.evaluate(() => _smSplit === true));
}
// 3) Neuere Generation: alle 6 Achsen in Report 1 (12 Byte)
{
  await reset(); const a = await pg.evaluate(() => _tCam());
  for (let i=0;i<25;i++){ await feed(1,[0,0,0,0,0,300]); await frames(2); }
  const c = await pg.evaluate(() => _tCam());
  ok('neu: 12-Byte-Report 1 dreht', Math.abs(c.theta-a.theta) > 0.02, `dtheta=${(c.theta-a.theta).toFixed(3)}`);
}
// 4) Maßstab wird gelernt (Gerät mit größerem Vollausschlag bewegt nicht schneller)
{
  await reset();
  for (let i=0;i<10;i++){ await feed(1,[0,0,1000]); await frames(1); }
  const peak = await pg.evaluate(() => _smPeak);
  ok('Vollausschlag gelernt', peak > 800, `_smPeak=${Math.round(peak)}`);
  // gleiche Auslenkung in % → gleiche Bewegung wie beim 350er-Gerät
  await pg.evaluate(() => { for (const k in _smS) _smS[k]=0; setView('iso'); });
  const a = await pg.evaluate(() => _tCam());
  for (let i=0;i<25;i++){ await feed(1,[0,0,1000]); await frames(2); }
  const big = (await pg.evaluate(() => _tCam())).ty - a.ty;
  await reset();
  const a2 = await pg.evaluate(() => _tCam());
  for (let i=0;i<25;i++){ await feed(1,[0,0,350]); await frames(2); }
  const small = (await pg.evaluate(() => _tCam())).ty - a2.ty;
  ok('gleiche Geschwindigkeit je Modell', Math.abs(big-small) < Math.abs(small)*0.25, `1000er=${big.toFixed(2)} 350er=${small.toFixed(2)}`);
}
// 5) Nullpunkt-Abgleich gegen Drift
{
  await reset();
  const drift = async () => { const a = await pg.evaluate(() => _tCam());
    for (let i=0;i<30;i++){ await feed(1,[40,0,0]); await feed(2,[0,0,0]); await frames(2); }
    return Math.abs((await pg.evaluate(() => _tCam())).tx - a.tx); };
  const before = await drift();
  ok('Drift ohne Abgleich sichtbar', before > 0.05, `dx=${before.toFixed(3)}`);
  await pg.evaluate(() => calibrateSpaceMouse());
  for (let i=0;i<45;i++){ await feed(1,[40,0,0]); await pg.waitForTimeout(10); }
  await pg.waitForTimeout(200);
  const zero = await pg.evaluate(() => Math.round(_smCfg.zero.tx));
  ok('Nullpunkt gemessen', Math.abs(zero-40) <= 2, `zero.tx=${zero}`);
  // stilles Gerät: der Abgleich darf keinen erfundenen Nullpunkt setzen
  await pg.evaluate(() => { _smCfg.zero.tx = 7; calibrateSpaceMouse(); });
  await pg.waitForTimeout(1900);
  ok('stilles Gerät: alter Wert bleibt', await pg.evaluate(() => _smCfg.zero.tx === 7), 'kein Abgleich ins Blaue');
  await pg.evaluate(() => { _smCfg.zero.tx = 40; });
  await pg.evaluate(() => { for (const k in _smS) _smS[k]=0; setView('iso'); });
  const after = await drift();
  ok('nach Abgleich steht die Ansicht', after < 0.01, `dx=${after.toFixed(4)}`);
}
// 6) Tasten: anlernen und auslösen
{
  await reset();
  await pg.evaluate(() => { _smCfg.btn = {}; _smBtnSeen.length = 0; openSpaceMouseSetup(); document.getElementById('sm-act').value='fit'; _smBtnLearnStart(); });
  await feed(3,[0x04,0x00]);           // Bit 2 gedrückt
  await feed(3,[0x00,0x00]);           // losgelassen
  const map = await pg.evaluate(() => JSON.stringify(_smCfg.btn));
  ok('Taste angelernt', map === '{"2":"fit"}', map);
  // Auslösen: Kamera muss aufs Modell einpassen
  await pg.evaluate(() => { sph.r = 900; orbitTarget.set(50,50,50); sph2cam(); });
  await feed(3,[0x04,0x00]); await feed(3,[0x00,0x00]);
  const r = await pg.evaluate(() => sph.r);
  ok('Taste löst Aktion aus', r < 200, `sph.r=${r.toFixed(1)}`);
  ok('Belegung gespeichert', await pg.evaluate(() => (JSON.parse(localStorage.getItem('volme3d_sm')||'{}').btn||{})['2'] === 'fit'));
}
// 7) Einrichtungs-Fenster: Status, Balken, Diagnose
{
  await pg.evaluate(() => openSpaceMouseSetup());
  await feed(1,[350,0,0]); await frames(5);
  const st = await pg.evaluate(() => ({
    sichtbar: document.getElementById('sm-setup-modal').classList.contains('show'),
    status: document.getElementById('sm-stat').textContent,
    balken: document.getElementById('sm-b-tx').style.width,
    diag: _smDiagText()
  }));
  ok('Fenster offen', st.sichtbar);
  ok('Status nennt das Gerät', /SpaceExplorer/.test(st.status), st.status.slice(0,60));
  ok('Achsbalken schlägt aus', st.balken !== '' && parseFloat(st.balken) > 5, `width=${st.balken}`);
  ok('Diagnose nennt Report-IDs', /Report-IDs.*1:/.test(st.diag));
  await pg.evaluate(() => _smCloseSetup());
}
// 8) Achse umkehren wirkt
{
  await reset();
  const dir = async () => { await pg.evaluate(() => { for (const k in _smS) _smS[k]=0; setView('iso'); });
    const a = await pg.evaluate(() => _tCam());
    for (let i=0;i<25;i++){ await feed(1,[0,0,300]); await frames(2); }
    return Math.sign((await pg.evaluate(() => _tCam())).ty - a.ty); };
  const d1 = await dir();
  await pg.evaluate(() => _smInvSet('tz', _smCfg.inv.tz > 0));
  const d2 = await dir();
  ok('Umkehren dreht die Richtung', d1 !== 0 && d1 === -d2, `${d1} → ${d2}`);
  await pg.evaluate(() => { _smInvSet('tz', _smCfg.inv.tz > 0); localStorage.removeItem('volme3d_sm'); });
}
ok('keine Seitenfehler', errs.length === 0, errs.join(' | ').slice(0,200));
await b.close();
console.log(fails ? `\n${fails} Fehler` : '\nAlles grün ✓');
process.exit(fails ? 1 : 0);
