"""Audit-Log als JSON-Zeilen: wer (Konto), wann, welches Werkzeug, Erfolg ja/nein.
Nur Metadaten — keine Parameter, Modelle oder Tokens.
"""
import json
import os
import threading
import time

from . import settings

_lock = threading.Lock()
MAX_BYTES = 5 * 1024 * 1024


def _pfad():
    return os.path.join(settings.DATA_DIR, 'audit.log')


def log(event, **felder):
    eintrag = {'ts': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'event': event}
    eintrag.update({k: v for k, v in felder.items() if v is not None})
    zeile = json.dumps(eintrag, ensure_ascii=False) + '\n'
    with _lock:
        os.makedirs(settings.DATA_DIR, mode=0o700, exist_ok=True)
        pfad = _pfad()
        try:
            if os.path.getsize(pfad) > MAX_BYTES:
                os.replace(pfad, pfad + '.1')
        except FileNotFoundError:
            pass
        fd = os.open(pfad, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, 'a', encoding='utf-8') as fh:
            fh.write(zeile)
