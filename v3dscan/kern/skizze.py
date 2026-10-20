# Querschnitt -> Skizze (Design X "Mesh Sketch", QuickSurface "Mesh Section" + "Fit Primitives in 2D").
#
# Ablauf: Ebene festlegen -> Scan schneiden (Netz exakt, Punktwolke als duenne Scheibe)
# -> geordnete Polylinien in 2D -> automatisch in Linien/Boegen/Kreise zerlegen
# (rekursives Teilen an der groessten Sehnenabweichung, danach Nachbarn zusammenfassen)
# -> einrasten (achsparallel, Nennmass-Radien) -> Anschlusspunkte als Schnittpunkte
# der Nachbarelemente, damit die Kette fuer OCP exakt geschlossen ist.
#
# Ebene: {"ursprung", "u", "v", "n"} (3D, u x v = n). 2D-Koordinaten (s, t) = ((P-o)·u, (P-o)·v).
# Elemente (2D, im Projekt als JSON):
#   linie {a, b, p, d}            p/d = Traegergerade (Punkt, Einheitsrichtung)
#   bogen {a, b, m, mitte, r}     m = Punkt auf dem Bogen zwischen a und b (legt die Seite fest)
#   kreis {mitte, r}

import math

import numpy as np

from .erkennung import nennmass


def _einheit(v):
    v = np.asarray(v, np.float64)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def _senkrecht(a):
    a = _einheit(a)
    h = np.array([1.0, 0, 0]) if abs(a[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = _einheit(np.cross(a, h))
    return e1, np.cross(a, e1)


# --- Ebenen ------------------------------------------------------------------------------------------
WELT = {"xy": ((1, 0, 0), (0, 1, 0), 2), "xz": ((1, 0, 0), (0, 0, 1), 1), "yz": ((0, 1, 0), (0, 0, 1), 0)}


def ebene_welt(name, versatz=0.0):
    u, v, k = WELT[name]
    u, v = np.array(u, float), np.array(v, float)
    o = np.zeros(3)
    o[k] = versatz
    return _ebene(o, u, v)


def ebene_aus_ebene(el, versatz=0.0):
    """Erkannte Ebene (punkt, normale) um versatz entlang der Normale verschoben.
    u moeglichst entlang einer Weltachse, damit Linien achsparallel einrasten koennen."""
    n = _einheit(el["normale"])
    for w in (np.array([1.0, 0, 0]), np.array([0, 1.0, 0]), np.array([0, 0, 1.0])):
        u = w - (w @ n) * n
        if np.linalg.norm(u) > 0.5:
            break
    u = _einheit(u)
    return _ebene(np.asarray(el["punkt"], float) + n * versatz, u, np.cross(n, u))


def ebene_durch_achse(el, winkel_grad=0.0):
    """Ebene, die die Achse eines Zylinders/Kegels enthaelt (Profil fuer Drehen).
    u = Achse, Ursprung auf der Achse; winkel dreht die Ebene um die Achse."""
    a = _einheit(el["achse"])
    e1, e2 = _senkrecht(a)
    w = math.radians(winkel_grad)
    v = math.cos(w) * e1 + math.sin(w) * e2
    return _ebene(np.asarray(el["punkt"], float), a, v)


def _ebene(o, u, v):
    u = _einheit(u)
    v = _einheit(v - (v @ u) * u)
    return {"ursprung": np.asarray(o, float), "u": u, "v": v, "n": np.cross(u, v)}


def ebene_json(E):
    return {k: [round(float(x), 9) for x in E[k]] for k in ("ursprung", "u", "v", "n")}


def ebene_lesen(d):
    return {k: np.asarray(d[k], float) for k in ("ursprung", "u", "v", "n")}


def zu2d(P, E):
    q = np.asarray(P, float) - E["ursprung"]
    return np.c_[q @ E["u"], q @ E["v"]]


def zu3d(q, E):
    q = np.asarray(q, float).reshape(-1, 2)
    return E["ursprung"] + q[:, :1] * E["u"] + q[:, 1:2] * E["v"]


# --- Schnitt -------------------------------------------------------------------------------------------
def schnitt(scan, E, band=None):
    """-> (polylinien [(k,2) float64], geschlossen [bool], info). Netze exakt, Punktwolken als
    Scheibe |Abstand| <= band (Standard 1,5 x Punktabstand) und geordnet abgelaufen."""
    if scan.tri is not None and len(scan.tri):
        linien, zu = _schnitt_netz(scan.xyz.astype(np.float64), scan.tri, E)
        return linien, zu, {"art": "netz"}
    abstand = punktabstand(scan.xyz)
    band = float(band) if band else 1.5 * abstand
    d = (scan.xyz.astype(np.float64) - E["ursprung"]) @ E["n"]
    P = zu2d(scan.xyz[np.abs(d) <= band], E)
    linien, zu = _ordnen(P, abstand)
    return linien, zu, {"art": "wolke", "band": band, "punktabstand": abstand, "scheibe": int(len(P))}


def punktabstand(xyz, n=20000):
    from .o3d import o3d
    xyz = np.asarray(xyz)
    if len(xyz) > n:
        xyz = xyz[np.random.default_rng(0).choice(len(xyz), n, replace=False)]
    pc = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(xyz.astype(np.float64)))
    d = np.asarray(pc.compute_nearest_neighbor_distance())
    return float(np.median(d)) if len(d) else 1.0


def _schnitt_netz(X, T, E):
    d = (X - E["ursprung"]) @ E["n"]
    d = np.where(np.abs(d) < 1e-9, 1e-9, d)          # keine Ecke genau auf der Ebene
    s = d[T] > 0
    kreuzt = s.any(1) & ~s.all(1)
    T = T[kreuzt]
    s = s[kreuzt]
    # je Dreieck die zwei Kanten mit Vorzeichenwechsel
    kanten = np.stack([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]], 1)        # (m,3,2)
    wechsel = np.stack([s[:, 0] != s[:, 1], s[:, 1] != s[:, 2], s[:, 2] != s[:, 0]], 1)
    paare = kanten[wechsel].reshape(-1, 2, 2)                                 # (m,2 Kanten,2 Ecken)
    paare = np.sort(paare, axis=2)
    schluessel = paare[..., 0].astype(np.int64) * (len(X) + 1) + paare[..., 1]
    # Schnittpunkt je Kante
    i, j = paare[..., 0], paare[..., 1]
    t = d[i] / (d[i] - d[j])
    P3 = X[i] + (X[j] - X[i]) * t[..., None]
    P2 = zu2d(P3.reshape(-1, 3), E).reshape(-1, 2, 2)
    # Kette: Kante -> Segmente
    nachbarn = {}
    for k, (a, b) in enumerate(schluessel.tolist()):
        nachbarn.setdefault(a, []).append(k)
        nachbarn.setdefault(b, []).append(k)
    punkt = {}
    for k in range(len(schluessel)):
        punkt[schluessel[k, 0]] = P2[k, 0]
        punkt[schluessel[k, 1]] = P2[k, 1]
    benutzt = np.zeros(len(schluessel), bool)
    linien, zu = [], []

    def laufen(start_k, von):
        kette = [von]
        k, aktuell = start_k, von
        while True:
            benutzt[k] = True
            a, b = schluessel[k]
            weiter = b if a == aktuell else a
            kette.append(weiter)
            naechste = [x for x in nachbarn[weiter] if not benutzt[x]]
            if not naechste:
                return kette
            k, aktuell = naechste[0], weiter

    # offene Enden zuerst (Kanten mit nur einem Segment), dann geschlossene Ringe
    enden = [s_ for s_, ks in nachbarn.items() if len(ks) == 1]
    for e in enden:
        k = nachbarn[e][0]
        if benutzt[k]:
            continue
        kette = laufen(k, e)
        linien.append(np.array([punkt[x] for x in kette]))
        zu.append(False)
    for k in range(len(schluessel)):
        if benutzt[k]:
            continue
        kette = laufen(k, schluessel[k, 0])
        geschlossen = kette[0] == kette[-1]
        linien.append(np.array([punkt[x] for x in (kette[:-1] if geschlossen else kette)]))
        zu.append(geschlossen)
    return _aufraeumen(linien, zu)


def _aufraeumen(linien, zu, mindest=3):
    aus, aus_zu = [], []
    for L, z in zip(linien, zu):
        if len(L) < 2:
            continue
        # doppelte Punkte (Kante genau durch Ecke) entfernen
        keep = np.r_[True, np.linalg.norm(np.diff(L, axis=0), axis=1) > 1e-9]
        L = L[keep]
        if len(L) >= mindest:
            aus.append(L)
            aus_zu.append(z)
    return aus, aus_zu


def _ordnen(P, abstand):
    """Ungeordnete 2D-Scheibenpunkte -> Polylinien: Raster ausduennen, dann gierig ablaufen."""
    from .o3d import o3d
    if len(P) < 3:
        return [], []
    h = max(abstand, 1e-3)
    zelle = np.floor(P / h).astype(np.int64)
    _, inv = np.unique(zelle, axis=0, return_inverse=True)
    inv = inv.ravel()
    Q = np.zeros((inv.max() + 1, 2))
    np.add.at(Q, inv, P)
    Q /= np.bincount(inv)[:, None]
    r = 3.0 * h
    baum = o3d.geometry.KDTreeFlann(o3d.geometry.PointCloud(o3d.utility.Vector3dVector(np.c_[Q, np.zeros(len(Q))])))
    Q3 = np.c_[Q, np.zeros(len(Q))]
    nachbar = []
    for q in Q3:
        _, idx, _ = baum.search_radius_vector_3d(q, r)
        nachbar.append(np.asarray(idx))
    frei = np.ones(len(Q), bool)
    linien, zu = [], []

    def lauf(start, richtung=None):
        weg = [start]
        cur = start
        while True:
            kand = [k for k in nachbar[cur] if frei[k]]
            if not kand:
                return weg
            kand = np.array(kand)
            schritt = Q[kand] - Q[cur]
            dist = np.linalg.norm(schritt, axis=1)
            if richtung is not None:
                ok = (schritt @ richtung) > -0.2 * dist
                if not ok.any():
                    return weg
                kand, schritt, dist = kand[ok], schritt[ok], dist[ok]
            k = kand[np.argmin(dist)]
            neu = Q[k] - Q[cur]
            richtung = neu / max(np.linalg.norm(neu), 1e-12)
            # alles im halben Radius gilt als abgelaufen (Scheibe ist ein paar Punkte dick)
            for x in nachbar[cur]:
                if np.linalg.norm(Q[x] - Q[cur]) <= 1.2 * h:
                    frei[x] = False
            frei[k] = False
            weg.append(k)
            cur = k

    while frei.any():
        offen = np.nonzero(frei)[0]
        grad = np.array([sum(frei[x] for x in nachbar[i]) for i in offen])
        start = offen[np.argmin(grad)]
        frei[start] = False
        vor = lauf(start)
        zurueck = []
        if len(vor) > 1:
            d0 = Q[start] - Q[vor[1]]
            zurueck = lauf(start, d0 / max(np.linalg.norm(d0), 1e-12))[1:]
        kette = zurueck[::-1] + vor
        if len(kette) < 5:
            continue
        L = Q[kette]
        geschlossen = np.linalg.norm(L[0] - L[-1]) <= r and len(L) > 8
        linien.append(L)
        zu.append(bool(geschlossen))
    return linien, zu


def ketten_verbinden(linien, zu, luecke):
    """Offene Polylinien, deren Enden naeher als luecke liegen, aneinanderhaengen;
    eine offene Linie mit Enden naeher als luecke wird geschlossen."""
    linien = [np.asarray(L) for L in linien]
    zu = list(zu)
    if luecke <= 0:
        return linien, zu
    geaendert = True
    while geaendert:
        geaendert = False
        offen = [i for i, z in enumerate(zu) if not z]
        bester = None
        for ai, i in enumerate(offen):
            for j in offen[ai + 1:]:
                A, B = linien[i], linien[j]
                for fa, fb, d in ((0, 0, np.linalg.norm(A[0] - B[0])), (0, 1, np.linalg.norm(A[0] - B[-1])),
                                  (1, 0, np.linalg.norm(A[-1] - B[0])), (1, 1, np.linalg.norm(A[-1] - B[-1]))):
                    if d <= luecke and (bester is None or d < bester[0]):
                        bester = (d, i, j, fa, fb)
        if bester:
            _, i, j, fa, fb = bester
            A = linien[i] if fa == 1 else linien[i][::-1]
            B = linien[j] if fb == 0 else linien[j][::-1]
            linien[i] = np.concatenate([A, B])
            del linien[j], zu[j]
            geaendert = True
    for i, L in enumerate(linien):
        if not zu[i] and len(L) > 3 and np.linalg.norm(L[0] - L[-1]) <= luecke:
            zu[i] = True
    return linien, zu


# --- Einpassen -------------------------------------------------------------------------------------------
def _linie_fit(P):
    c = P.mean(0)
    _, _, vt = np.linalg.svd(P - c, full_matrices=False)
    d = vt[0]
    if (P[-1] - P[0]) @ d < 0:
        d = -d
    nrm = np.array([-d[1], d[0]])
    return c, d, np.abs((P - c) @ nrm)


def _kreis_fit(P):
    x, y = P[:, 0], P[:, 1]
    A = np.c_[2 * x, 2 * y, np.ones(len(P))]
    try:
        sol = np.linalg.lstsq(A, x * x + y * y, rcond=None)[0]
    except np.linalg.LinAlgError:
        return None
    c = sol[:2]
    r = math.sqrt(max(sol[2] + c @ c, 1e-18))
    for _ in range(10):                     # geometrisch nachziehen (Gauss-Newton)
        diff = P - c
        dist = np.linalg.norm(diff, axis=1)
        if np.any(dist < 1e-12):
            break
        J = np.c_[-diff / dist[:, None], -np.ones(len(P))]
        res = dist - r
        delta = np.linalg.lstsq(J, -res, rcond=None)[0]
        c = c + delta[:2]
        r = r + delta[2]
        if np.linalg.norm(delta) < 1e-10:
            break
    return c, abs(r), np.abs(np.linalg.norm(P - c, axis=1) - abs(r))


def _bogen_winkel(P, c):
    """Ueberstrichener Winkel (Grad) entlang der Punktfolge."""
    w = np.unwrap(np.arctan2(P[:, 1] - c[1], P[:, 0] - c[0]))
    return abs(math.degrees(w[-1] - w[0]))


def _innerhalb(res, tol):
    """Robust gegen einzelne Rauschpunkte: 95 % innerhalb tol, keiner ueber 2,5 tol."""
    return len(res) and np.percentile(res, 95) <= tol and res.max() <= 2.5 * tol


def _passt(P, tol):
    """Bestes Element fuer die Punktfolge oder None. Linie hat Vorrang."""
    if len(P) < 2:
        return None
    c, d, res = _linie_fit(P)
    if _innerhalb(res, tol):
        return {"typ": "linie", "p": c, "d": d, "rms": float(np.sqrt(np.mean(res ** 2)))}
    if len(P) >= 5:
        k = _kreis_fit(P)
        if k is not None:
            m, r, res = k
            sehne = np.linalg.norm(P[-1] - P[0])
            winkel = _bogen_winkel(P, m)
            if _innerhalb(res, tol) and winkel >= 8 and r < 1e4 and (sehne > 0 or winkel > 300):
                return {"typ": "bogen", "mitte": m, "r": r, "winkel": winkel,
                        "rms": float(np.sqrt(np.mean(res ** 2)))}
    return None


def _teilen(P, i, j, tol, aus, tiefe=0):
    el = _passt(P[i:j + 1], tol)
    if el is not None or j - i < 4 or tiefe > 60:
        if el is None:
            c, d, res = _linie_fit(P[i:j + 1])
            el = {"typ": "linie", "p": c, "d": d, "rms": float(np.sqrt(np.mean(res ** 2)))}
        el["i"], el["j"] = i, j
        aus.append(el)
        return
    a, b = P[i], P[j]
    ab = b - a
    lang = np.linalg.norm(ab)
    Q = P[i + 1:j]
    if lang > 1e-12:
        dist = np.abs((Q - a) @ np.array([-ab[1], ab[0]]) / lang)
    else:
        dist = np.linalg.norm(Q - a, axis=1)
    k = i + 1 + int(np.argmax(dist))
    k = min(max(k, i + 2), j - 2)
    _teilen(P, i, k, tol, aus, tiefe + 1)
    _teilen(P, k, j, tol, aus, tiefe + 1)


def _zusammenfassen(P, els, tol, geschlossen):
    geaendert = True
    while geaendert and len(els) > 1:
        geaendert = False
        paare = list(range(len(els) - 1)) + ([len(els) - 1] if geschlossen and len(els) > 2 else [])
        bester = None
        for a in paare:
            b = (a + 1) % len(els)
            A, B = els[a], els[b]
            if b == 0:
                Q = np.concatenate([P[A["i"]:], P[:B["j"] + 1]])
            else:
                Q = P[A["i"]:B["j"] + 1]
            el = _passt(Q, tol)
            if el is not None:
                guete = el["rms"]
                if bester is None or guete < bester[0]:
                    bester = (guete, a, b, el)
        if bester:
            _, a, b, el = bester
            el["i"], el["j"] = els[a]["i"], els[b]["j"]
            if b == 0:
                el["umlauf"] = True
                els = [el] + els[1:a]
            else:
                els = els[:a] + [el] + els[b + 1:]
            geaendert = True
    return els


def _aufloesen(P, els, tol):
    """Zwischenstuecke (meist Uebergangszonen Linie->Bogen) auf die Nachbarn verteilen,
    wenn beide danach noch passen - kleinste zuerst. Indizes muessen fortlaufend sein."""
    geaendert = True
    while geaendert and len(els) > 2:
        geaendert = False
        for k in sorted(range(1, len(els) - 1), key=lambda k: els[k]["j"] - els[k]["i"]):
            # drei Nachbarn durch zwei ersetzen, wenn beide passen (weniger Elemente gewinnen)
            e, a, b = els[k], els[k - 1], els[k + 1]
            bester = None
            for t in range(e["i"], e["j"] + 1):
                A = _passt(P[a["i"]:t + 1], tol)
                B = _passt(P[t:b["j"] + 1], tol) if A else None
                if A and B:
                    guete = A["rms"] * (t - a["i"]) + B["rms"] * (b["j"] - t)
                    if bester is None or guete < bester[0]:
                        bester = (guete, t, A, B)
            if bester:
                _, t, A, B = bester
                A["i"], A["j"], B["i"], B["j"] = a["i"], t, t, b["j"]
                els[k - 1:k + 2] = [A, B]
                geaendert = True
                break
    return els


def einpassen(L, geschlossen, tol):
    """Polylinie -> Elemente (Parameterform, mit Indexbereich i..j in L)."""
    L = np.asarray(L, float)
    if geschlossen and len(L) >= 8:
        k = _kreis_fit(L)
        if k is not None:
            m, r, res = k
            if _innerhalb(res, tol) and _bogen_winkel(np.r_[L, L[:1]], m) > 330:
                return [{"typ": "kreis", "mitte": m, "r": r, "rms": float(np.sqrt(np.mean(res ** 2)))}]
    els = []
    if geschlossen:
        # an der Ecke mit der staerksten Richtungsaenderung aufschneiden
        n = len(L)
        d1 = L - np.roll(L, 1, axis=0)
        d2 = np.roll(L, -1, axis=0) - L
        w = np.abs(np.arctan2(d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0], (d1 * d2).sum(1)))
        # 1. Durchgang an der staerksten Richtungsaenderung aufschneiden, 2. Durchgang in der
        # Mitte des laengsten geraden Stuecks beginnen - dort liegt sicher kein Uebergang
        start = int(np.argmax(w))
        for durchgang in range(2):
            Lr = np.roll(L, -start, axis=0)
            Lr = np.r_[Lr, Lr[:1]]
            els = []
            _teilen(Lr, 0, n, tol, els)
            els = _zusammenfassen(Lr, els, tol, False)
            els = _aufloesen(Lr, els, tol)
            if durchgang == 0:
                kand = [e for e in els if e["typ"] == "linie"] or els
                e = max(kand, key=lambda e: e["j"] - e["i"])
                start = (start + (e["i"] + e["j"]) // 2) % n
        L = Lr
        els = _zusammenfassen(L, els, tol, True)
    else:
        _teilen(L, 0, len(L) - 1, tol, els)
        els = _zusammenfassen(L, els, tol, False)
        els = _aufloesen(L, els, tol)
    for el in els:
        if el.get("umlauf"):
            Q = np.concatenate([L[el["i"]:], L[1:el["j"] + 1]])
        else:
            Q = L[el["i"]:el["j"] + 1]
        # Parameter nur aus dem Inneren nachziehen: die Uebergangszonen an den Enden
        # (Linie geht in Bogen ueber) verfaelschen sonst Radius und Lage
        k = len(Q) // 7
        innen = Q[k:len(Q) - k] if len(Q) - 2 * k >= 5 else Q
        if el["typ"] == "linie":
            c, d, res = _linie_fit(innen)
            el["p"], el["d"] = c, d if d @ el["d"] >= 0 else -d
            el["rms"] = float(np.sqrt(np.mean(res ** 2)))
        if el["typ"] == "bogen":
            el["punkte"] = Q
            mid = Q[len(Q) // 2]
            el["ref"] = mid
        el["start"], el["ende"] = Q[0], Q[-1]
    return els, L


# --- Einrasten + Verbinden -----------------------------------------------------------------------------
def _rundung_mitte(L1, L2, mitte_alt, r):
    """Mittelpunkt eines Bogens mit Radius r tangential an beide Geraden, auf der Seite
    des bisherigen Mittelpunkts. None bei (fast) parallelen Geraden."""
    versetzt = []
    for L in (L1, L2):
        nrm = np.array([-L["d"][1], L["d"][0]])
        seite = np.sign((mitte_alt - L["p"]) @ nrm) or 1.0
        versetzt.append(L["p"] + seite * nrm * r)
    k = _schnitt_gerade_gerade(versetzt[0], L1["d"], versetzt[1], L2["d"])
    return k[0] if k else None


def _ist_rundung(L1, B, L2, tol):
    """Bogen liegt (ungefaehr) tangential zwischen zwei Geraden?"""
    for L in (L1, L2):
        nrm = np.array([-L["d"][1], L["d"][0]])
        if abs(abs((B["mitte"] - L["p"]) @ nrm) - B["r"]) > max(4 * tol, 0.25 * B["r"]):
            return False
    return True


def _rundung_einpassen(L1, B, L2, P):
    """Radius einer tangentialen Rundung mit der Bedingung 'tangential an beiden Geraden'
    einpassen (1 Unbekannte statt 3 - an kurzen, verrauschten Boegen viel stabiler)."""
    m0 = B["mitte"]

    def fehler(r):
        m = _rundung_mitte(L1, L2, m0, r)
        if m is None:
            return np.inf
        return float(np.mean((np.linalg.norm(P - m, axis=1) - r) ** 2))
    a, b = 0.3 * B["r"], 2.0 * B["r"]
    g = (math.sqrt(5) - 1) / 2
    c, d = b - g * (b - a), a + g * (b - a)
    fc, fd = fehler(c), fehler(d)
    for _ in range(60):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - g * (b - a)
            fc = fehler(c)
        else:
            a, c, fc = c, d, fd
            d = a + g * (b - a)
            fd = fehler(d)
    r = 0.5 * (a + b)
    m = _rundung_mitte(L1, L2, m0, r)
    if m is None:
        return None
    return r, m, math.sqrt(fehler(r))


def einrasten(els, achsen_grad=1.0, radien=True, geschlossen=False, tol=0.1):
    for el in els:
        if el["typ"] == "linie" and achsen_grad > 0:
            for ziel in (np.array([1.0, 0]), np.array([0, 1.0])):
                c = abs(el["d"] @ ziel)
                if c >= math.cos(math.radians(achsen_grad)):
                    el["d"] = ziel * np.sign(el["d"] @ ziel)
                    el["achse"] = "waagrecht" if ziel[0] else "senkrecht"
    n = len(els)
    for i, el in enumerate(els):
        if el["typ"] == "kreis":
            if radien:
                el["r"] = nennmass(2 * el["r"], el["rms"]) / 2
                el["nenn"] = True
            continue
        if el["typ"] != "bogen":
            continue
        vor = els[i - 1] if (i > 0 or geschlossen) and n > 2 else None
        nach = els[(i + 1) % n] if (i < n - 1 or geschlossen) and n > 2 else None
        rundung = (vor is not None and nach is not None and vor["typ"] == "linie" and nach["typ"] == "linie"
                   and "punkte" in el and _ist_rundung(vor, el, nach, tol))
        if rundung:
            fit = _rundung_einpassen(vor, el, nach, el["punkte"])
            if fit is not None:
                el["r"], el["mitte"], el["rms"] = fit
                el["rundung"] = True
        if radien:
            # kurze Rundungsboegen: Radius unsicherer als ihr rms -> ~2 % Spielraum
            unsicher = max(el["rms"], 0.007 * el["r"]) if rundung else el["rms"]
            el["r"] = nennmass(el["r"], unsicher, (0.5, 0.25, 0.1))
            el["nenn"] = True
            if rundung:
                m = _rundung_mitte(vor, nach, el["mitte"], el["r"])
                if m is not None:
                    el["mitte"] = m
    return els


def _schnitt_gerade_gerade(p1, d1, p2, d2):
    det = d1[0] * (-d2[1]) - d1[1] * (-d2[0])
    if abs(det) < math.sin(math.radians(2)):
        return []
    rhs = p2 - p1
    t = (rhs[0] * (-d2[1]) - rhs[1] * (-d2[0])) / det
    return [p1 + t * d1]


def _schnitt_gerade_kreis(p, d, m, r):
    f = p - m
    b = f @ d
    c = f @ f - r * r
    disk = b * b - c
    if disk < 0:
        return []
    w = math.sqrt(disk)
    return [p + (-b - w) * d, p + (-b + w) * d]


def _schnitt_kreis_kreis(m1, r1, m2, r2):
    dv = m2 - m1
    dist = np.linalg.norm(dv)
    if dist < 1e-12 or dist > r1 + r2 or dist < abs(r1 - r2):
        return []
    a = (r1 * r1 - r2 * r2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(r1 * r1 - a * a, 0))
    mpt = m1 + a * dv / dist
    nrm = np.array([-dv[1], dv[0]]) / dist
    return [mpt + h * nrm, mpt - h * nrm]


def _auf_element(el, q):
    if el["typ"] == "linie":
        return el["p"] + ((q - el["p"]) @ el["d"]) * el["d"]
    v = q - el["mitte"]
    n = np.linalg.norm(v)
    return el["mitte"] + (v / n if n > 1e-12 else np.array([1.0, 0])) * el["r"]


def _tangential(A, B, tol):
    """Tangentialer Uebergang -> Beruehrpunkt, sonst None."""
    if A["typ"] == "linie" and B["typ"] == "linie":
        return None
    if A["typ"] != "linie" and B["typ"] != "linie":
        dv = B["mitte"] - A["mitte"]
        d = np.linalg.norm(dv)
        if d < 1e-12:
            return None
        e = dv / d
        if abs(d - (A["r"] + B["r"])) <= 3 * tol:          # aussen beruehrend
            return A["mitte"] + e * A["r"]
        if abs(d - abs(A["r"] - B["r"])) <= 3 * tol:       # innen beruehrend
            gross = A if A["r"] >= B["r"] else B
            klein = B if gross is A else A
            return gross["mitte"] + (klein["mitte"] - gross["mitte"]) / d * gross["r"]
        return None
    L, K = (A, B) if A["typ"] == "linie" else (B, A)
    f = L["p"] + ((K["mitte"] - L["p"]) @ L["d"]) * L["d"]
    if abs(np.linalg.norm(K["mitte"] - f) - K["r"]) <= 3 * tol:
        return f
    return None


def _anschluss(A, B, q, max_weg, tol=0.0):
    """Gemeinsamer Punkt von A (Ende) und B (Anfang) nahe q."""
    t = _tangential(A, B, tol) if tol > 0 else None
    if t is not None and np.linalg.norm(t - q) <= max_weg:
        return t, True
    if A["typ"] == "linie" and B["typ"] == "linie":
        kand = _schnitt_gerade_gerade(A["p"], A["d"], B["p"], B["d"])
    elif A["typ"] == "linie":
        kand = _schnitt_gerade_kreis(A["p"], A["d"], B["mitte"], B["r"])
    elif B["typ"] == "linie":
        kand = _schnitt_gerade_kreis(B["p"], B["d"], A["mitte"], A["r"])
    else:
        kand = _schnitt_kreis_kreis(A["mitte"], A["r"], B["mitte"], B["r"])
    if kand:
        k = min(kand, key=lambda x: np.linalg.norm(x - q))
        if np.linalg.norm(k - q) <= max_weg:
            return k, True
    # kein (naher) Schnittpunkt, z. B. tangentialer Uebergang: Mitte der beiden Fusspunkte
    return 0.5 * (_auf_element(A, q) + _auf_element(B, q)), False


def verbinden(els, geschlossen, tol):
    """Endpunkte a/b je Element setzen; bei geschlossener Kette auch letztes->erstes."""
    if len(els) == 1 and els[0]["typ"] == "kreis":
        return els
    n = len(els)
    max_weg = max(20 * tol, 0.5)
    for k in range(n - 1 + (1 if geschlossen else 0)):
        A, B = els[k], els[(k + 1) % n]
        q = 0.5 * (A["ende"] + B["start"])
        p, _ = _anschluss(A, B, q, max_weg, tol)
        A["b"], B["a"] = p, p
    if not geschlossen:
        els[0]["a"] = _auf_element(els[0], els[0]["start"])
        els[-1]["b"] = _auf_element(els[-1], els[-1]["ende"])
    for el in els:
        if el["typ"] == "bogen":
            el["m"] = _auf_element(el, el["ref"])
    return els


# --- Gesamtablauf ------------------------------------------------------------------------------------------
def skizze_rechnen(linien, zu, tol=0.1, luecke=0.0, achsen_grad=1.0, radien=True, min_laenge=0.0):
    linien, zu = ketten_verbinden(linien, zu, luecke)
    ketten = []
    for L, z in zip(linien, zu):
        if len(L) < 3:
            continue
        umfang = float(np.linalg.norm(np.diff(L, axis=0), axis=1).sum())
        if umfang < max(min_laenge, 4 * tol):
            continue
        erg = einpassen(L, z, tol)
        if isinstance(erg, list):           # Vollkreis
            els, L2 = erg, L
        else:
            els, L2 = erg
        einrasten(els, achsen_grad, radien, bool(z), tol)
        if els[0]["typ"] != "kreis":
            verbinden(els, z, tol)
        ketten.append({"geschlossen": bool(z or els[0]["typ"] == "kreis"), "elemente": els,
                       "punkte": L})
    return ketten


def element_json(el):
    aus = {"typ": el["typ"]}
    for k in ("a", "b", "m", "mitte", "p", "d"):
        if k in el:
            aus[k] = [round(float(x), 6) for x in el[k]]
    if "r" in el:
        aus["r"] = round(float(el["r"]), 6)
    if "rms" in el:
        aus["rms"] = round(float(el["rms"]), 5)
    for k in ("achse", "nenn"):
        if k in el:
            aus[k] = el[k]
    return aus


def element_lesen(d):
    el = dict(d)
    for k in ("a", "b", "m", "mitte", "p", "d"):
        if k in el:
            el[k] = np.asarray(el[k], float)
    return el


def kette_text(el):
    if el["typ"] == "linie":
        return "Linie %.2f mm" % np.linalg.norm(np.asarray(el["b"]) - np.asarray(el["a"]))
    if el["typ"] == "kreis":
        return "Kreis Ø %.3g" % (2 * el["r"])
    return "Bogen R %.3g" % el["r"]


def diskret(el, schritt_grad=5.0):
    """Element -> 2D-Punktfolge (Anzeige, Flaeche, Innen-Test)."""
    if el["typ"] == "linie":
        return np.array([el["a"], el["b"]], float)
    m, r = np.asarray(el["mitte"], float), float(el["r"])
    if el["typ"] == "kreis":
        w = np.linspace(0, 2 * math.pi, int(360 / schritt_grad) + 1)
        return m + r * np.c_[np.cos(w), np.sin(w)]
    w0, wm, w1 = (math.atan2(p[1] - m[1], p[0] - m[0]) for p in (el["a"], el["m"], el["b"]))
    # Richtung so waehlen, dass wm zwischen w0 und w1 liegt
    def ccw(a, b):
        return (b - a) % (2 * math.pi)
    if ccw(w0, wm) <= ccw(w0, w1):
        spanne = ccw(w0, w1)
    else:
        spanne = -ccw(w1, w0)
    k = max(2, int(abs(math.degrees(spanne)) / schritt_grad) + 1)
    w = w0 + np.linspace(0, spanne, k)
    pts = m + r * np.c_[np.cos(w), np.sin(w)]
    pts[0], pts[-1] = el["a"], el["b"]
    return pts


def kette_polygon(kette):
    teile = [diskret(el) for el in kette["elemente"]]
    return np.concatenate([t[:-1] if i < len(teile) - 1 else t for i, t in enumerate(teile)])


def flaeche(poly):
    x, y = poly[:, 0], poly[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def innen(poly, q):
    """Punkt(e) q (k,2) im Polygon? (Strahl-Paritaet)"""
    q = np.atleast_2d(q)
    x, y = poly[:, 0], poly[:, 1]
    x2, y2 = np.roll(x, -1), np.roll(y, -1)
    drin = np.zeros(len(q), bool)
    for i in range(len(poly)):
        kreuzt = ((y[i] > q[:, 1]) != (y2[i] > q[:, 1]))
        with np.errstate(divide="ignore", invalid="ignore"):
            xs = x[i] + (q[:, 1] - y[i]) * (x2[i] - x[i]) / (y2[i] - y[i])
        drin ^= kreuzt & (q[:, 0] < xs)
    return drin


def abweichung_schnitt(ketten):
    """Abstand der Schnittpunkte zu den eingepassten Elementen ihrer Kette (fuer F2)."""
    werte = []
    for k in ketten:
        P = k["punkte"]
        poly = kette_polygon(k)
        seg_a, seg_b = poly[:-1], poly[1:]
        ab = seg_b - seg_a
        lang2 = np.maximum((ab * ab).sum(1), 1e-18)
        best = np.full(len(P), np.inf)
        for s in range(0, len(seg_a), 256):
            A, AB, L2 = seg_a[s:s + 256], ab[s:s + 256], lang2[s:s + 256]
            t = np.clip(((P[:, None, :] - A[None]) * AB[None]).sum(2) / L2[None], 0, 1)
            d = np.linalg.norm(P[:, None, :] - (A[None] + t[..., None] * AB[None]), axis=2)
            best = np.minimum(best, d.min(1))
        werte.append(best)
    return werte


# --- Bearbeiten (JSON-Form, wie im Projekt gespeichert) ---------------------------------------------------
def _nachbarn(kette, i):
    n = len(kette["elemente"])
    zu = kette["geschlossen"]
    vor = (i - 1) % n if (zu or i > 0) and n > 1 else None
    nach = (i + 1) % n if (zu or i < n - 1) and n > 1 else None
    return vor, nach


def element_entfernen(kette, i):
    """Element durch eine gerade Verbindung seiner Endpunkte ersetzen (Kontur bleibt zu).
    Ein Vollkreis oder ein Endelement einer offenen Kette faellt ganz weg.
    -> neue Kette oder None (Kette leer)."""
    els = [dict(e) for e in kette["elemente"]]
    el = els[i]
    if el["typ"] == "kreis":
        return None
    vor, nach = _nachbarn(kette, i)
    if not kette["geschlossen"] and (vor is None or nach is None):
        del els[i]
        return dict(kette, elemente=els) if els else None
    a, b = np.asarray(el["a"], float), np.asarray(el["b"], float)
    d = b - a
    lang = np.linalg.norm(d)
    if lang < 1e-6:
        del els[i]
        if vor is not None and nach is not None:
            els_neu = dict(kette, elemente=els)
            return els_neu
        return dict(kette, elemente=els)
    linie = {"typ": "linie", "a": list(map(float, a)), "b": list(map(float, b)),
             "p": list(map(float, a)), "d": list(map(float, d / lang)), "ersetzt": True}
    els[i] = linie
    # zwei Linien hintereinander, die fast fluchten, zusammenfassen
    return dict(kette, elemente=els)


def radius_setzen(kette, i, r, tol=0.05):
    """Radius eines Bogens/Kreises aendern; Anschluesse an die Nachbarn neu schneiden."""
    if r <= 0:
        raise ValueError("Radius muss größer 0 sein.")
    els = [element_lesen(e) for e in kette["elemente"]]
    el = els[i]
    if el["typ"] not in ("bogen", "kreis"):
        raise ValueError("Nur Bögen und Kreise haben einen Radius.")
    r_alt = float(el["r"])
    el["r"] = float(r)
    el["nenn"] = False
    if el["typ"] == "bogen":
        vor, nach = _nachbarn(kette, i)
        # Rundung zwischen zwei Geraden: Mittelpunkt so verschieben, dass der Bogen
        # tangential bleibt (wie ein CAD-Fillet), sonst bleibt der Mittelpunkt stehen
        if vor is not None and nach is not None and els[vor]["typ"] == "linie" and els[nach]["typ"] == "linie":
            m = el["mitte"]
            versetzt = []
            for L in (els[vor], els[nach]):
                nrm = np.array([-L["d"][1], L["d"][0]])
                seite = np.sign((m - L["p"]) @ nrm) or 1.0
                if abs(abs((m - L["p"]) @ nrm) - r_alt) > max(3 * tol, 0.05 * r_alt):
                    versetzt = None
                    break
                versetzt.append((L["p"] + seite * nrm * float(r), L["d"]))
            if versetzt:
                kand = _schnitt_gerade_gerade(versetzt[0][0], versetzt[0][1], versetzt[1][0], versetzt[1][1])
                if kand:
                    el["mitte"] = kand[0]
                    el["m"] = el["mitte"] + (el["m"] - m) / max(np.linalg.norm(el["m"] - m), 1e-12) * float(r)
        weit = max(20 * tol, 0.5, 0.5 * r)
        if vor is not None:
            p, _ = _anschluss(els[vor], el, el["a"], weit, tol)
            els[vor]["b"] = el["a"] = p
        else:
            el["a"] = _auf_element(el, el["a"])
        if nach is not None:
            p, _ = _anschluss(el, els[nach], el["b"], weit, tol)
            el["b"] = els[nach]["a"] = p
        else:
            el["b"] = _auf_element(el, el["b"])
        el["m"] = _auf_element(el, el["m"])
        for k in (vor, nach):
            if k is not None and els[k]["typ"] == "bogen":
                els[k]["m"] = _auf_element(els[k], els[k]["m"])
    return dict(kette, elemente=[element_json(e) for e in els])


def skizze_json(ketten, E, info=None):
    """Ergebnis von skizze_rechnen -> speicherbare Form."""
    aus = {"ebene": ebene_json(E), "ketten": [], "schnitt": []}
    for k in ketten:
        aus["ketten"].append({"geschlossen": k["geschlossen"],
                              "elemente": [element_json(e) for e in k["elemente"]]})
        P = np.asarray(k["punkte"])
        if len(P) > 4000:
            P = P[np.linspace(0, len(P) - 1, 4000).astype(int)]
        aus["schnitt"].append(np.round(P, 4).tolist())
    if info:
        aus["info"] = info
    return aus


def schnitt_abweichung(skz):
    """Je Kette die Abstaende der gespeicherten Schnittpunkte zur Kontur (F2: Skizze <-> Schnitt)."""
    ketten = []
    for k, P in zip(skz["ketten"], skz.get("schnitt", [])):
        if not k["elemente"]:
            ketten.append(None)
            continue
        ketten.append({"elemente": [element_lesen(e) for e in k["elemente"]], "punkte": np.asarray(P, float)})
    gueltig = [k for k in ketten if k is not None]
    werte = abweichung_schnitt(gueltig) if gueltig else []
    aus, it = [], iter(werte)
    for k in ketten:
        aus.append(None if k is None else next(it))
    return aus
