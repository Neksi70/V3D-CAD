"""Warteschlange von code_auftrag: Parallel-Limit, Ressourcen-Sperre, Zeitlimit.

Läuft ohne echtes systemd/Claude: systemd-run und is-active werden gefälscht.
Start (ohne pytest):  cd ~/v3d-mail-mcp && .venv/bin/python -m tests.test_code_queue
"""
import contextlib
import os
import subprocess
import tempfile
import time

os.environ.setdefault('CODE_AUFTRAG_DIR', tempfile.mkdtemp(prefix='code-queue-test-'))
from v3dmcp import code  # noqa: E402


class _Patch:
    def __init__(self):
        self.alt = []

    def setattr(self, obj, name, wert):
        self.alt.append((obj, name, getattr(obj, name)))
        setattr(obj, name, wert)

    def zurueck(self):
        for obj, name, wert in reversed(self.alt):
            setattr(obj, name, wert)


@contextlib.contextmanager
def _raises(typ):
    try:
        yield
    except typ:
        return
    raise AssertionError('%s erwartet' % typ.__name__)


def umgebung(monkeypatch, tmp_path):
    monkeypatch.setattr(code, 'BASIS', str(tmp_path))
    monkeypatch.setattr(code, 'GEDAECHTNIS', os.path.join(tmp_path, 'protokoll.md'))
    monkeypatch.setattr(code, 'MAX_PARALLEL', 3)
    aktiv, gestartet = set(), []

    def fake_run(cmd, **kw):
        if cmd[:2] == ['systemd-run', '--user']:
            unit = [c for c in cmd if c.startswith('--unit=')][0][7:]
            aktiv.add(unit)
            gestartet.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, '', '')

    monkeypatch.setattr(code.subprocess, 'run', fake_run)
    monkeypatch.setattr(code, '_unit_aktiv', lambda j: code._unit(j) in aktiv)
    # eindeutige, aufsteigende IDs auch innerhalb derselben Sekunde
    zaehler = iter(range(1000))
    monkeypatch.setattr(code.secrets, 'token_hex', lambda n: '%04x' % next(zaehler))
    return aktiv, gestartet


def _fertig(aktiv, job_id):
    """Simuliert das Ende eines Läufers."""
    d = os.path.join(code.BASIS, job_id)
    m = code._meta_lesen(d)
    m.update(status='fertig', ende=code._jetzt())
    code._meta_schreiben(d, m)
    aktiv.discard(code._unit(job_id))
    with code._Sperre():
        code._aufraeumen(ohne=job_id)


def test_erkennung():
    assert code.ressource_erkennen('SV08 Max: Mesh messen') == 'drucker'
    assert code.ressource_erkennen('', 'Klipper-Config prüfen') == 'drucker'
    assert code.ressource_erkennen('G-Code analysieren') == 'drucker'
    assert code.ressource_erkennen('Gantry ausrichten') == 'drucker'
    assert code.ressource_erkennen('3D-Drucker testen') == 'drucker'
    assert code.ressource_erkennen('Dienste-Check nach Stromausfall') is None
    assert code.ressource_erkennen('MeshCentral neu starten') is None


def test_parallel_und_ressource(umgebung):
    aktiv, gestartet = umgebung
    a = code.auftrag('SV08 Warm-Test, 60 min', titel='Drucker-Test')
    b = code.auftrag('Dienste-Check nach Stromausfall')
    c = code.auftrag('Bett-Mesh nochmal messen')                  # Drucker → muss warten
    d = code.auftrag('README aufräumen', ressource='keine')
    e = code.auftrag('Noch etwas')                                  # Platz 4 → wartet
    assert a['ressource'] == 'drucker' and a['status'] == 'läuft'
    assert b['ressource'] is None and b['status'] == 'läuft'
    assert c['ressource'] == 'drucker' and c['status'] == 'wartet'
    assert 'belegt' in c['wartegrund']
    assert d['status'] == 'läuft'
    assert e['status'] == 'wartet' and 'Plätze' in e['wartegrund']
    # b fertig → e (älter wartend, aber c ist gesperrt) rückt nach, c wartet weiter
    _fertig(aktiv, b['job_id'])
    assert code._status_kurz(e['job_id']) == 'läuft'
    assert code._status_kurz(c['job_id']) == 'wartet'
    # Drucker-Job fertig → c startet
    _fertig(aktiv, a['job_id'])
    assert code._status_kurz(c['job_id']) == 'läuft'
    l = code.liste()
    assert l['max_parallel'] == 3 and l['laufend'] == 3
    assert {j['job_id']: j['ressource'] for j in l['jobs']}[c['job_id']] == 'drucker'


def test_zeitlimit(umgebung):
    aktiv, gestartet = umgebung
    j = code.auftrag('lange Messung', zeitlimit_min=150, ressource='drucker')
    assert j['zeitlimit_min'] == 150
    assert '--property=RuntimeMaxSec=%d' % (150 * 60 + 120) in gestartet[-1]
    assert code.auftrag('x')['zeitlimit_min'] == 60
    with _raises(code.MailError):
        code.auftrag('x', zeitlimit_min=181)
    with _raises(code.MailError):
        code.auftrag('x', ressource='Drucker!!')


def test_alte_jobs_ohne_neue_felder(umgebung):
    """meta.json von vor der Änderung (ohne ressource/zeitlimit_min) muss weiter gehen."""
    aktiv, _ = umgebung
    job_id = time.strftime('%Y%m%d-%H%M%S-') + 'ffff'
    d = os.path.join(code.BASIS, job_id)
    os.makedirs(d)
    code._meta_schreiben(d, {'id': job_id, 'titel': 'alt', 'ordner': os.path.expanduser('~'),
                             'status': 'läuft', 'angelegt': code._jetzt(), 'start': code._jetzt(), 'ende': None})
    l = code.liste()          # Unit nicht aktiv → wird als Fehler markiert, ohne Absturz
    alt = [j for j in l['jobs'] if j['job_id'] == job_id][0]
    assert alt['status'] == 'fehler' and alt['zeitlimit_min'] == 60 and alt['ressource'] is None


if __name__ == '__main__':
    tests = [test_erkennung, test_parallel_und_ressource, test_zeitlimit, test_alte_jobs_ohne_neue_felder]
    for t in tests:
        mp = _Patch()
        try:
            if t is test_erkennung:
                t()
            else:
                t(umgebung(mp, tempfile.mkdtemp(prefix='code-queue-test-')))
        finally:
            mp.zurueck()
        print('ok', t.__name__)
    print('alle %d Tests grün' % len(tests))
