# MIGRATION-INVENTAR — V3D CAD → netcup RS 4000 G12

Stand: 01.09.2026 · Quelle: V3DA (Tailscale 100.125.34.44), nur lesend erfasst.
Ziel: Parallel-Instanz (Produktion nach Rollout; getestet wird auf V3DA) auf `v2202609407527510336.bestsrv.de` (159.195.247.82 / 2a0a:4cc0:61:1be8:b88b:42ff:fecc:742f), Debian 13 minimal.

## 1. Dienste, die zu V3D CAD gehören

| Dienst | Art | Port | ExecStart |
|---|---|---|---|
| `volme3d.service` | System-Unit | 127.0.0.1:8765 | `/usr/bin/python3 /home/v3da/volme3d_server.py 8765` (User `v3da`, WorkingDir `/home/v3da`) |
| `occt-server.service` | **User**-Unit (`~/.config/systemd/user/`) | 0.0.0.0:3001 (HTTPS) | `/usr/bin/node /home/v3da/occt-pool.js` — Pool vor occt-server.js; Env: `OCCT_WORKERS=4`, `OCCT_RSS_LIMIT_MB=2500`, `OCCT_MAX_JOBS=50`, `NODE_OPTIONS=--max-old-space-size=1024` |
| nginx | System | 18790 (SSL, Tailscale-Cert), 8080, 80 | vhosts s.u. |

Auslieferung produktiv: **Tailscale Funnel** `https://v3da.tailf05fe9.ts.net/` → `127.0.0.1:8765` (nicht nginx!). nginx :18790 bedient v. a. OCCT-Endpunkte + openclaw (:18789).

Auf netcup ersetzt nginx (443, Let's Encrypt) den Funnel: `/` → proxy 8765, OCCT-Pfade → proxy 3001.

## 2. Versionen (netcup identisch installieren)

- Node **v22.22.2**, npm 10.9.7 (NodeSource/nvm, Major 22 zwingend — OCCT-WASM versionsempfindlich)
- Python **3.10.12** (Debian 13 bringt 3.13 — volme3d_server.py ist Stdlib-pur, vorauss. unkritisch; testen!)
- nginx 1.18.0 (Debian 13: neuer, hat `application/wasm` bereits in mime.types — 1.18 NICHT)

## 3. Anwendungsdateien (alle in `/home/v3da`, Git-Repo = ganzes Home)

Kern (alles **im Git**, keine WASM-Builds nötig — Artefakte sind eingecheckt):
- `volme3d.html` (Arbeitskopie), `volme3d.dist.html` (Build-Artefakt, .gitignore → auf netcup via `npm run build` erzeugen)
- `volme3d_server.py`, `v3d_auth.py` (Login: Firebase-ID-Token → `v3dsess`-Cookie), `start.html`, `login`-Seiten
- `occt-pool.js`, `occt-server.js`, `occt-hollow-worker.js`
- WASM: `volme3d-occt.js` + `volme3d-occt.wasm` (+`.gz`), `volme3d.js`/`volme3d.wasm`, `lib/manifold.wasm` — **im Git**
- `build.js`, `smoke.mjs`, `package.json`/`package-lock.json` (deps: express, manifold-3d, opencascade.js; dev: terser, playwright, firebase)
- `volmedraw/` (volmedraw.html + lib/ Fonts/JS — wird von server.py mit ausgeliefert → **wandert mit**)
- `volmeslice/volmeslice.html`, `abstimmung.html`, `ansehen.html`, `mitsehen.html`, `favicon.svg`, `logo.svg` (ALLOW-Liste in server.py)
- `firestore.rules`, `firebase.json`, `.firebaserc` (Projekt `volme3d`)
- `videos/out/` — Howto-Videos (eigener Auslieferungszweig in server.py; prüfen ob vorhanden/mitkopieren)

Git: Pack ~56 MiB. CAD-relevante Dateien alle committet (einzig `volmedraw/_shift_test.mjs` untracked — noch committen). Die ~1765 dirty Einträge betreffen andere Projekte (volmestick/orca-wasm), nicht CAD.

## 4. Secrets/Configs (NICHT im Git — per rsync kopieren)

- `~/.config/volme3d/hf_token` — HuggingFace-Token (KI-Generierung FLUX/Hunyuan3D)
- `~/.config/volme3d/session_secret` — signiert die `v3dsess`-Session-Cookies (`v3d_auth.py`)
- TLS für occt-pool 3001: `/home/v3da/v3da.tailf05fe9.ts.net.crt`/`.key` (Tailscale-Cert, **hartkodiert** in occt-pool.js:43 u. occt-server.js:1533) → auf netcup: eigenes selbstsigniertes Cert für 127.0.0.1 ODER Pool auf HTTP/127.0.0.1 umstellen (nginx terminiert TLS)
- `~/.env` (PostgreSQL claude_sync) — gehört NICHT zu V3D CAD, wandert nicht mit

## 5. Hartkodierte Tailscale-URLs (müssen in der Kopie umgestellt werden)

- `volme3d.html:17489` — `https://v3da.tailf05fe9.ts.net:18790/api/occt-subtract` (Fetch! der bekannte Funnel-Stolperstein)
- `volme3d.html:20876` — `https://v3da.tailf05fe9.ts.net:10000/app/` (V3D-Slicer-Link)
- `volme3d.html:2851` — QR-Platzhaltertext (kosmetisch)
- occt-pool.js/occt-server.js — Cert-Pfade (s. o.)
- Empfehlung: `_OCCT_BASE`-artige Config-Variable statt Hartkodierung (spart Arbeit beim echten Umzug)

## 6. nginx auf V3DA (Referenz)

- `sites-enabled/openclaw` (:18790 SSL): `/api/occt-subtract`, `/api/occt-hollow-lid`, `/occt-health` → `https://127.0.0.1:3001` (`proxy_ssl_verify off`, `proxy_read_timeout 300s`, `client_max_body_size 100m`); `/volme3d-export.stl` → 8765; `/` → 18789 (openclaw, wandert NICHT mit)
- `sites-enabled/occt-proxy` (:8080), `sites-enabled/default` (:80) — nur Export-STL/Health-Varianten
- Merke fürs netcup-vhost: OCCT-Timeouts 300–600 s, body 100 m, `application/wasm` MIME (server.py setzt MIME selbst, nginx-MIME nur relevant falls statisch via nginx)

## 7. Cron/Backups auf V3DA

- `pg_backup_claude_sync.sh` (03:00) und `vhs95-backup-sync.sh` (03:30) — **nicht** CAD-bezogen, wandern nicht mit.
- Kein CAD-eigener Cronjob.

## 8. Firebase / extern

- Firebase-Projekt `volme3d` (Config inline in volme3d.html ab Zeile ~1032; apiKey clientseitig = ok)
- **TODO netcup:** neue Subdomain in Authentication → Authorized domains eintragen, sonst Login ohne brauchbare Fehlermeldung tot
- Firestore: Test-Instanz greift auf DIESELBE Produktiv-DB zu → bewusst entscheiden (eigenes Projekt/Prefix?)
- HuggingFace ZeroGPU (hf_token) für KI-Generierung
- Origin-Allowlist in occt-server.js:658 — Regex erlaubt localhost/192.168.x/10.x/172.16-31.x/*.ts.net → **neue Domain ergänzen!**

## 9. Neuer Server / Zugang

- Host-Key-Fingerprints (aus netcup-Mail, am 01.09. gegen ssh-keyscan verifiziert — alle 3 identisch):
  - ED25519 `SHA256:VbXD/4YlMjJ5av33bf9iHC6cUJdLvxXBfJ18d8r63zo`
  - ECDSA `SHA256:FzpakOkQ/5OMOECt/E2wY5MKkkW3NIIVh2Mghby9Kpo`
  - RSA `SHA256:myU+UWU2bFpdv1R2uohLXyQqTdRhqxdz2sSIwIrwZlU`
- Migrations-Key auf V3DA: `~/.ssh/id_ed25519_netcup` (`SHA256:hs21Tby1Khp+PxD5UxtOp/dCZjPpX29KPhcut0lAhGM`)
- netcup-Vorgabe-Firewall blockt SMTP (Policy „netcup Mail Block" im SCP) — für CAD egal
- SCP: Benutzer 419577, https://www.servercontrolpanel.de/SCP/ (Passwort ändern! steht im Klartext im Postfach)

## 10. Stand netcup-Server (01.09.2026 abends)

Erledigt:
- [x] Key-Bootstrap (root-PW-Reset via SCP + VNC-Konsole `PermitRootLogin yes` temporär; wieder entfernt)
- [x] Grundabsicherung: User `v3da` (sudo NOPASSWD, Keys: Migration/Desktop/Notebook), sshd `PermitRootLogin no` + `PasswordAuthentication no` (verifiziert), ufw 22/80/443, fail2ban (sshd, backend=systemd), unattended-upgrades, TZ Europe/Berlin, Hostname `v3d-cad-test` (+/etc/hosts), 4G-Swapfile
- [x] Pakete: git/nginx 1.26/build-essential/rsync/certbot; Node **22.23.2** (NodeSource node_22.x)
- [x] Repo via Git-Bundle → /home/v3da (Push extern geblockt; Remote-Ref `v3da/master`), `npm ci`, `npm run build` ok
- [x] Secrets + videos/out per rsync, checksummen-verifiziert
- [x] occt-pool: self-signed Cert unter den hartkodierten Tailscale-Pfadnamen (Code unverändert)
- [x] Dienste: volme3d.service (System) + occt-server.service (User-Unit, `loginctl enable-linger v3da`) laufen; Pool 4 Arbeiter, occtReady
- [x] nginx-vhost `v3d-cad` (Port 80, server_name v3dcad.volme3dakademie.de): `/`→8765, `/api/occt-*`+`/occt-health`→3001, robots.txt Disallow, gzip; von außen getestet (curl --resolve)
- [x] Fix committet (4989f7f): SVG-Gravur-Fetch → `_OCCT_BASE` (relativ), CORS-Allowlist + `*.volme3dakademie.de`. Auf netcup deployt; **auf V3DA nur committet, NICHT gebaut/deployt**
- Zugriff von V3DA: `ssh netcup` (Alias in ~/.ssh/config, Key id_ed25519_netcup)
- Python auf netcup ist 3.13 (V3DA 3.10) — volme3d_server.py läuft, weiter beobachten

Offen:
- [ ] DNS: `v3dcad.volme3dakademie.de` A→159.195.247.82, AAAA→2a0a:4cc0:61:1be8:b88b:42ff:fecc:742f (von Hand, goneo)
- [ ] certbot + HTTPS-Redirect (erst nach DNS), danach HTTPS-Funktionstests (Login, FS-Access-API, PWA)
- [ ] Firebase Console: `v3dcad.volme3dakademie.de` unter Authentication → Authorized domains (von Hand)
- [ ] SCP-Passwort ändern (von Hand; root-PW ist schon neu gesetzt)
- [ ] Entscheidung Firestore: Produktiv-DB mitnutzen oder trennen (Testdaten!)
- [ ] Entscheidung Basic-Auth/IP-Sperre für die Testphase
- [ ] Funktionstest-Durchlauf (Checkliste Punkt 8) nach TLS
- [ ] Später mit umziehen (heute NICHT Teil der Kopie): V3D Mail, VolmeRechnung, VolmeShop, Terminfinder, Fotobox, Quiz, Spiele, V3D Slicer (orca-wasm), MeshCentral, Frigate …
