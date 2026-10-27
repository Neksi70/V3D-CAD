// Klicktest Werkstatt-Tablet + PDF (Playwright), Testserver wie bei test_oberflaeche.mjs
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
const B='http://127.0.0.1:8820/';
const b = await chromium.launch();
const out={}; const errs=[];
// --- Büro: PDF
let pg = await b.newPage({viewport:{width:1440,height:950}});
pg.on('pageerror', e=>errs.push('PAGE '+e.message)); pg.on('dialog', d=>d.accept());
await pg.goto(B); await pg.fill('#lu','demo'); await pg.fill('#lp','demo'); await pg.click('button.pri'); await pg.waitForSelector('.seite.on .kpis');
const pdf = await pg.evaluate(async()=>{ const r=await fetch('api/projekte/1/bericht.pdf'); const t=await r.arrayBuffer(); return [r.status, r.headers.get('content-type'), r.headers.get('content-disposition'), new TextDecoder().decode(new Uint8Array(t).slice(0,5))]; });
out.pdf = pdf;
await pg.close();
// --- Tablet
const ctx = await b.newContext({viewport:{width:1024,height:768}});
pg = await ctx.newPage(); pg.on('pageerror', e=>errs.push('PAGE '+e.message));
await pg.goto(B); await pg.fill('#lu','werkstatt'); await pg.fill('#lp','werkstatt'); await pg.click('button.pri');
await pg.waitForSelector('.ws-modus'); await pg.click('.ws-modus [data-m="schritte"]');   // Tablet startet seit 22.10. in „Produktion“
await pg.waitForSelector('.ws-karte');
out.karten = await pg.locator('.ws-karte:not(.fertig)').count();
out.bereiche = await pg.locator('.ws-bereiche [data-b]').allInnerTexts();
out.nav = await pg.locator('nav').count();
await pg.screenshot({path:'/tmp/ws1.png'});
await pg.locator('.ws-bereiche [data-b="Werkstatt"]').click(); await pg.waitForTimeout(500);
out.kartenWerkstatt = await pg.locator('.ws-karte:not(.fertig) .ws-schritt').allInnerTexts();
// erledigt
await pg.locator('.ws-karte:not(.fertig) .ws-ok').first().click(); await pg.locator('#dFuss .btn', {hasText:'Ja, erledigt'}).click(); await pg.waitForTimeout(700);
out.nachErledigt = await pg.locator('.ws-karte.fertig .ws-schritt').allInnerTexts();
// Problem melden
await pg.locator('.ws-bereiche [data-b=""]').click(); await pg.waitForTimeout(400);
await pg.locator('.ws-karte:not(.fertig) .ws-problem').first().click(); await pg.locator('.ws-gruende button', {hasText:'Material fehlt'}).click();
await pg.fill('#wsText', (await pg.inputValue('#wsText')) + ' – Bleche erst Montag'); await pg.locator('#dFuss .btn', {hasText:'Melden'}).click(); await pg.waitForTimeout(500);
out.toast = await pg.locator('#toast').innerText();
// Rechte
out.rechte = await pg.evaluate(async()=>{ const r1=await fetch('api/adressen'); const r2=await fetch('api/projekte/1/bericht.pdf'); const r3=await fetch('api/meilensteine/1/verschieben',{method:'POST',headers:{'X-ERP':'1','Content-Type':'application/json'},body:'{}'}); return [r1.status,r2.status,r3.status]; });
await ctx.close();
// --- Büro sieht Meldung
pg = await b.newPage({viewport:{width:1440,height:950}}); pg.on('pageerror', e=>errs.push('PAGE '+e.message));
await pg.goto(B); await pg.fill('#lu','demo'); await pg.fill('#lp','demo'); await pg.click('button.pri'); await pg.waitForSelector('.seite.on .kpis');
out.buero = (await pg.locator('.seite.on .card', {hasText:'Meldungen aus der Werkstatt'}).innerText()).replace(/\n/g,' | ');
await pg.screenshot({path:'/tmp/ws2.png'});
console.log(JSON.stringify({errs, ...out}, null, 1));
await b.close();
