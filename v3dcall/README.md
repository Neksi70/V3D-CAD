# V3D Anrufannahme

Nimmt Anrufe entgegen, spricht den Anrufer mit natürlicher Stimme an,
nimmt eine Nachricht auf, schreibt sie mit und stellt sie als E-Mail zu.

```
Handy klingelt → du nimmst nicht ab
  → Rufumleitung „bei Nichtannahme“ auf die Festnetz-/SIP-Nummer
     → Fritzbox reicht an das registrierte IP-Telefon durch
        → Asterisk auf diesem Server
           Ansage (ElevenLabs) → Signalton → Aufnahme (max. 3 min)
           → faster-whisper (lokal, deutsch)
           → E-Mail mit Text + Audio-Anhang
           → Push aufs Handy
```

**Warum kein reines Handy-App-Konzept?** Weder iOS noch Android erlauben es
einer App, einen Mobilfunkanruf anzunehmen und Ton in die Leitung zu geben.
Das kann nur die Netz-/Systemebene. Darum läuft der Dialog auf dem Server,
und die App ist die Anzeige dazu.

## Bestandteile

| Datei | Zweck |
|---|---|
| `server.py` | Dienst auf **8786**, Weboberfläche + API, Funnel-Pfad **/anrufe** |
| `pipeline.py` | Aufnahme → Whisper → E-Mail → Push |
| `tts.py` | Ansagen über ElevenLabs erzeugen, für Asterisk aufbereiten |
| `core.py` | Konfiguration, SQLite-Ablage |
| `asterisk/` | pjsip-/Dialplan-Vorlagen + `install.sh` |
| `bin/v3dcall-notify` | Hook, den Asterisk beim Auflegen aufruft |
| `android/` | Quelltext der App, `V3D-Anrufe-1.0.apk` liegt daneben |
| `config.json` | **Zugangsdaten — nicht ins Git** (Modus 600) |

Dienst: `systemctl --user {status,restart} v3dcall`

## Noch zu erledigen

### 1. ElevenLabs-Schlüssel
Konto auf elevenlabs.io, Schlüssel unter *Profile → API Key*.
In der Weboberfläche unter **Einstellungen → ElevenLabs** eintragen,
speichern, dann **Stimmen laden**, eine deutsche Stimme wählen und
**Ansage neu erzeugen**. Mit **Anhören** gegenprüfen.

Der Ansagetext steht ebenfalls dort und ist frei änderbar — nach jeder
Änderung neu erzeugen, sonst hört der Anrufer noch die alte Fassung.

### 2. Postfach für den Versand
**Einstellungen → E-Mail-Zustellung**: Passwort zu `Info@volme3dakademie.de`
(goneo, SMTP 465) eintragen und das Empfänger-Postfach prüfen.

### 3. Fritzbox: IP-Telefon anlegen

**Netzaufbau hier:** FRITZ!Box 6690 Cable auf **192.168.2.1**, davor das
UniFi-Gateway (192.168.178.1), der Server auf 192.168.178.254. Asterisk
meldet sich also durch ein zweites NAT hindurch an. Vom Server aus ist
`192.168.2.1:5060` erreichbar; ob die Box die Anmeldung aus dem
Unternetz annimmt, zeigt erst der Versuch.

*Telefonie → Telefoniegeräte → Neues Gerät → Telefon → LAN/WLAN (IP-Telefon)*

- Benutzername und Passwort vergeben (Vorgabe hier: Benutzer `620`)
- Danach unter *Telefonie → Telefoniegeräte* festlegen, **welche
  Rufnummer** auf dieses Gerät geht — sonst klingelt es überall mit.
- Zugangsdaten in **Einstellungen → Telefon** eintragen und speichern.

### 4. Asterisk einrichten
```bash
sudo ~/v3dcall/asterisk/install.sh
```
Installiert Asterisk, legt `/var/spool/v3dcall` an, rollt Ansagen,
Dialplan und den Notify-Token aus und startet den Dienst.

Anmeldung prüfen:
```bash
sudo asterisk -rx 'pjsip show registrations'    # → Registered
sudo asterisk -rx 'dialplan show v3dcall'
```
Steht dort **nicht** „Registered", ist das doppelte NAT die wahrscheinliche
Ursache. Dann in `config.json` `asterisk.transport` von `udp` auf `tcp`
setzen und `install.sh` erneut laufen lassen — TCP übersteht NAT deutlich
besser. Hilft auch das nicht, muss die Fritzbox das Unternetz erreichen
können (statische Route im UniFi) oder der Server bekommt ein Bein direkt
ins 192.168.2.x-Netz.

Danach die Festnetznummer von einem anderen Telefon aus anrufen.
Mitlesen: `sudo asterisk -rvvv` und `journalctl --user -u v3dcall -f`

**Nach jeder Änderung an Ansage oder Telefon-Einstellungen `install.sh`
erneut ausführen** — es kopiert die neuen Dateien nach `/etc/asterisk`.

### 5. Rufumleitung am Handy
Am Mobiltelefon eintippen (Netzfunktion, kein App-Kram):

| Fall | Code |
|---|---|
| bei Nichtannahme | `**61*<Zielnummer>#` — nach ~20 s |
| bei besetzt | `**67*<Zielnummer>#` |
| bei Nichterreichbarkeit | `**62*<Zielnummer>#` |
| alle wieder abschalten | `##002#` |

Damit reicht es, den Anruf einfach klingeln zu lassen oder wegzudrücken.
Der Anrufer merkt nichts von der Umleitung.

### 6. App aufs Handy
Weboberfläche → **Einstellungen → Android-App → herunterladen**, oder
direkt `https://v3da.tailf05fe9.ts.net/anrufe/app.apk`.
Beim ersten Start nach dem Zugangsschlüssel fragen lassen.

Für **sofortige** Meldungen zusätzlich die Seite in Chrome über
*Zum Startbildschirm hinzufügen* installieren und dort **Push einschalten** —
Android lässt Hintergrundabfragen einer App frühestens alle 15 Minuten zu,
echtes Web-Push kommt dagegen sofort.

## Sicherheit

- Weboberfläche und API hängen am `adminKey` (Cookie `v3dcall`).
- `/api/incoming` nimmt nur Meldungen mit dem geteilten Token aus
  `/etc/v3dcall.token` an und weist alles ab, was Weiterleitungs-Header
  trägt. **Wichtig:** hinter dem Tailscale-Funnel kommt jeder Zugriff aus
  dem Internet mit `remote_addr 127.0.0.1` an — eine IP-Prüfung allein
  wäre wirkungslos.
- Der `file`-Parameter wird gegen `/var/spool/v3dcall` geprüft, damit sich
  darüber keine beliebige Datei verschieben lässt.
- Aufnahmen und Transkripte bleiben auf diesem Server. Nach außen geht
  nur der **Ansagetext** (einmalig, an ElevenLabs) — nie die Nachrichten
  der Anrufer.

## Wartung

Gesperrte Nummern: `blocklist` in `config.json` (Liste von Rufnummern,
exakt wie sie in der Oberfläche erscheinen). Aufnahmen liegen unter
`data/recordings/`, die Ablage in `data/calls.db`.
