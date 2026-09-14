# Grundformen in Messpunkte einpassen: Ebene, Kugel, Zylinder, Kreis (2D).
#
# Alle Einpassungen sind robust gegen Ausreisser (mehrere Runden, Punkte mit
# grossem Restfehler fallen raus) und liefern den mittleren Restfehler (rms)
# mit - der zeigt, ob die Form ueberhaupt passt. Einheit mm.

import numpy as np


def _einheit(v):
    v = np.asarray(v, np.float64)
    return v / max(np.linalg.norm(v), 1e-300)


def _robust(pts, fit, rest, runden=3, grenze=2.5):
    """fit(pts) -> Modell; rest(modell, pts) -> Abstaende. Wirft pro Runde
    Punkte ueber grenze * Standardabweichung raus."""
    wahl = np.ones(len(pts), bool)
    modell = fit(pts)
    for _ in range(runden):
        d = np.abs(rest(modell, pts))
        s = max(np.sqrt(np.mean(d[wahl] ** 2)), 1e-12)
        neu = d <= grenze * s
        if neu.sum() < max(len(pts) * 0.5, 8) or np.array_equal(neu, wahl):
            break
        wahl = neu
        modell = fit(pts[wahl])
    d = rest(modell, pts)
    return modell, float(np.sqrt(np.mean(d[wahl] ** 2))), wahl


# --- Ebene -----------------------------------------------------------------------
def ebene(pts):
    """-> {punkt, normale, rms, anteil}"""
    pts = np.asarray(pts, np.float64)
    if len(pts) < 3:
        raise ValueError("Für eine Ebene braucht es mindestens 3 Punkte.")

    def fit(p):
        m = p.mean(0)
        _, _, vt = np.linalg.svd(p - m, full_matrices=False)
        return m, vt[2]

    def rest(mod, p):
        return (p - mod[0]) @ mod[1]

    (m, n), rms, wahl = _robust(pts, fit, rest)
    return {"art": "ebene", "punkt": m, "normale": _einheit(n), "rms": rms,
            "anteil": float(wahl.mean())}


# --- Kugel -----------------------------------------------------------------------
def kugel(pts):
    pts = np.asarray(pts, np.float64)
    if len(pts) < 4:
        raise ValueError("Für eine Kugel braucht es mindestens 4 Punkte.")

    def fit(p):
        # algebraisch: |p|^2 = 2 c.p + (r^2 - |c|^2)
        A = np.hstack([2 * p, np.ones((len(p), 1))])
        b = np.sum(p * p, axis=1)
        x, *_ = np.linalg.lstsq(A, b, rcond=None)
        c = x[:3]
        r = np.sqrt(max(x[3] + c @ c, 1e-12))
        # geometrisch nachziehen (Gauss-Newton)
        for _ in range(10):
            d = p - c
            abst = np.linalg.norm(d, axis=1)
            J = np.hstack([-d / np.maximum(abst, 1e-12)[:, None], -np.ones((len(p), 1))])
            res = abst - r
            dx, *_ = np.linalg.lstsq(J, -res, rcond=None)
            c, r = c + dx[:3], r + dx[3]
            if np.linalg.norm(dx) < 1e-10:
                break
        return c, abs(r)

    def rest(mod, p):
        return np.linalg.norm(p - mod[0], axis=1) - mod[1]

    (c, r), rms, wahl = _robust(pts, fit, rest)
    return {"art": "kugel", "mitte": c, "radius": float(r), "rms": rms, "anteil": float(wahl.mean())}


# --- Kreis in 2D -------------------------------------------------------------------
def kreis2d(p2):
    p2 = np.asarray(p2, np.float64)
    if len(p2) < 3:
        raise ValueError("Für einen Kreis braucht es mindestens 3 Punkte.")
    A = np.hstack([2 * p2, np.ones((len(p2), 1))])
    b = np.sum(p2 * p2, axis=1)
    x, *_ = np.linalg.lstsq(A, b, rcond=None)
    c = x[:2]
    r = np.sqrt(max(x[2] + c @ c, 1e-12))
    for _ in range(10):
        d = p2 - c
        abst = np.linalg.norm(d, axis=1)
        J = np.hstack([-d / np.maximum(abst, 1e-12)[:, None], -np.ones((len(p2), 1))])
        dx, *_ = np.linalg.lstsq(J, -(abst - r), rcond=None)
        c, r = c + dx[:2], r + dx[2]
        if np.linalg.norm(dx) < 1e-10:
            break
    rms = float(np.sqrt(np.mean((np.linalg.norm(p2 - c, axis=1) - abs(r)) ** 2)))
    return c, float(abs(r)), rms


def _basis(achse):
    a = _einheit(achse)
    hilf = np.array([1.0, 0, 0]) if abs(a[0]) < 0.9 else np.array([0, 1.0, 0])
    u = _einheit(np.cross(a, hilf))
    return u, np.cross(a, u)


# --- Zylinder -----------------------------------------------------------------------
def zylinder(pts, nrm=None):
    """-> {punkt (auf der Achse, Mitte der Hoehe), achse, radius, hoehe, rms}
    Startachse: aus den Normalen (die Achse steht senkrecht auf allen
    Normalen = kleinster Eigenvektor ihrer Kovarianz), sonst Hauptachse."""
    pts = np.asarray(pts, np.float64)
    if len(pts) < 6:
        raise ValueError("Für einen Zylinder braucht es mindestens 6 Punkte.")
    if nrm is not None and len(nrm) == len(pts):
        n = np.asarray(nrm, np.float64)
        _, vec = np.linalg.eigh(n.T @ n)
        start = vec[:, 0]
    else:
        m = pts.mean(0)
        _, _, vt = np.linalg.svd(pts - m, full_matrices=False)
        start = vt[0]

    def fit_mit_achse(p, achse):
        u, v = _basis(achse)
        p2 = np.stack([p @ u, p @ v], 1)
        c2, r, _ = kreis2d(p2)
        return c2[0] * u + c2[1] * v, _einheit(achse), r

    def fit(p):
        punkt, achse, r = fit_mit_achse(p, start)
        # Gauss-Newton ueber Achsrichtung (2 Winkel), Achspunkt (2), Radius
        for _ in range(25):
            u, v = _basis(achse)

            def residuen(par):
                a = _einheit(achse + par[0] * u + par[1] * v)
                q = punkt + par[2] * u + par[3] * v
                d = p - q
                senk = d - np.outer(d @ a, a)
                return np.linalg.norm(senk, axis=1) - (r + par[4])

            r0 = residuen(np.zeros(5))
            J = np.empty((len(p), 5))
            for k in range(5):
                e = np.zeros(5)
                e[k] = 1e-6 * max(r, 1.0)
                J[:, k] = (residuen(e) - r0) / e[k]
            dx, *_ = np.linalg.lstsq(J, -r0, rcond=None)
            achse = _einheit(achse + dx[0] * u + dx[1] * v)
            punkt = punkt + dx[2] * u + dx[3] * v
            r = r + dx[4]
            if np.linalg.norm(dx) < 1e-10 * max(r, 1):
                break
        # Achspunkt auf den Fusspunkt des Ursprungs normieren
        punkt = punkt - (punkt @ achse) * achse
        return punkt, achse, abs(r)

    def rest(mod, p):
        q, a, r = mod
        d = p - q
        return np.linalg.norm(d - np.outer(d @ a, a), axis=1) - r

    (q, a, r), rms, wahl = _robust(pts, fit, rest)
    t = (pts[wahl] - q) @ a
    mitte = q + a * (t.min() + t.max()) / 2
    return {"art": "zylinder", "punkt": mitte, "achse": a, "radius": float(r),
            "hoehe": float(t.max() - t.min()), "rms": rms, "anteil": float(wahl.mean())}


# --- Kegel ---------------------------------------------------------------------------
def _kegel_rest(p, c, a, r0, w):
    """Abstand zur Kegelflaeche; Parameter: Achspunkt c (nahe Datenmitte),
    Achse a, Radius r0 bei c, Halbwinkel w. Gut konditioniert auch bei
    flachen Kegeln (die Spitze liegt dann weit weg)."""
    d = p - c
    t = d @ a
    r = np.linalg.norm(d - np.outer(t, a), axis=1)
    return (r - (r0 + t * np.tan(w))) * np.cos(w)


def kegel(pts, nrm=None, start=None):
    """-> {spitze, achse (Richtung wachsender Radius), halbwinkel (rad), rms,
    r_min, r_max, hoehe, punkt (Achsmitte)}. start = (punkt, achse, r0, w)."""
    pts = np.asarray(pts, np.float64)
    if len(pts) < 8:
        raise ValueError("Für einen Kegel braucht es mindestens 8 Punkte.")
    m = pts.mean(0)

    def startwerte(achse):
        achse = _einheit(achse)
        u, v = _basis(achse)
        t = (pts - m) @ achse
        # Kreis je Scheibe waere genauer; linearer Ansatz reicht als Start
        p2 = np.stack([(pts - m) @ u, (pts - m) @ v], 1)
        c2, _, _ = kreis2d(p2)
        c = m + c2[0] * u + c2[1] * v
        d = pts - c
        tt = d @ achse
        rr = np.linalg.norm(d - np.outer(tt, achse), axis=1)
        steig, r0 = np.polyfit(tt, rr, 1)
        return c, achse, r0, np.arctan(steig)

    if start is not None:
        kandidaten = [(np.asarray(start[0], float), _einheit(start[1]), float(start[2]), float(start[3]))]
    else:
        richtungen = []
        if nrm is not None and len(nrm) == len(pts):
            n = np.asarray(nrm, np.float64)
            _, vec = np.linalg.eigh(np.cov(n.T))
            richtungen.append(vec[:, 0])
        _, _, vt = np.linalg.svd(pts - m, full_matrices=False)
        richtungen += list(vt)
        kandidaten = [startwerte(r) for r in richtungen]

    def gn(p, c, a, r0, w):
        for _ in range(40):
            u, v = _basis(a)

            def res(par):
                a2 = _einheit(a + par[0] * u + par[1] * v)
                return _kegel_rest(p, c + par[2] * u + par[3] * v, a2, r0 + par[4], w + par[5])

            f0 = res(np.zeros(6))
            J = np.empty((len(p), 6))
            skala = max(abs(r0), 1.0)
            for k in range(6):
                e = np.zeros(6)
                e[k] = 1e-6 * (skala if 2 <= k <= 4 else 1.0)
                J[:, k] = (res(e) - f0) / e[k]
            dx, *_ = np.linalg.lstsq(J, -f0, rcond=None)
            dx[5] = np.clip(dx[5], -0.2, 0.2)
            a = _einheit(a + dx[0] * u + dx[1] * v)
            c = c + dx[2] * u + dx[3] * v
            r0, w = r0 + dx[4], w + dx[5]
            if np.linalg.norm(dx) < 1e-10 * skala:
                break
        return c, a, r0, w

    bestes = None
    for k in kandidaten:
        try:
            mod = gn(pts, *k)
        except np.linalg.LinAlgError:
            continue
        f = np.sqrt(np.mean(_kegel_rest(pts, *mod) ** 2))
        if np.isfinite(f) and (bestes is None or f < bestes[0]):
            bestes = (f, mod)
    if bestes is None:
        raise ValueError("Kegel ließ sich nicht einpassen.")
    anfang = bestes[1]

    def fit(p):
        return gn(p, *anfang)

    def rest(mod, p):
        return _kegel_rest(p, *mod)

    (c, a, r0, w), rms, wahl = _robust(pts, fit, rest)
    if w < 0:                       # Achse so drehen, dass der Radius waechst
        a, w = -a, -w
    t = (pts[wahl] - c) @ a
    tw = np.tan(w)
    r_lo, r_hi = r0 + t.min() * tw, r0 + t.max() * tw
    mitte = c + a * (t.min() + t.max()) / 2
    spitze = c - a * (r0 / tw) if abs(tw) > 1e-9 else None
    return {"art": "kegel", "punkt": mitte, "achse": a, "halbwinkel": float(w), "rms": rms,
            "anteil": float(wahl.mean()), "r_min": float(r_lo), "r_max": float(r_hi),
            "hoehe": float(t.max() - t.min()),
            "spitze": spitze if spitze is not None else mitte}


def als_json(form):
    return {k: (v.round(6).tolist() if isinstance(v, np.ndarray) else
                round(v, 6) if isinstance(v, float) else v) for k, v in form.items()}
