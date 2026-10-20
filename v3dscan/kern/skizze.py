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


def gleichmaessig(L, geschlossen, schritt):
    """Polylinie nach Bogenlaenge gleichmaessig neu abtasten. Netzschnitte haben an geraden
    Waenden nur wenige, an Rundungen sehr viele Punkte - sonst taeuscht das die Punkt-Statistik."""
    L = np.asarray(L, float)
    P = np.r_[L, L[:1]] if geschlossen else L
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.r_[0, np.cumsum(seg)]
    if s[-1] <= 0:
        return L
    n = int(np.clip(s[-1] / schritt, 8, 6000))
    t = np.linspace(0, s[-1], n + 1)
    if geschlossen:
        t = t[:-1]
    return np.c_[np.interp(t, s, P[:, 0]), np.interp(t, s, P[:, 1])]


def einpassen(L, geschlossen, tol):
    """Polylinie -> Elemente (Parameterform, mit Indexbereich i..j in L)."""
    L = np.asarray(L, float)
    umfang = float(np.linalg.norm(np.diff(np.r_[L, L[:1]] if geschlossen else L, axis=0), axis=1).sum())
    L = gleichmaessig(L, geschlossen, max(min(2 * tol, umfang / 200), umfang / 6000))
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
    if "pole" in el:
        aus["pole"] = [[round(float(x), 6) for x in q] for q in el["pole"]]
    if "rms" in el:
        aus["rms"] = round(float(el["rms"]), 5)
    for k in ("achse", "nenn"):
        if k in el:
            aus[k] = el[k]
    return aus


def element_lesen(d):
    el = dict(d)
    for k in ("a", "b", "m", "mitte", "p", "d", "pole"):
        if k in el:
            el[k] = np.asarray(el[k], float)
    return el


def kette_text(el):
    if el["typ"] == "spline":
        return "Spline (%d Pole)" % len(el["pole"])
    if el["typ"] == "linie":
        return "Linie %.2f mm" % np.linalg.norm(np.asarray(el["b"]) - np.asarray(el["a"]))
    if el["typ"] == "kreis":
        return "Kreis Ø %.3g" % (2 * el["r"])
    return "Bogen R %.3g" % el["r"]


def diskret(el, schritt_grad=5.0):
    """Element -> 2D-Punktfolge (Anzeige, Flaeche, Innen-Test)."""
    if el["typ"] == "linie":
        return np.array([el["a"], el["b"]], float)
    if el["typ"] == "spline":
        return spline_auswerten(el["pole"])
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
    schnitte = list(skz.get("schnitt", [])) + [[]] * max(0, len(skz["ketten"]) - len(skz.get("schnitt", [])))
    for k, P in zip(skz["ketten"], schnitte):
        if not k["elemente"] or len(P) < 2:          # gezeichnete Kontur: kein Schnitt zum Vergleichen
            ketten.append(None)
            continue
        ketten.append({"elemente": [element_lesen(e) for e in k["elemente"]], "punkte": np.asarray(P, float)})
    gueltig = [k for k in ketten if k is not None]
    werte = abweichung_schnitt(gueltig) if gueltig else []
    aus, it = [], iter(werte)
    for k in ketten:
        aus.append(None if k is None else next(it))
    return aus


# === Skizzen-Editor (v1.0): Zeichnen, Spline, Versatz, Spiegeln, Kopieren, Ecken, Bedingungen, Umriss, DXF ===
def _lin(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = b - a
    n = np.linalg.norm(d)
    return {"typ": "linie", "a": a, "b": b, "p": a.copy(), "d": d / n if n > 1e-12 else np.array([1.0, 0])}


def _kreis_3p(a, m, b):
    a, m, b = (np.asarray(x, float) for x in (a, m, b))
    k = _kreis_fit(np.array([a, m, b]))
    if k is None:
        raise ValueError("Die drei Punkte liegen auf einer Linie.")
    return k[0], k[1]


def zeichnen(art, punkte, wert=None):
    """Neue Kette aus Klickpunkten (2D). art: linie (2 P.), polylinie (n P.), kreis (Mitte + Randpunkt
    oder wert=r), kreis3 (3 P.), bogen (Start, Zwischen-, Endpunkt), rechteck (2 Ecken), langloch (2 Mitten +
    wert=Breite), sechseck (Mitte + Eckpunkt). -> Kette (Parameterform)."""
    P = [np.asarray(p, float) for p in punkte]
    if art == "linie":
        return {"geschlossen": False, "elemente": [_lin(P[0], P[1])]}
    if art == "polylinie":
        zu = len(P) > 2 and np.linalg.norm(P[0] - P[-1]) < 1e-9
        if zu:
            P = P[:-1]
        els = [_lin(P[i], P[(i + 1) % len(P)]) for i in range(len(P) if zu else len(P) - 1)]
        return {"geschlossen": bool(zu), "elemente": els}
    if art == "kreis":
        r = float(wert) if wert else float(np.linalg.norm(P[1] - P[0]))
        return {"geschlossen": True, "elemente": [{"typ": "kreis", "mitte": P[0], "r": r}]}
    if art == "kreis3":
        m, r = _kreis_3p(*P[:3])
        return {"geschlossen": True, "elemente": [{"typ": "kreis", "mitte": m, "r": r}]}
    if art == "bogen":
        m, r = _kreis_3p(*P[:3])
        return {"geschlossen": False, "elemente": [{"typ": "bogen", "a": P[0], "m": P[1], "b": P[2], "mitte": m, "r": r}]}
    if art == "rechteck":
        (x0, y0), (x1, y1) = P[0], P[1]
        e = [np.array(p) for p in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
        return {"geschlossen": True, "elemente": [_lin(e[i], e[(i + 1) % 4]) for i in range(4)]}
    if art == "langloch":
        a, b = P[0], P[1]
        r = float(wert) / 2 if wert else 0.25 * float(np.linalg.norm(b - a))
        d = (b - a) / max(np.linalg.norm(b - a), 1e-12)
        n = np.array([-d[1], d[0]])
        return {"geschlossen": True, "elemente": [
            _lin(a + n * r, b + n * r),
            {"typ": "bogen", "a": b + n * r, "m": b + d * r, "b": b - n * r, "mitte": b, "r": r},
            _lin(b - n * r, a - n * r),
            {"typ": "bogen", "a": a - n * r, "m": a - d * r, "b": a + n * r, "mitte": a, "r": r}]}
    if art == "sechseck":
        m, e = P[0], P[1]
        r = float(np.linalg.norm(e - m))
        w0 = math.atan2(e[1] - m[1], e[0] - m[0])
        ecken = [m + r * np.array([math.cos(w0 + k * math.pi / 3), math.sin(w0 + k * math.pi / 3)]) for k in range(6)]
        return {"geschlossen": True, "elemente": [_lin(ecken[k], ecken[(k + 1) % 6]) for k in range(6)]}
    raise ValueError("Unbekannte Zeichenart „%s“." % art)


def kette_json(k):
    return {"geschlossen": bool(k["geschlossen"]), "elemente": [element_json(e) for e in k["elemente"]]}


# --- Spline (Freiformkurve) ---------------------------------------------------------------------------
def _bspline_basis(t, m, p=3):
    k = np.r_[[0.0] * p, np.linspace(0, 1, m - p + 1), [1.0] * p]
    t = np.clip(np.asarray(t, float), 0, 1 - 1e-12)
    N = np.zeros((len(t), len(k) - 1))
    for i in range(len(k) - 1):
        N[:, i] = (k[i] <= t) & (t < k[i + 1])
    for q in range(1, p + 1):
        neu = np.zeros((len(t), len(k) - 1 - q))
        for i in range(len(k) - 1 - q):
            a, b = k[i + q] - k[i], k[i + q + 1] - k[i + 1]
            if a > 0:
                neu[:, i] += (t - k[i]) / a * N[:, i]
            if b > 0:
                neu[:, i] += (k[i + q + 1] - t) / b * N[:, i + 1]
        N = neu
    return N[:, :m]


def spline_auswerten(pole, n=80):
    pole = np.asarray(pole, float)
    t = np.linspace(0, 1, n)
    P = _bspline_basis(t, len(pole)) @ pole
    P[0], P[-1] = pole[0], pole[-1]
    return P


def spline_fit(P, tol=0.05, max_pole=40):
    """Punktfolge -> kubischer B-Spline (Enden fest), so wenige Pole wie fuer tol noetig
    (QuickSurface "Approximate within")."""
    P = np.asarray(P, float)
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    t = s / max(s[-1], 1e-12)
    for m in range(4, max_pole + 1):
        B = _bspline_basis(t, m)
        rest = P - np.outer(B[:, 0], P[0]) - np.outer(B[:, -1], P[-1])
        innen = np.linalg.lstsq(B[:, 1:-1], rest, rcond=None)[0]
        pole = np.r_[P[:1], innen, P[-1:]]
        fehler = np.linalg.norm(B @ pole - P, axis=1)
        if np.percentile(fehler, 98) <= tol:
            break
    return {"typ": "spline", "pole": pole, "a": P[0], "b": P[-1], "rms": float(np.sqrt(np.mean(fehler ** 2)))}


def spline_aus_schnitt(kette, punkte, i, j, tol=0.05):
    """Elemente i..j einer Kette durch EINEN Spline ersetzen, eingepasst auf die Schnittpunkte
    zwischen Anfang von i und Ende von j."""
    els = [element_lesen(e) for e in kette["elemente"]]
    P = np.asarray(punkte, float)
    a, b = np.asarray(els[i]["a"]), np.asarray(els[j]["b"])
    ia = int(np.argmin(np.linalg.norm(P - a, axis=1)))
    ib = int(np.argmin(np.linalg.norm(P - b, axis=1)))
    if kette["geschlossen"] and ib < ia:
        Q = np.r_[P[ia:], P[:ib + 1]]
    else:
        Q = P[min(ia, ib):max(ia, ib) + 1]
        if ia > ib:
            Q = Q[::-1]
    if len(Q) < 4:
        raise ValueError("Zu wenige Schnittpunkte für einen Spline in diesem Bereich.")
    Q = np.r_[[a], Q[1:-1], [b]]
    sp = spline_fit(Q, tol)
    neu = els[:i] + [sp] + els[j + 1:]
    return {"geschlossen": kette["geschlossen"], "elemente": [element_json(e) for e in neu]}


# --- Versatz, Spiegeln, Kopieren -----------------------------------------------------------------------
def _flaeche_kette(els):
    poly = kette_polygon({"elemente": els})
    return flaeche(poly)


def versatz(kette, abstand, ecke="bogen"):
    """Kette (Linien/Boegen/Kreise) um abstand versetzen (+ = nach aussen bei geschlossener Kette,
    sonst nach links). ecke: 'bogen' (runde Ecken aussen) oder 'schnitt' (verlaengert)."""
    els = [element_lesen(e) for e in kette["elemente"]]
    if any(e["typ"] == "spline" for e in els):
        raise ValueError("Versatz von Splines ist (noch) nicht möglich.")
    if len(els) == 1 and els[0]["typ"] == "kreis":
        r = els[0]["r"] + abstand
        if r <= 0:
            raise ValueError("Versatz macht den Kreis zu klein.")
        return {"geschlossen": True, "elemente": [element_json({"typ": "kreis", "mitte": els[0]["mitte"], "r": r})]}
    vz = 1.0
    if kette["geschlossen"]:
        vz = -1.0 if _flaeche_kette(els) > 0 else 1.0      # gegen den Uhrzeigersinn: aussen = rechts
    neu = []
    for e in els:
        if e["typ"] == "linie":
            d = (e["b"] - e["a"]) / max(np.linalg.norm(e["b"] - e["a"]), 1e-12)
            nrm = np.array([-d[1], d[0]]) * vz * abstand
            neu.append(dict(_lin(e["a"] + nrm, e["b"] + nrm)))
        else:
            # Bogen: Richtung von a nach b bestimmt, ob er links- oder rechtsherum laeuft
            m = e["mitte"]
            # Versatz nach links um s = vz·abstand: liegt der Mittelpunkt links der Laufrichtung
            # (am Bogenpunkt m), wird der Radius kleiner, sonst groesser
            tang = e["b"] - e["a"] if np.linalg.norm(e["b"] - e["a"]) > 1e-9 else np.array([1.0, 0])
            links_n = np.array([-tang[1], tang[0]])
            mitte_links = (m - e["m"]) @ links_n > 0
            s_ = vz * abstand
            r = e["r"] - s_ if mitte_links else e["r"] + s_
            if r <= 0:
                raise ValueError("Versatz macht einen Bogen zu klein (R %.2f)." % e["r"])
            f = r / e["r"]
            neu.append({"typ": "bogen", "mitte": m, "r": r, "a": m + (e["a"] - m) * f, "m": m + (e["m"] - m) * f,
                        "b": m + (e["b"] - m) * f})
    # Anschluesse neu
    aus = []
    n = len(neu)
    for k in range(n):
        aus.append(neu[k])
        if k == n - 1 and not kette["geschlossen"]:
            break
        A, B = neu[k], neu[(k + 1) % n]
        if np.linalg.norm(A["b"] - B["a"]) < 1e-7:
            continue
        if ecke == "bogen" and abstand * 1 != 0:
            # Ecke rund: Bogen um den alten Eckpunkt mit Radius |abstand|
            mitte = els[k]["b"] if np.linalg.norm(els[k]["b"] - els[(k + 1) % n]["a"]) < 1e-6 else els[k]["b"]
            q = A["b"] - mitte
            w = B["a"] - mitte
            mid = q + w
            mid = mitte + mid / max(np.linalg.norm(mid), 1e-12) * abs(abstand)
            # nur wenn die Elemente auseinanderlaufen (konvexe Ecke)
            S_ = _schnitt_gerade_gerade(A.get("p", A["a"]), A.get("d", np.array([1.0, 0])), B.get("p", B["a"]), B.get("d", np.array([1.0, 0]))) if A["typ"] == B["typ"] == "linie" else []
            if S_ and ((S_[0] - A["b"]) @ (A["b"] - A["a"]) < 0):
                p_ = S_[0]
                A["b"] = p_
                B["a"] = p_
                B["p"] = p_
                continue
            aus.append({"typ": "bogen", "a": A["b"].copy(), "m": mid, "b": B["a"].copy(), "mitte": mitte, "r": abs(abstand)})
        else:
            p_, _ = _anschluss(A, B, 0.5 * (A["b"] + B["a"]), 1e9, 0)
            A["b"] = p_
            B["a"] = p_
            if B["typ"] == "linie":
                B["p"] = p_
    if kette["geschlossen"] and ecke != "bogen":
        A, B = aus[-1], aus[0]
    for e in aus:
        if e["typ"] == "linie":
            d = e["b"] - e["a"]
            e["d"] = d / max(np.linalg.norm(d), 1e-12)
            e["p"] = e["a"]
        elif e["typ"] == "bogen":
            e["m"] = _auf_element(e, e["m"])
    return {"geschlossen": kette["geschlossen"], "elemente": [element_json(e) for e in aus]}


def _abbilden(kette, f, spiegelt=False):
    els = [element_lesen(e) for e in kette["elemente"]]
    neu = []
    for e in els:
        e2 = dict(e)
        for k in ("a", "b", "m", "mitte"):
            if k in e2:
                e2[k] = f(e2[k])
        if "pole" in e2:
            e2["pole"] = np.array([f(p) for p in e2["pole"]])
        if e2["typ"] == "linie":
            e2 = _lin(e2["a"], e2["b"])
        neu.append(e2)
    if spiegelt:                       # Umlaufsinn bleibt erhalten
        neu = [dict(e, a=e["b"], b=e["a"], **({"pole": e["pole"][::-1]} if "pole" in e else {})) for e in neu[::-1]]
        neu = [_lin(e["a"], e["b"]) if e["typ"] == "linie" else e for e in neu]
    return {"geschlossen": kette["geschlossen"], "elemente": [element_json(e) for e in neu]}


def spiegeln_2d(kette, p, d):
    """An der Geraden (Punkt p, Richtung d) spiegeln."""
    p, d = np.asarray(p, float), np.asarray(d, float) / np.linalg.norm(d)

    def f(x):
        x = np.asarray(x, float)
        q = x - p
        return p + 2 * (q @ d) * d - q
    return _abbilden(kette, f, spiegelt=True)


def kopieren(kette, art="linear", anzahl=2, schritt=(10, 0), anzahl2=1, schritt2=(0, 10), mitte=(0, 0), winkel=360.0):
    """Kopien (ohne Original): linear, raster (anzahl × anzahl2) oder kreis (um mitte, Winkel verteilt)."""
    aus = []
    if art in ("linear", "raster"):
        for i in range(int(anzahl)):
            for j in range(int(anzahl2) if art == "raster" else 1):
                if i == 0 and j == 0:
                    continue
                v = np.asarray(schritt, float) * i + np.asarray(schritt2, float) * j
                aus.append(_abbilden(kette, lambda x, v=v: np.asarray(x, float) + v))
    elif art == "kreis":
        voll = abs(float(winkel) - 360) < 1e-6
        n = int(anzahl)
        for i in range(1, n):
            w = math.radians(float(winkel) * i / (n if voll else max(n - 1, 1)))
            R = np.array([[math.cos(w), -math.sin(w)], [math.sin(w), math.cos(w)]])
            c = np.asarray(mitte, float)
            aus.append(_abbilden(kette, lambda x, R=R, c=c: c + R @ (np.asarray(x, float) - c)))
    else:
        raise ValueError("Unbekannte Kopierart „%s“." % art)
    return aus


# --- Ecke runden, Bedingungen, Masse ----------------------------------------------------------------------
def ecke_runden(kette, i, r):
    """Zwischen Element i (Linie) und dem naechsten (Linie) einen Tangentenbogen mit Radius r einfuegen."""
    els = [element_lesen(e) for e in kette["elemente"]]
    n = len(els)
    j = (i + 1) % n
    if not kette["geschlossen"] and i == n - 1:
        raise ValueError("Am Kettenende gibt es keine Ecke.")
    A, B = els[i], els[j]
    if A["typ"] != "linie" or B["typ"] != "linie":
        raise ValueError("Ecken runden geht zwischen zwei Linien.")
    m = _rundung_mitte(A, B, A["b"] - 1e-3 * (A["d"] - B["d"]), float(r))
    # Seite: Mittelpunkt muss innerhalb des Winkels liegen
    ecke = A["b"]
    w = (A["a"] - ecke) / max(np.linalg.norm(A["a"] - ecke), 1e-12) + (B["b"] - ecke) / max(np.linalg.norm(B["b"] - ecke), 1e-12)
    kand = []
    for sa in (1, -1):
        for sb in (1, -1):
            nA = np.array([-A["d"][1], A["d"][0]]) * sa
            nB = np.array([-B["d"][1], B["d"][0]]) * sb
            s_ = _schnitt_gerade_gerade(A["p"] + nA * r, A["d"], B["p"] + nB * r, B["d"])
            if s_:
                kand.append(s_[0])
    m = max(kand, key=lambda c: (c - ecke) @ w)
    ta = A["p"] + ((m - A["p"]) @ A["d"]) * A["d"]
    tb = B["p"] + ((m - B["p"]) @ B["d"]) * B["d"]
    if np.linalg.norm(ta - A["a"]) > np.linalg.norm(A["b"] - A["a"]) or np.linalg.norm(tb - B["b"]) > np.linalg.norm(B["b"] - B["a"]):
        raise ValueError("Radius %s ist für diese Ecke zu groß." % r)
    mid = m + (ecke - m) / max(np.linalg.norm(ecke - m), 1e-12) * r
    A["b"] = ta
    B["a"] = tb
    B["p"] = tb
    bogen = {"typ": "bogen", "a": ta, "m": mid, "b": tb, "mitte": m, "r": float(r)}
    neu = els[:i + 1] + [bogen] + els[i + 1:] if j != 0 else els + [bogen]
    if j == 0:
        neu[0] = B
    return {"geschlossen": kette["geschlossen"], "elemente": [element_json(e) for e in neu]}


def _neu_anschliessen(els, geschlossen, idx):
    """Nach Aenderung von Element idx die Anschlusspunkte zu beiden Nachbarn neu schneiden."""
    n = len(els)
    for k in ((idx - 1) % n, idx):
        if not geschlossen and (k < 0 or k >= n - 1) and not (k == idx - 1 and idx > 0):
            continue
        if not geschlossen and k == n - 1:
            continue
        A, B = els[k], els[(k + 1) % n]
        p_, _ = _anschluss(A, B, 0.5 * (A["b"] + B["a"]), 1e9, 0)
        A["b"] = p_
        B["a"] = p_
        for e in (A, B):
            if e["typ"] == "linie":
                d = e["b"] - e["a"]
                if np.linalg.norm(d) > 1e-12 and d @ e["d"] < 0:
                    pass
                e["p"] = e["a"]
            elif e["typ"] == "bogen":
                e["m"] = _auf_element(e, e["m"])
    return els


def bedingung(kette, i, art, bezug=None):
    """Linie i: waagrecht | senkrecht | parallel / rechtwinklig zu Linie bezug (Index in derselben Kette).
    Gedreht wird um die Linienmitte, die Nachbarn schliessen neu an."""
    els = [element_lesen(e) for e in kette["elemente"]]
    e = els[i]
    if e["typ"] != "linie":
        raise ValueError("Bedingungen gelten für Linien.")
    if art == "waagrecht":
        ziel = np.array([1.0, 0])
    elif art == "senkrecht":
        ziel = np.array([0, 1.0])
    elif art in ("parallel", "rechtwinklig"):
        if bezug is None or els[bezug]["typ"] != "linie":
            raise ValueError("Als Bezug eine andere Linie wählen.")
        ziel = els[bezug]["d"]
        if art == "rechtwinklig":
            ziel = np.array([-ziel[1], ziel[0]])
    else:
        raise ValueError("Unbekannte Bedingung „%s“." % art)
    if ziel @ e["d"] < 0:
        ziel = -ziel
    mitte = 0.5 * (e["a"] + e["b"])
    e["d"], e["p"] = ziel, mitte
    e["achse"] = art
    _neu_anschliessen(els, kette["geschlossen"], i)
    return {"geschlossen": kette["geschlossen"], "elemente": [element_json(x) for x in els]}


def abstand_setzen(kette, i, bezug, wert):
    """Linie i parallel so verschieben, dass sie wert mm von der (parallelen) Linie bezug entfernt ist."""
    els = [element_lesen(e) for e in kette["elemente"]]
    A, B = els[i], els[bezug]
    if A["typ"] != "linie" or B["typ"] != "linie":
        raise ValueError("Abstand zwischen zwei Linien.")
    if abs(A["d"] @ B["d"]) < math.cos(math.radians(2)):
        raise ValueError("Die Linien sind nicht parallel – erst die Bedingung „parallel“ setzen.")
    nrm = np.array([-B["d"][1], B["d"][0]])
    jetzt = (0.5 * (A["a"] + A["b"]) - B["p"]) @ nrm
    verschiebung = (math.copysign(float(wert), jetzt or 1.0) - jetzt) * nrm
    A["a"], A["b"], A["p"] = A["a"] + verschiebung, A["b"] + verschiebung, A["p"] + verschiebung
    _neu_anschliessen(els, kette["geschlossen"], i)
    return {"geschlossen": kette["geschlossen"], "elemente": [element_json(x) for x in els]}


# --- Netz-Umriss (Mesh Outline) ---------------------------------------------------------------------------
def umriss(xyz, E, zelle=None, tri=None):
    """Silhouette des ganzen Scans in der Ebene: Punkte projizieren (Netze vorher dicht abtasten -
    ebene Flaechen haben kaum Eckpunkte), Belegungsraster, Randkonturen, Treppe glaetten.
    -> (polylinien, geschlossen)."""
    xyz = np.asarray(xyz, float)
    if tri is not None and len(tri):
        from .o3d import o3d
        m = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(xyz), o3d.utility.Vector3iVector(np.asarray(tri, np.int32)))
        xyz = np.r_[xyz, np.asarray(m.sample_points_uniformly(min(800000, max(100000, 20 * len(tri)))).points)]
    q = zu2d(xyz, E)
    lo, hi = q.min(0), q.max(0)
    if zelle is None:
        zelle = max(float(np.max(hi - lo)) / 700, punktabstand(xyz) * 1.2)
    nx, ny = int((hi[0] - lo[0]) / zelle) + 7, int((hi[1] - lo[1]) / zelle) + 7
    ij = np.floor((q - lo) / zelle).astype(int) + 3
    G = np.zeros((nx, ny), bool)
    G[ij[:, 0], ij[:, 1]] = True
    # Luecken schliessen (Dilatation + Erosion) und innere Loecher fuellen bleibt erhalten
    def dil(A):
        B = A.copy()
        B[1:] |= A[:-1]; B[:-1] |= A[1:]; B[:, 1:] |= A[:, :-1]; B[:, :-1] |= A[:, 1:]
        return B
    G = ~dil(~dil(G))
    G[:2], G[-2:], G[:, :2], G[:, -2:] = False, False, False, False
    # Randkanten zwischen belegt/frei als Segmente, dann verketten
    seg = {}
    def add(a, b):
        seg.setdefault(a, []).append(b)
    xs, ys = np.nonzero(G)
    for i, j in zip(xs.tolist(), ys.tolist()):
        if not G[i, j - 1]:
            add((i, j), (i + 1, j))
        if not G[i + 1, j]:
            add((i + 1, j), (i + 1, j + 1))
        if not G[i, j + 1]:
            add((i + 1, j + 1), (i, j + 1))
        if not G[i - 1, j]:
            add((i, j + 1), (i, j))
    linien, zu = [], []
    while seg:
        start = next(iter(seg))
        weg = [start]
        cur = start
        while cur in seg:
            nxt = seg[cur].pop()
            if not seg[cur]:
                del seg[cur]
            weg.append(nxt)
            cur = nxt
            if cur == start:
                break
        if len(weg) > 8:
            P = (np.array(weg[:-1], float) - 3) * zelle + lo
            # Treppe glaetten (zyklisches gleitendes Mittel), Ecken bleiben bis auf ~1 Zelle erhalten
            for _ in range(3):
                P = (np.roll(P, 1, axis=0) + 2 * P + np.roll(P, -1, axis=0)) / 4
            linien.append(P)
            zu.append(True)
    return linien, zu


# --- DXF-Export ---------------------------------------------------------------------------------------------
def dxf(skz):
    """Skizze als DXF R12 (2D, mm): LINE, ARC, CIRCLE; Splines als POLYLINE."""
    z = ["0", "SECTION", "2", "ENTITIES"]

    def p(code, wert):
        z.extend([str(code), ("%.6f" % wert) if isinstance(wert, float) else str(wert)])
    for k in skz["ketten"]:
        for e in (element_lesen(x) for x in k["elemente"]):
            if e["typ"] == "linie":
                z.extend(["0", "LINE", "8", "0"])
                p(10, float(e["a"][0])); p(20, float(e["a"][1])); p(11, float(e["b"][0])); p(21, float(e["b"][1]))
            elif e["typ"] == "kreis":
                z.extend(["0", "CIRCLE", "8", "0"])
                p(10, float(e["mitte"][0])); p(20, float(e["mitte"][1])); p(40, float(e["r"]))
            elif e["typ"] == "bogen":
                m = e["mitte"]
                w = [math.degrees(math.atan2(q[1] - m[1], q[0] - m[0])) % 360 for q in (e["a"], e["m"], e["b"])]
                ccw = (w[1] - w[0]) % 360 <= (w[2] - w[0]) % 360
                s0, s1 = (w[0], w[2]) if ccw else (w[2], w[0])
                z.extend(["0", "ARC", "8", "0"])
                p(10, float(m[0])); p(20, float(m[1])); p(40, float(e["r"])); p(50, float(s0)); p(51, float(s1))
            else:
                P = diskret(e)
                z.extend(["0", "POLYLINE", "8", "0", "66", "1"])
                for q in P:
                    z.extend(["0", "VERTEX", "8", "0"])
                    p(10, float(q[0])); p(20, float(q[1]))
                z.extend(["0", "SEQEND"])
    z.extend(["0", "ENDSEC", "0", "EOF"])
    return "\n".join(z) + "\n"
