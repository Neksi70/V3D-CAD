# Scan = eine Punktwolke mit optionaler Farbe und Normalen.
#
# Gehalten wird alles als numpy float32/uint8 (halber Speicher gegenueber
# Open3D, das intern float64 nutzt). Fuer Rechnungen wird bei Bedarf eine
# Open3D-Wolke erzeugt. Einheit ist mm - so exportieren Revo Scan und
# CrealityScan.

import os

import numpy as np

from .o3d import o3d

EINLESBAR = (".ply", ".pcd", ".xyz", ".xyzn", ".xyzrgb", ".pts", ".asc", ".txt",
             ".csv", ".obj", ".stl", ".off", ".gltf", ".glb")
AUSGEBBAR = ("ply", "pcd", "xyz", "asc")
NETZ_ENDUNGEN = (".obj", ".stl", ".off", ".gltf", ".glb")


class Scan:
    def __init__(self, name, xyz, rgb=None, nrm=None):
        self.id = 0
        self.name = name
        self.xyz = np.ascontiguousarray(xyz, dtype=np.float32).reshape(-1, 3)
        n = len(self.xyz)
        self.rgb = None if rgb is None else \
            np.ascontiguousarray(rgb, dtype=np.uint8).reshape(n, 3)
        self.nrm = None if nrm is None else \
            np.ascontiguousarray(nrm, dtype=np.float32).reshape(n, 3)
        self.rev = 1              # steigt bei jeder Datenaenderung
        self.sichtbar = True
        self.fest = False         # Referenz beim Ausrichten
        self.farbe = "#4fa3e0"    # Anzeigefarbe im Modus "Scanfarbe"

    def __len__(self):
        return len(self.xyz)

    def kopie(self):
        s = Scan(self.name, self.xyz.copy(),
                 None if self.rgb is None else self.rgb.copy(),
                 None if self.nrm is None else self.nrm.copy())
        s.id, s.rev, s.sichtbar, s.fest, s.farbe = \
            self.id, self.rev, self.sichtbar, self.fest, self.farbe
        return s

    def bytes(self):
        return self.xyz.nbytes + (0 if self.rgb is None else self.rgb.nbytes) \
            + (0 if self.nrm is None else self.nrm.nbytes)

    def geaendert(self):
        self.rev += 1

    # --- Datenaenderungen -------------------------------------------------
    def behalte(self, maske):
        """Nur die Punkte mit maske==True behalten."""
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
            self.nrm = (self.nrm.astype(np.float64) @ R.T).astype(np.float32)
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

    @staticmethod
    def aus_o3d(name, p):
        xyz = np.asarray(p.points)
        rgb = (np.clip(np.asarray(p.colors), 0, 1) * 255 + 0.5).astype(np.uint8) \
            if p.has_colors() else None
        nrm = np.asarray(p.normals) if p.has_normals() else None
        return Scan(name, xyz, rgb, nrm)


# --- Einlesen -------------------------------------------------------------
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

    if endung in (".asc", ".txt", ".csv"):
        xyz, rgb, nrm = _text_einlesen(pfad)
        return Scan(name, xyz, rgb, nrm)

    netz = None
    if endung in NETZ_ENDUNGEN or endung == ".ply":
        netz = o3d.io.read_triangle_mesh(pfad)
        if not netz.has_triangles():
            netz = None
    if netz is not None:
        # Scanner-Netze sind dicht genug: die Eckpunkte sind die Punktwolke.
        netz.remove_duplicated_vertices()
        if not netz.has_vertex_normals():
            netz.compute_vertex_normals()
        xyz = np.asarray(netz.vertices)
        if len(xyz) == 0:
            raise ValueError("Die Datei enthält keine Punkte.")
        rgb = (np.clip(np.asarray(netz.vertex_colors), 0, 1) * 255 + 0.5) \
            .astype(np.uint8) if netz.has_vertex_colors() else None
        return Scan(name, xyz, rgb, np.asarray(netz.vertex_normals))

    p = o3d.io.read_point_cloud(pfad)
    if not p.has_points():
        raise ValueError("Die Datei enthält keine Punkte.")
    return Scan.aus_o3d(name, p)


# --- Ausgeben -------------------------------------------------------------
def ausgeben(scan, pfad, fmt):
    fmt = fmt.lower()
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
