// Test: eingelesener Bausatz-Rahmen (Ralf, 28.9.26). Ein als STL gespeicherter und
// wieder geladener Rahmen kennt seine Teile nicht (kein userData.bausatz). Klick auf
// 🛩️ im Eigenschaften-Feld darf dann nicht kommentarlos „neuen Rahmen" anbieten,
// sondern muss oben im Dialog erklären, warum Freigeben nicht geht.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
try {
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('spr-test','test@lokal'))"],
                            { cwd: process.cwd(), encoding: 'utf8' }).trim();
  await ctx.addCookies([{ name: 'v3dsess', value: sess, domain: new global.URL(URL).hostname,
                          path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
} catch (e) { console.log('  (kein Sitzungs-Cookie: ' + e.message.split('\n')[0] + ')'); }
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 90000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show');
                          document.getElementById('auth-overlay')?.classList.add('hidden'); });

// Ein Objekt mit Namen anlegen, wählen, dann den echten Knopf im Eigenschaften-Feld klicken
const probe = async (name, bausatz) => {
  await pg.evaluate(async ({ name, bausatz }) => {
    _sprClose(); _newCreate(false);
    // wie ein STL-Import: ein Netz, Typ import
    const g = new THREE.BoxGeometry(40, 10, 30).toNonIndexed(); g.translate(0, 5, 0); g.deleteAttribute('uv');
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
    m.userData = { id: idCtr++, name, color: '#dd3333', isHole: false, type: 'import', shapeType: 'import' };
    if (bausatz) m.userData.bausatz = { satz: 'x', quellen: ['gibtsnicht'] };
    scene.add(m); objects.push(m); selectObjs([m]); _fpCurType = null; updateFP(); updateTree();
    await new Promise(r => setTimeout(r, 200));
  }, { name, bausatz });
  const btn = pg.locator('#fp-body button[onclick="_sprOpen()"]').first();
  const label = (await btn.textContent()).trim();
  await btn.evaluate(e => e.click());   // echter onclick-Weg; Panel liegt evtl. außerhalb des Sichtbereichs
  await pg.waitForTimeout(200);
  return pg.evaluate(() => ({
    modal: document.getElementById('spr-modal').classList.contains('show'),
    hinweis: !!document.getElementById('spr-fremd'),
    toast: [...document.querySelectorAll('.notification, .toast, #notify, [class*="notif"]')].map(e => e.textContent).join(' ').slice(0, 200),
  })).then(r => ({ label, ...r }));
};

let r = await probe('TR Platte Bausatz A1', false);
ok('Import „TR Platte Bausatz A1": Knopf heißt Bausatz-Rahmen', /Bausatz-Rahmen/.test(r.label), r.label);
ok('Import: Dialog offen', r.modal);
ok('Import: Hinweis „eingelesener Rahmen" sichtbar', r.hinweis);

r = await probe('Würfel', false);
ok('normales Teil: Dialog offen', r.modal);
ok('normales Teil: kein Rahmen-Hinweis', !r.hinweis);

r = await probe('Bausatz-Rahmen — 3 Teile', true);
ok('echter Rahmen: Knopf heißt Teile freigeben', /Teile freigeben/.test(r.label), r.label);
ok('echter Rahmen: kein Erzeugen-Dialog', !r.modal);

ok('keine Seitenfehler', !errs.length, errs);
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
