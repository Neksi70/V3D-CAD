#!/usr/bin/env python3
# VolmeStick - Kern.  Windows-Installationsmedien bauen wie Rufus,
# nur zusaetzlich mit ISO-Ausgabe (fuer VMware) statt nur USB.
#
#   python3 vstick.py analyse   win11.iso
#   python3 vstick.py xml       --benutzer kurs
#   python3 vstick.py iso       win11.iso -o win11-v3d.iso --benutzer kurs
#   python3 vstick.py geraete
#   python3 vstick.py stick     win11.iso /dev/sdb --benutzer kurs
#
# Laeuft auf Linux und Windows. Der ISO-Umbau braucht xorriso (Linux),
# das Stick-Schreiben braucht root bzw. Administrator.

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time

BASIS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASIS)

from iso9660 import Iso, IsoFehler          # noqa: E402
import wim                                  # noqa: E402
import unattend                             # noqa: E402
import isowriter                            # noqa: E402
import isopatch                             # noqa: E402
import download                             # noqa: E402
import linuxisos                            # noqa: E402

IST_WINDOWS = platform.system() == "Windows"
GIB = 1024 ** 3
FAT32_GRENZE = 4 * GIB - 1
BOOT_MB = 1400            # FAT32-Boot-Partition beim Zwei-Partitionen-Aufbau


class Fehler(Exception):
    pass


def _still(*a, **k):
    pass


# --------------------------------------------------------------- Analyse
def analysiere(iso_pfad):
    """Was steckt in der ISO? Fuer die Oberflaeche und als Sicherheitsnetz."""
    if not os.path.isfile(iso_pfad):
        raise Fehler(f"Datei nicht gefunden: {iso_pfad}")
    info = {
        "pfad": os.path.abspath(iso_pfad),
        "datei": os.path.basename(iso_pfad),
        "groesse": os.path.getsize(iso_pfad),
        "ist_windows": False,
        "volid": "",
        "editionen": [],
        "install_datei": "",
        "install_groesse": 0,
        "braucht_ntfs": False,
        "uefi": False,
        "bios": False,
        "warnungen": [],
    }
    try:
        with Iso(iso_pfad) as iso:
            info["volid"] = iso.volid
            info["uefi"] = iso.existiert("efi/microsoft/boot/efisys.bin") \
                or iso.existiert("efi/boot/bootx64.efi")
            info["bios"] = iso.existiert("boot/etfsboot.com") \
                or iso.existiert("bootmgr")
            setup = iso.existiert("setup.exe")
            boot_wim = iso.existiert("sources/boot.wim")
            e = iso.finde("sources/install.wim") or iso.finde("sources/install.esd")
            if e is not None:
                info["install_datei"] = e.pfad
                info["install_groesse"] = e.groesse
                info["braucht_ntfs"] = e.groesse > FAT32_GRENZE
                info["editionen"] = wim.editionen(
                    lambda off, l, _e=e, _i=iso: _i.lies(_e, off, l))
            info["ist_windows"] = bool(setup and boot_wim and e is not None)
            if not info["ist_windows"]:
                # Linux- und andere Abbilder bringen ihren eigenen Startsatz mit
                # und gehoeren 1:1 auf den Stick.
                info["warnungen"].append(
                    "Keine Windows-Installations-ISO - wird 1:1 auf den Stick "
                    "geschrieben (DD-Modus). Die Windows-Anpassungen bleiben "
                    "dabei ohne Wirkung.")
            if not info["uefi"]:
                info["warnungen"].append(
                    "Keine EFI-Startdateien gefunden - in VMware nur mit BIOS-Firmware startbar.")
            if info["braucht_ntfs"]:
                info["warnungen"].append(
                    f"{os.path.basename(info['install_datei'])} ist "
                    f"{info['install_groesse'] / GIB:.1f} GB gross und passt nicht auf FAT32. "
                    "Der Stick wird deshalb zweigeteilt (FAT32 zum Starten + NTFS fuer das Abbild).")
    except IsoFehler as e:
        raise Fehler(f"ISO nicht lesbar: {e}")
    return info


# --------------------------------------------------------------- ISO bauen
def _xorriso():
    return shutil.which("xorriso")


def baue_iso(quelle, ziel, optionen=None, fortschritt=_still, volid=None,
             werkzeug="auto"):
    """Fertige ISO mit eingelegter autounattend.xml - eine einzige Datei, die
    in VMware sofort startet.

    werkzeug  auto    - einhaengen (ueberall lauffaehig), sonst xorriso
              patch   - nur einhaengen
              xorriso - ISO komplett neu schreiben (nur Linux)

    Der Regelweg haengt die Datei in eine Kopie der ISO ein, statt sie neu zu
    bauen: das braucht kein xorriso (das es unter Windows nicht gibt), dauert
    nur so lange wie das Kopieren und laesst die Startsaetze unangetastet.
    """
    quelle = os.path.abspath(quelle)
    ziel = os.path.abspath(ziel)
    if quelle == ziel:
        raise Fehler("Quelle und Ziel duerfen nicht dieselbe Datei sein")
    info = analysiere(quelle)
    xml = unattend.baue_unattend(optionen)
    label = (volid or info["volid"] or "V3D_WIN")[:32]

    if werkzeug in ("auto", "patch"):
        try:
            isopatch.lege_datei_bei(quelle, ziel,
                                    {"AUTOUNATTEND.XML": xml.encode("utf-8")},
                                    fortschritt)
            return {"ziel": ziel, "groesse": os.path.getsize(ziel),
                    "volid": info["volid"], "unattend": xml, "weg": "eingehaengt"}
        except isopatch.PatchFehler as e:
            if werkzeug == "patch" or not _xorriso():
                raise Fehler(f"Einhaengen fehlgeschlagen: {e}")
            fortschritt(5, f"Einhaengen ging nicht ({e}) - baue neu mit xorriso")
            if os.path.exists(ziel):
                os.remove(ziel)

    if not _xorriso():
        raise Fehler("Fuer diesen Weg wird xorriso gebraucht: sudo apt install xorriso")

    tmp = tempfile.mkdtemp(prefix="vstick-")
    xml_datei = os.path.join(tmp, "autounattend.xml")
    with open(xml_datei, "w", encoding="utf-8") as f:
        f.write(xml)
    try:
        fortschritt(5, "Startdateien uebernehmen ...")
        befehl = [_xorriso(), "-indev", quelle, "-outdev", ziel,
                  "-boot_image", "any", "replay", "-volid", label,
                  "-overwrite", "on",
                  "-map", xml_datei, "/autounattend.xml",
                  "-map", xml_datei, "/AUTOUNATTEND.XML",
                  "-commit", "-end"]
        _lauf_mit_fortschritt(befehl, fortschritt, info["groesse"], ziel)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if not os.path.isfile(ziel) or os.path.getsize(ziel) < 1024:
        raise Fehler("ISO wurde nicht geschrieben")
    fortschritt(100, "Fertig")
    return {"ziel": ziel, "groesse": os.path.getsize(ziel), "volid": label,
            "unattend": xml, "weg": "neu gebaut"}


def _lauf_mit_fortschritt(befehl, fortschritt, erwartet, ziel):
    p = subprocess.Popen(befehl, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, bufsize=1)
    letzte = 0
    for zeile in p.stdout:
        zeile = zeile.strip()
        if not zeile:
            continue
        jetzt = time.time()
        if jetzt - letzte > 0.5:
            letzte = jetzt
            da = os.path.getsize(ziel) if os.path.exists(ziel) else 0
            anteil = min(97, 5 + int(90 * da / max(1, erwartet)))
            fortschritt(anteil, zeile[:120])
    if p.wait() != 0:
        raise Fehler("xorriso ist ausgestiegen - siehe Protokoll")


def _baue_iso_ohne_xorriso(quelle, ziel, xml_datei, label, info, fortschritt):
    """Notnagel: ISO entpacken und mit genisoimage neu bauen. Taugt nur fuer
    Abbilder unter 4 GB - groessere Dateien kann genisoimage nicht sauber."""
    mkisofs = shutil.which("genisoimage") or shutil.which("mkisofs")
    if not mkisofs:
        raise Fehler("Weder xorriso noch genisoimage vorhanden - "
                     "bitte 'sudo apt install xorriso' ausfuehren.")
    if info["install_groesse"] > FAT32_GRENZE:
        raise Fehler(
            "Das Abbild ist groesser als 4 GB. Dafuer wird xorriso gebraucht: "
            "sudo apt install xorriso")
    arbeit = tempfile.mkdtemp(prefix="vstick-iso-")
    try:
        fortschritt(5, "ISO entpacken ...")
        with Iso(quelle) as iso:
            iso.entpacke(arbeit, lambda f, g, p: fortschritt(
                5 + int(60 * f / g), "Entpacken: " + p))
        shutil.copy(xml_datei, os.path.join(arbeit, "autounattend.xml"))
        for muell in ("boot.catalog", "BOOT.CAT"):
            p = os.path.join(arbeit, muell)
            if os.path.exists(p):
                os.remove(p)
        befehl = [mkisofs, "-quiet", "-o", ziel, "-J", "-joliet-long", "-r",
                  "-V", label, "-udf"]
        if os.path.exists(os.path.join(arbeit, "boot", "etfsboot.com")):
            befehl += ["-b", "boot/etfsboot.com", "-no-emul-boot",
                       "-boot-load-size", "8", "-hide", "boot.catalog"]
        if os.path.exists(os.path.join(arbeit, "efi/microsoft/boot/efisys.bin")):
            befehl += ["-eltorito-alt-boot", "-e", "efi/microsoft/boot/efisys.bin",
                       "-no-emul-boot"]
        befehl.append(arbeit)
        fortschritt(70, "ISO schreiben ...")
        r = subprocess.run(befehl, capture_output=True, text=True)
        if r.returncode != 0:
            raise Fehler("genisoimage: " + (r.stderr or r.stdout)[-300:])
    finally:
        shutil.rmtree(arbeit, ignore_errors=True)


def antwort_iso(ziel, optionen=None):
    """Winzige ISO mit nur der autounattend.xml. In VMware als zweites
    CD-Laufwerk neben die Windows-ISO haengen - Setup findet die Datei auf
    jedem Laufwerk. Spart den Umbau des grossen Abbilds vollstaendig."""
    xml = unattend.baue_unattend(optionen)
    isowriter.antwort_iso(ziel, xml)
    return {"ziel": os.path.abspath(ziel), "groesse": os.path.getsize(ziel),
            "unattend": xml}


# --------------------------------------------------------------- Geraete
def geraete(alle=False):
    """Wechseldatentraeger auflisten. Ohne 'alle' nur USB/Wechselmedien -
    damit niemand aus Versehen die Systemplatte plaettet."""
    return _geraete_windows(alle) if IST_WINDOWS else _geraete_linux(alle)


def _system_platte():
    """Die Platte, auf der / liegt - die wird nie zum Ziel."""
    try:
        quelle = subprocess.run(["findmnt", "-no", "SOURCE", "/"],
                                capture_output=True, text=True).stdout.strip()
        pk = subprocess.run(["lsblk", "-no", "PKNAME", quelle],
                            capture_output=True, text=True).stdout.strip().splitlines()
        return "/dev/" + pk[0].strip() if pk and pk[0].strip() else ""
    except Exception:
        return ""


def _einhaengepunkte(knoten, treffer):
    """Rekursiv, denn unter der Partition koennen LVM/LUKS/RAID haengen."""
    for m in (knoten.get("mountpoints") or []):
        if m:
            treffer.append(m)
    if knoten.get("mountpoint"):
        treffer.append(knoten["mountpoint"])
    for kind in knoten.get("children", []):
        _einhaengepunkte(kind, treffer)


def _geraete_linux(alle):
    try:
        r = subprocess.run(
            ["lsblk", "-J", "-b", "-o",
             "NAME,PATH,SIZE,MODEL,VENDOR,RM,HOTPLUG,TRAN,TYPE,MOUNTPOINT,MOUNTPOINTS"],
            capture_output=True, text=True, check=True)
        daten = json.loads(r.stdout)
    except Exception as e:
        raise Fehler(f"lsblk nicht auswertbar: {e}")
    systemplatte = _system_platte()
    liste = []
    for d in daten.get("blockdevices", []):
        if d.get("type") != "disk":
            continue
        # hotplug allein sagt nichts: auch interne NVMe melden hotplug=true
        wechsel = bool(d.get("rm")) or str(d.get("tran") or "").lower() in ("usb", "mmc")
        eingehaengt = []
        _einhaengepunkte(d, eingehaengt)
        eingehaengt = sorted(set(m for m in eingehaengt if m))
        system = (d.get("path") == systemplatte
                  or any(m in ("/", "/boot", "/boot/efi", "/home", "/var") or m.startswith("/snap")
                         for m in eingehaengt))
        if not wechsel and not alle:
            continue
        liste.append({
            "pfad": d.get("path"),
            "name": (str(d.get("vendor") or "").strip() + " "
                     + str(d.get("model") or "").strip()).strip() or d.get("name"),
            "groesse": int(d.get("size") or 0),
            "wechsel": wechsel,
            "bus": d.get("tran") or "",
            "eingehaengt": eingehaengt,
            "system": system,
        })
    return liste


def _powershell(skript):
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive",
                        "-Command", skript],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise Fehler("PowerShell: " + (r.stderr or r.stdout)[-300:])
    return r.stdout


def _geraete_windows(alle):
    roh = _powershell(
        "Get-Disk | Select-Object Number,FriendlyName,Size,BusType,IsSystem,"
        "IsBoot,OperationalStatus | ConvertTo-Json -Compress")
    try:
        daten = json.loads(roh or "[]")
    except json.JSONDecodeError:
        raise Fehler("Get-Disk lieferte keine auswertbare Antwort")
    if isinstance(daten, dict):
        daten = [daten]
    liste = []
    for d in daten:
        usb = str(d.get("BusType", "")).upper() in ("USB", "7", "SD", "MMC")
        system = bool(d.get("IsSystem")) or bool(d.get("IsBoot"))
        if (not usb or system) and not alle:
            continue
        liste.append({
            "pfad": str(d.get("Number")),
            "name": d.get("FriendlyName") or f"Datentraeger {d.get('Number')}",
            "groesse": int(d.get("Size") or 0),
            "wechsel": usb,
            "bus": str(d.get("BusType", "")),
            "eingehaengt": [],
            "system": system,
        })
    return liste


# --------------------------------------------------------------- Stick
def stick_schreiben(iso_pfad, geraet, optionen=None, fortschritt=_still,
                    erzwingen=False, label="V3D_WIN", modus="auto",
                    schema="gpt", dateisystem="auto", schnell=True):
    """ACHTUNG: loescht den Zieldatentraeger vollstaendig.

    modus        auto   - Windows-ISO erkennen, sonst 1:1 schreiben
                 windows- Dateien entpacken + autounattend.xml (wie Rufus ISO-Modus)
                 dd     - Abbild byteweise aufs Geraet (Linux-ISOs, Hybrid-Abbilder)
                 leer   - nur formatieren, nichts kopieren
    schema       gpt (UEFI) oder mbr (UEFI + altes BIOS)
    dateisystem  auto | fat32 | ntfs | exfat
    """
    info = None
    if modus != "leer":
        info = analysiere(iso_pfad)
    if modus == "auto":
        modus = "windows" if (info and info["ist_windows"]) else "dd"
    if modus not in ("windows", "dd", "leer"):
        raise Fehler(f"Unbekannter Modus: {modus}")
    if schema not in ("gpt", "mbr"):
        raise Fehler(f"Unbekanntes Partitionsschema: {schema}")

    ziel = _pruefe_ziel(geraet, info or {"groesse": 0}, erzwingen)
    if modus == "dd":
        return _dd_schreiben(iso_pfad, ziel, fortschritt)

    xml = unattend.baue_unattend(optionen) if modus == "windows" else ""
    # Fuer Windows entscheidet die Groesse des Abbilds ueber das Dateisystem:
    # ueber 4 GB passt install.wim nicht auf FAT32, aber nur von FAT32 startet
    # jede UEFI-Firmware zuverlaessig - also zweigeteilt.
    zweigeteilt = bool(info and info["braucht_ntfs"]) and dateisystem in ("auto", "fat32")
    if dateisystem == "auto":
        dateisystem = "fat32"
    if dateisystem in ("ntfs", "exfat"):
        zweigeteilt = False
    aufbau = {"modus": modus, "schema": schema, "dateisystem": dateisystem,
              "zweigeteilt": zweigeteilt, "schnell": schnell, "label": label}
    if IST_WINDOWS:
        return _stick_windows(iso_pfad, ziel, xml, info, fortschritt, aufbau)
    return _stick_linux(iso_pfad, ziel, xml, info, fortschritt, aufbau)


def _dd_schreiben(iso_pfad, g, fortschritt):
    """Abbild 1:1 auf den Datentraeger - fuer Linux- und Hybrid-ISOs, die
    ihren eigenen Bootsektor mitbringen."""
    quelle_groesse = os.path.getsize(iso_pfad)
    if IST_WINDOWS:
        _diskpart([f"select disk {int(g['pfad'])}", "clean"], fortschritt)
        ziel_pfad = r"\\.\PhysicalDrive" + str(int(g["pfad"]))
        modus = "rb+"
    else:
        if os.geteuid() != 0:
            raise Fehler("Zum Schreiben werden root-Rechte gebraucht")
        for m in g.get("eingehaengt", []):
            subprocess.run(["umount", m], capture_output=True)
        ziel_pfad = g["pfad"]
        modus = "wb"
    fortschritt(2, "Abbild 1:1 schreiben ...")
    geschrieben = 0
    with open(iso_pfad, "rb") as q, open(ziel_pfad, modus, buffering=0) as z:
        while True:
            block = q.read(8 * 1024 * 1024)
            if not block:
                break
            z.write(block)
            geschrieben += len(block)
            fortschritt(2 + int(93 * geschrieben / max(1, quelle_groesse)),
                        f"{geschrieben / GIB:.2f} / {quelle_groesse / GIB:.2f} GB")
        z.flush()
        os.fsync(z.fileno())
    if not IST_WINDOWS:
        subprocess.run(["sync"], capture_output=True)
        subprocess.run(["blockdev", "--rereadpt", g["pfad"]], capture_output=True)
    fortschritt(100, "Fertig")
    return {"geraet": g["pfad"], "modus": "dd", "geschrieben": geschrieben}


def _pruefe_ziel(geraet, info, erzwingen):
    liste = geraete(alle=True)
    treffer = [g for g in liste if str(g["pfad"]) == str(geraet)
               or g["pfad"] == f"/dev/{geraet}"]
    if not treffer:
        raise Fehler(f"Datentraeger nicht gefunden: {geraet}")
    g = treffer[0]
    if g["system"]:
        raise Fehler(f"{g['pfad']} traegt das laufende System - wird nicht angefasst.")
    if not g["wechsel"] and not erzwingen:
        raise Fehler(f"{g['pfad']} ist kein Wechseldatentraeger. "
                     "Wenn das wirklich gewollt ist: --erzwingen.")
    if g["eingehaengt"] and not erzwingen:
        # Genau so plaettet man aus Versehen die Backup-Platte.
        raise Fehler(f"{g['pfad']} ist gerade eingehaengt ({', '.join(g['eingehaengt'])}). "
                     "Erst aushaengen - oder --erzwingen, wenn es wirklich weg soll.")
    noetig = info["groesse"] + 256 * 1024 * 1024
    if g["groesse"] and g["groesse"] < noetig:
        raise Fehler(f"Datentraeger zu klein: {g['groesse'] / GIB:.1f} GB, "
                     f"gebraucht werden {noetig / GIB:.1f} GB")
    return g


def _lauf(befehl, fehlertext):
    r = subprocess.run(befehl, capture_output=True, text=True)
    if r.returncode != 0:
        raise Fehler(f"{fehlertext}: {(r.stderr or r.stdout).strip()[-300:]}")
    return r.stdout


def _partition(dev, nummer):
    return f"{dev}p{nummer}" if re.search(r"(nvme|mmcblk|loop)\d+$", dev) else f"{dev}{nummer}"


def _stick_linux(iso_pfad, g, xml, info, fortschritt, aufbau):
    if os.geteuid() != 0:
        raise Fehler("Zum Beschreiben eines Datentraegers werden root-Rechte "
                     "gebraucht: sudo python3 vstick.py stick ...")
    dev = g["pfad"]
    zweigeteilt = aufbau["zweigeteilt"]
    fs = aufbau["dateisystem"]
    label = aufbau["label"]

    fortschritt(2, f"{dev} aushaengen ...")
    for m in g.get("eingehaengt", []):
        subprocess.run(["umount", m], capture_output=True)
    for kind in _kinder(dev):
        subprocess.run(["umount", kind], capture_output=True)

    fortschritt(5, "Partitionstabelle anlegen ...")
    _lauf(["wipefs", "-a", dev], "wipefs")
    tabelle = "gpt" if aufbau["schema"] == "gpt" else "msdos"
    _lauf(["parted", "-s", dev, "mklabel", tabelle], "parted mklabel")
    typ = {"fat32": "fat32", "ntfs": "ntfs", "exfat": "ntfs"}[fs]
    if zweigeteilt:
        _lauf(["parted", "-s", dev, "mkpart", "primary" if tabelle == "msdos" else "V3DBOOT",
               "fat32", "1MiB", f"{BOOT_MB}MiB"], "parted p1")
        _lauf(["parted", "-s", dev, "mkpart", "primary" if tabelle == "msdos" else "V3DDATA",
               "ntfs", f"{BOOT_MB}MiB", "100%"], "parted p2")
    else:
        _lauf(["parted", "-s", dev, "mkpart", "primary" if tabelle == "msdos" else "V3DBOOT",
               typ, "1MiB", "100%"], "parted p1")
    if tabelle == "gpt":
        _lauf(["parted", "-s", dev, "set", "1", "esp", "on"], "parted esp")
    else:
        _lauf(["parted", "-s", dev, "set", "1", "boot", "on"], "parted boot")
    subprocess.run(["udevadm", "settle"], capture_output=True)
    time.sleep(1.5)

    p1 = _partition(dev, 1)
    p1_fs = "fat32" if zweigeteilt else fs
    fortschritt(10, f"{p1_fs.upper()} formatieren ...")
    _formatiere(p1, p1_fs, label, aufbau["schnell"])
    p2 = None
    if zweigeteilt:
        p2 = _partition(dev, 2)
        fortschritt(13, "NTFS formatieren ...")
        _formatiere(p2, "ntfs", "V3D_DATA", aufbau["schnell"])

    warnungen = []
    if aufbau["schema"] == "mbr":
        warnungen += _bios_bootsektor(dev, p1, iso_pfad, info)

    if aufbau["modus"] == "leer":
        subprocess.run(["sync"], capture_output=True)
        fortschritt(100, "Fertig")
        return {"geraet": dev, "modus": "leer", "warnungen": warnungen}

    m1 = tempfile.mkdtemp(prefix="vstick-boot-")
    m2 = tempfile.mkdtemp(prefix="vstick-data-") if zweigeteilt else None
    try:
        _lauf(["mount", p1, m1], "mount " + p1_fs)
        if p2:
            _lauf(["mount", p2, m2], "mount NTFS")
        fortschritt(15, "Dateien kopieren ...")
        _kopiere_inhalt(iso_pfad, m1, m2, info, xml,
                        lambda a, t: fortschritt(15 + int(80 * a), t))
        fortschritt(96, "Puffer leeren ...")
        subprocess.run(["sync"], capture_output=True)
    finally:
        for m in (m2, m1):
            if m:
                subprocess.run(["umount", m], capture_output=True)
                shutil.rmtree(m, ignore_errors=True)
    fortschritt(100, "Fertig")
    return {"geraet": dev, "zweigeteilt": zweigeteilt, "modus": aufbau["modus"],
            "dateisystem": p1_fs, "schema": aufbau["schema"],
            "warnungen": warnungen, "unattend": xml}


def _formatiere(partition, fs, label, schnell=True):
    if fs == "fat32":
        befehl = ["mkfs.vfat", "-F", "32", "-n", label[:11].upper()]
        if not schnell:
            befehl.append("-c")            # Datentraeger vorher auf Fehler pruefen
        _lauf(befehl + [partition], "mkfs.vfat")
    elif fs == "ntfs":
        befehl = ["mkfs.ntfs", "-L", label[:32]]
        befehl.append("-f" if schnell else "-c")
        if not schnell:
            befehl = ["mkfs.ntfs", "-L", label[:32]]
        _lauf(befehl + [partition], "mkfs.ntfs")
    elif fs == "exfat":
        if not shutil.which("mkfs.exfat"):
            raise Fehler("mkfs.exfat fehlt - bitte exfatprogs installieren")
        _lauf(["mkfs.exfat", "-n", label[:15], partition], "mkfs.exfat")
    else:
        raise Fehler(f"Unbekanntes Dateisystem: {fs}")


def _bios_bootsektor(dev, partition, iso_pfad, info):
    """Ohne Bootsektor startet ein MBR-Stick nur ueber UEFI. ms-sys schreibt
    den Windows-Bootcode; fehlt es, bleibt UEFI - das sagen wir dann auch."""
    mssys = shutil.which("ms-sys")
    if not mssys:
        return ["Fuer den Start ueber altes BIOS fehlt 'ms-sys' "
                "(sudo apt install ms-sys). Der Stick startet vorerst nur ueber UEFI."]
    subprocess.run([mssys, "-7", dev], capture_output=True)
    subprocess.run([mssys, "-n", partition], capture_output=True)
    return []


def _kinder(dev):
    try:
        r = subprocess.run(["lsblk", "-ln", "-o", "PATH", dev],
                           capture_output=True, text=True)
        return [z.strip() for z in r.stdout.splitlines()[1:] if z.strip()]
    except Exception:
        return []


def _kopiere_inhalt(iso_pfad, boot_ordner, daten_ordner, info, xml, fortschritt):
    """Inhalt der ISO auf den Stick. Bei zweigeteiltem Aufbau wandert nur die
    grosse install-Datei auf die NTFS-Partition - der Rest muss auf FAT32
    liegen, denn nur davon startet die UEFI-Firmware."""
    aus = [info["install_datei"].lower()] if daten_ordner else []
    with Iso(iso_pfad) as iso:
        ausgelassen = iso.entpacke(
            boot_ordner,
            lambda f, g, p: fortschritt(0.75 * f / g, "Kopieren: " + p),
            ueberspringen=aus)
        if daten_ordner and ausgelassen:
            for e in ausgelassen:
                ziel = os.path.join(daten_ordner, *e.pfad.strip("/").split("/"))
                os.makedirs(os.path.dirname(ziel), exist_ok=True)
                iso.kopiere(e, ziel, lambda f, g: fortschritt(
                    0.75 + 0.24 * f / g, f"Abbild kopieren ({f / GIB:.1f} GB)"))
    for ordner in (boot_ordner, daten_ordner):
        if ordner:
            with open(os.path.join(ordner, "autounattend.xml"), "w",
                      encoding="utf-8") as f:
                f.write(xml)


def _stick_windows(iso_pfad, g, xml, info, fortschritt, aufbau):
    nummer = int(g["pfad"])
    zweigeteilt = aufbau["zweigeteilt"]
    fs = "fat32" if zweigeteilt else aufbau["dateisystem"]
    label = aufbau["label"]
    schnell = "quick" if aufbau["schnell"] else ""

    fortschritt(3, f"Datentraeger {nummer} vorbereiten ...")
    b1, b2 = _freie_buchstaben(2 if zweigeteilt else 1)
    skript = [f"select disk {nummer}", "clean",
              "convert gpt" if aufbau["schema"] == "gpt" else "convert mbr"]
    if zweigeteilt:
        skript += [f"create partition primary size={BOOT_MB}",
                   f"format fs=fat32 {schnell} label={label[:11]}".strip(),
                   f"assign letter={b1}",
                   "create partition primary",
                   f"format fs=ntfs {schnell} label=V3D_DATA".strip(),
                   f"assign letter={b2}"]
    else:
        skript += ["create partition primary",
                   f"format fs={fs} {schnell} label={label[:11]}".strip(),
                   f"assign letter={b1}"]
    if aufbau["schema"] == "mbr":
        skript.append("active")
    _diskpart(skript, fortschritt)
    time.sleep(2)

    warnungen = []
    if aufbau["modus"] == "leer":
        fortschritt(100, "Fertig")
        return {"geraet": f"Datentraeger {nummer}", "modus": "leer",
                "laufwerke": [b1], "warnungen": warnungen}

    fortschritt(15, "Dateien kopieren ...")
    _kopiere_inhalt(iso_pfad, b1 + ":\\", (b2 + ":\\") if zweigeteilt else None,
                    info, xml, lambda a, t: fortschritt(15 + int(78 * a), t))

    if aufbau["schema"] == "mbr":
        warnungen += _bios_bootsektor_windows(b1, iso_pfad, fortschritt)
    fortschritt(100, "Fertig")
    return {"geraet": f"Datentraeger {nummer}", "zweigeteilt": zweigeteilt,
            "modus": aufbau["modus"], "dateisystem": fs, "schema": aufbau["schema"],
            "laufwerke": [b1] + ([b2] if zweigeteilt else []),
            "warnungen": warnungen, "unattend": xml}


def _bios_bootsektor_windows(buchstabe, iso_pfad, fortschritt):
    """bootsect.exe liegt in jeder Windows-ISO unter \boot - damit bekommt der
    Stick den Bootcode fuer alte BIOS-Rechner."""
    ziel = os.path.join(buchstabe + ":\\", "boot", "bootsect.exe")
    if not os.path.isfile(ziel):
        return ["bootsect.exe nicht auf dem Stick gefunden - Start nur ueber UEFI."]
    fortschritt(95, "Bootsektor schreiben ...")
    r = subprocess.run([ziel, "/nt60", buchstabe + ":", "/mbr"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return ["Bootsektor konnte nicht geschrieben werden: "
                + (r.stdout or r.stderr).strip()[-200:]]
    return []


def _freie_buchstaben(anzahl):
    belegt = set()
    try:
        roh = _powershell("(Get-Volume).DriveLetter -join ''")
        belegt = set(roh.strip().upper())
    except Exception:
        pass
    frei = [c for c in "STUVWXYZGHIJKLMNOPQR" if c not in belegt]
    if len(frei) < anzahl:
        raise Fehler("Keine freien Laufwerksbuchstaben")
    return (frei + ["", ""])[:2] if anzahl > 1 else (frei[0], "")


def _diskpart(zeilen, fortschritt):
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        f.write("\n".join(zeilen) + "\nexit\n")
        pfad = f.name
    try:
        r = subprocess.run(["diskpart", "/s", pfad], capture_output=True, text=True)
        if r.returncode != 0 or "DiskPart has encountered an error" in r.stdout:
            raise Fehler("diskpart: " + (r.stdout or r.stderr)[-400:])
    finally:
        os.unlink(pfad)


# --------------------------------------------------------------- CLI
SCHALTER = [
    # (Kommandozeile,           Option,               Standard-an?)
    ("kein-hardware-bypass",    "bypass_hardware",     True),
    ("mit-microsoft-konto",     "bypass_konto",        True),
    ("netzwerk-pflicht",        "bypass_netzwerk",     True),
    ("mit-datenerhebung",       "keine_datenerhebung", True),
    ("mit-bitlocker",           "kein_bitlocker",      True),
    ("kein-qol",                "qol",                 True),
    ("sprachauswahl-zeigen",    "sprachauswahl_ueberspringen", True),
    ("dateiendungen",           "dateiendungen",       False),
    ("passwort-aendern",        "passwort_aendern",    False),
    ("wtg-platten-offline",     "wtg_platten_offline", False),
]


def _opt_aus_args(a):
    o = {}
    for schalter, name, standard_an in SCHALTER:
        gesetzt = getattr(a, schalter.replace("-", "_"), False)
        if gesetzt:
            o[name] = not standard_an     # abschalten bzw. einschalten
    for feld in ("benutzer", "passwort", "computername", "sprache", "produkt_key"):
        if getattr(a, feld, ""):
            o[feld] = getattr(a, feld)
    if getattr(a, "edition", ""):
        o["edition_index"] = int(a.edition)
    return o


WINDOWS_NAMEN = {"windows11": "4051", "windows10": "3891",
                 "windows10-enterprise": "3545"}


def _holen(a):
    """Abbild von der Konsole holen - dieselben Quellen wie in der Oberflaeche."""
    if not a.was:
        print("Windows:", ", ".join(WINDOWS_NAMEN))
        print("Linux:  ", ", ".join(d["id"] for d in linuxisos.distributionen()))
        print("\nBeispiel: vstick.py holen windows11 --nummer 1 -o ~/Downloads")
        return 0

    name = a.was.lower()
    if name in WINDOWS_NAMEN:
        dateien = download.winfuture_dateien(WINDOWS_NAMEN[name])
    else:
        dateien = linuxisos.dateien(name)

    if not a.nummer:
        for i, d in enumerate(dateien, 1):
            marke = f" [{d['typ']}]" if d.get("typ") else ""
            summe = " (SHA256 bekannt)" if d.get("sha256") else ""
            print(f"{i:2d}  {d['name']}{marke}{summe}")
        print("\nZum Laden: --nummer N angeben")
        return 0

    if not 1 <= a.nummer <= len(dateien):
        raise Fehler(f"Es gibt nur {len(dateien)} Abbilder")
    d = dateien[a.nummer - 1]
    ordner = os.path.expanduser(a.ordner)
    print(f"Lade {d['name']} nach {ordner} ...")
    r = download.herunterladen(d["uri"], ordner, d["name"], _fortschritt_konsole,
                               referer=d.get("referer"),
                               sha256=d.get("sha256") or None)
    print(f"\nFertig: {r['pfad']} ({r['groesse'] / GIB:.2f} GB)"
          + (" - Pruefsumme stimmt" if r.get("geprueft") else ""))
    return 0


def _fortschritt_konsole(prozent, text=""):
    sys.stderr.write(f"\r[{prozent:3d}%] {text[:90]:<90}")
    sys.stderr.flush()
    if prozent >= 100:
        sys.stderr.write("\n")


def main(argv=None):
    p = argparse.ArgumentParser(description="VolmeStick - Windows-Medien bauen")
    u = p.add_subparsers(dest="befehl", required=True)

    def gemeinsam(sp):
        sp.add_argument("--benutzer", default="")
        sp.add_argument("--passwort", default="")
        sp.add_argument("--computername", default="")
        sp.add_argument("--sprache", default="")
        sp.add_argument("--edition", default="")
        sp.add_argument("--produkt-key", dest="produkt_key", default="")
        for schalter, name, standard_an in SCHALTER:
            sp.add_argument("--" + schalter, action="store_true",
                            help=("abschalten: " if standard_an else "einschalten: ") + name)

    a1 = u.add_parser("analyse", help="ISO untersuchen")
    a1.add_argument("iso")

    a2 = u.add_parser("xml", help="autounattend.xml ausgeben")
    gemeinsam(a2)
    a2.add_argument("-o", "--ausgabe", default="")

    a3 = u.add_parser("iso", help="ISO mit autounattend.xml bauen")
    a3.add_argument("iso")
    a3.add_argument("-o", "--ausgabe", required=True)
    gemeinsam(a3)

    a9 = u.add_parser("holen", help="Abbild herunterladen (ohne Argument: Liste)")
    a9.add_argument("was", nargs="?", default="",
                    help="windows11 | windows10 | ubuntu | mint | debian | ...")
    a9.add_argument("--nummer", type=int, default=0, help="welches Abbild")
    a9.add_argument("-o", "--ordner", default=".")

    a8 = u.add_parser("antwort", help="Kleine Antwort-ISO fuer VMware bauen")
    a8.add_argument("-o", "--ausgabe", default="autounattend.iso")
    gemeinsam(a8)

    u.add_parser("geraete", help="Wechseldatentraeger auflisten")

    a6 = u.add_parser("pruefsumme", help="MD5/SHA1/SHA256 einer Datei")
    a6.add_argument("datei")

    a7 = u.add_parser("blockpruefung", help="Datentraeger auf schlechte Bloecke "
                                            "und Faelschung pruefen (loescht alles!)")
    a7.add_argument("geraet")
    a7.add_argument("--durchgaenge", type=int, default=1)
    a7.add_argument("--gruendlich", action="store_true")
    a7.add_argument("--erzwingen", action="store_true")

    a5 = u.add_parser("stick", help="USB-Stick beschreiben (loescht alles!)")
    a5.add_argument("iso")
    a5.add_argument("geraet")
    a5.add_argument("--erzwingen", action="store_true")
    a5.add_argument("--modus", choices=("auto", "windows", "dd", "leer"), default="auto")
    a5.add_argument("--schema", choices=("gpt", "mbr"), default="gpt")
    a5.add_argument("--dateisystem", choices=("auto", "fat32", "ntfs", "exfat"),
                    default="auto")
    a5.add_argument("--label", default="V3D_WIN")
    a5.add_argument("--langsam-formatieren", dest="langsam", action="store_true")
    a5.add_argument("--ja", action="store_true", help="ohne Rueckfrage")
    gemeinsam(a5)

    a = p.parse_args(argv)

    if a.befehl == "analyse":
        i = analysiere(a.iso)
        print(json.dumps(i, indent=2, ensure_ascii=False))
        return 0

    if a.befehl == "xml":
        x = unattend.baue_unattend(_opt_aus_args(a))
        if a.ausgabe:
            open(a.ausgabe, "w", encoding="utf-8").write(x)
            print(f"geschrieben: {a.ausgabe}")
        else:
            sys.stdout.write(x)
        return 0

    if a.befehl == "iso":
        r = baue_iso(a.iso, a.ausgabe, _opt_aus_args(a), _fortschritt_konsole)
        print(f"\nISO fertig: {r['ziel']} ({r['groesse'] / GIB:.2f} GB)")
        return 0

    if a.befehl == "holen":
        return _holen(a)

    if a.befehl == "antwort":
        r = antwort_iso(a.ausgabe, _opt_aus_args(a))
        print(f"Antwort-ISO: {r['ziel']} ({r['groesse'] / 1024:.0f} KB)")
        print("In VMware zusaetzlich zur Windows-ISO als CD-Laufwerk einbinden.")
        return 0

    if a.befehl == "geraete":
        for g in geraete():
            print(f"{g['pfad']:14s} {g['groesse'] / GIB:7.1f} GB  {g['name']}"
                  + ("  [System!]" if g["system"] else ""))
        return 0

    if a.befehl == "pruefsumme":
        for k, v in pruefsummen(a.datei, _fortschritt_konsole).items():
            print(f"{k.upper():7s} {v}")
        return 0

    if a.befehl == "blockpruefung":
        e = blockpruefung(a.geraet, _fortschritt_konsole, a.durchgaenge,
                          a.gruendlich, a.erzwingen)
        print(f"\ngeprueft: {e['geprueft']} Stellen, fehlerhaft: {e['fehlerhaft']}")
        if e["vermutlich_gefaelscht"]:
            print("ACHTUNG: Der Datentraeger ist vermutlich gefaelscht "
                  "(meldet mehr Platz als vorhanden).")
        return 0

    if a.befehl == "stick":
        info = analysiere(a.iso)
        ziel = _pruefe_ziel(a.geraet, info, a.erzwingen)
        if not a.ja:
            print(f"\n  {ziel['pfad']} ({ziel['groesse'] / GIB:.1f} GB, {ziel['name']}) "
                  "wird VOLLSTAENDIG geloescht.")
            if input("  Zum Bestaetigen 'loeschen' eintippen: ").strip() != "loeschen":
                print("Abgebrochen.")
                return 1
        e = stick_schreiben(a.iso, a.geraet, _opt_aus_args(a),
                            _fortschritt_konsole, a.erzwingen, a.label,
                            a.modus, a.schema, a.dateisystem, not a.langsam)
        for w in (e.get("warnungen") or []):
            print("Hinweis:", w)
        print("Stick fertig.")
        return 0
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Fehler as e:
        sys.stderr.write(f"\nFehler: {e}\n")
        sys.exit(2)
    except KeyboardInterrupt:
        sys.stderr.write("\nAbgebrochen.\n")
        sys.exit(130)


# --------------------------------------------------------------- Pruefsummen
def pruefsummen(pfad, fortschritt=_still, algorithmen=("md5", "sha1", "sha256")):
    """Wie Rufus' 'Prüfsummen berechnen' - zum Abgleich mit der Angabe des
    Herausgebers, bevor man Stunden in ein kaputtes Abbild steckt."""
    import hashlib
    hasher = {a: hashlib.new(a) for a in algorithmen}
    gesamt = os.path.getsize(pfad)
    gelesen = 0
    with open(pfad, "rb") as f:
        while True:
            block = f.read(8 * 1024 * 1024)
            if not block:
                break
            for h in hasher.values():
                h.update(block)
            gelesen += len(block)
            fortschritt(int(100 * gelesen / max(1, gesamt)),
                        f"Prüfsummen: {gelesen / GIB:.1f} / {gesamt / GIB:.1f} GB")
    return {a: h.hexdigest() for a, h in hasher.items()}


# --------------------------------------------------------------- Blockpruefung
MUSTER = (b"\xaa", b"\x55", b"\xff", b"\x00")


def blockpruefung(geraet, fortschritt=_still, durchgaenge=1, gruendlich=False,
                  erzwingen=False):
    """Schlechte Bloecke und gefaelschte Sticks finden (Rufus MSG_920).
    Gefaelschte Sticks melden z. B. 512 GB, haben aber 16 GB Speicher und
    ueberschreiben beim Ueberlauf still die vorderen Bloecke - das faellt hier auf.
    ACHTUNG: zerstoert den Inhalt."""
    g = _pruefe_ziel(geraet, {"groesse": 0}, erzwingen)
    if IST_WINDOWS:
        raise Fehler("Die Blockpruefung gibt es zurzeit nur unter Linux")
    if os.geteuid() != 0:
        raise Fehler("Blockpruefung braucht root-Rechte")
    dev = g["pfad"]
    groesse = g["groesse"]
    block = 4 * 1024 * 1024
    # Stichproben ueber den ganzen Datentraeger - deckt den Faelschungsfall ab,
    # ohne stundenlang jeden Block zu schreiben.
    stellen = list(range(0, max(1, groesse - block), max(block, groesse // 512))) \
        if not gruendlich else list(range(0, max(1, groesse - block), block))
    fehler = []
    with open(dev, "rb+", buffering=0) as f:
        for durchgang in range(durchgaenge):
            muster = MUSTER[durchgang % len(MUSTER)]
            for i, pos in enumerate(stellen):
                daten = (muster + pos.to_bytes(8, "little")) * (block // 9)
                f.seek(pos)
                f.write(daten)
                fortschritt(int(45 * (i + 1) / len(stellen)),
                            f"Durchgang {durchgang + 1}: schreiben {pos / GIB:.1f} GB")
            os.fsync(f.fileno())
            subprocess.run(["blockdev", "--flushbufs", dev], capture_output=True)
            for i, pos in enumerate(stellen):
                daten = (muster + pos.to_bytes(8, "little")) * (block // 9)
                f.seek(pos)
                zurueck = f.read(len(daten))
                if zurueck != daten:
                    fehler.append(pos)
                fortschritt(45 + int(50 * (i + 1) / len(stellen)),
                            f"Durchgang {durchgang + 1}: pruefen {pos / GIB:.1f} GB")
    fortschritt(100, "Fertig")
    gefaelscht = len(fehler) > len(stellen) // 3
    return {"geraet": dev, "geprueft": len(stellen), "fehlerhaft": len(fehler),
            "erste_fehler": [f"{p / GIB:.2f} GB" for p in fehler[:8]],
            "vermutlich_gefaelscht": gefaelscht}
