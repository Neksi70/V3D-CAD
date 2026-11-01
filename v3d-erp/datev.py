"""DATEV-Export: Ausgangs- und Eingangsrechnungen als Buchungsstapel (DATEV-Format „EXTF“, Kategorie 21) für den Steuerberater.

Eine Zeile je Beleg und Erlös-/Aufwandskonto: Personenkonto (Kunden-/Lieferantennummer) gegen Sachkonto, Bruttobetrag.
Die Sachkonten sind Automatikkonten des Kontenrahmens (SKR03/SKR04) – DATEV rechnet die Umsatzsteuer selbst heraus.
Kontenvorschläge sind Standardwerte; vor dem ersten echten Export mit dem Steuerberater abstimmen (Einstellungen → DATEV).
"""
import datetime as _dt
import hashlib
import json

import erp
from erp import Fehler, jetzt, transaktion, zeilen

# Sachkonten je Kontenrahmen. Schlüssel: Erlöse nach Steuersatz bzw. Steuerfall, Aufwand nach Steuersatz.
KONTEN = {
    "SKR03": {"erloes_19": "8400", "erloes_7": "8300", "erloes_0": "8200", "eu_lieferung": "8125", "eu_leistung": "8336",
              "13b": "8337", "drittland": "8120", "kleinunternehmer": "8195", "aufwand_19": "3400", "aufwand_7": "3300", "aufwand_0": "3200"},
    "SKR04": {"erloes_19": "4400", "erloes_7": "4300", "erloes_0": "4200", "eu_lieferung": "4125", "eu_leistung": "4336",
              "13b": "4337", "drittland": "4120", "kleinunternehmer": "4185", "aufwand_19": "5400", "aufwand_7": "5300", "aufwand_0": "5200"},
}
KONTO_NAMEN = {"erloes_19": "Erlöse 19 %", "erloes_7": "Erlöse 7 %", "erloes_0": "Erlöse ohne USt (Inland)",
               "eu_lieferung": "Erlöse innergem. Lieferung", "eu_leistung": "Erlöse EU-Leistung (Reverse Charge)",
               "13b": "Erlöse § 13b", "drittland": "Erlöse Ausfuhr Drittland", "kleinunternehmer": "Erlöse Kleinunternehmer § 19",
               "aufwand_19": "Wareneingang/Aufwand 19 % Vorsteuer", "aufwand_7": "Wareneingang/Aufwand 7 % Vorsteuer",
               "aufwand_0": "Wareneingang/Aufwand ohne Vorsteuer"}
SPALTEN = ["Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz", "Kurs", "Basis-Umsatz", "WKZ Basis-Umsatz",
           "Konto", "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum", "Belegfeld 1", "Belegfeld 2", "Skonto", "Buchungstext"]


def konten(db):
    """Kontenrahmen + Konten (Standard des Rahmens, überschrieben durch Einstellung `datev_konten`)."""
    e = erp.einstellungen(db)
    rahmen = e.get("datev_kontenrahmen") if e.get("datev_kontenrahmen") in KONTEN else "SKR03"
    k = dict(KONTEN[rahmen])
    try:
        k.update({a: str(b).strip() for a, b in json.loads(e.get("datev_konten") or "{}").items() if a in k and str(b).strip().isdigit()})
    except (ValueError, AttributeError):
        pass
    return rahmen, k


def einstellungen(db):
    e = erp.einstellungen(db)
    rahmen, k = konten(db)
    return dict(berater=e.get("datev_berater") or "", mandant=e.get("datev_mandant") or "", kontenrahmen=rahmen,
                konten=[dict(schluessel=s, name=KONTO_NAMEN[s], konto=k[s], standard=KONTEN[rahmen][s]) for s in KONTO_NAMEN])


def _zahl(v):
    return f"{abs(v):.2f}".replace(".", ",")


def _txt(v, n=60):
    v = (v or "").replace('"', "'").replace("\r", " ").replace("\n", " ")[:n]
    return f'"{v}"'


def _personenkonto(nr, art):
    """Debitoren 10000–69999, Kreditoren 70000–99999 (Sachkontenlänge 4)."""
    if not (nr or "").isdigit():
        return None
    n = int(nr)
    return str(n) if (10000 <= n <= 69999 if art == "debitor" else 70000 <= n <= 99999) else None


def buchungen(db, von, bis):
    """Buchungszeilen + Hinweise (Fehler blockieren den Export)."""
    _, k = konten(db)
    fehler, hinweise, out = [], [], []
    belege = zeilen(db.execute("""SELECT b.*, a.kurz, a.name1, kd.kundennr, lf.lieferantennr, op.faellig
                                  FROM beleg b JOIN adresse a ON a.id=b.adresse_id LEFT JOIN kunde kd ON kd.adresse_id=a.id
                                  LEFT JOIN lieferant lf ON lf.adresse_id=a.id LEFT JOIN offener_posten op ON op.beleg_id=b.id
                                  WHERE b.status='verarbeitet' AND b.belegart IN ('RE','GS','ER') AND b.datum BETWEEN ? AND ?
                                  ORDER BY b.datum, b.nummer""", (von, bis)))
    for b in belege:
        ek = b["belegart"] == "ER"
        pk = _personenkonto(b["lieferantennr"] if ek else b["kundennr"], "kreditor" if ek else "debitor")
        if not pk:
            fehler.append(f"{b['nummer']} ({b['kurz']}): {'Lieferanten' if ek else 'Kunden'}nummer "
                          f"„{(b['lieferantennr'] if ek else b['kundennr']) or '–'}“ passt nicht in den DATEV-Bereich "
                          f"{'70000–99999' if ek else '10000–69999'}.")
            continue
        je_konto = {}
        for p in db.execute("SELECT steuer_pct, gesamt FROM beleg_position WHERE beleg_id=?", (b["id"],)):
            s = round(p["steuer_pct"] or 0, 2)
            if ek:
                sk = k.get(f"aufwand_{s:g}")
            elif b["steuerfall"]:
                sk = k.get(b["steuerfall"])
            else:
                sk = k.get(f"erloes_{s:g}")
            if not sk:
                fehler.append(f"{b['nummer']}: kein Konto für {s:g} % USt. hinterlegt.")
                continue
            je_konto.setdefault((sk, s), 0.0)
            je_konto[(sk, s)] += p["gesamt"]
        vz = -1 if b["belegart"] == "GS" else 1
        for (sk, s), netto in je_konto.items():
            brutto = round(netto, 2) if b["steuerfall"] and not ek else round(round(netto, 2) * (1 + s / 100) + 1e-9, 2)
            betrag = vz * brutto
            if abs(betrag) < 0.005:
                continue
            # Debitor bei Rechnung im Soll, bei Gutschrift im Haben; Kreditor bei Eingangsrechnung im Haben
            sh = ("H" if betrag > 0 else "S") if ek else ("S" if betrag > 0 else "H")
            out.append(dict(umsatz=abs(betrag), sh=sh, konto=pk, gegenkonto=sk, datum=b["datum"],
                            belegfeld1=(b["ihre_referenz"] if ek and b["ihre_referenz"] else b["nummer"]),
                            belegfeld2=_dt.date.fromisoformat(b["faellig"]).strftime("%d%m%y") if b["faellig"] else "",
                            text=f"{b['nummer']} {b['kurz']}" if ek else b["kurz"], beleg_id=b["id"], belegart=b["belegart"]))
        summe = round(sum(r["umsatz"] for r in out if r["beleg_id"] == b["id"]), 2)
        if abs(summe - abs(b["brutto"])) > 0.011:
            hinweise.append(f"{b['nummer']}: Summe der Buchungen {summe:.2f} weicht vom Belegbetrag {abs(b['brutto']):.2f} ab (Rundung je Steuersatz).")
    return out, fehler, hinweise


def vorschau(db, von, bis):
    rows, fehler, hinweise = buchungen(db, von, bis)
    frueher = zeilen(db.execute("SELECT zeit, von, bis, anzahl, benutzer FROM datev_export WHERE NOT (bis < ? OR von > ?) ORDER BY id DESC", (von, bis)))
    if frueher:
        hinweise.insert(0, "Der Zeitraum wurde schon exportiert: " + "; ".join(f"{f['von']} bis {f['bis']} am {f['zeit'][:10]} ({f['anzahl']} Zeilen)" for f in frueher)
                        + ". Doppelte Übergabe vermeiden.")
    e = erp.einstellungen(db)
    if not (e.get("datev_berater") or "").isdigit() or not (e.get("datev_mandant") or "").isdigit():
        fehler.insert(0, "Berater- und Mandantennummer fehlen (Einstellungen → DATEV).")
    return dict(zeilen=rows, fehler=fehler, hinweise=hinweise, anzahl=len(rows),
                summe_soll=round(sum(r["umsatz"] for r in rows if r["sh"] == "S"), 2),
                summe_haben=round(sum(r["umsatz"] for r in rows if r["sh"] == "H"), 2))


def export(db, von, bis, benutzer=None):
    """CSV im DATEV-Format (Windows-1252). Bei Fehlern wird nichts erzeugt."""
    for d in (von, bis):
        try:
            _dt.date.fromisoformat(d)
        except (TypeError, ValueError):
            raise Fehler("Bitte Zeitraum von/bis als Datum angeben.")
    if von > bis:
        raise Fehler("„von“ liegt nach „bis“.")
    v = vorschau(db, von, bis)
    if v["fehler"]:
        raise Fehler("DATEV-Export nicht möglich: " + " ".join(v["fehler"]))
    if not v["zeilen"]:
        raise Fehler("Im Zeitraum gibt es keine verarbeiteten Rechnungen.")
    e = erp.einstellungen(db)
    rahmen, _ = konten(db)
    wj = von[:4] + "0101"
    kopf = ['"EXTF"', "700", "21", '"Buchungsstapel"', "13", _dt.datetime.now().strftime("%Y%m%d%H%M%S%f")[:17], "", '"RE"', '""', '""',
            e["datev_berater"], e["datev_mandant"], wj, "4", von.replace("-", ""), bis.replace("-", ""),
            _txt(f"V3D ERP {von} bis {bis}", 30), '""', "1", "0", "0", '"EUR"', "", '""', "", "", f'"{rahmen[3:]}"', "", "", "", '""']
    zeilen_ = [";".join(kopf), ";".join(f'"{s}"' for s in SPALTEN)]
    for r in v["zeilen"]:
        d = _dt.date.fromisoformat(r["datum"])
        zeilen_.append(";".join([_zahl(r["umsatz"]), f'"{r["sh"]}"', '"EUR"', "", "", '""', r["konto"], r["gegenkonto"], '""',
                                 d.strftime("%d%m"), _txt(r["belegfeld1"], 36), _txt(r["belegfeld2"], 12), "", _txt(r["text"])]))
    daten = ("\r\n".join(zeilen_) + "\r\n").encode("cp1252", errors="replace")
    with transaktion(db):
        db.execute("INSERT INTO datev_export(zeit,von,bis,anzahl,summe,sha256,benutzer) VALUES(?,?,?,?,?,?,?)",
                   (jetzt(), von, bis, len(v["zeilen"]), v["summe_soll"] + v["summe_haben"], hashlib.sha256(daten).hexdigest(), benutzer))
        erp.protokoll(db, benutzer, "datev", None, "exportiert", {"von": von, "bis": bis, "zeilen": len(v["zeilen"])})
    return daten, f"EXTF_Buchungsstapel_{von}_{bis}.csv"


def exporte(db):
    return zeilen(db.execute("SELECT * FROM datev_export ORDER BY id DESC LIMIT 50"))


def einstellungen_speichern(db, d, benutzer=None):
    for k in ("berater", "mandant"):
        if d.get(k) and not str(d[k]).strip().isdigit():
            raise Fehler("Berater- und Mandantennummer bestehen nur aus Ziffern.")
    rahmen = d.get("kontenrahmen") if d.get("kontenrahmen") in KONTEN else "SKR03"
    eigene = {}
    for s, wert in (d.get("konten") or {}).items():
        wert = str(wert or "").strip()
        if s in KONTO_NAMEN and wert:
            if not wert.isdigit() or not 4 <= len(wert) <= 8:
                raise Fehler(f"Konto „{KONTO_NAMEN[s]}“: bitte nur Ziffern (4–8 Stellen).")
            if wert != KONTEN[rahmen][s]:
                eigene[s] = wert
    erp.einstellungen_speichern(db, dict(datev_berater=str(d.get("berater") or "").strip(), datev_mandant=str(d.get("mandant") or "").strip(),
                                         datev_kontenrahmen=rahmen, datev_konten=json.dumps(eigene) if eigene else ""), benutzer)
    return einstellungen(db)
