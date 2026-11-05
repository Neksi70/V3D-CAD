"""Sovol SV08 Max (Klipper/Moonraker) direkt per HTTP — ohne Notebook-Browser.

V3DA steht im selben LAN (192.168.178.x) wie der Drucker. Basis-Adresse über
DRUCKER_URL (Standard http://192.168.178.155), optional DRUCKER_API_KEY.
Nur Standardbibliothek (urllib), keine neuen Abhängigkeiten.

Sicherheitsregeln:
- Druck starten nur mit bett_frei=True (Volker hat bestätigt, dass das Bett leer ist).
- Während eines Drucks werden Bewegungs-/Kalibrier-/Neustart-Befehle abgelehnt,
  außer erzwingen=True. Not-Aus (M112) geht immer.
- Hochladen nur aus freigegebenen Ordnern (DRUCKER_UPLOAD_DIRS) und nur G-Code-Endungen,
  damit keine beliebigen Server-Dateien den Rechner verlassen.
"""
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from .core import MailError

URL = (os.environ.get('DRUCKER_URL') or 'http://192.168.178.155').rstrip('/')
API_KEY = os.environ.get('DRUCKER_API_KEY') or ''
UPLOAD_DIRS = [os.path.realpath(os.path.expanduser(p.strip())) for p in
               (os.environ.get('DRUCKER_UPLOAD_DIRS') or
                '~/tools/orcaslicer/ausgabe,~/Ablage,/srv/v3dmail/files').split(',') if p.strip()]
ENDUNGEN = ('.gcode', '.g', '.gco', '.bgcode', '.ufp')
MAX_UPLOAD = 500 * 1024 * 1024
KAMERAS = {1: ('/webcam/?action=snapshot', 'SV08 Max Kamera'),
           2: ('/webcam2/?action=snapshot', 'Logitech Brio')}

# Befehle, die während eines Drucks das Teil ruinieren können
GEFAEHRLICH = re.compile(
    r'^\s*(G0|G1|G2|G3|G28|G29|G92|M84|M18|QUAD_GANTRY_LEVEL|QGL|Z_TILT_ADJUST|BED_MESH_CALIBRATE|'
    r'PROBE\w*|SCREWS_TILT\w*|DEMON_START|PRINT_START|START_PRINT|SAVE_CONFIG|RESTART|'
    r'FIRMWARE_RESTART|SDCARD_\w*|FORCE_MOVE|SET_KINEMATIC_POSITION|SHAPER_CALIBRATE|'
    r'TEST_RESONANCES|PID_CALIBRATE|AUTO_SPEED\w*|CALIBRATE\w*)\b', re.I | re.M)


class DruckerFehler(MailError):
    """Wird von app.werkzeug als lesbare Fehlermeldung ausgegeben."""


def _anfrage(methode, pfad, daten=None, kopf=None, timeout=15, roh=False, zeit_ok=False):
    kopf = dict(kopf or {})
    if API_KEY:
        kopf['X-Api-Key'] = API_KEY
    if isinstance(daten, (dict, list)):
        daten = json.dumps(daten).encode()
        kopf['Content-Type'] = 'application/json'
    req = urllib.request.Request(URL + pfad, data=daten, method=methode, headers=kopf)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            inhalt = r.read()
            if roh:
                return inhalt, r.headers.get('Content-Type', '')
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read())['error']['message']
        except Exception:
            msg = e.reason
        raise DruckerFehler('Drucker antwortet %s: %s' % (e.code, msg))
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        if isinstance(getattr(e, 'reason', None), TimeoutError) or isinstance(e, TimeoutError):
            if zeit_ok:
                raise TimeoutError
            raise DruckerFehler('Drucker antwortet nicht innerhalb von %d s (%s)' % (timeout, pfad.split('?')[0]))
        raise DruckerFehler('Drucker nicht erreichbar (%s): %s' % (URL, getattr(e, 'reason', e)))
    try:
        antwort = json.loads(inhalt)
    except ValueError:
        raise DruckerFehler('Unerwartete Antwort von Moonraker')
    return antwort['result'] if isinstance(antwort, dict) and 'result' in antwort else antwort


def _objekte(*namen):
    q = '&'.join(urllib.parse.quote(n) for n in namen)
    return _anfrage('GET', '/printer/objects/query?' + q)['status']


def _dauer(sek):
    sek = int(sek or 0)
    return '%d h %02d min' % (sek // 3600, sek // 60 % 60)


def _zustand():
    return _objekte('print_stats')['print_stats']


# --- Status ----------------------------------------------------------------------

def status():
    s = _objekte('print_stats', 'heater_bed', 'extruder', 'gcode_move', 'webhooks',
                 'virtual_sdcard', 'display_status', 'toolhead')
    ps, vs, gm = s['print_stats'], s['virtual_sdcard'], s['gcode_move']
    info = ps.get('info') or {}
    ergebnis = {
        'drucker': s['webhooks']['state'],
        'meldung': s['webhooks'].get('state_message') or None,
        'druck': {
            'zustand': ps['state'],
            'datei': ps.get('filename') or None,
            'schicht': '%s/%s' % (info.get('current_layer'), info.get('total_layer'))
                       if info.get('total_layer') else None,
            'fortschritt_prozent': round((vs.get('progress') or 0) * 100, 1),
            'druckzeit': _dauer(ps.get('print_duration')),
            'gesamtzeit': _dauer(ps.get('total_duration')),
            'filament_m': round((ps.get('filament_used') or 0) / 1000, 2),
            'anzeige': (s.get('display_status') or {}).get('message') or ps.get('message') or None,
        },
        'temperatur': {
            'bett': '%.1f / %.0f °C' % (s['heater_bed']['temperature'], s['heater_bed']['target']),
            'duese': '%.1f / %.0f °C' % (s['extruder']['temperature'], s['extruder']['target']),
        },
        'bewegung': {
            'homing_origin': [round(v, 3) for v in gm['homing_origin'][:3]],
            'z_offset_live': round(gm['homing_origin'][2], 3),
            'speed_factor_prozent': round(gm['speed_factor'] * 100),
            'extrude_factor_prozent': round(gm['extrude_factor'] * 100),
            'referenziert': s['toolhead'].get('homed_axes') or '-',
        },
    }
    # Restzeit grob aus den Slicer-Metadaten
    if ps['state'] in ('printing', 'paused') and ps.get('filename'):
        try:
            meta = _anfrage('GET', '/server/files/metadata?filename=' + urllib.parse.quote(ps['filename']))
            gesamt = meta.get('estimated_time')
            if gesamt:
                ergebnis['druck']['slicer_gesamt'] = _dauer(gesamt)
                ergebnis['druck']['rest_ca'] = _dauer(max(0, gesamt - (ps.get('print_duration') or 0)))
        except DruckerFehler:
            pass
    return ergebnis


# --- G-Code ----------------------------------------------------------------------

def _konsole_seit(marke, anzahl=100):
    eintraege = _anfrage('GET', '/server/gcode_store?count=%d' % anzahl)['gcode_store']
    zeilen = []
    for e in eintraege:
        if e['time'] <= marke:
            continue
        m = e['message']
        if re.match(r'^\s*(ok\s*)?B:\s*[\d.]+\s*/', m):   # Temperatur-Meldungen
            continue
        zeilen.append(('> ' if e['type'] == 'command' else '') + m)
    return zeilen[-60:]


def gcode(script, warten=60, erzwingen=False):
    script = (script or '').strip()
    if not script:
        raise DruckerFehler('Leerer G-Code')
    warten = max(1, min(int(warten or 60), 900))
    notaus = re.fullmatch(r'\s*M112\s*', script, re.I)
    if notaus:
        _anfrage('POST', '/printer/emergency_stop')
        return {'ok': True, 'antwort': ['NOT-AUS ausgelöst — danach FIRMWARE_RESTART nötig.']}
    zustand = _zustand()['state']
    if zustand in ('printing', 'paused') and not erzwingen:
        treffer = GEFAEHRLICH.search(script)
        if treffer:
            raise DruckerFehler('Es läuft ein Druck (%s) — "%s" würde ihn stören. Nur mit erzwingen=true, '
                                'wenn Volker das ausdrücklich will.' % (zustand, treffer.group(1)))
    vorher = _anfrage('GET', '/server/gcode_store?count=1')['gcode_store']
    marke = vorher[-1]['time'] if vorher else 0
    fertig = True
    try:
        _anfrage('POST', '/printer/gcode/script', {'script': script}, timeout=warten, zeit_ok=True)
    except DruckerFehler as e:
        return {'ok': False, 'fehler': str(e), 'antwort': _konsole_seit(marke)}
    except TimeoutError:
        fertig = False
    ergebnis = {'ok': True, 'fertig': fertig, 'antwort': _konsole_seit(marke)}
    if not fertig:
        ergebnis['hinweis'] = ('Nach %d s noch nicht fertig — der Befehl bleibt in Klippers Warteschlange und '
                               'läuft weiter (während eines Makros wie Heat Soak oder eines Drucks erst danach). '
                               'Nicht erneut senden; später drucker_status prüfen.' % warten)
    return ergebnis


# --- Dateien ---------------------------------------------------------------------

def dateien(suche=None, anzahl=30):
    liste = _anfrage('GET', '/server/files/list?root=gcodes')
    if suche:
        liste = [d for d in liste if suche.lower() in d['path'].lower()]
    liste.sort(key=lambda d: d['modified'], reverse=True)
    return {'anzahl': len(liste), 'dateien': [
        {'name': d['path'], 'groesse_mb': round(d['size'] / 1048576, 2),
         'geaendert': time.strftime('%Y-%m-%d %H:%M', time.localtime(d['modified']))}
        for d in liste[:max(1, min(int(anzahl or 30), 200))]]}


def _name_pruefen(name):
    name = (name or '').strip().lstrip('/')
    if not name or '..' in name.split('/'):
        raise DruckerFehler('Ungültiger Dateiname')
    return name


def datei_loeschen(name):
    name = _name_pruefen(name)
    ps = _zustand()
    if ps['state'] in ('printing', 'paused') and ps.get('filename') == name:
        raise DruckerFehler('Diese Datei wird gerade gedruckt.')
    _anfrage('DELETE', '/server/files/gcodes/' + urllib.parse.quote(name))
    return {'ok': True, 'geloescht': name}


def _upload_quelle(pfad):
    pfad = os.path.expanduser((pfad or '').strip())
    kandidaten = [pfad] if os.path.isabs(pfad) else [os.path.join(d, pfad) for d in UPLOAD_DIRS]
    for k in kandidaten:
        echt = os.path.realpath(k)
        if not any(echt == d or echt.startswith(d + os.sep) for d in UPLOAD_DIRS):
            continue
        if os.path.isfile(echt):
            return echt
    vorhanden = []
    for d in UPLOAD_DIRS:
        if os.path.isdir(d):
            for f in sorted(os.listdir(d), key=lambda f: -os.path.getmtime(os.path.join(d, f)))[:10]:
                if f.lower().endswith(ENDUNGEN):
                    vorhanden.append(os.path.join(d, f))
    raise DruckerFehler('Datei nicht gefunden oder nicht freigegeben. Erlaubt sind nur Dateien in: %s. '
                        'Neueste dort: %s' % (', '.join(UPLOAD_DIRS), ', '.join(vorhanden) or '—'))


def upload(pfad, name=None):
    quelle = _upload_quelle(pfad)
    if not quelle.lower().endswith(ENDUNGEN):
        raise DruckerFehler('Nur G-Code-Dateien (%s)' % ', '.join(ENDUNGEN))
    groesse = os.path.getsize(quelle)
    if groesse > MAX_UPLOAD:
        raise DruckerFehler('Datei zu groß (%d MB)' % (groesse // 1048576))
    ziel = _name_pruefen(name or os.path.basename(quelle))
    if not ziel.lower().endswith(ENDUNGEN):
        ziel += os.path.splitext(quelle)[1]
    grenze = uuid.uuid4().hex
    with open(quelle, 'rb') as fh:
        inhalt = fh.read()
    teile = []
    for k, v in (('root', 'gcodes'), ('print', 'false')):
        teile.append(('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n' % (grenze, k, v)).encode())
    teile.append(('--%s\r\nContent-Disposition: form-data; name="file"; filename="%s"\r\n'
                  'Content-Type: application/octet-stream\r\n\r\n' % (grenze, ziel.replace('"', ''))).encode())
    daten = b''.join(teile) + inhalt + ('\r\n--%s--\r\n' % grenze).encode()
    _anfrage('POST', '/server/files/upload', daten,
             {'Content-Type': 'multipart/form-data; boundary=' + grenze}, timeout=300)
    return {'ok': True, 'hochgeladen': ziel, 'groesse_mb': round(groesse / 1048576, 2), 'gestartet': False}


# --- Druck steuern ---------------------------------------------------------------

def druck(aktion, datei=None, bett_frei=False):
    ps = _zustand()
    if aktion == 'start':
        if not datei:
            raise DruckerFehler('Start nur mit Dateiname (drucker_dateien).')
        if not bett_frei:
            raise DruckerFehler('Start abgelehnt: erst Volker fragen, ob das Bett frei ist, '
                                'dann mit bett_frei=true aufrufen.')
        if ps['state'] in ('printing', 'paused'):
            raise DruckerFehler('Es läuft bereits ein Druck (%s: %s).' % (ps['state'], ps.get('filename')))
        datei = _name_pruefen(datei)
        _anfrage('POST', '/printer/print/start', {'filename': datei})
    elif aktion in ('pause', 'resume', 'cancel'):
        erwartet = {'pause': ('printing',), 'resume': ('paused',), 'cancel': ('printing', 'paused')}[aktion]
        if ps['state'] not in erwartet:
            raise DruckerFehler('"%s" geht nicht im Zustand "%s".' % (aktion, ps['state']))
        _anfrage('POST', '/printer/print/' + aktion, timeout=60)
    else:
        raise DruckerFehler('Aktion muss start, pause, resume oder cancel sein.')
    time.sleep(1)
    return {'ok': True, 'aktion': aktion, 'zustand_jetzt': _zustand()['state'], 'datei': datei or ps.get('filename')}


# --- Kamera ----------------------------------------------------------------------

def kamera(nr=1):
    if nr not in KAMERAS:
        raise DruckerFehler('Kamera 1 (SV08 Max) oder 2 (Logitech Brio)')
    pfad, name = KAMERAS[nr]
    daten, typ = _anfrage('GET', pfad, timeout=15, roh=True)
    if not daten or not typ.startswith('image/'):
        raise DruckerFehler('Kamera %d liefert kein Bild' % nr)
    return name, daten, typ.split(';')[0]


# --- Bettnetz --------------------------------------------------------------------

def _matrix(profil):
    bm = _objekte('bed_mesh')['bed_mesh']
    profile = bm.get('profiles') or {}
    if not profil:
        if bm.get('profile_name') and bm.get('probed_matrix') and bm['probed_matrix'][0]:
            return bm['profile_name'] + ' (aktiv)', bm['probed_matrix'], bm['mesh_min'], bm['mesh_max'], profile
        profil = 'default'
    if profil not in profile:
        raise DruckerFehler('Profil "%s" fehlt. Vorhanden: %s' % (profil, ', '.join(profile) or '—'))
    p = profile[profil]
    mp = p['mesh_params']
    return profil, p['points'], [mp['min_x'], mp['min_y']], [mp['max_x'], mp['max_y']], profile


def _stat(werte):
    return {'min': round(min(werte), 3), 'max': round(max(werte), 3), 'spanne': round(max(werte) - min(werte), 3)}


def mesh(profil=None, vergleich=None, raster=10, rand_mm=30.0):
    name, pkt, mn, mx, alle = _matrix(profil)
    ny, nx = len(pkt), len(pkt[0])
    raster = max(3, min(int(raster or 10), 20))
    xs = [mn[0] + (mx[0] - mn[0]) * i / max(nx - 1, 1) for i in range(nx)]
    ys = [mn[1] + (mx[1] - mn[1]) * j / max(ny - 1, 1) for j in range(ny)]
    matrix = [row[:] for row in pkt]
    titel = 'Profil %s' % name
    if vergleich:
        vname, vpkt, _, _, _ = _matrix(vergleich)
        if len(vpkt) != ny or len(vpkt[0]) != nx:
            raise DruckerFehler('Profile haben unterschiedliche Punktzahl (%dx%d / %dx%d)'
                                % (nx, ny, len(vpkt[0]), len(vpkt)))
        ma = sum(map(sum, pkt)) / (nx * ny)
        mb = sum(map(sum, vpkt)) / (nx * ny)
        matrix = [[(pkt[j][i] - ma) - (vpkt[j][i] - mb) for i in range(nx)] for j in range(ny)]
        titel = 'Differenz %s − %s (je mittelwertbereinigt)' % (name, vname)
    alle_werte = [v for row in matrix for v in row]
    innen = [matrix[j][i] for j in range(ny) for i in range(nx)
             if mn[0] + rand_mm <= xs[i] <= mx[0] - rand_mm and mn[1] + rand_mm <= ys[j] <= mx[1] - rand_mm]
    # grobes Raster: Blockmittel, Zeilen von hinten (Y max) nach vorne
    zeilen = []
    for bj in reversed(range(raster)):
        j0, j1 = bj * ny // raster, (bj + 1) * ny // raster
        werte = []
        for bi in range(raster):
            i0, i1 = bi * nx // raster, (bi + 1) * nx // raster
            block = [matrix[j][i] for j in range(j0, j1) for i in range(i0, i1)]
            werte.append('%+.2f' % (sum(block) / len(block)))
        zeilen.append('Y%4.0f | %s' % ((ys[j0] + ys[j1 - 1]) / 2, ' '.join(werte)))
    kopf = '      | ' + ' '.join('%5.0f' % ((xs[bi * nx // raster] + xs[(bi + 1) * nx // raster - 1]) / 2)
                                 for bi in range(raster))
    ergebnis = {
        'titel': titel, 'punkte': '%d×%d' % (nx, ny),
        'bereich_mm': 'X %.0f–%.0f, Y %.0f–%.0f' % (mn[0], mx[0], mn[1], mx[1]),
        'gesamt_mm': _stat(alle_werte),
        'innen_mm': dict(_stat(innen), rand_mm=rand_mm) if innen else None,
        'raster_mm': '\n'.join([kopf + '   (X-Mitte, mm)'] + zeilen + ['(oben = hinten / Y max, Werte = Blockmittel in mm)']),
        'profile': list(alle),
    }
    return ergebnis
