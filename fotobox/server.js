#!/usr/bin/env node
// Fotobox-Portal — Eltern registrieren sich (E-Mail oder Google) und laden
// Fotobox-Bilder herunter. Fotos: photos/<event>/*.jpg, je Ordner eine Galerie.
// Optional photos/<event>/event.json: { "title": "...", "code": "1234" }
// Keine npm-Abhängigkeiten. Thumbnails via ffmpeg, ZIP via /usr/bin/zip.
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const querystring = require('querystring');

const ROOT = __dirname;
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const PORT = Number(process.argv[2] || CFG.port || 8788);
const BASE = (CFG.basePath || '').replace(/\/$/, ''); // z.B. "/fotos" oder ""
const PHOTOS_DIR = path.join(ROOT, 'photos');
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_DIR = path.join(ROOT, 'cache');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const DL_LOG = path.join(DATA_DIR, 'downloads.jsonl');
const PACKAGES = {
  basis: { label: 'Fotobox — Tagesmiete', price: 89 },
  flat: { label: 'Fotobox + Fotodrucker & Fotoflatrate', price: 169 },
};
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

for (const d of [PHOTOS_DIR, DATA_DIR, CACHE_DIR]) fs.mkdirSync(d, { recursive: true });

// --- Nutzer-Persistenz (JSON-Datei, atomar) --------------------------------
let users = [];
try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { users = []; }
function saveUsers() {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 1));
  fs.renameSync(tmp, USERS_FILE);
}
function upsertUser(email, name, consent, via) {
  email = String(email).trim().toLowerCase();
  let u = users.find(x => x.email === email);
  const now = new Date().toISOString();
  if (u) {
    u.lastLogin = now;
    if (name && !u.name) u.name = name;
    if (consent && !u.consent) { u.consent = true; u.consentAt = now; }
  } else {
    u = { email, name: name || '', consent: !!consent, consentAt: consent ? now : null, via, createdAt: now, lastLogin: now };
    users.push(u);
  }
  saveUsers();
  return u;
}

// --- Buchungen ---------------------------------------------------------------
let bookings = [];
try { bookings = JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8')); } catch (e) { bookings = []; }
function saveBookings() {
  const tmp = BOOKINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(bookings, null, 1));
  fs.renameSync(tmp, BOOKINGS_FILE);
}
function bookedDates() { return bookings.map(b => b.date); }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// --- Session (signierter Cookie, kein Server-State) -------------------------
function sign(data) {
  return crypto.createHmac('sha256', CFG.sessionSecret).update(data).digest('base64url');
}
function makeSession(obj) {
  const payload = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return payload + '.' + sign(payload);
}
function readSession(req) {
  const m = /(?:^|;\s*)fbx=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(payload)))) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (e) { return null; }
}
function setSession(res, obj) {
  res.setHeader('Set-Cookie',
    `fbx=${makeSession(obj)}; Path=${BASE || '/'}; Max-Age=15552000; HttpOnly; SameSite=Lax; Secure`);
}

// --- Events / Galerien ------------------------------------------------------
function listEvents(includeEmpty) {
  const out = [];
  for (const name of fs.readdirSync(PHOTOS_DIR)) {
    const dir = path.join(PHOTOS_DIR, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'event.json'), 'utf8')); } catch (e) {}
    const files = fs.readdirSync(dir).filter(f => IMG_EXT.has(path.extname(f).toLowerCase())).sort();
    if (!files.length && !includeEmpty) continue;
    out.push({ slug: name, title: meta.title || name.replace(/[-_]+/g, ' '), code: meta.code || null, files });
  }
  out.sort((a, b) => a.slug < b.slug ? 1 : -1); // neueste (Namenskonvention mit Datum) zuerst
  return out;
}
function getEvent(slug, includeEmpty) {
  if (!/^[\w][\w .\-]*$/.test(slug)) return null;
  return listEvents(includeEmpty).find(e => e.slug === slug) || null;
}
function slugify(s) {
  return String(s).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
function safePhotoPath(slug, file) {
  const ev = getEvent(slug);
  if (!ev || !ev.files.includes(file)) return null;
  return path.join(PHOTOS_DIR, slug, file);
}

// --- HTML-Bausteine ----------------------------------------------------------
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const CSS = `
:root{--bg:#0c0d11;--card:#16181f;--card2:#1c1f28;--border:#2a2e3a;--text:#f2f3f7;--mut:#9aa1b0;
--acc:#F97316;--acc2:#EA6000;--font:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:var(--font);-webkit-font-smoothing:antialiased}
a{color:var(--acc);text-decoration:none}
header{display:flex;align-items:center;gap:14px;padding:14px 20px;background:#000;border-bottom:3px solid var(--acc)}
header img{height:44px;filter:invert(1)}
header .hb{font-weight:900;font-size:18px;letter-spacing:.4px}
header .hb small{display:block;color:var(--acc);font-weight:700;font-size:12px;letter-spacing:1.5px;text-transform:uppercase}
header .sp{flex:1}
header .who{color:var(--mut);font-size:13px;text-align:right}
header .who a{margin-left:8px}
main{max-width:1060px;margin:0 auto;padding:26px 18px 120px}
h1{font-size:26px;margin:6px 0 4px}
h1 em{color:var(--acc);font-style:normal}
.sub{color:var(--mut);margin:0 0 22px;font-size:15px}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px;max-width:460px;margin:30px auto}
label{display:block;font-size:13px;font-weight:700;color:var(--mut);margin:14px 0 6px}
input[type=text],input[type=email],input[type=password]{width:100%;font-family:var(--font);font-size:16px;color:var(--text);background:var(--card2);border:1.5px solid var(--border);border-radius:12px;padding:12px 14px;outline:none}
input:focus{border-color:var(--acc)}
.chk{display:flex;gap:10px;align-items:flex-start;margin:16px 0;font-size:13.5px;color:var(--mut);line-height:1.45}
.chk input{margin-top:2px;accent-color:var(--acc);width:17px;height:17px;flex:none}
.btn{display:flex;width:100%;align-items:center;justify-content:center;gap:9px;font-family:var(--font);font-size:16px;font-weight:800;color:#fff;background:linear-gradient(180deg,var(--acc),var(--acc2));border:none;border-radius:13px;padding:14px;cursor:pointer;transition:transform .08s}
.btn:active{transform:scale(.98)}
.btn.ghost{background:var(--card2);border:1.5px solid var(--border);color:var(--text)}
.or{display:flex;align-items:center;gap:12px;color:var(--mut);font-size:12px;margin:18px 0}
.or::before,.or::after{content:'';flex:1;height:1px;background:var(--border)}
.albums{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.album{background:var(--card);border:1px solid var(--border);border-radius:16px;overflow:hidden;color:var(--text);transition:border-color .15s}
.album:hover{border-color:var(--acc)}
.album img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:var(--card2)}
.album .ai{padding:12px 14px}
.album .ai b{display:block;font-size:15px}
.album .ai span{color:var(--mut);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.ph{position:relative;border-radius:12px;overflow:hidden;cursor:pointer;border:3px solid transparent;background:var(--card2)}
.ph img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.ph .tick{position:absolute;top:7px;right:7px;width:26px;height:26px;border-radius:50%;background:rgba(0,0,0,.55);border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:transparent;font-weight:900;font-size:15px}
.ph.sel{border-color:var(--acc)}
.ph.sel .tick{background:var(--acc);color:#fff;border-color:var(--acc)}
.bar{position:fixed;left:0;right:0;bottom:0;background:rgba(10,11,14,.92);backdrop-filter:blur(8px);border-top:1px solid var(--border);padding:12px 18px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap}
.bar .cnt{font-weight:800}.bar .cnt em{color:var(--acc);font-style:normal}
.bar button{width:auto;padding:12px 22px;font-size:15px}
dialog{border:none;border-radius:16px;background:#000;padding:0;max-width:92vw;max-height:92vh}
dialog::backdrop{background:rgba(0,0,0,.8)}
dialog img{display:block;max-width:92vw;max-height:80vh;object-fit:contain}
dialog .db{display:flex;gap:10px;padding:12px;justify-content:center;flex-wrap:wrap}
dialog .db .btn{width:auto;padding:10px 18px;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--border)}
th{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.6px}
.pill{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700}
.pill.y{background:rgba(249,115,22,.18);color:var(--acc)}
.pill.n{background:var(--card2);color:var(--mut)}
.err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);color:#fca5a5;border-radius:12px;padding:11px 14px;font-size:14px;margin:0 0 14px}
.ok{background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.4);color:#86efac;border-radius:12px;padding:11px 14px;font-size:14px;margin:0 0 14px}
.pill.g{background:rgba(34,197,94,.15);color:#86efac}
.bwrap{display:grid;grid-template-columns:minmax(300px,440px) minmax(300px,440px);gap:22px;align-items:start;justify-content:center}
@media(max-width:780px){.bwrap{grid-template-columns:1fr}}
.cal{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:18px}
.cal .ch{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.cal .ch b{font-size:17px}
.cal .ch button{background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:5px 14px;cursor:pointer;font-size:17px}
.cal .ch button:disabled{opacity:.3;cursor:default}
.cgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
.cgrid .dh{text-align:center;font-size:11px;color:var(--mut);font-weight:700;padding:4px 0;text-transform:uppercase}
.day{aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:9px;font-size:14px;font-weight:600}
.day.past{color:#4a5160}
.day.free{background:var(--card2);cursor:pointer;border:1.5px solid transparent}
.day.free:hover{border-color:var(--acc)}
.day.bk{background:rgba(239,68,68,.28);color:#fca5a5;text-decoration:line-through;cursor:not-allowed}
.day.sel{background:var(--acc);color:#fff;border-color:var(--acc)}
.legend{display:flex;gap:16px;margin:14px 2px 0;font-size:12px;color:var(--mut);flex-wrap:wrap}
.legend i{display:inline-block;width:12px;height:12px;border-radius:4px;margin-right:6px;vertical-align:-1px}
.pkg{display:flex;flex-direction:column;gap:10px;margin:6px 0 2px}
.pkg label{display:flex;gap:10px;align-items:center;background:var(--card2);border:1.5px solid var(--border);border-radius:12px;padding:13px 14px;margin:0;cursor:pointer;font-weight:600;color:var(--text);font-size:14.5px}
.pkg label:has(input:checked){border-color:var(--acc);background:rgba(249,115,22,.08)}
.pkg input{accent-color:var(--acc);width:17px;height:17px;flex:none}
.pkg .pr{margin-left:auto;font-weight:800;color:var(--acc);font-size:16px;white-space:nowrap}
textarea{width:100%;font-family:var(--font);font-size:15px;color:var(--text);background:var(--card2);border:1.5px solid var(--border);border-radius:12px;padding:12px 14px;outline:none;resize:vertical;min-height:70px}
textarea:focus{border-color:var(--acc)}
.del{position:absolute;top:7px;right:7px;width:26px;height:26px;border-radius:50%;background:rgba(239,68,68,.85);border:none;color:#fff;font-weight:900;font-size:16px;line-height:1;cursor:pointer}
.fn{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);color:#fff;font-size:10px;padding:3px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
code{background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:1px 6px;font-size:13px}
input[type=file]{width:100%}
.gicon{width:19px;height:19px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;color:#4285F4;font-size:13px}
footer{max-width:1060px;margin:0 auto;padding:10px 18px 30px;color:var(--mut);font-size:12px}
footer a{color:var(--mut);text-decoration:underline}
`;
function page(title, body, user) {
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · ${esc(CFG.brand)}</title>
<link rel="icon" href="${BASE}/logo.svg"><style>${CSS}</style></head><body>
<header><a href="${BASE}/"><img src="${BASE}/logo.svg" alt="${esc(CFG.brand)}"></a>
<div class="hb">${esc(CFG.brand)}<small>Fotobox</small></div><div class="sp"></div>
${user ? `<div class="who">${esc(user.name || user.email)}<a href="${BASE}/logout">Abmelden</a></div>` : ''}
</header><main>${body}</main>
<footer>${esc(CFG.brand)} · Die Fotos sind nur für registrierte Gäste der jeweiligen Veranstaltung bestimmt. · <a href="${BASE}/buchen">Fotobox mieten</a> · <a href="${BASE}/datenschutz">Datenschutz</a></footer>
</body></html>`;
}

// --- Seiten ------------------------------------------------------------------
function loginPage(err, next) {
  const googleBtn = CFG.googleClientId ? `
<div class="or">oder</div>
<a class="btn ghost" href="${BASE}/auth/google?next=${encodeURIComponent(next || '')}"><span class="gicon">G</span> Mit Google anmelden</a>` : '';
  return page('Anmelden', `
<div class="card">
<h1>Deine <em>Fotobox</em>-Bilder</h1>
<p class="sub">Einmal kurz registrieren – dann kannst du alle Bilder ansehen und in voller Auflösung herunterladen.</p>
${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" action="${BASE}/register">
<input type="hidden" name="next" value="${esc(next || '')}">
<label>Name</label><input type="text" name="name" required maxlength="80" autocomplete="name">
<label>E-Mail-Adresse</label><input type="email" name="email" required maxlength="120" autocomplete="email">
<div class="chk"><input type="checkbox" name="consent" id="c1" value="1">
<label for="c1" style="margin:0;font-weight:400">Ja, ${esc(CFG.brand)} darf mir per E-Mail Neuigkeiten und Angebote schicken (z.&nbsp;B. Foto-Produkte &amp; Aktionen). Abmeldung jederzeit möglich.</label></div>
<button class="btn" type="submit">Zu den Fotos &rarr;</button>
</form>${googleBtn}
</div>
<p style="text-align:center;color:var(--mut);font-size:14px">Die Fotobox für deine eigene Feier?
<a href="${BASE}/buchen"><b>Jetzt buchen — ab 89 € pro Tag</b></a></p>`);
}
function codePage(ev, err) {
  return page(ev.title, `
<div class="card">
<h1>${esc(ev.title)}</h1>
<p class="sub">Diese Galerie ist geschützt. Den Zugangscode findest du auf deiner Fotobox-Karte.</p>
${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" action="${BASE}/galerie/${encodeURIComponent(ev.slug)}/code">
<label>Zugangscode</label><input type="text" name="code" required autocomplete="off">
<div style="height:14px"></div><button class="btn" type="submit">Galerie öffnen</button>
</form></div>`, true);
}
function albumsPage(user, events, unlocked) {
  const items = events.map(ev => {
    const locked = ev.code && !unlocked.includes(ev.slug);
    const cover = locked
      ? `<div style="width:100%;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;font-size:44px;background:var(--card2)">🔒</div>`
      : `<img loading="lazy" src="${BASE}/thumb/${encodeURIComponent(ev.slug)}/${encodeURIComponent(ev.files[0])}" alt="">`;
    return `<a class="album" href="${BASE}/galerie/${encodeURIComponent(ev.slug)}">${cover}
<div class="ai"><b>${esc(ev.title)}</b><span>${ev.files.length} Fotos${locked ? ' · Code nötig' : ''}</span></div></a>`;
  }).join('');
  return page('Galerien', `
<h1>Hallo ${esc((user.name || '').split(' ')[0] || 'du')}! <em>Deine Galerien</em></h1>
<p class="sub">Wähle eine Veranstaltung aus.</p>
${events.length ? `<div class="albums">${items}</div>` : `<p class="sub">Im Moment sind noch keine Fotos online — schau später nochmal vorbei!</p>`}`, user);
}
function galleryPage(user, ev) {
  const tiles = ev.files.map((f, i) => `
<div class="ph" data-f="${esc(f)}" data-i="${i}">
<img loading="lazy" src="${BASE}/thumb/${encodeURIComponent(ev.slug)}/${encodeURIComponent(f)}" alt="">
<div class="tick">✓</div></div>`).join('');
  return page(ev.title, `
<p style="margin:0 0 4px"><a href="${BASE}/galerie">&larr; Alle Galerien</a></p>
<h1>${esc(ev.title)} <em>· ${ev.files.length} Fotos</em></h1>
<p class="sub">Zum Vergrößern tippen, mit dem Haken auswählen — unten als ZIP herunterladen.</p>
<div class="grid" id="grid">${tiles}</div>
<div class="bar">
  <span class="cnt"><em id="n">0</em> ausgewählt</span>
  <button class="btn ghost" id="all" type="button">Alle auswählen</button>
  <button class="btn" id="dl" type="button" disabled>⬇ Auswahl herunterladen</button>
</div>
<dialog id="lb"><img id="lbi" alt="">
<div class="db">
  <button class="btn ghost" id="lbPrev" type="button">&larr;</button>
  <button class="btn" id="lbSel" type="button">Auswählen</button>
  <a class="btn ghost" id="lbDl" href="#" download>Einzeln laden</a>
  <button class="btn ghost" id="lbNext" type="button">&rarr;</button>
  <button class="btn ghost" id="lbX" type="button">Schließen</button>
</div></dialog>
<form id="zf" method="post" action="${BASE}/galerie/${encodeURIComponent(ev.slug)}/zip" style="display:none"></form>
<script>
const EV=${JSON.stringify(ev.slug)},FILES=${JSON.stringify(ev.files)},BASE=${JSON.stringify(BASE)};
const sel=new Set();let cur=0;
const grid=document.getElementById('grid'),n=document.getElementById('n'),dl=document.getElementById('dl');
const lb=document.getElementById('lb'),lbi=document.getElementById('lbi'),lbSel=document.getElementById('lbSel'),lbDl=document.getElementById('lbDl');
function upd(){n.textContent=sel.size;dl.disabled=!sel.size;
 for(const el of grid.children)el.classList.toggle('sel',sel.has(el.dataset.f));
 document.getElementById('all').textContent=sel.size===FILES.length?'Auswahl aufheben':'Alle auswählen';}
function toggle(f){sel.has(f)?sel.delete(f):sel.add(f);upd();}
grid.addEventListener('click',e=>{const ph=e.target.closest('.ph');if(!ph)return;
 if(e.target.closest('.tick')){toggle(ph.dataset.f);}else{show(+ph.dataset.i);}});
function show(i){cur=(i+FILES.length)%FILES.length;const f=FILES[cur];
 lbi.src=BASE+'/foto/'+encodeURIComponent(EV)+'/'+encodeURIComponent(f);
 lbDl.href=lbi.src+'?dl=1';lbSel.textContent=sel.has(f)?'✓ Ausgewählt':'Auswählen';
 if(!lb.open)lb.showModal();}
lbSel.onclick=()=>{toggle(FILES[cur]);lbSel.textContent=sel.has(FILES[cur])?'✓ Ausgewählt':'Auswählen';};
document.getElementById('lbPrev').onclick=()=>show(cur-1);
document.getElementById('lbNext').onclick=()=>show(cur+1);
document.getElementById('lbX').onclick=()=>lb.close();
lb.addEventListener('click',e=>{if(e.target===lb)lb.close();});
document.addEventListener('keydown',e=>{if(!lb.open)return;if(e.key==='ArrowLeft')show(cur-1);if(e.key==='ArrowRight')show(cur+1);});
document.getElementById('all').onclick=()=>{if(sel.size===FILES.length)sel.clear();else FILES.forEach(f=>sel.add(f));upd();};
dl.onclick=()=>{const zf=document.getElementById('zf');zf.innerHTML='';
 for(const f of sel){const i=document.createElement('input');i.type='hidden';i.name='f';i.value=f;zf.appendChild(i);}
 zf.submit();};
upd();
</script>`, user);
}

function bookingPage(user, opts) {
  opts = opts || {};
  const pkgs = Object.entries(PACKAGES).map(([id, p], i) => `
<label><input type="radio" name="pkg" value="${id}" ${i === 0 ? 'checked' : ''} required>
${esc(p.label)}<span class="pr">${p.price} € / Tag</span></label>`).join('');
  return page('Fotobox buchen', `
<h1>Fotobox <em>buchen</em></h1>
<p class="sub">Wähle im Kalender deinen Wunschtag — rot markierte Tage sind bereits vergeben.</p>
${opts.ok ? `<p class="ok">Deine Anfrage für den <b>${esc(opts.ok)}</b> ist eingegangen! Wir melden uns schnellstmöglich per E-Mail bei dir.</p>` : ''}
${opts.err ? `<p class="err">${esc(opts.err)}</p>` : ''}
<div class="bwrap">
<div class="cal">
  <div class="ch"><button type="button" id="pv">&lsaquo;</button><b id="mt"></b><button type="button" id="nx">&rsaquo;</button></div>
  <div class="cgrid" id="cg"></div>
  <div class="legend">
    <span><i style="background:var(--card2)"></i>frei</span>
    <span><i style="background:rgba(239,68,68,.6)"></i>belegt</span>
    <span><i style="background:var(--acc)"></i>dein Wunschtag</span>
  </div>
</div>
<form class="card" style="margin:0;max-width:none" method="post" action="${BASE}/buchen">
  <label>Wunschtag</label>
  <input type="text" id="dsel" value="" placeholder="Tag im Kalender antippen" readonly>
  <input type="hidden" name="date" id="dhid" required>
  <label>Paket</label>
  <div class="pkg">${pkgs}</div>
  <label>Name</label><input type="text" name="name" required maxlength="80" autocomplete="name">
  <label>E-Mail-Adresse</label><input type="email" name="email" required maxlength="120" autocomplete="email">
  <label>Telefon (optional)</label><input type="text" name="phone" maxlength="40" autocomplete="tel">
  <label>Anlass / Nachricht (optional)</label><textarea name="msg" maxlength="500" placeholder="z. B. Geburtstag, Hochzeit, Sommerfest …"></textarea>
  <div style="height:14px"></div>
  <button class="btn" type="submit" id="go" disabled>Unverbindlich anfragen</button>
</form>
</div>
<script>
const BOOKED=${JSON.stringify(bookedDates())};
const MN=['Januar','Februar','M\\u00e4rz','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const today=new Date();today.setHours(0,0,0,0);
let y=today.getFullYear(),m=today.getMonth(),sel='';
const cg=document.getElementById('cg'),mt=document.getElementById('mt'),pv=document.getElementById('pv');
function pad(n){return String(n).padStart(2,'0')}
function render(){
 mt.textContent=MN[m]+' '+y;
 pv.disabled=(y===today.getFullYear()&&m===today.getMonth());
 let h=['Mo','Di','Mi','Do','Fr','Sa','So'].map(d=>'<div class="dh">'+d+'</div>').join('');
 const off=(new Date(y,m,1).getDay()+6)%7;
 h+='<div></div>'.repeat(off);
 const days=new Date(y,m+1,0).getDate();
 for(let d=1;d<=days;d++){
  const ds=y+'-'+pad(m+1)+'-'+pad(d);
  let c='day';
  if(new Date(y,m,d)<today)c+=' past';
  else if(BOOKED.includes(ds))c+=' bk';
  else c+=' free';
  if(ds===sel)c+=' sel';
  h+='<div class="'+c+'" data-d="'+ds+'">'+d+'</div>';
 }
 cg.innerHTML=h;
}
cg.addEventListener('click',e=>{
 const el=e.target.closest('.day.free,.day.sel');if(!el)return;
 sel=el.dataset.d;
 document.getElementById('dhid').value=sel;
 const[yy,mm,dd]=sel.split('-');
 const wd=['So','Mo','Di','Mi','Do','Fr','Sa'][new Date(+yy,mm-1,+dd).getDay()];
 document.getElementById('dsel').value=wd+', '+dd+'.'+mm+'.'+yy;
 document.getElementById('go').disabled=false;
 render();
});
pv.onclick=()=>{if(--m<0){m=11;y--}render()};
document.getElementById('nx').onclick=()=>{if(++m>11){m=0;y++}render()};
render();
</script>`, user);
}

function adminLoginPage(err) {
  return page('Admin', `
<div class="card">
<h1>Admin<em>-Bereich</em></h1>
<p class="sub">Bitte gib deinen Admin-Schlüssel ein (steht als <code>adminKey</code> in der config.json auf dem Server).</p>
${err ? '<p class="err">Falscher Schlüssel.</p>' : ''}
<form method="post" action="${BASE}/admin/login">
<label>Admin-Schlüssel</label><input type="password" name="key" required autocomplete="current-password">
<div style="height:14px"></div><button class="btn" type="submit">Anmelden</button>
</form></div>`);
}

function adminGalleryPage(ev) {
  const tiles = ev.files.map(f => `
<div class="ph" style="cursor:default">
<img loading="lazy" src="${BASE}/thumb/${encodeURIComponent(ev.slug)}/${encodeURIComponent(f)}" alt="">
<form method="post" action="${BASE}/admin/photo" onsubmit="return confirm('${esc(f)} löschen?')">
<input type="hidden" name="event" value="${esc(ev.slug)}"><input type="hidden" name="file" value="${esc(f)}">
<button class="del" title="Löschen">×</button></form>
<div class="fn">${esc(f)}</div></div>`).join('');
  return page('Galerie verwalten', `
<p style="margin:0 0 4px"><a href="${BASE}/admin#galerien">&larr; Admin-Übersicht</a></p>
<h1>${esc(ev.title)} <em>· ${ev.files.length} Fotos</em></h1>
<p class="sub">Ordner <code>photos/${esc(ev.slug)}/</code> · Zugangscode: ${ev.code ? `<b style="color:var(--acc)">${esc(ev.code)}</b>` : '<b style="color:#fca5a5">keiner — jeder Registrierte sieht die Galerie!</b>'}
· <a href="${BASE}/galerie/${encodeURIComponent(ev.slug)}" target="_blank">Galerie ansehen</a></p>
<div class="card" style="max-width:none;margin:0 0 22px" id="dz">
<label style="margin-top:0">Fotos hochladen (JPG/PNG/WebP — auch mehrere auf einmal, oder einfach hier reinziehen)</label>
<input type="file" id="up" multiple accept=".jpg,.jpeg,.png,.webp,image/*" style="color:var(--mut)">
<div id="ust" class="sub" style="margin:10px 0 0"></div>
</div>
<div class="grid">${tiles}</div>
<form method="post" action="${BASE}/admin/gallery-delete" style="margin-top:30px"
 onsubmit="return confirm('Galerie „${esc(ev.title)}“ mit allen ${ev.files.length} Fotos endgültig löschen?')">
<input type="hidden" name="event" value="${esc(ev.slug)}">
<button class="btn ghost" style="width:auto;padding:10px 18px;font-size:14px;color:#fca5a5">Galerie komplett löschen</button></form>
<script>
const EV=${JSON.stringify(ev.slug)},BASE=${JSON.stringify(BASE)};
const up=document.getElementById('up'),st=document.getElementById('ust'),dz=document.getElementById('dz');
async function send(files){
 const fl=[...files].filter(f=>/\\.(jpe?g|png|webp)$/i.test(f.name));
 if(!fl.length)return;
 let ok=0,err=0;
 for(const f of fl){
  st.textContent='Lade hoch '+(ok+err+1)+'/'+fl.length+' — '+f.name;
  try{
   const r=await fetch(BASE+'/admin/upload?event='+encodeURIComponent(EV)+'&name='+encodeURIComponent(f.name),{method:'POST',body:f});
   r.ok?ok++:err++;
  }catch(e){err++;}
 }
 st.textContent='Fertig: '+ok+' hochgeladen'+(err?' — '+err+' fehlgeschlagen!':'')+' … Seite wird aktualisiert';
 setTimeout(()=>location.reload(),900);
}
up.onchange=()=>send(up.files);
dz.addEventListener('dragover',e=>{e.preventDefault();dz.style.borderColor='var(--acc)';});
dz.addEventListener('dragleave',()=>dz.style.borderColor='');
dz.addEventListener('drop',e=>{e.preventDefault();dz.style.borderColor='';send(e.dataTransfer.files);});
</script>`);
}

// --- Google OAuth ------------------------------------------------------------
function googleRedirect(res, next) {
  const p = querystring.stringify({
    client_id: CFG.googleClientId,
    redirect_uri: CFG.publicUrl + '/auth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state: next || '',
    prompt: 'select_account',
  });
  res.writeHead(302, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + p });
  res.end();
}
function googleCallback(req, res, q) {
  const body = querystring.stringify({
    code: q.code,
    client_id: CFG.googleClientId,
    client_secret: CFG.googleClientSecret,
    redirect_uri: CFG.publicUrl + '/auth/google/callback',
    grant_type: 'authorization_code',
  });
  const rq = https.request('https://oauth2.googleapis.com/token',
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, rs => {
      let d = '';
      rs.on('data', c => d += c);
      rs.on('end', () => {
        try {
          const tok = JSON.parse(d);
          // id_token kommt direkt von Google über TLS — Payload dekodieren reicht hier
          const claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf8'));
          if (!claims.email) throw new Error('no email');
          const u = upsertUser(claims.email, claims.name || '', false, 'google');
          setSession(res, { e: u.email, n: u.name, u: [], a: (sess && sess.a) || undefined });
          res.writeHead(302, { Location: BASE + (q.state || '/galerie') });
          res.end();
        } catch (e) {
          res.writeHead(302, { Location: BASE + '/?err=google' });
          res.end();
        }
      });
    });
  rq.on('error', () => { res.writeHead(302, { Location: BASE + '/?err=google' }); res.end(); });
  rq.end(body);
}

// --- Thumbnails (ffmpeg, Cache auf Platte) ------------------------------------
const thumbJobs = new Map();
function thumbnail(slug, file, cb) {
  const src = safePhotoPath(slug, file);
  if (!src) return cb(new Error('notfound'));
  const dst = path.join(CACHE_DIR, slug, file.replace(/\.\w+$/, '') + '.jpg');
  if (fs.existsSync(dst)) return cb(null, dst);
  const key = slug + '/' + file;
  if (thumbJobs.has(key)) { thumbJobs.get(key).push(cb); return; }
  thumbJobs.set(key, [cb]);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=520:-2', '-q:v', '6', dst]);
  p.on('close', code => {
    const cbs = thumbJobs.get(key) || [];
    thumbJobs.delete(key);
    for (const f of cbs) f(code === 0 ? null : new Error('ffmpeg ' + code), dst);
  });
}

// --- Helfer -------------------------------------------------------------------
function sendFile(res, file, mime, downloadName) {
  fs.stat(file, (err, st) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    const h = { 'Content-Type': mime, 'Content-Length': st.size, 'Cache-Control': 'private, max-age=86400' };
    if (downloadName) h['Content-Disposition'] = `attachment; filename="${downloadName.replace(/[^\w. -]/g, '_')}"`;
    res.writeHead(200, h);
    fs.createReadStream(file).pipe(res);
  });
}
function readBody(req, cb) {
  let d = '';
  req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
  req.on('end', () => cb(querystring.parse(d)));
}
function redirect(res, loc) { res.writeHead(302, { Location: loc }); res.end(); }
function html(res, s, status) { res.writeHead(status || 200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(s); }

// --- Server -------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length) || '/';
  const q = Object.fromEntries(u.searchParams);
  const sess = readSession(req);
  const user = sess && sess.e ? { email: sess.e, name: sess.n || '' } : null;
  const isAdmin = (sess && sess.a === true) || q.key === CFG.adminKey;
  const unlocked = (sess && sess.u) || [];

  // -- öffentlich --
  if (p === '/logo.svg') return sendFile(res, path.join(ROOT, 'logo.svg'), 'image/svg+xml');
  if (p === '/datenschutz') return html(res, page('Datenschutz', `
<h1>Datenschutz</h1>
<p class="sub" style="max-width:640px">Wir speichern deinen Namen und deine E-Mail-Adresse, um dir Zugang zu den Fotos deiner Veranstaltung zu geben.
Wenn du eingewilligt hast, informieren wir dich per E-Mail über Angebote von ${esc(CFG.brand)}; diese Einwilligung kannst du jederzeit per Antwort-Mail widerrufen.
Die Fotos sind nur für Gäste der jeweiligen Veranstaltung bestimmt und werden nicht öffentlich gelistet.
Verantwortlich: ${esc(CFG.brand)} · Kontakt: siehe Impressum der Hauptseite.</p>`, user));
  if (p === '/' ) {
    if (user) return redirect(res, BASE + '/galerie');
    return html(res, loginPage(q.err === 'google' ? 'Google-Anmeldung fehlgeschlagen — versuch es nochmal oder nutze das Formular.' : null, q.next));
  }
  if (p === '/register' && req.method === 'POST') {
    return readBody(req, b => {
      const email = String(b.email || '').trim();
      const name = String(b.name || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return html(res, loginPage('Bitte gib eine gültige E-Mail-Adresse ein.', b.next), 400);
      const usr = upsertUser(email, name, b.consent === '1', 'email');
      setSession(res, { e: usr.email, n: usr.name, u: [], a: (sess && sess.a) || undefined });
      redirect(res, BASE + (String(b.next || '') || '/galerie'));
    });
  }
  if (p === '/buchen' && req.method === 'GET') {
    return html(res, bookingPage(user, { ok: q.ok, err: q.err === 'belegt' ? 'Dieser Tag ist leider schon vergeben — such dir bitte einen anderen aus.' : (q.err ? 'Bitte fülle alle Pflichtfelder aus.' : null) }));
  }
  if (p === '/buchen' && req.method === 'POST') {
    return readBody(req, b => {
      const date = String(b.date || '');
      const pkg = PACKAGES[b.pkg];
      const name = String(b.name || '').trim();
      const email = String(b.email || '').trim().toLowerCase();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !pkg || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
        return redirect(res, BASE + '/buchen?err=1');
      if (date < todayStr() || bookedDates().includes(date))
        return redirect(res, BASE + '/buchen?err=belegt');
      bookings.push({
        id: crypto.randomBytes(6).toString('hex'), date, pkg: b.pkg, price: pkg.price,
        name, email, phone: String(b.phone || '').trim().slice(0, 40),
        msg: String(b.msg || '').trim().slice(0, 500),
        status: 'angefragt', createdAt: new Date().toISOString(),
      });
      saveBookings();
      const [yy, mm, dd] = date.split('-');
      redirect(res, BASE + '/buchen?ok=' + encodeURIComponent(`${dd}.${mm}.${yy}`));
    });
  }
  if (p === '/auth/google') {
    if (!CFG.googleClientId) return redirect(res, BASE + '/');
    return googleRedirect(res, q.next);
  }
  if (p === '/auth/google/callback') return googleCallback(req, res, q);
  if (p === '/logout') {
    res.setHeader('Set-Cookie', `fbx=; Path=${BASE || '/'}; Max-Age=0`);
    return redirect(res, BASE + '/');
  }

  // -- Admin --
  let m;
  if (p === '/admin/login' && req.method === 'POST') {
    return readBody(req, b => {
      if (String(b.key || '') === CFG.adminKey) {
        setSession(res, Object.assign({}, sess || {}, { a: true }));
        redirect(res, BASE + '/admin');
      } else html(res, adminLoginPage(true), 403);
    });
  }
  if (p === '/admin' && !isAdmin) return html(res, adminLoginPage(false));
  if (p.startsWith('/admin') && !isAdmin) { res.writeHead(403); return res.end('403'); }
  // Schluessel aus der URL in den Cookie uebernehmen, damit Folge-Seiten ohne ?key= laufen
  if (q.key === CFG.adminKey && !(sess && sess.a)) setSession(res, Object.assign({}, sess || {}, { a: true }));
  if (p === '/admin/gallery' && req.method === 'POST') {
    return readBody(req, b => {
      let slug = slugify(b.title || '');
      if (!slug) return redirect(res, BASE + '/admin#galerien');
      while (fs.existsSync(path.join(PHOTOS_DIR, slug))) slug += '-2';
      fs.mkdirSync(path.join(PHOTOS_DIR, slug), { recursive: true });
      fs.writeFileSync(path.join(PHOTOS_DIR, slug, 'event.json'),
        JSON.stringify({ title: String(b.title).trim(), code: String(b.code || '').trim() || undefined }, null, 1));
      redirect(res, BASE + '/admin/galerie/' + encodeURIComponent(slug));
    });
  }
  if (p === '/admin/upload' && req.method === 'POST') {
    const ev = getEvent(String(q.event || ''), true);
    const name = path.basename(String(q.name || '')).replace(/[^\w.\- ()]/g, '_');
    if (!ev || !IMG_EXT.has(path.extname(name).toLowerCase())) { res.writeHead(400); return res.end('{"ok":false}'); }
    const dst = path.join(PHOTOS_DIR, ev.slug, name);
    const ws = fs.createWriteStream(dst);
    let size = 0, aborted = false;
    req.on('data', c => { size += c.length; if (size > 60e6 && !aborted) { aborted = true; req.destroy(); ws.destroy(); fs.unlink(dst, () => {}); } });
    req.pipe(ws);
    ws.on('finish', () => {
      // evtl. veralteten Thumbnail-Cache für diesen Namen wegräumen
      fs.unlink(path.join(CACHE_DIR, ev.slug, name.replace(/\.\w+$/, '') + '.jpg'), () => {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    ws.on('error', () => { res.writeHead(500); res.end('{"ok":false}'); });
    return;
  }
  if (p === '/admin/photo' && req.method === 'POST') {
    return readBody(req, b => {
      const f = safePhotoPath(String(b.event || ''), String(b.file || ''));
      if (f) {
        fs.unlinkSync(f);
        fs.unlink(path.join(CACHE_DIR, String(b.event), String(b.file).replace(/\.\w+$/, '') + '.jpg'), () => {});
      }
      redirect(res, BASE + '/admin/galerie/' + encodeURIComponent(String(b.event)));
    });
  }
  if (p === '/admin/gallery-delete' && req.method === 'POST') {
    return readBody(req, b => {
      const ev = getEvent(String(b.event || ''), true);
      if (ev) {
        fs.rmSync(path.join(PHOTOS_DIR, ev.slug), { recursive: true, force: true });
        fs.rmSync(path.join(CACHE_DIR, ev.slug), { recursive: true, force: true });
      }
      redirect(res, BASE + '/admin#galerien');
    });
  }
  if ((m = /^\/admin\/galerie\/([^\/]+)$/.exec(p))) {
    const ev = getEvent(m[1], true);
    if (!ev) { res.writeHead(404); return res.end('404'); }
    return html(res, adminGalleryPage(ev));
  }
  if (p === '/admin/booking' && req.method === 'POST') {
    return readBody(req, b => {
      const i = bookings.findIndex(x => x.id === b.id);
      if (i >= 0) {
        if (b.action === 'confirm') bookings[i].status = 'bestätigt';
        if (b.action === 'delete') bookings.splice(i, 1);
        saveBookings();
      }
      redirect(res, BASE + '/admin#buchungen');
    });
  }
  if (p === '/admin' || p === '/admin.csv') {
    if (p === '/admin.csv') {
      const csv = 'email;name;werbung_ok;einwilligung_am;registriert_am;via\n' + users.map(x =>
        [x.email, x.name, x.consent ? 'ja' : 'nein', x.consentAt || '', x.createdAt, x.via].map(v => String(v).replace(/;/g, ',')).join(';')).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="fotobox-kontakte.csv"' });
      return res.end('﻿' + csv);
    }
    let dls = 0;
    try { dls = fs.readFileSync(DL_LOG, 'utf8').trim().split('\n').filter(Boolean).length; } catch (e) {}
    const rows = users.slice().reverse().map(x => `<tr><td>${esc(x.email)}</td><td>${esc(x.name)}</td>
<td>${x.consent ? '<span class="pill y">Werbung ok</span>' : '<span class="pill n">keine Einwilligung</span>'}</td>
<td>${esc((x.createdAt || '').slice(0, 10))}</td><td>${esc(x.via || '')}</td></tr>`).join('');
    const brows = bookings.slice().sort((a, b) => a.date < b.date ? -1 : 1).map(x => {
      const [yy, mm, dd] = x.date.split('-');
      return `<tr><td><b>${dd}.${mm}.${yy}</b></td><td>${esc(PACKAGES[x.pkg] ? PACKAGES[x.pkg].label : x.pkg)}<br><span style="color:var(--acc);font-weight:700">${x.price} €</span></td>
<td>${esc(x.name)}<br><a href="mailto:${esc(x.email)}">${esc(x.email)}</a>${x.phone ? '<br>' + esc(x.phone) : ''}</td>
<td>${esc(x.msg || '')}</td>
<td>${x.status === 'bestätigt' ? '<span class="pill g">bestätigt</span>' : '<span class="pill y">angefragt</span>'}</td>
<td style="white-space:nowrap">
<form method="post" action="${BASE}/admin/booking" style="display:inline"><input type="hidden" name="id" value="${x.id}"><input type="hidden" name="action" value="confirm"><button class="btn" style="width:auto;padding:7px 12px;font-size:12.5px" ${x.status === 'bestätigt' ? 'disabled' : ''}>Bestätigen</button></form>
<form method="post" action="${BASE}/admin/booking" style="display:inline" onsubmit="return confirm('Buchung ${dd}.${mm}.${yy} wirklich stornieren? Der Tag wird wieder frei.')"><input type="hidden" name="id" value="${x.id}"><input type="hidden" name="action" value="delete"><button class="btn ghost" style="width:auto;padding:7px 12px;font-size:12.5px">Stornieren</button></form>
</td></tr>`;
    }).join('');
    const grows = listEvents(true).map(ev => `<tr>
<td><b>${esc(ev.title)}</b><br><span style="color:var(--mut);font-size:12px">photos/${esc(ev.slug)}/</span></td>
<td>${ev.files.length} Fotos</td>
<td>${ev.code ? `<code>${esc(ev.code)}</code>` : '<span class="pill n">ohne Code</span>'}</td>
<td style="white-space:nowrap"><a class="btn" style="display:inline-flex;width:auto;padding:7px 14px;font-size:12.5px" href="${BASE}/admin/galerie/${encodeURIComponent(ev.slug)}">Verwalten &amp; Hochladen</a>
<a class="btn ghost" style="display:inline-flex;width:auto;padding:7px 14px;font-size:12.5px" href="${BASE}/galerie/${encodeURIComponent(ev.slug)}" target="_blank">Ansehen</a></td></tr>`).join('');
    return html(res, page('Admin', `
<h1 id="galerien">Galerien <em>· ${listEvents(true).length}</em></h1>
<p class="sub">Jede Galerie = ein Ordner unter <code>photos/</code>. Zugangscode mit auf die Fotobox-Karte drucken.</p>
<div style="overflow-x:auto"><table><tr><th>Galerie</th><th>Fotos</th><th>Code</th><th></th></tr>${grows}</table></div>
<form method="post" action="${BASE}/admin/gallery" class="card" style="margin:18px 0 0;max-width:none;display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;padding:18px">
<div style="flex:2;min-width:200px"><label style="margin-top:0">Neue Galerie — Titel</label><input type="text" name="title" required maxlength="80" placeholder="z. B. Kita-Sommerfest 2026"></div>
<div style="flex:1;min-width:130px"><label style="margin-top:0">Zugangscode (empfohlen)</label><input type="text" name="code" maxlength="20" placeholder="z. B. 7777"></div>
<button class="btn" style="width:auto;padding:12px 20px;font-size:14px">Anlegen</button></form>
<h1 style="margin-top:40px">Registrierungen <em>· ${users.length}</em></h1>
<p class="sub">${users.filter(x => x.consent).length} mit Werbe-Einwilligung · ${dls} ZIP-Downloads ·
<a href="${BASE}/admin.csv">CSV herunterladen</a></p>
<div style="overflow-x:auto"><table><tr><th>E-Mail</th><th>Name</th><th>Werbung</th><th>Datum</th><th>Via</th></tr>${rows}</table></div>
<h1 id="buchungen" style="margin-top:40px">Buchungen <em>· ${bookings.length}</em></h1>
<p class="sub">Angefragte und bestätigte Tage sind im Kalender rot markiert. Stornieren gibt den Tag wieder frei.</p>
<div style="overflow-x:auto"><table><tr><th>Datum</th><th>Paket</th><th>Kontakt</th><th>Nachricht</th><th>Status</th><th></th></tr>${brows}</table></div>`));
  }

  // -- ab hier: Anmeldung nötig (Admin-Key zählt auch) --
  const viewer = user || (isAdmin ? { email: 'admin', name: 'Admin' } : null);
  if (!viewer) return redirect(res, BASE + '/?next=' + encodeURIComponent(p));

  if (p === '/galerie') return html(res, albumsPage(viewer, listEvents(), unlocked));

  if ((m = /^\/galerie\/([^\/]+)$/.exec(p))) {
    const ev = getEvent(m[1]);
    if (!ev) { res.writeHead(404); return res.end('404'); }
    if (ev.code && !unlocked.includes(ev.slug) && !isAdmin) return html(res, codePage(ev));
    return html(res, galleryPage(viewer, ev));
  }
  if ((m = /^\/galerie\/([^\/]+)\/code$/.exec(p)) && req.method === 'POST') {
    const ev = getEvent(m[1]);
    if (!ev) { res.writeHead(404); return res.end('404'); }
    return readBody(req, b => {
      if (String(b.code || '').trim() !== String(ev.code)) return html(res, codePage(ev, 'Falscher Code — probier es nochmal.'), 403);
      setSession(res, { e: viewer.email, n: viewer.name, u: [...new Set([...unlocked, ev.slug])], a: (sess && sess.a) || undefined });
      redirect(res, BASE + '/galerie/' + encodeURIComponent(ev.slug));
    });
  }
  // Zugriff auf Bilder nur, wenn Galerie offen (kein Code) oder freigeschaltet
  function allowed(ev) { return ev && (!ev.code || unlocked.includes(ev.slug) || isAdmin); }

  if ((m = /^\/thumb\/([^\/]+)\/([^\/]+)$/.exec(p))) {
    const ev = getEvent(m[1]);
    if (!allowed(ev)) { res.writeHead(403); return res.end('403'); }
    return thumbnail(m[1], m[2], (err, f) => err ? (res.writeHead(404), res.end('404')) : sendFile(res, f, 'image/jpeg'));
  }
  if ((m = /^\/foto\/([^\/]+)\/([^\/]+)$/.exec(p))) {
    const ev = getEvent(m[1]);
    if (!allowed(ev)) { res.writeHead(403); return res.end('403'); }
    const f = safePhotoPath(m[1], m[2]);
    if (!f) { res.writeHead(404); return res.end('404'); }
    const mime = { '.png': 'image/png', '.webp': 'image/webp' }[path.extname(f).toLowerCase()] || 'image/jpeg';
    return sendFile(res, f, mime, q.dl ? m[2] : null);
  }
  if ((m = /^\/galerie\/([^\/]+)\/zip$/.exec(p)) && req.method === 'POST') {
    const ev = getEvent(m[1]);
    if (!allowed(ev)) { res.writeHead(403); return res.end('403'); }
    return readBody(req, b => {
      let files = b.f ? (Array.isArray(b.f) ? b.f : [b.f]) : [];
      files = [...new Set(files)].filter(f => ev.files.includes(f)).slice(0, CFG.maxZipFiles || 200);
      if (!files.length) return redirect(res, BASE + '/galerie/' + encodeURIComponent(ev.slug));
      const tmp = path.join(CACHE_DIR, 'zip-' + crypto.randomBytes(8).toString('hex') + '.zip');
      const z = spawn('zip', ['-q', '-j', '-0', tmp, ...files.map(f => path.join(PHOTOS_DIR, ev.slug, f))]);
      z.on('close', code => {
        if (code !== 0) { res.writeHead(500); return res.end('ZIP-Fehler'); }
        fs.appendFile(DL_LOG, JSON.stringify({ email: viewer.email, event: ev.slug, files: files.length, at: new Date().toISOString() }) + '\n', () => {});
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Length': fs.statSync(tmp).size,
          'Content-Disposition': `attachment; filename="fotobox-${ev.slug.replace(/[^\w-]/g, '_')}.zip"`,
        });
        const s = fs.createReadStream(tmp);
        s.pipe(res);
        s.on('close', () => fs.unlink(tmp, () => {}));
      });
    });
  }

  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page('404', '<h1>Seite nicht gefunden</h1><p class="sub"><a href="' + BASE + '/galerie">Zur Übersicht</a></p>', user));
});
server.listen(PORT, '127.0.0.1', () => console.log(`Fotobox-Portal auf http://127.0.0.1:${PORT}${BASE || ''}/`));
