# -*- mode: python ; coding: utf-8 -*-
# PyInstaller-Bauplan fuer V3DScan.exe (gebaut unter Wine, siehe bau_exe.sh).
#
# Open3D bringt 180 MB mit; gebraucht werden nur die Python-Module und die
# pybind-DLL. GUI-Ressourcen, Beispiele, Jupyter- und ML-Teile bleiben draussen.

import os
import numpy
from PyInstaller.utils.hooks import collect_dynamic_libs, collect_submodules

# numpy 2 bringt seinen eigenen Hook mit; PyInstaller 5.13 findet ihn in der
# eingebetteten Python-Umgebung nicht von selbst (-> "numpy._core._exceptions").
NUMPY_HOOKS = os.path.join(os.path.dirname(numpy.__file__), "_pyinstaller")

WEG = ("open3d.ml.tf", "open3d.ml.torch", "open3d.ml.contrib", "open3d.examples", "open3d.visualization.tensorboard_plugin",
       "open3d.labextension", "open3d.nbextension", "open3d.web_visualizer",
       "open3d.visualization.draw_plotly", "open3d.visualization.to_mitsuba")

open3d_module = [m for m in collect_submodules("open3d") if not m.startswith(WEG)]

# OpenCASCADE (OCP) fuer Koerper/STEP: eine grosse .pyd; ihre DLLs sucht OCP/__init__ in
# ../cadquery_ocp.libs und ../vtk.libs (os.add_dll_directory) -> genau so ablegen.
# Nur die tatsaechlich referenzierten DLLs (rekursiv ueber eingebettete Namen):
# 108 von 264, 110 statt 201 MB.
import re
SITE = os.path.dirname(os.path.dirname(numpy.__file__))
OCP_PYD = os.path.join(SITE, "OCP", "OCP.cp311-win_amd64.pyd")
_dll_ordner = {}
for _o in ("cadquery_ocp.libs", "vtk.libs"):
    for _f in os.listdir(os.path.join(SITE, _o)):
        _dll_ordner[_f.lower()] = (os.path.join(SITE, _o, _f), _o)
_rx = re.compile(rb"[A-Za-z0-9_.\-]{3,120}\.dll", re.I)
_gesehen, _stapel = set(), [OCP_PYD]
while _stapel:
    with open(_stapel.pop(), "rb") as _d:
        _namen = {m.decode().lower() for m in _rx.findall(_d.read())}
    for _n in _namen:
        if _n in _dll_ordner and _n not in _gesehen:
            _gesehen.add(_n)
            _stapel.append(_dll_ordner[_n][0])
ocp_binaries = [(OCP_PYD, "OCP")] + [_dll_ordner[_n] for _n in sorted(_gesehen)]

a = Analysis(
    ["exe_start.py"],
    pathex=["."],
    binaries=collect_dynamic_libs("open3d") + collect_dynamic_libs("pynanoinstantmeshes") + ocp_binaries,
    datas=[("web", "web")],
    hiddenimports=["server", "kern", "kern.o3d", "kern.wolke", "kern.werkzeuge",
                   "kern.registrierung", "kern.projekt", "kern.netz", "kern.formen", "kern.koordinaten", "kern.erkennung", "kern.koerper", "kern.skizze", "kern.features",
                   "kern.freiform", "kern.referenz", "kern.verlauf", "kern.loeser", "kern.e57", "kern.sicherung", "pynanoinstantmeshes", "pynanoinstantmeshes._pynim", "OCP", "open3d.visualization.draw_plotly",
                   "open3d.visualization.to_mitsuba"] + open3d_module
                  + [m for m in collect_submodules("numpy") if ".tests" not in m],
    hookspath=[NUMPY_HOOKS],
    runtime_hooks=[],
    excludes=["tkinter", "unittest", "pydoc", "doctest", "IPython", "ipywidgets",
              "matplotlib", "pandas", "sklearn", "scipy", "dash", "plotly", "PIL",
              "torch", "tensorflow", "vtkmodules", "vtk"],
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="V3DScan",
    debug=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=bool(os.environ.get("V3DSCAN_KONSOLE")),
    icon="v3dscan.ico",
)
