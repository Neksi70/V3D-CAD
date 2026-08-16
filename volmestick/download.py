#!/usr/bin/env python3
# VolmeStick - Offizielle Windows-ISOs bei Microsoft holen.
#
# Microsoft bietet die ISOs nur ueber eine Klickstrecke an. Dahinter steckt
# eine schlichte API, die drei Schritte braucht:
#   1. Sitzungskennung beim Fingerabdruck-Dienst anmelden
#   2. Sprachliste zur gewaehlten Produktausgabe holen
#   3. Downloadlinks zur gewaehlten Sprache holen (Links gelten 24 Stunden)
# Wir laden dabei direkt von microsoft.com - keine fremden Spiegel.

import http.cookiejar
import json
import os
import re
import ssl
import time
import urllib.parse
import urllib.request
import uuid

PROFIL = "606624d44113"
# Microsoft prueft die Sitzung ("Sentinel"). Nur mit echten Sitzungs-Keksen,
# passendem Referer und etwas Bedenkzeit zwischen den Schritten geht es durch.
KEKSE = http.cookiejar.CookieJar()
OEFFNER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(KEKSE))
FINGERABDRUCK = "https://vlscppe.microsoft.com/fp/tags?org_id=y6jn8c31&session_id={sid}"
API = "https://www.microsoft.com/software-download-connector/api/"
SEITEN = {
    "windows11": "https://www.microsoft.com/de-de/software-download/windows11",
    "windows10": "https://www.microsoft.com/de-de/software-download/windows10ISO",
}
# Als Referer erwartet die API die Adresse ohne Sprachkennung.
REFERER = {
    "windows11": "https://www.microsoft.com/software-download/windows11",
    "windows10": "https://www.microsoft.com/software-download/windows10ISO",
}
BROWSER = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
           "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


class DownloadFehler(Exception):
    pass


def _hole(url, referer=None, roh=False, zeit=30):
    kopf = {"User-Agent": BROWSER, "Accept-Language": "de-DE,de;q=0.9,en;q=0.8"}
    if referer:
        kopf["Referer"] = referer
    kopf.setdefault("Accept", "text/html,application/xhtml+xml,application/xml;"
                              "q=0.9,image/avif,image/webp,*/*;q=0.8")
    anfrage = urllib.request.Request(url, headers=kopf)
    with OEFFNER.open(anfrage, timeout=zeit) as a:
        daten = a.read()
    return daten if roh else daten.decode("utf-8", "ignore")


def ausgaben(produkt="windows11"):
    """Welche Produktausgaben bietet Microsoft gerade an?"""
    if produkt not in SEITEN:
        raise DownloadFehler(f"Unbekanntes Produkt: {produkt}")
    try:
        seite = _hole(SEITEN[produkt])
    except Exception as e:
        raise DownloadFehler(f"Microsoft-Seite nicht erreichbar: {e}")
    treffer = re.findall(r'<option[^>]*value="(\d+)"[^>]*>([^<]+)</option>', seite)
    liste = [{"id": i, "name": n.strip()} for i, n in treffer
             if n.strip() and not n.strip().lower().startswith(("wähl", "select"))]
    if not liste:
        raise DownloadFehler(
            "Microsoft hat die Seite umgebaut - keine Produktausgabe gefunden. "
            "Bitte die ISO von Hand laden und hochladen.")
    return liste


def sprachen(ausgabe_id, produkt="windows11"):
    sid = str(uuid.uuid4())
    try:
        _hole(SEITEN[produkt])                      # Kekse einsammeln
        _hole(FINGERABDRUCK.format(sid=sid), referer=REFERER[produkt])
        time.sleep(1.5)                             # Sentinel mag keine Hektik
    except Exception:
        pass                       # nicht kritisch, die Sitzung gilt trotzdem oft
    url = (API + "getskuinformationbyproductedition?profile=" + PROFIL
           + f"&ProductEditionId={ausgabe_id}&SKU=undefined"
           + f"&friendlyFileName=undefined&Locale=en-US&sessionID={sid}")
    roh = _hole(url, referer=REFERER[produkt])
    try:
        daten = json.loads(roh)
    except json.JSONDecodeError:
        raise DownloadFehler("Antwort von Microsoft nicht lesbar (Sitzung abgelehnt?)")
    if daten.get("Errors"):
        raise DownloadFehler(_meldung(daten))
    return sid, [{"id": s["Id"], "name": s.get("LocalizedLanguage") or s.get("Language")}
                 for s in daten.get("Skus", [])]


def links(sid, sku_id, produkt="windows11", versuche=3):
    """Mehrere Anlaeufe: Microsofts Sentinel weist Anfragen gern einmal ab
    und laesst denselben Abruf mit frischer Sitzung dann durch."""
    letzter = None
    for nummer in range(versuche):
        try:
            return _links_einmal(sid, sku_id, produkt)
        except DownloadFehler as e:
            letzter = e
            if "Sentinel" not in str(e) and "abgelehnt" not in str(e):
                raise
            time.sleep(2 + 2 * nummer)
            sid, _ = sprachen(_letzte_ausgabe(produkt), produkt)
    raise letzter


def _letzte_ausgabe(produkt):
    return ausgaben(produkt)[0]["id"]


def _links_einmal(sid, sku_id, produkt="windows11"):
    produkt_merker[0] = produkt
    url = (API + "GetProductDownloadLinksBySku?profile=" + PROFIL
           + f"&productEditionId=undefined&SKU={sku_id}"
           + f"&friendlyFileName=undefined&Locale=en-US&sessionID={sid}")
    roh = _hole(url, referer=REFERER[produkt])
    try:
        daten = json.loads(roh)
    except json.JSONDecodeError:
        raise DownloadFehler("Antwort von Microsoft nicht lesbar")
    if daten.get("Errors"):
        raise DownloadFehler(_meldung(daten))
    treffer = []
    for o in daten.get("ProductDownloadOptions", []):
        treffer.append({"uri": o.get("Uri"),
                        "typ": o.get("DownloadType"),
                        "name": os.path.basename(
                            urllib.parse.urlparse(o.get("Uri", "")).path) or "windows.iso"})
    if not treffer:
        raise DownloadFehler("Microsoft liefert gerade keine Downloadlinks. "
                             "Meist hilft es, es in ein paar Minuten erneut zu versuchen.")
    return treffer


produkt_merker = ["windows11"]


def _meldung(daten):
    try:
        fehler = daten["Errors"][0]
        text = fehler.get("Value") or fehler.get("Type") or ""
    except Exception:
        text = ""
    if "715-123130" in str(text) or "Sentinel" in str(text) or not text:
        return ("Microsoft hat die Anfrage abgelehnt (Bot-Schutz 'Sentinel'). "
                "Das passiert vor allem bei Server- und VPN-Adressen. Vom "
                "heimischen Anschluss klappt es meist - sonst die ISO ueber "
                f"{SEITEN.get(produkt_merker[0], SEITEN['windows11'])} von Hand laden.")
    return f"Microsoft meldet: {text}"


def herunterladen(uri, zielordner, name=None, fortschritt=None):
    os.makedirs(zielordner, exist_ok=True)
    name = name or os.path.basename(urllib.parse.urlparse(uri).path) or "windows.iso"
    ziel = os.path.join(zielordner, name)
    teil = ziel + ".teil"
    anfrage = urllib.request.Request(uri, headers={"User-Agent": BROWSER})
    with urllib.request.urlopen(anfrage, timeout=60) as a:
        gesamt = int(a.headers.get("Content-Length") or 0)
        geladen = 0
        letzte = 0.0
        with open(teil, "wb") as f:
            while True:
                block = a.read(4 * 1024 * 1024)
                if not block:
                    break
                f.write(block)
                geladen += len(block)
                if fortschritt and time.time() - letzte > 0.5:
                    letzte = time.time()
                    fortschritt(int(100 * geladen / gesamt) if gesamt else 0,
                                f"{geladen / 1024**3:.2f} / {gesamt / 1024**3:.2f} GB")
    os.replace(teil, ziel)
    if fortschritt:
        fortschritt(100, "Fertig")
    return {"pfad": ziel, "groesse": os.path.getsize(ziel)}


if __name__ == "__main__":
    import sys
    produkt = sys.argv[1] if len(sys.argv) > 1 else "windows11"
    for a in ausgaben(produkt):
        print(f'{a["id"]:>6}  {a["name"]}')
