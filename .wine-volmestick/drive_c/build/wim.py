#!/usr/bin/env python3
# VolmeStick - Liest die Editionsliste aus einer WIM/ESD-Datei.
#
# Jede install.wim traegt am Ende einen unkomprimierten XML-Block (UTF-16LE),
# in dem alle enthaltenen Abbilder stehen: "Windows 11 Pro", "Home" usw.
# Der Header verraet Offset und Laenge - man muss also nicht die ganze
# 5-GB-Datei anfassen, ein paar Kilobyte genuegen.

import re
import struct

MAGIC = b"MSWIM\x00\x00\x00"
HEADER = 208
XML_RESHDR = 72          # Offset des rhXmlData-Eintrags im Header


def _reshdr(daten, offset):
    """RESHDR_DISK_SHORT: Groesse+Flags (u64), Offset (u64), Originalgroesse."""
    groesse_flags, pos, original = struct.unpack_from("<QQQ", daten, offset)
    groesse = groesse_flags & ((1 << 56) - 1)
    flags = groesse_flags >> 56
    return groesse, pos, original, flags


def xml_block(leser, kopf):
    """leser(offset, laenge) -> bytes; kopf = die ersten 208 Bytes."""
    if kopf[:8] != MAGIC:
        raise ValueError("Keine WIM/ESD-Datei")
    groesse, pos, _orig, flags = _reshdr(kopf, XML_RESHDR)
    if flags & 0x04:     # komprimiert - kommt bei XML in der Praxis nicht vor
        raise ValueError("XML-Block ist komprimiert")
    if not groesse or groesse > 8 * 1024 * 1024:
        raise ValueError("XML-Block unplausibel gross")
    return leser(pos, groesse)


def editionen_aus_xml(roh):
    try:
        text = roh.decode("utf-16-le", "ignore")
    except Exception:
        text = roh.decode("latin-1", "ignore")
    text = text.lstrip("﻿")
    treffer = []
    for m in re.finditer(r'<IMAGE\s+INDEX="(\d+)"(.*?)</IMAGE>', text, re.S | re.I):
        index = int(m.group(1))
        block = m.group(2)

        def feld(tag):
            t = re.search(rf"<{tag}>(.*?)</{tag}>", block, re.S | re.I)
            return t.group(1).strip() if t else ""

        name = feld("DISPLAYNAME") or feld("NAME") or f"Abbild {index}"
        treffer.append({
            "index": index,
            "name": name,
            "beschreibung": feld("DESCRIPTION") or feld("DISPLAYDESCRIPTION"),
            "architektur": {"0": "x86", "9": "x64", "12": "arm64"}.get(
                feld("ARCH"), feld("ARCH")),
            "build": feld("BUILD"),
        })
    treffer.sort(key=lambda e: e["index"])
    return treffer


def editionen(leser):
    """leser(offset, laenge) -> bytes. Liefert [] wenn nicht lesbar."""
    try:
        kopf = leser(0, HEADER)
        return editionen_aus_xml(xml_block(leser, kopf))
    except Exception:
        return []
