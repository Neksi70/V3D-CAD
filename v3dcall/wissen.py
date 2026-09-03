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
KOMPAKT = os.path.join(WISSEN, "website-kompakt.md")
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
    # Die Preisseite zaehlt ihre Preise per JavaScript hoch; im ausgelieferten
    # Quelltext steht bei jedem Kurs "0 €". Muss weg, sonst sagt der Assistent
    # am Telefon, die Kurse seien kostenlos. Diese Zeile MUSS nach dem
    # Entfernen der Auszeichnung stehen — vorher steckt der Betrag noch im
    # Markup und die Zeilenanker greifen nicht.
    q = re.sub(r"(?m)^[ \t\u00a0]*0[ \t\u00a0]*€[ \t\u00a0]*$", "", q)
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


VERDICHTEN = """Verdichte den folgenden Website-Text zu einem knappen Briefing
fuer eine telefonische Auskunft.

- Nur Fakten, die am Telefon gefragt werden: Angebote, Preise, Dauer, Inhalte,
  Voraussetzungen, Termine, Anschrift, Erreichbarkeit, haeufige Fragen.
- Navigation, Werbetexte, Rechtliches, Bildhinweise und Wiederholungen weg.
- Praegnant gliedern. Zahlen und Eigennamen WOERTLICH uebernehmen, niemals
  runden oder umformulieren — daraus werden am Telefon Auskuenfte.
- Steht etwas nicht drin, erfinde es nicht. Luecken sind in Ordnung.
- VORSICHT bei Preisen: die Preisseite liefert animierte Platzhalter. Nimm
  Preise nur von den einzelnen Kursseiten ("ab 89 EUR inkl. MwSt."). Steht
  irgendwo "0 EUR", ist das ein Platzhalter und KEIN Preis — weglassen.
- PFLICHT: ein eigener Abschnitt "Ueber Volker Isken" mit allem zur Person —
  Werdegang, Berufserfahrung, was er unterrichtet, welche Technik und Geraete
  er beherrscht, warum es die Akademie gibt. Danach wird am Telefon
  regelmaessig gefragt ("Ist Volker Dozent?", "Was kann der eigentlich?"),
  und darauf muss aus dem Stand geantwortet werden. Diesen Abschnitt
  AUSFUEHRLICH halten, nicht auf eine Zeile eindampfen.
- Auf Deutsch, hoechstens 1200 Woerter.
- Statt 1200 lieber 1500 Woerter, wenn der Abschnitt zur Person das braucht.
- Schreibe "Maker-Kurs" mit Bindestrich. Ohne ihn liest die Sprachausgabe
  "Markerkurs".

WEBSITE-TEXT:
"""


def verdichte():
    """Website-Text einmalig zu einem Briefing eindampfen.

    Der Rohtext kostet ~0,6 s je Gespraechsrunde, weil er im Systemprompt
    steckt und jedes Mal durchgesehen wird — auch zwischengespeichert.
    Einmal verdichten spart das bei jeder Antwort.
    """
    import anthropic
    roh = _lies(WEBSITE)
    if not roh:
        raise RuntimeError("Kein Website-Text vorhanden — erst einlesen.")
    k = anthropic.Anthropic(api_key=core.cfg("dialog", "apiKey"), timeout=180.0)
    a = k.messages.create(
        model=core.cfg("dialog", "verdichtungsModel", default="claude-sonnet-5"),
        max_tokens=4000,
        messages=[{"role": "user", "content": VERDICHTEN + roh}])
    text = "".join(b.text for b in a.content if b.type == "text").strip()
    with open(KOMPAKT, "w", encoding="utf-8") as fh:
        fh.write(f"<!-- Aus website.md verdichtet am {time.strftime('%d.%m.%Y %H:%M')}. -->\n\n"
                 + text)
    return text


def _lies(p):
    try:
        with open(p, encoding="utf-8") as fh:
            return fh.read().strip()
    except FileNotFoundError:
        return ""


def wissensstand():
    """Beide Quellen zusammengesetzt — Korrekturen zuletzt, damit sie gelten.

    Bevorzugt das verdichtete Briefing; der Rohtext ist der Rueckfall.
    """
    w, k = _lies(KOMPAKT) or _lies(WEBSITE), _lies(KORREKTUREN)
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
    kurz = verdichte()
    print(f"Verdichtet: {len(kurz):,} Zeichen ({len(kurz)/len(inhalt)*100:.0f} %) -> {KOMPAKT}")
