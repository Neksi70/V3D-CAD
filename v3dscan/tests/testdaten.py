#!/usr/bin/env python3
# Kuenstliche Scans erzeugen, solange keine echten Miraco-/PiKa-Exporte da sind.
#
# Nachgebildet wird, was echte Handscanner liefern:
#   - Teilansichten (nur, was von der Scannerposition aus sichtbar ist)
#   - Tischplatte unter dem Objekt
#   - Messrauschen, verstreute Ausreisser, eine abgetrennte "Hand"-Insel
#   - jede Ansicht in ihrem eigenen Koordinatensystem (zufaellig verschoben
#     und gedreht) -> die Sollmatrix steht in soll.json
# Einheit mm, Y zeigt nach oben.
#
#   python3 tests/testdaten.py [zielordner]

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from kern.o3d import o3d  # noqa: E402
from kern.wolke import Scan, ausgeben  # noqa: E402


def objekt():
    """Unsymmetrische Figur: Sockel, Turm, Ring, Kugel, schraeger Keil."""
    teile = []
    sockel = o3d.geometry.TriangleMesh.create_box(80, 20, 50)
    sockel.translate((-40, 0, -25))
    teile.append(sockel)
    turm = o3d.geometry.TriangleMesh.create_cylinder(12, 60, 48, 8)
    turm.rotate(o3d.geometry.get_rotation_matrix_from_xyz((np.pi / 2, 0, 0)), (0, 0, 0))
    turm.translate((-20, 50, 0))
    teile.append(turm)
    ring = o3d.geometry.TriangleMesh.create_torus(18, 5, 48, 24)
    ring.translate((22, 38, 0))
    teile.append(ring)
    kugel = o3d.geometry.TriangleMesh.create_sphere(10, 32)
    kugel.translate((-20, 90, 0))
    teile.append(kugel)
    keil = o3d.geometry.TriangleMesh.create_box(25, 25, 25)
    keil.rotate(o3d.geometry.get_rotation_matrix_from_xyz((0.3, 0.7, 0.2)), (0, 0, 0))
    keil.translate((25, 18, 18))
    teile.append(keil)
    netz = teile[0]
    for t in teile[1:]:
        netz += t
    netz.compute_vertex_normals()
    netz.compute_triangle_normals()
    return netz


def einfaerben(xyz):
    t = (xyz - xyz.min(0)) / np.ptp(xyz, 0).clip(1e-6)
    return (np.stack([0.35 + 0.6 * t[:, 0], 0.3 + 0.5 * t[:, 1],
                      0.8 - 0.5 * t[:, 2]], 1) * 255).astype(np.uint8)


def zufalls_matrix(rng, winkel_grad=35, weg=60):
    w = np.radians(rng.uniform(-winkel_grad, winkel_grad, 3))
    T = np.eye(4)
    T[:3, :3] = o3d.geometry.get_rotation_matrix_from_xyz(w)
    T[:3, 3] = rng.uniform(-weg, weg, 3)
    return T


def erzeugen(ziel, punkte=250000, seed=42):
    rng = np.random.default_rng(seed)
    os.makedirs(ziel, exist_ok=True)
    netz = objekt()
    wolke = netz.sample_points_uniformly(punkte, use_triangle_normal=True)
    obj = np.asarray(wolke.points)
    obj_n = np.asarray(wolke.normals)

    # Tischplatte 260 x 260 mm bei y = 0 (Sockel steht darauf)
    tisch = np.column_stack([rng.uniform(-130, 130, 90000), np.zeros(90000),
                             rng.uniform(-130, 130, 90000)])
    alle = np.vstack([obj, tisch])
    normalen = np.vstack([obj_n, np.tile([0, 1, 0], (len(tisch), 1))])
    farben = np.vstack([einfaerben(obj), np.full((len(tisch), 3), 90, np.uint8)])

    # Scanner-Positionen rundherum im Abstand 70 deg -> je ~40-50 % Ueberlappung
    # am Objekt, wie es Revo/Creality fuers Zusammenfuehren empfehlen.
    ansichten = [(260 * np.sin(np.radians(a)), 170, 260 * np.cos(np.radians(a)))
                 for a in (0, 70, -70)]
    soll = {}
    for nr, kamera in enumerate(ansichten, 1):
        p = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(alle))
        _, sichtbar = p.hidden_point_removal(kamera, 400 * 60)
        idx = np.asarray(sichtbar)
        xyz = alle[idx] + rng.normal(0, 0.05, (len(idx), 3))
        rgb = farben[idx]
        nrm = normalen[idx]

        # Ausreisser: 0,4 % verstreut im Umfeld
        k = int(len(xyz) * 0.004)
        ausr = rng.uniform(xyz.min(0) - 20, xyz.max(0) + 20, (k, 3))
        # "Hand": Insel 60 mm neben dem Objekt
        hand = rng.normal(0, 6, (3000, 3)) + np.array([90, 60, 40])
        xyz = np.vstack([xyz, ausr, hand])
        rgb = np.vstack([rgb, np.full((k, 3), 200, np.uint8),
                         np.tile([220, 170, 140], (3000, 1)).astype(np.uint8)])
        nrm = np.vstack([nrm, np.tile([0, 1, 0], (k + 3000, 1))])

        T = zufalls_matrix(rng) if nr > 1 else np.eye(4)
        # Datei liegt in ihrem eigenen System: Punkte mit inv(T) verschieben,
        # die richtige Ausrichtung ist dann T.
        inv = np.linalg.inv(T)
        xyz = xyz @ inv[:3, :3].T + inv[:3, 3]
        nrm = nrm @ inv[:3, :3].T
        scan = Scan("ansicht_%d" % nr, xyz, rgb, nrm)
        fmt = "asc" if nr == 3 else "ply"
        datei = "ansicht_%d.%s" % (nr, fmt)
        ausgeben(scan, os.path.join(ziel, datei), fmt)
        soll[datei] = {"matrix": T.tolist(), "punkte": len(xyz),
                       "ausreisser": k, "hand": 3000}
        print("%s: %d Punkte" % (datei, len(xyz)))

    netz_datei = os.path.join(ziel, "objekt_netz.stl")
    o3d.io.write_triangle_mesh(netz_datei, netz)
    scan_netz_erzeugen(ziel, rng)
    soll["bauteil.ply"] = bauteil_erzeugen(ziel, rng)
    with open(os.path.join(ziel, "soll.json"), "w") as f:
        json.dump(soll, f, indent=1)
    return soll


def bauteil_erzeugen(ziel, rng):
    """Technisches Teil wie vom MIRACO: Platte 60 x 40 x 15 mm mit Bohrung
    Ø 10,03 mm bei X 35 / Y 20 (Z nach oben, Ursprung Plattenecke unten),
    als verrauschte Punktwolke schraeg im Raum. Soll-Matrix bringt den Scan
    zurueck ins Bauteil-System."""
    n = 120000
    teile = []
    # Deckel und Boden ohne Bohrung, 4 Seiten, Bohrungswand
    for z in (0.0, 15.0):
        p = np.column_stack([rng.uniform(0, 60, n // 4), rng.uniform(0, 40, n // 4), np.full(n // 4, z)])
        p = p[np.hypot(p[:, 0] - 35, p[:, 1] - 20) > 5.015]
        teile.append((p, np.tile([0, 0, 1 if z else -1], (len(p), 1))))
    for achse, wert, normale in ((0, 0, [-1, 0, 0]), (0, 60, [1, 0, 0]), (1, 0, [0, -1, 0]), (1, 40, [0, 1, 0])):
        m = n // 16
        p = np.column_stack([rng.uniform(0, 60, m), rng.uniform(0, 40, m), rng.uniform(0, 15, m)])
        p[:, achse] = wert
        teile.append((p, np.tile(normale, (m, 1))))
    phi = rng.uniform(0, 2 * np.pi, n // 10)
    wand = np.column_stack([35 + 5.015 * np.cos(phi), 20 + 5.015 * np.sin(phi), rng.uniform(0, 15, len(phi))])
    teile.append((wand, np.column_stack([-np.cos(phi), -np.sin(phi), np.zeros(len(phi))])))
    xyz = np.vstack([t[0] for t in teile]) + rng.normal(0, 0.02, (sum(len(t[0]) for t in teile), 3))
    nrm = np.vstack([t[1] for t in teile])
    T = zufalls_matrix(rng, 60, 80)
    xyz = xyz @ T[:3, :3].T + T[:3, 3]
    nrm = nrm @ T[:3, :3].T
    ausgeben(Scan("bauteil", xyz, None, nrm), os.path.join(ziel, "bauteil.ply"), "ply")
    print("bauteil.ply: %d Punkte" % len(xyz))
    return {"matrix": np.linalg.inv(T).tolist(), "punkte": len(xyz)}


def scan_netz_erzeugen(ziel, rng):
    """Netz wie aus dem Scanner: geschlossene Kugel-Kappe-Figur, fein
    unterteilt, verrauscht, mit 3 Loechern, doppelten Dreiecken und einem
    losen Splitter."""
    m = o3d.geometry.TriangleMesh.create_sphere(25, 90)
    zyl = o3d.geometry.TriangleMesh.create_cylinder(10, 40, 60, 20)
    zyl.translate((0, 0, -35))
    m += zyl
    m.remove_duplicated_vertices()
    xyz = np.asarray(m.vertices) + rng.normal(0, 0.08, (len(m.vertices), 3))
    tri = np.asarray(m.triangles)
    mitte = xyz[tri].mean(1)
    loch = (np.linalg.norm(mitte - [0, 0, 25], axis=1) < 6) | \
        (np.linalg.norm(mitte - [25, 0, 0], axis=1) < 4) | \
        (np.linalg.norm(mitte - [0, -25, 0], axis=1) < 3)
    tri = np.vstack([tri[~loch], tri[:40]])
    n = len(xyz)
    splitter = np.array([[40, 40, 40], [42, 40, 40], [40, 42, 40], [40, 40, 42]], float)
    xyz = np.vstack([xyz, splitter])
    tri = np.vstack([tri, [[n, n + 1, n + 2], [n, n + 2, n + 3], [n, n + 3, n + 1]]])
    netz = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(xyz),
                                     o3d.utility.Vector3iVector(tri))
    netz.compute_vertex_normals()
    o3d.io.write_triangle_mesh(os.path.join(ziel, "scan_netz.ply"), netz)
    print("scan_netz.ply: %d Dreiecke" % len(tri))


if __name__ == "__main__":
    erzeugen(sys.argv[1] if len(sys.argv) > 1 else
             os.path.join(os.path.dirname(os.path.abspath(__file__)), "daten"))
