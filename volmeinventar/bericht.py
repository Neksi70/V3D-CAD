#!/usr/bin/env python3
# Erzeugt aus der Bestandsaufnahme einen Bericht: HTML, CSV oder JSON.
#
# Der HTML-Bericht ist absichtlich EINE Datei ohne Verweise nach aussen -
# er soll sich per Mail verschicken und auf einem Rechner ohne Internet
# oeffnen lassen.  Suchfeld und Sortierung stecken deshalb inline drin.

import csv
import datetime
import html
import json
import os
import re

PROGRAMM_SPALTEN = [
    ("name", "Programm"),
    ("fassung", "Fassung"),
    ("hersteller", "Hersteller"),
    ("installiert_am", "Installiert"),
    ("groesse", "Groesse"),
    ("quelle", "Fuer"),
    ("bitheit", "Art"),
    ("ordner", "Ordner"),
]

# Spalten, die als Datum sortiert werden muessen statt als Text
DATUMSSPALTEN = {"installiert_am", "angelegt", "geaendert"}

VERWEIS_SPALTEN = [
    ("anzeigename", "Verknuepfung"),
    ("bereich", "Ort"),
    ("gruppe", "Gruppe"),
    ("ziel", "Ziel"),
    ("argumente", "Argumente"),
    ("angelegt", "Angelegt"),
    ("zustand", "Zustand"),
]


def name_vorschlagen(bestand, form):
    rechner = re.sub(r"[^A-Za-z0-9_-]", "_",
                     bestand["angaben"]["rechner"] or "Rechner")
    stempel = bestand["angaben"]["zeitpunkt"].strftime("%Y-%m-%d_%H%M")
    return f"Bestand_{rechner}_{stempel}.{form}"


def _text(wert):
    if wert is None or wert == "":
        return ""
    if isinstance(wert, bool):
        return "ja" if wert else "nein"
    if isinstance(wert, datetime.datetime):
        return wert.strftime("%d.%m.%Y %H:%M")
    if isinstance(wert, datetime.date):
        return wert.strftime("%d.%m.%Y")
    return str(wert)


def _groesse(kb):
    """Aus Kilobyte etwas Lesbares machen."""
    if not kb:
        return ""
    if kb < 1024:
        return f"{kb} KB"
    if kb < 1024 * 1024:
        return f"{kb / 1024:.1f} MB".replace(".", ",")
    return f"{kb / 1024 / 1024:.2f} GB".replace(".", ",")


def _programm_zeile(p):
    zeile = dict(p)
    zeile["groesse"] = _groesse(p.get("groesse_kb"))
    return zeile


def _verweis_zeile(v):
    zeile = dict(v)
    if v.get("fehler"):
        zeile["zustand"] = "unlesbar"
    elif v.get("ziel_fehlt"):
        zeile["zustand"] = "Ziel fehlt"
    elif v.get("app_kennung"):
        zeile["zustand"] = "Store-App"
    else:
        zeile["zustand"] = ""
    if not zeile.get("ziel") and v.get("idliste"):
        zeile["ziel"] = v["idliste"]
    return zeile


# --------------------------------------------------------------------- HTML
VORLAGE = """<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bestand {rechner}</title>
<style>
:root {{
  --grund:#f6f7f9; --karte:#fff; --linie:#dfe3e8; --schrift:#1b1f24;
  --leise:#5b6672; --betont:#0b6bcb; --warn:#b3261e; --warn-grund:#fdeceb;
}}
@media (prefers-color-scheme: dark) {{
  :root {{
    --grund:#15181c; --karte:#1d2126; --linie:#2f353c; --schrift:#e8eaed;
    --leise:#9aa4b0; --betont:#6ba8f5; --warn:#f2837c; --warn-grund:#3a1f1e;
  }}
}}
* {{ box-sizing:border-box; }}
body {{ margin:0; padding:24px; background:var(--grund); color:var(--schrift);
  font:15px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif; }}
h1 {{ font-size:22px; margin:0 0 4px; }}
h2 {{ font-size:17px; margin:28px 0 10px; }}
.kopf {{ color:var(--leise); font-size:13px; margin-bottom:18px; }}
.kopf b {{ color:var(--schrift); font-weight:600; }}
.zahlen {{ display:flex; flex-wrap:wrap; gap:10px; margin:0 0 18px; }}
.zahl {{ background:var(--karte); border:1px solid var(--linie);
  border-radius:10px; padding:10px 16px; min-width:104px; }}
.zahl b {{ display:block; font-size:22px; line-height:1.2; }}
.zahl span {{ font-size:12px; color:var(--leise); }}
.zahl.warnung b {{ color:var(--warn); }}
.fussnote {{ color:var(--leise); font-size:13px; margin:-8px 0 18px; }}
.hinweis {{ background:var(--warn-grund); border:1px solid var(--warn);
  border-radius:8px; padding:10px 14px; margin-bottom:16px; font-size:13px; }}
.hinweis ul {{ margin:6px 0 0; padding-left:20px; }}
.werkzeuge {{ display:flex; gap:10px; flex-wrap:wrap; align-items:center;
  margin-bottom:10px; }}
input[type=search] {{ flex:1; min-width:220px; padding:8px 12px;
  border:1px solid var(--linie); border-radius:8px; background:var(--karte);
  color:var(--schrift); font-size:14px; }}
.knopf {{ padding:7px 12px; border:1px solid var(--linie); border-radius:8px;
  background:var(--karte); color:var(--schrift); cursor:pointer;
  font-size:13px; }}
.knopf:hover {{ border-color:var(--betont); color:var(--betont); }}
.rahmen {{ background:var(--karte); border:1px solid var(--linie);
  border-radius:10px; overflow:auto; }}
table {{ border-collapse:collapse; width:100%; font-size:13px; }}
th, td {{ text-align:left; padding:7px 12px;
  border-bottom:1px solid var(--linie); vertical-align:top; }}
th {{ position:sticky; top:0; background:var(--karte); cursor:pointer;
  white-space:nowrap; font-weight:600; z-index:1; }}
th:hover {{ color:var(--betont); }}
th::after {{ content:"\\2195"; opacity:.3; margin-left:6px; }}
th.auf::after {{ content:"\\2191"; opacity:1; }}
th.ab::after {{ content:"\\2193"; opacity:1; }}
tr:last-child td {{ border-bottom:none; }}
tbody tr:hover {{ background:rgba(127,127,127,.08); }}
td.pfad {{ font-family:Consolas,ui-monospace,monospace; font-size:12px;
  word-break:break-all; max-width:420px; }}
.marke {{ display:inline-block; padding:1px 7px; border-radius:20px;
  font-size:11px; border:1px solid var(--linie); white-space:nowrap; }}
.marke.warn {{ background:var(--warn-grund); border-color:var(--warn);
  color:var(--warn); }}
.leer {{ padding:18px; color:var(--leise); }}
.fuss {{ margin-top:26px; color:var(--leise); font-size:12px; }}
@media print {{
  body {{ padding:0; background:#fff; }}
  .werkzeuge, .knopf {{ display:none; }}
  .rahmen {{ border:none; }}
  th {{ position:static; }}
}}
</style></head><body>
<h1>Bestandsaufnahme {rechner}</h1>
<div class="kopf">
  <b>{system}</b> &middot; Benutzer <b>{benutzer}</b> &middot;
  {architektur} &middot; aufgenommen am <b>{zeitpunkt}</b>
  &middot; {rechte}
</div>
{zahlen}
{ausgeblendet}
{hinweise}
{abschnitte}
<div class="fuss">VolmeInventar {fassung} &middot; Volme3D</div>
<script>
// Suche ueber alle Tabellen: blendet Zeilen aus, die den Text nicht enthalten.
function suchen(feld) {{
  var text = feld.value.toLowerCase().trim();
  var tabelle = document.getElementById(feld.dataset.ziel);
  var zeilen = tabelle.tBodies[0].rows, sichtbar = 0;
  for (var i = 0; i < zeilen.length; i++) {{
    var treffer = !text || zeilen[i].textContent.toLowerCase().indexOf(text) >= 0;
    zeilen[i].style.display = treffer ? "" : "none";
    if (treffer) sichtbar++;
  }}
  document.getElementById(feld.dataset.ziel + "-zahl").textContent =
    sichtbar + " von " + zeilen.length;
}}
// Sortierung. Zahlen und Datumsangaben brauchen einen eigenen Vergleich,
// sonst stuende "10.02.2024" vor "9.03.2024".
function sortieren(kopf) {{
  var tabelle = kopf.closest("table"), spalte = kopf.cellIndex;
  var ab = !kopf.classList.contains("ab");
  var koepfe = tabelle.tHead.rows[0].cells;
  for (var k = 0; k < koepfe.length; k++)
    koepfe[k].classList.remove("auf", "ab");
  kopf.classList.add(ab ? "ab" : "auf");
  var koerper = tabelle.tBodies[0];
  var zeilen = Array.prototype.slice.call(koerper.rows);
  // Nur ein GANZ aus Ziffern bestehender Schluessel ist eine Zahl.  Ein
  // parseFloat("2026-03-17") liefert 2026 - damit waeren alle Datumsangaben
  // desselben Jahres gleichwertig und die Sortierung bliebe wirkungslos.
  var nurZahl = /^-?[0-9]+([.][0-9]+)?$/;
  zeilen.sort(function (a, b) {{
    var x = a.cells[spalte], y = b.cells[spalte];
    var wx = x.dataset.wert, wy = y.dataset.wert;
    if (wx !== undefined && wy !== undefined) {{
      // Leere Werte immer ans Ende, in BEIDE Richtungen - sonst beginnt eine
      // Spalte mit Luecken beim Umdrehen mit lauter Leerzeilen.
      if (wx === "" || wy === "") {{
        if (wx === wy) return 0;
        return wx === "" ? 1 : -1;
      }}
      if (nurZahl.test(wx) && nurZahl.test(wy))
        return (ab ? 1 : -1) * (parseFloat(wx) - parseFloat(wy));
      return (ab ? 1 : -1) * wx.localeCompare(wy, "de");
    }}
    return (ab ? 1 : -1) *
      x.textContent.trim().localeCompare(y.textContent.trim(), "de",
                                         {{numeric: true}});
  }});
  for (var i = 0; i < zeilen.length; i++) koerper.appendChild(zeilen[i]);
}}
document.addEventListener("click", function (e) {{
  if (e.target.tagName === "TH") sortieren(e.target);
}});
</script>
</body></html>
"""


def _zahl_karte(wert, beschriftung, warnen=False):
    art = " warnung" if warnen and wert else ""
    return (f'<div class="zahl{art}"><b>{wert}</b>'
            f'<span>{html.escape(beschriftung)}</span></div>')


def _tabelle(kennung, spalten, zeilen, pfadspalten=(), markenspalten=()):
    if not zeilen:
        return '<div class="rahmen"><div class="leer">Nichts gefunden.</div></div>'
    kopf = "".join(f"<th>{html.escape(t)}</th>" for _, t in spalten)
    stuecke = []
    for zeile in zeilen:
        zellen = []
        for feld, _ in spalten:
            roh = zeile.get(feld)
            text = _text(roh)
            klasse = ' class="pfad"' if feld in pfadspalten else ""
            # Sortierschluessel dort, wo die Anzeige selbst nicht sortierbar
            # ist: "17.03.2026" und "5,5 MB" ordnen sich als Text falsch.
            # Wichtig: entweder ALLE Zellen einer Spalte bekommen einen
            # Schluessel oder keine - sonst vergleicht die Sortierung in
            # derselben Spalte mal Schluessel, mal Anzeigetext.
            sortierwert = ""
            if feld in DATUMSSPALTEN:
                sortierwert = ' data-wert="%s"' % (
                    roh.isoformat() if isinstance(roh, (datetime.date,
                                                        datetime.datetime))
                    else "")
            elif feld == "groesse":
                kb = zeile.get("groesse_kb")
                sortierwert = ' data-wert="%s"' % (kb if kb else "")
            if feld in markenspalten and text:
                warn = " warn" if text in ("Ziel fehlt", "unlesbar") else ""
                inhalt = f'<span class="marke{warn}">{html.escape(text)}</span>'
            else:
                inhalt = html.escape(text)
            zellen.append(f"<td{klasse}{sortierwert}>{inhalt}</td>")
        stuecke.append("<tr>" + "".join(zellen) + "</tr>")
    return (f'<div class="rahmen"><table id="{kennung}"><thead><tr>{kopf}'
            f'</tr></thead><tbody>{"".join(stuecke)}</tbody></table></div>')


def _abschnitt(titel, kennung, spalten, zeilen, **k):
    suche = (f'<div class="werkzeuge">'
             f'<input type="search" data-ziel="{kennung}" oninput="suchen(this)" '
             f'placeholder="{html.escape(titel)} durchsuchen ...">'
             f'<span class="marke" id="{kennung}-zahl">{len(zeilen)} '
             f'Eintraege</span></div>')
    return (f"<h2>{html.escape(titel)}</h2>{suche}"
            + _tabelle(kennung, spalten, zeilen, **k))


def als_html(bestand):
    a = bestand["angaben"]
    z = bestand.get("kennzahlen", {})
    karten = [
        _zahl_karte(z.get("programme", 0), "Programme"),
        _zahl_karte(z.get("store_apps", 0), "davon Store-Apps"),
        _zahl_karte(z.get("nur_benutzer", 0), "nur fuer diesen Benutzer"),
        _zahl_karte(z.get("verknuepfungen", 0), "Verknuepfungen"),
        _zahl_karte(z.get("autostart", 0), "im Autostart"),
        _zahl_karte(z.get("ziel_fehlt", 0), "Ziel fehlt", warnen=True),
    ]
    # Was ausgeblendet wurde, MUSS dastehen - sonst sieht eine um die Haelfte
    # gekuerzte Liste aus wie der vollstaendige Bestand.
    versteckt = []
    if z.get("ausgeblendet_programme"):
        versteckt.append(f"{z['ausgeblendet_programme']} Programme")
    if z.get("ausgeblendet_verknuepfungen"):
        versteckt.append(f"{z['ausgeblendet_verknuepfungen']} Verknuepfungen")
    ausgeblendet = ""
    if versteckt:
        ausgeblendet = ('<div class="fussnote">Nicht mitgezaehlt: '
                        + " und ".join(versteckt)
                        + ", die zu Windows selbst gehoeren.</div>")

    hinweise = ""
    if bestand.get("hinweise"):
        punkte = "".join(f"<li>{html.escape(str(h))}</li>"
                         for h in bestand["hinweise"])
        hinweise = f'<div class="hinweis"><b>Hinweise</b><ul>{punkte}</ul></div>'

    abschnitte = []
    if bestand.get("programme"):
        abschnitte.append(_abschnitt(
            "Installierte Programme", "programme", PROGRAMM_SPALTEN,
            [_programm_zeile(p) for p in bestand["programme"]],
            pfadspalten=("ordner",), markenspalten=("quelle", "bitheit")))
    if bestand.get("verknuepfungen"):
        abschnitte.append(_abschnitt(
            "Angelegte Verknuepfungen", "verweise", VERWEIS_SPALTEN,
            [_verweis_zeile(v) for v in bestand["verknuepfungen"]],
            pfadspalten=("ziel", "argumente"),
            markenspalten=("bereich", "zustand")))

    return VORLAGE.format(
        rechner=html.escape(a["rechner"]),
        system=html.escape(a.get("system_name") or a["system"]),
        benutzer=html.escape(a["benutzer"]),
        architektur=html.escape(a["architektur"]),
        zeitpunkt=a["zeitpunkt"].strftime("%d.%m.%Y um %H:%M"),
        rechte="als Administrator" if a["administrator"]
               else "ohne Administratorrechte",
        fassung=html.escape(a["fassung"]),
        zahlen='<div class="zahlen">' + "".join(karten) + "</div>",
        ausgeblendet=ausgeblendet,
        hinweise=hinweise,
        abschnitte="\n".join(abschnitte) or '<div class="leer">Nichts aufgenommen.</div>')


# ---------------------------------------------------------------- CSV / JSON
def als_csv(bestand, ziel):
    """Zwei Dateien - Programme und Verknuepfungen haben verschiedene Spalten,
    und eine gemischte Tabelle laesst sich in Excel nicht auswerten."""
    geschrieben = []
    stamm, endung = os.path.splitext(ziel)
    teile = [("programme", PROGRAMM_SPALTEN,
              [_programm_zeile(p) for p in bestand.get("programme", [])]),
             ("verknuepfungen", VERWEIS_SPALTEN,
              [_verweis_zeile(v) for v in bestand.get("verknuepfungen", [])])]
    for name, spalten, zeilen in teile:
        if not zeilen:
            continue
        pfad = f"{stamm}_{name}{endung or '.csv'}"
        # utf-8-sig, sonst zeigt Excel Umlaute falsch an.  Semikolon, weil
        # das deutsche Excel Komma als Dezimaltrenner liest.
        with open(pfad, "w", encoding="utf-8-sig", newline="") as f:
            schreiber = csv.writer(f, delimiter=";", quoting=csv.QUOTE_MINIMAL)
            schreiber.writerow([t for _, t in spalten])
            for zeile in zeilen:
                schreiber.writerow([_text(zeile.get(feld))
                                    for feld, _ in spalten])
        geschrieben.append(pfad)
    return geschrieben


def als_json(bestand, ziel):
    with open(ziel, "w", encoding="utf-8") as f:
        json.dump(bestand, f, ensure_ascii=False, indent=2, default=str)
    return [ziel]


def schreiben(bestand, ziel, form="html"):
    if form == "csv":
        return als_csv(bestand, ziel)
    if form == "json":
        return als_json(bestand, ziel)
    with open(ziel, "w", encoding="utf-8") as f:
        f.write(als_html(bestand))
    return [ziel]
