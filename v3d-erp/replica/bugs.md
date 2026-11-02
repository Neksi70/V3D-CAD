# Fehler aus dem Replica-Test (2026-11-02)

Gefunden mit `e2e/` (Playwright, Chromium) gegen frische Testdaten. Nur reproduzierte Fehler stehen hier.
Für jeden Fehler gab es erst einen fehlschlagenden Test, dann die Korrektur. Alle Tests bleiben in der Suite.

| ID | Schwere | Kurz | Status |
| --- | --- | --- | --- |
| BUG-001 | S3 | Neuer Artikel ohne Kurzbezeichnung → Serverfehler | behoben 2a37d4d9 |
| BUG-002 | S3 | Feldbeschriftungen für Screenreader nicht zugeordnet | behoben 2a37d4d9 |
| BUG-003 | S4 | Fachliche Fehler zusätzlich als Konsolenfehler | behoben 2a37d4d9 |
| BUG-004 | S3 | Seiten auf dem Handy breiter als der Bildschirm | behoben 2a37d4d9 |
| BUG-005 | S3 | Mahnsperre-Häkchen verdreht und verrutscht | behoben 2a37d4d9 |

Offen: S1 0 · S2 0 · S3 0 · S4 0.

### BUG-001: Neuer Artikel ohne Kurzbezeichnung → „Interner Fehler“

- Schwere: S3 (Umgehung: Kurzbezeichnung von Hand eintragen)
- Ablauf / Fall: F12 / F12-E2
- Maske: S08 Artikel · Build: a3b2a828 · Chromium 1440 px

Schritte
1. Stammdaten → Artikel → Neu
2. Nur „Bezeichnung“ ausfüllen, Speichern

Erwartet: Artikel wird gespeichert, Kurzbezeichnung = Anfang der Bezeichnung
Tatsächlich: Meldung „Interner Fehler: NOT NULL constraint failed: artikel.kurz“, HTTP 500
Beleg: Fall F12-E2, Python-Test `TestBugs.test_bug001_artikel_ohne_kurzbezeichnung`
Ursache: Die Oberfläche schickt `kurz: null`. `setdefault` greift nur bei fehlendem Schlüssel, nicht bei `None`.
Status: behoben in 2a37d4d9 (`erp.artikel_speichern`). Der Fehler war schon vor den Änderungen vom 02.11. vorhanden.

### BUG-002: Eingabefelder ohne zugeordnete Beschriftung

- Schwere: S3 (für Screenreader-Nutzer gibt es keine Umgehung, sichtbar ist alles normal)
- Ablauf / Fall: alle Masken / Q-E5
- Build: a3b2a828

Schritte
1. Adresse → Neu
2. Feld „Name“ per Barrierefreiheitsbaum suchen (`getByLabel('Name')`)

Erwartet: Das Feld ist über seine Beschriftung erreichbar
Tatsächlich: 0 Treffer. `<label>` und `<input>` stehen nebeneinander, ohne `for`
Beleg: Fall Q-E5
Status: behoben in 2a37d4d9. `beschriftungen()` setzt nach jedem Bildaufbau `label[for]` (`.feld`) bzw. `aria-label` (Belegkopf `.bk-z`).
Eine vollständige Barrierefreiheitsprüfung (axe) steht noch aus, siehe unten.

### BUG-003: Fachliche Fehler landen zusätzlich als Fehler in der Konsole

- Schwere: S4 · Fall Q-N4
- Schritte: `#/beleg/999999` aufrufen
- Erwartet: Meldung „Beleg nicht gefunden.“
- Tatsächlich: Die Meldung kommt, zusätzlich steht „Error: Beleg nicht gefunden.“ als Konsolenfehler im Browser.
- Status: behoben in 2a37d4d9 (`navigiere` loggt nur noch Fehler, die nicht schon gezeigt wurden)

### BUG-004: Seiten auf dem Handy breiter als der Bildschirm

- Schwere: S3 (Umgehung: seitlich wischen) · Fall F08-E1 · 390×844
- Schritte: Zahlungsabgleich, Mahnwesen bzw. Projekte auf 390 px Breite öffnen
- Erwartet: Seite 390 px breit, breite Tabellen scrollen in sich
- Tatsächlich: Seitenbreite 452 / 583 / 729 px, die ganze Seite verschiebt sich
- Status: behoben in 2a37d4d9 (CSS: Tabellen in Karten scrollen auf schmalen Bildschirmen in sich, Belegblatt ausgenommen)

### BUG-005: Mahnsperre-Häkchen verdreht und an falscher Stelle

- Schwere: S3 · Fälle F06-E1, F08-E1 (`#/op/debitor` war 706 px breit)
- Maske: S19 Offene Posten Kunden

Schritte
1. Finanzen → Offene Posten Kunden
2. Spalte „Mahnung“ ansehen

Erwartet: normales Häkchen „Sperre“ in der Zeile
Tatsächlich: Das Häkchen ist absolut positioniert und um 45° gedreht (`position:absolute; transform:rotate(45deg)`).
Ursache: Es trug die Klasse `ms`, die schon für die Meilenstein-Rauten im Zeitstrahl vergeben ist.
Status: behoben in 2a37d4d9 (Klasse `mSperre`)

## Zu prüfen (nicht reproduziert bzw. nicht automatisch prüfbar)

- **DATEV-Import:** Die Datei hat Kopfzeile EXTF 700 und 14 Grundspalten. Ob DATEV Rechnungswesen sie ohne die übrigen Spalten annimmt, ist nicht geprüft. Vor dem Echtbetrieb muss der Steuerberater eine Probedatei einspielen.
- **Datum um Mitternacht:** Die Oberfläche nimmt „heute“ vom Gerät, der Server vom Server. Bei falsch gestellter Geräteuhr kann ein Beleg ein anderes Datum vorbelegt bekommen. Nicht beobachtet.
- **Barrierefreiheit insgesamt:** Kein axe-Scan, weil `@axe-core/playwright` nicht installiert ist. Kontraste, Tastaturfokus in Dialogen und Rollen der Menüs sind ungeprüft.
- **Testseitig, kein Programmfehler:** `test_erechnung_oberflaeche.mjs` liest den Fenstertitel zu früh („erBeleg“ schwankt zwischen zwei Werten).
