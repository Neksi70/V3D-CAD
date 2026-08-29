import { chromium } from '@playwright/test';
import https from 'node:https';

const KEY = 'AIzaSyB1TC58k0AmuU6pclev-WLr1-VGIgu98Q4';
const MAIL = 'e2e-wegwerf@volme3d-test.invalid', PW = 'Wegwerf!abcdefg';
const idt = (op, payload) => new Promise((res, rej) => {
  const body = JSON.stringify(payload);
  const r = https.request(`https://identitytoolkit.googleapis.com/v1/accounts:${op}?key=${KEY}`,
    {method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},
    s => { let d=''; s.on('data',c=>d+=c); s.on('end',()=>res(JSON.parse(d))); });
  r.on('error', rej); r.end(body);
});

let tok = null;
const up = await idt('signUp', {email:MAIL, password:PW, returnSecureToken:true});
if (up.error) { const si = await idt('signInWithPassword',{email:MAIL,password:PW,returnSecureToken:true}); tok = si.idToken; }
else tok = up.idToken;
console.log('Testkonto bereit:', !!tok);

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const B = 'http://127.0.0.1:8791';
try {
  // 1) Editor direkt aufrufen -> muss auf die Anmeldung umleiten
  await p.goto(B + '/volme3d.html', {waitUntil:'domcontentloaded'});
  console.log('1) /volme3d.html landet auf :', new URL(p.url()).pathname + new URL(p.url()).search);

  // 2) Anmelden über das Formular
  await p.fill('#auth-email', MAIL);
  await p.fill('#auth-pw', PW);
  await p.click('#auth-btn-login');
  await p.waitForURL(u => u.pathname === '/volme3d.html', {timeout:25000});
  console.log('2) nach dem Anmelden auf   :', new URL(p.url()).pathname);

  // 3) Cookie da? HttpOnly?
  const c = (await ctx.cookies()).find(x => x.name === 'v3dsess');
  console.log('3) Cookie v3dsess          :', c ? `gesetzt, httpOnly=${c.httpOnly}, sameSite=${c.sameSite}, secure=${c.secure}` : 'FEHLT');

  // 4) Editor wirklich benutzbar?
  await p.waitForTimeout(5000);
  console.log('4) Editor benutzbar        :', await p.evaluate(() => {
    const ov = document.getElementById('auth-overlay');
    if (typeof addShape !== 'function') return 'addShape fehlt';
    addShape('box');
    return `Overlay zu=${ov.classList.contains('hidden')}, objects=${objects.length}`;
  }));

  // 5) Abmelden -> zurück zur Anmeldung, Cookie weg
  await p.evaluate(() => _authLogout());
  await p.waitForURL(u => u.pathname === '/login', {timeout:15000});
  const c2 = (await ctx.cookies()).find(x => x.name === 'v3dsess');
  console.log('5) nach Abmelden           :', new URL(p.url()).pathname, '| Cookie:', c2 ? 'noch da (' + (c2.value||'leer') + ')' : 'weg');

  // 6) Editor erneut -> wieder gesperrt
  await p.goto(B + '/volme3d.html', {waitUntil:'domcontentloaded'});
  console.log('6) Editor nach Abmelden    :', new URL(p.url()).pathname);
} finally {
  await b.close();
  const si = await idt('signInWithPassword',{email:MAIL,password:PW,returnSecureToken:true});
  if (si.idToken) console.log('Testkonto gelöscht:', !(await idt('delete',{idToken:si.idToken})).error);
}
