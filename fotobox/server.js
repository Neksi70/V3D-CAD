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
const DL_LOG = path.join(DATA_DIR, 'downloads.jsonl');
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
function listEvents() {
  const out = [];
  for (const name of fs.readdirSync(PHOTOS_DIR)) {
    const dir = path.join(PHOTOS_DIR, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'event.json'), 'utf8')); } catch (e) {}
    const files = fs.readdirSync(dir).filter(f => IMG_EXT.has(path.extname(f).toLowerCase())).sort();
    if (!files.length) continue;
    out.push({ slug: name, title: meta.title || name.replace(/[-_]+/g, ' '), code: meta.code || null, files });
  }
  out.sort((a, b) => a.slug < b.slug ? 1 : -1); // neueste (Namenskonvention mit Datum) zuerst
  return out;
}
function getEvent(slug) {
  if (!/^[\w][\w .\-]*$/.test(slug)) return null;
  return listEvents().find(e => e.slug === slug) || null;
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
input[type=text],input[type=email]{width:100%;font-family:var(--font);font-size:16px;color:var(--text);background:var(--card2);border:1.5px solid var(--border);border-radius:12px;padding:12px 14px;outline:none}
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
<footer>${esc(CFG.brand)} · Die Fotos sind nur für registrierte Gäste der jeweiligen Veranstaltung bestimmt. · <a href="${BASE}/datenschutz">Datenschutz</a></footer>
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
</div>`);
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
          setSession(res, { e: u.email, n: u.name, u: [] });
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
      setSession(res, { e: usr.email, n: usr.name, u: [] });
      redirect(res, BASE + (String(b.next || '') || '/galerie'));
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
  if (p === '/admin' || p === '/admin.csv') {
    if (q.key !== CFG.adminKey) { res.writeHead(403); return res.end('403'); }
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
    return html(res, page('Admin', `
<h1>Registrierungen <em>· ${users.length}</em></h1>
<p class="sub">${users.filter(x => x.consent).length} mit Werbe-Einwilligung · ${dls} ZIP-Downloads ·
<a href="${BASE}/admin.csv?key=${encodeURIComponent(q.key)}">CSV herunterladen</a></p>
<div style="overflow-x:auto"><table><tr><th>E-Mail</th><th>Name</th><th>Werbung</th><th>Datum</th><th>Via</th></tr>${rows}</table></div>`));
  }

  // -- ab hier: Anmeldung nötig --
  if (!user) return redirect(res, BASE + '/?next=' + encodeURIComponent(p));

  if (p === '/galerie') return html(res, albumsPage(user, listEvents(), unlocked));

  let m;
  if ((m = /^\/galerie\/([^\/]+)$/.exec(p))) {
    const ev = getEvent(m[1]);
    if (!ev) { res.writeHead(404); return res.end('404'); }
    if (ev.code && !unlocked.includes(ev.slug)) return html(res, codePage(ev));
    return html(res, galleryPage(user, ev));
  }
  if ((m = /^\/galerie\/([^\/]+)\/code$/.exec(p)) && req.method === 'POST') {
    const ev = getEvent(m[1]);
    if (!ev) { res.writeHead(404); return res.end('404'); }
    return readBody(req, b => {
      if (String(b.code || '').trim() !== String(ev.code)) return html(res, codePage(ev, 'Falscher Code — probier es nochmal.'), 403);
      setSession(res, { e: user.email, n: user.name, u: [...new Set([...unlocked, ev.slug])] });
      redirect(res, BASE + '/galerie/' + encodeURIComponent(ev.slug));
    });
  }
  // Zugriff auf Bilder nur, wenn Galerie offen (kein Code) oder freigeschaltet
  function allowed(ev) { return ev && (!ev.code || unlocked.includes(ev.slug)); }

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
        fs.appendFile(DL_LOG, JSON.stringify({ email: user.email, event: ev.slug, files: files.length, at: new Date().toISOString() }) + '\n', () => {});
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
