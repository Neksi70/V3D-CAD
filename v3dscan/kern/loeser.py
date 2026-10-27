# Eigener 2D-Bedingungs-Loeser fuer Skizzen (statt planegcs/SolveSpace: keine Lizenzbindung, keine Kompilate).
#
# Modell: Punkte (x, y) und Radien sind die Unbekannten. Linie = (Punkt a, Punkt b); Bogen = (a, b, Mitte, r);
# Kreis = (Mitte, r). Aufeinanderfolgende Elemente einer Kette teilen sich den Anschlusspunkt, damit bleibt
# die Kontur von selbst geschlossen. Bedingungen sind Residuen r(x) = 0; geloest wird mit Levenberg-Marquardt
# als "kleinste Aenderung": min |r(x)|² + mu·|x - x0|² (unterbestimmte Teile bleiben, wo sie sind).
#
# Bedingungen (dict "art"):
#   waagrecht/senkrecht {e}            parallel/rechtwinklig {e, f}      gleich {e, f} (Laenge bzw. Radius)
#   tangential {e, f}                  konzentrisch {e, f}               fix {p} (Punkt-Index)
#   symmetrisch {p, q, achse=e}        laenge {e, wert}                  radius {e, wert}
#   abstand {e, f, wert} (zwischen parallelen Linien)                    winkel {e, f, wert (Grad)}
#   punkt_abstand {p, q, wert}         auf_kreis {p, e}
# e/f = [kette, element]; p/q = [kette, element, "a"|"b"|"mitte"] (Punkt eines Elements).

import math

import numpy as np


def modell(ketten):
    """Ketten (JSON-Form) -> Unbekanntenvektor + Zuordnung. Gemeinsame Endpunkte werden EIN Punkt."""
    pkt = []                 # Liste der Punkte (2D)
    rad = []                 # Liste der Radien
    els = {}                 # (k, i) -> {"typ", "a", "b", "m"(Mitte), "r", "ref"}
    spl = []

    def neuer_punkt(q):
        pkt.append(np.asarray(q, float))
        return len(pkt) - 1
    for k, kette in enumerate(ketten):
        E = kette["elemente"]
        n = len(E)
        start = None
        vorher_b = None
        for i, e in enumerate(E):
            t = e["typ"]
            if t == "punkt":
                q = neuer_punkt(e["a"])
                els[(k, i)] = {"typ": t, "a": q, "b": q}
                continue
            if t == "kreis":
                els[(k, i)] = {"typ": t, "m": neuer_punkt(e["mitte"]), "r": len(rad)}
                rad.append(float(e["r"]))
                continue
            a = vorher_b if vorher_b is not None else neuer_punkt(e["a"])
            if start is None:
                start = a
            if kette.get("geschlossen") and i == n - 1:
                b = start
            else:
                b = neuer_punkt(e["b"])
            d = {"typ": t, "a": a, "b": b}
            if t == "bogen":
                d["m"] = neuer_punkt(e["mitte"])
                d["r"] = len(rad)
                rad.append(float(e["r"]))
                d["ref"] = np.asarray(e.get("m", e["a"]), float)       # Seite des Bogens
            elif t == "spline":
                d["pole"] = np.asarray(e["pole"], float)
                spl += [(a, pkt[a].copy()), (b, pkt[b].copy())]       # Spline-Enden bleiben liegen
            els[(k, i)] = d
            vorher_b = b
    x0 = np.concatenate([np.concatenate(pkt) if pkt else np.zeros(0), np.asarray(rad, float)])
    return {"x0": x0, "np": len(pkt), "nr": len(rad), "els": els, "spl": spl}


def punkt_index(M, ref):
    k, i, w = ref
    d = M["els"][(int(k), int(i))]
    return d["m"] if w in ("mitte", "m") else d[w]


def _p(x, i):
    return x[2 * i:2 * i + 2]


def _r(x, M, j):
    return x[2 * M["np"] + j]


def _richtung(x, e):
    d = _p(x, e["b"]) - _p(x, e["a"])
    return d / max(np.linalg.norm(d), 1e-12)


def residuen(x, M, bedingungen):
    res = []
    E = M["els"]
    # innere Bedingungen: Bogenendpunkte liegen auf ihrem Kreis
    for e in E.values():
        if e["typ"] == "bogen":
            m, r = _p(x, e["m"]), _r(x, M, e["r"])
            res += [np.linalg.norm(_p(x, e["a"]) - m) - r, np.linalg.norm(_p(x, e["b"]) - m) - r]
    for i, q in M["spl"]:
        res += list(_p(x, i) - q)
    for c in bedingungen:
        art = c["art"]
        e = E.get(tuple(c["e"])) if "e" in c else None
        f = E.get(tuple(c["f"])) if "f" in c else None
        if art == "waagrecht":
            res.append(_p(x, e["b"])[1] - _p(x, e["a"])[1])
        elif art == "senkrecht":
            res.append(_p(x, e["b"])[0] - _p(x, e["a"])[0])
        elif art == "parallel":
            u, v = _richtung(x, e), _richtung(x, f)
            res.append(u[0] * v[1] - u[1] * v[0])
        elif art == "rechtwinklig":
            res.append(_richtung(x, e) @ _richtung(x, f))
        elif art == "laenge":
            res.append(np.linalg.norm(_p(x, e["b"]) - _p(x, e["a"])) - c["wert"])
        elif art == "radius":
            res.append(_r(x, M, e["r"]) - c["wert"])
        elif art == "gleich":
            if e["typ"] == "linie" and f["typ"] == "linie":
                res.append(np.linalg.norm(_p(x, e["b"]) - _p(x, e["a"])) - np.linalg.norm(_p(x, f["b"]) - _p(x, f["a"])))
            else:
                res.append(_r(x, M, e["r"]) - _r(x, M, f["r"]))
        elif art == "konzentrisch":
            res += list(_p(x, e["m"]) - _p(x, f["m"]))
        elif art == "tangential":
            L, K = (e, f) if e["typ"] == "linie" else (f, e)
            if L["typ"] == "linie":                       # Linie - Kreis/Bogen: Abstand Mitte↔Gerade = r
                a, u = _p(x, L["a"]), _richtung(x, L)
                q = _p(x, K["m"]) - a
                res.append(abs(q[0] * u[1] - q[1] * u[0]) - _r(x, M, K["r"]))
            else:                                         # Bogen - Bogen: Abstand der Mitten = r1 ± r2
                dm = np.linalg.norm(_p(x, e["m"]) - _p(x, f["m"]))
                r1, r2 = _r(x, M, e["r"]), _r(x, M, f["r"])
                res.append(min(abs(dm - (r1 + r2)), abs(dm - abs(r1 - r2))))
        elif art == "fix":
            res += list(_p(x, punkt_index(M, c["p"])) - np.asarray(c["wo"], float))
        elif art == "punkt_abstand":
            res.append(np.linalg.norm(_p(x, punkt_index(M, c["p"])) - _p(x, punkt_index(M, c["q"]))) - c["wert"])
        elif art == "abstand":
            a, u = _p(x, f["a"]), _richtung(x, f)
            q = 0.5 * (_p(x, e["a"]) + _p(x, e["b"])) - a
            res.append(abs(q[0] * u[1] - q[1] * u[0]) - c["wert"])
        elif art == "winkel":
            # "soll" = vorzeichenbehafteter Winkel von f nach e, beim Setzen aus der Lage gewaehlt (winkel_soll)
            u, v = _richtung(x, e), _richtung(x, f)
            cs, sn = math.cos(c["soll"]), math.sin(c["soll"])
            w = np.array([cs * v[0] - sn * v[1], sn * v[0] + cs * v[1]])
            res.append(w[0] * u[1] - w[1] * u[0])
        elif art == "symmetrisch":
            A = E[tuple(c["achse"])]
            a, u = _p(x, A["a"]), _richtung(x, A)
            p, q = _p(x, punkt_index(M, c["p"])), _p(x, punkt_index(M, c["q"]))
            m = 0.5 * (p + q) - a
            res.append(m[0] * u[1] - m[1] * u[0])          # Mitte liegt auf der Achse
            res.append((q - p) @ u)                          # Verbindung steht senkrecht
        elif art == "deckungsgleich":
            res += list(_p(x, punkt_index(M, c["p"])) - _p(x, punkt_index(M, c["q"])))
        elif art == "auf_linie":
            a, u = _p(x, e["a"]), _richtung(x, e)
            q = _p(x, punkt_index(M, c["p"])) - a
            res.append(q[0] * u[1] - q[1] * u[0])
        elif art == "auf_kreis":
            res.append(np.linalg.norm(_p(x, punkt_index(M, c["p"])) - _p(x, e["m"])) - _r(x, M, e["r"]))
        else:
            raise ValueError("Unbekannte Bedingung „%s“." % art)
    return np.asarray(res, float)


def loesen(M, bedingungen, x0=None, iterationen=200, anker=()):
    """Levenberg-Marquardt mit Daempfung zur Startloesung. anker = Punkt-Indizes, die moeglichst liegen
    bleiben sollen (z. B. Anfang einer Linie, deren Laenge gesetzt wird). -> (x, Restfehler, ok)."""
    x0 = M["x0"] if x0 is None else x0
    x = x0.copy()
    lam = 1e-3
    gew = np.full(len(x0), math.sqrt(1e-6))    # kleinste Aenderung: zieht leicht zur Ausgangslage
    for i in anker:
        gew[2 * i:2 * i + 2] = 1.0
    def F(z):
        return np.concatenate([residuen(z, M, bedingungen), gew * (z - x0)])
    f = F(x)
    for _ in range(iterationen):
        n = len(x)
        J = np.zeros((len(f), n))
        h = 1e-7
        for j in range(n):
            z = x.copy()
            z[j] += h
            J[:, j] = (F(z) - f) / h
        A = J.T @ J
        g = J.T @ f
        while True:
            try:
                dx = np.linalg.solve(A + lam * np.diag(np.diag(A) + 1e-12), -g)
            except np.linalg.LinAlgError:
                dx = -np.linalg.lstsq(A + lam * np.eye(n), g, rcond=None)[0]
            f2 = F(x + dx)
            if f2 @ f2 < f @ f:
                x, f = x + dx, f2
                lam = max(lam / 3, 1e-12)
                break
            lam *= 4
            if lam > 1e12:
                break
        if np.linalg.norm(dx) < 1e-12 or lam > 1e12:
            break
    # Nachlauf ohne Rueckzug zur Ausgangslage: Gauss-Newton mit Minimalnorm-Schritt (lstsq) - die weiche
    # Bindung oben haelt sonst einen Rest von ~1e-5 fest; unterbestimmte Richtungen bleiben unbewegt.
    r = residuen(x, M, bedingungen)
    for _ in range(30):
        if not len(r) or np.abs(r).max() < 1e-11:
            break
        J = np.zeros((len(r), len(x)))
        for j in range(len(x)):
            z = x.copy()
            z[j] += 1e-7
            J[:, j] = (residuen(z, M, bedingungen) - r) / 1e-7
        dx = -np.linalg.lstsq(J, r, rcond=1e-10)[0]
        r2 = residuen(x + dx, M, bedingungen)
        if np.abs(r2).max() >= np.abs(r).max():
            break
        x, r = x + dx, r2
    rest = float(np.abs(r).max()) if len(r) else 0.0
    # entartet (Linie auf Laenge 0 / Radius 0 zusammengefallen) gilt nicht als Loesung
    for e in M["els"].values():
        if e["typ"] != "kreis" and np.linalg.norm(_p(x, e["b"]) - _p(x, e["a"])) < 1e-6 and e["a"] != e["b"]:
            rest = max(rest, float(np.linalg.norm(_p(M["x0"], e["b"]) - _p(M["x0"], e["a"]))))
        if "r" in e and _r(x, M, e["r"]) <= 1e-9:
            rest = max(rest, 1.0)
    return x, rest, rest < 1e-6


def zurueck(ketten, M, x):
    """Geloeste Werte in die Ketten (JSON-Form) zurueckschreiben."""
    aus = []
    for k, kette in enumerate(ketten):
        els = []
        for i, e in enumerate(kette["elemente"]):
            d = M["els"][(k, i)]
            e = dict(e)
            if d["typ"] == "punkt":
                e["a"] = e["b"] = _p(x, d["a"]).tolist()
            elif d["typ"] == "kreis":
                e["mitte"] = _p(x, d["m"]).tolist()
                e["r"] = float(_r(x, M, d["r"]))
            else:
                a, b = _p(x, d["a"]), _p(x, d["b"])
                e["a"], e["b"] = a.tolist(), b.tolist()
                if d["typ"] == "linie":
                    u = (b - a) / max(np.linalg.norm(b - a), 1e-12)
                    e["p"], e["d"] = a.tolist(), u.tolist()
                elif d["typ"] == "bogen":
                    m, r = _p(x, d["m"]), float(_r(x, M, d["r"]))
                    v = d["ref"] - m
                    e["mitte"], e["r"] = m.tolist(), r
                    e["m"] = (m + v / max(np.linalg.norm(v), 1e-12) * r).tolist()
            els.append(e)
        aus.append(dict(kette, elemente=els))
    return aus


def auto_bedingungen(ketten, tol_grad=0.5):
    """Bedingungen, die die Einpassung schon festgelegt hat: achsparallele Linien, tangentiale Uebergaenge
    (Rundungen), Nennmass-Radien. Damit bleiben sie beim Loesen erhalten."""
    aus = []
    for k, kette in enumerate(ketten):
        E = kette["elemente"]
        n = len(E)
        for i, e in enumerate(E):
            if e["typ"] == "linie":
                d = np.asarray(e["b"], float) - np.asarray(e["a"], float)
                art = e.get("achse")
                if art not in ("waagrecht", "senkrecht"):
                    art = "waagrecht" if abs(d[1]) <= 1e-7 * np.linalg.norm(d) else \
                          "senkrecht" if abs(d[0]) <= 1e-7 * np.linalg.norm(d) else None
                if art:
                    aus.append({"art": art, "e": [k, i], "auto": True})
            if e["typ"] in ("bogen", "kreis") and e.get("nenn"):
                aus.append({"art": "radius", "e": [k, i], "wert": float(e["r"]), "auto": True})
            j = (i + 1) % n
            if (kette.get("geschlossen") or i < n - 1) and n > 1:
                f = E[j]
                typen = {e["typ"], f["typ"]}
                if typen == {"linie", "bogen"} and (e.get("rundung") or f.get("rundung") or _tangential_jetzt(e, f, tol_grad)):
                    aus.append({"art": "tangential", "e": [k, i], "f": [k, j], "auto": True})
    return aus


def _tangential_jetzt(e, f, tol_grad):
    L, B = (e, f) if e["typ"] == "linie" else (f, e)
    a, b = np.asarray(L["a"], float), np.asarray(L["b"], float)
    u = (b - a) / max(np.linalg.norm(b - a), 1e-12)
    q = np.asarray(B["mitte"], float) - a
    d = abs(q[0] * u[1] - q[1] * u[0])
    return abs(d - float(B["r"])) <= max(1e-3, math.radians(tol_grad) * float(B["r"]))


_RICHTUNG = ("waagrecht", "senkrecht", "parallel", "rechtwinklig", "winkel")


def winkel_soll(ketten, c):
    """Fuer eine Winkel-Bedingung die Loesung waehlen, die der jetzigen Lage am naechsten liegt."""
    def r(ref):
        e = ketten[int(ref[0])]["elemente"][int(ref[1])]
        d = np.asarray(e["b"], float) - np.asarray(e["a"], float)
        return math.atan2(d[1], d[0])
    we, wf = r(c["e"]), r(c["f"])
    g = math.radians(float(c["wert"]))
    kand = [s * g + k * math.pi for s in (1, -1) for k in (0, 1)]
    return min(kand, key=lambda x: abs((wf + x - we + math.pi) % (2 * math.pi) - math.pi))


def skizze_loesen(ketten, bedingungen, anker=()):
    """Alle Ketten, die in einer Bedingung vorkommen, gemeinsam loesen; die uebrigen bleiben unberuehrt.
    Automatische Bedingungen (Achse, Tangente, Nennradius) gelten mit, ausser eine eigene Bedingung legt
    dasselbe Element anders fest. anker = [[kette, element, "a"|"b"], ...]. Widerspruch -> ValueError."""
    if not bedingungen:
        return ketten
    for c in bedingungen:
        if c["art"] == "winkel" and "soll" not in c:
            c["soll"] = winkel_soll(ketten, c)
    beteiligt = set()
    for c in bedingungen:
        for s in ("e", "f", "achse", "p", "q"):
            if s in c:
                beteiligt.add(int(c[s][0]))
    for k in beteiligt:
        if not 0 <= k < len(ketten):
            raise ValueError("Bedingung verweist auf Kontur %d, die es nicht mehr gibt." % (k + 1))
    nummer = sorted(beteiligt)
    neu_k = {k: j for j, k in enumerate(nummer)}

    def um(c):
        c = dict(c)
        for s in ("e", "f", "achse", "p", "q"):
            if s in c:
                c[s] = [neu_k[int(c[s][0])]] + list(c[s][1:])
        return c
    teil = [ketten[k] for k in nummer]
    eigene = [um(c) for c in bedingungen]
    richtung = {tuple(c["e"]) for c in eigene if c["art"] in _RICHTUNG}
    gleich = {(c["art"], tuple(c["e"])) for c in eigene if "e" in c}
    auto = [c for c in auto_bedingungen(teil)
            if not (c["art"] in ("waagrecht", "senkrecht") and tuple(c["e"]) in richtung)
            and (c["art"], tuple(c["e"])) not in gleich]
    M = modell(teil)
    for c in eigene:
        for s in ("e", "f", "achse"):
            if s in c and tuple(c[s]) not in M["els"]:
                raise ValueError("Bedingung verweist auf ein Element, das es nicht mehr gibt.")
    x, rest, ok = loesen(M, auto + eigene, anker=[punkt_index(M, um({"p": a})["p"]) for a in anker])
    if not ok:
        # nicht stillschweigend die automatischen (Achse, Tangente, Nennradius) fallen lassen - sonst zerfaellt
        # z. B. ein gezeichnetes Rechteck; der Nutzer soll entscheiden
        x2, rest2, ok2 = loesen(M, eigene, anker=[punkt_index(M, um({"p": a})["p"]) for a in anker])
        if ok2:
            raise ValueError("Das passt nicht zu den achsparallelen Linien bzw. tangentialen Übergängen der Kontur "
                             "(Rest %.3g mm) – Kontur anders zeichnen oder eine Bedingung entfernen." % rest)
        raise ValueError("Die Bedingungen widersprechen sich (Rest %.3g mm) – eine davon entfernen." % rest)
    geloest = zurueck(teil, M, x)
    aus = list(ketten)
    for k, kette in zip(nummer, geloest):
        aus[k] = kette
    return aus


def _ketten_von(c):
    return {int(c[s][0]) for s in ("e", "f", "achse", "p", "q") if s in c}


def ketten_entfernt(bedingungen, k):
    """Kontur k geloescht: ihre Bedingungen fallen weg, hoehere Konturnummern ruecken nach."""
    aus = []
    for c in bedingungen:
        if k in _ketten_von(c):
            continue
        c = dict(c)
        for s in ("e", "f", "achse", "p", "q"):
            if s in c and int(c[s][0]) > k:
                c[s] = [int(c[s][0]) - 1] + list(c[s][1:])
        aus.append(c)
    return aus


def kette_geaendert(bedingungen, k):
    """Kontur k neu aufgebaut (Elementnummern verschoben): ihre Bedingungen fallen weg."""
    return [c for c in bedingungen if k not in _ketten_von(c)]


def text(c):
    """Kurztext fuer die Liste in der Oberflaeche."""
    def el(r):
        return "K%d/E%d" % (int(r[0]) + 1, int(r[1]) + 1)
    namen = {"waagrecht": "waagrecht", "senkrecht": "senkrecht", "parallel": "parallel", "rechtwinklig": "rechtwinklig",
             "gleich": "gleich", "tangential": "tangential", "konzentrisch": "konzentrisch", "fix": "fest",
             "symmetrisch": "symmetrisch", "laenge": "Länge", "radius": "Radius", "abstand": "Abstand",
             "winkel": "Winkel", "punkt_abstand": "Punktabstand", "auf_kreis": "auf Kreis",
             "deckungsgleich": "deckungsgleich", "auf_linie": "auf Linie"}
    punktbezug = c["art"] in ("fix", "symmetrisch", "punkt_abstand", "deckungsgleich", "auf_kreis", "auf_linie")
    t = namen.get(c["art"], c["art"]) + " " + el(c["p"] if punktbezug and "p" in c else (c.get("e") or c["p"]))
    if punktbezug and c["art"] in ("auf_kreis", "auf_linie"):
        t += " ↔ " + el(c["e"])
    if "f" in c:
        t += " ↔ " + el(c["f"])
    if "q" in c:
        t += " ↔ " + el(c["q"])
    if "achse" in c:
        t += " um " + el(c["achse"])
    if "wert" in c:
        t += " = %g%s" % (c["wert"], "°" if c["art"] == "winkel" else " mm")
    return t


def vorschlaege(ketten, grad=1.0, rel=0.01, vorhandene=()):
    """Auto Constrain: Bedingungen, die die Skizze schon fast erfuellt - parallel/rechtwinklig (Linien,
    auch ueber Konturen), gleich lang (Linien), gleicher Radius, konzentrisch. Je Gruppe gegen das erste
    Element (keine Ketten aus Redundanzen). Achsparallele Linien bekommen nichts (das tut auto_bedingungen)."""
    cos_p, sin_r = math.cos(math.radians(grad)), math.sin(math.radians(grad))
    linien, kreise = [], []
    for k, kette in enumerate(ketten):
        if kette.get("hilfe"):
            continue
        for i, e in enumerate(kette["elemente"]):
            if e["typ"] == "linie":
                a, b = np.asarray(e["a"], float), np.asarray(e["b"], float)
                L = float(np.linalg.norm(b - a))
                if L > 1e-6:
                    linien.append(((k, i), (b - a) / L, L))
            elif e["typ"] in ("bogen", "kreis"):
                kreise.append(((k, i), np.asarray(e["mitte"], float), float(e["r"])))
    schon = {(c["art"], tuple(c.get("e", ())), tuple(c.get("f", ()))) for c in vorhandene}
    aus = []

    def neu(c):
        s = (c["art"], tuple(c["e"]), tuple(c.get("f", ())))
        if s not in schon and (c["art"], tuple(c.get("f", ())), tuple(c["e"])) not in schon:
            schon.add(s)
            aus.append(c)

    def achsparallel(u):
        return abs(u[0]) >= cos_p or abs(u[1]) >= cos_p
    # parallele Gruppen
    gruppen = []
    for ref, u, L in linien:
        if achsparallel(u):
            continue
        for g in gruppen:
            if abs(float(g[0][1] @ u)) >= cos_p:
                g.append((ref, u, L))
                break
        else:
            gruppen.append([(ref, u, L)])
    for g in gruppen:
        for ref, u, L in g[1:]:
            neu({"art": "parallel", "e": list(ref), "f": list(g[0][0])})
    # rechtwinklig: Gruppenkoepfe untereinander (nicht achsparallel)
    for i, g in enumerate(gruppen):
        for h in gruppen[:i]:
            if abs(float(g[0][1] @ h[0][1])) <= sin_r:
                neu({"art": "rechtwinklig", "e": list(g[0][0]), "f": list(h[0][0])})
                break
    # gleich lang
    erledigt = set()
    for i, (ra, ua, la) in enumerate(linien):
        if ra in erledigt:
            continue
        for rb, ub, lb in linien[i + 1:]:
            if rb not in erledigt and abs(la - lb) <= rel * max(la, lb):
                neu({"art": "gleich", "e": list(rb), "f": list(ra)})
                erledigt.add(rb)
    # gleicher Radius / konzentrisch
    erledigt = set()
    for i, (ra, ma, r_a) in enumerate(kreise):
        for rb, mb, r_b in kreise[i + 1:]:
            if np.linalg.norm(ma - mb) <= max(1e-3, rel * min(r_a, r_b)):
                neu({"art": "konzentrisch", "e": list(rb), "f": list(ra)})
            elif rb not in erledigt and abs(r_a - r_b) <= rel * max(r_a, r_b):
                neu({"art": "gleich", "e": list(rb), "f": list(ra)})
                erledigt.add(rb)
    return aus


def auto_hinzufuegen(ketten, bedingungen, **kw):
    """Vorschlaege einzeln dazunehmen und je Schritt loesen; was der Skizze widerspricht, bleibt weg.
    -> (ketten, bedingungen, angenommen, abgelehnt)"""
    angenommen, abgelehnt = 0, 0
    bed = list(bedingungen)
    for c in vorschlaege(ketten, vorhandene=bed, **kw):
        try:
            ketten = skizze_loesen(ketten, bed + [c])
            bed.append(c)
            angenommen += 1
        except ValueError:
            abgelehnt += 1
    return ketten, bed, angenommen, abgelehnt


def ketten_umgebaut(bedingungen, k, anzahl_neu):
    """Kontur k durch anzahl_neu Konturen ersetzt (Trimmen teilt): ihre Bedingungen fallen weg, hoehere
    Konturnummern verschieben sich um anzahl_neu - 1."""
    d = anzahl_neu - 1
    aus = []
    for c in bedingungen:
        if k in _ketten_von(c):
            continue
        c = dict(c)
        for s_ in ("e", "f", "achse", "p", "q"):
            if s_ in c and int(c[s_][0]) > k:
                c[s_] = [int(c[s_][0]) + d] + list(c[s_][1:])
        aus.append(c)
    return aus
