// 📥 Meine Dateien + Namensabfrage (Volker 2.11.26) — gegen Test-Instanzen von Mimi share + V3D CAD
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path';
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'md-'));
const MIMI = 8958, CAD = 8970;
const mimi = spawn('python3', ['server.py', String(MIMI)], { cwd: '/home/v3da/v3dteilen', stdio: 'ignore',
  env: { ...process.env, V3DTEILEN_DATEN: T + '/daten', V3DTEILEN_CFG: T + '/cfg' } });
await new Promise(r => setTimeout(r, 1200));
const cad = spawn('python3', ['volme3d_server.py', String(CAD), '--dev'], { cwd: '/home/v3da', stdio: 'ignore',
  env: { ...process.env, V3D_MIMI_URL: 'http://127.0.0.1:' + MIMI, V3D_MIMI_KEYFILE: T + '/cfg/cad_schluessel',
         V3D_PROFIL_DATEI: T + '/profil.json', V3D_MIMI_OEFFENTLICH: 'http://127.0.0.1:' + MIMI } });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let fail = 0; const chk = (c, m) => { console.log((c ? 'OK   ' : 'FEHL ') + m); if (!c) fail++; };
// kleine Testdateien
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGP4z8DwnwEKGJkYGBgAN2wDAZf3JmQAAAAASUVORK5CYII=', 'base64');
fs.writeFileSync(T + '/Kugel Foto.png', png);
fs.writeFileSync(T + '/Stern.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M10 0 L13 7 L20 7 L14 12 L16 20 L10 15 L4 20 L6 12 L0 7 L7 7 Z"/></svg>');
try {
  await pg.goto('http://127.0.0.1:' + CAD + '/volme3d.html?profilfrage=1');
  await pg.waitForFunction(() => typeof _mdOpen === 'function');
  try { await pg.evaluate(() => hideStarter()); } catch (e) {}
  // 1) Namensabfrage beim Start
  await pg.waitForSelector('#pf-vn', { state: 'visible', timeout: 8000 });
  chk(true, 'Namensabfrage erscheint beim Start (Name fehlt)');
  await pg.click('#pf-ok');
  chk((await pg.textContent('#pf-err')).includes('Vorname'), 'leer speichern → Hinweis');
  await pg.fill('#pf-vn', 'Volker'); await pg.fill('#pf-nn', 'Isken'); await pg.press('#pf-nn', 'Enter');
  await pg.waitForSelector('#profil-modal', { state: 'hidden' });
  const prof = JSON.parse(fs.readFileSync(T + '/profil.json', 'utf8'));
  chk(prof.dev && prof.dev.vorname === 'Volker' && prof.dev.nachname === 'Isken', 'Name serverseitig gespeichert');
  // 2) Meine Dateien öffnen über den Knopf in der Leiste
  await pg.evaluate(() => { const u = document.getElementById('umsteiger-hinweis'); if (u) u.remove(); });
  await pg.click('button:has-text("📥 Meine Dateien")');
  await pg.waitForSelector('#md-modal >> text=Ordner:');
  await pg.waitForFunction(() => _md.daten);
  chk((await pg.textContent('#md-modal')).includes('Isken, Volker'), 'Ordner heißt „Isken, Volker"');
  chk(await pg.evaluate(() => !!document.querySelector('#md-qr svg') && document.getElementById('md-link').value.includes('/s/')), 'QR-Code + Handy-Link da');
  // 3) Hochladen (zwei Dateien)
  await pg.setInputFiles('#md-file', [T + '/Kugel Foto.png', T + '/Stern.svg']);
  await pg.waitForFunction(() => _md.daten && _md.daten.dateien.length === 2, null, { timeout: 15000 });
  chk(true, 'zwei Dateien hochgeladen und gelistet');
  const thumb = await pg.waitForFunction(() => { const i = document.querySelector('#md-modal img'); return i && i.complete && i.naturalWidth > 0 ? i.naturalWidth : false; }, null, { timeout: 8000 }).then(h => h.jsonValue()).catch(() => 0);
  chk(thumb === 8, 'Vorschaubild des Fotos lädt (' + thumb + ' px)');
  // 4) Bild öffnen → Bild-Auswahl (Lithophan/Kugel …)
  const fidPng = await pg.evaluate(() => _md.daten.dateien.find(d => /png$/.test(d.name)).fid);
  await pg.evaluate(f => _mdOeffnen(f), fidPng);
  await pg.waitForTimeout(800);
  const imgSt = await pg.evaluate(() => ({ pend: _imgPending && _imgPending.name, typ: _imgPending && _imgPending.type, size: _imgPending && _imgPending.size, md: document.getElementById('md-modal').style.display }));
  chk(imgSt.pend === 'Kugel Foto.png' && imgSt.typ === 'image/png' && imgSt.size === png.length && imgSt.md === 'none', 'Öffnen (Bild) → Bild-Auswahl mit genau dieser Datei ' + JSON.stringify(imgSt));
  await pg.screenshot({ path: '/tmp/md_bild.png' });
  await pg.evaluate(() => { document.querySelectorAll('.modal.show,[id$="-modal"].show').forEach(m => m.classList.remove('show')); });
  // 5) SVG öffnen → SVG-Import-Dialog
  await pg.evaluate(() => _mdOpen()); await pg.waitForFunction(() => _md.daten && !_md.laedt);
  const fidSvg = await pg.evaluate(() => _md.daten.dateien.find(d => /svg$/.test(d.name)).fid);
  await pg.evaluate(f => _mdOeffnen(f), fidSvg);
  await pg.waitForTimeout(800);
  chk(await pg.evaluate(() => getComputedStyle(document.getElementById('svg-modal')).display !== 'none' && _svgParsedData && _svgParsedData.fileName === 'Stern.svg'), 'Öffnen (SVG) → SVG-Import-Dialog');
  await pg.evaluate(() => { document.getElementById('svg-modal').style.display = 'none'; });
  // 6) Vom Handy über den Empfangs-Link hochladen (öffentliche Mimi-share-API)
  await pg.evaluate(() => _mdOpen()); await pg.waitForFunction(() => _md.daten && !_md.laedt);
  const link = await pg.evaluate(() => _md.daten.link), tok = link.match(/\/s\/([^/]+)\//)[1];
  const hp = await b.newPage();
  await hp.goto(link);
  chk((await hp.content()).length > 200, 'Handy-Link öffnet die Hochlade-Seite');
  const up = await hp.evaluate(async ([tok, b64]) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const r = await fetch('/api/e/' + tok + '/datei', { method: 'POST', body: JSON.stringify({ name: 'Handyfoto.png', groesse: bytes.length, typ: 'image/png', von: 'Volker Handy' }) });
    const { fid } = await r.json();
    const r2 = await fetch('/api/e/' + tok + '/stueck?fid=' + fid + '&offset=0', { method: 'POST', body: bytes });
    return (await r2.json()).fertig;
  }, [tok, png.toString('base64')]);
  chk(up === true, 'Upload über Handy-Link fertig');
  await pg.click('#md-modal button[title^="Neu laden"]');
  await pg.waitForFunction(() => _md.daten && _md.daten.dateien.length === 3 && !_md.laedt, null, { timeout: 8000 });
  chk((await pg.textContent('#md-modal')).includes('vom Handy (Volker Handy)'), '↻ zeigt die Handy-Datei mit Absender');
  await pg.screenshot({ path: '/tmp/md_liste.png' });
  // 7) Löschen
  pg.once('dialog', d => d.accept());
  await pg.evaluate(f => _mdLoeschen(f), fidSvg);
  await pg.waitForFunction(() => _md.daten && _md.daten.dateien.length === 2 && !_md.laedt, null, { timeout: 8000 });
  chk(true, 'Löschen entfernt die Datei');
  // 8) Anmeldeseite: Namensfelder beim Registrieren
  await pg.goto('http://127.0.0.1:' + CAD + '/login');
  const sichtbar = id => pg.evaluate(i => { const e = document.getElementById(i); return getComputedStyle(e).display !== 'none' && e.offsetHeight > 0; }, id);
  chk(await sichtbar('auth-name'), 'Login: Vor-/Nachname von Anfang an sichtbar (Registrieren mit einem Klick)');
  await pg.fill('#auth-email', 'x@beispiel.de'); await pg.fill('#auth-pw', 'geheim123');
  await pg.click('#auth-btn-register');
  chk((await pg.textContent('#auth-err')).includes('Vorname und Nachname') && await sichtbar('auth-err'), 'ohne Namen keine Registrierung – Meldung SICHTBAR');
  chk(!errs.filter(e => !/firebase|auth\//i.test(e)).length, 'keine Seitenfehler ' + JSON.stringify(errs));
} finally { await b.close(); mimi.kill(); cad.kill(); fs.rmSync(T, { recursive: true, force: true }); }
console.log(fail ? 'FEHLER: ' + fail : 'ALLES OK'); process.exit(fail ? 1 : 0);
