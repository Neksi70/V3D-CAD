#!/usr/bin/env python3
"""KI-Körper: Foto → 3D-Modell (Hunyuan3D-2 auf Hugging Face ZeroGPU) → Tiefenkarten.

Liefert für die Web-App zwei Karten im Raster des Fotos:
  vorn   = Abstand der vorderen Fläche zum Betrachter (in Foto-Pixeln, klein = nah)
  hinten = dasselbe für die Rückseite
Damit kann die App den Hinterkopf mitgravieren, statt hinten eine Kuppel zu raten.

Die Ausrichtung des erzeugten Modells ist nicht garantiert; deshalb werden mehrere
Drehungen ausprobiert und die genommen, deren Umriss am besten zur Foto-Maske passt.
"""
import base64, inspect, json, os, struct

import numpy as np

TOKEN_DATEI = os.path.expanduser('~/.config/volme3d/hf_token')
SPACE = 'tencent/Hunyuan3D-2'
RASTER = 256          # Kantenlänge der Arbeits-Rasterung
PROBEN = 4_000_000    # Flächenpunkte für die Rasterung


# ── GLB lesen ────────────────────────────────────────────────────────
def glb_laden(pfad):
    """Minimaler glTF-Binary-Leser: nur Dreiecksnetze, Knoten-Transformationen inklusive."""
    with open(pfad, 'rb') as f:
        roh = f.read()
    magie, _, _ = struct.unpack('<III', roh[:12])
    if magie != 0x46546C67:
        raise ValueError('keine GLB-Datei')
    js, bin_ = None, b''
    pos = 12
    while pos < len(roh):
        laenge, art = struct.unpack('<II', roh[pos:pos + 8])
        block = roh[pos + 8:pos + 8 + laenge]
        if art == 0x4E4F534A:
            js = json.loads(block.decode('utf-8'))
        elif art == 0x004E4942:
            bin_ = block
        pos += 8 + laenge + (-laenge % 4)
    if not js:
        raise ValueError('GLB ohne JSON-Teil')

    typ_groesse = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
    anzahl = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

    def zugriff(i):
        a = js['accessors'][i]
        bv = js['bufferViews'][a['bufferView']]
        art, gr = typ_groesse[a['componentType']]
        n = anzahl[a['type']]
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        schritt = bv.get('byteStride') or gr * n
        d = np.frombuffer(bin_, dtype=np.dtype('<' + art), count=schritt // gr * (a['count'] - 1) + n,
                          offset=start)
        if schritt == gr * n:
            return d.reshape(a['count'], n)
        return np.lib.stride_tricks.as_strided(d, (a['count'], n), (schritt, gr)).copy()

    ecken, flaechen = [], []
    def knoten(i, M):
        k = js['nodes'][i]
        if 'matrix' in k:
            M = M @ np.array(k['matrix'], np.float64).reshape(4, 4).T
        else:
            T = np.eye(4)
            if 'scale' in k:
                T[:3, :3] = np.diag(k['scale'])
            if 'rotation' in k:
                x, y, z, w = k['rotation']
                R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                              [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                              [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
                T[:3, :3] = R @ T[:3, :3]
            if 'translation' in k:
                T[:3, 3] = k['translation']
            M = M @ T
        if 'mesh' in k:
            for p in js['meshes'][k['mesh']].get('primitives', []):
                if p.get('mode', 4) != 4 or 'POSITION' not in p.get('attributes', {}):
                    continue
                V = zugriff(p['attributes']['POSITION']).astype(np.float64)
                V = V @ M[:3, :3].T + M[:3, 3]
                F = (zugriff(p['indices']).reshape(-1, 3) if 'indices' in p
                     else np.arange(len(V), dtype=np.int32).reshape(-1, 3))
                flaechen.append(F.astype(np.int64) + sum(len(v) for v in ecken))
                ecken.append(V)
        for kind in k.get('children', []):
            knoten(kind, M)

    wurzeln = js['scenes'][js.get('scene', 0)].get('nodes', range(len(js.get('nodes', []))))
    for i in wurzeln:
        knoten(i, np.eye(4))
    if not ecken:
        raise ValueError('GLB ohne Dreiecksnetz')
    return np.vstack(ecken), np.vstack(flaechen)


# ── Rasterung ────────────────────────────────────────────────────────
def flaechenpunkte(V, F, anzahl=PROBEN):
    """Gleichmäßig über die Oberfläche verteilte Punkte (flächengewichtet)."""
    A, B, C = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    flaeche = 0.5 * np.linalg.norm(np.cross(B - A, C - A), axis=1)
    summe = flaeche.sum()
    if summe <= 0:
        raise ValueError('Netz ohne Fläche')
    rng = np.random.default_rng(7)
    wahl = rng.choice(len(F), size=anzahl, p=flaeche / summe)
    u = rng.random(anzahl)[:, None]
    v = rng.random(anzahl)[:, None]
    ueber = (u + v > 1).ravel()
    u[ueber], v[ueber] = 1 - u[ueber], 1 - v[ueber]
    return A[wahl] + u * (B[wahl] - A[wahl]) + v * (C[wahl] - A[wahl])


def karten(P, raster=RASTER):
    """Punktwolke → (vorn, hinten, belegt) im Raster, Blickrichtung −Z (Betrachter bei +Z).
    Der Umriss wird mittig in das quadratische Raster gelegt — genau wie die Foto-Maske
    in passend(), sonst stimmt die Zuordnung Foto ↔ Modell nicht."""
    xy_min, xy_max = P[:, :2].min(0), P[:, :2].max(0)
    spanne = (xy_max - xy_min).max()
    if spanne <= 0:
        raise ValueError('Modell ohne Ausdehnung')
    s = (raster - 1) / spanne
    mitte = (xy_min + xy_max) / 2
    ix = np.clip(((P[:, 0] - mitte[0]) * s + raster / 2).astype(np.int32), 0, raster - 1)
    iy = np.clip(((P[:, 1] - mitte[1]) * s + raster / 2).astype(np.int32), 0, raster - 1)
    idx = iy * raster + ix
    tief = -P[:, 2] * s                       # Pixel-Einheiten, klein = nah am Betrachter
    vorn = np.full(raster * raster, np.inf)
    hinten = np.full(raster * raster, -np.inf)
    np.minimum.at(vorn, idx, tief)
    np.maximum.at(hinten, idx, tief)
    belegt = np.isfinite(vorn)
    return (vorn.reshape(raster, raster), hinten.reshape(raster, raster),
            belegt.reshape(raster, raster), s, mitte)


# Kandidaten für die Ausrichtung. KEINE Spiegelungen: eine 180°-Drehung plus Spiegelung
# ergibt denselben Umriss bei vertauschter Tiefe — der Hinterkopf läge dann vorn.
DREHUNGEN = {
    'vorne':   np.eye(3),
    'y90':     np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], float),
    'y180':    np.array([[-1, 0, 0], [0, 1, 0], [0, 0, -1]], float),
    'y270':    np.array([[0, 0, -1], [0, 1, 0], [1, 0, 0]], float),
    'x90':     np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float),
    'x270':    np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float),
}


def umriss_feld(maske):
    """Quadratisches Feld um den Umriss im Foto: (x0, y0, kante) in Masken-Pixeln."""
    ys, xs = np.nonzero(maske > 0.5)
    if len(xs) < 20:
        return None
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    kante = max(x1 - x0 + 1, y1 - y0 + 1)
    return ((x0 + x1 + 1 - kante) // 2, (y0 + y1 + 1 - kante) // 2, kante)


def aufs_raster(bild, feld, raster=RASTER):
    """Beliebiges Bild (2D) in das quadratische Umriss-Feld übernehmen."""
    x0, y0, kante = feld
    h, w = bild.shape
    yi = np.clip(((np.arange(raster) + 0.5) * kante / raster + y0).astype(int), 0, h - 1)
    xi = np.clip(((np.arange(raster) + 0.5) * kante / raster + x0).astype(int), 0, w - 1)
    return bild[yi][:, xi]


def passend(maske, raster=RASTER):
    feld = umriss_feld(maske)
    return None if feld is None else aufs_raster(maske, feld, raster) > 0.5


def fuellen(karte, belegt, runden=90):
    """Leeres Umfeld mit dem nächstgelegenen Wert auffüllen. Ohne das mischt die Interpolation
    im Browser echte Tiefen mit Nullen, und außerhalb des Modells fiele die App auf die Foto-Tiefe
    zurück — beides erzeugt Punktschleier quer durch den Block."""
    a = np.where(belegt, karte, np.nan)
    for _ in range(runden):
        fehlt = np.isnan(a)
        if not fehlt.any():
            break
        summe = np.zeros_like(a)
        zahl = np.zeros_like(a)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = np.roll(np.roll(a, dy, 0), dx, 1)
            gut = ~np.isnan(n)
            summe[gut] += n[gut]
            zahl[gut] += 1
        mittel = np.divide(summe, zahl, out=np.zeros_like(a), where=zahl > 0)
        a = np.where(fehlt & (zahl > 0), mittel, a)
    return np.nan_to_num(a)


def ueberdeckung(a, b):
    schnitt = np.logical_and(a, b).sum()
    vereinigung = np.logical_or(a, b).sum()
    return float(schnitt) / float(vereinigung) if vereinigung else 0.0


def ausrichten(V, F, foto_maske, foto_tiefe=None):
    """Beste Drehung suchen: Umriss gegen Foto-Umriss PLUS Tiefenvergleich mit der
    KI-Tiefenkarte des Fotos. Der Tiefenteil ist entscheidend — sonst kann das Modell
    mit dem Hinterkopf nach vorne landen (gleicher Umriss, vertauschte Tiefe)."""
    feld = umriss_feld(foto_maske)
    ziel = None if feld is None else aufs_raster(foto_maske, feld) > 0.5
    tiefe_ziel = None if (feld is None or foto_tiefe is None) else aufs_raster(foto_tiefe, feld)
    P0 = flaechenpunkte(V, F)
    beste = None
    for name, R in DREHUNGEN.items():
        vorn, hinten, belegt, s, _ = karten(P0 @ R.T)
        vorn, hinten, belegt = np.flipud(vorn), np.flipud(hinten), np.flipud(belegt)   # Bildzeilen: 0 = oben
        u = ueberdeckung(belegt, ziel) if ziel is not None else 0.0
        korr = 0.0
        if tiefe_ziel is not None:
            g = belegt & ziel
            if g.sum() > 200:
                a, b = -vorn[g], tiefe_ziel[g]       # beide: groß = nah am Betrachter
                if a.std() > 1e-6 and b.std() > 1e-6:
                    korr = float(np.corrcoef(a, b)[0, 1])
        wert = u + korr
        if beste is None or wert > beste[0]:
            beste = (wert, u, korr, name, vorn, hinten, belegt)
    return (feld,) + beste


def bauen(bild_pfad, foto_maske, foto_tiefe=None):
    """Foto → Modell → Karten. foto_maske/foto_tiefe: 2D-Arrays in Masken-Auflösung."""
    from gradio_client import Client, handle_file
    token = None
    try:
        token = open(TOKEN_DATEI).read().strip() or None
    except OSError:
        pass
    kw = {}
    if token:
        name = 'token' if 'token' in inspect.signature(Client.__init__).parameters else 'hf_token'
        kw[name] = token
    c = Client(SPACE, verbose=False, **kw)
    r = c.predict(image=handle_file(bild_pfad), api_name='/shape_generation')
    datei = r[0]['value'] if isinstance(r[0], dict) else r[0]
    if not (datei and os.path.isfile(datei)):
        raise RuntimeError('Space lieferte keine Modelldatei')
    V, F = glb_laden(datei)
    feld, wert, u, korr, name, vorn, hinten, belegt = ausrichten(V, F, foto_maske, foto_tiefe)
    if not belegt.any():
        raise RuntimeError('Modell ohne sichtbare Fläche')
    # Gesamttiefe des Körpers (nicht die dickste Stelle) — danach richtet die App die Relief-Tiefe aus.
    # Robuste Grenzen: einzelne Zipfel des erzeugten Netzes sollen den Maßstab nicht bestimmen.
    unten = float(np.percentile(vorn[belegt], 0.5))
    oben = float(np.percentile(hinten[belegt], 99.5))
    vorn = np.clip(vorn, unten, oben)
    hinten = np.clip(hinten, unten, oben)
    dicke = oben - unten
    null = float(((vorn[belegt] + hinten[belegt]) / 2).mean())
    vorn, hinten = fuellen(vorn, belegt), fuellen(hinten, belegt)
    return {
        'raster': RASTER, 'drehung': name, 'passung': round(u, 3), 'tiefenpassung': round(korr, 3),
        'dicke': dicke,                       # größte Tiefe in Raster-Pixeln
        'feld': [int(feld[0]), int(feld[1]), int(feld[2])],   # x0, y0, Kante in Masken-Pixeln
        'vorn': np.where(belegt, vorn - null, 0.0), 'hinten': np.where(belegt, hinten - null, 0.0),
        'belegt': belegt, 'dreiecke': int(len(F)),
    }


def als_json(k):
    """Karten als base64-uint16 mit gemeinsamer Skala (für die Übertragung)."""
    v, h, b = k['vorn'], k['hinten'], k['belegt']
    lo = float(min(v[b].min(), h[b].min())) if b.any() else 0.0
    hi = float(max(v[b].max(), h[b].max())) if b.any() else 1.0
    sp = hi - lo if hi > lo else 1.0
    kod = lambda a: base64.b64encode((np.clip((a - lo) / sp, 0, 1) * 65535 + 0.5
                                      ).astype('<u2').tobytes()).decode()
    return {'raster': k['raster'], 'drehung': k['drehung'], 'feld': k['feld'],
            'passung': k['passung'], 'tiefenpassung': k['tiefenpassung'],
            'dicke': k['dicke'], 'dreiecke': k['dreiecke'], 'lo': lo, 'spanne': sp,
            'vorn': kod(v), 'hinten': kod(h),
            'belegt': base64.b64encode(np.packbits(b).tobytes()).decode()}


if __name__ == '__main__':
    import sys
    V, F = glb_laden(sys.argv[1])
    print('Ecken', len(V), 'Dreiecke', len(F))
    print('Umfang', V.min(0).round(3), V.max(0).round(3))
