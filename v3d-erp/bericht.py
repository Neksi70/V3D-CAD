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
        self.fuss()
        self.c.save()
        return self.buf.getvalue()


def terminbericht(db, pid):
    p = erp.projekt_lesen(db, pid)
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
