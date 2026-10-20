# Scan = eine Punktwolke mit optionaler Farbe und Normalen.
#
# Gehalten wird alles als numpy float32/uint8 (halber Speicher gegenueber
# Open3D, das intern float64 nutzt). Fuer Rechnungen wird bei Bedarf eine
# Open3D-Wolke erzeugt. Einheit ist mm - so exportieren Revo Scan und
# CrealityScan.

import os

import numpy as np

from .o3d import o3d

EINLESBAR = (".ptx", ".ply", ".pcd", ".xyz", ".xyzn", ".xyzrgb", ".pts", ".asc", ".txt",
             ".csv", ".obj", ".stl", ".off", ".gltf", ".glb")
AUSGEBBAR = ("ply", "pcd", "xyz", "asc")            # Punktwolke
AUSGEBBAR_NETZ = ("stl", "obj", "ply", "off", "glb")  # Netz
NETZ_ENDUNGEN = (".obj", ".stl", ".off", ".gltf", ".glb")


class Scan:
    """Punktwolke oder - mit tri (M x 3 Eckpunkt-Indizes) - Dreiecksnetz."""

    def __init__(self, name, xyz, rgb=None, nrm=None, tri=None):
        self.id = 0
        self.name = name
        self.xyz = np.ascontiguousarray(xyz, dtype=np.float32).reshape(-1, 3)
        n = len(self.xyz)
        self.rgb = None if rgb is None else \
            np.ascontiguousarray(rgb, dtype=np.uint8).reshape(n, 3)
        self.nrm = None if nrm is None else \
            np.ascontiguousarray(nrm, dtype=np.float32).reshape(n, 3)
        self.tri = None if tri is None else \
            np.ascontiguousarray(tri, dtype=np.int32).reshape(-1, 3)
        self.rev = 1              # steigt bei jeder Datenaenderung
        self.sichtbar = True
        self.fest = False         # Referenz beim Ausrichten
        self.farbe = "#4fa3e0"    # Anzeigefarbe im Modus "Scanfarbe"

    def __len__(self):
        return len(self.xyz)

    @property
    def ist_netz(self):
        return self.tri is not None

    def kopie(self):
        s = Scan(self.name, self.xyz.copy(),
                 None if self.rgb is None else self.rgb.copy(),
                 None if self.nrm is None else self.nrm.copy(),
                 None if self.tri is None else self.tri.copy())
        s.id, s.rev, s.sichtbar, s.fest, s.farbe = \
            self.id, self.rev, self.sichtbar, self.fest, self.farbe
        return s

    def bytes(self):
        return self.xyz.nbytes + (0 if self.rgb is None else self.rgb.nbytes) \
            + (0 if self.nrm is None else self.nrm.nbytes) \
            + (0 if self.tri is None else self.tri.nbytes)

    def geaendert(self):
        self.rev += 1

    # --- Datenaenderungen -------------------------------------------------
    def behalte(self, maske):
        """Nur die Punkte mit maske==True behalten. Beim Netz fallen alle
        Dreiecke weg, die einen geloeschten Eckpunkt benutzen."""
        maske = np.asarray(maske, bool)
        if self.tri is not None:
            neu_index = np.cumsum(maske, dtype=np.int64) - 1
            bleibt = maske[self.tri].all(axis=1)
            self.tri = np.ascontiguousarray(neu_index[self.tri[bleibt]].astype(np.int32))
        self.xyz = np.ascontiguousarray(self.xyz[maske])
        if self.rgb is not None:
            self.rgb = np.ascontiguousarray(self.rgb[maske])
        if self.nrm is not None:
            self.nrm = np.ascontiguousarray(self.nrm[maske])
        self.geaendert()

    def transformiere(self, T):
        T = np.asarray(T, dtype=np.float64).reshape(4, 4)
        R, t = T[:3, :3], T[:3, 3]
        self.xyz = (self.xyz.astype(np.float64) @ R.T + t).astype(np.float32)
        if self.nrm is not None:
            # Normalen mit der inversen Transponierten (richtig auch bei Skalierung/Spiegelung)
            Ni = np.linalg.inv(R).T
            n = self.nrm.astype(np.float64) @ Ni.T
            n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
            self.nrm = n.astype(np.float32)
        if self.tri is not None and np.linalg.det(R) < 0:
            self.tri = np.ascontiguousarray(self.tri[:, [0, 2, 1]])   # Spiegelung: Umlauf umkehren
        self.geaendert()

    # --- Open3D -----------------------------------------------------------
    def zu_o3d(self, farbe=False, normalen=True):
        p = o3d.geometry.PointCloud(
            o3d.utility.Vector3dVector(self.xyz.astype(np.float64)))
        if normalen and self.nrm is not None:
            p.normals = o3d.utility.Vector3dVector(self.nrm.astype(np.float64))
        if farbe and self.rgb is not None:
            p.colors = o3d.utility.Vector3dVector(self.rgb / 255.0)
        return p

    def zu_o3d_netz(self, farbe=True):
        m = o3d.geometry.TriangleMesh(
            o3d.utility.Vector3dVector(self.xyz.astype(np.float64)),
            o3d.utility.Vector3iVector(self.tri.astype(np.int32)))
        if farbe and self.rgb is not None:
            m.vertex_colors = o3d.utility.Vector3dVector(self.rgb / 255.0)
        if self.nrm is not None:
            m.vertex_normals = o3d.utility.Vector3dVector(self.nrm.astype(np.float64))
        return m

    @staticmethod
    def aus_o3d_netz(name, m, normalen=True):
        if normalen:
            m.compute_vertex_normals()
        xyz = np.asarray(m.vertices)
        rgb = (np.clip(np.asarray(m.vertex_colors), 0, 1) * 255 + 0.5).astype(np.uint8) \
            if m.has_vertex_colors() else None
        nrm = np.asarray(m.vertex_normals) if m.has_vertex_normals() else None
        return Scan(name, xyz, rgb, nrm, np.asarray(m.triangles))

    @staticmethod
    def aus_o3d(name, p):
        xyz = np.asarray(p.points)
        rgb = (np.clip(np.asarray(p.colors), 0, 1) * 255 + 0.5).astype(np.uint8) \
            if p.has_colors() else None
        nrm = np.asarray(p.normals) if p.has_normals() else None
        return Scan(name, xyz, rgb, nrm)


# --- Einlesen -------------------------------------------------------------
def _ptx_einlesen(pfad, name, max_kante=None):
    """Leica PTX (Raster-Punktwolke langreichweitiger Scanner): je Scan Kopf (Spalten, Zeilen,
    Scannerposition, Achsen, 4x4-Matrix) und Zeilen x y z i [r g b]; (0,0,0) = kein Messpunkt.
    Aus dem Raster wird direkt ein Netz (Nachbarn im Raster, Kanten bis max_kante)."""
    with open(pfad, "r", encoding="utf-8", errors="replace") as f:
        zeilen = f.read().split("\n")
    pos = 0
    alle_xyz, alle_rgb, alle_tri, versatz = [], [], [], 0
    hat_rgb = True
    while pos < len(zeilen) - 10:
        if not zeilen[pos].strip():
            pos += 1
            continue
        spalten, reihen = int(zeilen[pos].split()[0]), int(zeilen[pos + 1].split()[0])
        M = np.array([[float(x) for x in zeilen[pos + 6 + k].split()[:4]] for k in range(4)])
        pos += 10
        n = spalten * reihen
        werte = np.array([z.split() for z in zeilen[pos:pos + n]], dtype=object)
        pos += n
        breite = min(len(w) for w in werte)
        W = np.array([[float(x) for x in w[:breite]] for w in werte])
        xyz = W[:, :3] @ M[:3, :3] + M[3, :3]             # PTX: Zeilenvektor * Matrix, Translation unten
        gueltig = np.any(W[:, :3] != 0, axis=1)
        if breite >= 7:
            alle_rgb.append(W[:, 4:7])
        else:
            hat_rgb = False
        # Raster: Index = spalte * reihen + reihe
        idx = np.arange(n).reshape(spalten, reihen)
        a, b, c, d = idx[:-1, :-1].ravel(), idx[1:, :-1].ravel(), idx[1:, 1:].ravel(), idx[:-1, 1:].ravel()
        T = np.r_[np.c_[a, b, c], np.c_[a, c, d]]
        T = T[gueltig[T].all(1)]
        if len(T):
            L = np.max([np.linalg.norm(xyz[T[:, i]] - xyz[T[:, (i + 1) % 3]], axis=1) for i in range(3)], axis=0)
            grenze = max_kante or 6 * float(np.median(L))
            T = T[L <= grenze]
        alle_xyz.append(xyz)
        alle_tri.append(T + versatz)
        versatz += n
    if not alle_xyz:
        raise ValueError("Die PTX-Datei enthält keine Scans.")
    xyz = np.concatenate(alle_xyz)
    tri = np.concatenate(alle_tri) if alle_tri else np.zeros((0, 3), int)
    rgb = np.concatenate(alle_rgb).clip(0, 255).astype(np.uint8) if hat_rgb and alle_rgb else None
    benutzt = np.zeros(len(xyz), bool)
    benutzt[tri.ravel()] = True
    neu = -np.ones(len(xyz), np.int64)
    neu[benutzt] = np.arange(benutzt.sum())
    s = Scan(name, xyz[benutzt], None if rgb is None else rgb[benutzt], None, neu[tri] if len(tri) else None)
    return s


def _text_einlesen(pfad):
    """ASC/XYZ/TXT/CSV: Spalten x y z [r g b] [nx ny nz], Trenner beliebig."""
    with open(pfad, "r", encoding="utf-8", errors="replace") as f:
        zeilen = f.read()
    zeilen = zeilen.replace(",", " ").replace(";", " ").replace("\t", " ")
    werte = None
    # Schnellweg: Kopfzeilen nur am Anfang, danach eine Zahlentabelle.
    kopf = zeilen[:20000].splitlines()
    for i, z in enumerate(kopf[:-1]):
        teile = z.split()
        try:
            [float(x) for x in teile]
        except ValueError:
            continue
        if len(teile) >= 3 and not z.lstrip().startswith(("#", "/", "%")):
            rest = zeilen.split("\n", i)[-1] if i else zeilen
            try:
                flach = np.array(rest.split(), dtype=np.float64)
                if flach.size % len(teile) == 0:
                    werte = flach.reshape(-1, len(teile))
            except ValueError:
                pass
            break
    if werte is None:
        # Langsamer Weg: Zeile fuer Zeile, Kommentare/Kopf/Abweichler raus.
        daten, spalten = [], 0
        for z in zeilen.splitlines():
            z = z.strip()
            if not z or z[0] in "#/%":
                continue
            teile = z.split()
            try:
                [float(x) for x in teile]
            except ValueError:
                continue
            if not spalten:
                spalten = len(teile)
            if len(teile) == spalten:
                daten.append(z)
        if spalten < 3:
            raise ValueError("Keine Koordinaten gefunden (mindestens 3 Spalten x y z).")
        werte = np.array(" ".join(daten).split(), dtype=np.float64) \
            .reshape(-1, spalten)
    spalten = werte.shape[1]
    xyz = werte[:, :3]
    rgb = nrm = None

    def ist_normale(b):
        laenge = np.linalg.norm(b[: min(len(b), 2000)], axis=1)
        return np.abs(b).max() <= 1.0001 and np.median(np.abs(laenge - 1)) < 0.02

    def als_farbe(b):
        if b.max() <= 1.0:
            b = b * 255
        return np.clip(b, 0, 255).astype(np.uint8)

    if spalten >= 9:
        rgb, nrm = als_farbe(werte[:, 3:6]), werte[:, 6:9]
        if ist_normale(werte[:, 3:6]) and not ist_normale(werte[:, 6:9]):
            nrm, rgb = werte[:, 3:6], als_farbe(werte[:, 6:9])
    elif spalten >= 6:
        b = werte[:, 3:6]
        if ist_normale(b):
            nrm = b
        else:
            rgb = als_farbe(b)
    return xyz, rgb, nrm


def einlesen(pfad, name=None):
    name = name or os.path.basename(pfad)
    endung = os.path.splitext(pfad)[1].lower()
    if endung not in EINLESBAR:
        raise ValueError("Dateiformat %s wird nicht unterstützt." % endung)

    if endung == ".ptx":
        return _ptx_einlesen(pfad, name)
    if endung in (".asc", ".txt", ".csv"):
        xyz, rgb, nrm = _text_einlesen(pfad)
        return Scan(name, xyz, rgb, nrm)

    netz = None
    if endung in NETZ_ENDUNGEN or endung == ".ply":
        netz = o3d.io.read_triangle_mesh(pfad)
        if not netz.has_triangles():
            netz = None
    if netz is not None:
        # STL hat keine gemeinsamen Eckpunkte - erst verschweissen, sonst ist
        # jedes Dreieck eine eigene Insel.
        netz.remove_duplicated_vertices()
        if len(netz.vertices) == 0:
            raise ValueError("Die Datei enthält keine Punkte.")
        return Scan.aus_o3d_netz(name, netz, normalen=True)

    p = o3d.io.read_point_cloud(pfad)
    if not p.has_points():
        raise ValueError("Die Datei enthält keine Punkte.")
    return Scan.aus_o3d(name, p)


# --- Ausgeben -------------------------------------------------------------
def ausgeben(scan, pfad, fmt):
    fmt = fmt.lower()
    if scan.ist_netz and fmt in AUSGEBBAR_NETZ:
        m = scan.zu_o3d_netz()
        if fmt == "stl":
            m.compute_triangle_normals()
        ok = o3d.io.write_triangle_mesh(pfad, m, write_ascii=False,
                                        write_vertex_colors=scan.rgb is not None)
        if not ok:
            raise IOError("Schreiben fehlgeschlagen: %s" % pfad)
        return
    if fmt not in AUSGEBBAR:
        raise ValueError("Unbekanntes Ausgabeformat %s" % fmt)
    if fmt in ("ply", "pcd"):
        ok = o3d.io.write_point_cloud(pfad, scan.zu_o3d(farbe=True),
                                      write_ascii=False)
        if not ok:
            raise IOError("Schreiben fehlgeschlagen: %s" % pfad)
        return
    spalten = [scan.xyz]
    formate = ["%.4f"] * 3
    if fmt == "asc" and scan.rgb is not None:
        spalten.append(scan.rgb)
        formate += ["%d"] * 3
    if fmt in ("asc", "xyz") and scan.nrm is not None:
        spalten.append(scan.nrm)
        formate += ["%.5f"] * 3
    tabelle = np.hstack([s.astype(np.float64) for s in spalten])
    with open(pfad, "w", encoding="ascii", newline="\n") as f:
        np.savetxt(f, tabelle, fmt=" ".join(formate))
