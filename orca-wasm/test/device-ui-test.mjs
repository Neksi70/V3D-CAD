// Headless-Check Geräteseite (Studio-Look): App mit Cloud-Session laden,
// Gerät-Tab öffnen → Layout-Elemente prüfen → Screenshot für Sichtkontrolle.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const sid = JSON.parse(readFileSync('/home/v3da/orca-wasm/bridge/sessions.json', 'utf8'))[0][0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1720, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.addInitScript((s) => sessionStorage.setItem('vs-sid', s), sid);

await page.goto('http://127.0.0.1:8778/app/', { waitUntil: 'load' });

// Drucker geladen → Gerät-Tab sichtbar, dann öffnen
await page.waitForFunction(() => !document.getElementById('tabDevice').hidden, null, { timeout: 30000 });
await page.click('#tabDevice');
await page.waitForFunction(() => !document.getElementById('devicePanel').hidden, null, { timeout: 10000 });
// Erster Status-Poll durch (Badge gefüllt)
await page.waitForFunction(() => document.getElementById('devState').textContent.trim() !== '', null, { timeout: 20000 });
await page.waitForTimeout(800);

const snap = await page.evaluate(() => ({
  state: document.getElementById('devState').textContent,
  job: document.getElementById('devJobName').textContent,
  pct: document.getElementById('devPct').textContent,
  meta: document.getElementById('devJobMeta').textContent,
  nozzle: document.getElementById('devNozzle').textContent,
  bed: document.getElementById('devBed').textContent,
  cham: document.getElementById('devCham').textContent,
  fan: document.getElementById('devFan').textContent,
  ams: [...document.querySelectorAll('#devAms .amsCard')].map(c => c.textContent.trim()),
  lightOn: document.getElementById('devLight').classList.contains('on'),
  sidebarItems: [...document.querySelectorAll('.devNav .item')].map(i => i.textContent.trim()),
  camIdleVisible: getComputedStyle(document.getElementById('camIdle')).display !== 'none',
  cols: getComputedStyle(document.getElementById('devicePanel')).gridTemplateColumns,
}));
console.log(JSON.stringify(snap, null, 2));

await page.screenshot({ path: '/tmp/claude-1000/-home-v3da/91ec4714-e8c9-4eb4-9e8e-fa5b15082c99/scratchpad/device-page.png' });
console.log('Fehler:', errors.length ? errors : 'keine');
await browser.close();

// Nachtest: zurück zu „Vorbereiten" — Slicer-Spalte muss wiederkommen
const browser2 = await chromium.launch();
const page2 = await browser2.newPage({ viewport: { width: 1720, height: 950 } });
const errs2 = [];
page2.on('pageerror', e => errs2.push('PAGEERROR: ' + e.message));
await page2.addInitScript((s) => sessionStorage.setItem('vs-sid', s), sid);
await page2.goto('http://127.0.0.1:8778/app/', { waitUntil: 'load' });
await page2.waitForFunction(() => !document.getElementById('tabDevice').hidden, null, { timeout: 30000 });
await page2.click('#tabDevice');
await page2.waitForTimeout(500);
await page2.click('[data-tab="prepare"]');
await page2.waitForTimeout(300);
const back = await page2.evaluate(() => ({
  devClass: document.body.classList.contains('devTab'),
  asideVisible: getComputedStyle(document.querySelector('aside')).display !== 'none',
  toolbarVisible: getComputedStyle(document.getElementById('toolbar')).display !== 'none',
  panelHidden: document.getElementById('devicePanel').hidden,
}));
console.log('Zurück zu Vorbereiten:', JSON.stringify(back));
console.log('Fehler (Teil 2):', errs2.length ? errs2 : 'keine');
await browser2.close();
