# VolmeSlice Drucker-Brücke

Nimmt G-Code aus der Web-App entgegen und schickt ihn an einen Bambu-Drucker.
**LAN bevorzugt** (schnell, kein Konto), Cloud-Fallback ist vorbereitet.

Der Browser kann selbst kein MQTT/FTPS — deshalb dieser kleine Dienst auf dem
Server (Muster: occt-server). App → HTTPS → Brücke → Drucker.

## Einrichten

1. `cp printers.example.json printers.json` und eintragen:
   - **LAN-Modus am Drucker aktivieren** (Display: Einstellungen → Netzwerk →
     LAN-Modus). Dort stehen **IP** und **Zugangscode** (8-stellig).
   - **Seriennummer**: auf dem Gerät / in der Bambu-App.
   - `printers.json` ist in `.gitignore` und verlässt den Server nie.
2. Dienst starten: `node server.js` (Port 7781) — oder als systemd-Dienst
   (`volmeslice-bridge.service`).

Die Web-App findet die Brücke automatisch unter `<host>:7781` und blendet das
**„An Drucker senden"**-Panel ein, sobald mindestens ein Drucker konfiguriert ist.

## Sicherheit / Ehrlichkeit

- **Keine offizielle Bambu-API.** LAN nutzt das dokumentierte Community-Protokoll
  (OpenBambuAPI: MQTT 8883, FTPS 990, Nutzer `bblp`, Passwort = Zugangscode).
- **Cloud** (optional, noch nicht scharf): braucht dein Bambu-Login. Das steht
  ausschließlich in deiner `printers.json` auf deinem Server und geht nur an
  Bambu — nirgends sonst hin. Trage es nur ein, wenn du den Drucker wirklich aus
  der Ferne erreichen musst.
- Zugriff nur aus Tailnet/LAN/localhost (Origin-Allowlist wie occt-server).

## Noch am echten Drucker zu verifizieren

Ohne physischen Drucker konnte ich nur den Fehlerpfad testen. Beim ersten echten
Gerät zu prüfen:
- FTPS-Upload (Zielordner / Rechte).
- Das **Druckstart-Kommando** (`project_file`): Bambu erwartet je nach Firmware
  bestimmte Feldwerte. Der Upload allein ist unkritisch; falls der Start nicht
  greift, schicke ich dir per MQTT-Report die richtige Kommandoform.
