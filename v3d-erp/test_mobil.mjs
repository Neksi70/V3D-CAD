import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}, hasTouch:true, isMobile:true}); const pg = await ctx.newPage();
const errs=[]; pg.on('pageerror', e=>errs.push(e.message)); const out={};
await pg.goto('http://127.0.0.1:8820/'); await pg.fill('#lu','demo'); await pg.fill('#lp','demo'); await pg.click('button.pri'); await pg.waitForSelector('.seite.on .kopfzeile');
const navX = () => pg.evaluate(() => document.querySelector('nav').getBoundingClientRect().right);
out.zuAnfang = await navX();
await pg.screenshot({path:'/tmp/mob_zu.png'});
await pg.click('#burger'); await pg.waitForTimeout(400); out.nachBurger = await navX();
await pg.screenshot({path:'/tmp/mob_auf.png'});
if (!await pg.locator('nav a[href="#/produktion"]').isVisible()) await pg.click('nav .ordner[data-g="Produktion"]');
await pg.click('nav a[href="#/produktion"]'); await pg.waitForTimeout(500); out.nachLink = await navX(); out.hash = await pg.evaluate(()=>location.hash);
await pg.click('#burger'); await pg.waitForTimeout(400); await pg.mouse.click(370, 400); await pg.waitForTimeout(400); out.nachSchleier = await navX();
// Wischen vom Rand
await pg.evaluate(() => { const T=(x)=>new Touch({identifier:1,target:document.body,clientX:x,clientY:300});
  document.dispatchEvent(new TouchEvent('touchstart',{touches:[T(5)],changedTouches:[T(5)]})); document.dispatchEvent(new TouchEvent('touchend',{touches:[],changedTouches:[T(160)]})); });
await pg.waitForTimeout(400); out.nachWischen = await navX();
await pg.screenshot({path:'/tmp/mob_produktion.png'});
// Desktop: kein Burger, Menü fest
await pg.setViewportSize({width:1300,height:800}); await pg.waitForTimeout(300);
out.desktopBurger = await pg.locator('#burger').isVisible(); out.desktopNav = await navX();
console.log(JSON.stringify(out), errs); await b.close();
