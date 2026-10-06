# V3D Transkript

Gesprochenes Wort aus einem WhatsApp-Video (oder einer Sprachnachricht) als Text.
Videos **ohne Ton** (Bildschirmaufnahmen, abgefilmte Monitore) laufen im
[Bildmodus](#bildmodus-videos-ohne-ton): Schlüsselbilder + erkannter Text als
Markdown/JSON/ZIP für die Auswertung mit Claude.

- **Lokal:** http://127.0.0.1:8792
- **Öffentlich:** https://v3da.tailf05fe9.ts.net/transkript
- **Zugangscode:** `code` in `config.json`. **Leer = offen für jeden**, der die
  Adresse kennt (so läuft es aktuell). Zum Absichern ein Wort eintragen und
  `systemctl --user restart v3dtranskript`.
- **Dienst:** `systemctl --user status|restart v3dtranskript`

## Ablauf
1. Video/Audio hochladen (Handy: „Datei auswählen" → Galerie/WhatsApp-Ordner)
2. `ffmpeg` löst die Tonspur heraus (16 kHz mono)
3. **faster-whisper** (CPU, int8) verschriftlicht sie
4. Ergebnis: Fließtext, Zeitmarken-Ansicht, Kopieren, Download `.txt` / `.srt`

Modus **automatisch** (Standard): hat das Video keine oder eine stille Tonspur,
oder findet Whisper darin keine Sprache, geht es in den Bildmodus.

Modus **Ton + Bilder** (`modus=beides`): erst Whisper (mit Wort-Zeitmarken), dann
Szenenbilder + OCR wie im Bildmodus. Jedes Bild bekommt das Gesprochene bis zum
nächsten Bild – zugeordnet nach der *Mitte* jedes Worts (Abschnitte und
Wortanfänge legt Whisper oft schon in die Pause davor). Markdown/JSON/ZIP
enthalten pro Bild „Gesprochen" + „Text im Bild"; `.srt` bleibt der Ton.

Ein Job nach dem anderen (Warteschlange), damit die CPU nicht überläuft.
Grobe Faustregel auf dieser Kiste: `small` ≈ 6–8× schneller als Echtzeit,
`medium` etwa 3× langsamer als `small`, dafür genauer bei Dialekt/Nebengeräuschen.

## Formate
Alles, was ffmpeg lesen kann — geprüft mit `tests/formate_test.py`:
`.opus` (WhatsApp-Sprachnachricht), `.ogg`/`.oga`, `.m4a`, `.3gp`, `.mp3`,
`.aac`, `.wav`, `.mp4`. `.amr` liest ffmpeg auch (Dekoder amrnb/amrwb da),
schreiben kann er es hier nicht — darum im Test nicht enthalten.
Maximal 800 MB pro Datei, mehrere auf einmal gehen (laufen nacheinander).

Das Dateifeld hat **absichtlich kein `accept`**: Android blendet sonst die
Sprachnachrichten aus dem WhatsApp-Ordner im Auswahldialog aus.

## Dateien
    server.py        HTTP-Server, Warteschlange, Whisper-Anbindung, Modus-Weiche
    bildmodus.py     Bildmodus (Modul für den Server UND eigenständige Kommandozeile)
    app.html         Oberfläche (eine Seite, handytauglich)
    config.json      Zugangscode + Voreinstellungen  (nicht weitergeben)
                     optional "tesseract": "/pfad/zu/tesseract" für den Bildmodus
    requirements-bildmodus.txt  Python-Pakete des Bildmodus
    data/jobs/       je Job eine JSON mit Text + Segmenten (+ Bildliste)
    data/medien/     hochgeladene Dateien (mit dem Job gelöscht)
    data/bilder/<job>/   Bildmodus-Ergebnis: bilder/*.png, bildprotokoll.md/.json, bildmodus.log
    data/sitzungen.json  angemeldete Browser (überlebt Neustart)
    tests/ui_test.mjs    Playwright-Durchlauf: Anmelden → Hochladen → Text
    tests/testvideo.py        erzeugt die Testvideos für den Bildmodus
    tests/bildmodus_test.py   Unit-/Pipeline-/CLI-Tests Bildmodus (Windows + Ubuntu)
    tests/bildmodus_server_test.py  Upload → Erkennung → Bilder/MD/JSON/ZIP → Löschen
    tests/bild_ui_test.mjs    Playwright-Durchlauf Bildmodus (Galerie, ZIP)

Jobs älter als 14 Tage räumt der Server beim Start selbst weg.

## Test
    node tests/ui_test.mjs                     # kurzes Testvideo
    node tests/ui_test.mjs 8792 /pfad/zur.mp4  # eigenes Material
    node tests/pfad_test.mjs                   # Funnel-URL mit und ohne Schlussstrich
    python3 tests/formate_test.py              # alle Ton-/Videoformate durch
    .venv/bin/python tests/bildmodus_test.py         # Bildmodus, ~40 s
    .venv/bin/python tests/bildmodus_server_test.py  # eigene Server-Instanz auf 18792
    .venv/bin/python tests/testvideo.py /tmp/bmtest && node tests/bild_ui_test.mjs 8792

## Fallen
- `tailscale serve --set-path …` schaltet den Funnel auf 443 ab!
  Richtig ist `tailscale funnel --bg --https=443 --set-path /transkript http://127.0.0.1:8792`.
- Hinter dem Funnel kommt der Pfad `/transkript` **nicht** am Server an. Relative
  URLs allein reichen nicht: ruft man `…/transkript` **ohne** Schrägstrich am Ende
  auf, löst der Browser `api/ping` gegen `/` auf und landet beim CAD-Server auf
  8765 („Server nicht erreichbar"). Darum leitet `app.html` die Basis selbst aus
  `location.pathname` ab (`const BASIS`/`u()`). Prüfen mit `node tests/pfad_test.mjs`.
- Modelle liegen im Cache unter `~/.cache/huggingface/hub` (tiny/base/small/medium
  sind schon da, `medium` lädt beim ersten Mal nichts nach).

## Bildmodus (Videos ohne Ton)

Für stumme Videos - typischerweise Bildschirmaufnahmen, auch mit dem Handy vom
Monitor abgefilmt. Heraus kommen die **Schlüsselbilder** (PNG, max. 1280 px breit,
Zeitstempel im Namen), der **erkannte Text** je Bild und daraus

- `bildprotokoll.md` - Zeitstempel, Bildpfad und OCR-Text je Bild plus Auftrag
  „Was macht die Person Schritt für Schritt?" - **zusammen mit dem Ordner `bilder/`
  direkt an Claude geben** (in der Oberfläche: Knopf **„ZIP für Claude"**)
- `bildprotokoll.json` - dieselben Daten zur Weiterverarbeitung
- `bildmodus.log` - was passiert ist (z. B. angehobener Schwellwert)

### Wann greift er?
- **automatisch**, wenn ffprobe keine Tonspur findet oder die Tonspur still ist
  (`volumedetect`: Spitzenpegel ≤ −50 dB). Im Server zusätzlich, wenn Whisper in
  einer hörbaren Tonspur keine Sprache findet (Musik, Rauschen, Piepton).
- **manuell**: Oberfläche „Modus → Bildmodus", Kommandozeile `--modus bild`.

### Ablauf
1. **Kandidaten** in EINEM ffmpeg-Lauf:
   `select='eq(n,0)+gt(scene,S)+gte(t-prev_selected_t,I)'` - Szenenwechsel über
   Schwellwert S, und spätestens alle I Sekunden ein Bild (lange Standphasen fehlen
   nicht). Zeitstempel und Szenenwert kommen per `metadata=print` mit.
2. **Entzerren** (nur wenn eingeschaltet, für abgefilmte Monitore): Monitorfläche als
   größtes plausibles Viereck finden (Kanten + helle Fläche), Perspektive gerade
   ziehen, dunklen Gehäuserand abschneiden; später Moiré dämpfen, Kontrast (CLAHE)
   und Schärfe anheben. Echte Bildschirmaufnahmen werden dabei nicht beschnitten.
3. **Duplikate raus**: Perceptual Hash (pHash 16×16 = 256 Bit) gegen das zuletzt
   *behaltene* Bild - ein Rücksprung auf eine frühere Ansicht bleibt ein Schritt.
   **Grenzfälle** (Abstand 5…Toleranz) entscheidet bei Bildschirmaufnahmen die
   Texterkennung: ändert sich nur eine Ziffer, bleibt das Bild; wandert nur die
   Maus, fliegt es raus.
4. **Obergrenze** (Standard 60): wird sie überschritten, hebt das Programm den
   Schwellwert stufenweise an (0,015 … 1,0; aus dem Vorrat, ohne neu zu dekodieren),
   notfalls das Intervall - und vermerkt jeden Schritt im Log und im Markdown.
5. **OCR** mit Tesseract (`deu+eng`), parallel. Schwache Erkennung (Ø Konfidenz
   unter 75 %) wird **gekennzeichnet, nicht verworfen**; unsichere Wörter werden
   gelistet.

### Voreinstellungen - und warum nicht 0,15
Gemessen an den Testvideos (`tests/testvideo.py`) liefert ffmpegs Szenenwert bei
Bildschirmaufnahmen sehr kleine Zahlen:

| Änderung | Szenenwert | pHash-Abstand (von 256) |
|---|---|---|
| Mauszeiger bewegt | 0,0008 | 12–20 |
| eine Ziffer anders | ~0,0005 | 8 |
| eine Zeile anders | – | 36 |
| neuer Schritt im selben Fenster | 0,026–0,033 | 42–82 |
| Handy-Wackeln/Rauschen (abgefilmt) | 0,005–0,02 | 2–10 |

Mit Schwellwert 0,15 fiele also praktisch jeder Schritt durch und nur das
10-s-Intervall würde etwas liefern. Darum: **Schwellwert 0,01**, **Toleranz 24**,
**Intervall 10 s**, **max. 60 Bilder**, **OCR schwach unter 75 %** (Tesseract gibt
selbst Buchstabensalat noch 57–70 %). Alles per Option änderbar.

### Oberfläche
Modus wählen, Haken „vom Monitor abgefilmt (entzerren)" und „Text in Bildern
erkennen (OCR)"; unter „Feineinstellungen" Start/Ende, Schwellwert, Intervall,
Bildobergrenze, Toleranz. Ergebnis als Galerie mit Text unter jedem Bild,
Downloads `ZIP für Claude`, `.md`, `.json`, `.txt`.
Fehlt dem Server Tesseract, läuft der Bildmodus ohne Texterkennung weiter und
zeigt die Installationsanleitung als Hinweis.

### Kommandozeile (Windows + Ubuntu, ohne Server)
    python bildmodus.py --pruefen                          # Abhängigkeiten prüfen
    python bildmodus.py aufnahme.mp4                       # -> ./aufnahme_bildprotokoll/
    python bildmodus.py aufnahme.mp4 -o ergebnis --start 1:30 --ende 4:00
    python bildmodus.py handyvideo.mp4 --entzerren --max-bilder 40
    python bildmodus.py aufnahme.mp4 --schwelle 0.03 --toleranz 16 --intervall 20
    python bildmodus.py aufnahme.mp4 --kein-ocr            # nur Bilder
    python bildmodus.py mit_ton.mp4 --modus bild           # auch wenn Ton da ist

Rückgabewerte: 0 ok · 1 Fehler (z. B. defektes Video) · 2 falsche Eingabe ·
3 Video hat hörbaren Ton (dann Sprachmodus oder `--modus bild`) · 4 Abhängigkeit fehlt.
Alle Optionen: `python bildmodus.py -h`.

### Installation
**Ubuntu**

    sudo apt install ffmpeg tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng
    .venv/bin/pip install -r requirements-bildmodus.txt     # (oder python3 -m pip ...)
    .venv/bin/python bildmodus.py --pruefen

**Windows** (PowerShell)

    winget install --id Gyan.FFmpeg -e
    winget install --id UB-Mannheim.TesseractOCR -e
    py -m venv .venv
    .venv\Scripts\pip install -r requirements-bildmodus.txt
    .venv\Scripts\python bildmodus.py --pruefen

Tesseract landet unter `C:\Program Files\Tesseract-OCR` und wird dort auch ohne
PATH-Eintrag gefunden (sonst `TESSERACT_CMD` setzen oder `--tesseract <pfad>`).
Meldet `--pruefen`, dass das deutsche Sprachpaket fehlt, gibt es gleich den
passenden Download-Befehl für `deu.traineddata` mit aus (PowerShell als Administrator).
Nach der ffmpeg-Installation ein **neues** Terminal öffnen, damit der PATH greift.
**Stand 28.09.2026:** entwickelt und getestet unter Ubuntu 22.04 (ffmpeg 4.4,
Tesseract 4.1). Windows-Besonderheiten sind eingebaut (Umlaute in Pfaden, kein `:`
im Dateinamen, `-fps_mode` ab ffmpeg 5.1, Tesseract-Standardpfad), aber noch nicht
auf einem Windows-Rechner ausprobiert - erster Schritt dort:
`.venv\Scripts\python tests\bildmodus_test.py`.
Den Server kann man unter Windows genauso starten (`.venv\Scripts\python server.py`,
dann http://127.0.0.1:8792); für den Sprachmodus zusätzlich `pip install faster-whisper`.

### Fehlerbilder
- defekte/abgerissene Datei: ffprobe/ffmpeg-Meldung wird übersetzt; ist nur das
  Ende kaputt, werden die lesbaren Bilder verwendet (Warnung im Log)
- reine Tondatei im Bildmodus: klare Meldung „keine Bildspur"
- Start hinter dem Videoende / Ende vor Start: Fehlermeldung; Ende hinter dem
  Videoende wird gekappt (Warnung)
- Ausgabeordner mit fremden Dateien wird nie überschrieben
