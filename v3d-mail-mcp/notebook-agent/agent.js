// V3D Notebook-Agent: nimmt Auftraege vom V3D-Mail-Connector auf V3DA an
// (download, befehl, starten, dateien, winget). Nur Node-Standardbibliothek.
//
// Sicherheit: lauscht nur auf der Tailscale-IP, nimmt nur Anfragen von den IPs in
// config.erlaubt an (V3DA) und verlangt "Authorization: Bearer <token>".
// Der Token entsteht beim Einrichten auf dem Notebook; V3DA holt ihn einmalig per
// POST /kopplung ab (nur solange noch nicht gekoppelt und hoechstens 24 h nach dem Einrichten).
//
// Lange Arbeiten (download, winget) laufen als Job weiter, wenn die Antwort-Frist
// (warten, Standard 150 s) ablaeuft: derselbe Aufruf holt spaeter das Ergebnis ab.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');

const VERSION = '1.0';
const WIN = process.platform === 'win32';
const BASIS = process.env.V3D_AGENT_DIR ||
    (WIN ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'V3D') : path.join(os.homedir(), '.v3d-agent'));
const CONFIG = path.join(BASIS, 'agent-config.json');
const LOG = path.join(BASIS, 'agent.log');
const TMP = path.join(BASIS, 'tmp');
const HOME = os.homedir();
const MAX_LOG = 5 * 1024 * 1024;
const MAX_AUSGABE = 20 * 1024;
const MAX_DOWNLOAD = 8 * 1024 ** 3;
const KOPPLUNG_FRIST = 24 * 3600 * 1000;
const STANDARD_WARTEN = 150;

let cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, ''));
fs.mkdirSync(TMP, { recursive: true });
const jobs = new Map();
const info = { version: VERSION, rechner: os.hostname(), benutzer: os.userInfo().username, pid: process.pid,
               start: new Date().toISOString() };

function log(aktion, daten) {
    try {
        try { if (fs.statSync(LOG).size > MAX_LOG) fs.renameSync(LOG, LOG + '.1'); } catch (e) { /* noch keins */ }
        fs.appendFileSync(LOG, new Date().toISOString() + ' ' + aktion + ' ' + JSON.stringify(daten || {}) + '\n');
    } catch (e) { /* Log darf nie den Agenten umwerfen */ }
}

const schlafen = ms => new Promise(r => setTimeout(r, ms));

// --- Ausgabe sammeln: Anfang + Ende behalten, Mitte kuerzen ---------------------
class Sammler {
    constructor(max) { this.kopfMax = Math.floor(max * 0.7); this.schwanzMax = max - this.kopfMax;
                       this.kopf = []; this.kopfN = 0; this.schwanz = Buffer.alloc(0); this.gesamt = 0; }
    add(b) {
        this.gesamt += b.length;
        if (this.kopfN < this.kopfMax) {
            const n = Math.min(b.length, this.kopfMax - this.kopfN);
            this.kopf.push(b.subarray(0, n)); this.kopfN += n; b = b.subarray(n);
        }
        if (b.length) {
            this.schwanz = Buffer.concat([this.schwanz, b]);
            if (this.schwanz.length > this.schwanzMax) this.schwanz = this.schwanz.subarray(this.schwanz.length - this.schwanzMax);
        }
    }
    text() {
        const kopf = Buffer.concat(this.kopf).toString('utf8');
        const weg = this.gesamt - this.kopfN - this.schwanz.length;
        if (weg <= 0) return kopf + this.schwanz.toString('utf8');
        return kopf + '\n[... ' + weg + ' Bytes gekuerzt ...]\n' + this.schwanz.toString('utf8');
    }
}

// --- Prozesse ------------------------------------------------------------------
function ausfuehren(datei, args, { timeout = 120, env, cwd } = {}) {
    return new Promise((fertig) => {
        const start = Date.now();
        const p = spawn(datei, args, { cwd: cwd || HOME, env: Object.assign({}, process.env, env || {}),
                                       windowsHide: true, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
        const aus = new Sammler(MAX_AUSGABE), err = new Sammler(MAX_AUSGABE);
        let abgebrochen = false;
        p.stdout.on('data', b => aus.add(b));
        p.stderr.on('data', b => err.add(b));
        const uhr = setTimeout(() => {
            abgebrochen = true;
            if (WIN) spawn('taskkill', ['/T', '/F', '/PID', String(p.pid)], { windowsHide: true });
            else try { process.kill(-p.pid, 'SIGKILL'); } catch (e) { /* schon weg */ }
        }, timeout * 1000);
        const ende = (code, fehler) => {
            clearTimeout(uhr);
            fertig({ exitcode: code, stdout: aus.text(), stderr: fehler ? String(fehler) : err.text(),
                     dauer_s: Math.round((Date.now() - start) / 100) / 10, abgebrochen,
                     ...(abgebrochen ? { hinweis: 'Zeitlimit ' + timeout + ' s erreicht, Prozess beendet' } : {}) });
        };
        p.on('error', e => ende(null, e.message));
        p.on('close', code => ende(code));
    });
}

function powershell(skript, opts) {
    if (!WIN) return ausfuehren('sh', ['-c', skript], opts);    // nur fuer Tests auf Linux
    const datei = path.join(TMP, 'befehl-' + crypto.randomBytes(6).toString('hex') + '.ps1');
    const vorspann = "$ProgressPreference = 'SilentlyContinue'\r\n" +
                     '[Console]::OutputEncoding = [Text.Encoding]::UTF8\r\n$OutputEncoding = [Text.Encoding]::UTF8\r\n';
    fs.writeFileSync(datei, '\ufeff' + vorspann + skript, 'utf8');
    return ausfuehren('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', datei], opts)
        .finally(() => fs.rm(datei, { force: true }, () => {}));
}

// --- Jobs (download, winget) ---------------------------------------------------
function job(schluessel, fn) {
    let j = jobs.get(schluessel);
    if (!j) {
        j = { start: Date.now(), fertig: false, stand: {} };
        j.promise = fn(j).then(r => { j.ergebnis = r; }, e => { j.fehler = e.message || String(e); })
            .finally(() => { j.fertig = true; j.ende = Date.now(); });
        jobs.set(schluessel, j);
    }
    return j;
}

async function abwarten(schluessel, j, warten) {
    await Promise.race([j.promise, schlafen(Math.max(1, Math.min(warten || STANDARD_WARTEN, 170)) * 1000)]);
    if (!j.fertig) {
        return { status: 'laeuft', seit_s: Math.round((Date.now() - j.start) / 1000), ...j.stand,
                 hinweis: 'Laeuft im Hintergrund weiter. Denselben Aufruf spaeter wiederholen, um das Ergebnis abzuholen.' };
    }
    jobs.delete(schluessel);
    if (j.fehler) throw new Error(j.fehler);
    return { status: 'fertig', ...j.ergebnis };
}

setInterval(() => {     // nie abgeholte Ergebnisse nach 6 h vergessen
    for (const [k, j] of jobs) if (j.fertig && Date.now() - j.ende > 6 * 3600e3) jobs.delete(k);
}, 600e3).unref();

// --- Pfade -----------------------------------------------------------------------
function pfadAuf(p, standard) {
    p = String(p || standard || '').trim();
    if (!p) return HOME;
    if (WIN) p = p.replace(/%([^%]+)%/g, (m, n) => process.env[n] || m);
    if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(HOME, p.slice(1));
    return path.resolve(HOME, p);
}

function freierName(ziel) {
    if (!fs.existsSync(ziel)) return ziel;
    const ext = path.extname(ziel), stamm = ziel.slice(0, ziel.length - ext.length);
    for (let i = 2; ; i++) if (!fs.existsSync(stamm + ' (' + i + ')' + ext)) return stamm + ' (' + i + ')' + ext;
}

function sauber(name) {
    name = String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 150);
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) name = '_' + name;
    return name || 'download';
}

function dateiname(antwort) {
    const cd = antwort.headers.get('content-disposition') || '';
    let m = cd.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i);
    if (m) try { return sauber(decodeURIComponent(m[1].trim().replace(/^"|"$/g, ''))); } catch (e) { /* weiter */ }
    m = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
    if (m) return sauber(m[1]);
    try {
        const teil = new URL(antwort.url).pathname.split('/').filter(Boolean).pop();
        if (teil) return sauber(decodeURIComponent(teil));
    } catch (e) { /* weiter */ }
    return 'download';
}

function auflisten(ordner, max) {
    const liste = [];
    (function lauf(d, rel) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (liste.length >= max) return;
            const r = rel ? rel + '/' + e.name : e.name;
            if (e.isDirectory()) lauf(path.join(d, e.name), r); else liste.push(r);
        }
    })(ordner, '');
    return liste;
}

async function entpacken(zip) {
    const ziel = freierName(zip.replace(/\.zip$/i, '') || zip + '-entpackt');
    fs.mkdirSync(ziel, { recursive: true });
    let r;
    if (WIN) {
        r = await ausfuehren(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'),
                             ['-xf', zip, '-C', ziel], { timeout: 1800 });
        if (r.exitcode !== 0) {
            r = await powershell('Expand-Archive -LiteralPath $env:V3D_ZIP -DestinationPath $env:V3D_ZIEL -Force',
                                 { timeout: 1800, env: { V3D_ZIP: zip, V3D_ZIEL: ziel } });
        }
    } else {
        r = await ausfuehren('python3', ['-I', '-m', 'zipfile', '-e', zip, ziel], { timeout: 1800 });
    }
    if (r.exitcode !== 0) throw new Error('Entpacken gescheitert: ' + (r.stderr || r.stdout).slice(0, 2000));
    const dateien = auflisten(ziel, 5000);
    return { ordner: ziel, anzahl: dateien.length, dateien: dateien.slice(0, 40),
             programme: dateien.filter(d => /\.(exe|msi|bat|cmd)$/i.test(d)).slice(0, 20) };
}

// --- Aktionen -------------------------------------------------------------------
async function laden(url, ordner, mitEntpacken, j) {
    fs.mkdirSync(ordner, { recursive: true });
    const stopp = new AbortController();
    const uhr = setTimeout(() => stopp.abort(), 3 * 3600e3);
    try {
        const r = await fetch(url, { redirect: 'follow', signal: stopp.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) V3D-Notebook-Agent/' + VERSION } })
            .catch(e => { throw new Error('Download gescheitert: ' + ((e.cause && (e.cause.code || e.cause.message)) || e.message)); });
        if (r.headers.get('cf-mitigated') === 'challenge') {
            throw new Error('Die Seite verlangt eine Browser-Pruefung (Cloudflare, HTTP ' + r.status + '). ' +
                            'Datei im Notebook-Browser laden (browser_* ziel=notebook) und mit notebook_befehl weiterarbeiten.');
        }
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText + ' (' + r.url + ')');
        const ziel = freierName(path.join(ordner, dateiname(r)));
        const teil = ziel + '.teil';
        const hash = crypto.createHash('sha256');
        j.stand = { datei: ziel, bytes: 0, gesamt: Number(r.headers.get('content-length')) || null };
        const zaehler = new Transform({ transform(stueck, _, cb) {
            j.stand.bytes += stueck.length;
            if (j.stand.bytes > MAX_DOWNLOAD) return cb(new Error('Datei groesser als 8 GB'));
            hash.update(stueck); cb(null, stueck);
        } });
        try {
            await pipeline(Readable.fromWeb(r.body), zaehler, fs.createWriteStream(teil));
        } catch (e) { fs.rmSync(teil, { force: true }); throw e; }
        fs.renameSync(teil, ziel);
        const erg = { pfad: ziel, groesse: j.stand.bytes, sha256: hash.digest('hex'), url_final: r.url,
                      typ: r.headers.get('content-type') || null };
        log('download_fertig', { pfad: ziel, groesse: erg.groesse, sha256: erg.sha256 });
        if (mitEntpacken) {
            const kopf = Buffer.alloc(4); const fd = fs.openSync(ziel, 'r'); fs.readSync(fd, kopf, 0, 4, 0); fs.closeSync(fd);
            if (kopf.toString('latin1', 0, 2) !== 'PK') erg.entpackt = { fehler: 'keine ZIP-Datei, nicht entpackt' };
            else { j.stand.schritt = 'entpacken'; erg.entpackt = await entpacken(ziel); log('entpackt', { ordner: erg.entpackt.ordner, anzahl: erg.entpackt.anzahl }); }
        }
        return erg;
    } finally { clearTimeout(uhr); }
}

async function download(p) {
    let u;
    try { u = new URL(String(p.url || '')); } catch (e) { throw new Error('Ungueltige URL'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Nur http/https');
    const ordner = pfadAuf(p.ordner, 'Downloads');
    const schluessel = 'download|' + u.href + '|' + ordner + '|' + !!p.entpacken;
    if (!jobs.has(schluessel)) log('download', { url: u.href, ordner, entpacken: !!p.entpacken });
    return abwarten(schluessel, job(schluessel, j => laden(u.href, ordner, !!p.entpacken, j)), p.warten);
}

async function befehl(p) {
    const skript = String(p.powershell || '');
    if (!skript.trim()) throw new Error('powershell fehlt');
    const timeout = Math.max(1, Math.min(Number(p.timeout) || 120, 1800));
    log('befehl', { powershell: skript.slice(0, 2000), timeout });
    const r = await powershell(skript, { timeout, cwd: p.ordner ? pfadAuf(p.ordner) : HOME });
    log('befehl_ende', { exitcode: r.exitcode, dauer_s: r.dauer_s, abgebrochen: r.abgebrochen });
    return r;
}

async function starten(p) {
    const ziel = String(p.pfad || '').trim();
    if (!ziel) throw new Error('pfad fehlt');
    const istPfad = /[\\/]/.test(ziel) || /^[a-z]:/i.test(ziel);
    const voll = istPfad ? pfadAuf(ziel) : ziel;
    if (istPfad && !fs.existsSync(voll)) throw new Error('Nicht gefunden: ' + voll);
    const args = Array.isArray(p.argumente)
        ? p.argumente.map(a => /[\s"]/.test(a) ? '"' + String(a).replace(/"/g, '\\"') + '"' : String(a)).join(' ')
        : String(p.argumente || '').trim();
    log('starten', { pfad: voll, argumente: args });
    if (!WIN) {
        const k = spawn(voll, args ? args.split(' ') : [], { detached: true, stdio: 'ignore' });
        k.on('error', () => {});
        k.unref();
        return { pid: k.pid, laeuft: true };
    }
    // Start-Process = ShellExecute: Fenster erscheint normal auf dem Desktop dieser (interaktiven) Sitzung
    const r = await powershell(
        '$a = @{ FilePath = $env:V3D_PFAD; PassThru = $true }\r\n' +
        'if ($env:V3D_ARGS) { $a.ArgumentList = $env:V3D_ARGS }\r\n' +
        'if ($env:V3D_WD) { $a.WorkingDirectory = $env:V3D_WD }\r\n' +
        '$p = Start-Process @a\r\nStart-Sleep -Seconds 3\r\n' +
        '$q = if ($p) { Get-Process -Id $p.Id -ErrorAction SilentlyContinue }\r\n' +
        '@{ pid = $p.Id; laeuft = [bool]$q; fenster = $(if ($q) { $q.MainWindowTitle }); exitcode = $(if ($p -and -not $q) { $p.ExitCode }) } | ConvertTo-Json -Compress',
        { timeout: 60, env: { V3D_PFAD: voll, V3D_ARGS: args,
                              V3D_WD: istPfad ? path.dirname(voll) : '' } });
    if (r.exitcode !== 0) throw new Error('Start gescheitert: ' + (r.stderr || r.stdout).trim().slice(0, 2000));
    const zeile = r.stdout.trim().split(/\r?\n/).pop();
    try { return Object.assign({ pfad: voll }, JSON.parse(zeile)); } catch (e) { return { pfad: voll, ausgabe: r.stdout.trim() }; }
}

function dateien(p) {
    const ziel = pfadAuf(p.pfad);
    const st = fs.statSync(ziel);
    if (!st.isDirectory()) return { pfad: ziel, typ: 'datei', groesse: st.size, geaendert: st.mtime.toISOString() };
    const max = Math.max(1, Math.min(Number(p.max) || 300, 2000));
    const alle = fs.readdirSync(ziel, { withFileTypes: true });
    const eintraege = [];
    for (const e of alle) {
        let s = null;
        try { s = fs.statSync(path.join(ziel, e.name)); } catch (x) { /* kein Zugriff */ }
        eintraege.push({ name: e.name, typ: e.isDirectory() || (s && s.isDirectory()) ? 'ordner' : (e.isSymbolicLink() ? 'link' : 'datei'),
                         groesse: s && !s.isDirectory() ? s.size : undefined, geaendert: s ? s.mtime.toISOString() : undefined });
    }
    eintraege.sort((a, b) => (a.typ === 'ordner' ? 0 : 1) - (b.typ === 'ordner' ? 0 : 1) || a.name.localeCompare(b.name, 'de'));
    return { pfad: ziel, gesamt: eintraege.length, gekuerzt: eintraege.length > max, eintraege: eintraege.slice(0, max) };
}

const WINGET_CODES = { 0: 'installiert', '-1978335189': 'kein passendes Update (bereits aktuell?)',
                       '-1978335135': 'bereits installiert', '-1978335212': 'Paket nicht gefunden',
                       '-1978335215': 'Installation abgebrochen/fehlgeschlagen' };

function wingetAusgabe(t) {   // Fortschrittsbalken und Spinner entfernen
    return t.split(/\r\n|\n|\r/).filter(z => z.trim() && !/^[\s\-\\|/]*$/.test(z) && !/[\u2580-\u259f]/.test(z)).join('\n');
}

async function winget(p) {
    const id = String(p.paket_id || '').trim();
    if (!/^[\w.+-]{2,100}$/.test(id)) throw new Error('Ungueltige paket_id (z. B. "Mozilla.Firefox")');
    const schluessel = 'winget|' + id;
    if (!jobs.has(schluessel)) log('winget', { paket_id: id });
    return abwarten(schluessel, job(schluessel, async () => {
        const r = await powershell(
            '$w = Get-Command winget -ErrorAction SilentlyContinue\r\n' +
            "if (-not $w) { $w = Get-ChildItem \"$env:ProgramFiles\\WindowsApps\\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe\\winget.exe\" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 }\r\n" +
            "if (-not $w) { Write-Error 'winget nicht gefunden'; exit 9009 }\r\n" +
            '& $w install --id $env:V3D_PAKET -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity\r\n' +
            'exit $LASTEXITCODE',
            { timeout: 3600, env: { V3D_PAKET: id } });
        log('winget_ende', { paket_id: id, exitcode: r.exitcode, dauer_s: r.dauer_s });
        const code = r.exitcode;
        return { paket_id: id, exitcode: code, hex: code == null ? null : '0x' + (code >>> 0).toString(16).toUpperCase(),
                 bedeutung: WINGET_CODES[String(code)] || (code === 0 ? 'installiert' : 'Fehler, siehe Ausgabe'),
                 ausgabe: wingetAusgabe(r.stdout).slice(-8000), stderr: r.stderr.slice(-4000), dauer_s: r.dauer_s,
                 abgebrochen: r.abgebrochen };
    }), p.warten);
}

const AKTIONEN = { download, befehl, starten, dateien, winget };

// --- HTTP ------------------------------------------------------------------------
function antwort(res, code, daten) {
    const b = Buffer.from(JSON.stringify(daten));
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length });
    res.end(b);
}

function gleich(a, b) {
    const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(x, y);
}

function koerper(req) {
    return new Promise((ok, fehler) => {
        const teile = []; let n = 0;
        req.on('data', b => { n += b.length; if (n > 1024 * 1024) { fehler(new Error('Anfrage zu gross')); req.destroy(); } else teile.push(b); });
        req.on('end', () => { try { ok(n ? JSON.parse(Buffer.concat(teile).toString('utf8')) : {}); } catch (e) { fehler(new Error('Kein gueltiges JSON')); } });
        req.on('error', fehler);
    });
}

function konfigSpeichern() {
    fs.writeFileSync(CONFIG + '.neu', JSON.stringify(cfg, null, 1));
    fs.renameSync(CONFIG + '.neu', CONFIG);
}

async function behandeln(req, res) {
    const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (![].concat(cfg.erlaubt || []).includes(ip)) { log('abgewiesen', { ip, url: req.url }); return antwort(res, 403, { fehler: 'nicht erlaubt' }); }
    const name = (req.url || '').split('?')[0].replace(/^\/+/, '');
    if (name === 'kopplung' && req.method === 'POST') {
        const frisch = Date.now() - Date.parse(cfg.erstellt || 0) < KOPPLUNG_FRIST;
        if (cfg.gekoppelt || !frisch) {
            log('kopplung_abgelehnt', { ip, gekoppelt: !!cfg.gekoppelt });
            return antwort(res, 403, { fehler: 'Kopplung gesperrt - Einrichtungsskript erneut ausfuehren' });
        }
        cfg.gekoppelt = new Date().toISOString(); konfigSpeichern();
        log('kopplung', { ip });
        return antwort(res, 200, { token: cfg.token, rechner: info.rechner });
    }
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ') || !gleich(auth.slice(7), cfg.token)) {
        log('token_falsch', { ip, url: req.url });
        return antwort(res, 401, { fehler: 'Token fehlt oder falsch' });
    }
    if (name === 'status') {
        return antwort(res, 200, Object.assign({}, info, { laufzeit_s: Math.round(process.uptime()),
            jobs: [...jobs.keys()].map(k => k.split('|').slice(0, 2).join(' ')) }));
    }
    const fn = AKTIONEN[name];
    if (!fn || req.method !== 'POST') return antwort(res, 404, { fehler: 'Unbekannt: ' + name });
    try {
        const p = await koerper(req);
        antwort(res, 200, await fn(p));
    } catch (e) {
        log(name + '_fehler', { fehler: e.message });
        antwort(res, 400, { fehler: e.message });
    }
}

function tailscaleIp() {
    for (const liste of Object.values(os.networkInterfaces())) {
        for (const a of liste || []) {
            if (a.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address)) return a.address;
        }
    }
    return null;
}

function lauschen() {
    // bei der Anmeldung ist Tailscale evtl. noch nicht verbunden -> bis zur IP immer wieder versuchen
    const ip = cfg.ip && cfg.ip !== 'auto' ? cfg.ip : tailscaleIp();
    if (!ip) { setTimeout(lauschen, 15000); return; }
    const server = http.createServer((req, res) => {
        behandeln(req, res).catch(e => { try { antwort(res, 500, { fehler: e.message }); } catch (x) { /* zu */ } });
    });
    server.requestTimeout = 0;      // Downloads/Befehle duerfen dauern
    server.headersTimeout = 30000;
    server.on('error', e => {
        log('lauschen_fehler', { ip, port: cfg.port, fehler: e.code || e.message });
        server.close();
        setTimeout(lauschen, 15000);
    });
    server.listen(cfg.port || 8933, ip, () => log('lauscht', { ip, port: cfg.port || 8933 }));
}

async function sitzungPruefen() {
    if (!WIN) return;
    const r = await powershell(
        '$i = [Security.Principal.WindowsIdentity]::GetCurrent()\r\n' +
        '@{ sitzung = (Get-Process -Id ' + process.pid + ').SessionId; admin = ([Security.Principal.WindowsPrincipal]$i).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); konto = $i.Name } | ConvertTo-Json -Compress',
        { timeout: 60 });
    try { Object.assign(info, JSON.parse(r.stdout.trim().split(/\r?\n/).pop())); } catch (e) { /* egal */ }
    log('sitzung', { sitzung: info.sitzung, admin: info.admin, konto: info.konto });
}

process.on('uncaughtException', e => { log('absturz', { fehler: String(e && e.stack || e) }); process.exit(1); });
process.on('unhandledRejection', e => { log('absturz', { fehler: String(e && e.stack || e) }); process.exit(1); });

log('start', { version: VERSION, pid: process.pid, node: process.version });
sitzungPruefen().catch(() => {});
lauschen();
