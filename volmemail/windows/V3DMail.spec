# -*- mode: python ; coding: utf-8 -*-
# PyInstaller-Spec für V3DMail.exe (Starter, ein einziges File, ohne Konsole)

a = Analysis(
    ['v3dmail_start.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[],
    excludes=['tkinter', 'unittest', 'pydoc', 'doctest'],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='V3DMail',
    icon='V3DMail.ico',
    debug=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
)
