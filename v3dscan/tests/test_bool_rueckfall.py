#!/usr/bin/env python3
# Boolesche Operationen mit Rueckfallebene (v1.1): schwierige Lagen, kaputte Eingaben, erzwungener
# Rueckfall auf Reparatur / Unschaerfe.
#
#   python3 tests/test_bool_rueckfall.py

import os
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))

from OCP.BRepCheck import BRepCheck_Analyzer  # noqa: E402
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere  # noqa: E402
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt  # noqa: E402

from kern import features as ft  # noqa: E402
from kern import koerper as kp  # noqa: E402

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def box(x, y, z, dx, dy, dz):
    return BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), dx, dy, dz).Shape()


def main():
    A = box(0, 0, 0, 10, 10, 10)
    faelle = [
        ("Lücke 1e-7", A, box(10 + 1e-7, 0, 0, 10, 10, 10), "vereinen", 2000),
        ("Überlappung 1e-7", A, box(10 - 1e-7, 1e-7, 0, 10, 10, 10), "vereinen", 2000),
        ("Zylinder tangential", box(0, 0, 0, 20, 20, 10),
         BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(10, 5, -1), gp_Dir(0, 0, 1)), 5, 12).Shape(), "abziehen", 4000 - 785.3982),
        ("Kugel berührt Fläche", A, BRepPrimAPI_MakeSphere(gp_Pnt(5, 5, 15), 5).Shape(), "vereinen", 1523.5988),
        ("koplanar", A, box(2, 2, 0, 6, 6, 10), "abziehen", 640),
        ("fast koplanar", A, box(2, 2, 1e-8, 6, 6, 10 - 2e-8), "abziehen", 640),
    ]
    for name, a, b, op, soll in faelle:
        info = {}
        e = kp.boolean(a, b, op, info)
        v = kp._volumen(e)
        pruefe(abs(v - soll) < 1e-3 * soll and info["stufe"] == "normal" and BRepCheck_Analyzer(e).IsValid(),
               "%s %s: %.4f (soll %.4f), Stufe %s" % (name, op, v, soll, info["stufe"]))
    # umgedrehter Werkzeugkoerper: OCCT rechnet sonst still das Gegenteil
    B = box(2, 2, 2, 6, 6, 20).Reversed()
    roh = kp._volumen(kp._bool_lauf(A, B, "abziehen"))
    for op, soll in (("abziehen", 712), ("vereinen", 1432), ("schneiden", 288)):
        info = {}
        v = kp._volumen(kp.boolean(A, B, op, info))
        pruefe(abs(v - soll) < 1e-6 and info["stufe"] == "repariert",
               "umgedrehtes Werkzeug %s: %.1f (ohne Prüfung %.1f bei abziehen), Stufe %s" % (op, v, roh, info["stufe"]))
    # erzwungen: ohne Unschaerfe scheitert alles -> Fuzzy-Stufe
    echt = kp._bool_lauf
    try:
        kp._bool_lauf = lambda a, b, op, fz=0.0: echt(a, b, op, fz) if fz > 0 else None
        info = {}
        v = kp._volumen(ft.koerper_bool(A, box(5, 5, 5, 10, 10, 10), "vereinen", info))
        pruefe(info["stufe"] == "unscharf" and 0 < info["fuzzy"] < 1e-3 and abs(v - 1875) < 1e-3,
               "Rückfall auf Toleranz %.2g: %.1f mm³" % (info["fuzzy"], v))
        kp._bool_lauf = lambda a, b, op, fz=0.0: None
        try:
            kp.boolean(A, B, "abziehen")
            pruefe(False, "alle Stufen scheitern → Fehler")
        except ValueError as x:
            pruefe("auch mit Reparatur" in str(x), "alle Stufen scheitern → verständlicher Fehler")
    finally:
        kp._bool_lauf = echt


if __name__ == "__main__":
    main()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
