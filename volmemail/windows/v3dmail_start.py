#!/usr/bin/env python3
"""V3D Mail als Windows-App: öffnet den Web-Client in einem eigenen
App-Fenster (Edge/Chrome --app=..., ohne Browser-Rahmen).

Kein eigener Browser-Motor, keine Runtime-Abhängigkeit: Edge ist auf
jedem Windows 10/11 vorhanden. Anmeldung/Cookies teilen sich mit dem
normalen Browser-Profil, die Sitzung bleibt also erhalten.
"""

import os
import subprocess
import sys
import webbrowser

URL = 'https://v3da.tailf05fe9.ts.net/mail/'

# mailto:... als Argument (z.B. wenn die EXE als Mail-Programm verknüpft ist)
if len(sys.argv) > 1 and sys.argv[1].startswith('mailto:'):
    import urllib.parse
    URL += '?compose=' + urllib.parse.quote(sys.argv[1], safe='')


def kandidaten():
    pf = os.environ.get('ProgramFiles', r'C:\Program Files')
    pf86 = os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')
    lokal = os.environ.get('LocalAppData', '')
    for basis in (pf86, pf):
        yield os.path.join(basis, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    for basis in (pf, pf86):
        yield os.path.join(basis, 'Google', 'Chrome', 'Application', 'chrome.exe')
    if lokal:
        yield os.path.join(lokal, 'Google', 'Chrome', 'Application', 'chrome.exe')


def main():
    for exe in kandidaten():
        if os.path.isfile(exe):
            subprocess.Popen([exe, '--app=' + URL],
                             creationflags=getattr(subprocess, 'DETACHED_PROCESS', 0))
            return
    # Notnagel: normaler Browser-Tab
    webbrowser.open(URL)


if __name__ == '__main__':
    main()
