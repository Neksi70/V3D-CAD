#!/usr/bin/env python3
# VolmeStick - Windows-Abbilder herunterladen.
#
# Quelle ist WinFuture: dort liegen dieselben deutschen Original-ISOs, die
# Microsoft ausliefert, aber ohne den Bot-Schutz ("Sentinel"), an dem der
# direkte Weg ueber microsoft.com von Server- und VPN-Adressen scheitert.
# Die Downloadadressen sind mit einem Zeitstempel signiert und gelten nur
# kurz - sie werden deshalb erst unmittelbar vor dem Laden geholt.

import http.cookiejar
import os
import re
import time
import urllib.parse
import urllib.request

KEKSE = http.cookiejar.CookieJar()
OEFFNER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(KEKSE))
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
    return daten if roh else daten.decode("iso-8859-1", "ignore")


def ferngroesse(uri, referer=None):
    """Groesse ohne Download - um Bruchstuecke von vollstaendigen Dateien zu
    unterscheiden. None, wenn der Server es nicht verraet."""
    kopf = {"User-Agent": BROWSER}
    if referer:
        kopf["Referer"] = referer
    try:
        anfrage = urllib.request.Request(uri, headers=kopf, method="HEAD")
        with OEFFNER.open(anfrage, timeout=20) as a:
            laenge = a.headers.get("Content-Length")
            return int(laenge) if laenge else None
    except Exception:
        return None


def herunterladen(uri, zielordner, name=None, fortschritt=None, referer=None,
                  sha256=None):
    """Laedt das Abbild und rechnet die Pruefsumme gleich beim Schreiben mit -
    ein zweiter Durchlauf ueber 7 GB waere reine Zeitverschwendung.
    Ein angefangener Download wird fortgesetzt, sofern der Server das kann."""
    import hashlib
    os.makedirs(zielordner, exist_ok=True)
    name = name or os.path.basename(urllib.parse.urlparse(uri).path) or "abbild.iso"
    name = re.split(r"-filename|\?", os.path.basename(name))[0].strip() or "abbild.iso"
    ziel = os.path.join(zielordner, name)
    teil = ziel + ".teil"

    hasher = hashlib.sha256() if sha256 else None
    vorhanden = os.path.getsize(teil) if os.path.exists(teil) else 0
    if vorhanden and hasher:
        # Fortsetzen und Pruefsumme gleichzeitig geht nur, wenn wir das
        # bisher Geladene noch einmal durchrechnen - immer noch billiger
        # als der Neustart eines 7-GB-Downloads.
        with open(teil, "rb") as f:
            for block in iter(lambda: f.read(8 * 1024 * 1024), b""):
                hasher.update(block)

    kopf = {"User-Agent": BROWSER}
    if referer:
        kopf["Referer"] = referer
    if vorhanden:
        kopf["Range"] = f"bytes={vorhanden}-"

    anfrage = urllib.request.Request(uri, headers=kopf)
    with OEFFNER.open(anfrage, timeout=60) as a:
        if vorhanden and a.status != 206:
            vorhanden = 0                     # Server kann nicht fortsetzen
            hasher = hashlib.sha256() if sha256 else None
        gesamt = int(a.headers.get("Content-Length") or 0) + vorhanden
        geladen = vorhanden
        letzte = 0.0
        with open(teil, "ab" if vorhanden else "wb") as f:
            while True:
                block = a.read(4 * 1024 * 1024)
                if not block:
                    break
                f.write(block)
                if hasher:
                    hasher.update(block)
                geladen += len(block)
                if fortschritt and time.time() - letzte > 0.5:
                    letzte = time.time()
                    fortschritt(int(97 * geladen / gesamt) if gesamt else 0,
                                f"{geladen / 1024**3:.2f} / {gesamt / 1024**3:.2f} GB")

    ergebnis = {"pfad": ziel, "name": name}
    if hasher:
        gerechnet = hasher.hexdigest()
        ergebnis["sha256"] = gerechnet
        ergebnis["geprueft"] = gerechnet == sha256.lower().strip()
        if not ergebnis["geprueft"]:
            os.replace(teil, ziel + ".unvollstaendig")
            raise DownloadFehler(
                "Pruefsumme stimmt nicht - die Datei ist unterwegs beschaedigt "
                f"worden. Erwartet {sha256[:16]}…, berechnet {gerechnet[:16]}…. "
                "Die Datei wurde als .unvollstaendig beiseitegelegt.")
    os.replace(teil, ziel)
    ergebnis["groesse"] = os.path.getsize(ziel)
    if fortschritt:
        fortschritt(100, "Fertig" + (" - Pruefsumme stimmt" if hasher else ""))
    return ergebnis


if __name__ == "__main__":
    import sys
    produkt = sys.argv[1] if len(sys.argv) > 1 else "windows11"
    for a in ausgaben(produkt):
        print(f'{a["id"]:>6}  {a["name"]}')


# ------------------------------------------------------------- WinFuture
# WinFuture spiegelt die deutschen Original-ISOs von Microsoft und hat keinen
# Bot-Schutz. Die Downloadadressen sind mit Zeitstempel signiert und gelten
# nur kurz - man muss sie also direkt vor dem Laden von der Seite holen.

WF_SEITE = "https://winfuture.de/downloadvorschalt,{id}.html"
WF_KATALOG = [
    {"id": "4051", "titel": "Windows 11 (aktuelle Fassung, Deutsch)"},
    {"id": "3891", "titel": "Windows 10 22H2 (Deutsch)"},
    {"id": "3545", "titel": "Windows 10 Enterprise (90-Tage-Test)"},
]
WF_DATEI = re.compile(r"https://dl[\w.]*\.winfuture\.de/[^'\"\s\\]+", re.I)


def winfuture_seiten():
    """Bekannte Downloadseiten. Titel werden live geholt, damit die Liste
    mitzieht, wenn WinFuture auf eine neue Windows-Fassung wechselt."""
    liste = []
    for eintrag in WF_KATALOG:
        e = dict(eintrag)
        try:
            seite = _hole(WF_SEITE.format(id=e["id"]))
            titel = re.search(r"<title>(.*?)</title>", seite, re.S)
            if titel:
                e["titel"] = _entwirre(titel.group(1)).split(":")[0].strip() or e["titel"]
            e["dateien"] = len(_wf_dateien_aus(seite))
        except Exception:
            e["dateien"] = None       # Seite gerade nicht erreichbar
        liste.append(e)
    return liste


def _entwirre(text):
    """WinFuture liefert ISO-8859-1 mit HTML-Entitaeten."""
    import html
    return html.unescape(text).strip()


def _wf_dateien_aus(seite):
    treffer = []
    for uri in sorted(set(WF_DATEI.findall(seite))):
        name = uri.rsplit("/", 1)[-1]
        # Manche Adressen tragen den Dateinamen doppelt im Anhang
        name = re.split(r"-filename|\?", name)[0]
        if not name:
            continue
        treffer.append({"uri": uri, "name": name,
                        "typ": _wf_typ(name), "quelle": "winfuture"})
    return treffer


def _wf_typ(name):
    n = name.lower()
    if "arm64" in n:
        return "ARM64"
    if "x64" in n or "amd64" in n:
        return "x64"
    if "x32" in n or "x86" in n:
        return "32 Bit"
    return ""


def winfuture_dateien(seiten_id):
    """Downloadadressen einer WinFuture-Seite. Die Adressen sind kurzlebig -
    also erst holen, wenn wirklich geladen wird."""
    if not re.fullmatch(r"\d{1,6}", str(seiten_id)):
        raise DownloadFehler("Ungueltige Seitennummer")
    try:
        seite = _hole(WF_SEITE.format(id=seiten_id))
    except Exception as e:
        raise DownloadFehler(f"WinFuture nicht erreichbar: {e}")
    dateien = _wf_dateien_aus(seite)
    if not dateien:
        raise DownloadFehler(
            "Auf dieser WinFuture-Seite steht gerade keine Datei zum Laden. "
            "Vielleicht wurde sie umgebaut - dann die Seitennummer aus der "
            "Adresse (downloadvorschalt,NUMMER.html) von Hand eintragen.")
    groesse = re.search(r"([\d.,]+)\s*MB", seite)
    for d in dateien:
        d["hinweis_groesse"] = (groesse.group(0) if groesse else "")
        d["referer"] = WF_SEITE.format(id=seiten_id)
    return dateien
