#!/usr/bin/env python3
# VolmeStick - Vergleicht eine fremde autounattend.xml (z. B. von einem
# Rufus-Stick) mit der, die VolmeStick selbst erzeugt.
#
# Zweck: Statt jede Vermutung durch eine 20-Minuten-Installation zu schicken,
# wird gegen eine nachweislich funktionierende Vorlage abgeglichen. Das
# Werkzeug sagt, WELCHE Stellschraube fehlt - nicht, dass irgendwas fehlt.
#
#   python3 vergleich.py                      # Stick suchen und vergleichen
#   python3 vergleich.py /pfad/autounattend.xml
#   python3 vergleich.py fremd.xml --optionen '{"benutzer":"kurs"}'

import glob
import json
import os
import subprocess
import sys
import xml.etree.ElementTree as ET

import unattend

NS = "{urn:schemas-microsoft-com:unattend}"
WCM = "{http://schemas.microsoft.com/WMIConfig/2002/State}"


# ---------------------------------------------------------------- Stick finden
def wechseldatentraeger():
    """Alle eingehaengten Wechseldatentraeger, egal ob per udisks oder von Hand."""
    pfade = []
    for muster in ("/media/*/*", "/run/media/*/*", "/mnt/*"):
        pfade += [p for p in glob.glob(muster) if os.path.isdir(p)]
    return pfade


def stick_einhaengen():
    """Haengt nicht eingehaengte Wechseldatentraeger per udisksctl ein.
    udisks braucht fuer Wechselmedien kein sudo - deshalb dieser Weg."""
    neu = []
    try:
        roh = subprocess.run(
            ["lsblk", "-J", "-o", "NAME,PATH,RM,TYPE,FSTYPE,MOUNTPOINTS,LABEL,SIZE"],
            capture_output=True, text=True, timeout=15).stdout
        baum = json.loads(roh)
    except Exception as e:
        print(f"  (lsblk nicht auswertbar: {e})")
        return neu

    def geraete(knoten):
        for k in knoten:
            yield k
            yield from geraete(k.get("children") or [])

    for g in geraete(baum.get("blockdevices", [])):
        if g.get("type") != "part" or not g.get("fstype"):
            continue
        eltern_wechsel = g.get("rm")
        punkte = [m for m in (g.get("mountpoints") or []) if m]
        if punkte:
            continue
        if not eltern_wechsel:
            # rm steht bei USB-Sticks oft nur am Elterngeraet
            elternname = g["name"].rstrip("0123456789")
            if not os.path.exists(f"/sys/block/{elternname}/removable"):
                continue
            if open(f"/sys/block/{elternname}/removable").read().strip() != "1":
                continue
        try:
            r = subprocess.run(["udisksctl", "mount", "-b", g["path"]],
                               capture_output=True, text=True, timeout=30)
            if r.returncode == 0:
                ziel = r.stdout.strip().split(" at ")[-1].rstrip(".")
                print(f"  eingehaengt: {g['path']} -> {ziel}")
                neu.append(ziel)
            else:
                print(f"  {g['path']}: {r.stderr.strip() or 'nicht einhaengbar'}")
        except FileNotFoundError:
            print("  (udisksctl fehlt - Stick bitte von Hand einhaengen)")
            break
        except Exception as e:
            print(f"  {g['path']}: {e}")
    return neu


def suche_antwortdatei():
    """Sucht autounattend.xml im Wurzelverzeichnis aller Wechseldatentraeger."""
    kandidaten = []
    for grund in wechseldatentraeger() + stick_einhaengen():
        for name in ("autounattend.xml", "Autounattend.xml", "AutoUnattend.xml",
                     "unattend.xml"):
            p = os.path.join(grund, name)
            if os.path.isfile(p):
                kandidaten.append(p)
    return kandidaten


# ------------------------------------------------------------------- Auslesen
def _pfad_werte(element, praefix=""):
    """Platt gedrueckter Baum: {"OOBE/HideOnlineAccountScreens": "true", ...}
    Listen (RunSynchronousCommand, LocalAccount) werden durchnummeriert."""
    aus = {}
    zaehler = {}
    for kind in element:
        name = kind.tag.replace(NS, "")
        if kind.get(f"{WCM}action") == "add" or name in (
                "RunSynchronousCommand", "SynchronousCommand", "LocalAccount"):
            zaehler[name] = zaehler.get(name, 0) + 1
            marke = f"{name}[{zaehler[name]}]"
        else:
            marke = name
        schluessel = f"{praefix}{marke}"
        if len(kind):
            aus.update(_pfad_werte(kind, schluessel + "/"))
        else:
            aus[schluessel] = (kind.text or "").strip()
    return aus


def lies(xml_text):
    """{(pass, komponente): {pfad: wert}}"""
    wurzel = ET.fromstring(xml_text)
    aus = {}
    for settings in wurzel:
        pas = settings.get("pass")
        for komp in settings:
            name = komp.get("name")
            aus.setdefault((pas, name), {}).update(_pfad_werte(komp))
    return aus


# ----------------------------------------------------------------- Vergleichen
def vergleiche(fremd_text, eigen_text, fremd_name="Rufus", eigen_name="VolmeStick"):
    a, b = lies(fremd_text), lies(eigen_text)
    zeilen = []

    def kopf(t):
        zeilen.append("")
        zeilen.append(t)
        zeilen.append("-" * len(t))

    nur_a = sorted(set(a) - set(b))
    nur_b = sorted(set(b) - set(a))
    if nur_a:
        kopf(f"Komponenten NUR bei {fremd_name}")
        for pas, komp in nur_a:
            zeilen.append(f"  {pas:<12} {komp}")
            for p, w in sorted(a[(pas, komp)].items()):
                zeilen.append(f"       {p} = {w}")
    if nur_b:
        kopf(f"Komponenten NUR bei {eigen_name}")
        for pas, komp in nur_b:
            zeilen.append(f"  {pas:<12} {komp}")

    for schluessel in sorted(set(a) & set(b)):
        pas, komp = schluessel
        fa, fb = a[schluessel], b[schluessel]
        fehlt = sorted(set(fa) - set(fb))
        extra = sorted(set(fb) - set(fa))
        anders = sorted(p for p in set(fa) & set(fb) if fa[p] != fb[p])
        if not (fehlt or extra or anders):
            continue
        kopf(f"{pas} / {komp}")
        for p in fehlt:
            zeilen.append(f"  FEHLT bei uns   {p} = {fa[p]}")
        for p in anders:
            zeilen.append(f"  ANDERS          {p}")
            zeilen.append(f"                  {fremd_name}: {fa[p]}")
            zeilen.append(f"                  {eigen_name}: {fb[p]}")
        for p in extra:
            zeilen.append(f"  nur bei uns     {p} = {fb[p]}")

    if not zeilen:
        zeilen.append("Kein Unterschied gefunden.")
    return "\n".join(zeilen)


def hauptsache(argv):
    args = [a for a in argv if not a.startswith("--")]
    optionen = {}
    if "--optionen" in argv:
        optionen = json.loads(argv[argv.index("--optionen") + 1])

    if args:
        quelle = args[0]
    else:
        print("Suche Antwortdatei auf Wechseldatentraegern ...")
        gefunden = suche_antwortdatei()
        if not gefunden:
            print("Keine autounattend.xml gefunden. Stick eingesteckt?")
            return 1
        for i, p in enumerate(gefunden, 1):
            print(f"  {i}. {p}")
        quelle = gefunden[0]

    print(f"\nVergleiche: {quelle}\n")
    fremd = open(quelle, encoding="utf-8-sig").read()
    eigen = unattend.baue_unattend(optionen)
    print(vergleiche(fremd, eigen))

    ablage = os.path.expanduser("~/Downloads/VolmeStick/rufus-referenz.xml")
    os.makedirs(os.path.dirname(ablage), exist_ok=True)
    with open(ablage, "w", encoding="utf-8") as f:
        f.write(fremd)
    print(f"\nVorlage gesichert: {ablage}")
    return 0


if __name__ == "__main__":
    sys.exit(hauptsache(sys.argv[1:]))
