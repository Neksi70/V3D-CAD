"""Tresor für Zugangsdaten (API-Schlüssel, private Schlüssel, Tokens).

Alles liegt verschlüsselt in data/tresor.json (AES-256-GCM, Schlüssel per
scrypt aus dem Master-Passwort). Das Passwort selbst wird nirgends gespeichert —
nach einem Dienst-Neustart ist der Tresor zu und muss in der App wieder
aufgeschlossen werden. Solange er zu ist, kann der Server keine Bank abfragen.
"""
import base64
import json
import os
import threading

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

SCRYPT_N = 2 ** 15


def _b64(b):
    return base64.b64encode(b).decode()


def _unb64(s):
    return base64.b64decode(s)


def _schluessel(passwort, salz, n=SCRYPT_N):
    return Scrypt(salt=salz, length=32, n=n, r=8, p=1).derive(passwort.encode())


class Tresor:
    def __init__(self, pfad):
        self.pfad = pfad
        self._key = None
        self._salz = None
        self._daten = None
        self._lock = threading.Lock()

    # -------------------------------------------------------------- Zustand
    def angelegt(self):
        return os.path.exists(self.pfad)

    def offen(self):
        return self._key is not None

    def anlegen(self, passwort):
        if self.angelegt():
            raise ValueError("Tresor existiert bereits")
        if len(passwort) < 10:
            raise ValueError("Master-Passwort braucht mindestens 10 Zeichen")
        self._salz = os.urandom(16)
        self._key = _schluessel(passwort, self._salz)
        self._daten = {}
        self._schreiben()

    def aufschliessen(self, passwort):
        """True bei richtigem Passwort. Falsches Passwort = GCM-Tag passt nicht."""
        with open(self.pfad) as f:
            roh = json.load(f)
        salz = _unb64(roh["salz"])
        key = _schluessel(passwort, salz, roh.get("n", SCRYPT_N))
        try:
            klar = AESGCM(key).decrypt(_unb64(roh["nonce"]), _unb64(roh["daten"]), b"v3dbank")
        except InvalidTag:
            return False
        with self._lock:
            self._salz, self._key, self._daten = salz, key, json.loads(klar)
        return True

    def pruefen(self, passwort):
        """Passwort gegen den Tresor prüfen, ohne den Zustand anzufassen."""
        with open(self.pfad) as f:
            roh = json.load(f)
        key = _schluessel(passwort, _unb64(roh["salz"]), roh.get("n", SCRYPT_N))
        try:
            AESGCM(key).decrypt(_unb64(roh["nonce"]), _unb64(roh["daten"]), b"v3dbank")
            return True
        except InvalidTag:
            return False

    def zuschliessen(self):
        with self._lock:
            self._key = self._daten = None

    def passwort_aendern(self, neu):
        if not self.offen():
            raise PermissionError("Tresor ist zu")
        if len(neu) < 10:
            raise ValueError("Master-Passwort braucht mindestens 10 Zeichen")
        with self._lock:
            self._salz = os.urandom(16)
            self._key = _schluessel(neu, self._salz)
            self._schreiben()

    # -------------------------------------------------------------- Inhalt
    def get(self, bereich):
        if not self.offen():
            raise PermissionError("Tresor ist zu")
        with self._lock:
            return json.loads(json.dumps(self._daten.get(bereich) or {}))

    def set(self, bereich, werte):
        """Werte eines Bereichs (z. B. 'bunq') zusammenführen; None löscht einen Eintrag."""
        if not self.offen():
            raise PermissionError("Tresor ist zu")
        with self._lock:
            ziel = self._daten.setdefault(bereich, {})
            for k, v in werte.items():
                if v is None:
                    ziel.pop(k, None)
                else:
                    ziel[k] = v
            self._schreiben()

    def loeschen(self, bereich):
        if not self.offen():
            raise PermissionError("Tresor ist zu")
        with self._lock:
            self._daten.pop(bereich, None)
            self._schreiben()

    def _schreiben(self):
        nonce = os.urandom(12)
        ct = AESGCM(self._key).encrypt(nonce, json.dumps(self._daten).encode(), b"v3dbank")
        tmp = self.pfad + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump({"v": 1, "n": SCRYPT_N, "salz": _b64(self._salz),
                       "nonce": _b64(nonce), "daten": _b64(ct)}, f)
        os.replace(tmp, self.pfad)
