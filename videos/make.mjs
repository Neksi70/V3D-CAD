#!/usr/bin/env node
/* Howto-Video aus einem Drehbuch bauen.
 *
 *   node videos/make.mjs namensschild            # ein Video
 *   node videos/make.mjs --alle                  # alle Drehbücher
 *   node videos/make.mjs namensschild --sichtbar # Browser zum Zuschauen
 *
 * Ablauf: Sprache erzeugen (Piper) → Dauern messen → App per Playwright
 * abfahren und dabei aufnehmen → Ton und Untertitel drunterlegen (ffmpeg).
 * Die gemessene Sprechdauer steuert das Timing: eine Szene steht immer
 * mindestens so lange, wie ihr Satz dauert.
 */
import { chromium } from 'playwright';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApi } from './lib/api.mjs';

const pexec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out');
const WORK = path.join(HERE, 'work');
const W = 1920;
const H = 1080;
// Die ersten Zehntel zeigen den grauen Chromium-Grund vor dem ersten Bildaufbau.
// Der erste Frame ist bei YouTube das Vorschaubild — also vorne abschneiden.
const TRIM = 1.0;
const DEV_URL = process.env.VID_URL || 'http://127.0.0.1:8766/volme3d.html';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);

// ── Sprache ───────────────────────────────────────────────────────────────
async function speak(lines, dir) {
  await fs.mkdir(dir, { recursive: true });
  const jobFile = path.join(dir, '_job.json');
  await fs.writeFile(
    jobFile,
    JSON.stringify({ outDir: dir, speed: 0.94, lines }, null, 1)
  );
  const { stdout } = await pexec('python3', [path.join(HERE, 'tts.py'), jobFile], {
    maxBuffer: 1 << 24,
  });
  return JSON.parse(stdout);
}

// ── Aufnahme ──────────────────────────────────────────────────────────────
async function record(script, audio, opts) {
  const dir = path.join(WORK, script.id);
  const vidDir = path.join(dir, 'raw');
  await fs.rm(vidDir, { recursive: true, force: true });

  const browser = await chromium.launch({
    headless: !opts.sichtbar,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: vidDir, size: { width: W, height: H } },
    permissions: [],
  });
  // Titelkarte vorab bekanntgeben: sie steht dann schon im allerersten Frame
  // und deckt die Ladephase ab.
  await ctx.addInitScript(
    ([t, s, i]) => {
      window.__vidCard = { title: t, sub: s, icon: i };
    },
    [script.title, script.subtitle || '', script.icon || '']
  );
  await ctx.addInitScript({ path: path.join(HERE, 'lib', 'overlay.js') });

  const page = await ctx.newPage();
  const T0 = Date.now(); // Stoppuhr; der Versatz zum Video wird unten bestimmt
  const at = () => (Date.now() - T0) / 1000;
  const marks = []; // {id, t, dur, text}
  let tEnd = 0;

  page.on('console', (m) => {
    if (m.type() === 'error') log(`  [Seite] ${m.text().slice(0, 160)}`);
  });

  const api = makeApi(page, log);
  const byId = Object.fromEntries(audio.map((a) => [a.id, a]));

  try {
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    log('  · warte auf App…');
    await api.until(
      () =>
        typeof window.newScene === 'function' &&
        typeof window.showStarter === 'function' &&
        !!document.getElementById('c3d'),
      { timeout: 90000, msg: 'App-Start' }
    );
    if (script.ready) await script.ready(api);
    await sleep(600);

    // Intro sprechen, solange die Karte steht
    const intro = byId.intro;
    if (intro && intro.dur) {
      marks.push({ id: 'intro', t: at(), dur: intro.dur, text: script.introText });
      await sleep(intro.dur * 1000 + 500);
    }
    await page.evaluate(() => window.__vid.hideCard());
    await page.evaluate(() => window.__vid.watermark(true));
    await sleep(350);

    // ── Szenen ──
    for (let i = 0; i < script.scenes.length; i++) {
      const sc = script.scenes[i];
      const a = byId['s' + i] || { dur: 0 };
      const tStart = at();
      log(`  · Szene ${i + 1}/${script.scenes.length} @${tStart.toFixed(1)}s — ${(sc.say || '').slice(0, 58)}`);

      if (sc.at) await api.spot(sc.at, sc.pad ?? 8);
      else if (sc.at === null) await api.unspot();
      if (sc.say) {
        await page.evaluate((t) => window.__vid.caption(t), sc.say);
        marks.push({ id: 's' + i, t: tStart, dur: a.dur, text: sc.say });
      }

      if (sc.run) await sc.run(api);

      // Szene stehen lassen, bis der Satz zu Ende gesprochen ist
      const soll = (a.dur || 0) + (sc.hold ?? 0.55);
      const rest = soll - (at() - tStart);
      if (rest > 0) await sleep(rest * 1000);
      else if (a.dur && -rest > 1.5) {
        // Die Aktion lief deutlich länger als der Satz — danach ist es still.
        // Entweder den Text verlängern oder die Aktion kürzen.
        log(
          `    ⚠ Szene ${i + 1}: Aktion ${(-rest).toFixed(1)}s länger als der Satz ` +
          `(${a.dur.toFixed(1)}s) — es entsteht eine Tonlücke`
        );
      }
      await page.evaluate(() => window.__vid.caption(''));
      await sleep(140);
    }

    await api.unspot();

    // ── Outro ──
    const outro = byId.outro;
    await page.evaluate(
      ([t, s]) => window.__vid.showCard(t, s, '🖨️'),
      [script.outroTitle || 'Viel Spaß beim Drucken!', 'V3D CAD · v3d-cad.de']
    );
    if (outro && outro.dur) {
      marks.push({ id: 'outro', t: at(), dur: outro.dur, text: script.outroText });
      await sleep(outro.dur * 1000 + 900);
    } else {
      await sleep(1800);
    }
  } catch (e) {
    log(`  ✗ Aufnahme abgebrochen: ${e.message}`);
    await page
      .screenshot({ path: path.join(dir, 'fehler.png') })
      .catch(() => {});
    throw e;
  } finally {
    tEnd = at();
    const video = page.video();
    await ctx.close(); // schreibt die Videodatei fertig
    await browser.close();
    if (video) {
      const src = await video.path();
      const dst = path.join(dir, 'roh.webm');
      await fs.rename(src, dst).catch(async () => {
        await fs.copyFile(src, dst);
      });
    }
  }

  // Die Aufnahme beginnt erst mit dem ersten gerenderten Frame, nicht mit
  // unserer Stoppuhr — dazwischen liegen je nach Start ein paar Sekunden.
  // Da das Video exakt mit ctx.close() endet, ergibt die Differenz aus
  // Stoppuhr und Videolänge genau diesen Versatz.
  const video = path.join(dir, 'roh.webm');
  const { stdout } = await pexec('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', video,
  ]);
  const videoDur = parseFloat(stdout);
  const versatz = tEnd - videoDur;
  log(`  · Versatz Aufnahmestart: ${versatz.toFixed(2)}s (Video ${videoDur.toFixed(1)}s)`);
  // Versatz und Vorspann-Schnitt in einem Rutsch auf die Zeitachse rechnen
  for (const m of marks) m.t = Math.max(0, m.t - versatz - TRIM);

  return { video, marks, dir, videoDur };
}

// ── Ton und Bild zusammenführen ───────────────────────────────────────────
const mmss = (s) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function srtTime(s) {
  const ms = Math.round(s * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
  const sec = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, '0')}`;
}

async function mux(script, marks, audio, rec) {
  const byId = Object.fromEntries(audio.map((a) => [a.id, a]));
  const used = marks.filter((m) => byId[m.id] && byId[m.id].file);

  // Tonspur: jedes Stück an seine Position schieben und übereinanderlegen
  const trk = path.join(rec.dir, 'ton.wav');
  const args = [];
  used.forEach((m) => args.push('-i', byId[m.id].file));
  const filt =
    used
      .map((m, i) => `[${i}:a]adelay=${Math.round(m.t * 1000)}:all=1[a${i}]`)
      .join(';') +
    ';' +
    used.map((_, i) => `[a${i}]`).join('') +
    `amix=inputs=${used.length}:normalize=0:dropout_transition=0[out]`;
  await pexec('ffmpeg', [
    '-y', ...args, '-filter_complex', filt,
    '-map', '[out]', '-ar', '48000', '-ac', '2', trk,
  ], { maxBuffer: 1 << 26 });

  // Untertitel: SRT für YouTube, VTT für das <video>-Element in der App
  const cues = used.filter((m) => m.text);
  const srt = cues
    .map(
      (m, i) =>
        `${i + 1}\n${srtTime(m.t)} --> ${srtTime(m.t + m.dur + 0.35)}\n${m.text}\n`
    )
    .join('\n');
  await fs.mkdir(OUT, { recursive: true });
  const srtPath = path.join(OUT, script.id + '.srt');
  await fs.writeFile(srtPath, srt, 'utf-8');
  await fs.writeFile(
    path.join(OUT, script.id + '.vtt'),
    'WEBVTT\n\n' + srt.replace(/,(\d{3})/g, '.$1'),
    'utf-8'
  );

  // Begleittext für den YouTube-Upload: Titel, Beschreibung mit Kapitelmarken
  // (YouTube macht daraus anklickbare Sprungmarken) und Schlagwörter.
  const kap = marks
    .map((m, i) => ({ m, sc: script.scenes[parseInt(m.id.slice(1), 10)] }))
    .filter((x) => x.sc && x.sc.kapitel)
    .map((x) => `${mmss(x.m.t)} ${x.sc.kapitel}`);
  const yt =
    `${script.title} — V3D CAD\n\n` +
    `${script.introText}\n\n` +
    (kap.length ? `0:00 Einleitung\n${kap.join('\n')}\n\n` : '') +
    `V3D CAD läuft direkt im Browser — nichts zu installieren.\n` +
    `${script.link || 'https://v3d-cad.de'}\n\n` +
    `#3ddruck #3dprinting #cad` +
    (script.tags || []).map((t) => ' #' + t).join('') +
    '\n';
  await fs.writeFile(path.join(OUT, script.id + '.youtube.txt'), yt, 'utf-8');

  // Endfassung: h264/aac, YouTube-tauglich
  const mp4 = path.join(OUT, script.id + '.mp4');
  await pexec('ffmpeg', [
    '-y',
    '-ss', String(TRIM), '-i', rec.video,
    '-i', trk,
    '-map', '0:v:0', '-map', '1:a:0',
    '-r', '30',
    '-vf', `scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    '-shortest',
    mp4,
  ], { maxBuffer: 1 << 26 });

  return { mp4, srt: srtPath };
}

// ── Ablauf ────────────────────────────────────────────────────────────────
async function build(id, opts) {
  const mod = await import(path.join(HERE, 'scripts', id + '.mjs'));
  const script = mod.default;
  log(`\n▶ ${script.title}  (${script.scenes.length} Szenen)`);

  const lines = [];
  if (script.introText) lines.push({ id: 'intro', text: script.introText });
  script.scenes.forEach((s, i) => lines.push({ id: 's' + i, text: s.say || '' }));
  if (script.outroText) lines.push({ id: 'outro', text: script.outroText });

  log('  · Sprache erzeugen…');
  const audio = await speak(lines, path.join(WORK, script.id, 'ton'));
  const total = audio.reduce((a, b) => a + b.dur, 0);
  log(`    ${audio.length} Sätze, ${total.toFixed(1)}s gesprochen`);

  const rec = await record(script, audio, opts);
  log('  · Ton und Untertitel mischen…');
  const res = await mux(script, rec.marks, audio, rec);

  const { stdout } = await pexec('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', res.mp4,
  ]);
  const size = (await fs.stat(res.mp4)).size;
  log(
    `  ✓ ${path.relative(ROOT, res.mp4)} — ` +
    `${parseFloat(stdout).toFixed(1)}s, ${(size / 1e6).toFixed(1)} MB`
  );
  return res;
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = { sichtbar: argv.includes('--sichtbar') };
  let ids = argv.filter((a) => !a.startsWith('--'));

  if (argv.includes('--alle') || !ids.length) {
    const files = await fs.readdir(path.join(HERE, 'scripts'));
    ids = files.filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4));
  }

  // Erreichbarkeit prüfen — sonst nimmt man 90 s lang eine Fehlerseite auf
  try {
    // GET, nicht HEAD: der einfache Python-Server antwortet auf HEAD mit 501
    const r = await fetch(DEV_URL);
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    console.error(
      `\n✗ ${DEV_URL} nicht erreichbar (${e.message}).\n` +
      `  Erst den Entwicklungsserver starten:  npm run dev\n`
    );
    process.exit(1);
  }

  const fertig = [];
  for (const id of ids) {
    try {
      fertig.push(await build(id, opts));
    } catch (e) {
      console.error(`✗ ${id}: ${e.message}`);
      if (ids.length === 1) process.exit(1);
    }
  }

  await schreibeIndex();
  log(`\n${fertig.length}/${ids.length} Videos in ${path.relative(ROOT, OUT)}/\n`);
}

/**
 * Verzeichnis aller fertigen Videos. Die App blendet ihre Hilfe-Knöpfe nur für
 * die Generatoren ein, die hier auftauchen — so entstehen keine toten Knöpfe,
 * solange noch nicht jedes Video gedreht ist.
 */
async function schreibeIndex() {
  const files = await fs.readdir(OUT).catch(() => []);
  const eintraege = [];
  for (const f of files.filter((f) => f.endsWith('.mp4'))) {
    const id = f.slice(0, -4);
    let titel = id;
    let modal = null;
    try {
      const mod = await import(path.join(HERE, 'scripts', id + '.mjs'));
      titel = mod.default.title || id;
      modal = mod.default.modal || null;
    } catch {
      /* Video ohne Drehbuch — Titel bleibt die Kennung */
    }
    const { stdout } = await pexec('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1', path.join(OUT, f),
    ]);
    eintraege.push({ id, titel, modal, dauer: Math.round(parseFloat(stdout)) });
  }
  eintraege.sort((a, b) => a.id.localeCompare(b.id));
  await fs.writeFile(
    path.join(OUT, 'index.json'),
    JSON.stringify(eintraege, null, 1),
    'utf-8'
  );
  log(`  · Verzeichnis: ${eintraege.length} Video(s) in index.json`);
}

main();
