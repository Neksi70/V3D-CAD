# -*- mode: python ; coding: utf-8 -*-
# Bauanleitung fuer die EXE.  Bauen mit:
#     wine python -m PyInstaller VolmeInventar.spec --noconfirm
#
# Bewusst OHNE uac_admin: das Werkzeug liest nur und soll auch auf einem
# Kurs-PC ohne Administratorkennwort starten.  Was ohne Rechte fehlt, sagt
# der Bericht selbst.

a = Analysis(
    ['exe_start.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=['inventar', 'oberflaeche', 'bericht', 'programme',
                   'verknuepfungen', 'lnk', 'windowsteile'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Was nicht gebraucht wird, macht die EXE nur gross und den Start langsam.
    excludes=['numpy', 'PIL', 'pydoc', 'pytest', 'unittest', 'setuptools',
              'pip', 'email', 'http', 'xml', 'multiprocessing', 'sqlite3',
              'ssl', 'asyncio', 'distutils', 'lib2to3', 'test'],
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
    name='VolmeInventar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
