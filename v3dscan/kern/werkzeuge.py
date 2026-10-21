# Bereinigungs-Werkzeuge.
#
# Jedes Werkzeug rechnet nur und aendert den Scan NICHT: es liefert eine Maske
# der Punkte, die wegfallen wuerden (fuer die rote Vorschau). Erst "Anwenden"
# im Projekt loescht wirklich - so bleibt Vorschau -> Anwenden -> Zuruecksetzen
# fuer jedes Werkzeug gleich.

import math

import numpy as np

from .o3d import o3d


def punktabstand(scan, stichprobe=4000):
    """Mittlerer Abstand zum naechsten Nachbarn (mm), aus einer Stichprobe."""
    n = len(scan)
    if n < 2:
        return 0.0
    baum = o3d.geometry.KDTreeFlann(scan.zu_o3d(normalen=False))
    rng = np.random.default_rng(1)
    idx = rng.choice(n, size=min(n, stichprobe), replace=False)
    werte = []
    for i in idx:
        k, _, d2 = baum.search_knn_vector_3d(scan.xyz[i].astype(np.float64), 2)
        if k == 2:
            werte.append(np.sqrt(d2[1]))
    return float(np.median(werte)) if werte else 0.0


# --- Zusammenhaengende Bereiche ---------------------------------------------
_NACHBARN = np.array([(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                      for dz in (-1, 0, 1) if (dx, dy, dz) > (0, 0, 0)],
                     dtype=np.int64)


def komponenten(xyz, abstand):
    """Beschriftet jeden Punkt mit der Nummer seines zusammenhaengenden
    Bereichs. Zwei Punkte haengen zusammen, wenn ihre Voxel (Kantenlaenge
    `abstand`) sich beruehren. Liefert (labels je Punkt, Groesse je Label)."""
    if len(xyz) == 0:
        return np.zeros(0, np.int64), np.zeros(0, np.int64)
    g = np.floor((xyz - xyz.min(0)) / max(abstand, 1e-6)).astype(np.int64) + 1
    b = int(g.max()) + 2
    schluessel = (g[:, 0] * b + g[:, 1]) * b + g[:, 2]
    voxel, inv = np.unique(schluessel, return_inverse=True)
    m = len(voxel)
    vk = np.stack([voxel // (b * b), (voxel // b) % b, voxel % b], axis=1)

    kanten_a, kanten_b = [], []
    for off in _NACHBARN:
        nk = ((vk[:, 0] + off[0]) * b + vk[:, 1] + off[1]) * b + vk[:, 2] + off[2]
        pos = np.searchsorted(voxel, nk)
        pos[pos >= m] = m - 1
        treffer = voxel[pos] == nk
        kanten_a.append(np.nonzero(treffer)[0])
        kanten_b.append(pos[treffer])
    a = np.concatenate(kanten_a)
    c = np.concatenate(kanten_b)

    _, lab = np.unique(_label_weitergabe(m, a, c), return_inverse=True)
    punkt_lab = lab[inv]
    groessen = np.bincount(punkt_lab)
    return punkt_lab, groessen


def _label_weitergabe(m, a, c):
    """Zusammenhangskomponenten eines Graphen (m Knoten, Kanten a-c) -> Label je Knoten."""
    # Label-Weitergabe mit Zeigersprung: jedes Voxel uebernimmt das kleinste
    # Label seiner Nachbarn, bis sich nichts mehr aendert.
    lab = np.arange(m, dtype=np.int64)
    while True:
        alt = lab.copy()
        kl = np.minimum(lab[a], lab[c])
        np.minimum.at(lab, a, kl)
        np.minimum.at(lab, c, kl)
        while True:
            neu = lab[lab]
            if np.array_equal(neu, lab):
                break
            lab = neu
        if np.array_equal(alt, lab):
            break
    return lab


def verbunden(scan, index, abstand):
    """Maske aller Punkte, die mit Punkt `index` zusammenhaengen."""
    lab, _ = komponenten(scan.xyz, abstand)
    return lab == lab[index]


def _normalen(scan):
    if scan.nrm is not None:
        return np.asarray(scan.nrm, float)
    if scan.tri is not None and len(scan.tri):
        m = scan.zu_o3d_netz()
        m.compute_vertex_normals()
        return np.asarray(m.vertex_normals)
    p = scan.zu_o3d(normalen=False)
    p.estimate_normals()
    return np.asarray(p.normals)


def _zauberstab_netz(X, T, index, grenze, punkt=None):
    """Netz: Wachstum ueber Dreiecke mit Flaechennormalen (Eckennormalen sind an groben Netzen an jeder Kante
    gemittelt). Start = das an der Ecke haengende Dreieck, das dem geklickten Punkt am naechsten liegt."""
    T = np.asarray(T, np.int64)
    P = X[T]
    FN = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    flaeche = np.linalg.norm(FN, axis=1)
    FN = FN / np.maximum(flaeche, 1e-12)[:, None]
    an = np.nonzero((T == index).any(1))[0]
    if not len(an):
        raise ValueError("Der Punkt gehört zu keinem Dreieck.")
    if punkt is not None:
        start = an[np.argmin(np.linalg.norm(P[an].mean(1) - np.asarray(punkt, float), axis=1))]
    else:
        start = an[np.argmax(flaeche[an])]
    # Nachbardreiecke ueber gemeinsame Kanten
    e = np.sort(np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]]), axis=1)
    f = np.tile(np.arange(len(T)), 3)
    key = e[:, 0] * (len(X) + 1) + e[:, 1]
    o = np.argsort(key, kind="stable")
    k, fo = key[o], f[o]
    gleich = np.nonzero(k[1:] == k[:-1])[0]
    a, c = fo[gleich], fo[gleich + 1]
    # Rauschen daempfen: Flaechennormalen einmal mit den Nachbarn mitteln (flaechengewichtet); mehr Runden
    # verschleifen echte Kanten zu Treppen aus kleinen Winkeln, ueber die der Zauberstab dann hinweglaeuft
    G = FN * flaeche[:, None]
    for _ in range(1):
        S = G.copy()
        np.add.at(S, a, G[c])
        np.add.at(S, c, G[a])
        G = S / np.maximum(np.linalg.norm(S, axis=1), 1e-12)[:, None] * flaeche[:, None]
    FN = G / np.maximum(np.linalg.norm(G, axis=1), 1e-12)[:, None]
    ok = np.einsum("ij,ij->i", FN[a], FN[c]) >= grenze
    lab = _label_weitergabe(len(T), a[ok], c[ok])
    wahl = lab == lab[start]
    maske = np.zeros(len(X), bool)
    maske[T[wahl].ravel()] = True
    return maske


def zauberstab(scan, index, winkel=15.0, abstand=None, punkt=None):
    """Magic Wand: von Punkt index aus alles waehlen, was ueber Nachbarn mit Normalen-Unterschied
    < winkel (Grad) erreichbar ist - haelt an Kanten an. Netze ueber ihre Dreieckskanten, Punktwolken
    ueber Voxel-Nachbarschaft (Voxel = abstand, Standard 3x Punktabstand)."""
    grenze = math.cos(math.radians(float(winkel)))
    if scan.tri is not None and len(scan.tri):
        return _zauberstab_netz(np.asarray(scan.xyz, float), scan.tri, index, grenze, punkt)
    xyz = np.asarray(scan.xyz, float)
    fest = abstand is not None
    abstand = abstand or 3.0 * punktabstand(scan)
    for _ in range(6):
        # Voxel so gross, dass im Median >= 8 Punkte darin liegen (sonst ist die Ebenen-Schaetzung Zufall)
        g = np.floor((xyz - xyz.min(0)) / max(abstand, 1e-6)).astype(np.int64) + 1
        b = int(g.max()) + 2
        schluessel = (g[:, 0] * b + g[:, 1]) * b + g[:, 2]
        voxel, inv = np.unique(schluessel, return_inverse=True)
        if fest or np.median(np.bincount(inv)) >= 8:
            break
        abstand *= 1.4
    m = len(voxel)
    # Voxel-Normale per Hauptachsen (kleinster Eigenvektor der Kovarianz) und Kruemmung lam0/sum: Voxel auf
    # einer Kante mischen zwei Flaechen -> nicht eben -> Sperre (sonst Treppe aus kleinen Winkeln)
    zahl = np.bincount(inv, minlength=m).astype(float)
    mitte = np.zeros((m, 3))
    np.add.at(mitte, inv, xyz)
    mitte /= zahl[:, None]
    d = xyz - mitte[inv]
    C = np.zeros((m, 3, 3))
    np.add.at(C, inv, d[:, :, None] * d[:, None, :])
    lam, vec = np.linalg.eigh(C)
    VN = vec[:, :, 0]
    kruemmung = lam[:, 0] / np.maximum(lam.sum(1), 1e-18)
    eben = (zahl >= 3) & (kruemmung < 0.02 + 0.1 * (1 - grenze))
    vk = np.stack([voxel // (b * b), (voxel // b) % b, voxel % b], axis=1)
    ka, kb = [], []
    for off in _NACHBARN:
        nk = ((vk[:, 0] + off[0]) * b + vk[:, 1] + off[1]) * b + vk[:, 2] + off[2]
        pos = np.searchsorted(voxel, nk)
        pos[pos >= m] = m - 1
        treffer = voxel[pos] == nk
        ka.append(np.nonzero(treffer)[0])
        kb.append(pos[treffer])
    a, c = np.concatenate(ka), np.concatenate(kb)
    ok = (np.abs(np.einsum("ij,ij->i", VN[a], VN[c])) >= grenze) & eben[a] & eben[c]
    lab = _label_weitergabe(m, a[ok], c[ok])
    wahl = lab == lab[inv[index]]
    maske = wahl[inv]
    # gesperrte (nicht ebene) Nachbarvoxel: deren Punkte gehoeren dazu, wenn sie in der Ebene eines
    # gewaehlten Nachbarvoxels liegen - so endet die Auswahl an der Kante statt einen Voxel davor
    rand = (wahl[a] & ~eben[c] & ~wahl[c])
    if rand.any():
        ordnung = np.argsort(inv, kind="stable")
        anfang = np.r_[0, np.cumsum(np.bincount(inv, minlength=m))]
        for va, vc in zip(a[rand].tolist(), c[rand].tolist()):
            pts = ordnung[anfang[vc]:anfang[vc + 1]]
            nah = np.abs((xyz[pts] - mitte[va]) @ VN[va]) < 0.15 * abstand
            maske[pts[nah]] = True
    return maske


def auswahl_wachsen(scan, maske, schritte=1, schritt=None):
    """Grow/Shrink: Auswahl um schritte x schritt (Standard 1,5x Punktabstand) vergroessern (schritte > 0)
    oder verkleinern (< 0)."""
    from .o3d import o3d
    maske = np.asarray(maske, bool)
    if not maske.any() or schritte == 0:
        return maske
    d = abs(int(schritte)) * (schritt or 1.5 * punktabstand(scan))
    xyz = np.asarray(scan.xyz, float)

    def wolke(P):
        return o3d.geometry.PointCloud(o3d.utility.Vector3dVector(P))
    if schritte > 0:
        rest = ~maske
        if not rest.any():
            return maske
        dist = np.asarray(wolke(xyz[rest]).compute_point_cloud_distance(wolke(xyz[maske])))
        neu = maske.copy()
        neu[np.nonzero(rest)[0][dist <= d]] = True
        return neu
    if maske.all():
        return maske
    dist = np.asarray(wolke(xyz[maske]).compute_point_cloud_distance(wolke(xyz[~maske])))
    neu = maske.copy()
    neu[np.nonzero(maske)[0][dist <= d]] = False
    return neu


def kleine_inseln(scan, abstand, max_anteil_prozent):
    """Maske der Punkte in abgetrennten Bereichen, die weniger als
    max_anteil_prozent aller Punkte enthalten (wie Revo "Isolation")."""
    lab, groessen = komponenten(scan.xyz, abstand)
    grenze = len(scan) * max_anteil_prozent / 100.0
    klein = groessen < grenze
    klein[np.argmax(groessen)] = False       # der groesste Bereich bleibt immer
    return klein[lab]


# --- Ausreisser ---------------------------------------------------------------
def ausreisser_statistisch(scan, nachbarn=20, sigma=2.0):
    _, behalten = scan.zu_o3d(normalen=False).remove_statistical_outlier(
        int(nachbarn), float(sigma))
    weg = np.ones(len(scan), bool)
    weg[np.asarray(behalten, dtype=np.int64)] = False
    return weg


def ausreisser_radius(scan, radius, min_punkte):
    _, behalten = scan.zu_o3d(normalen=False).remove_radius_outlier(
        int(min_punkte), float(radius))
    weg = np.ones(len(scan), bool)
    weg[np.asarray(behalten, dtype=np.int64)] = False
    return weg


# --- Ebenen ---------------------------------------------------------------
def ebene_aus_punkten(p1, p2, p3):
    p1, p2, p3 = (np.asarray(p, np.float64) for p in (p1, p2, p3))
    n = np.cross(p2 - p1, p3 - p1)
    laenge = np.linalg.norm(n)
    if laenge < 1e-9:
        raise ValueError("Die drei Punkte liegen auf einer Linie.")
    n /= laenge
    return n, float(-n @ p1)


def seite_der_ebene(xyz, normale, d, versatz=0.0):
    """Maske der Punkte auf der Seite, in die die Normale zeigt."""
    return (xyz.astype(np.float64) @ np.asarray(normale, np.float64) + d) > versatz


def tisch_finden(scan, toleranz, versuch=0, iterationen=1500):
    """Groesste Ebene per RANSAC. versuch=1,2,... liefert die naechstkleinere
    Ebene (die vorherigen werden ausgeblendet). Liefert (normale, d, inlier-Maske),
    Normale zeigt zum Objekt (zur Mehrheit der uebrigen Punkte)."""
    xyz = scan.xyz
    rest = np.ones(len(xyz), bool)
    ergebnis = None
    for _ in range(int(versuch) + 1):
        idx = np.nonzero(rest)[0]
        if len(idx) < 50:
            raise ValueError("Keine weitere Ebene gefunden.")
        # Fuer RANSAC reicht eine Stichprobe; bewertet wird auf allen Punkten.
        wahl = idx if len(idx) <= 300000 else \
            np.random.default_rng(7).choice(idx, 300000, replace=False)
        p = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(
            xyz[wahl].astype(np.float64)))
        modell, _ = p.segment_plane(float(toleranz), 3, int(iterationen))
        n = np.asarray(modell[:3], np.float64)
        d = float(modell[3]) / np.linalg.norm(n)
        n /= np.linalg.norm(n)
        abst = xyz.astype(np.float64) @ n + d
        auf = np.abs(abst) <= toleranz
        ergebnis = (n, d, auf & rest, abst)
        rest &= ~auf
    n, d, auf, abst = ergebnis
    uebrig = abst[~auf]
    if len(uebrig) and np.sum(uebrig > 0) < np.sum(uebrig < 0):
        n, d = -n, -d
    return n, d, auf


def tisch_maske(scan, toleranz, versuch=0, auch_darunter=True):
    n, d, auf = tisch_finden(scan, toleranz, versuch)
    weg = auf.copy()
    if auch_darunter:
        weg |= seite_der_ebene(scan.xyz, -n, -d, 0.0)
    return weg, n, d


# --- Ausduennen / Normalen ------------------------------------------------
def ausduennen(scan, voxel):
    """Neuer Scan mit hoechstens einem Punkt je Voxel (Mittelwert)."""
    from .wolke import Scan
    p = scan.zu_o3d(farbe=True).voxel_down_sample(float(voxel))
    neu = Scan.aus_o3d(scan.name, p)
    if neu.nrm is not None:
        laenge = np.linalg.norm(neu.nrm, axis=1, keepdims=True)
        neu.nrm /= np.maximum(laenge, 1e-9)
    return neu


def normalen_berechnen(scan, radius, nachbarn=30, ausrichtung="aussen"):
    p = scan.zu_o3d(normalen=False)
    p.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(
        radius=float(radius), max_nn=int(nachbarn)))
    nrm = np.asarray(p.normals)
    if ausrichtung == "konsistent" and len(scan) <= 400000:
        p.orient_normals_consistent_tangent_plane(12)
        nrm = np.asarray(p.normals)
        # Gesamtrichtung nach aussen drehen
        mitte = scan.xyz.mean(0)
        if np.sum(np.einsum("ij,ij->i", nrm, scan.xyz - mitte)) < 0:
            nrm = -nrm
    else:
        mitte = scan.xyz.mean(0)
        zeigt = np.einsum("ij,ij->i", nrm, scan.xyz - mitte)
        nrm = np.where((zeigt < 0)[:, None], -nrm, nrm)
        if ausrichtung == "innen":
            nrm = -nrm
    return nrm.astype(np.float32)
