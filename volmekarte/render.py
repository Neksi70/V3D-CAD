#!/usr/bin/env python3
"""VolmeKarte - aus Panel-Inhalten wird das druckfertige PDF.

Arbeitsteilung mit der Oberflaeche: der Browser kennt die Schriftmetrik und
kann Bilder zuschneiden, also macht er Umbruch und Beschnitt und schickt
fertige Elemente in Millimetern (Ursprung links unten im Panel). Hier wird
nur noch platziert, gedreht und ins PDF geschrieben. Das haelt die Vorschau
und den Ausdruck zwangslaeufig deckungsgleich.
"""

import base64

import karte
import pdf

# Farben der Hilfslinien - hell genug, um beim Schneiden nicht zu stoeren
FALZ_FARBE = "#b0b0b0"
SCHNITT_FARBE = "#b0b0b0"


def _b64(wert):
    if not wert:
        return b""
    t = str(wert)
    if "," in t[:64] and t[:5] == "data:":
        t = t.split(",", 1)[1]
    return base64.b64decode(t)


def _panel_zeichnen(inhalt, panel, zaehler):
    """Inhalt eines Panels in das bereits gesetzte lokale Koordinatensystem
    zeichnen. Ursprung ist links unten im Panel."""
    breite = float(panel.get("_b", 0))
    hoehe = float(panel.get("_h", 0))

    grund = panel.get("hintergrund")
    if grund and str(grund).lower() not in ("", "none", "transparent"):
        inhalt.flaeche(0, 0, breite, hoehe, grund)

    for bild in panel.get("bilder") or []:
        roh = _b64(bild.get("jpeg"))
        if not roh:
            continue
        zaehler[0] += 1
        inhalt.bild("Bi%d" % zaehler[0], roh,
                    float(bild.get("x", 0)), float(bild.get("y", 0)),
                    float(bild.get("b", 0)), float(bild.get("h", 0)))

    for kasten in panel.get("flaechen") or []:
        inhalt.flaeche(float(kasten.get("x", 0)), float(kasten.get("y", 0)),
                       float(kasten.get("b", 0)), float(kasten.get("h", 0)),
                       kasten.get("farbe", "#000000"))

    for strich in panel.get("linien") or []:
        inhalt.linie(float(strich.get("x1", 0)), float(strich.get("y1", 0)),
                     float(strich.get("x2", 0)), float(strich.get("y2", 0)),
                     strich.get("farbe", "#000000"),
                     float(strich.get("staerke", 0.3)))

    for text in panel.get("texte") or []:
        inhalt.text(text.get("txt", ""),
                    float(text.get("x", 0)), float(text.get("y", 0)),
                    float(text.get("pt", 10)),
                    text.get("font", "Helvetica"),
                    text.get("farbe", "#000000"),
                    float(text.get("sperrung", 0)))


def bauen(aufbau, panels, hilfslinien=True, titel="VolmeKarte",
          einzelseiten=False):
    """aufbau: karte.Aufbau, panels: {Kennung: Panel-Inhalt} -> PDF-Bytes.

    einzelseiten=True fuer bereits gefalzte Rohlinge: dann kommt jedes Panel
    auf eine eigene Seite in Kartengroesse, weil der Drucker die gefaltete
    Karte je Durchlauf nur einseitig bedrucken kann.
    """
    if einzelseiten:
        return _einzelseiten(aufbau, panels, titel)
    dok = pdf.Dokument(titel)
    zaehler = [0]

    for nr, seite in enumerate(aufbau.anordnung()):
        blatt = dok.seite(aufbau.bogen_b, aufbau.bogen_h)

        for eintrag in seite:
            panel = dict(panels.get(eintrag["panel"]) or {})
            panel["_b"] = eintrag["b"]
            panel["_h"] = eintrag["h"]

            blatt.sichern()
            blatt.verschieben(eintrag["x"], eintrag["y"])
            if eintrag["drehung"] == 180:
                blatt.drehen180(eintrag["b"], eintrag["h"])
            # Beschneiden, damit ein zu grosses Bild nicht ins Nachbarpanel
            # laeuft - genau das passiert sonst beim Randabfallend-Setzen.
            blatt.beschneiden(0, 0, eintrag["b"], eintrag["h"])
            _panel_zeichnen(blatt, panel, zaehler)
            blatt.zuruecksetzen()

        if hilfslinien:
            _hilfslinien(blatt, aufbau, seite, nr)

    return dok.bytes()


def _hilfslinien(blatt, aufbau, seite, nr):
    """Falzlinie und - wenn die Karte kleiner als der Bogen ist -
    Schnittmarken. Bewusst duenn und hellgrau."""
    falz = aufbau.falzlinie()
    if falz:
        blatt.linie(falz[0], falz[1], falz[2], falz[3],
                    FALZ_FARBE, 0.15, gestrichelt=True)

    for eintrag in seite:
        x, y, b, h = eintrag["x"], eintrag["y"], eintrag["b"], eintrag["h"]
        randlos_x = abs(x) < 0.01 and abs(b - aufbau.bogen_b) < 0.01
        randlos_y = abs(y) < 0.01 and abs(h - aufbau.bogen_h) < 0.01
        if randlos_x and randlos_y:
            continue
        laenge = 4.0
        for mx, my, dx, dy in ((x, y, -1, 0), (x, y, 0, -1),
                               (x + b, y, 1, 0), (x + b, y, 0, -1),
                               (x, y + h, -1, 0), (x, y + h, 0, 1),
                               (x + b, y + h, 1, 0), (x + b, y + h, 0, 1)):
            x2 = min(max(mx + dx * laenge, 0), aufbau.bogen_b)
            y2 = min(max(my + dy * laenge, 0), aufbau.bogen_h)
            if abs(x2 - mx) > 0.05 or abs(y2 - my) > 0.05:
                blatt.linie(mx, my, x2, y2, SCHNITT_FARBE, 0.15)


def _einzelseiten(aufbau, panels, titel):
    """Je Panel eine Seite in Kartengroesse, aufrecht - fuer Rohlinge, die
    schon gefalzt in den Drucker gehen."""
    dok = pdf.Dokument(titel)
    zaehler = [0]
    for kennung in aufbau.panels():
        blatt = dok.seite(aufbau.karte_b, aufbau.karte_h)
        panel = dict(panels.get(kennung) or {})
        panel["_b"] = aufbau.karte_b
        panel["_h"] = aufbau.karte_h
        blatt.sichern()
        blatt.beschneiden(0, 0, aufbau.karte_b, aufbau.karte_h)
        _panel_zeichnen(blatt, panel, zaehler)
        blatt.zuruecksetzen()
    return dok.bytes()


# ----------------------------------------------------------------------
def testdruck(aufbau):
    """Zwei Seiten zum Einrichten des Druckers.

    Seite 1 traegt ein 100-mm-Lineal: kommt das nicht auf 100 mm heraus,
    steht der Druckdialog auf „An Seite anpassen“ statt auf 100 %.
    Beide Seiten tragen einen Pfeil. Auf dem GEDRUCKTEN Blatt muessen beide
    nach oben zeigen - tut die Rueckseite das nicht, ist die Wenderichtung
    falsch eingestellt. Im PDF steht der Pfeil auf Seite 2 deshalb ggf.
    schon auf dem Kopf; das ist die Vorabdrehung und genau richtig.
    """
    dok = pdf.Dokument("VolmeKarte Testdruck")
    B, H = aufbau.bogen_b, aufbau.bogen_h

    for nr in range(2):
        blatt = dok.seite(B, H)
        blatt.sichern()
        if nr == 1 and aufbau.rueckseite_drehen:
            blatt.drehen180(B, H)

        mitte = B / 2.0
        oben = H - 20.0

        # Pfeil nach oben, mittig
        blatt.linie(mitte, oben - 26, mitte, oben, "#000000", 1.2)
        blatt.linie(mitte, oben, mitte - 5.5, oben - 7.5, "#000000", 1.2)
        blatt.linie(mitte, oben, mitte + 5.5, oben - 7.5, "#000000", 1.2)

        beschriftung = "VORDERSEITE" if nr == 0 else "RÜCKSEITE"
        blatt.text(beschriftung, mitte - 21, oben - 36, 14, "Helvetica-Bold")
        blatt.text("Auf dem gedruckten Blatt muss dieser Pfeil auf BEIDEN "
                   "Seiten nach oben zeigen.",
                   12, 16, 8.5, "Helvetica", "#555555")
        blatt.text("Zeigt er auf der Rückseite nach unten: in VolmeKarte die "
                   "Wenderichtung umstellen.",
                   12, 10.5, 8.5, "Helvetica", "#555555")

        if nr == 0:
            _lineale(blatt, B, H)

        falz = aufbau.falzlinie()
        if falz:
            blatt.linie(falz[0], falz[1], falz[2], falz[3],
                        FALZ_FARBE, 0.15, gestrichelt=True)
            if aufbau.falz == "quer":
                blatt.text("Falz", 3, falz[1] + 1.5, 7, "Helvetica", "#999999")
            else:
                blatt.text("Falz", falz[0] + 1.5, 3, 7, "Helvetica", "#999999")

        blatt.zuruecksetzen()

    return dok.bytes()


def _lineale(blatt, B, H):
    """Massstab-Kontrolle: waagerecht 100 mm, senkrecht 50 mm. Die beiden
    liegen bewusst weit auseinander, damit sich nichts ueberdeckt."""
    # waagerecht, mittig auf halber Blatthoehe
    laenge = min(100.0, B - 30.0)
    lx = (B - laenge) / 2.0
    ly = H * 0.52
    blatt.linie(lx, ly, lx + laenge, ly, "#000000", 0.4)
    schritte = int(laenge // 10)
    for k in range(schritte + 1):
        hoch = 5.0 if k % 5 == 0 else 3.0
        blatt.linie(lx + k * 10, ly, lx + k * 10, ly + hoch, "#000000", 0.4)
    blatt.text("%d mm — bitte mit dem Lineal nachmessen" % (schritte * 10),
               lx, ly - 6, 10, "Helvetica-Bold")
    blatt.text("Stimmt die Länge nicht, im Druckdialog „Tatsächliche Größe“ "
               "bzw. 100 % einstellen.", lx, ly - 12, 8.5, "Helvetica",
               "#555555")

    # senkrecht, links unten - weit weg vom waagerechten Lineal
    hoehe = min(50.0, H * 0.3)
    sx = 22.0
    sy = H * 0.14
    blatt.linie(sx, sy, sx, sy + hoehe, "#000000", 0.4)
    for k in range(int(hoehe // 10) + 1):
        breit = 5.0 if k % 5 == 0 else 3.0
        blatt.linie(sx, sy + k * 10, sx + breit, sy + k * 10, "#000000", 0.4)
    blatt.text("%d mm" % int(hoehe // 10 * 10), sx + 7, sy + hoehe - 2, 9,
               "Helvetica-Bold")
    blatt.text("senkrecht", sx + 7, sy + hoehe - 7, 8, "Helvetica", "#555555")
