#!/usr/bin/env python3
"""VolmeKarte - Ausschiessen: welches Panel landet wo auf dem Bogen?

Das ist der Kern. Wer eine Klappkarte selbst druckt, scheitert fast immer an
zwei Dingen:

  1. Bei einem Querfalz (Karte klappt nach oben) muessen Rueckseite UND der
     komplette Innenteil um 180 Grad gedreht gedruckt werden. Sonst steht
     entweder die Rueckseite oder der Innentext auf dem Kopf.
  2. Der Drucker wendet das Blatt entweder ueber die lange oder ueber die
     kurze Kante. Passt die Einstellung nicht zum Bogenformat, steht die
     zweite Bogenseite kopf.

Beides rechnet dieses Modul aus, damit der Nutzer nur Masse eingeben muss.

Herleitung der Regeln (einmal sauber durchgerechnet, Tests in tests/):

  Laengsfalz (Falz senkrecht, Karte klappt wie ein Buch zur Seite):
      Bogenseite 1:  links = Rueckseite (0 Grad) | rechts = Titel (0 Grad)
      Bogenseite 2:  links = Innen links (0)     | rechts = Innen rechts (0)

  Querfalz (Falz waagerecht, Karte klappt nach oben):
      Bogenseite 1:  oben = Rueckseite (180)     | unten = Titel (0)
      Bogenseite 2:  oben = Innen unten (180)    | unten = Innen oben (180)

  Ohne Falz (flache Postkarte):
      Bogenseite 1 = Vorderseite, Bogenseite 2 = Rueckseite
"""

# Panel-Kennungen. Bewusst sprechend statt "Seite 1..4" - so ist in der
# Oberflaeche sofort klar, was gemeint ist.
TITEL = "titel"
RUECK = "rueck"
INNEN_A = "innen_a"      # Laengsfalz: innen links   / Querfalz: innen oben
INNEN_B = "innen_b"      # Laengsfalz: innen rechts  / Querfalz: innen unten

BESCHRIFTUNG = {
    "laengs": {TITEL: "Titel (Vorderseite)", RUECK: "Rückseite",
               INNEN_A: "Innen links", INNEN_B: "Innen rechts"},
    "quer": {TITEL: "Titel (Vorderseite)", RUECK: "Rückseite",
             INNEN_A: "Innen oben", INNEN_B: "Innen unten"},
    "keine": {TITEL: "Vorderseite", RUECK: "Rückseite"},
}


class Aufbau:
    """Alle Masse einer Karte plus die daraus folgende Anordnung."""

    def __init__(self, bogen_b, bogen_h, falz="laengs", falz_pos=None,
                 wenden="lang", karte_b=None, karte_h=None,
                 versatz_x=0.0, versatz_y=0.0):
        self.bogen_b = float(bogen_b)
        self.bogen_h = float(bogen_h)
        if falz not in ("laengs", "quer", "keine"):
            raise ValueError("Falzart muss laengs, quer oder keine sein.")
        self.falz = falz
        if wenden not in ("lang", "kurz", "manuell"):
            raise ValueError("Wenderichtung muss lang, kurz oder manuell sein.")
        self.wenden = wenden
        # Versatz gleicht einen Drucker aus, der die Rueckseite verschoben
        # aufs Blatt legt (klassisch bei einfachen Duplex-Einheiten).
        self.versatz_x = float(versatz_x)
        self.versatz_y = float(versatz_y)

        if falz == "keine":
            self.falz_pos = None
            self.karte_b = float(karte_b) if karte_b else self.bogen_b
            self.karte_h = float(karte_h) if karte_h else self.bogen_h
        elif falz == "laengs":
            self.falz_pos = float(falz_pos) if falz_pos else self.bogen_b / 2.0
            self.karte_b = float(karte_b) if karte_b else self.falz_pos
            self.karte_h = float(karte_h) if karte_h else self.bogen_h
        else:
            self.falz_pos = float(falz_pos) if falz_pos else self.bogen_h / 2.0
            self.karte_b = float(karte_b) if karte_b else self.bogen_b
            self.karte_h = float(karte_h) if karte_h else self.falz_pos

        self._pruefen()

    def _pruefen(self):
        if self.bogen_b <= 0 or self.bogen_h <= 0:
            raise ValueError("Der Bogen braucht positive Masse.")
        if self.karte_b <= 0 or self.karte_h <= 0:
            raise ValueError("Die Karte braucht positive Masse.")
        if self.karte_b - self.bogen_b > 0.01:
            raise ValueError(
                "Die Karte ist %.1f mm breit, der Bogen nur %.1f mm."
                % (self.karte_b, self.bogen_b))
        if self.falz == "laengs":
            if not 0 < self.falz_pos < self.bogen_b:
                raise ValueError("Der Falz liegt ausserhalb des Bogens.")
            if self.karte_b - min(self.falz_pos,
                                  self.bogen_b - self.falz_pos) > 0.01:
                raise ValueError(
                    "Die Karte ist %.1f mm breit, aber die schmalere Bogenhälfte "
                    "nur %.1f mm." % (self.karte_b,
                                      min(self.falz_pos,
                                          self.bogen_b - self.falz_pos)))
            if self.karte_h - self.bogen_h > 0.01:
                raise ValueError("Die Karte ist höher als der Bogen.")
        elif self.falz == "quer":
            if not 0 < self.falz_pos < self.bogen_h:
                raise ValueError("Der Falz liegt ausserhalb des Bogens.")
            if self.karte_h - min(self.falz_pos,
                                  self.bogen_h - self.falz_pos) > 0.01:
                raise ValueError(
                    "Die Karte ist %.1f mm hoch, aber die niedrigere Bogenhälfte "
                    "nur %.1f mm." % (self.karte_h,
                                      min(self.falz_pos,
                                          self.bogen_h - self.falz_pos)))
        else:
            if self.karte_h - self.bogen_h > 0.01:
                raise ValueError("Die Karte ist höher als der Bogen.")

    # ------------------------------------------------------------------
    @property
    def querformat(self):
        return self.bogen_b > self.bogen_h

    @property
    def rueckseite_drehen(self):
        """Muss die zweite Bogenseite um 180 Grad gedreht aufs Blatt?

        Ein Drucker wendet um eine Kante. Ist das die lange Kante eines
        Querformat-Bogens, liegt sie waagerecht - die Rueckseite kaeme
        kopfueber heraus. Genau dann drehen wir vor.
        """
        if self.wenden == "manuell":
            # Beim Wenden von Hand legt der Nutzer das Blatt so ein, wie es
            # der Assistent ansagt - also ohne Vorabdrehung.
            return False
        kurz = self.wenden == "kurz"
        return kurz != self.querformat

    def panels(self):
        """Kennungen aller Panels in Bearbeitungsreihenfolge."""
        if self.falz == "keine":
            return [TITEL, RUECK]
        return [TITEL, INNEN_A, INNEN_B, RUECK]

    def beschriftung(self, kennung):
        return BESCHRIFTUNG[self.falz].get(kennung, kennung)

    # ------------------------------------------------------------------
    def _panel_rahmen(self, haelfte):
        """Wo liegt eine Bogenhaelfte, und wo darin die Karte?

        Die Karte darf kleiner sein als die Haelfte (Rohling schmaler als der
        Bogen) - dann wird sie in der Haelfte zentriert.
        """
        b, h = self.bogen_b, self.bogen_h
        if self.falz == "keine":
            hx, hy, hb, hh = 0.0, 0.0, b, h
        elif self.falz == "laengs":
            if haelfte == "links":
                hx, hy, hb, hh = 0.0, 0.0, self.falz_pos, h
            else:
                hx, hy = self.falz_pos, 0.0
                hb, hh = b - self.falz_pos, h
        else:
            if haelfte == "unten":
                hx, hy, hb, hh = 0.0, 0.0, b, self.falz_pos
            else:
                hx, hy = 0.0, self.falz_pos
                hb, hh = b, h - self.falz_pos
        x = hx + (hb - self.karte_b) / 2.0
        y = hy + (hh - self.karte_h) / 2.0
        return x, y, self.karte_b, self.karte_h

    def anordnung(self):
        """Liefert je Bogenseite die Panels mit Position und Drehung.

        Rueckgabe: Liste von Bogenseiten, jede eine Liste von Eintraegen
            {"panel": Kennung, "x", "y", "b", "h", "drehung": 0 oder 180}
        Koordinaten in mm, Ursprung links unten, bereits inklusive der
        Drehung fuer die Wenderichtung des Druckers.
        """
        if self.falz == "keine":
            plan = [
                [(TITEL, "voll", 0)],
                [(RUECK, "voll", 0)],
            ]
        elif self.falz == "laengs":
            plan = [
                [(RUECK, "links", 0), (TITEL, "rechts", 0)],
                [(INNEN_A, "links", 0), (INNEN_B, "rechts", 0)],
            ]
        else:
            plan = [
                [(TITEL, "unten", 0), (RUECK, "oben", 180)],
                [(INNEN_A, "unten", 180), (INNEN_B, "oben", 180)],
            ]

        seiten = []
        for nr, eintraege in enumerate(plan):
            aus = []
            for kennung, haelfte, drehung in eintraege:
                x, y, pb, ph = self._panel_rahmen(haelfte)
                if nr == 1:
                    x += self.versatz_x
                    y += self.versatz_y
                    if self.rueckseite_drehen:
                        # Ganze Bogenseite drehen: Position spiegeln und die
                        # Panel-Drehung um 180 Grad weiterdrehen.
                        x = self.bogen_b - x - pb
                        y = self.bogen_h - y - ph
                        drehung = (drehung + 180) % 360
                aus.append({"panel": kennung, "x": x, "y": y,
                            "b": pb, "h": ph, "drehung": drehung})
            seiten.append(aus)
        return seiten

    def falzlinie(self):
        """Von-bis der Falzlinie auf Bogenseite 1, oder None."""
        if self.falz == "keine":
            return None
        if self.falz == "laengs":
            return (self.falz_pos, 0.0, self.falz_pos, self.bogen_h)
        return (0.0, self.falz_pos, self.bogen_b, self.falz_pos)

    def einlegehinweis(self):
        """Klartext fuer die Oberflaeche - was der Nutzer tun muss."""
        if self.wenden == "manuell":
            if self.querformat:
                dreh = ("Blatt herausnehmen, um die kurze Kante wenden "
                        "(linke Kante wird zur rechten) und erneut einlegen.")
            else:
                dreh = ("Blatt herausnehmen, um die lange Kante wenden "
                        "(linke Kante wird zur rechten) und erneut einlegen.")
            return ("Seite 1 drucken, dann: " + dreh
                    + " Danach Seite 2 drucken.")
        kante = "lange" if self.wenden == "lang" else "kurze"
        return ("Beidseitig drucken, Wenden über die %s Kante. "
                "Im Druckdialog „Tatsächliche Größe“ bzw. 100 %% wählen — "
                "keinesfalls „An Seite anpassen“." % kante)
