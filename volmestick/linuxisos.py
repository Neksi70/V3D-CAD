#!/usr/bin/env python3
# VolmeStick - Linux-Abbilder bei den offiziellen Quellen holen.
#
# Absicht: keine fest eingetragenen Downloadadressen, die nach einem halben
# Jahr auf eine alte Fassung zeigen. Stattdessen wird die Verzeichnisliste
# bzw. die API des jeweiligen Projekts gelesen und die neueste Fassung
# genommen - samt SHA256, wo die Quelle sie mitliefert.
#
# Linux-ISOs sind Hybrid-Abbilder: sie gehoeren 1:1 auf den Stick (DD-Modus).

import json
import re
import urllib.parse
import urllib.request

BROWSER = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
           "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


class QuellenFehler(Exception):
    pass


def _text(url, zeit=25):
    anfrage = urllib.request.Request(url, headers={"User-Agent": BROWSER})
    with urllib.request.urlopen(anfrage, timeout=zeit) as a:
        return a.read().decode("utf-8", "ignore")


def _dateien(url, endung=".iso"):
    """Dateien aus einer Verzeichnisliste (Apache/nginx/lighttpd)."""
    seite = _text(url)
    treffer = []
    for h in re.findall(r'href="([^"]+)"', seite):
        if h.lower().endswith(endung) and "../" not in h:
            treffer.append((urllib.parse.unquote(h.rsplit("/", 1)[-1]),
                            urllib.parse.urljoin(url, h)))
    return sorted(set(treffer))


def _unterordner(url, muster=r"^\d"):
    seite = _text(url)
    namen = [h.strip("/") for h in re.findall(r'href="([^"]+/)"', seite)
             if re.match(muster, h) and ".." not in h]
    return sorted(set(namen), key=_version_schluessel)


def _version_schluessel(name):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", name)]


def _pruefsummen(url):
    """SHA256SUMS in den gaengigen Schreibweisen einlesen."""
    try:
        text = _text(url)
    except Exception:
        return {}
    summen = {}
    for zeile in text.splitlines():
        z = zeile.strip()
        m = re.match(r"^([0-9a-f]{64})\s+\*?(.+)$", z, re.I)
        if m:
            summen[m.group(2).strip()] = m.group(1).lower()
            continue
        m = re.match(r"^SHA256\s*\((.+?)\)\s*=\s*([0-9a-f]{64})$", z, re.I)
        if m:
            summen[m.group(1).strip()] = m.group(2).lower()
    return summen


def _bauen(dateien, summen=None, filter_muster=None):
    summen = summen or {}
    ergebnis = []
    for name, uri in dateien:
        if filter_muster and not re.search(filter_muster, name, re.I):
            continue
        ergebnis.append({"name": name, "uri": uri,
                         "sha256": summen.get(name, ""), "quelle": "linux"})
    return ergebnis


# ---------------------------------------------------------------- Quellen
def ubuntu():
    basis = "https://releases.ubuntu.com/"
    fassungen = [v for v in _unterordner(basis) if re.match(r"^\d+\.\d+", v)]
    if not fassungen:
        raise QuellenFehler("Ubuntu-Spiegel liefert keine Fassungsliste")
    neueste = fassungen[-1]
    # LTS = gerade Jahreszahl mit .04; die letzten beiden mitnehmen, damit auch
    # die bewaehrte Vorgaengerfassung zur Auswahl steht
    lts = [v for v in fassungen if v.split(".")[1][:2] == "04"
           and int(v.split(".")[0]) % 2 == 0]
    hauptfassungen = sorted({v.split(".")[0] + "." + v.split(".")[1] for v in lts},
                            key=_version_schluessel)
    letzte_lts = [max((v for v in lts if v.startswith(h)), key=_version_schluessel)
                  for h in hauptfassungen[-2:]]
    treffer = []
    for fassung in dict.fromkeys([neueste] + letzte_lts[::-1]):
        u = f"{basis}{fassung}/"
        try:
            treffer += _bauen(_dateien(u), _pruefsummen(u + "SHA256SUMS"))
        except Exception:
            continue
    return treffer


def linux_mint():
    basis = "https://mirrors.edge.kernel.org/linuxmint/stable/"
    fassungen = _unterordner(basis)
    if not fassungen:
        raise QuellenFehler("Mint-Spiegel liefert keine Fassungsliste")
    u = f"{basis}{fassungen[-1]}/"
    return _bauen(_dateien(u), _pruefsummen(u + "sha256sum.txt"))


def debian():
    treffer = []
    for art in ("iso-cd", "iso-dvd"):
        u = f"https://cdimage.debian.org/debian-cd/current/amd64/{art}/"
        try:
            treffer += _bauen(_dateien(u), _pruefsummen(u + "SHA256SUMS"))
        except Exception:
            continue
    if not treffer:
        raise QuellenFehler("Debian-Spiegel nicht erreichbar")
    return treffer


def fedora():
    daten = json.loads(_text("https://fedoraproject.org/releases.json"))
    passend = [e for e in daten
               if e.get("arch") == "x86_64"
               and str(e.get("link", "")).endswith(".iso")
               and e.get("subvariant") in ("Workstation", "KDE", "Server")]
    if not passend:
        raise QuellenFehler("Fedora liefert keine passenden Abbilder")
    neueste = max(int(e["version"]) for e in passend if str(e["version"]).isdigit())
    return [{"name": e["link"].rsplit("/", 1)[-1], "uri": e["link"],
             "sha256": e.get("sha256", ""), "quelle": "linux"}
            for e in passend if str(e["version"]) == str(neueste)]


def arch():
    u = "https://geo.mirror.pkgbuild.com/iso/latest/"
    return _bauen(_dateien(u), _pruefsummen(u + "sha256sums.txt"),
                  filter_muster=r"\d{4}\.\d{2}\.\d{2}")


def opensuse():
    """Tumbleweed haelt feste 'Current'-Adressen bereit; die Pruefsumme liegt
    als .sha256 direkt daneben."""
    basis = "https://download.opensuse.org/tumbleweed/iso/"
    treffer = []
    for art in ("DVD", "NET"):
        name = f"openSUSE-Tumbleweed-{art}-x86_64-Current.iso"
        sha = ""
        try:
            text = _text(basis + name + ".sha256")
            m = re.search(r"([0-9a-f]{64})", text, re.I)
            sha = m.group(1).lower() if m else ""
        except Exception:
            pass
        treffer.append({"name": name, "uri": basis + name,
                        "sha256": sha, "quelle": "linux"})
    return treffer


def kali():
    u = "https://cdimage.kali.org/current/"
    return _bauen(_dateien(u), _pruefsummen(u + "SHA256SUMS"))


def pop_os():
    treffer = []
    for fassung in ("24.04", "22.04"):
        for art, beschriftung in (("intel", "Intel/AMD"), ("nvidia", "NVIDIA")):
            try:
                d = json.loads(_text(f"https://api.pop-os.org/builds/{fassung}/{art}"))
            except Exception:
                continue
            treffer.append({"name": d["url"].rsplit("/", 1)[-1] + f"  ({beschriftung})",
                            "uri": d["url"], "sha256": d.get("sha_sum", ""),
                            "groesse": d.get("size"), "quelle": "linux"})
        if treffer:
            break
    if not treffer:
        raise QuellenFehler("Pop!_OS-API antwortet nicht")
    return treffer


def _enterprise(basis, kennung):
    fassungen = [v for v in _unterordner(basis) if re.match(r"^\d+$", v)]
    fassung = fassungen[-1] if fassungen else kennung
    u = f"{basis}{fassung}/isos/x86_64/"
    summen = {}
    for name in ("CHECKSUM", "SHA256SUM", "sha256sum.txt"):
        summen = _pruefsummen(u + name)
        if summen:
            break
    return _bauen(_dateien(u), summen)


def rocky():
    return _enterprise("https://download.rockylinux.org/pub/rocky/", "9")


def almalinux():
    return _enterprise("https://repo.almalinux.org/almalinux/", "9")


DISTRIBUTIONEN = [
    {"id": "ubuntu", "name": "Ubuntu", "hinweis": "Der Einsteiger-Standard",
     "aufloeser": ubuntu},
    {"id": "mint", "name": "Linux Mint", "hinweis": "Windows-nahe Bedienung",
     "aufloeser": linux_mint},
    {"id": "debian", "name": "Debian", "hinweis": "Grundsolide, netinst + DVD",
     "aufloeser": debian},
    {"id": "fedora", "name": "Fedora", "hinweis": "Neueste Technik",
     "aufloeser": fedora},
    {"id": "opensuse", "name": "openSUSE Tumbleweed", "hinweis": "Rollend, mit YaST",
     "aufloeser": opensuse},
    {"id": "arch", "name": "Arch Linux", "hinweis": "Selbst zusammenbauen",
     "aufloeser": arch},
    {"id": "popos", "name": "Pop!_OS", "hinweis": "Gute Treiberlage, auch NVIDIA",
     "aufloeser": pop_os},
    {"id": "kali", "name": "Kali Linux", "hinweis": "Werkzeugkasten für Sicherheitstests",
     "aufloeser": kali},
    {"id": "rocky", "name": "Rocky Linux", "hinweis": "RHEL-Nachbau für Server",
     "aufloeser": rocky},
    {"id": "alma", "name": "AlmaLinux", "hinweis": "RHEL-Nachbau für Server",
     "aufloeser": almalinux},
]


def distributionen():
    return [{k: v for k, v in d.items() if k != "aufloeser"} for d in DISTRIBUTIONEN]


def dateien(dist_id):
    for d in DISTRIBUTIONEN:
        if d["id"] == dist_id:
            try:
                treffer = d["aufloeser"]()
            except QuellenFehler:
                raise
            except Exception as e:
                raise QuellenFehler(f"{d['name']} nicht erreichbar: {e}")
            if not treffer:
                raise QuellenFehler(f"{d['name']} liefert gerade keine Abbilder")
            return treffer
    raise QuellenFehler(f"Unbekannte Distribution: {dist_id}")


if __name__ == "__main__":
    import sys
    for d in DISTRIBUTIONEN:
        if len(sys.argv) > 1 and sys.argv[1] != d["id"]:
            continue
        try:
            treffer = dateien(d["id"])
            print(f'{d["name"]}: {len(treffer)} Abbilder, '
                  f'{sum(1 for t in treffer if t["sha256"])} mit SHA256')
            for t in treffer[:3]:
                print("   ", t["name"], "|", t["uri"][:70])
        except Exception as e:
            print(f'{d["name"]}: FEHLER {e}')
