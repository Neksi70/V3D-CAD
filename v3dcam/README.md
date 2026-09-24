# V3D CAM — 3D-Fräsen

Aus einem **STEP- oder STL-Teil** plus einem **Rohteil** werden Werkzeugwege
zum **Schruppen** und daraus G-Code. Eigener Dienst auf **Port 8803**
(`v3dcam.service`), bewusst getrennt von V3D CAD: Das CAD ist 3,7 MB, die
jeder Kursteilnehmer lädt — ein 3D-CAM gehört da nicht hinein. Ein Fehler im
CAD gibt ein hässliches Modell, ein Fehler hier einen abgerissenen Fräser.

## Der gemeinsame Kern

`cam-kern.js` liegt **eine Ebene höher** (`~/cam-kern.js`) und wird von hier
nur ausgeliefert, nicht kopiert. Dieselbe Datei benutzt V3D CAD für sein
2,5D-CNC. Darin stehen Maschinen- und Materialtabellen, die Schnittwerte-
Rechnung, die Bahn-Mathematik und beide Postprozessoren (Fanuc, GRBL).

Warum das wichtig ist: Läge die Fanuc-Regel „jede Zahl braucht einen
Dezimalpunkt" (ohne Punkt liest die Steuerung `Z5` als 0,005 mm) in zwei
Kopien, wäre sie in einem halben Jahr in der einen korrigiert und in der
anderen nicht.

## Ein Koordinatensystem

Überall Maschinen-Millimeter, **Z nach oben** — auch in der Anzeige
(`camera.up = Z`). Damit entfällt jede Umrechnung und mit ihr die Klasse von
Fehlern, bei denen ein Werkzeugweg gespiegelt oder um 90° verdreht
herauskommt, ohne dass man es der Vorschau ansieht.

**Nullpunkt:** Z = 0 oben auf dem Rohteil, X/Y in seiner vorderen linken
Ecke — so wird auch an der Maschine angetastet.

## Wie das Schruppen rechnet

Je Z-Ebene ist die Frage nicht, wo das Teil auf dieser Höhe liegt, sondern
wo der **Schattenriss von allem darüber** liegt: Der Fräser kommt von oben,
was über ihm steht ist im Weg, auch wenn auf seiner Höhe gerade Luft ist.

Der Schatten wächst nach unten nur an, nie ab. Darum wird er **scheibenweise
aufsummiert** statt für jede Ebene neu aus dem ganzen Teil gerechnet — jede
Scheibe kommt genau einmal dran, das Ergebnis ist trotzdem exakt. Danach
`Rohteil − (Schatten + Aufmaß)` und diese Fläche mit den konzentrischen
Ringen aus dem Kern ausräumen (dieselbe Rechnung wie „Tasche" in V3D CAD).

Weil die freie Fläche nach unten nur schrumpft, darf der Fräser an der
nächsten Ebene senkrecht ansetzen: Dort hat die vorige Ebene schon geräumt.
Er tut es trotzdem mit Eintauch-Vorschub und höchstens eine Zustellung tief.

## Was NICHT geprüft wird

**Die Aufspannung.** V3D CAM weiß nichts von Schraubstock, Pratzen oder
davon, woran das Teil unten hängt, wenn rundum alles weggefräst ist. Das
steht auch als Warnung in der Oberfläche. Ebenso fehlen bisher:

- **Schlichten** (Kugelfräser über die Fläche) — bisher nur Schruppen
- **Restmaterial**: was ein dicker Fräser in den Ecken stehen lässt
- **Hinterschnitte melden**: was drei Achsen von oben nicht sehen
- **Mehrere Werkzeuge** in einem Programm
- **G41/G42**: die Bahnen sind fest versetzt gerechnet, ein nachgeschliffener
  Fräser lässt sich an der Steuerung nicht ausgleichen

## Betrieb

    systemctl --user restart v3dcam        # Dienst (Port 8803, nur 127.0.0.1)
    node tests/cam_test.mjs                # 16 Prüfungen gegen den laufenden Dienst

STEP läuft über `POST /api/step` ans lokale OCCT-Backend (HTTPS:3001, dasselbe
wie V3D CAD). Höchstens zwei Aufträge gleichzeitig, damit der Editor dort
nicht warten muss.

**Noch nicht im Funnel** — bisher nur lokal erreichbar. Das ist Absicht,
solange kein echtes Teil damit gefräst wurde.
