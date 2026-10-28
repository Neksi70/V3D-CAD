"""Terminbericht als PDF (Kundenansicht) – reportlab, A4 quer.

Enthält: Briefkopf (Logo/Firma), Projektdaten, Kennzahlen, Zeitstrahl (Plan, Zusage, Ist, Heute), Schrittliste mit
Status und Verschiebungsgrund, Fußzeile mit Firmendaten und Seitenzahl. Keine internen Angaben (Verantwortliche, Belege, Preise).
"""
import base64
import datetime as dt
import io

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

import erp

W, H = landscape(A4)
RAND = 34
FARBEN = {"ok": "#1f9d55", "late": "#e08a00", "risk": "#e6b800", "over": "#d64545", "fut": "#b8c6e6"}
MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]
GRAU, LINIE, TEXT, MUTE = HexColor("#8d96aa"), HexColor("#d9dee7"), HexColor("#1d2433"), HexColor("#6b7488")


def _d(s):
    return dt.date.fromisoformat(s[:10]) if s else None


def _de(s, jahr=True):
    return _d(s).strftime("%d.%m.%Y" if jahr else "%d.%m.") if s else "–"


def _kuerzen(c, text, breite, font, groesse):
    text = text or ""
    if c.stringWidth(text, font, groesse) <= breite:
        return text
    while text and c.stringWidth(text + "…", font, groesse) > breite:
        text = text[:-1]
    return text + "…"


class Bericht:
    def __init__(self, projekt, einst):
        self.p, self.e = projekt, einst
        self.haupt = HexColor(einst.get("farbe_haupt") or "#004aad")
        self.buf = io.BytesIO()
        self.c = canvas.Canvas(self.buf, pagesize=(W, H))
        self.c.setTitle(f"Terminbericht {projekt['projektnr']} – {projekt['titel']}")
        self.c.setAuthor(einst.get("firma_name") or "")
        self.seite = 0
        self.logo = None
        if (einst.get("logo") or "").startswith("data:image/") and "svg" not in einst["logo"][:30]:
            try:
                self.logo = ImageReader(io.BytesIO(base64.b64decode(einst["logo"].split(",", 1)[1])))
            except Exception:
                self.logo = None

    # ---------- Rahmen jeder Seite
    def neue_seite(self):
        if self.seite:
            self.fuss()
            self.c.showPage()
        self.seite += 1
        c, e = self.c, self.e
        y = H - RAND
        if self.logo:
            iw, ih = self.logo.getSize()
            h = 38
            w = iw * h / ih
            c.drawImage(self.logo, W - RAND - w, y - h, w, h, mask="auto")
        else:
            c.setFont("Helvetica-Bold", 15)
            c.setFillColor(TEXT)
            c.drawRightString(W - RAND, y - 16, e.get("firma_name") or "")
        c.setFillColor(TEXT)
        c.setFont("Helvetica-Bold", 19)
        c.drawString(RAND, y - 18, "Terminbericht")
        c.setFont("Helvetica", 10)
        c.setFillColor(MUTE)
        c.drawString(RAND, y - 33, f"Stand {dt.date.today().strftime('%d.%m.%Y')}" + (f"  ·  Seite {self.seite}" if self.seite > 1 else ""))
        c.setStrokeColor(self.haupt)
        c.setLineWidth(1.5)
        c.line(RAND, y - 46, W - RAND, y - 46)
        return y - 60

    def fuss(self):
        c, e = self.c, self.e
        c.setStrokeColor(LINIE)
        c.setLineWidth(0.6)
        c.line(RAND, 30, W - RAND, 30)
        c.setFont("Helvetica", 7.5)
        c.setFillColor(MUTE)
        teile = [e.get("firma_name"), " ".join(x for x in [e.get("strasse"), e.get("plz"), e.get("ort")] if x),
                 e.get("telefon") and "Tel. " + e["telefon"], e.get("email"), e.get("web")]
        c.drawString(RAND, 19, "  ·  ".join(t for t in teile if t))
        c.drawRightString(W - RAND, 19, f"Seite {self.seite}")

    # ---------- Inhalt
    def kopfdaten(self, y):
        c, p, k = self.c, self.p, self.p["kennzahlen"]
        c.setFillColor(TEXT)
        c.setFont("Helvetica-Bold", 14)
        c.drawString(RAND, y, _kuerzen(c, p["titel"], 470, "Helvetica-Bold", 14))
        c.setFont("Helvetica", 9.5)
        c.setFillColor(MUTE)
        z = [f"Projekt {p['projektnr']}"]
        if p.get("kunde_name"):
            z.append(f"Kunde {p['kunde_name']}")
        if p.get("ansprechpartner"):
            z.append(f"Ansprechpartner {p['ansprechpartner']}")
        c.drawString(RAND, y - 15, _kuerzen(c, "  ·  ".join(z), 470, "Helvetica", 9.5))
        # Kennzahlen-Kästen rechts
        kaesten = [(f"{k['erledigt']} / {k['gesamt']}", "Schritte erledigt", TEXT),
                   (f"{k['termintreue']} %", f"Termintreue ({k['gehalten']} von {k['erledigt']})",
                    HexColor(FARBEN["ok"] if k["termintreue"] >= 90 else FARBEN["late"] if k["termintreue"] >= 70 else FARBEN["over"])),
                   ("im Plan" if k["endverzug"] <= 0 else f"+{k['endverzug']} Tage",
                    f"Endtermin {_de(k['endtermin'])} (zugesagt {_de(k['endtermin_zugesagt'])})",
                    HexColor(FARBEN["ok"] if k["endverzug"] <= 0 else FARBEN["late"]))]
        bx = W - RAND
        for wert, text, farbe in reversed(kaesten):
            b = max(110, c.stringWidth(text, "Helvetica", 7.5) + 16)
            bx -= b
            c.setStrokeColor(LINIE)
            c.setFillColor(white)
            c.roundRect(bx, y - 22, b, 38, 4, stroke=1, fill=1)
            c.setFillColor(farbe)
            c.setFont("Helvetica-Bold", 13)
            c.drawString(bx + 8, y - 1, wert)
            c.setFillColor(MUTE)
            c.setFont("Helvetica", 7.5)
            c.drawString(bx + 8, y - 15, text)
            bx -= 8
        return y - 40

    def zeitstrahl(self, y, schritte, bereich):
        """Zeichnet den Zeitstrahl für `schritte`. bereich = (von, bis) gemeinsam für alle Seiten."""
        c = self.c
        von, bis = bereich
        links, rechts = RAND + 190, W - RAND
        tage = (bis - von).days or 1
        pt = (rechts - links) / tage
        x = lambda s: links + (_d(s) - von).days * pt
        zeile = 17
        kopf = 26
        hoehe = kopf + len(schritte) * zeile
        # Raster: Monate + Kalenderwochen
        c.setLineWidth(0.4)
        tag = von
        while tag <= bis:
            xx = links + (tag - von).days * pt
            if tag.weekday() == 0:
                c.setStrokeColor(LINIE)
                c.line(xx, y - hoehe, xx, y - 10)
                if pt * 7 >= 22:
                    c.setFont("Helvetica", 6.5)
                    c.setFillColor(MUTE)
                    c.drawString(xx + 2, y - 20, f"KW {tag.isocalendar()[1]}")
            if tag.day == 1 or (tag == von and tag.day <= 18):      # erster Monat nur, wenn genug Platz bis zum nächsten
                c.setFont("Helvetica-Bold", 7.5)
                c.setFillColor(TEXT)
                c.drawString(xx + 2, y - 8, f"{MONATE[tag.month - 1]} {tag.year}")
            tag += dt.timedelta(days=1)
        c.setStrokeColor(LINIE)
        c.line(RAND, y - kopf, rechts, y - kopf)
        # Zeilen
        for i, m in enumerate(schritte):
            zy = y - kopf - (i + 1) * zeile
            mitte = zy + zeile / 2
            if i % 2:
                c.setFillColor(HexColor("#f6f8fb"))
                c.rect(RAND, zy, rechts - RAND, zeile, stroke=0, fill=1)
            c.setFillColor(TEXT)
            c.setFont("Helvetica", 8)
            c.drawString(RAND + 2, mitte - 3, _kuerzen(c, f"{m['pos']}. {m['titel']}", 180, "Helvetica", 8))
            farbe = HexColor(FARBEN.get(m["status"], "")) if m["status"] in FARBEN else self.haupt
            ende = m["ist_ende"] or m["plan_ende"]
            # Verschiebung gegenüber Zusage
            if _d(ende) > _d(m["zugesagt"]):
                c.setStrokeColor(HexColor(FARBEN["over"]))
                c.setDash(2, 2)
                c.setLineWidth(0.9)
                c.line(x(m["zugesagt"]) + pt, mitte, x(ende), mitte)
                c.setDash()
            # Balken bzw. Raute
            c.setFillColor(farbe)
            if m["ist_meilenstein"]:
                mx = x(m["plan_ende"]) + pt / 2
                pfad = c.beginPath()
                pfad.moveTo(mx, mitte + 5)
                pfad.lineTo(mx + 5, mitte)
                pfad.lineTo(mx, mitte - 5)
                pfad.lineTo(mx - 5, mitte)
                pfad.close()
                c.drawPath(pfad, stroke=0, fill=1)
            else:
                bx1 = x(m["plan_start"])
                bx2 = max(x(m["plan_ende"]) + pt, bx1 + 3)
                c.roundRect(bx1, mitte - 4.5, bx2 - bx1, 9, 2, stroke=0, fill=1)
            # Zusage-Strich
            c.setStrokeColor(GRAU)
            c.setLineWidth(1.6)
            zx = x(m["zugesagt"]) + pt
            c.line(zx, mitte - 7, zx, mitte + 7)
            # Ist-Häkchen
            if m["ist_ende"]:
                ix = x(m["ist_ende"]) + pt / 2
                gruen = m["status"] == "ok"
                c.setFillColor(white)
                c.setStrokeColor(HexColor(FARBEN["ok" if gruen else "late"]))
                c.setLineWidth(1.1)
                c.circle(ix, mitte, 5.2, stroke=1, fill=1)
                c.setLineWidth(1.3)
                c.line(ix - 2.4, mitte, ix - 0.6, mitte - 2)
                c.line(ix - 0.6, mitte - 2, ix + 2.6, mitte + 2.2)
        # Heute-Linie
        heute = dt.date.today()
        if von <= heute <= bis:
            hx = links + (heute - von).days * pt + pt / 2
            c.setStrokeColor(self.haupt)
            c.setLineWidth(1.2)
            c.line(hx, y - hoehe, hx, y - kopf + 4)
            c.setFillColor(self.haupt)
            c.setFont("Helvetica-Bold", 6.5)
            c.drawString(hx + 2, y - kopf + 5, "Heute")
        c.setStrokeColor(LINIE)
        c.setLineWidth(0.5)
        c.rect(RAND, y - hoehe, rechts - RAND, hoehe - 0.0, stroke=1, fill=0)
        c.line(links, y - hoehe, links, y)
        return y - hoehe - 8

    def legende(self, y):
        c = self.c
        x = RAND
        c.setFont("Helvetica", 7.5)
        for k, t in [("ok", "Termin gehalten"), ("late", "Erledigt mit Verzug"), ("haupt", "In Arbeit"), ("risk", "Gefährdet"),
                     ("over", "Überfällig"), ("fut", "Geplant")]:
            c.setFillColor(self.haupt if k == "haupt" else HexColor(FARBEN[k]))
            c.rect(x, y - 1, 8, 8, stroke=0, fill=1)
            c.setFillColor(MUTE)
            c.drawString(x + 11, y, t)
            x += 15 + c.stringWidth(t, "Helvetica", 7.5) + 10
        c.setStrokeColor(GRAU)
        c.setLineWidth(1.6)
        c.line(x + 3, y - 2, x + 3, y + 8)
        c.drawString(x + 8, y, "zugesagter Termin")
        x += 90
        c.setStrokeColor(HexColor(FARBEN["over"]))
        c.setDash(2, 2)
        c.line(x, y + 3, x + 16, y + 3)
        c.setDash()
        c.drawString(x + 20, y, "Verschiebung")
        return y - 18

    def tabelle(self, y, schritte):
        c = self.c
        spalten = [("#", 22), ("Schritt", 230), ("Zugesagt", 70), ("Plan aktuell", 75), ("Erledigt am", 70), ("Status", 120), ("Hinweis", 0)]
        rest = W - 2 * RAND - sum(b for _, b in spalten)
        spalten[-1] = ("Hinweis", rest)

        def kopfzeile(y):
            c.setFillColor(HexColor("#eef1f6"))
            c.rect(RAND, y - 5, W - 2 * RAND, 16, stroke=0, fill=1)
            c.setFillColor(TEXT)
            c.setFont("Helvetica-Bold", 8)
            x = RAND + 4
            for t, b in spalten:
                c.drawString(x, y, t)
                x += b
            return y - 16

        y = kopfzeile(y)
        for m in schritte:
            if y < 60:
                y = kopfzeile(self.neue_seite())
            x = RAND + 4
            werte = [str(m["pos"]), m["titel"] + (" (Meilenstein)" if m["ist_meilenstein"] else ""), _de(m["zugesagt"]),
                     _de(m["plan_ende"]), _de(m["ist_ende"]), m["status_text"], ("Verschoben: " + m["grund"]) if m.get("grund") else ""]
            for i, ((_, b), w) in enumerate(zip(spalten, werte)):
                if i == 5:
                    farbe = HexColor(FARBEN[m["status"]]) if m["status"] in FARBEN else self.haupt
                    c.setFillColor(farbe)
                    c.circle(x + 3, y + 2.5, 3, stroke=0, fill=1)
                    c.setFillColor(TEXT)
                    c.setFont("Helvetica", 8)
                    c.drawString(x + 10, y, _kuerzen(c, w, b - 14, "Helvetica", 8))
                else:
                    fett = i == 3 and m["plan_ende"] != m["zugesagt"] and not m["ist_ende"]
                    c.setFillColor(HexColor("#8a4b00") if i == 6 else TEXT)
                    font = "Helvetica-Bold" if fett else "Helvetica"
                    c.setFont(font, 8)
                    c.drawString(x, y, _kuerzen(c, w, b - 6, font, 8))
                x += b
            c.setStrokeColor(LINIE)
            c.setLineWidth(0.4)
            c.line(RAND, y - 5, W - RAND, y - 5)
            y -= 15
        return y

    def fertigungsstand(self, y, chargen):
        """Fortschritt je Charge und Arbeitsgang – ohne Personal, Maschinen, Zeiten oder Ausschuss (bleibt intern)."""
        c = self.c
        if y < 120:
            y = self.neue_seite()
        c.setFillColor(TEXT)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(RAND, y, f"Fertigungsstand je Charge (Stand {_de(dt.date.today().isoformat())})")
        y -= 18
        n_ag = max(len(ch["schritte"]) for ch in chargen)
        links = [("Charge", 110), ("Artikel", 190), ("Eingang", 60)]
        rechts = 70
        ag_b = (W - 2 * RAND - sum(b for _, b in links) - rechts) / max(1, n_ag)

        def kopf(y):
            c.setFillColor(HexColor("#eef1f6"))
            c.rect(RAND, y - 5, W - 2 * RAND, 16, stroke=0, fill=1)
            c.setFillColor(TEXT)
            c.setFont("Helvetica-Bold", 8)
            x = RAND + 4
            for t, b in links:
                c.drawString(x, y, t)
                x += b
            c.drawString(x, y, "Bearbeitungsschritte")
            c.drawRightString(W - RAND - 4, y, "Geliefert")
            return y - 18

        y = kopf(y)
        for ch in chargen:
            if y < 60:
                y = kopf(self.neue_seite() - 4)
            x = RAND + 4
            c.setFont("Helvetica", 8)
            c.setFillColor(TEXT)
            for (_, b), w in zip(links, [ch["chargennr"], f"{ch.get('artikelnr') or ''} {ch.get('artikel_kurz') or ''}".strip(), f"{ch['eingang']:,.0f}".replace(",", ".")]):
                c.drawString(x, y, _kuerzen(c, w, b - 6, "Helvetica", 8))
                x += b
            for st in ch["schritte"]:
                bw = ag_b - 6
                c.setFillColor(HexColor("#e7ebf1"))
                c.roundRect(x, y - 3, bw, 12, 2, stroke=0, fill=1)
                if st["pct"]:
                    c.setFillColor(HexColor("#1f9d55") if st["fertig"] else (self.haupt if st["laufend"] else HexColor("#7cc79c")))
                    c.roundRect(x, y - 3, max(3, bw * st["pct"] / 100), 12, 2, stroke=0, fill=1)
                c.setFillColor(TEXT)
                c.setFont("Helvetica", 7)
                t = f"{st['arbeitsgang']} {'✓' if st['fertig'] else str(st['pct']) + ' %'}{' · läuft' if st['laufend'] else ''}"
                c.drawString(x + 3, y, _kuerzen(c, t.replace("✓", "fertig"), bw - 6, "Helvetica", 7))
                x += ag_b
            c.setFont("Helvetica", 8)
            c.drawRightString(W - RAND - 4, y, f"{ch['geliefert']:,.0f}".replace(",", "."))
            c.setStrokeColor(LINIE)
            c.setLineWidth(0.4)
            c.line(RAND, y - 7, W - RAND, y - 7)
            y -= 19
        return y

    def erstellen(self):
        ms = self.p["meilensteine"]
        alle = [d for m in ms for d in (m["plan_start"], m["plan_ende"], m["zugesagt"], m["ist_ende"]) if d] + [dt.date.today().isoformat()]
        von = _d(min(alle)) - dt.timedelta(days=4)
        von -= dt.timedelta(days=von.weekday())
        bis = _d(max(alle)) + dt.timedelta(days=7)
        y = self.neue_seite()
        y = self.kopfdaten(y)
        # Zeitstrahl ggf. auf mehrere Seiten
        pro_seite = max(4, int((y - 90) / 17) - 1)
        for i in range(0, max(1, len(ms)), pro_seite):
            if i:
                y = self.neue_seite()
            y = self.zeitstrahl(y, ms[i:i + pro_seite], (von, bis))
        y = self.legende(y - 4)
        if y < 140:
            y = self.neue_seite()
        y = self.tabelle(y - 6, ms)
        if self.p.get("fertigung"):
            y = self.fertigungsstand(y - 18, self.p["fertigung"])
        self.fuss()
        self.c.save()
        return self.buf.getvalue()


def terminbericht(db, pid):
    import produktion
    p = erp.projekt_lesen(db, pid)
    ids = produktion.chargen_fuer_projekt(db, pid)
    p["fertigung"] = produktion.fortschritt(db, ids) if ids else []
    return Bericht(p, erp.einstellungen(db)).erstellen(), f"Terminbericht_{p['projektnr']}_{dt.date.today().isoformat()}.pdf"


# ================================================================ Mahnschreiben (A4 hoch)
def mahnung_pdf(db, mid):
    import finanzen
    from reportlab.lib.pagesizes import A4 as A4H
    m = finanzen.mahnung_lesen(db, mid)
    e = erp.einstellungen(db)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4H)
    bw, bh = A4H
    c.setTitle(f"{m['stufe_name']} {m['nummer']}")
    haupt = HexColor(e.get("farbe_haupt") or "#004aad")
    r = 56
    # Kopf
    logo = Bericht({"projektnr": "", "titel": ""}, e).logo
    if logo:
        iw, ih = logo.getSize()
        c.drawImage(logo, bw - r - iw * 46 / ih, bh - 40 - 46, iw * 46 / ih, 46, mask="auto")
    else:
        c.setFont("Helvetica-Bold", 15)
        c.drawRightString(bw - r, bh - 60, e.get("firma_name") or "")
    # Absenderzeile + Anschrift (Fensterkuvert DIN 5008 B)
    c.setFont("Helvetica", 7.5)
    c.setFillColor(MUTE)
    c.drawString(r, bh - 148, _kuerzen(c, " · ".join(x for x in [e.get("firma_name"), e.get("strasse"), f"{e.get('plz','')} {e.get('ort','')}".strip()] if x), 240, "Helvetica", 7.5))
    c.setStrokeColor(MUTE)
    c.line(r, bh - 151, r + 240, bh - 151)
    c.setFillColor(TEXT)
    c.setFont("Helvetica", 10.5)
    y = bh - 168
    for z in [m["name1"], m["name2"], m["strasse"], f"{m['plz'] or ''} {m['ort'] or ''}".strip()]:
        if z:
            c.drawString(r, y, z)
            y -= 14
    # Infoblock rechts
    c.setFont("Helvetica", 9)
    info = [("Datum", _de(m["datum"])), ("Mahnung", m["nummer"]), ("Kundennr.", m["kundennr"] or "–")]
    iy = bh - 160
    for k, v in info:
        c.setFillColor(MUTE)
        c.drawString(bw - r - 150, iy, k)
        c.setFillColor(TEXT)
        c.drawRightString(bw - r, iy, v)
        iy -= 13
    # Betreff + Text
    y = bh - 270
    c.setFont("Helvetica-Bold", 13)
    c.setFillColor(haupt)
    c.drawString(r, y, m["stufe_name"])
    c.setFillColor(TEXT)
    c.setFont("Helvetica", 10)
    y -= 24
    c.drawString(r, y, "Sehr geehrte Damen und Herren,")
    y -= 18
    text = (m["stufe_text"] or "").replace("{frist}", _de(m["neue_frist"]))
    for absatz in text.split("\n"):
        zeile_ = ""
        for wort in absatz.split():
            if c.stringWidth(zeile_ + " " + wort, "Helvetica", 10) > bw - 2 * r:
                c.drawString(r, y, zeile_)
                y -= 14
                zeile_ = wort
            else:
                zeile_ = (zeile_ + " " + wort).strip()
        c.drawString(r, y, zeile_)
        y -= 14
    # Tabelle
    y -= 12
    spalten = [("Rechnung", r), ("Datum", r + 110), ("fällig seit", r + 190), ("Tage", r + 280), ("offen €", bw - r)]
    c.setFillColor(HexColor("#eef1f6"))
    c.rect(r, y - 4, bw - 2 * r, 16, stroke=0, fill=1)
    c.setFillColor(TEXT)
    c.setFont("Helvetica-Bold", 9)
    for t, x in spalten:
        (c.drawRightString if t.startswith("offen") else c.drawString)(x - (4 if t.startswith("offen") else -4), y, t)
    y -= 18
    c.setFont("Helvetica", 9.5)
    for p in m["posten"]:
        c.drawString(r + 4, y, p["nummer"] or "")
        c.drawString(r + 114, y, _de(p["beleg_datum"]))
        c.drawString(r + 194, y, _de(p["faellig"]))
        c.drawString(r + 284, y, str(p["tage_ueber"]))
        c.drawRightString(bw - r - 4, y, f"{p['offen']:,.2f}".replace(",", "X").replace(".", ",").replace("X", "."))
        c.setStrokeColor(LINIE)
        c.line(r, y - 5, bw - r, y - 5)
        y -= 16
    def eur(v):
        return f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")
    if m["gebuehr"]:
        c.drawString(r + 4, y, "Mahngebühr")
        c.drawRightString(bw - r - 4, y, eur(m["gebuehr"]))
        y -= 16
    c.setFont("Helvetica-Bold", 10.5)
    c.drawString(r + 4, y - 2, "Gesamtbetrag")
    c.drawRightString(bw - r - 4, y - 2, eur(m["summe"]))
    y -= 30
    c.setFont("Helvetica", 10)
    if e.get("iban"):
        c.drawString(r, y, f"Bitte überweisen Sie auf: {e.get('bank_name') or ''}  IBAN {e['iban']}  BIC {e.get('bic') or ''}")
        y -= 14
        c.drawString(r, y, f"Verwendungszweck: {m['nummer']} / Kd-Nr. {m['kundennr'] or ''}")
        y -= 22
    c.drawString(r, y, "Mit freundlichen Grüßen")
    y -= 14
    c.drawString(r, y, e.get("firma_name") or "")
    # Fuß
    c.setStrokeColor(LINIE)
    c.line(r, 50, bw - r, 50)
    c.setFont("Helvetica", 7)
    c.setFillColor(MUTE)
    teile = [e.get("firma_name"), e.get("telefon") and "Tel. " + e["telefon"], e.get("email"), e.get("handelsregister"), e.get("ust_id") and "USt-IdNr. " + e["ust_id"]]
    c.drawString(r, 38, "  ·  ".join(t for t in teile if t))
    c.save()
    return buf.getvalue(), f"{m['nummer']}_{m['kurz']}.pdf".replace(" ", "_")


# ================================================================ Beleg als PDF (Rechnung, Angebot … – auch Grundlage für ZUGFeRD)
_SCHRIFT = None


def _schriften():
    """DejaVu einbetten (PDF/A verlangt eingebettete Schriften; Helvetica wäre nur referenziert)."""
    global _SCHRIFT
    if _SCHRIFT is None:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        try:
            pdfmetrics.registerFont(TTFont("DV", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
            pdfmetrics.registerFont(TTFont("DV-B", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
            _SCHRIFT = ("DV", "DV-B")
        except Exception:
            _SCHRIFT = ("Helvetica", "Helvetica-Bold")
    return _SCHRIFT


def beleg_pdf(db, bid, pdfa=False, fo=None):
    """Beleg als A4-PDF nach dem Formular-Baukasten (erp.formular): Spalten, Blöcke, Titel, Zusatztext, Schriftgröße, Briefpapier."""
    from reportlab.lib.pagesizes import A4 as A4H
    from reportlab.lib.units import mm
    N, F = _schriften()
    b = erp.beleg_lesen(db, bid)
    fo = fo or b.get("formular") or erp.formular(db, b["belegart"])
    bl = fo["bloecke"]
    e = erp.einstellungen(db)
    a = erp.adresse_lesen(db, b["adresse_id"])
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4H, pageCompression=1, initialFontName=N, initialFontSize=9)
    bw, bh = A4H
    r = 56
    gs = fo["schrift"]                                       # Grundschrift der Positionen
    titel = fo.get("titel") or b["belegart_name"]
    c.setTitle(f"{titel} {b['nummer'] or 'Entwurf'}")
    c.setAuthor(e.get("firma_name") or "")
    haupt = HexColor(e.get("farbe_haupt") or "#004aad")
    logo = Bericht({"projektnr": "", "titel": ""}, e).logo
    eur = lambda v: f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    preis4 = lambda v: eur(v) if round(v, 2) == round(v, 4) else f"{v:,.4f}".rstrip("0").replace(",", "X").replace(".", ",").replace("X", ".")
    menge = lambda v: f"{v:,.3f}".rstrip("0").rstrip(".").replace(",", "X").replace(".", ",").replace("X", ".") if v % 1 else f"{int(v):,}".replace(",", ".")
    oben = bh - fo["rand_oben"] * mm if fo["briefpapier"] else bh - 40
    unten = fo["rand_unten"] * mm if fo["briefpapier"] else 110
    seite = [1]
    artnr = {x["id"]: x["artikelnr"] for x in db.execute("SELECT id, artikelnr FROM artikel")}

    # ---- Spalten aus dem Baukasten: Breite, Ausrichtung, Inhalt
    BREITE = {"pos": 24, "artikelnr": 62, "menge": 52, "me": 30, "einzelpreis": 66, "rabatt": 44, "gesamt": 70}
    RECHTS = {"menge", "einzelpreis", "rabatt", "gesamt"}
    sp = [x for x in fo["spalten"] if x["an"] and (fo["preise"] or x["key"] not in ("einzelpreis", "rabatt", "gesamt"))]
    if not any(x["key"] == "text" for x in sp):
        sp.insert(min(1, len(sp)), {"key": "text", "titel": "Bezeichnung", "an": True})
    frei = bw - 2 * r - sum(BREITE.get(x["key"], 0) for x in sp)
    xpos, x0 = {}, r
    for x in sp:
        w = BREITE.get(x["key"], frei)
        xpos[x["key"]] = (x0, w)
        x0 += w
    TB = xpos["text"][1] - 8

    def zelle(key, p, lfd):
        return {"pos": str(lfd), "artikelnr": artnr.get(p["artikel_id"], ""), "menge": menge(p["menge"]), "me": p["me"] or "",
                "einzelpreis": preis4(p["einzelpreis"]), "rabatt": f"{p['rabatt_pct']:g}" if p.get("rabatt_pct") else "",
                "gesamt": eur(p["gesamt"])}.get(key, "")

    def fuss():
        if fo["briefpapier"]:
            c.setFont(N, 7)
            c.setFillColor(MUTE)
            c.drawRightString(bw - r, unten - 14, f"Seite {seite[0]}")
            return
        c.setStrokeColor(LINIE)
        c.line(r, 62, bw - r, 62)
        spalten = [[e.get("firma_name"), e.get("strasse"), f"{e.get('plz', '')} {e.get('ort', '')}".strip()],
                   [e.get("telefon") and "Tel. " + e["telefon"], e.get("email"), e.get("web")],
                   [e.get("bank_name"), e.get("iban") and "IBAN " + e["iban"], e.get("bic") and "BIC " + e["bic"]],
                   [e.get("geschaeftsfuehrer") and "GF: " + e["geschaeftsfuehrer"], e.get("handelsregister"), e.get("ust_id") and "USt-IdNr. " + e["ust_id"]]]
        c.setFont(N, 6.8)
        c.setFillColor(MUTE)
        breite = (bw - 2 * r) / 4
        for i, spx in enumerate(spalten):
            for j, t in enumerate([x for x in spx if x]):
                c.drawString(r + i * breite, 52 - j * 9, _kuerzen(c, t, breite - 6, N, 6.8))
        c.drawRightString(bw - r, 70, f"Seite {seite[0]}")

    def kopf_folgeseite():
        c.setFont(N, 8.5)
        c.setFillColor(MUTE)
        c.drawString(r, oben - 10, f"{titel} {b['nummer'] or 'Entwurf'} vom {_de(b['datum'])} – Fortsetzung")
        return oben - 40

    def tabellenkopf(y):
        c.setFillColor(HexColor("#eef1f6"))
        c.rect(r, y - 5, bw - 2 * r, 16, stroke=0, fill=1)
        c.setFillColor(TEXT)
        c.setFont(F, 8.5)
        for x in sp:
            x0_, w = xpos[x["key"]]
            if x["key"] in RECHTS:
                c.drawRightString(x0_ + w - 4, y, _kuerzen(c, x["titel"], w - 4, F, 8.5))
            else:
                c.drawString(x0_ + 4, y, _kuerzen(c, x["titel"], w - 6, F, 8.5))
        return y - 17

    def neue_seite():
        fuss()
        c.showPage()
        seite[0] += 1
        return tabellenkopf(kopf_folgeseite())

    # ---- Briefkopf (entfällt bei Briefpapier)
    if not fo["briefpapier"]:
        if logo:
            iw, ih = logo.getSize()
            c.drawImage(logo, bw - r - iw * 46 / ih, bh - 40 - 46, iw * 46 / ih, 46, mask="auto")
        else:
            c.setFont(F, 15)
            c.setFillColor(TEXT)
            c.drawRightString(bw - r, bh - 60, e.get("firma_name") or "")
    ay = (oben - 108) if fo["briefpapier"] else bh - 148
    c.setFont(N, 7.2)
    c.setFillColor(MUTE)
    c.drawString(r, ay, _kuerzen(c, " · ".join(x for x in [e.get("firma_name"), e.get("strasse"), f"{e.get('plz','')} {e.get('ort','')}".strip()] if x), 240, N, 7.2))
    c.setStrokeColor(MUTE)
    c.line(r, ay - 3, r + 240, ay - 3)
    c.setFillColor(TEXT)
    c.setFont(N, 10.5)
    y = ay - 20
    for z in [a["name1"], a.get("name2"), a.get("strasse"), f"{a.get('plz') or ''} {a.get('ort') or ''}".strip(), a.get("land") if a.get("land") not in (None, "", "DE") else None]:
        if z:
            c.drawString(r, y, z)
            y -= 14
    info = [("Nummer", b["nummer"] or "ENTWURF"), ("Datum", _de(b["datum"]))]
    if b.get("kundennr"):
        info.append(("Kundennr.", b["kundennr"]))
    if b.get("lieferantennr"):
        info.append(("Lieferantennr.", b["lieferantennr"]))
    if b.get("ihre_referenz") and bl["referenz"]:
        info.append(("Ihr Lieferschein" if b["belegart"] == "WK" else "Ihre Bestellung" if b["bereich"] == "VK" else "Unsere Referenz", b["ihre_referenz"]))
    if b.get("projektnr"):
        info.append(("Projekt", b["projektnr"]))
    if a.get("ust_id") and b["belegart"] in ("RE", "GS"):
        info.append(("Ihre USt-IdNr.", a["ust_id"]))
    iy = ay - 12
    c.setFont(N, 8.8)
    for k, v in info:
        c.setFillColor(MUTE)
        c.drawString(bw - r - 170, iy, k)
        c.setFillColor(TEXT)
        c.drawRightString(bw - r, iy, _kuerzen(c, str(v), 95, N, 8.8))
        iy -= 13
    y = min(y, iy) - 30
    c.setFont(F, 14)
    c.setFillColor(haupt)
    c.drawString(r, y, f"{titel} {b['nummer'] or ''}".strip())
    c.setFillColor(TEXT)
    y -= 18
    if b.get("betreff") and bl["betreff"]:
        c.setFont(F, 10)
        c.drawString(r, y, _kuerzen(c, b["betreff"], bw - 2 * r, F, 10))
        y -= 16

    def absatz(text, y, groesse=9.5, font=None):
        """Fließtext über die volle Breite, bricht bei Bedarf auf eine Folgeseite um."""
        font = font or N
        zeilen_ = []
        for ab in (text or "").split("\n"):
            z = ""
            for w in ab.split():
                if c.stringWidth(z + " " + w, font, groesse) > bw - 2 * r:
                    zeilen_.append(z)
                    z = w
                else:
                    z = (z + " " + w).strip()
            zeilen_.append(z)
        for z in zeilen_:
            if y < unten:
                fuss()
                c.showPage()
                seite[0] += 1
                y = kopf_folgeseite()
            c.setFont(font, groesse)
            c.setFillColor(TEXT)
            c.drawString(r, y, z)
            y -= groesse + 4
        return y

    if b.get("kopftext") and bl["kopftext"]:
        y = absatz(b["kopftext"], y) - 6
    y = tabellenkopf(y)
    lfd = 0
    for p in b["positionen"]:
        if erp.ist_textzeile(p):
            if y - 20 < unten:
                y = neue_seite()
            c.setFont(F, gs)
            c.setFillColor(TEXT)
            c.drawString(xpos["text"][0] + 4, y, _kuerzen(c, p["text"], bw - r - xpos["text"][0] - 8, F, gs))
            y -= gs + 9
            continue
        text = p["text"] + (f"  (Rabatt {p['rabatt_pct']:g} %)" if p.get("rabatt_pct") and not any(x["key"] == "rabatt" for x in sp) and fo["preise"] else "")
        zeilen_ = []
        z = ""
        for w in text.split():
            if c.stringWidth(z + " " + w, N, gs) > TB:
                zeilen_.append(z)
                z = w
            else:
                z = (z + " " + w).strip()
        zeilen_.append(z)
        nebenzeilen = []
        if p.get("charge_nr") and bl["charge"]:
            nebenzeilen.append(f"Charge: {p['charge_nr']}")
        if bl["zusatzfelder"]:
            nebenzeilen += [f"{k}: {v}" for k, v in (p.get("zusatz") or {}).items()]
        hoehe = (gs + 3) * len(zeilen_) + (gs + 2) * len(nebenzeilen) + 6
        if y - hoehe < unten:
            y = neue_seite()
        lfd += 1
        c.setFillColor(TEXT)
        c.setFont(N, gs)
        for x in sp:
            if x["key"] == "text":
                continue
            x0_, w = xpos[x["key"]]
            t = zelle(x["key"], p, lfd)
            if x["key"] in RECHTS:
                c.drawRightString(x0_ + w - 4, y, t)
            else:
                c.drawString(x0_ + 4, y, _kuerzen(c, t, w - 6, N, gs))
        tx = xpos["text"][0] + 4
        for i, t in enumerate(zeilen_):
            c.drawString(tx, y - i * (gs + 3), t)
        c.setFillColor(MUTE)
        c.setFont(N, gs - 1)
        for i, t in enumerate(nebenzeilen):
            c.drawString(tx, y - len(zeilen_) * (gs + 3) - i * (gs + 2), _kuerzen(c, t, TB, N, gs - 1))
        c.setFillColor(TEXT)
        y -= hoehe
        c.setStrokeColor(LINIE)
        c.line(r, y + 8, bw - r, y + 8)
    if fo["preise"]:
        if y < unten + 80:
            y = neue_seite()
        saetze = {}
        for p in b["positionen"]:
            saetze[p["steuer_pct"]] = saetze.get(p["steuer_pct"], 0) + p["gesamt"]
        y -= 6
        c.setFont(N, 9.5)
        c.drawString(bw - r - 220, y, "Summe netto")
        c.drawRightString(bw - r - 4, y, eur(b["netto"]) + " €")
        for st, basis in sorted(saetze.items(), reverse=True):
            y -= 14
            c.drawString(bw - r - 220, y, f"zzgl. {st:g} % USt. auf {eur(basis)} €")
            c.drawRightString(bw - r - 4, y, eur(round(basis * st / 100 + 1e-9, 2)) + " €")
        y -= 18
        c.setFont(F, 11)
        c.drawString(bw - r - 220, y, "Gesamtbetrag")
        c.drawRightString(bw - r - 4, y, eur(b["brutto"]) + " €")
        y -= 26
    else:
        y -= 14
    if bl["verpackung"] and b.get("verpackung"):
        if y < unten + 40:
            y = neue_seite()
        c.setFont(F, 9.5)
        c.setFillColor(TEXT)
        lab = "Verpackung / Ladungsträger:"
        c.drawString(r, y, lab)
        lx = c.stringWidth(lab, F, 9.5) + 8
        c.setFont(N, 9.5)
        c.drawString(r + lx, y, _kuerzen(c, "  ·  ".join(f"{menge(v['anzahl'])} × {v['art']}" for v in b["verpackung"]), bw - 2 * r - lx, N, 9.5))
        y -= 22
    if fo.get("zusatztext"):
        y = absatz(fo["zusatztext"], y) - 4
    op = erp.zeile(db.execute("SELECT faellig FROM offener_posten WHERE beleg_id=?", (bid,))) if b["status"] == "verarbeitet" else None
    if b.get("zahlungsbed") and b["belegart"] in ("RE", "AN", "AB") and bl["zahlungsbed"]:
        y = absatz(f"Zahlungsbedingung: {b['zahlungsbed']}" + (f" – fällig am {_de(op['faellig'])}" if op else ""), y)
    if b["belegart"] == "RE" and e.get("iban") and bl["bank"]:
        y = absatz(f"Bitte überweisen Sie unter Angabe der Rechnungsnummer {b['nummer']} auf: IBAN {e['iban']}" + (f", BIC {e['bic']}" if e.get("bic") else ""), y)
    if b["belegart"] in ("RE", "GS") and b.get("datum"):
        y = absatz("Leistungsdatum entspricht dem Rechnungsdatum, soweit nicht anders angegeben.", y, 8.5)
    if b.get("fusstext") and bl["fusstext"]:
        y = absatz(b["fusstext"], y - 4)
    if bl["quittung"]:
        if y < unten + 30:
            y = neue_seite()
        y -= 10
        c.setFont(N, 9)
        c.setFillColor(MUTE)
        c.drawString(r, y, "Ware erhalten: ________________________   Datum / Unterschrift / Stempel")
        c.setFillColor(TEXT)
    fuss()
    c.save()
    return buf.getvalue(), f"{titel.split(' ')[0]}_{b['nummer'] or 'Entwurf'}.pdf".replace(" ", "_").replace("/", "-")
