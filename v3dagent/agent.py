#!/usr/bin/env python3
"""V3D Agent — WhatsApp-Brücke zu Claude Code.

Volker (oder ein freigeschalteter Tester) schreibt der WhatsApp-Business-Nummer,
hier denkt Claude im Projektordner nach und antwortet.

Ablauf einer Runde:
  1. holen()   – langer GET bei netcup (/agent/posteingang), bleibt bis 25 s offen.
                 Abholung statt Zustellung, weil netcup nicht ins Heimnetz kommt.
  2. denken()  – `claude -p` im Arbeitsordner, ausdrücklich NUR mit lesenden
                 Werkzeugen (Read/Grep/Glob). Der Agent soll Fragen beantworten
                 und Texte entwerfen, nicht auf Zuruf Code ausrollen.
  3. senden()  – POST /agent/senden; der Meta-Token bleibt auf netcup.

Grundregel: In Volkers Namen geht nichts ungefragt an Dritte. Claude darf einen
ENTWURF machen, der geht zuerst an Volker; erst sein „ja" schickt ihn los.

Meta-Regel, die man nicht wegprogrammieren kann: Freier Text ist nur innerhalb
von 24 Stunden nach der letzten Nachricht des Gegenübers erlaubt. Ist das Fenster
zu, wird der freigegebene Entwurf geparkt und geht raus, sobald der Empfänger
sich meldet — Volker bekommt beides gesagt.

Start:   python3 agent.py            (Dauerbetrieb, siehe v3dagent.service)
         python3 agent.py --einmal   (eine Runde, für Tests)
         python3 agent.py --zustand  (zeigt, was ansteht)
"""
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

CONF_DIR = os.path.expanduser('~/.config/v3dagent')
CONF = os.path.join(CONF_DIR, 'config.json')
ZUSTAND = os.path.join(CONF_DIR, 'zustand.json')
PROTOKOLL = os.path.join(CONF_DIR, 'protokoll.log')

STANDARD = {
    'basis': 'https://kurse.volme3dakademie.de',
    'schluessel': '',
    'admin': '',                 # Volkers Nummer — nur von hier kommen Aufträge und Freigaben
    'kontakte': {},              # {'ralf': '4915...', 'josy': '4915...'}
    'arbeitsordner': '/home/v3da',
    'claude': os.path.expanduser('~/.npm-global/bin/claude'),
    'modell': 'sonnet',          # kurze WhatsApp-Antworten brauchen keinen Opus
    'zeit_s': 240,               # Geduld je Claude-Lauf
    'sitzung_max_s': 43200,      # nach 12 h ein frischer Faden
    'laeufe_pro_stunde': 30,     # Notbremse gegen Endlosschleifen/Kosten
    'max_zeichen': 3500,         # WhatsApp bricht bei ~4096
}

JA = {'ja', 'jo', 'jau', 'jep', 'jupp', 'ok', 'okay', 'oki', 'passt', 'senden', 'sende',
      'schick', 'schicken', 'schick es', 'raus', 'abschicken', 'gerne', 'klar', 'mach',
      'yes', 'go', 'los', '👍', '✅', '👌'}
NEIN = {'nein', 'ne', 'nee', 'nö', 'noe', 'verwerfen', 'verwirf', 'abbrechen', 'abbruch',
        'stop', 'stopp', 'lass', 'nicht senden', 'no', '❌', '🚫'}

# Meta-Fehlercodes, die „24-Stunden-Fenster ist zu" bedeuten
FENSTER_CODES = {131047, 470}


def jetzt():
    return int(time.time())


def notieren(text):
    zeile = time.strftime('%Y-%m-%d %H:%M:%S ') + text
    print(zeile, flush=True)
    try:
        os.makedirs(CONF_DIR, exist_ok=True)
        with open(PROTOKOLL, 'a', encoding='utf-8') as f:
            f.write(zeile + '\n')
    except OSError:
        pass


def nur_ziffern(s):
    return re.sub(r'\D', '', str(s or ''))


def schlicht(text):
    """Für den Ja/Nein-Vergleich: klein, ohne Satzzeichen und Emoji-Beiwerk."""
    t = unicodedata.normalize('NFKC', str(text or '')).strip().lower()
    t = ''.join(c for c in t if not unicodedata.combining(c) and c != '\ufe0f')
    return re.sub(r'[\s.!?,;:]+', ' ', t).strip()


def laden(pfad, standard):
    try:
        with open(pfad, encoding='utf-8') as f:
            d = json.load(f)
        if isinstance(d, dict):
            out = dict(standard)
            out.update(d)
            return out
    except (OSError, ValueError):
        pass
    return dict(standard)


def sichern(pfad, daten):
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    tmp = pfad + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(daten, f, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, pfad)


def deuten(antwort):
    """Claudes Ausgabe → ('antwort'|'entwurf', empfänger, text).

    Die Kennzeichen-Zeile (ANTWORT / ENTWURF <name>) soll die erste sein, in der
    Praxis stellt das Modell aber gern noch einen Gedanken davor. Darum gilt die
    ERSTE Zeile, die genau ein Kennzeichen ist — alles davor fliegt raus, alles
    danach ist die Nachricht.

    Findet sich gar kein Kennzeichen, gilt der ganze Text als Antwort an Volker:
    lieber eine Nachricht zu viel an ihn selbst als ein ungewollter Entwurf an
    einen Dritten.
    """
    text = (antwort or '').strip()
    if not text:
        return ('antwort', None, '')
    zeilen = text.split('\n')
    for i, zeile in enumerate(zeilen):
        kopf = zeile.strip()
        rest = '\n'.join(zeilen[i + 1:]).strip()
        m = re.match(r'^[*_#\s]*ENTWURF\b\s*(?:an\s+)?([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]*)?[*_\s]*:?\s*(.*)$', kopf, re.I)
        if m:
            koerper = ((m.group(2) or '').strip() + ('\n' + rest if rest else '')).strip()
            if koerper:
                return ('entwurf', (m.group(1) or '').lower() or None, koerper)
            continue
        m = re.match(r'^[*_#\s]*ANTWORT\b[*_\s]*:?\s*(.*)$', kopf, re.I)
        if m:
            koerper = ((m.group(1) or '').strip() + ('\n' + rest if rest else '')).strip()
            if koerper:
                return ('antwort', None, koerper)
    return ('antwort', None, text)


class Bruecke:
    """Die ganze Logik, mit austauschbarem Transport — so lässt sie sich ohne
    echtes WhatsApp und ohne echten Claude durchspielen (siehe test_agent.py)."""

    def __init__(self, conf, zustand=None, holen=None, senden=None, denken=None):
        self.conf = conf
        self.z = zustand if zustand is not None else laden(ZUSTAND, {
            'stand': 0, 'sitzungen': {}, 'entwurf': None, 'geparkt': {},
            'letzte_ein': {}, 'notizen': [], 'laeufe': [],
        })
        self._holen = holen or self.http_holen
        self._senden = senden or self.http_senden
        self._denken = denken or self.claude
        self.admin = nur_ziffern(conf.get('admin'))
        self.kontakte = {k.lower(): nur_ziffern(v) for k, v in (conf.get('kontakte') or {}).items()}

    # ---- Transport ---------------------------------------------------------
    def http_holen(self, seit):
        url = self.conf['basis'].rstrip('/') + '/agent/posteingang?seit=' + str(seit)
        req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + self.conf['schluessel']})
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.loads(r.read().decode('utf-8'))

    def http_senden(self, an, text):
        url = self.conf['basis'].rstrip('/') + '/agent/senden'
        daten = json.dumps({'an': an, 'text': text}).encode('utf-8')
        req = urllib.request.Request(url, data=daten, headers={
            'Authorization': 'Bearer ' + self.conf['schluessel'], 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            try:
                return json.loads(e.read().decode('utf-8'))
            except Exception:
                return {'ok': False, 'fehler': 'HTTP %s' % e.code}
        except OSError as e:
            return {'ok': False, 'fehler': str(e)}

    # ---- Claude ------------------------------------------------------------
    def systemtext(self):
        namen = ', '.join(sorted(n.capitalize() for n in self.kontakte)) or '(keine hinterlegt)'
        return (
            'Du bist Volkers Werkstatt-Assistent für V3D CAD (Volme 3D Akademie) und antwortest über WhatsApp.\n'
            'Schreib KURZ und auf Deutsch — WhatsApp, keine Aufsätze. Keine Überschriften, keine Aufzählungssternchen; '
            'WhatsApp kann nur *fett* und _kursiv_.\n'
            'Deine Ausgabe MUSS mit genau einer dieser Zeilen ANFANGEN — kein Vorwort, keine Einleitung davor:\n'
            'ANTWORT\n'
            '  — alles Weitere geht an Volker selbst.\n'
            'ENTWURF <Name>\n'
            '  — alles Weitere ist ein Text, der IN VOLKERS NAMEN an <Name> gehen soll. Schreib ihn so, '
            'wie Volker ihn schreiben würde (Du-Form, freundlich, ohne Signatur).\n'
            'Bekannte Empfänger: ' + namen + '. Nimm ENTWURF nur, wenn erkennbar jemand anderes etwas bekommen soll.\n'
            'Volker gibt jeden Entwurf vorher frei — schreib also nicht dazu, dass er ihn noch prüfen soll.\n'
            'Du darfst im Projektordner lesen (Read/Grep/Glob), aber nichts ändern und nichts ausrollen. '
            'Soll etwas gebaut werden, sag kurz, was du tun würdest, und dass es eine richtige Sitzung braucht.'
        )

    def claude(self, prompt, sitzung):
        cmd = [self.conf['claude'], '-p', prompt, '--output-format', 'json',
               '--allowedTools', 'Read,Grep,Glob',
               '--disallowedTools', 'Edit,Write,NotebookEdit,Bash,WebFetch,WebSearch,Task',
               '--append-system-prompt', self.systemtext()]
        if self.conf.get('modell'):
            cmd += ['--model', self.conf['modell']]
        if sitzung:
            cmd += ['--resume', sitzung]
        try:
            r = subprocess.run(cmd, cwd=self.conf['arbeitsordner'], capture_output=True,
                               text=True, timeout=self.conf.get('zeit_s', 240))
        except subprocess.TimeoutExpired:
            return {'text': '', 'sitzung': sitzung, 'fehler': 'Zeitüberschreitung'}
        if r.returncode != 0:
            # Ein abgelaufener Faden darf den Betrieb nicht anhalten: neu anfangen.
            if sitzung:
                notieren('[claude] Faden %s ging nicht, fange neu an' % sitzung[:8])
                return self.claude(prompt, None)
            return {'text': '', 'sitzung': None, 'fehler': (r.stderr or r.stdout or 'Fehler')[-300:]}
        try:
            j = json.loads(r.stdout)
        except ValueError:
            return {'text': r.stdout.strip()[:2000], 'sitzung': sitzung, 'fehler': ''}
        return {'text': (j.get('result') or '').strip(), 'sitzung': j.get('session_id') or sitzung, 'fehler': ''}

    # ---- Hilfen ------------------------------------------------------------
    def name_zu(self, nummer):
        n = nur_ziffern(nummer)
        for name, nr in self.kontakte.items():
            if nr == n:
                return name
        return None

    def nummer_zu(self, name):
        return self.kontakte.get((name or '').lower())

    def bremse_frei(self):
        grenze = jetzt() - 3600
        self.z['laeufe'] = [t for t in self.z.get('laeufe', []) if t > grenze]
        return len(self.z['laeufe']) < self.conf.get('laeufe_pro_stunde', 30)

    def sitzung_von(self, schluessel):
        s = (self.z.get('sitzungen') or {}).get(schluessel)
        if not s:
            return None
        if jetzt() - s.get('ts', 0) > self.conf.get('sitzung_max_s', 43200):
            return None
        return s.get('id')

    def sitzung_merken(self, schluessel, sid):
        if not sid:
            return
        self.z.setdefault('sitzungen', {})[schluessel] = {'id': sid, 'ts': jetzt()}

    def an_admin(self, text):
        """Nachricht an Volker. Klappt sie nicht (Fenster zu), wird sie
        aufgehoben und beim nächsten Lebenszeichen nachgereicht."""
        offen = self.z.get('notizen') or []
        voll = ('\n\n'.join(offen + [text])).strip()
        r = self._senden(self.admin, voll[:self.conf.get('max_zeichen', 3500)])
        if r.get('ok'):
            self.z['notizen'] = []
            return True
        self.z['notizen'] = (offen + [text])[-10:]
        notieren('[agent] an Volker ging nicht (%s) — aufgehoben' % r.get('fehler'))
        return False

    def entwurf_senden(self):
        e = self.z.get('entwurf')
        if not e:
            return
        r = self._senden(e['nummer'], e['text'][:self.conf.get('max_zeichen', 3500)])
        wer = (e.get('name') or e['nummer']).capitalize()
        if r.get('ok'):
            self.z['entwurf'] = None
            self.an_admin('✓ An %s raus.' % wer)
            notieren('[agent] Entwurf an %s gesendet' % wer)
            return
        if r.get('code') in FENSTER_CODES:
            self.z.setdefault('geparkt', {})[e['nummer']] = e
            self.z['entwurf'] = None
            self.an_admin('%s hat länger nicht an diese Nummer geschrieben — WhatsApp lässt mich gerade nicht zu ihm '
                          'durch (24-Stunden-Regel von Meta). Ich habe den Text festgehalten und schicke ihn, sobald '
                          'er sich meldet. Wenn es eilt: Bitte ihn, kurz „Hallo" an diese Nummer zu schicken.' % wer)
            notieren('[agent] Fenster zu bei %s — Entwurf geparkt' % wer)
            return
        self.an_admin('Konnte nicht an %s senden: %s' % (wer, r.get('fehler') or 'unbekannter Fehler'))

    def lauf(self, schluessel, prompt):
        if not self.bremse_frei():
            self.an_admin('Ich habe in dieser Stunde schon sehr viel gerechnet und mache eine Pause '
                          '(Notbremse gegen Endlosschleifen). In ein paar Minuten gern wieder.')
            return None
        self.z.setdefault('laeufe', []).append(jetzt())
        erg = self._denken(prompt, self.sitzung_von(schluessel))
        self.sitzung_merken(schluessel, erg.get('sitzung'))
        if erg.get('fehler'):
            notieren('[claude] %s' % erg['fehler'])
            self.an_admin('Das hat gerade nicht geklappt: %s' % erg['fehler'][:200])
            return None
        return deuten(erg.get('text'))

    def entwurf_zeigen(self, name, nummer, text, vorspann=''):
        self.z['entwurf'] = {'name': name, 'nummer': nummer, 'text': text, 'ts': jetzt()}
        wer = (name or nummer).capitalize()
        self.an_admin((vorspann + '\n\n' if vorspann else '')
                      + 'Entwurf an %s:\n———\n%s\n———\n„ja" schickt ihn, „nein" verwirft ihn — '
                        'oder sag mir, was anders soll.' % (wer, text))

    # ---- Kern --------------------------------------------------------------
    def verarbeite(self, n):
        nummer = nur_ziffern(n.get('von'))
        text = (n.get('text') or '').strip()
        if not nummer or not text:
            return
        self.z.setdefault('letzte_ein', {})[nummer] = jetzt()
        notieren('[agent] von %s: %s' % (self.name_zu(nummer) or nummer, text[:80]))

        # Geparktes zuerst: Wer schreibt, macht sein Fenster wieder auf.
        geparkt = (self.z.get('geparkt') or {}).pop(nummer, None)
        if geparkt:
            r = self._senden(nummer, geparkt['text'][:self.conf.get('max_zeichen', 3500)])
            wer = (geparkt.get('name') or nummer).capitalize()
            if r.get('ok'):
                self.an_admin('✓ %s hat sich gemeldet — der festgehaltene Text ist jetzt raus.' % wer)
            else:
                self.z.setdefault('geparkt', {})[nummer] = geparkt

        if nummer == self.admin:
            self.vom_admin(text)
        else:
            self.von_kontakt(nummer, text)

    def vom_admin(self, text):
        e = self.z.get('entwurf')
        k = schlicht(text)
        if e:
            if k in JA:
                self.entwurf_senden()
                return
            if k in NEIN:
                self.z['entwurf'] = None
                self.an_admin('Verworfen.')
                return
            # Alles andere gilt als Änderungswunsch am Entwurf.
            erg = self.lauf('admin',
                            'Du hattest diesen Entwurf an %s vorgeschlagen:\n———\n%s\n———\n'
                            'Volker sagt dazu: "%s"\n\nGib den überarbeiteten Entwurf aus '
                            '(ENTWURF %s), oder ANTWORT, wenn es keine Änderung am Entwurf ist.'
                            % ((e.get('name') or 'ihn').capitalize(), e['text'], text, (e.get('name') or '')))
            if not erg:
                return
            art, wer, inhalt = erg
            if art == 'entwurf':
                name = (wer or e.get('name'))
                nummer = self.nummer_zu(name) or e['nummer']
                self.entwurf_zeigen(name, nummer, inhalt)
            else:
                self.an_admin(inhalt)
            return

        erg = self.lauf('admin', text)
        if not erg:
            return
        art, wer, inhalt = erg
        if art == 'entwurf':
            nummer = self.nummer_zu(wer)
            if not nummer:
                self.an_admin('Für „%s" habe ich keine Nummer hinterlegt. Der Text wäre gewesen:\n———\n%s'
                              % (wer or '?', inhalt))
                return
            self.entwurf_zeigen(wer, nummer, inhalt)
        else:
            self.an_admin(inhalt)

    def von_kontakt(self, nummer, text):
        """Ralf & Co. schreiben — beantwortet wird das NICHT von allein.
        Volker bekommt die Nachricht plus einen fertigen Antwortentwurf."""
        name = self.name_zu(nummer) or nummer
        erg = self.lauf('k:' + nummer,
                        '%s hat gerade bei WhatsApp geschrieben:\n"%s"\n\n'
                        'Formuliere einen Antwortentwurf an %s in Volkers Namen (ENTWURF %s). '
                        'Wenn es eine Idee oder ein Fehlerbericht zu V3D CAD ist: ordne sie in einem Satz ein '
                        '(gibt es das schon? wie aufwendig?) und schreib das NICHT in den Entwurf, sondern '
                        'hänge es nach dem Entwurf als eigenen Absatz „Für dich:" an.'
                        % (name.capitalize(), text, name.capitalize(), name))
        if not erg:
            return
        art, wer, inhalt = erg
        vorspann = '📩 %s schreibt:\n„%s"' % (name.capitalize(), text[:600])
        if art == 'entwurf':
            self.entwurf_zeigen(wer or name, self.nummer_zu(wer) or nummer, inhalt, vorspann)
        else:
            self.an_admin(vorspann + '\n\n' + inhalt)

    # ---- Runde -------------------------------------------------------------
    def runde(self):
        try:
            d = self._holen(self.z.get('stand', 0))
        except Exception as e:  # Netz weg, netcup neu gestartet …
            notieren('[agent] Abholen ging nicht: %s' % e)
            time.sleep(10)
            return 0
        n = 0
        for nachricht in d.get('nachrichten') or []:
            try:
                self.verarbeite(nachricht)
            except Exception as e:
                notieren('[agent] Fehler bei #%s: %s' % (nachricht.get('id'), e))
            self.z['stand'] = max(self.z.get('stand', 0), int(nachricht.get('id') or 0))
            n += 1
            sichern(ZUSTAND, self.z)
        if not n:
            self.z['stand'] = max(self.z.get('stand', 0), int(d.get('stand') or 0))
            sichern(ZUSTAND, self.z)
        return n


def main():
    conf = laden(CONF, STANDARD)
    fehlt = [k for k in ('schluessel', 'admin') if not conf.get(k)]
    if fehlt:
        print('Es fehlt in %s: %s' % (CONF, ', '.join(fehlt)), file=sys.stderr)
        return 2
    b = Bruecke(conf)
    if '--zustand' in sys.argv:
        e = b.z.get('entwurf')
        print('Stand: %s' % b.z.get('stand'))
        print('Offener Entwurf: %s' % (('an %s: %s' % (e.get('name'), e['text'][:120])) if e else 'keiner'))
        print('Geparkt: %s' % (', '.join(b.z.get('geparkt') or {}) or 'nichts'))
        print('Aufgehobene Notizen: %d' % len(b.z.get('notizen') or []))
        return 0
    if '--einmal' in sys.argv:
        print('%d Nachricht(en) verarbeitet.' % b.runde())
        return 0
    notieren('[agent] läuft — Admin %s, Kontakte: %s' % (b.admin, ', '.join(b.kontakte) or 'keine'))
    while True:
        b.runde()


if __name__ == '__main__':
    sys.exit(main() or 0)
