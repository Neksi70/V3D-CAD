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

a = Analysis(
    ["exe_start.py"],
    pathex=["."],
    binaries=collect_dynamic_libs("open3d"),
    datas=[("web", "web")],
    hiddenimports=["server", "kern", "kern.o3d", "kern.wolke", "kern.werkzeuge",
                   "kern.registrierung", "kern.projekt", "open3d.visualization.draw_plotly",
                   "open3d.visualization.to_mitsuba"] + open3d_module
                  + [m for m in collect_submodules("numpy") if ".tests" not in m],
    hookspath=[NUMPY_HOOKS],
    runtime_hooks=[],
    excludes=["tkinter", "unittest", "pydoc", "doctest", "IPython", "ipywidgets",
              "matplotlib", "pandas", "sklearn", "scipy", "dash", "plotly", "PIL",
              "torch", "tensorflow"],
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
