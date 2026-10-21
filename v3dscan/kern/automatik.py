# Scan -> CAD mit einem Klick ("Assistent").
#
# Keine neue Mathematik, sondern die vorhandenen Werkzeuge in fester Reihenfolge und mit
# automatisch gewaehlten Einstellungen:
#   1. Bereinigen   Ausreisser + kleine Inseln (Punktwolken), Tisch nur, wenn er klar groesser
#                   ist als das Objekt
#   2. Ausrichten   groesste Ebene wird Boden, groesste Seitenwand legt X fest; ohne Ebene die
#                   Achse eines Drehteils bzw. die Hauptachsen
#   3. Kandidaten   a) Drehteil: Scan ist rotationssymmetrisch -> Schnitt durch die Achse -> Drehen
#                   b) Prisma je Weltachse: Querschnitte in vielen Hoehen, gleiche Querschnitte ->
#                      eine Extrusion je Abschnitt (Stufen, Bohrungen, Taschen kommen so mit),
#                      danach erkannte Kugeln/Kegel/Zapfen/Bohrungen dazu, wenn sie den Fehler senken
#                   c) Freiform (nur wenn a/b nicht passen): automatische Flaechen
#   4. Bewerten     Abstand Scan -> Koerper (p95) und Koerper -> Scan (erfundenes Material);
#                   der beste Kandidat kommt mit Verlauf ins Projekt (Bauplan fuer V3D CAD moeglich)
#
# Alle Masse in mm. Der Scan liegt danach im Bauteil-Koordinatensystem (rueckgaengig machbar).

import math
import time

import numpy as np

from . import erkennung as er
from . import features as ft
from . import freiform as ff
from . import koerper as kp
from . import koordinaten as ko
from . import schnitt_robust as sr
from . import skizze as sk
from . import werkzeuge as wz
from .o3d import o3d

ACHSEN = {"x": np.array([1.0, 0, 0]), "y": np.array([0, 1.0, 0]), "z": np.array([0, 0, 1.0])}
WELT_EBENE = {"x": "yz", "y": "xz", "z": "xy"}


_LOCHRAND = {}          # id(Bewertungswolke) -> (Lochrand-Punkte, Punktabstand) fuer Scans mit Loechern


class Abbruch(Exception):
    pass


def _einheit(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-30)


def _probe(xyz, n, seed=0):
    xyz = np.asarray(xyz)
    if len(xyz) <= n:
        return xyz.astype(np.float64)
    return xyz[np.random.default_rng(seed).choice(len(xyz), n, replace=False)].astype(np.float64)


def _oberflaeche(scan, n=60000):
    """Gleichmaessige Punkte auf dem Scan (Netze: Flaeche abtasten, sonst Stichprobe)."""
    if scan.tri is not None and len(scan.tri):
        m = scan.zu_o3d_netz(farbe=False)
        return np.asarray(m.sample_points_uniformly(n).points)
    return _probe(scan.xyz, n)


def _grobscan(s, n):
    from .wolke import Scan
    P = _oberflaeche(s, n)
    return Scan(s.name, P)


# --- 1. Bereinigen -------------------------------------------------------------------------------------
def bereinigen(projekt, s, meldung):
    if s.tri is not None and len(s.tri):
        return
    a = wz.punktabstand(s)
    weg = wz.ausreisser_statistisch(s, 20, 3.0)
    weg |= wz.kleine_inseln(s, 4 * a, 3.0)
    if weg.any() and weg.mean() < 0.2:
        projekt.loeschen({s.id: weg}, "Assistent: Ausreißer entfernt")
        meldung("Bereinigt: %d Ausreißer/Inseln entfernt" % int(weg.sum()))
    # Tisch: groesste Ebene, deren Punkte deutlich ueber das Objekt hinausragen
    try:
        n, d, auf = wz.tisch_finden(s, max(2 * a, 0.05))
    except ValueError:
        return
    if auf.mean() < 0.15 or auf.mean() > 0.85:
        return
    e1, e2 = sk._senkrecht(n)
    q_t = s.xyz[auf].astype(float) @ np.c_[e1, e2]
    q_o = s.xyz[~auf].astype(float) @ np.c_[e1, e2]
    ausd_t = np.percentile(q_t, 98, 0) - np.percentile(q_t, 2, 0)
    ausd_o = np.percentile(q_o, 98, 0) - np.percentile(q_o, 2, 0)
    if (ausd_t > 1.3 * ausd_o).all():
        weg = auf | wz.seite_der_ebene(s.xyz, -n, -d, 0.0)
        projekt.loeschen({s.id: weg}, "Assistent: Tisch entfernt")
        meldung("Tisch erkannt und entfernt (%d Punkte)" % int(weg.sum()))


# --- 2. Ausrichten -------------------------------------------------------------------------------------
def _rot_z_auf(T, richtung):
    """T so um Z drehen, dass richtung (in T-Koordinaten, ~waagrecht) auf die naechste Achse X/Y faellt."""
    w = math.atan2(richtung[1], richtung[0])
    w = w - round(w / (math.pi / 2)) * (math.pi / 2)
    c, s_ = math.cos(-w), math.sin(-w)
    R = np.eye(4)
    R[:2, :2] = [[c, -s_], [s_, c]]
    return R @ T


def _ursprung_unten_mitte(T, xyz):
    q = xyz @ T[:3, :3].T + T[:3, 3]
    lo, hi = q.min(0), q.max(0)
    o = (lo + hi) / 2
    o[2] = lo[2]
    T = T.copy()
    T[:3, 3] -= o
    return T


def ausrichtung(xyz, elemente):
    """-> (T 4x4, Text). elemente aus erkennung (Rohform mit numpy-Vektoren)."""
    gesamt = sum(e["punkte"] for e in elemente) or 1
    ebenen = sorted([e for e in elemente if e["art"] == "ebene"], key=lambda e: -e["punkte"])
    runde = sorted([e for e in elemente if e["art"] in ("zylinder", "kegel") and e.get("umfang_grad", 0) >= 300],
                   key=lambda e: -e["punkte"])
    P = _probe(xyz, 200000)
    # Drehteil zuerst: grosser umlaufender Zylinder/Kegel, dessen Achse ein Symmetrieachse des Scans ist
    if runde and runde[0]["punkte"] > 0.25 * gesamt and _symmetrie(P, runde[0]["punkt"], runde[0]["achse"]) < 1.0:
        a = _einheit(runde[0]["achse"])
        e1, e2 = sk._senkrecht(a)
        R = np.vstack([e1, e2, a])
        T = np.eye(4)
        T[:3, :3] = R
        T[:3, 3] = -R @ np.asarray(runde[0]["punkt"], float)
        q = P @ R.T + T[:3, 3]
        T[2, 3] -= q[:, 2].min()
        return T, "Drehachse (Ø %.2f) senkrecht gestellt" % (2 * runde[0]["radius"])
    if ebenen and ebenen[0]["punkte"] > 0.06 * gesamt:
        boden = ebenen[0]
        T = ko.auf_ebene(P, boden, "behalten")
        R = T[:3, :3]
        wand = [e for e in ebenen[1:] if abs(R[2] @ _einheit(e["normale"])) < 0.15]
        text = "größte Ebene als Boden"
        if wand:
            T = _rot_z_auf(T, R @ _einheit(wand[0]["normale"]))
            text += ", Seitenwand als X/Y"
        else:
            seitlich = [e for e in runde if abs(R[2] @ _einheit(e["achse"])) < 0.15]
            if seitlich:
                T = _rot_z_auf(T, R @ _einheit(seitlich[0]["achse"]))
        return _ursprung_unten_mitte(T, P), text
    T = ko.hauptachsen(P, "mitte", "z")
    return _ursprung_unten_mitte(T, P), "Hauptachsen"


def _symmetrie(P, punkt, achse, winkel=(57.0, 141.0)):
    """Median-Abstand des um die Achse gedrehten Scans zum Original, relativ zum Punktabstand
    (~1 = rotationssymmetrisch)."""
    a = _einheit(achse)
    p = np.asarray(punkt, float)
    voll = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(P))
    baum = o3d.geometry.KDTreeFlann(voll)
    Q = _probe(P, 3000, 3)
    nn = np.asarray(voll.compute_nearest_neighbor_distance())
    abstand = float(np.median(nn)) if len(nn) else 1.0
    werte = []
    for w in winkel:
        R = o3d.geometry.get_rotation_matrix_from_axis_angle(a * math.radians(w))
        G = (Q - p) @ R.T + p
        d = [math.sqrt(baum.search_knn_vector_3d(g, 1)[2][0]) for g in G]
        werte.append(float(np.median(d)))
    return max(werte) / max(abstand, 1e-9)


# --- Bewertung ------------------------------------------------------------------------------------------
def bewerten(shape, P_scan, scan_wolke):
    """-> dict p95 (Scan->Koerper), extra (p90 Koerper->Scan), punkte (Kennzahl, kleiner = besser)."""
    w = np.abs(kp.abweichung([shape], P_scan))
    netz = kp.vernetzen(shape)
    m = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(netz["xyz"].astype(np.float64)),
                                  o3d.utility.Vector3iVector(netz["tri"].astype(np.int32)))
    if len(m.triangles):
        K = m.sample_points_uniformly(8000)
        extra = np.asarray(K.compute_point_cloud_distance(scan_wolke))
        rand, abstand = _LOCHRAND.get(id(scan_wolke), (None, 0.5))
        if rand is not None and len(rand.points):
            # Scan mit Loechern: Koerperstellen, deren naechster Scanpunkt ein Lochrand ist, liegen in
            # ungescannten Bereichen – dort Flaeche ohne Scanpunkte dahinter ist kein „erfundenes“ Material
            zum_rand = np.asarray(K.compute_point_cloud_distance(rand))
            extra = extra[zum_rand > extra + 2 * abstand]
            if not len(extra):
                extra = np.zeros(1)
        extra_p90 = float(np.percentile(extra, 90))
    else:
        extra_p90 = float("inf")
    p95 = float(np.percentile(w, 95))
    return {"p95": round(p95, 4), "median": round(float(np.median(w)), 4), "extra": round(extra_p90, 4),
            "mittel": float(np.mean(np.minimum(w, 0.05 * float(np.ptp(P_scan, 0).max())))),
            "punkte": p95 + 0.5 * extra_p90}


# --- Querschnitte ---------------------------------------------------------------------------------------
def _ebene_achse(k, h):
    return sk.ebene_welt(WELT_EBENE[k], h)


def _kontur_kennwerte(linien, zu):
    """Flaeche (gerade/ungerade Verschachtelung), Schwerpunkt, Anzahl Konturen der geschlossenen Linien."""
    polys = [L for L, z in zip(linien, zu) if z and len(L) >= 4]
    if not polys:
        return None
    fl = [abs(sk.flaeche(p)) for p in polys]
    # Schnitt genau in einer Planflaeche: Tausende Splitter -> unbrauchbar (und Verschachtelung quadratisch)
    gross = max(fl)
    wahl = [i for i, f in enumerate(fl) if f > 1e-3 * gross]
    if len(wahl) > 60:
        return {"chaos": True}
    polys, fl = [polys[i] for i in wahl], [fl[i] for i in wahl]
    gesamt, sx, sy = 0.0, 0.0, 0.0
    for i, p in enumerate(polys):
        tiefe = sum(1 for j, q in enumerate(polys) if j != i and fl[j] > fl[i] and sk.innen(q, p[:1])[0])
        vz = 1.0 if tiefe % 2 == 0 else -1.0
        gesamt += vz * fl[i]
        c = p.mean(0)
        sx += vz * fl[i] * c[0]
        sy += vz * fl[i] * c[1]
    if gesamt <= 1e-9:
        return None
    # Umfang taugt nicht als Merkmal: grobe Netze und Punktwolken-Zickzack aendern ihn je Hoehe
    alle = np.concatenate(polys)
    return {"flaeche": gesamt, "mitte": np.array([sx, sy]) / gesamt, "anzahl": len(polys),
            "box": np.r_[alle.min(0), alle.max(0)]}


def _schnitt(s, E):
    """Netz mit Loechern -> robuster Rasterschnitt (immer geschlossen), sonst der exakte Schnitt."""
    feld = getattr(s, "_feld", None)
    if feld is not None:
        return feld.schnitt(E)
    return sk.schnitt(s, E)


def _querschnitt(s, k, h):
    try:
        linien, zu, _ = _schnitt(s, _ebene_achse(k, h))
    except Exception:
        return None
    if not linien:
        return None
    linien, zu = sk.ketten_verbinden(linien, zu, 0.0)
    return _kontur_kennwerte(linien, zu)


def _gleich(a, b, diag):
    if a is None or b is None:
        return a is None and b is None
    if a.get("chaos") or b.get("chaos"):
        return False
    if a["anzahl"] != b["anzahl"]:
        return False
    # eng: echte Prismen sind auf ~0,1 % gleich, ein Kegel aendert sich je Schnitt um wenige Prozent
    if abs(a["flaeche"] - b["flaeche"]) > 0.012 * max(a["flaeche"], b["flaeche"]):
        return False
    if np.abs(a["box"] - b["box"]).max() > 0.01 * diag:
        return False
    return float(np.linalg.norm(a["mitte"] - b["mitte"])) < 0.01 * diag


def _skizze(s, E, tol):
    linien, zu, info = _schnitt(s, E)
    if not linien:
        return None
    ketten = sk.skizze_rechnen(linien, zu, tol=tol, luecke=4 * tol)
    if not any(kt["geschlossen"] for kt in ketten):
        return None
    skz = sk.skizze_json(ketten, E, info)
    skz["quelle"] = {"scan": s.id, "toleranz": tol, "assistent": True}
    return skz


def _skizze_flaeche(skz):
    """Flaeche der Profilflaechen (aussen - Loecher) und Anzahl geschlossener Konturen."""
    try:
        gruppen, zu, polys = ft.profil(skz)
    except ValueError:
        return 0.0, 0
    idx = {id(k): i for i, k in enumerate(zu)}
    fl = 0.0
    for aussen, innere in gruppen:
        fl += abs(sk.flaeche(polys[idx[id(aussen)]])) - sum(abs(sk.flaeche(polys[idx[id(k)]])) for k in innere)
    return fl, len(zu)


def _skizze_passend(s, k, unten, oben, mitte, tol):
    """Skizze fuer einen Prisma-Abschnitt: muss zum gemessenen Querschnitt passen (Flaeche +-2 %, Konturzahl),
    sonst andere Hoehe im Abschnitt / groessere Lueckentoleranz. Einpassen kann eine Aussenkontur offen lassen,
    dann wuerden nur die Bohrungen als Stifte extrudiert."""
    spanne = oben - unten
    for h in (mitte, mitte - 0.2 * spanne, mitte + 0.2 * spanne, mitte - 0.35 * spanne, mitte + 0.35 * spanne):
        bezug = _querschnitt(s, k, h)
        if bezug is None or bezug.get("chaos"):
            continue
        for luecke in (4, 12):
            linien, zu, info = _schnitt(s, _ebene_achse(k, h))
            if not linien:
                break
            ketten = sk.skizze_rechnen(linien, zu, tol=tol, luecke=luecke * tol)
            if not any(kt["geschlossen"] for kt in ketten):
                continue
            skz = sk.skizze_json(ketten, _ebene_achse(k, h), info)
            fl, n = _skizze_flaeche(skz)
            if n == bezug["anzahl"] and abs(fl - bezug["flaeche"]) <= 0.02 * bezug["flaeche"]:
                skz["quelle"] = {"scan": s.id, "toleranz": tol, "assistent": True}
                return skz, h
    return None, None


# --- 3a. Drehteil --------------------------------------------------------------------------------------
def kandidat_drehteil(s, P, tol, meldung):
    """Achse = Z durch (0,0) nach dem Ausrichten (dort liegt sie, wenn es ein Drehteil ist)."""
    lo, hi = P.min(0), P.max(0)
    mitte = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, 0.0])
    # Achse genauer: Kreis in die Punkte mehrerer Hoehen einpassen
    sym = _symmetrie(P, mitte, (0, 0, 1))
    if sym > 1.6:
        return None
    E = sk.ebene_durch_achse({"achse": [0, 0, 1], "punkt": mitte}, 0.0)
    skz = _skizze(s, E, tol)
    if skz is None:
        return None
    # nur die Kontur behalten, die die Achse umschliesst bzw. die groesste
    zu = [i for i, kt in enumerate(skz["ketten"]) if kt["geschlossen"]]
    if len(zu) > 1:
        polys = {i: sk.kette_polygon({"elemente": [sk.element_lesen(e) for e in skz["ketten"][i]["elemente"]]})
                 for i in zu}
        gross = max(zu, key=lambda i: abs(sk.flaeche(polys[i])))
        skz["ketten"] = [skz["ketten"][gross]]
        skz["schnitt"] = [skz["schnitt"][gross]] if len(skz.get("schnitt", [])) > gross else []
    shape = ft.drehen(skz, 360.0)
    meldung("Drehteil: Profil mit %d Elementen gedreht" % sum(len(kt["elemente"]) for kt in skz["ketten"]))
    return {"art": "Drehteil", "shape": shape, "schritte": [("drehung", skz, {})]}


# --- 3b. Prisma ----------------------------------------------------------------------------------------
def _abschnitte(s, k, lo, hi, diag, n=40):
    hs = np.linspace(lo, hi, n + 2)[1:-1]
    q = [_querschnitt(s, k, h) for h in hs]
    laeufe, i = [], 0
    while i < len(hs):
        if q[i] is None:
            i += 1
            continue
        j = i
        while True:
            if j + 1 < len(hs) and _gleich(q[i], q[j + 1], diag):
                j += 1
            elif j + 2 < len(hs) and _gleich(q[i], q[j + 2], diag):
                j += 2                      # einzelner Ausreisser-Schnitt (Bohrung verloren, Rauschen)
            else:
                break
        if j - i >= 2:                      # mindestens 3 gleiche Schnitte in Folge
            laeufe.append([i, j])
        i = j + 1
    if not laeufe:
        return [], hs, q

    def grenze(a, b, bezug, unten):
        # Halbierung zwischen den Hoehen a (gleich bezug) und b (anders)
        for _ in range(6):
            m = (a + b) / 2
            if _gleich(_querschnitt(s, k, m), bezug, diag):
                a = m
            else:
                b = m
        return (a + b) / 2

    stufen = []
    for i, j in laeufe:
        bezug = q[(i + j) // 2]
        unten = lo if i == 0 else grenze(hs[i], hs[i - 1], bezug, True)
        oben = hi if j == len(hs) - 1 else grenze(hs[j], hs[j + 1], bezug, False)
        stufen.append([unten, oben, (hs[i] + hs[j]) / 2, hs[i], hs[j], bezug])
    # gleiches Profil auf beiden Seiten einer Luecke = oertliches Merkmal quer zur Achse (Querbohrung,
    # Nut), das die Schnitte stoert -> ein Abschnitt durch; erkannte Bohrungen zieht das Ergaenzen ab
    zusammen = [stufen[0]]
    for st in stufen[1:]:
        a = zusammen[-1]
        if _gleich(a[5], st[5], diag):
            zusammen[-1] = [a[0], st[1], a[2] if a[4] - a[3] >= st[4] - st[3] else st[2], a[3], st[4], a[5]]
        else:
            zusammen.append(st)
    stufen = zusammen
    # benachbarte Abschnitte direkt aneinander legen (keine Spalte durch die Halbierung)
    for a, b in zip(stufen, stufen[1:]):
        if b[0] - a[1] < 0.02 * (hi - lo):
            m = (a[1] + b[0]) / 2
            a[1] = b[0] = m
    return stufen, hs, q


def _ebene_hoehen(elemente, k):
    a = ACHSEN[k]
    return [float(np.asarray(e["punkt"]) @ a) for e in elemente
            if e["art"] == "ebene" and abs(abs(_einheit(e["normale"]) @ a) - 1) < 0.01]


def kandidat_prisma(s, P, k, elemente, tol, meldung, budget):
    a = ACHSEN[k]
    t = P @ a
    lo, hi = float(np.percentile(t, 0.05)), float(np.percentile(t, 99.95))
    if hi - lo < 4 * tol:
        return None
    diag = float(np.linalg.norm(P.max(0) - P.min(0)))
    stufen, _, _ = _abschnitte(s, k, lo, hi, diag)
    if not stufen:
        return None
    # Grenzen auf erkannte Ebenen einrasten
    ebenen = _ebene_hoehen(elemente, k)
    for n, st in enumerate(stufen):
        # Halbierung greift an einer Planflaeche nicht (Schnitt dort = Splitter). Grenze = naechste erkannte
        # Querebene zwischen dem letzten gleichen Schnitt und dem Nachbarabschnitt bzw. dem Scanende -
        # nie in die gemessen gleichen Schnitte hinein
        unten_frei = stufen[n - 1][4] if n else lo - 3 * tol
        oben_frei = stufen[n + 1][3] if n + 1 < len(stufen) else hi + 3 * tol
        for i, (von_h, bis_h) in enumerate(((unten_frei, st[3] + tol), (st[4] - tol, oben_frei))):
            nah = [h for h in ebenen if von_h <= h <= bis_h]
            if nah:
                st[i] = min(nah, key=lambda h: abs(h - st[i]))
    schritte, shape = [], None
    for unten, oben, mitte, _, _, _ in stufen:
        if oben - unten < 2 * tol:
            continue
        skz, mitte = _skizze_passend(s, k, unten, oben, mitte, tol)
        if skz is None:
            meldung("  Abschnitt %.1f–%.1f: keine passende Skizze" % (unten, oben))
            continue
        E = sk.ebene_lesen(skz["ebene"])
        h0 = float(E["ursprung"] @ E["n"])
        von, bis = sorted(((unten - mitte) * (a @ E["n"]), (oben - mitte) * (a @ E["n"])))
        try:
            w = ft.extrudieren(skz, von, bis)
            shape = w if shape is None else kp.boolean(shape, w, "vereinen")
        except Exception:
            continue
        schritte.append(("extrusion", skz, {"von": von, "bis": bis}))
        del h0
    if shape is None:
        return None
    meldung("Prisma entlang %s: %d Abschnitt(e)" % (k.upper(), len(schritte)))
    return {"art": "Prisma %s" % k.upper(), "shape": shape, "schritte": schritte}


def _vieleck_ketten(linien, tol):
    """Rasterkonturen -> vereinfachte Vielecke (Douglas-Peucker). Marching-Squares-Konturen ueberschneiden
    sich nie, das Vieleck bleibt also gueltig – Rueckfall, wenn das Einpassen in Linien/Boegen eine
    selbstueberschneidende Kontur liefert."""
    def dp(P, eps):
        if len(P) < 3:
            return P
        a, b = P[0], P[-1]
        d = b - a
        n = np.hypot(*d)
        if n < 1e-12:
            ab = np.linalg.norm(P - a, axis=1)
        else:
            ab = np.abs(np.cross(d, P - a)) / n
        i = int(np.argmax(ab))
        if ab[i] <= eps:
            return np.array([a, b])
        return np.vstack([dp(P[:i + 1], eps)[:-1], dp(P[i:], eps)])
    ketten = []
    for L in linien:
        L = np.asarray(L, float)
        i = int(np.argmax(np.linalg.norm(L - L.mean(0), axis=1)))     # Start an einer Ecke, nicht mitten in einer Kante
        L = np.vstack([np.roll(L, -i, axis=0), np.roll(L, -i, axis=0)[:1]])
        Q = dp(L, tol)[:-1]
        if len(Q) < 3:
            continue
        els = [sk._lin(Q[j], Q[(j + 1) % len(Q)]) for j in range(len(Q))]
        ketten.append({"geschlossen": True, "elemente": els, "punkte": L[:-1]})
    return ketten


def _gueltig(shape):
    from OCP.BRepCheck import BRepCheck_Analyzer
    return shape is not None and BRepCheck_Analyzer(shape).IsValid() and kp.kennwerte(shape)["volumen"] > 0


# --- 3b'. Quader aus drei Ansichten -------------------------------------------------------------------
def kandidat_ansichten(s, P, tol, meldung):
    """Umriss je Weltachse (Blick von vorne/seitlich/oben), ueber die ganze Tiefe extrudiert, Schnittmenge
    der drei = „Sichthuelle“. Trifft Bloecke mit Stufen, Nuten, Absaetzen und durchgehenden Bohrungen in
    allen drei Richtungen – genau das, woran ein einzelnes Prisma scheitert (Volkers Scan 21.10.).
    Braucht ein Netz (Innen/Aussen-Feld)."""
    feld = getattr(s, "_feld", None)
    if feld is None:
        if s.tri is None or not len(s.tri):
            return None
        feld = s._feld = sr.Feld(s.xyz, s.tri)
    schritte, shape = [], None
    for k in ("z", "x", "y"):
        a = ACHSEN[k]
        tt = P @ a
        lo, hi = float(tt.min()), float(tt.max())
        mitte = (lo + hi) / 2
        E = _ebene_achse(k, mitte)
        vz = float(a @ E["n"])
        von, bis = sorted(((lo - mitte) * vz, (hi - mitte) * vz))
        linien, zu, info = feld.schatten(E)
        # Ueberstand: sonst enden alle drei Extrusionen auf denselben Ebenen, und OCCTs Schnittmenge
        # liefert bei deckungsgleichen Flaechen mitunter einen leeren Koerper (Volkers Scan 21.10.)
        rand = 0.5 + 0.01 * (bis - von)
        von, bis = von - rand, bis + rand
        if not linien:
            return None
        tol_k = max(tol, 1.5 * info["aufloesung"])
        w = None
        for art in ("elemente", "vieleck"):
            ketten = (sk.skizze_rechnen(linien, zu, tol=tol_k, luecke=0.0) if art == "elemente"
                      else _vieleck_ketten(linien, tol_k))
            if not any(kt["geschlossen"] for kt in ketten):
                continue
            skz = sk.skizze_json(ketten, E, info)
            skz["quelle"] = {"scan": s.id, "toleranz": tol, "assistent": True, "ansicht": k}
            try:
                w = ft.extrudieren(skz, von, bis)
            except Exception:
                w = None
            if _gueltig(w):
                break
            w = None
        if w is None:
            meldung("  Ansicht %s: kein gültiger Umriss" % k.upper())
            return None
        shape = w if shape is None else kp.boolean(shape, w, "schneiden")
        schritte.append(("extrusion", skz, {"von": von, "bis": bis,
                                           "operation": "neu" if len(schritte) == 0 else "schneiden"}))
    meldung("Ansichten: Umrisse von oben, vorne und der Seite geschnitten")
    return {"art": "Ansichten", "shape": shape, "schritte": schritte}


def grundkoerper_ergaenzen(kand, elemente, P, wolke, meldung, budget):
    """Erkannte Kugeln/Kegel/Zapfen/Bohrungen dazunehmen bzw. abziehen, wenn der Fehler sinkt."""
    # auch teilweise gescannte Zylinder (Bohrung ohne Rueckwand = „Hohlkehle“): uebernommen wird ohnehin nur,
    # was den Fehler senkt (Volkers Scan 21.10.: Ø 18-Bohrungen nur zu ~200° erfasst)
    wahl = [e for e in elemente if e["art"] in ("kugel", "kegel", "zylinder")
            and (e["art"] == "kugel" or e.get("umfang_grad", 0) >= 150)]
    wahl.sort(key=lambda e: -e["punkte"])
    guete = kand["guete"]
    for el in wahl[:14]:
        if time.time() > budget:
            break
        try:
            par = kp.grundkoerper_parameter(er.als_json(el), True, 4.0)
            w = kp.baue(par)
        except Exception as ex:
            meldung("  %s übersprungen (%s)" % (el.get("typ") or el["art"], ex))
            continue
        op = "abziehen" if el.get("konkav") else "vereinen"
        try:
            neu = kp.boolean(kand["shape"], w, op)
            g = bewerten(neu, P, wolke)
        except Exception as ex:
            meldung("  %s übersprungen (%s)" % (el.get("typ") or el["art"], ex))
            continue
        # Mittelwert statt p95: kleine Formen (Kegel, Kuppel) bewegen das 95-%-Quantil oft nicht mehr
        if g["mittel"] < guete["mittel"] * 0.98 and g["extra"] <= guete["extra"] * 1.1 + 0.02:
            kand["shape"], guete = neu, g
            kand["schritte"].append(("grundkoerper", par, {"operation": op, "text": er.beschreibung(er.als_json(el))}))
            meldung("+ %s (%s)" % (kp.beschreibung(par, True), "abgezogen" if op == "abziehen" else "dazu"))
    kand["guete"] = guete


def hohlraeume_nachschneiden(kand, P, wolke, meldung, budget, s=None):
    """Bohrungen, die keine Ansicht zeigt und die Formerkennung nicht (ganz) fand: Scanpunkte, die IM Koerper
    liegen, zu Bereichen gruppieren, je Weltachse einen Kreis einpassen, den besten Zylinder bis zur
    Aussenflaeche verlaengern (Seite aus dem Versuch) und abziehen, wenn der Fehler sinkt."""
    groesse = float(np.ptp(P, axis=0).max())
    lo_k, hi_k = P.min(0), P.max(0)
    versucht = []
    for _runde in range(10):                      # nach jedem Schnitt neu messen: Nachbarbohrungen trennen sich
        if time.time() > budget or not _ein_hohlraum(kand, P, wolke, meldung, groesse, lo_k, hi_k, versucht, s):
            break


def _koerper_feld(shape):
    """Innen-Test fuer den (geschlossenen) CAD-Koerper."""
    n = kp.vernetzen(shape)
    sz = o3d.t.geometry.RaycastingScene()
    sz.add_triangles(o3d.core.Tensor(n["xyz"].astype(np.float32)), o3d.core.Tensor(n["tri"].astype(np.uint32)))
    return sz


def _tasche(kand, s, Q, P, wolke, lo_k, hi_k):
    """Hohlraum um die Punkte Q als Tasche: je Achse im Querschnitt Flaeche „im Koerper, im Scan hohl“
    (ueber drei Tiefen gemeinsam) -> Vieleck-Skizze -> Extrusion abziehen. -> (guete, shape, schritt) oder None."""
    from . import schnitt_robust as _sr
    feld = getattr(s, "_feld", None)
    if feld is None:
        return None
    koerper = _koerper_feld(kand["shape"])
    bestes = None
    for k, a in ACHSEN.items():
        t = Q @ a
        t0, t1 = float(t.min()), float(t.max())
        if t1 - t0 < 0.6:
            continue
        E = _ebene_achse(k, (t0 + t1) / 2)
        q2 = sk.zu2d(Q, E)
        lo2, hi2 = q2.min(0) - 2.0, q2.max(0) + 2.0
        h = max(float((hi2 - lo2).max()) / 120.0, 0.12)
        us, vs = np.arange(lo2[0], hi2[0] + h, h), np.arange(lo2[1], hi2[1] + h, h)
        U, V = np.meshgrid(us, vs, indexing="ij")
        hohl = np.ones(U.shape, bool)
        vz = float(a @ E["n"])
        for anteil in (0.25, 0.5, 0.75):
            tiefe = (t0 + anteil * (t1 - t0) - (t0 + t1) / 2) * vz
            G = E["ursprung"] + U.reshape(-1, 1) * E["u"] + V.reshape(-1, 1) * E["v"] + tiefe * E["n"]
            im_koerper = koerper.compute_occupancy(o3d.core.Tensor(G.astype(np.float32)), nsamples=3).numpy() > 0.5
            hohl &= (im_koerper & (feld.werte(G) > 0.05)).reshape(U.shape)
        if hohl.sum() * h * h < 3.0:
            continue
        linien = _sr._marching_squares(np.where(hohl, -1.0, 1.0), us, vs)
        linien = [L for L in linien if abs(sk.flaeche(L)) >= 3.0]
        if not linien:
            continue
        ketten = _vieleck_ketten(linien, max(0.15, 1.2 * h))
        if not ketten:
            continue
        skz = sk.skizze_json(ketten, E, {"art": "tasche"})
        a_lo, a_hi = float(lo_k @ a) - 1.0, float(hi_k @ a) + 1.0
        mitte = (t0 + t1) / 2
        for von_w, bis_w in ((t0, a_hi), (a_lo, t1), (t0, t1)):
            von, bis = sorted(((von_w - mitte) * vz, (bis_w - mitte) * vz))
            try:
                w = ft.extrudieren(skz, von, bis)
                neu = kp.boolean(kand["shape"], w, "abziehen")
                g = bewerten(neu, P, wolke)
            except Exception:
                continue
            if bestes is None or g["mittel"] < bestes[0]["mittel"]:
                bestes = (g, neu, ("extrusion", skz, {"von": von, "bis": bis, "operation": "abziehen"}), k)
    return bestes


def _ein_hohlraum(kand, P, wolke, meldung, groesse, lo_k, hi_k, versucht, s=None):
    from . import formen as fo
    w = kp.abweichung([kand["shape"]], P)
    innen = P[w < -1.0]
    if len(innen) < 40:
        return False
    lab = np.asarray(o3d.geometry.PointCloud(o3d.utility.Vector3dVector(innen)).cluster_dbscan(2.0, 15))
    guete = kand["guete"]
    for c in sorted(set(lab.tolist()) - {-1}, key=lambda c: -(lab == c).sum())[:6]:
        Q = innen[lab == c]
        schluessel = tuple(np.round(Q.mean(0) / 2.0).astype(int))
        if schluessel in versucht:
            continue
        versucht.append(schluessel)
        if len(Q) < 30:
            continue
        beste_achse = None
        for k, a in ACHSEN.items():
            e1, e2 = sk._senkrecht(a)
            try:
                mitte2, r, rms = fo.kreis2d(np.c_[Q @ e1, Q @ e2])
            except Exception:
                continue
            if not (0.8 <= r <= 0.45 * groesse) or rms > 0.12 * r:
                continue
            if beste_achse is None or rms / r < beste_achse[0]:
                beste_achse = (rms / r, k, a, mitte2, r, e1, e2)
        if beste_achse is None:
            continue
        _, k, a, mitte2, r, e1, e2 = beste_achse
        r = er.nennmass(2 * r, 0.05) / 2
        t = Q @ a
        t0, t1 = float(t.min()), float(t.max())
        a_lo, a_hi = float(lo_k @ a) - 1.0, float(hi_k @ a) + 1.0
        achse_pkt = mitte2[0] * e1 + mitte2[1] * e2
        bestes = None
        for von, bis in ((t0, a_hi), (a_lo, t1), (a_lo, a_hi), (t0, t1)):
            par = {"art": "zylinder", "basis": (achse_pkt + a * von).tolist(), "achse": a.tolist(), "radius": float(r),
                   "hoehe": float(bis - von), "punkt": (achse_pkt + a * (von + bis) / 2).tolist()}
            try:
                neu = kp.boolean(kand["shape"], kp.baue(par), "abziehen")
                g = bewerten(neu, P, wolke)
            except Exception:
                continue
            if bestes is None or g["mittel"] < bestes[0]["mittel"]:
                bestes = (g, neu, par)
        if bestes and bestes[0]["mittel"] < guete["mittel"] * 0.98 and bestes[0]["extra"] <= guete["extra"] * 1.1 + 0.02:
            kand["guete"], kand["shape"], par = bestes
            kand["schritte"].append(("grundkoerper", par, {"operation": "abziehen"}))
            meldung("+ Bohrung Ø %s entlang %s nachgeschnitten" % (("%.1f" % (2 * r)).replace(".", ","), k.upper()))
            return True
    # keine Bohrung passt: als Tasche/Nut/Absatz ausschneiden
    for c in sorted(set(lab.tolist()) - {-1}, key=lambda c: -(lab == c).sum())[:4]:
        Q = innen[lab == c]
        schluessel = ("t",) + tuple(np.round(Q.mean(0) / 2.0).astype(int))
        if len(Q) < 30 or schluessel in versucht or s is None:
            continue
        versucht.append(schluessel)
        erg = _tasche(kand, s, Q, P, wolke, lo_k, hi_k)
        if erg and erg[0]["mittel"] < guete["mittel"] * 0.98 and erg[0]["extra"] <= guete["extra"] * 1.1 + 0.02:
            kand["guete"], kand["shape"], schritt, k = erg
            kand["schritte"].append(schritt)
            meldung("+ Tasche/Absatz entlang %s ausgeschnitten" % k.upper())
            return True
    return False


# --- 3c. Freiform --------------------------------------------------------------------------------------
def kandidat_freiform(s, meldung):
    from . import netz as nz
    quelle = s
    if s.tri is None or not len(s.tri):
        quelle, _ = nz.netz_erzeugen(s, "poisson", 8)
        meldung("Freiform: Netz aus der Punktwolke erzeugt")
    shape, info = ff.auto_flaechen(quelle.xyz, quelle.tri, 250, 9)
    meldung("Freiform: %d Flächen%s" % (int(info.get("vierecke", 0) or 0),
                                         "" if info.get("geschlossen") else " (nicht ganz geschlossen)"))
    return {"art": "Freiform", "shape": shape, "schritte": [("freiform", None, {})]}


# --- Ablauf --------------------------------------------------------------------------------------------
def scan_zu_cad(projekt, sid, freiform=True, max_sekunden=240, fortschritt=None):
    start = time.time()
    budget = start + max_sekunden
    try:                                    # Open3D tastet zufaellig ab -> gleicher Scan, gleiches Ergebnis
        o3d.utility.random.seed(0)
    except Exception:
        pass
    protokoll = []

    def meldung(text):
        protokoll.append(text)
        if fortschritt:
            fortschritt(text)

    s = projekt.scan(sid)
    if len(s) < 500:
        raise Abbruch("Der Scan hat zu wenige Punkte.")
    bereinigen(projekt, s, meldung)

    meldung("Formen erkennen …")
    # fuers Ausrichten reichen die grossen Formen: grobe Stichprobe, nur Ebene/Zylinder/Kegel
    grob = _grobscan(s, 60000)
    erk = er.erkennen(grob, arten=[a for a in er.ARTEN if a != "kugel"], min_anteil=2.0, kandidaten=200)
    T, text = ausrichtung(s.xyz.astype(np.float64), erk["elemente"])
    projekt.transformieren({s.id: T}, "Assistent: ausgerichtet")
    s = projekt.scan(sid)
    meldung("Ausgerichtet: " + text)
    if sr.offen(s):
        s._feld = sr.Feld(s.xyz, s.tri)
        meldung("Netz hat Löcher → Querschnitte über Innen/Außen-Raster (schließen immer)")
    # kleine Formen (<0,3 %) helfen dem Koerper nicht und kosten an Freiform-Scans Minuten
    erk = er.erkennen(s, min_anteil=0.3)
    elemente = erk["elemente"]
    if hasattr(projekt, "erkennung"):              # Bereiche gleich im Modellbaum zeigen
        projekt.erkennung[s.id] = {
            "rev": s.rev, "labels": erk["labels"], "elemente": [er.als_json(e) for e in elemente],
            "freiform": erk["freiform"], "zusammenfassung": erk["zusammenfassung"], "toleranz": erk["toleranz"]}
    meldung(erk.get("zusammenfassung") or "%d Formen erkannt" % len(elemente))

    P = _oberflaeche(s, 20000)
    wolke = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(_oberflaeche(s, 120000)))
    if getattr(s, "_feld", None) is not None:
        # Lochraender fuer die Bewertung merken (siehe bewerten: Zusatzmaterial in ungescannten Bereichen)
        t_ = np.sort(np.asarray(s.tri, np.int64), axis=1)
        kanten = np.concatenate([t_[:, [0, 1]], t_[:, [1, 2]], t_[:, [0, 2]]])
        schl, anz = np.unique(kanten[:, 0] * (len(s.xyz) + 1) + kanten[:, 1], return_counts=True)
        rk = schl[anz == 1]
        rand_idx = np.unique(np.r_[rk // (len(s.xyz) + 1), rk % (len(s.xyz) + 1)])
        _LOCHRAND[id(wolke)] = (o3d.geometry.PointCloud(o3d.utility.Vector3dVector(s.xyz[rand_idx].astype(np.float64))),
                                sk.punktabstand(s.xyz))
    rausch = float(np.median([e["rms"] for e in elemente])) if elemente else 0.05
    tol = float(np.clip(3 * rausch, 0.05, 0.5))
    diag = float(np.linalg.norm(P.max(0) - P.min(0)))
    ziel = max(0.25, 0.004 * diag, 4 * rausch)

    kandidaten = []

    def pruefen(kand):
        if kand is None:
            return
        try:
            kand["guete"] = bewerten(kand["shape"], P, wolke)
        except Exception as ex:
            meldung("  verworfen (%s)" % ex)
            return
        meldung("  %s: 95 %% der Punkte ≤ %.3f mm, Zusatzmaterial %.3f mm" %
                (kand["art"], kand["guete"]["p95"], kand["guete"]["extra"]))
        kandidaten.append(kand)

    try:
        pruefen(kandidat_drehteil(s, P, tol, meldung))
    except Exception as ex:
        meldung("Drehteil nicht möglich: %s" % ex)
    for k in ("z", "x", "y"):
        if time.time() > budget:
            break
        try:
            pruefen(kandidat_prisma(s, P, k, elemente, tol, meldung, budget))
        except Exception as ex:
            meldung("Prisma %s nicht möglich: %s" % (k.upper(), ex))
    if time.time() < budget:
        try:
            pruefen(kandidat_ansichten(s, P, tol, meldung))
        except Exception as ex:
            meldung("Ansichten nicht möglich: %s" % ex)
    beste = min(kandidaten, key=lambda c: c["guete"]["punkte"]) if kandidaten else None
    meldung("Bester Kandidat bisher: %s" % (beste["art"] if beste else "keiner"))
    if beste is not None and beste["art"].startswith(("Prisma", "Ansichten")) and beste["guete"]["punkte"] > ziel:
        meldung("Erkannte Formen ergänzen …")
        grundkoerper_ergaenzen(beste, elemente, P, wolke, meldung, budget)
        if beste["guete"]["punkte"] > ziel and time.time() < budget:
            meldung("Verdeckte Bohrungen suchen …")
            hohlraeume_nachschneiden(beste, P, wolke, meldung, budget, s)
        meldung("  %s nach dem Ergänzen: 95 %% ≤ %.3f mm, Zusatzmaterial %.3f mm"
                % (beste["art"], beste["guete"]["p95"], beste["guete"]["extra"]))
    if freiform and (beste is None or beste["guete"]["punkte"] > 2.5 * ziel) and time.time() < budget:
        try:
            pruefen(kandidat_freiform(s, meldung))
        except Exception as ex:
            meldung("Freiform nicht möglich: %s" % ex)
        frei = [c for c in kandidaten if c["art"] == "Freiform"]
        # parametrisch gewinnt, solange es nicht deutlich schlechter ist
        if frei and (beste is None or frei[0]["guete"]["punkte"] < 0.6 * beste["guete"]["punkte"]):
            beste = frei[0]
    if beste is None:
        raise Abbruch("Aus diesem Scan ließ sich kein Körper bauen. Ist der Scan vollständig (alle Seiten)?")

    k = _uebernehmen(projekt, s, beste)
    g = beste["guete"]
    urteil = "sehr gut" if g["punkte"] <= ziel else ("brauchbar" if g["punkte"] <= 2.5 * ziel else "grob")
    meldung("Ergebnis: %s → %s (%s)" % (beste["art"], k.name, urteil))
    return {"koerper": k.id, "name": k.name, "art": beste["art"], "guete": {x: g[x] for x in ("p95", "median", "extra")},
            "ziel": round(ziel, 3), "urteil": urteil, "protokoll": protokoll,
            "kandidaten": [{"art": c["art"], "p95": c["guete"]["p95"], "extra": c["guete"]["extra"]} for c in kandidaten],
            "dauer": round(time.time() - start, 1), "matrix": T.tolist(),
            "parametrisch": beste["art"] != "Freiform"}


def _uebernehmen(projekt, s, kand):
    """Kandidat mit Verlauf (Skizzen + Schritte) ins Projekt; ein Koerper."""
    k = None
    for typ, daten, extra in kand["schritte"]:
        op = "neu" if k is None else extra.get("operation", "vereinen")
        if typ == "extrusion":
            z = projekt.skizze_hinzufuegen(daten)
            w = ft.extrudieren(z, extra["von"], extra["bis"])
            k = projekt.feature(w, "Extrusion", op, k, {
                "typ": "extrusion", "skizze": z["id"], "modus": "auto", "von": round(extra["von"], 4),
                "bis": round(extra["bis"], 4), "laenge": round(extra["bis"] - extra["von"], 4), "laenge2": 0,
                "umkehren": False, "schraege": 0})
        elif typ == "drehung":
            z = projekt.skizze_hinzufuegen(daten)
            k = projekt.feature(ft.drehen(z, 360.0), "Drehung", op, k,
                                {"typ": "drehung", "skizze": z["id"], "winkel": 360.0, "element": None, "winkel2": 0})
        elif typ == "grundkoerper":
            names = {"kugel": "Kugel", "zylinder": "Zylinder", "kegel": "Kegel"}
            k = projekt.grundkoerper(kp.baue(daten), names.get(daten["art"], daten["art"]), op, k, None, daten)
        elif typ == "freiform":
            k = projekt.feature(kand["shape"], "Freiform", "neu", None, {"typ": "freiform", "scan": s.id, "flaechen": 250})
    k.name = "Scan-CAD %d" % k.id
    return k
