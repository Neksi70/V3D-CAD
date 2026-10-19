  // ── Claude live: dieser Tab nimmt Befehle von Claude entgegen ──────────
  // ☰ Menü → 🤖 Claude live: der Tab meldet sich beim Agent-Hub an und zeigt einen
  // 6-stelligen Code. Nennt der Nutzer Claude den Code (live_connect), laufen dessen
  // Befehle hier sichtbar. Der Hub erreicht den Tab nur über die vom Tab geöffnete
  // Verbindung; „Beenden“ trennt sofort.
  const LIVE = { on: false, es: null, tab: null, secret: null, code: null, el: null, n: 0, status: 'wartet' };
  const liveBase = () => /\.ts\.net$/.test(location.hostname) ? '/cad-agent' : 'http://127.0.0.1:8830';
  const liveQ = () => '?tab=' + LIVE.tab + '&secret=' + LIVE.secret;
  function liveBadge(letzter) {
    if (!LIVE.on) { if (LIVE.el) { LIVE.el.remove(); LIVE.el = null; } return; }
    if (!LIVE.el) {
      LIVE.el = document.createElement('div');
      LIVE.el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:5000;background:#16212d;color:#e6edf3;border:1px solid #3b9cff;border-radius:10px;padding:10px 12px;font:13px system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.3);max-width:300px';
      document.body.appendChild(LIVE.el);
    }
    const dot = LIVE.status === 'verbunden' ? '#2fbf71' : LIVE.status === 'wartet' ? '#f5b942' : '#ff5d5d';
    LIVE.el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-weight:600"><span style="width:9px;height:9px;border-radius:50%;background:${dot}"></span>🤖 Claude live
        <button style="margin-left:auto;font:inherit;font-size:12px;padding:2px 8px;border-radius:6px;border:1px solid #3b9cff;background:transparent;color:#e6edf3;cursor:pointer" onclick="v3dLive.stop()">Beenden</button></div>
      <div style="margin-top:6px">${LIVE.status === 'verbunden' ? 'Claude ist verbunden und baut hier mit.' : 'Sag Claude: <b>„verbinde dich live mit Code ' + LIVE.code + '“</b>'}</div>
      <div style="margin-top:4px;font-size:22px;letter-spacing:4px;font-weight:700;color:#9fd0ff">${LIVE.code}</div>
      <div style="margin-top:4px;font-size:11.5px;color:#8aa0b4">${LIVE.n ? LIVE.n + ' Befehle' + (letzter ? ' · zuletzt ' + letzter : '') : 'noch keine Befehle'}</div>`;
  }
  async function liveStart() {
    if (LIVE.on) { liveBadge(); return; }
    let r;
    try { r = await (await fetch(liveBase() + '/live/open', { method: 'POST' })).json(); } catch (e) { r = { error: 'Agent-Dienst nicht erreichbar' }; }
    if (!r || !r.tab) { notify('Claude live geht gerade nicht: ' + ((r && r.error) || 'keine Antwort'), 'e'); return; }
    Object.assign(LIVE, { on: true, tab: r.tab, secret: r.secret, code: r.code, n: 0, status: 'wartet' });
    LIVE.es = new EventSource(liveBase() + '/live/events' + liveQ());
    LIVE.es.addEventListener('verbunden', () => { LIVE.status = 'verbunden'; liveBadge(); notify('🤖 Claude ist live verbunden', 'ok'); });
    LIVE.es.addEventListener('getrennt', () => { LIVE.status = 'wartet'; liveBadge(); notify('Claude hat die Live-Verbindung beendet', 'ok'); });
    LIVE.es.onerror = () => { if (LIVE.on && LIVE.es.readyState === 2) { LIVE.status = 'getrennt'; liveBadge(); } };
    LIVE.es.addEventListener('cmd', async m => {
      const job = JSON.parse(m.data); let result;
      try {
        if (job.op === 'execute') result = await execute(job.args[0], job.args[1]);
        else if (job.op === 'batch') result = await batch(job.args[0], job.args[1]);
        else if (job.op === 'commands') result = commands(job.args[0]);
        else result = { ok: false, error: 'unbekannte Operation ' + job.op };
      } catch (e) { result = { ok: false, error: String(e && e.message || e) }; }
      LIVE.n++; LIVE.status = 'verbunden';
      liveBadge(job.op === 'execute' ? job.args[0] : job.op === 'batch' ? job.args[0].length + ' Befehle' : job.op);
      fetch(liveBase() + '/live/result' + liveQ(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: job.id, result }) });
    });
    liveBadge();
  }
  function liveStop() {
    if (!LIVE.on) return;
    try { LIVE.es.close(); } catch (_) {}
    fetch(liveBase() + '/live/close' + liveQ(), { method: 'POST' }).catch(() => {});
    LIVE.on = false; liveBadge();
    notify('Claude live beendet', 'ok');
  }
  window.v3dLive = { start: liveStart, stop: liveStop, state: () => ({ on: LIVE.on, code: LIVE.code, status: LIVE.status, n: LIVE.n }) };
  window.addEventListener('beforeunload', () => { if (LIVE.on) navigator.sendBeacon && navigator.sendBeacon(liveBase() + '/live/close' + liveQ()); });
  // Menüeintrag unter „Extras“ (per Code eingehängt, das Menü-HTML bleibt unberührt)
  {
    const m = document.getElementById('burger-menu');
    if (m && !document.getElementById('bm-claude-live')) {
      const it = document.createElement('div');
      it.className = 'sli-item'; it.id = 'bm-claude-live';
      it.title = 'Claude (KI) baut sichtbar in diesem Tab mit: zeigt einen Code, den du Claude nennst';
      it.textContent = '🤖 Claude live';
      it.onclick = () => liveStart();
      m.appendChild(it);
    }
  }

