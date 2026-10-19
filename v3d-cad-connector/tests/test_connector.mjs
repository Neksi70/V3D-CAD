// Ende-zu-Ende-Test des claude.ai-Connectors auf einer Test-Instanz:
// OAuth wie claude.ai (Registrierung, PKCE, Freigabe über die V3D-CAD-Sitzung, Token)
// → MCP-Aufrufe → Bauen im Tab (Playwright) → Konto-Bindung → Download.
// Alles auf eigenen Ports, der laufende Hub/CAD bleibt unberührt.
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';

const CAD = 8982, HUB = 8836, CON = 8842, CB = 'http://127.0.0.1:9/cb';
const BASE = `http://127.0.0.1:${CON}`;
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const warte = async (url, n = 60) => { for (let i = 0; i < n; i++) { try { await fetch(url); return; } catch (_) { await new Promise(r => setTimeout(r, 250)); } } throw new Error('nicht erreichbar: ' + url); };
const tmp = fs.mkdtempSync('/tmp/cadconn-');

const dienste = [
  spawn('python3', ['volme3d_server.py', String(CAD), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' }),
  spawn('node', ['/home/v3da/v3d-cad-mcp/server.mjs', '--hub', '--hub-port', String(HUB)], {
    stdio: 'ignore', env: { ...process.env, V3D_CONNECTOR_URL: BASE + '/mcp', V3D_CAD_URL: `http://127.0.0.1:${CAD}` } }),
  spawn('/home/v3da/v3d-cad-connector/bin/v3d-cad-connector', ['serve'], {
    stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PORT: String(CON), ISSUER_URL: BASE, CAD_PUBLIC: `http://127.0.0.1:${CAD}`,
      CAD_URL: `http://127.0.0.1:${CAD}`, HUB_URL: `http://127.0.0.1:${HUB}`, DATA_DIR: tmp, EXTRA_REDIRECT_URIS: CB, V3DCAD_ENV: '/dev/null' } }),
];
const b = await chromium.launch();
try {
  await warte(`http://127.0.0.1:${CAD}/login`); await warte(`http://127.0.0.1:${HUB}/`); await warte(BASE + '/health');

  // ── OAuth wie claude.ai ──
  const meta = await (await fetch(BASE + '/.well-known/oauth-authorization-server')).json();
  ok(meta.authorization_endpoint && meta.token_endpoint && meta.registration_endpoint, 'Metadaten: ' + meta.issuer);
  const pr = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
  ok(pr.status === 401 && /resource_metadata/.test(pr.headers.get('www-authenticate') || ''), '/mcp ohne Token → 401 mit resource_metadata');
  let reg = await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['https://boese.example/cb'], client_name: 'Böse', token_endpoint_auth_method: 'none' }) });
  ok(reg.status === 400, 'fremde Rücksprungadresse bei /register abgelehnt');
  const client = await (await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [CB], client_name: 'Claude (Test)', token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })).json();
  ok(!!client.client_id, 'Client registriert');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const az = new URL(meta.authorization_endpoint);
  Object.entries({ response_type: 'code', client_id: client.client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256',
    state: 'st123', scope: 'cad', resource: BASE + '/mcp' }).forEach(([k, v]) => az.searchParams.set(k, v));
  const r1 = await fetch(az, { redirect: 'manual' });
  const loginUrl = r1.headers.get('location');
  ok(r1.status === 302 && /\/login\?req=/.test(loginUrl), '/authorize → Freigabe-Seite');
  const seite = await (await fetch(loginUrl)).text();
  ok(/dev@lokal/.test(seite) && /Erlauben/.test(seite), 'Freigabe-Seite zeigt das V3D-CAD-Konto (Dev: dev@lokal)');
  const req = new URL(loginUrl).searchParams.get('req');
  const r2 = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'req=' + req });
  const cb = new URL(r2.headers.get('location'));
  ok(r2.status === 302 && cb.origin + cb.pathname === CB && cb.searchParams.get('state') === 'st123', 'Erlauben → Rücksprung zu Claude mit code + state');
  const tok = await (await fetch(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: cb.searchParams.get('code'), redirect_uri: CB, client_id: client.client_id,
      code_verifier: verifier, resource: BASE + '/mcp' }) })).json();
  ok(!!tok.access_token && !!tok.refresh_token, 'Token getauscht (PKCE)');
  const nochmal = await fetch(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: cb.searchParams.get('code'), redirect_uri: CB, client_id: client.client_id, code_verifier: verifier }) });
  ok(nochmal.status === 400, 'Code nur einmal einlösbar');

  // ── MCP mit Token ──
  let rid = 1;
  const mcp = async (method, params) => {
    const r = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      authorization: 'Bearer ' + tok.access_token }, body: JSON.stringify({ jsonrpc: '2.0', id: rid++, method, params }) });
    return r.json();
  };
  const tool = async (name, args) => { const r = await mcp('tools/call', { name, arguments: args || {} }); return r.result; };
  const txt = r => JSON.parse(r.content[0].text.replace(/^Fehler: /, '"').replace(/$/, r.content[0].text.startsWith('Fehler') ? '"' : ''));
  const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  ok(/Claude live/.test(init.result.instructions), 'initialize: Hinweise erklären Claude live');
  const tl = await mcp('tools/list', {});
  ok(tl.result.tools.length === 13, 'tools/list: ' + tl.result.tools.map(t => t.name).join(', '));
  let r = await tool('execute', { command: 'scene.inspect' });
  ok(r.isError && /Claude live/.test(r.content[0].text), 'ohne Tab → Hinweis, wie man verbindet');

  // ── Tab ──
  const p = await b.newPage({ viewport: { width: 1300, height: 800 }, acceptDownloads: true });
  await p.goto(`http://127.0.0.1:${CAD}/volme3d.html`);
  await p.waitForFunction(() => window.v3dLive && window.v3dApi && v3dApi.ready());
  await p.evaluate(h => { window.V3D_LIVE_HUB = h; try { hideStarter(); } catch (e) {} _newCreate(false); }, `http://127.0.0.1:${HUB}`);
  await p.evaluate(() => v3dLive.start());
  await p.waitForFunction(() => v3dLive.state().code, null, { timeout: 10000 });
  const code = await p.evaluate(() => v3dLive.state().code);
  ok(await p.evaluate(() => /V3D CAD/.test(document.body.innerText) && /Connector/.test(document.body.innerText)), 'Statusfeld nennt die Connector-Adresse');
  // fremdes Konto darf den Tab nicht übernehmen
  const fremd = await fetch(`http://127.0.0.1:${HUB}/live/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, owner: 'fremd@example.com' }) });
  ok(fremd.status === 403, 'anderes Konto + richtiger Code → 403');
  r = await tool('live_connect', { code });
  ok(!r.isError && JSON.parse(r.content[0].text).verbunden, 'live_connect mit eigenem Konto');
  r = await tool('batch', { commands: [
    { command: 'shape.add', params: { type: 'box', size: [40, 30, 20], name: 'Box (Connector)' } },
    { command: 'shape.add', params: { type: 'cylinder', size: [10, 10, 30], center: [0, 0, 10], hole: true } }], verbose: false });
  const ids = JSON.parse(r.content[0].text).results.map(x => x.result.id);
  r = await tool('execute', { command: 'bool.subtract', params: { target: ids[0], tools: [ids[1]] } });
  const vol = JSON.parse(r.content[0].text).result.created[0].volume_mm3;
  ok(Math.abs(vol - (24000 - Math.PI * 25 * 20)) < 30, `im Tab gebaut: Box mit Loch, ${vol} mm³`);
  ok((await p.evaluate(() => objects.length)) === 1, 'Tab zeigt das Ergebnis');
  r = await tool('screenshot', { view: 'iso', width: 320, height: 200 });
  ok(r.content[0].type === 'image' && r.content[0].data.length > 3000, 'Screenshot aus dem Tab');
  const dl = p.waitForEvent('download', { timeout: 30000 });
  r = await tool('export', { format: 'stl', name: 'testbox' });
  const d = await dl;
  ok(!r.isError && d.suggestedFilename() === 'testbox.stl', 'export → Download im Tab: ' + d.suggestedFilename());
  r = await tool('live_status');
  ok(JSON.parse(r.content[0].text).live === true, 'live_status');
  await p.evaluate(() => v3dLive.stop());
  await new Promise(r => setTimeout(r, 400));
  r = await tool('execute', { command: 'scene.inspect' });
  ok(r.isError && /Live-Verbindung zum Tab ist weg|Claude live/.test(r.content[0].text), 'Tab beendet → klare Meldung');
  // Refresh-Token rotiert, alter ist danach ungültig
  const ref = async t => fetch(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t, client_id: client.client_id }) });
  const neu = await (await ref(tok.refresh_token)).json();
  ok(!!neu.access_token, 'Refresh liefert neues Token');
  ok((await ref(tok.refresh_token)).status === 400, 'alter Refresh-Token gesperrt (Rotation)');
  r = await mcp('tools/call', { name: 'live_status', arguments: {} });
  ok(!r.result, 'nach Wiederverwendung ist die ganze Anmeldung gesperrt (auch das Access-Token)');
  const audit = fs.readFileSync(tmp + '/audit.log', 'utf8');
  ok(/"konto": "dev@lokal"/.test(audit) && !/24000|Box \(Connector\)/.test(audit), 'Audit-Log mit Konto, ohne Inhalte');
} catch (e) { console.error(e); fail++; }
await b.close(); dienste.forEach(d => d.kill());
console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK');
setTimeout(() => process.exit(fail ? 1 : 0), 500);
