// LAN-Anbindung eines Bambu-Druckers: FTPS-Upload + MQTT-Steuerung/Status.
// Protokoll nach OpenBambuAPI (Community-Doku). Nutzer=bblp, Passwort=Zugangscode,
// selbstsigniertes Zertifikat (rejectUnauthorized:false, nur im LAN vertretbar).
const mqtt = require('mqtt');
const ftp = require('basic-ftp');
const { Writable, Readable } = require('stream');

// Erreichbarkeit prüfen: kurzer TLS-MQTT-Connect mit Timeout
async function reachable(printer, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const c = mqtt.connect(`mqtts://${printer.ip}:8883`, {
      username: 'bblp', password: printer.access_code,
      rejectUnauthorized: false, connectTimeout: timeoutMs, reconnectPeriod: 0,
    });
    const done = (ok) => { try { c.end(true); } catch {} resolve(ok); };
    c.on('connect', () => done(true));
    c.on('error', () => done(false));
    setTimeout(() => done(false), timeoutMs);
  });
}

// G-Code-Datei per FTPS (implizites TLS, Port 990) in den Modell-Ordner laden.
// onBytes(gesendeteBytes) meldet den Fortschritt für den Ladebalken.
async function uploadGcode(printer, filename, gcodeBuffer, onBytes) {
  const client = new ftp.Client(15000);
  client.ftp.verbose = false;
  try {
    if (onBytes) client.trackProgress((info) => onBytes(info.bytes));
    await client.access({
      host: printer.ip, port: 990, user: 'bblp', password: printer.access_code,
      secure: 'implicit', secureOptions: { rejectUnauthorized: false },
    });
    const src = Readable.from(gcodeBuffer);
    await client.uploadFrom(src, filename);
    return true;
  } finally {
    client.trackProgress();
    client.close();
  }
}

// Steuerbefehl senden und (optional) auf eine Bestätigung im Report warten
function sendCommand(printer, payload, { waitMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(`mqtts://${printer.ip}:8883`, {
      username: 'bblp', password: printer.access_code,
      rejectUnauthorized: false, connectTimeout: 6000, reconnectPeriod: 0,
    });
    const reportTopic = `device/${printer.serial}/report`;
    const requestTopic = `device/${printer.serial}/request`;
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; try { c.end(true); } catch {} fn(arg); };
    c.on('connect', () => {
      if (waitMs > 0) c.subscribe(reportTopic);
      c.publish(requestTopic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) return finish(reject, err);
        if (waitMs === 0) return finish(resolve, { sent: true });
        setTimeout(() => finish(resolve, { sent: true, acked: false }), waitMs);
      });
    });
    c.on('message', (_t, msg) => {
      let j; try { j = JSON.parse(msg.toString()); } catch { return; }
      const pr = j.print;
      if (!pr) return;
      // Nur das Echo DESSELBEN Kommandos ist die echte Antwort (result/reason);
      // ein beliebiger Status-Report ist keine Bestätigung.
      if (pr.command && pr.command === payload.print?.command)
        finish(resolve, { sent: true, acked: true, result: pr.result, reason: pr.reason, report: pr });
    });
    c.on('error', (e) => finish(reject, e));
    setTimeout(() => finish(resolve, { sent: true, timeout: true }), (waitMs || 6000) + 6000);
  });
}

// Einmal den Vollstatus abfragen (pushall) und zurückgeben
function getStatus(printer, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(`mqtts://${printer.ip}:8883`, {
      username: 'bblp', password: printer.access_code,
      rejectUnauthorized: false, connectTimeout: 5000, reconnectPeriod: 0,
    });
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; try { c.end(true); } catch {} fn(arg); };
    c.on('connect', () => {
      c.subscribe(`device/${printer.serial}/report`);
      c.publish(`device/${printer.serial}/request`,
        JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } }), { qos: 1 });
    });
    c.on('message', (_t, msg) => {
      let j; try { j = JSON.parse(msg.toString()); } catch { return; }
      if (j.print) finish(resolve, j.print);
    });
    c.on('error', (e) => finish(reject, e));
    setTimeout(() => finish(reject, new Error('LAN-Status Timeout')), timeoutMs);
  });
}

module.exports = { reachable, uploadGcode, sendCommand, getStatus };
