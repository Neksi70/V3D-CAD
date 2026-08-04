# Howto-Videos

Erzeugt fertige Tutorial-Videos, indem die echte App per Playwright bedient und
dabei aufgenommen wird. Sprache kommt offline aus Piper, Ton und Untertitel
legt ffmpeg drunter.

Der Gewinn: Bei UI-Änderungen laufen alle Videos neu durch, statt sie neu
aufnehmen zu müssen. Nebenbei ist es ein Regressionstest — bricht eine
Aufnahme ab, stimmt etwas mit dem Generator nicht.

## Benutzung

```bash
npm run dev                          # Entwicklungsserver auf 8766 (Pflicht!)
node videos/make.mjs namensschild    # ein Video
node videos/make.mjs --alle          # alle Drehbücher
node videos/make.mjs namensschild --sichtbar   # Browser zum Zuschauen
```

Ergebnis in `videos/out/`:

| Datei                | Zweck                                            |
|----------------------|--------------------------------------------------|
| `<id>.mp4`           | 1920×1080, h264/aac, Untertitel fest im Bild     |
| `<id>.vtt`           | Untertitelspur für das `<video>` in der App      |
| `<id>.srt`           | Untertitel für den YouTube-Upload                |
| `<id>.youtube.txt`   | Titel, Beschreibung mit Kapitelmarken, Schlagwörter |
| `index.json`         | Verzeichnis; steuert die „? Video"-Knöpfe in der App |

`out/` und `work/` sind Build-Artefakte und nicht im Git — die Drehbücher schon.

## Ein neues Video anlegen

Eine Datei `scripts/<id>.mjs` nach dem Muster von `namensschild.mjs`:

```js
export default {
  id: 'vase',
  modal: 'vase-modal',        // dort hängt die App ihren "? Video"-Knopf ein
  title: 'Vasen & Übertöpfe',
  subtitle: 'Von der Kontur zum Druck',
  icon: '🏺',
  introText: 'Moin! …',       // wird über der Titelkarte gesprochen
  outroText: 'Viel Spaß …',
  scenes: [
    {
      kapitel: 'Form wählen',       // wird zur YouTube-Sprungmarke
      say: 'Der gesprochene Satz.',  // bestimmt, wie lange die Szene steht
      at: '#vase-shape',             // Scheinwerfer (folgt dem Element)
      run: async (v) => {            // was in der Szene passiert
        await v.slider('#vase-bauch', 40);
      },
    },
  ],
};
```

**Bewährter Aufbau** (~90 s): Ergebnis versprechen → Generator öffnen → die
drei bis vier Regler erklären, die wirklich etwas ändern → erstellen →
Ergebnis von allen Seiten → Druck-Check und Export.

### Szenen-API (`v`)

| Aufruf | Wirkung |
|---|---|
| `v.click(sel)` | Zeiger hinführen, Klickwelle, klicken |
| `v.type(sel, text)` | zeichenweise tippen (man soll es sehen) |
| `v.slider(sel, wert)` | Regler sichtbar ziehen, Wert läuft mit |
| `v.select(sel, wert)` / `v.check(sel, an)` | Auswahlfeld / Kontrollkästchen |
| `v.orbit({dx, dy, ms})` | Modell in der 3D-Ansicht drehen |
| `v.spot(sel)` / `v.unspot()` | Scheinwerfer setzen / aus |
| `v.until(fn)` | warten, bis die App etwas erfüllt |
| `v.eval(fn)`, `v.page`, `v.sleep(ms)` | Rohzugriff |

## Wie das Timing funktioniert

Zuerst wird gesprochen, dann gefilmt: Piper liefert die Dauer jedes Satzes, und
eine Szene bleibt immer mindestens so lange stehen. Dauert eine Aktion deutlich
länger als ihr Satz, warnt `make.mjs` — dann entsteht eine Tonlücke und der Text
sollte länger oder die Aktion kürzer werden.

Die Aufnahme beginnt erst mit dem ersten gerenderten Frame, nicht mit unserer
Stoppuhr. Da das Video exakt mit dem Schließen des Browsers endet, ergibt die
Differenz aus Stoppuhr und Videolänge genau diesen Versatz — er wird gemessen
und herausgerechnet. Deshalb darf am Ende nichts abgeschnitten werden.

## Voraussetzungen

Alles bereits vorhanden, keine neuen Abhängigkeiten:

- Playwright (`@playwright/test`)
- ffmpeg / ffprobe
- Piper mit `~/.local/share/piper-voices/de_DE-thorsten-medium.onnx`

## Ausspielung

**In der App:** `volme3d_server.py` liefert `/videos/…` aus (eigener Zweig mit
Range-Unterstützung). Die App lädt `index.json` und hängt in jedes Generator-
Fenster mit passendem `modal:` ein „? Video" — Generatoren ohne Video bekommen
keinen toten Knopf.

**YouTube:** `<id>.youtube.txt` enthält Titel, Beschreibung mit Kapitelmarken
und Schlagwörter, `<id>.srt` die Untertitel.
