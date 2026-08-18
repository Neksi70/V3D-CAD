#!/usr/bin/env python3
"""Prueft das Ausschiessen, indem der ganze Vorgang nachgespielt wird:
drucken -> Blatt wenden -> falzen -> Karte anschauen.

Der Test glaubt der Herleitung in karte.py also nicht, sondern rechnet den
Weg jedes Punktes nach. Kommt ein Panel gespiegelt oder auf dem Kopf heraus,
faellt das hier auf.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import karte  # noqa: E402


def _matrix(fn):
    """Affine Abbildung aus drei Proben herausziehen: (a,b,c,d,e,f)
    mit x' = a*u + c*v + e und y' = b*u + d*v + f."""
    e, f = fn(0.0, 0.0)
    x1, y1 = fn(1.0, 0.0)
    x2, y2 = fn(0.0, 1.0)
    return (x1 - e, y1 - f, x2 - e, y2 - f, e, f)


def kette(auf, kennung):
    """Panel-Koordinate (u,v) -> so, wie es der Betrachter der fertigen
    Karte sieht. Enthaelt Druck, Wenden des Druckers und das Falzen."""
    seiten = auf.anordnung()
    for nr, seite in enumerate(seiten):
        for eintrag in seite:
            if eintrag["panel"] == kennung:
                bogenseite, ein = nr, eintrag
                break
        else:
            continue
        break
    else:
        raise KeyError(kennung)

    B, H = auf.bogen_b, auf.bogen_h

    def auf_seite(u, v):
        """Panel-lokal -> Koordinaten der PDF-Seite."""
        if ein["drehung"] == 180:
            return (ein["x"] + ein["b"] - u, ein["y"] + ein["h"] - v)
        return (ein["x"] + u, ein["y"] + v)

    def auf_papier(p, q):
        """PDF-Seite -> Punkt auf dem Papier, in Vorderseiten-Koordinaten.
        Fuer Bogenseite 2 haengt das davon ab, um welche Kante der Drucker
        wendet."""
        if bogenseite == 0:
            return (p, q), "vorn"
        querformat = B > H
        if auf.wenden == "manuell":
            senkrecht = True          # Nutzer wendet laut Hinweis links/rechts
        else:
            lange_kante_senkrecht = not querformat
            wendet_um_lange = auf.wenden == "lang"
            senkrecht = (lange_kante_senkrecht if wendet_um_lange
                         else not lange_kante_senkrecht)
        if senkrecht:
            return (B - p, q), "hinten"
        return (p, H - q), "hinten"

    def ansicht(punkt, seite_papier):
        x, y = punkt
        if seite_papier == "hinten":
            # Rueckseite von hinten betrachtet: x spiegelt sich.
            xb, yb = B - x, y
        if auf.falz == "laengs":
            if seite_papier == "vorn":
                # geschlossene Karte: rechte Haelfte von vorn, linke von hinten
                return (x, y) if x >= auf.falz_pos else (x, y)
            return (xb, yb)                       # offene Karte
        if auf.falz == "quer":
            if seite_papier == "vorn":
                if y <= auf.falz_pos:
                    return (x, y)                 # Titel, von vorn
                return (B - x, H - y)             # Rueckseite, von hinten
            return (B - xb, H - yb)               # offene Karte
        # ohne Falz
        return (x, y) if seite_papier == "vorn" else (xb, yb)

    def gesamt(u, v):
        p, q = auf_seite(u, v)
        punkt, seite_papier = auf_papier(p, q)
        return ansicht(punkt, seite_papier)

    return gesamt


class TestAnordnung(unittest.TestCase):

    def _aufrecht(self, auf, kennung):
        """Linearer Anteil muss die Einheitsmatrix sein: nicht gedreht,
        nicht gespiegelt, nicht verzerrt."""
        a, b, c, d, e, f = _matrix(kette(auf, kennung))
        hinweis = "%s (%s, wenden=%s)" % (auf.beschriftung(kennung),
                                          auf.falz, auf.wenden)
        for wert, soll, name in ((a, 1, "a"), (b, 0, "b"),
                                 (c, 0, "c"), (d, 1, "d")):
            self.assertAlmostEqual(
                wert, soll, places=6,
                msg="%s steht falsch herum (%s=%.3f statt %d)"
                    % (hinweis, name, wert, soll))
        return e, f

    # -- Laengsfalz ---------------------------------------------------
    def test_laengsfalz_alle_panels_aufrecht(self):
        for wenden in ("lang", "kurz", "manuell"):
            auf = karte.Aufbau(297, 210, falz="laengs", wenden=wenden)
            for kennung in auf.panels():
                self._aufrecht(auf, kennung)

    def test_laengsfalz_positionen(self):
        auf = karte.Aufbau(297, 210, falz="laengs", wenden="kurz")
        # Titel und Rueckseite liegen in der geschlossenen Karte deckungsgleich
        tx, ty = self._aufrecht(auf, karte.TITEL)
        rx, ry = self._aufrecht(auf, karte.RUECK)
        self.assertAlmostEqual(tx - 148.5, rx, places=6)
        self.assertAlmostEqual(ty, ry, places=6)
        # Innen links liegt links, innen rechts rechts
        ax, _ = self._aufrecht(auf, karte.INNEN_A)
        bx, _ = self._aufrecht(auf, karte.INNEN_B)
        self.assertAlmostEqual(ax, 0.0, places=6)
        self.assertAlmostEqual(bx, 148.5, places=6)

    # -- Querfalz -----------------------------------------------------
    def test_querfalz_alle_panels_aufrecht(self):
        for wenden in ("lang", "kurz", "manuell"):
            auf = karte.Aufbau(210, 297, falz="quer", wenden=wenden)
            for kennung in auf.panels():
                self._aufrecht(auf, kennung)

    def test_querfalz_innen_oben_liegt_oben(self):
        auf = karte.Aufbau(210, 297, falz="quer", wenden="lang")
        _, ay = self._aufrecht(auf, karte.INNEN_A)   # innen oben
        _, by = self._aufrecht(auf, karte.INNEN_B)   # innen unten
        self.assertGreater(ay, by, "„Innen oben“ landet unter „Innen unten“")
        self.assertAlmostEqual(by, 0.0, places=6)
        self.assertAlmostEqual(ay, 148.5, places=6)

    def test_querfalz_titel_und_rueckseite_decken_sich(self):
        auf = karte.Aufbau(210, 297, falz="quer", wenden="kurz")
        tx, ty = self._aufrecht(auf, karte.TITEL)
        rx, ry = self._aufrecht(auf, karte.RUECK)
        self.assertAlmostEqual(tx, rx, places=6)
        self.assertAlmostEqual(ty, ry, places=6)

    # -- flache Postkarte ---------------------------------------------
    def test_ohne_falz(self):
        for wenden in ("lang", "kurz"):
            auf = karte.Aufbau(148, 105, falz="keine", wenden=wenden)
            for kennung in auf.panels():
                self._aufrecht(auf, kennung)

    # -- Wenderichtung ------------------------------------------------
    def test_wenderichtung(self):
        # Hochformat + lange Kante = senkrechte Achse -> kein Vordrehen
        self.assertFalse(karte.Aufbau(210, 297, wenden="lang").rueckseite_drehen)
        self.assertTrue(karte.Aufbau(210, 297, wenden="kurz").rueckseite_drehen)
        # Querformat: genau andersherum
        self.assertTrue(karte.Aufbau(297, 210, wenden="lang").rueckseite_drehen)
        self.assertFalse(karte.Aufbau(297, 210, wenden="kurz").rueckseite_drehen)

    # -- Karte kleiner als der Bogen ----------------------------------
    def test_kleiner_rohling_wird_zentriert(self):
        auf = karte.Aufbau(210, 297, falz="quer", karte_b=180, karte_h=120)
        seiten = auf.anordnung()
        titel = [e for e in seiten[0] if e["panel"] == karte.TITEL][0]
        self.assertAlmostEqual(titel["x"], 15.0, places=6)     # (210-180)/2
        self.assertAlmostEqual(titel["y"], 14.25, places=6)    # (148.5-120)/2
        for kennung in auf.panels():
            self._aufrecht(auf, kennung)

    # -- Falz ausserhalb der Mitte ------------------------------------
    def test_falz_ausserhalb_der_mitte(self):
        auf = karte.Aufbau(210, 297, falz="quer", falz_pos=120,
                           karte_b=200, karte_h=110)
        for kennung in auf.panels():
            self._aufrecht(auf, kennung)

    # -- Fehleingaben --------------------------------------------------
    def test_karte_zu_gross(self):
        with self.assertRaises(ValueError):
            karte.Aufbau(210, 297, falz="quer", karte_h=200)
        with self.assertRaises(ValueError):
            karte.Aufbau(210, 297, falz="laengs", karte_b=200)
        with self.assertRaises(ValueError):
            karte.Aufbau(0, 297)


if __name__ == "__main__":
    unittest.main(verbosity=2)
