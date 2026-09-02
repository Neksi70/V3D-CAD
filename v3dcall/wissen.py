"""Wissensstand fuer den Telefonassistenten.

Zwei Quellen, die zweite hat Vorrang:
  1. data/wissen/website.md     — automatisch von volme3dakademie.de geholt
  2. data/wissen/korrekturen.md — von Hand gepflegt, ueberstimmt die Website
"""
import os, re, html, time
import requests
import core

WISSEN = os.path.join(core.DATA, "wissen")
WEBSITE = os.path.join(WISSEN, "website.md")
KORREKTUREN = os.path.join(WISSEN, "korrekturen.md")
SITEMAP = "https://volme3dakademie.de/sitemap.xml"
KOPF = {"User-Agent": "Mozilla/5.0 (kompatibel; V3D-Anrufannahme)"}


def _text(roh):
    """HTML zu lesbarem Text — grob, aber fuer eine Wissensbasis ausreichend."""
    q = re.sub(r"<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", roh, flags=re.S | re.I)
    q = re.sub(r"<(h[1-6])[^>]*>", r"\n\n## ", q, flags=re.I)
    q = re.sub(r"</(h[1-6])>", "\n", q, flags=re.I)
    q = re.sub(r"<(li)[^>]*>", "\n- ", q, flags=re.I)
    q = re.sub(r"<(p|br|div|tr|section)[^>]*>", "\n", q, flags=re.I)
    q = html.unescape(re.sub(r"<[^>]+>", " ", q))
    q = re.sub(r"[ \t ]+", " ", q)
    q = re.sub(r"\n\s*\n\s*\n+", "\n\n", q)
    return "\n".join(z.strip() for z in q.splitlines()).strip()


def seiten():
    r = requests.get(SITEMAP, headers=KOPF, timeout=20)
    r.raise_for_status()
    gefunden = re.findall(r"<loc>([^<]+)</loc>", r.text)
    # Rechtliches und Bildnachweise braucht am Telefon niemand
    raus = ("datenschutz", "impressum", "bildhinweise", "agb")
    return [u for u in gefunden if not any(w in u.lower() for w in raus)]


def hole_website():
    teile = ["<!-- Automatisch von volme3dakademie.de geholt. Nicht von Hand aendern,",
             "     wird beim naechsten Abruf ueberschrieben. Korrekturen gehoeren in",
             f"     korrekturen.md. Stand: {time.strftime('%d.%m.%Y %H:%M')} -->", ""]
    for u in seiten():
        try:
            r = requests.get(u, headers=KOPF, timeout=25)
            if r.status_code != 200:
                continue
            t = _text(r.text)
            if len(t) < 120:
                continue
            teile.append(f"\n\n# Seite: {u}\n\n{t}")
        except Exception:
            continue
    os.makedirs(WISSEN, exist_ok=True)
    inhalt = "\n".join(teile)
    with open(WEBSITE, "w", encoding="utf-8") as fh:
        fh.write(inhalt)
    return inhalt


def _lies(p):
    try:
        with open(p, encoding="utf-8") as fh:
            return fh.read().strip()
    except FileNotFoundError:
        return ""


def wissensstand():
    """Beide Quellen zusammengesetzt — Korrekturen zuletzt, damit sie gelten."""
    w, k = _lies(WEBSITE), _lies(KORREKTUREN)
    teile = []
    if w:
        teile.append("=== STAND DER WEBSITE (Hintergrund) ===\n\n" + w)
    if k:
        teile.append("=== KORREKTUREN UND ERGAENZUNGEN VON VOLKER ISKEN ===\n"
                     "Diese Angaben haben VORRANG vor der Website. Wo sich beides\n"
                     "widerspricht, gilt ausschliesslich dieser Abschnitt.\n\n" + k)
    return "\n\n".join(teile)


if __name__ == "__main__":
    inhalt = hole_website()
    print(f"Website eingesammelt: {len(inhalt):,} Zeichen, "
          f"{inhalt.count('# Seite:')} Seiten -> {WEBSITE}")
