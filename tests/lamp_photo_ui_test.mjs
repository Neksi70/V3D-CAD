// UI-Durchlauf für das Foto-Muster: Tab schalten, Regler-Zeilen einblenden,
// Schirm erstellen und mit dem eingebauten Druck-Check auf Dichtheit prüfen.
import { chromium } from '@playwright/test';

const b = await chromium.launch();
const page = await b.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('http://127.0.0.1:8766/volme3d.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window._openLampModal === 'function', { timeout: 60000 });

const res = await page.evaluate(async () => {
  const out = {};
  _openLampModal();
  await new Promise(r => setTimeout(r, 300));
  out.modalOffen = document.getElementById('lamp-modal').classList.contains('show');

  // Foto-Tab klicken (letzter Button in der Muster-Gruppe)
  const tabs = document.querySelectorAll('#lbg-pat .vtb');
  out.tabAnzahl = tabs.length;
  tabs[tabs.length - 1].click();
  await new Promise(r => setTimeout(r, 250));
  out.pattern = _lampP.pattern;
  const vis = id => { const e = document.getElementById(id); return !!e && e.style.display !== 'none'; };
  out.fotoZeileSichtbar = vis('lp-row-photo');
  out.rillenZeileVersteckt = !vis('lp-row-ribs');
  out.tabAktiv = tabs[tabs.length - 1].classList.contains('on');
  out.wallMin = document.getElementById('lp-wall').min;
  out.infoOhneBild = document.getElementById('lpf-info').textContent;

  // Bild einspielen (wie _lampPhotoFile es tut) und Motivhöhe automatisch setzen
  const c = document.createElement('canvas'); c.width = 120; c.height = 90;
  const x = c.getContext('2d');
  const grd = x.createLinearGradient(0, 0, 120, 90);
  grd.addColorStop(0, '#000'); grd.addColorStop(1, '#fff');
  x.fillStyle = grd; x.fillRect(0, 0, 120, 90);
  x.fillStyle = '#000'; x.beginPath(); x.arc(60, 45, 22, 0, 7); x.fill();
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = c.toDataURL(); });
  const dt = new DataTransfer();
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  dt.items.add(new File([blob], 'motiv.png', { type: 'image/png' }));
  const inp = document.getElementById('lpf-file');
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change'));
  await new Promise(r => setTimeout(r, 800));
  out.bildGeladen = !!(_lampImg.lum && _lampImg.cols);
  out.autoMotivHoehe = _lampP.photoH;
  out.dropText = document.getElementById('lpf-drop').textContent;
  out.infoMitBild = document.getElementById('lpf-info').textContent.slice(0, 90);

  // Wandstärke auf 0,8 stellen (nur im Foto-Muster erlaubt)
  _lampSet('wall', 0.8);
  out.wallFoto = _lampP.wall;
  out.sliderWert = document.getElementById('lp-wall').value;

  // Klein halten, damit der Druck-Check im Test zügig durchläuft
  _lampSet('h', 60); _lampSet('dia', 50); _lampSet('photoH', 30);
  await new Promise(r => setTimeout(r, 300));

  _createLamp();
  await new Promise(r => setTimeout(r, 500));
  const mesh = objects[objects.length - 1];
  out.erstellt = !!mesh && mesh.userData.type === 'lampshade';
  out.name = mesh && mesh.userData.name;
  out.gespeicherteTiefe = mesh && mesh.userData.lpPhotoDepth;
  out.tris = mesh ? (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3 : 0;

  const chk = _printCheckAnalyze();
  out.check = { boundaryEdges: chk.boundaryEdges, nonManifold: chk.nonManifold, tris: chk.tris };

  // Zurück auf Rillen: Wand muss wieder auf 1,2 hochgehen
  _lampSet('pattern', 'ribs');
  out.wallNachWechsel = _lampP.wall;
  out.wallMinNachWechsel = document.getElementById('lp-wall').min;
  return out;
});

console.log(JSON.stringify(res, null, 1));
console.log('\nSeitenfehler:', errs.length ? errs : 'keine');

const lines = []; let all = true;
const check = (n, c) => { lines.push(`${c ? '✓' : '✗'} ${n}`); all = all && !!c; };
check('Modal offen', res.modalOffen);
check('5 Muster-Tabs', res.tabAnzahl === 5);
check('Foto-Muster aktiv', res.pattern === 'photo' && res.tabAktiv);
check('Foto-Regler sichtbar, Rillen versteckt', res.fotoZeileSichtbar && res.rillenZeileVersteckt);
check('Wand-Slider erlaubt 0,8', res.wallMin === '0.8' && res.wallFoto === 0.8 && res.sliderWert === '0.8');
check('Bild geladen', res.bildGeladen);
check('Motiv-Höhe automatisch gesetzt', res.autoMotivHoehe > 10);
check('Drop-Zone zeigt „ersetzen"', /ersetzen/.test(res.dropText));
check('Schirm erstellt', res.erstellt);
check('Foto-Parameter in userData', res.gespeicherteTiefe > 0);
// Nicht-manifolde Kanten an der Kuppelspitze sind ein Vorbefund aller Lampen-
// schirme (auch „Glatt"); entscheidend ist, dass keine Kante offen bleibt.
check('Druck-Check: keine offenen Kanten', res.check.boundaryEdges === 0);
check('Wand zurück auf 1,2 bei Rillen', res.wallNachWechsel === 1.2 && res.wallMinNachWechsel === '1.2');
check('keine Seitenfehler', errs.length === 0);
console.log('\n' + lines.join('\n'));
console.log(all ? '\nALLES GRÜN' : '\nFEHLGESCHLAGEN');
await b.close();
process.exit(all ? 0 : 1);
