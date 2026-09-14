# Geometrieerkennung: aus einem Scan mathematisch exakte Grundformen machen.
#
# Verfahren (angelehnt an "Efficient RANSAC" von Schnabel et al.):
#   1. Arbeitswolke: je Voxel ein echter Messpunkt (mit Normale); jeder
#      Originalpunkt kennt "seinen" Arbeitspunkt -> Ergebnis gilt fuer alle.
#   2. Kandidaten aus minimalen Stichproben MIT Normalen:
#        Ebene 1 Punkt, Kugel 2, Zylinder 2, Kegel 3 (Nachbarschaft lokal)
#      bewertet auf einer Teilmenge: Abstand < eps UND Normale passt.
#   3. Bester Kandidat: alle passenden Punkte, nur der groesste zusammen-
#      haengende Bereich, exakt nachgepasst (kern/formen.py), entfernt.
#   4. Wiederholen, bis nichts Grosses mehr passt. Rest = Freiform.
#   5. Deuten: Bohrung/Zapfen/Rundung/Hohlkehle/Kuppel/Senkung, Nennmass
#      runden, Achsen an X/Y/Z einrasten, gleiche Bohrungen zusammenfassen.

import numpy as np

from . import formen
from .o3d import o3d
from .werkzeuge import komponenten

ARTEN = ("ebene", "zylinder", "kugel", "kegel")
KOMPLEX = {"ebene": 0, "kugel": 1, "zylinder": 2, "kegel": 3}


def _einheit(v):
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-300)


# --- Abstaende je Formart ---------------------------------------------------------------
def abstand(art, mod, P, N=None):
    """-> (Abstand zur Flaeche, |cos| zwischen Messnormale und Flaechennormale)"""
    if art == "ebene":
        d = (P - mod["punkt"]) @ mod["normale"]
        ref = np.broadcast_to(mod["normale"], P.shape)
    elif art == "kugel":
        v = P - mod["mitte"]
        rr = np.linalg.norm(v, axis=1)
        d = rr - mod["radius"]
        ref = v / np.maximum(rr, 1e-12)[:, None]
    elif art == "zylinder":
        a = mod["achse"]
        v = P - mod["punkt"]
        w = v - np.outer(v @ a, a)
        rr = np.linalg.norm(w, axis=1)
        d = rr - mod["radius"]
        ref = w / np.maximum(rr, 1e-12)[:, None]
    elif art == "kegel":
        a, c, r0, win = mod["achse"], mod["c"], mod["r0"], mod["halbwinkel"]
        v = P - c
        t = v @ a
        w = v - np.outer(t, a)
        rr = np.linalg.norm(w, axis=1)
        d = (rr - (r0 + t * np.tan(win))) * np.cos(win)
        ref = (w / np.maximum(rr, 1e-12)[:, None]) * np.cos(win) - np.outer(np.ones(len(P)), a) * np.sin(win)
    else:
        raise ValueError(art)
    if N is None:
        return d, None
    return d, np.abs(np.einsum("ij,ij->i", N, ref))


# --- Kandidaten aus Minimalstichproben ------------------------------------------------------
def _kand_ebene(P, N, i):
    return {"punkt": P[i], "normale": N[i]}


def _kand_kugel(P, N, i, j):
    p1, n1, p2, n2 = P[i], N[i], P[j], N[j]
    w = p1 - p2
    b = n1 @ n2
    nenner = 1 - b * b
    if nenner < 1e-3:
        return None
    s = (b * (n2 @ w) - (n1 @ w)) / nenner
    t = ((n2 @ w) - b * (n1 @ w)) / nenner
    c = (p1 + s * n1 + p2 + t * n2) / 2
    r1, r2 = np.linalg.norm(p1 - c), np.linalg.norm(p2 - c)
    if abs(r1 - r2) > 0.1 * max(r1, r2):
        return None
    return {"mitte": c, "radius": (r1 + r2) / 2}


def _kand_zylinder(P, N, i, j):
    a = np.cross(N[i], N[j])
    if np.linalg.norm(a) < 0.08:
        return None
    a = a / np.linalg.norm(a)
    u, v = formen._basis(a)
    q1 = np.array([P[i] @ u, P[i] @ v])
    q2 = np.array([P[j] @ u, P[j] @ v])
    m1 = np.array([N[i] @ u, N[i] @ v])
    m2 = np.array([N[j] @ u, N[j] @ v])
    A = np.array([m1, -m2]).T
    if abs(np.linalg.det(A)) < 1e-6:
        return None
    s, t = np.linalg.solve(A, q2 - q1)
    c2 = q1 + s * m1
    r1, r2 = np.linalg.norm(q1 - c2), np.linalg.norm(q2 - c2)
    if abs(r1 - r2) > 0.1 * max(r1, r2):
        return None
    return {"punkt": c2[0] * u + c2[1] * v, "achse": a, "radius": (r1 + r2) / 2}


def _kand_kegel(P, N, i, j, k):
    A = np.array([N[i], N[j], N[k]])
    if abs(np.linalg.det(A)) < 1e-4:
        return None
    spitze = np.linalg.solve(A, np.array([N[i] @ P[i], N[j] @ P[j], N[k] @ P[k]]))
    d = _einheit(np.array([P[i], P[j], P[k]]) - spitze)
    a = np.cross(d[1] - d[0], d[2] - d[0])
    if np.linalg.norm(a) < 1e-6:
        return None
    a = a / np.linalg.norm(a)
    if a @ d[0] < 0:
        a = -a
    win = float(np.mean(np.arccos(np.clip(d @ a, -1, 1))))
    if not np.radians(3) < win < np.radians(80):
        return None
    tt = (np.array([P[i], P[j], P[k]]) - spitze) @ a
    tm = float(tt.mean())
    return {"c": spitze + a * tm, "achse": a, "r0": tm * np.tan(win), "halbwinkel": win}


# --- Arbeitswolke --------------------------------------------------------------------------
def _voxel_schluessel(xyz, lo, voxel, b):
    g = np.floor((xyz - lo) / voxel).astype(np.int64)
    g = np.clip(g, 0, b - 1)
    return (g[:, 0] * b + g[:, 1]) * b + g[:, 2]


def arbeitswolke(xyz, nrm, max_punkte=150000):
    """Je Voxel ein echter Punkt. Liefert (Index der Arbeitspunkte,
    Zuordnung Originalpunkt -> Arbeitspunkt, Raster (lo, voxel, b))."""
    lo = xyz.min(0)
    diag = float(np.linalg.norm(np.ptp(xyz, axis=0)))
    voxel = diag / 2000
    while True:
        b = int(np.floor(np.ptp(xyz, axis=0).max() / voxel)) + 2
        schluessel = _voxel_schluessel(xyz, lo, voxel, b)
        _, erster, zuordnung = np.unique(schluessel, return_index=True, return_inverse=True)
        if len(erster) <= max_punkte:
            return erster, zuordnung, (lo, voxel, b)
        voxel *= 1.3


def _rauschen(P, baum, n=1500, k=16):
    rng = np.random.default_rng(1)
    werte = []
    for i in rng.choice(len(P), min(n, len(P)), replace=False):
        _, idx, _ = baum.search_knn_vector_3d(P[i], k)
        q = P[np.asarray(idx)]
        ew = np.linalg.eigvalsh(np.cov(q.T))
        werte.append(np.sqrt(max(ew[0], 0)))
    return float(np.median(werte))


# --- Hauptablauf -----------------------------------------------------------------------------
def erkennen(scan, toleranz=None, winkel_grad=20.0, min_anteil=0.08, arten=ARTEN,
             kandidaten=400, seed=1, fortschritt=None):
    """min_anteil in Prozent der Punkte (Untergrenze fuer eine Form).
    Liefert {"elemente": [...], "labels": int32 je Scanpunkt, "zusammenfassung",
    "toleranz", "freiform": Anzahl}."""
    rng = np.random.default_rng(seed)
    if scan.ist_netz and len(scan.tri):
        # Netze: Eckpunkte sind ungleich verteilt und ihre Normalen an scharfen
        # Kanten gemittelt -> Flaeche gleichmaessig abtasten (Dreiecksnormalen),
        # am Ende das Ergebnis per Raster auf die Eckpunkte uebertragen.
        m = scan.zu_o3d_netz(farbe=False)
        m.compute_triangle_normals()
        flaeche = m.get_surface_area()
        anzahl = int(np.clip(len(scan) * 3, 200000, 600000))
        probe = m.sample_points_uniformly(anzahl, use_triangle_normal=True)
        xyz = np.asarray(probe.points)
        nrm_quelle = np.asarray(probe.normals)
        del flaeche
    else:
        xyz = scan.xyz.astype(np.float64)
        nrm_quelle = scan.nrm
    wahl, zuordnung, raster = arbeitswolke(xyz, nrm_quelle)
    voxel = raster[1]
    P = xyz[wahl]
    orientiert = nrm_quelle is not None
    pc = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(P))
    if orientiert:
        N = _einheit(np.asarray(nrm_quelle)[wahl].astype(np.float64))
    else:
        # Ohne Normalen sind Bohrung und Zapfen nicht unterscheidbar (Deckel
        # auf der einen, Ring auf der anderen Seite sieht bei beiden gleich
        # aus) -> Normalen schaetzen und konsistent ausrichten, Gesamtvorzeichen
        # nach aussen (vom Schwerpunkt weg).
        pc.estimate_normals(o3d.geometry.KDTreeSearchParamKNN(20))
        if len(P) <= 400000:
            pc.orient_normals_consistent_tangent_plane(12)
            N = np.asarray(pc.normals)
            if np.mean(np.einsum("ij,ij->i", N, P - P.mean(0))) < 0:
                N = -N
            orientiert = True
        else:
            N = np.asarray(pc.normals)
    baum = o3d.geometry.KDTreeFlann(pc)
    diag = float(np.linalg.norm(np.ptp(P, axis=0)))
    abst = float(np.median(np.asarray(pc.compute_nearest_neighbor_distance())))
    rausch = _rauschen(P, baum)
    eps = float(toleranz) if toleranz else max(3.0 * rausch, 0.5 * abst, diag * 1e-4)
    cos_a = np.cos(np.radians(winkel_grad))
    n = len(P)
    min_punkte = max(25, int(n * min_anteil / 100.0))
    radien = [diag / 40, diag / 12, diag / 4]
    arten = [a for a in ARTEN if a in arten]
    gewicht = {"ebene": 0.3, "zylinder": 0.35, "kugel": 0.15, "kegel": 0.2}
    w = np.array([gewicht[a] for a in arten])
    w /= w.sum()

    rest = np.ones(n, bool)
    labels = np.full(n, -1, np.int32)
    elemente = []
    fehl = 0
    while fehl < 4:
        idx_rest = np.nonzero(rest)[0]
        if len(idx_rest) < min_punkte:
            break
        S = idx_rest if len(idx_rest) <= 25000 else rng.choice(idx_rest, 25000, replace=False)
        PS, NS = P[S], N[S]
        bestes = None
        for _ in range(kandidaten):
            art = arten[rng.choice(len(arten), p=w)]
            i = int(rng.choice(idx_rest))
            nb = None
            if art != "ebene":
                k, nidx, _ = baum.search_radius_vector_3d(P[i], radien[rng.integers(3)])
                nb = np.asarray(nidx)
                nb = nb[rest[nb]]
                if len(nb) < 4:
                    continue
            try:
                if art == "ebene":
                    mod = _kand_ebene(P, N, i)
                elif art == "kugel":
                    mod = _kand_kugel(P, N, i, int(rng.choice(nb)))
                elif art == "zylinder":
                    mod = _kand_zylinder(P, N, i, int(rng.choice(nb)))
                else:
                    j, k2 = rng.choice(nb, 2, replace=False)
                    mod = _kand_kegel(P, N, i, int(j), int(k2))
            except (np.linalg.LinAlgError, ValueError):
                mod = None
            if mod is None:
                continue
            r = mod.get("radius")
            if r is not None and not (2 * abst < r < diag):
                continue
            d, c = abstand(art, mod, PS, NS)
            punkte = int(np.count_nonzero((np.abs(d) < eps) & (c > cos_a)))
            wert = punkte * (1 - 0.02 * KOMPLEX[art])
            if bestes is None or wert > bestes[0]:
                bestes = (wert, art, mod)
        if bestes is None or bestes[0] * len(idx_rest) / len(S) < min_punkte:
            fehl += 1
            continue
        _, art, mod = bestes
        el = _uebernehmen(art, mod, P, N, rest, eps, cos_a, voxel, abst, min_punkte)
        if el is None:
            fehl += 1
            continue
        fehl = 0
        el["id"] = len(elemente)
        labels[el.pop("_maske")] = el["id"]
        rest &= labels == -1
        elemente.append(el)
        if fortschritt:
            fortschritt(len(elemente), int(rest.sum()), n)

    # Freiform: was uebrig ist, in zusammenhaengende Bereiche
    frei = np.nonzero(rest)[0]
    freiform = 0
    if len(frei):
        lab, groessen = komponenten(P[frei], max(abst * 3, voxel * 2))
        # Kantensaeume (Normalen kippen an Kanten) sind keine Freiform
        gross = np.nonzero(groessen >= max(4 * min_punkte, 0.005 * n))[0]
        for g in gross:
            labels[frei[lab == g]] = -2 - freiform
            freiform += 1

    _deuten(elemente, P, N, labels, orientiert)
    if scan.ist_netz and len(scan.tri):
        lo, vox, b = raster
        arbeit_schluessel = _voxel_schluessel(P, lo, vox, b)
        ordnung = np.argsort(arbeit_schluessel)
        sortiert = arbeit_schluessel[ordnung]
        eck = _voxel_schluessel(scan.xyz.astype(np.float64), lo, vox, b)
        pos = np.clip(np.searchsorted(sortiert, eck), 0, len(sortiert) - 1)
        treffer = sortiert[pos] == eck
        punkt_labels = np.where(treffer, labels[ordnung[pos]], -1)
    else:
        punkt_labels = labels[zuordnung]
    return {"elemente": elemente, "labels": punkt_labels.astype(np.int32),
            "toleranz": round(eps, 4), "rauschen": round(rausch, 4),
            "freiform": freiform, "zusammenfassung": zusammenfassung(elemente, freiform),
            "arbeitspunkte": n}


def _uebernehmen(art, mod, P, N, rest, eps, cos_a, voxel, abst, min_punkte):
    for runde in range(2):
        d, c = abstand(art, mod, P, N)
        passt = rest & (np.abs(d) < eps) & (c > cos_a)
        idx = np.nonzero(passt)[0]
        if len(idx) < min_punkte:
            return None
        lab, groessen = komponenten(P[idx], max(abst * 3, voxel * 2))
        idx = idx[lab == np.argmax(groessen)]
        if len(idx) < min_punkte:
            return None
        try:
            if art == "ebene":
                f = formen.ebene(P[idx])
                mod = {"punkt": f["punkt"], "normale": f["normale"]}
            elif art == "kugel":
                f = formen.kugel(P[idx])
                mod = {"mitte": f["mitte"], "radius": f["radius"]}
            elif art == "zylinder":
                f = formen.zylinder(P[idx], N[idx])
                mod = {"punkt": f["punkt"], "achse": f["achse"], "radius": f["radius"]}
            else:
                f = formen.kegel(P[idx], N[idx], start=(mod["c"], mod["achse"], mod["r0"], mod["halbwinkel"]))
                tw = np.tan(f["halbwinkel"])
                mitte = f["punkt"]
                r_mitte = (f["r_min"] + f["r_max"]) / 2
                mod = {"c": mitte, "achse": f["achse"], "r0": r_mitte, "halbwinkel": f["halbwinkel"]}
                if not np.isfinite(tw) or f["halbwinkel"] <= 0:
                    return None
        except (ValueError, np.linalg.LinAlgError):
            return None
        if art in ("zylinder", "kugel") and not (2 * abst < mod["radius"]):
            return None
    maske = np.zeros(len(P), bool)
    maske[idx] = True
    el = {"art": art, "punkte": int(len(idx)), "rms": float(f["rms"]), "_maske": maske}
    el.update(mod)
    if art == "kegel":
        el.update({"r_min": f["r_min"], "r_max": f["r_max"], "hoehe": f["hoehe"], "punkt": f["punkt"]})
    return el


# --- Deuten, Nennmasse ----------------------------------------------------------------------
def nennmass(wert, rms, stufen=(1.0, 0.5, 0.1)):
    """Groebste Stufe, deren Rundung innerhalb der Messunsicherheit liegt."""
    toleranz = max(0.06, 3 * rms, abs(wert) * 0.004)
    for s in stufen:
        r = round(wert / s) * s
        if abs(r - wert) <= toleranz:
            return round(r, 3)
    return round(wert, 2)


def _achse_einrasten(a, grad=1.0):
    for k, name in enumerate("XYZ"):
        if abs(a[k]) >= np.cos(np.radians(grad)):
            e = np.zeros(3)
            e[k] = np.sign(a[k])
            return name, e
    return None, a


def _abdeckung(P, q, a):
    """Ueberdeckter Umfangswinkel in Grad (360 minus groesste Luecke)."""
    u, v = formen._basis(a)
    w = np.degrees(np.arctan2((P - q) @ v, (P - q) @ u))
    w = np.sort(w)
    if len(w) < 3:
        return 0.0
    luecken = np.diff(np.concatenate([w, [w[0] + 360]]))
    return float(360 - luecken.max())


def _deuten(elemente, P, N, labels, orientiert):
    for el in elemente:
        m = labels == el["id"]
        pts, nn = P[m], N[m]
        art = el["art"]
        if art in ("zylinder", "kegel"):
            achse = el["achse"]
            q = el["punkt"]
            t = (pts - q) @ achse
            el["hoehe"] = float(t.max() - t.min())
            el["punkt"] = q + achse * (t.min() + t.max()) / 2
            el["umfang_grad"] = round(_abdeckung(pts, el["punkt"], achse), 1)
            name, ger = _achse_einrasten(achse)
            el["achse_name"] = name
            if name:
                el["achse_nenn"] = ger
            if orientiert:
                v = pts - el["punkt"]
                radial = _einheit(v - np.outer(v @ achse, achse))
                el["konkav"] = bool(float(np.mean(np.einsum("ij,ij->i", radial, nn))) < 0)
            else:
                el["konkav"] = None
        if art == "zylinder":
            d = 2 * el["radius"]
            el["durchmesser"] = round(d, 4)
            el["durchmesser_nenn"] = nennmass(d, el["rms"])
            voll = el["umfang_grad"] >= 300
            if el["konkav"] is None:
                el["typ"] = "zylinder" if voll else "zylinderflaeche"
            elif voll:
                el["typ"] = "bohrung" if el["konkav"] else "zapfen"
            else:
                el["typ"] = "hohlkehle" if el["konkav"] else "rundung"
                el["radius_nenn"] = nennmass(el["radius"], el["rms"], (0.5, 0.25, 0.1))
        elif art == "kugel":
            v = _einheit(pts - el["mitte"])
            innen = orientiert and float(np.mean(np.einsum("ij,ij->i", v, nn))) < 0
            el["konkav"] = bool(innen) if orientiert else None
            el["durchmesser"] = round(2 * el["radius"], 4)
            el["durchmesser_nenn"] = nennmass(2 * el["radius"], el["rms"])
            el["typ"] = "kugelmulde" if innen else "kugel"
        elif art == "kegel":
            el["winkel_grad"] = round(float(np.degrees(el["halbwinkel"])) * 2, 3)
            el["winkel_nenn"] = nennmass(el["winkel_grad"], 0.0, (5.0, 1.0, 0.5))
            el["typ"] = "senkung" if el.get("konkav") else "kegel"
        else:
            n = el["normale"]
            if orientiert and float(np.mean(nn @ n)) < 0:
                el["normale"] = -n
            name, ger = _achse_einrasten(el["normale"])
            el["achse_name"] = name
            u, v = formen._basis(el["normale"])
            flach = np.stack([(pts - el["punkt"]) @ u, (pts - el["punkt"]) @ v], 1)
            # Hauptrichtungen der Flaeche statt beliebiger Basis, sonst misst
            # ein schraeg liegendes Rechteck seine Diagonal-Huelle
            _, _, vt = np.linalg.svd(flach - flach.mean(0), full_matrices=False)
            ausdehnung = np.ptp(flach @ vt.T, axis=0)
            el["ausdehnung"] = [round(float(x), 2) for x in sorted(ausdehnung, reverse=True)]
            el["typ"] = "ebene"
        el["text"] = beschreibung(el)


TYP_NAMEN = {"ebene": ("Ebene", "Ebenen"), "bohrung": ("Bohrung", "Bohrungen"),
             "zapfen": ("Zapfen/Welle", "Zapfen/Wellen"), "rundung": ("Rundung", "Rundungen"),
             "hohlkehle": ("Hohlkehle", "Hohlkehlen"), "zylinder": ("Zylinder", "Zylinder"),
             "zylinderflaeche": ("Zylinderfläche", "Zylinderflächen"), "kugel": ("Kugel", "Kugeln"),
             "kugelmulde": ("Kugelmulde", "Kugelmulden"), "kegel": ("Kegel", "Kegel"),
             "senkung": ("Senkung", "Senkungen")}


def _mm(x, stellen=2):
    return ("%%.%df" % stellen % x).replace(".", ",")


def _mitte_text(el):
    """Bei eingerasteter Achse: Lage in den beiden anderen Koordinaten."""
    name = el.get("achse_name")
    if not name:
        return ""
    andere = [k for k in "XYZ" if k != name]
    p = el["punkt"]
    return " · Mitte " + " / ".join("%s %s" % (k, _mm(p["XYZ".index(k)])) for k in andere)


def beschreibung(el):
    typ = el["typ"]
    name = TYP_NAMEN[typ][0]
    achse = " · Achse %s" % el["achse_name"] if el.get("achse_name") else ""
    if typ in ("bohrung", "zapfen", "zylinder", "zylinderflaeche"):
        laenge = "Tiefe" if typ == "bohrung" else "Länge"
        return "%s Ø %s (gemessen %s) · %s %s%s%s" % (
            name, _mm(el["durchmesser_nenn"]), _mm(el["durchmesser"], 3), laenge,
            _mm(el["hoehe"], 1), achse, _mitte_text(el))
    if typ in ("rundung", "hohlkehle"):
        return "%s R %s (gemessen %s) · %s°%s" % (
            name, _mm(el["radius_nenn"]), _mm(el["radius"], 3), _mm(el["umfang_grad"], 0), achse)
    if typ in ("kugel", "kugelmulde"):
        return "%s Ø %s (gemessen %s)" % (name, _mm(el["durchmesser_nenn"]), _mm(el["durchmesser"], 3))
    if typ in ("kegel", "senkung"):
        return "%s %s° (gemessen %s°) · Ø %s → %s%s" % (
            name, _mm(el["winkel_nenn"], 1), _mm(el["winkel_grad"], 2),
            _mm(2 * el["r_max"], 2), _mm(2 * el["r_min"], 2), achse)
    return "Ebene %s × %s mm%s" % (_mm(el["ausdehnung"][0], 1), _mm(el["ausdehnung"][1], 1),
                                   " · Normale %s" % el["achse_name"] if el.get("achse_name") else "")


def zusammenfassung(elemente, freiform):
    zahl = {}
    for el in elemente:
        zahl.setdefault(el["typ"], []).append(el)
    teile = []
    for typ in ("ebene", "bohrung", "zapfen", "zylinder", "zylinderflaeche", "rundung",
                "hohlkehle", "kugel", "kugelmulde", "kegel", "senkung"):
        liste = zahl.get(typ)
        if not liste:
            continue
        einzahl, mehrzahl = TYP_NAMEN[typ]
        text = "%d %s" % (len(liste), einzahl if len(liste) == 1 else mehrzahl)
        if typ in ("bohrung", "zapfen"):
            gruppen = {}
            for el in liste:
                gruppen[el["durchmesser_nenn"]] = gruppen.get(el["durchmesser_nenn"], 0) + 1
            text += " (%s)" % ", ".join("%d× Ø %s" % (k, _mm(d, 1).rstrip("0").rstrip(","))
                                        for d, k in sorted(gruppen.items()))
        if typ in ("rundung", "hohlkehle"):
            gruppen = {}
            for el in liste:
                gruppen[el["radius_nenn"]] = gruppen.get(el["radius_nenn"], 0) + 1
            text += " (%s)" % ", ".join("%d× R %s" % (k, _mm(r, 1).rstrip("0").rstrip(","))
                                        for r, k in sorted(gruppen.items()))
        teile.append(text)
    if freiform:
        teile.append("%d Freiformbereich%s" % (freiform, "" if freiform == 1 else "e"))
    return "Erkannt: " + (", ".join(teile) if teile else "nichts") + "."


def aus_auswahl(scan, maske, art="auto", elemente=None):
    """Manuell: Form in die gewaehlten Punkte einpassen und deuten. Bei
    art="auto" gewinnt die Form mit dem kleinsten Restfehler (einfachere
    Formen bevorzugt, solange sie fast so gut passen)."""
    idx = np.nonzero(maske)[0]
    if len(idx) < 8:
        raise ValueError("Zu wenige Punkte gewählt (mindestens 8).")
    P = scan.xyz[idx].astype(np.float64)
    N = _einheit(scan.nrm[idx].astype(np.float64)) if scan.nrm is not None else None
    kandidaten = []
    for a in (ARTEN if art == "auto" else (art,)):
        try:
            if a == "ebene":
                f = formen.ebene(P)
                mod = {"punkt": f["punkt"], "normale": f["normale"]}
            elif a == "kugel":
                f = formen.kugel(P)
                mod = {"mitte": f["mitte"], "radius": f["radius"]}
            elif a == "zylinder":
                f = formen.zylinder(P, N)
                mod = {"punkt": f["punkt"], "achse": f["achse"], "radius": f["radius"]}
            else:
                f = formen.kegel(P, N)
                mod = {"c": f["punkt"], "achse": f["achse"], "r0": (f["r_min"] + f["r_max"]) / 2,
                       "halbwinkel": f["halbwinkel"], "r_min": f["r_min"], "r_max": f["r_max"],
                       "hoehe": f["hoehe"], "punkt": f["punkt"]}
            if not np.isfinite(f["rms"]):
                continue
            kandidaten.append((f["rms"] * (1 + 0.15 * KOMPLEX[a]), a, f, mod))
        except (ValueError, np.linalg.LinAlgError):
            continue
    if not kandidaten:
        raise ValueError("Keine Form ließ sich einpassen.")
    _, a, f, mod = min(kandidaten, key=lambda k: k[0])
    neue_id = max([e["id"] for e in (elemente or [])] + [-1]) + 1
    el = {"art": a, "punkte": int(len(idx)), "rms": float(f["rms"]), "id": neue_id, "manuell": True}
    el.update(mod)
    labels = np.full(len(idx), neue_id, np.int32)
    _deuten([el], P, N if N is not None else np.zeros_like(P), labels, N is not None)
    return el


def als_json(el):
    aus = {}
    for k, v in el.items():
        if isinstance(v, np.ndarray):
            aus[k] = [round(float(x), 6) for x in v]
        elif isinstance(v, (np.floating, float)):
            aus[k] = round(float(v), 6)
        elif isinstance(v, np.integer):
            aus[k] = int(v)
        else:
            aus[k] = v
    return aus
