# Referenzgeometrie (QuickSurface "Construct": Symmetry Plane, Plane, Reference Line; Design X
# "Ref. Plane/Vector"). Ebenen: {"art": "ebene", "punkt", "normale"}; Achsen: {"art": "achse", "punkt", "richtung"}.

import numpy as np


def _einheit(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-12)


def symmetrieebene(xyz, stichprobe=60000, iterationen=60):
    """Beste Spiegelebene eines Scans. Je Hauptachse: an der Ebene durch den Schwerpunkt spiegeln,
    gespiegelte Wolke per ICP auf das Original ziehen; M = T·S ist dann die eigentliche Spiegelung,
    deren Normale der Eigenvektor zum Eigenwert -1 ist. -> (ebene, rms, kandidaten)"""
    from .o3d import o3d, reg
    P = np.asarray(xyz, np.float64)
    if len(P) > stichprobe:
        P = P[np.random.default_rng(0).choice(len(P), stichprobe, replace=False)]
    c = P.mean(0)
    _, _, vt = np.linalg.svd(P - c, full_matrices=False)
    diag = float(np.linalg.norm(P.max(0) - P.min(0)))
    ziel = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(P))
    kandidaten = []
    for n0 in vt:
        S = np.eye(4)
        S[:3, :3] = np.eye(3) - 2 * np.outer(n0, n0)
        S[:3, 3] = 2 * (n0 @ c) * n0
        quelle = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(P @ S[:3, :3].T + S[:3, 3]))
        T = np.eye(4)
        for fang in (0.05 * diag, 0.015 * diag, 0.005 * diag):
            e = reg.registration_icp(quelle, ziel, fang, T, reg.TransformationEstimationPointToPoint(),
                                     reg.ICPConvergenceCriteria(max_iteration=iterationen))
            T = e.transformation
        M = T @ S
        w, v = np.linalg.eig(M[:3, :3])
        k = int(np.argmin(np.abs(w + 1)))
        n = _einheit(np.real(v[:, k]))
        d = float(n @ M[:3, 3]) / 2
        punkt = d * n
        # Punkt auf der Ebene nahe am Schwerpunkt
        punkt = c - ((c - punkt) @ n) * n
        gesp = P - 2 * ((P - punkt) @ n)[:, None] * n
        dist = np.asarray(o3d.geometry.PointCloud(o3d.utility.Vector3dVector(gesp)).compute_point_cloud_distance(ziel))
        kandidaten.append({"punkt": punkt, "normale": n, "rms": float(np.sqrt(np.mean(dist ** 2))),
                           "deckung": float(np.mean(dist < 0.01 * diag))})
    kandidaten.sort(key=lambda k: k["rms"])
    b = kandidaten[0]
    return {"art": "ebene", "punkt": b["punkt"], "normale": b["normale"]}, b["rms"], kandidaten


def ebene_aus_element(el, versatz=0.0):
    n = _einheit(el["normale"])
    return {"art": "ebene", "punkt": np.asarray(el["punkt"], float) + n * versatz, "normale": n}


def mittelebene(el1, el2):
    """Mitte zwischen zwei (fast) parallelen Ebenen (QuickSurface "Middle plane")."""
    n1, n2 = _einheit(el1["normale"]), _einheit(el2["normale"])
    if n1 @ n2 < 0:
        n2 = -n2
    if n1 @ n2 < np.cos(np.radians(10)):
        raise ValueError("Die beiden Ebenen sind nicht annähernd parallel.")
    n = _einheit(n1 + n2)
    p = 0.5 * (np.asarray(el1["punkt"], float) + np.asarray(el2["punkt"], float))
    return {"art": "ebene", "punkt": p, "normale": n}


def achse_aus_element(el):
    if "achse" not in el:
        raise ValueError("Der Bereich hat keine Achse (Zylinder, Bohrung, Kegel …).")
    return {"art": "achse", "punkt": np.asarray(el["punkt"], float), "richtung": _einheit(el["achse"])}


def json_form(r):
    return {k: ([round(float(x), 6) for x in v] if isinstance(v, (np.ndarray, list, tuple)) else v)
            for k, v in r.items()}


def ebene_eingabe(punkt, normale):
    return {"art": "ebene", "punkt": np.asarray(punkt, float), "normale": _einheit(normale)}


def ebene_drei_punkte(a, b, c):
    a, b, c = (np.asarray(x, float) for x in (a, b, c))
    n = np.cross(b - a, c - a)
    if np.linalg.norm(n) < 1e-9:
        raise ValueError("Die drei Punkte liegen auf einer Linie.")
    return {"art": "ebene", "punkt": (a + b + c) / 3, "normale": _einheit(n)}


def achse_aus_ebenen(e1, e2):
    """Referenzlinie = Schnittgerade zweier Ebenen."""
    n1, n2 = _einheit(e1["normale"]), _einheit(e2["normale"])
    d = np.cross(n1, n2)
    if np.linalg.norm(d) < 1e-6:
        raise ValueError("Die Ebenen sind parallel – keine Schnittgerade.")
    d = _einheit(d)
    A = np.array([n1, n2, d])
    rhs = np.array([n1 @ np.asarray(e1["punkt"], float), n2 @ np.asarray(e2["punkt"], float),
                    d @ (0.5 * (np.asarray(e1["punkt"], float) + np.asarray(e2["punkt"], float)))])
    return {"art": "achse", "punkt": np.linalg.solve(A, rhs), "richtung": d}


def punkt_aus_ebenen(e1, e2, e3):
    """Referenzpunkt = Schnitt dreier Ebenen."""
    N = np.array([_einheit(e["normale"]) for e in (e1, e2, e3)])
    if abs(np.linalg.det(N)) < 1e-6:
        raise ValueError("Die drei Ebenen schneiden sich nicht in einem Punkt.")
    rhs = np.array([n @ np.asarray(e["punkt"], float) for n, e in zip(N, (e1, e2, e3))])
    return {"art": "punkt", "punkt": np.linalg.solve(N, rhs)}
