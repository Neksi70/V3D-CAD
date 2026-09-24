#!/usr/bin/env python3
"""Rauchtest der Agent-Brücke. Kein echtes WhatsApp, kein echter Claude:
Transport und Denken werden ersetzt, geprüft wird der Ablauf.

  python3 test_agent.py
"""
import sys

import agent as A

VOLKER = '4915120164288'
RALF = '491701234567'

CONF = {
    'basis': 'http://test', 'schluessel': 'x', 'admin': VOLKER,
    'kontakte': {'ralf': RALF}, 'arbeitsordner': '/tmp', 'claude': '/bin/true',
    'modell': 'sonnet', 'zeit_s': 5, 'sitzung_max_s': 43200,
    'laeufe_pro_stunde': 30, 'max_zeichen': 3500,
}

fehler = []


def ok(name, bedingung, extra=None):
    print(('  OK   ' if bedingung else 'FEHLER ') + name + ('' if extra is None else '  → %r' % (extra,)))
    if not bedingung:
        fehler.append(name)


def frisch(antworten, fenster_zu=()):
    """Brücke mit Attrappen. antworten = Liste der Claude-Ausgaben (der Reihe nach).
    fenster_zu = Nummern, bei denen das Senden am 24-Stunden-Fenster scheitert."""
    gesendet = []
    prompts = []

    def senden(an, text):
        if an in fenster_zu:
            return {'ok': False, 'code': 131047, 'fehler': 'Cloud API 400: re-engagement'}
        gesendet.append((an, text))
        return {'ok': True, 'waId': 'wamid.test'}

    def denken(prompt, sitzung):
        prompts.append(prompt)
        return {'text': antworten.pop(0) if antworten else 'ANTWORT\nnix', 'sitzung': 'sid-1', 'fehler': ''}

    z = {'stand': 0, 'sitzungen': {}, 'entwurf': None, 'geparkt': {}, 'letzte_ein': {}, 'notizen': [], 'laeufe': []}
    b = A.Bruecke(CONF, zustand=z, holen=lambda seit: {'stand': 0, 'nachrichten': []}, senden=senden, denken=denken)
    return b, gesendet, prompts


# ── Deuten der Claude-Ausgabe ────────────────────────────────────────────────
ok('ANTWORT wird erkannt', A.deuten('ANTWORT\nMoin!') == ('antwort', None, 'Moin!'))
ok('ANTWORT in einer Zeile', A.deuten('ANTWORT: Moin!') == ('antwort', None, 'Moin!'))
ok('ENTWURF mit Empfänger', A.deuten('ENTWURF Ralf\nHallo Ralf') == ('entwurf', 'ralf', 'Hallo Ralf'))
ok('ENTWURF „an Ralf:"', A.deuten('ENTWURF an Ralf: Hallo\nZeile zwei') == ('entwurf', 'ralf', 'Hallo\nZeile zwei'))
ok('Ohne Kennzeichen gilt es als Antwort an Volker',
   A.deuten('Einfach nur Text') == ('antwort', None, 'Einfach nur Text'))
ok('Vorwort vor dem Kennzeichen fliegt raus',
   A.deuten('Ich habe nachgesehen.\n\nANTWORT\nDas Bord hat keinen Preis.')
   == ('antwort', None, 'Das Bord hat keinen Preis.'))
ok('Vorwort vor ENTWURF fliegt auch raus',
   A.deuten('Kurz überlegt:\n**ENTWURF Ralf**\nMoin Ralf!') == ('entwurf', 'ralf', 'Moin Ralf!'))
ok('Nacktes Kennzeichen ohne Inhalt zählt nicht als Nachricht',
   A.deuten('ANTWORT')[2] == 'ANTWORT')
ok('Ja/Nein-Erkennung ist tolerant', A.schlicht(' Ja! ') in A.JA and A.schlicht('Nö.') in A.NEIN)

# ── 1. Volker stellt eine Frage → Antwort an Volker, sonst nichts ────────────
b, gesendet, prompts = frisch(['ANTWORT\nDer Generator ist drin.'])
b.verarbeite({'id': 1, 'von': VOLKER, 'text': 'Was macht der Generator?'})
ok('Frage: genau eine Nachricht, und zwar an Volker', len(gesendet) == 1 and gesendet[0][0] == VOLKER, gesendet)
ok('Frage: Antworttext kommt an', gesendet and 'Generator ist drin' in gesendet[0][1])
ok('Frage: kein Entwurf offen', b.z['entwurf'] is None)

# ── 2. „Schick das an Ralf" → Entwurf zur Freigabe, NICHTS an Ralf ───────────
b, gesendet, prompts = frisch(['ENTWURF Ralf\nMoin Ralf, die Buchstaben sind fertig.'])
b.verarbeite({'id': 2, 'von': VOLKER, 'text': 'Schick Ralf Bescheid, dass die Leucht-Buchstaben fertig sind'})
ok('Auftrag: nur Volker bekommt etwas', [g[0] for g in gesendet] == [VOLKER], gesendet)
ok('Auftrag: Entwurf steht zur Freigabe', (b.z['entwurf'] or {}).get('nummer') == RALF)
ok('Auftrag: Volker sieht den Text und die Freigabe-Regel',
   'Moin Ralf' in gesendet[0][1] and '„ja"' in gesendet[0][1])

# ── 3. „ja" schickt ihn wirklich raus ────────────────────────────────────────
b.verarbeite({'id': 3, 'von': VOLKER, 'text': 'ja'})
an_ralf = [g for g in gesendet if g[0] == RALF]
ok('Freigabe: Text geht an Ralf', len(an_ralf) == 1 and 'Moin Ralf' in an_ralf[0][1], an_ralf)
ok('Freigabe: Volker bekommt die Bestätigung', gesendet[-1][0] == VOLKER and 'raus' in gesendet[-1][1])
ok('Freigabe: Entwurf ist abgeräumt', b.z['entwurf'] is None)

# ── 4. „nein" verwirft ───────────────────────────────────────────────────────
b, gesendet, prompts = frisch(['ENTWURF Ralf\nText'])
b.verarbeite({'id': 4, 'von': VOLKER, 'text': 'sag Ralf Bescheid'})
b.verarbeite({'id': 5, 'von': VOLKER, 'text': 'nein'})
ok('Verwerfen: nichts an Ralf', not [g for g in gesendet if g[0] == RALF], gesendet)
ok('Verwerfen: Entwurf weg', b.z['entwurf'] is None and 'Verworfen' in gesendet[-1][1])

# ── 5. Korrektur statt ja/nein → neuer Entwurf, immer noch nichts an Ralf ────
b, gesendet, prompts = frisch(['ENTWURF Ralf\nSehr langer Text', 'ENTWURF Ralf\nKurz.'])
b.verarbeite({'id': 6, 'von': VOLKER, 'text': 'sag Ralf Bescheid'})
b.verarbeite({'id': 7, 'von': VOLKER, 'text': 'kürzer bitte'})
ok('Korrektur: Claude bekommt den alten Entwurf mit', 'Sehr langer Text' in prompts[-1])
ok('Korrektur: neuer Entwurf steht bereit', (b.z['entwurf'] or {}).get('text') == 'Kurz.')
ok('Korrektur: immer noch nichts an Ralf', not [g for g in gesendet if g[0] == RALF])

# ── 6. Ralf schreibt selbst → Volker bekommt Nachricht + Entwurf, Ralf nichts ─
b, gesendet, prompts = frisch(['ENTWURF Ralf\nGute Idee, schaue ich mir an!'])
b.verarbeite({'id': 8, 'von': RALF, 'text': 'Idee: Buchstaben zum Beleuchten!'})
ok('Ralf: bekommt keine automatische Antwort', not [g for g in gesendet if g[0] == RALF], gesendet)
ok('Ralf: Volker sieht das Original', gesendet and 'Idee: Buchstaben' in gesendet[0][1])
ok('Ralf: Antwortentwurf liegt zur Freigabe bereit', (b.z['entwurf'] or {}).get('nummer') == RALF)
b.verarbeite({'id': 9, 'von': VOLKER, 'text': '👍'})
ok('Ralf: nach Daumen hoch geht die Antwort raus', [g for g in gesendet if g[0] == RALF])

# ── 7. 24-Stunden-Fenster zu → parken, später von selbst nachschicken ────────
b, gesendet, prompts = frisch(['ENTWURF Ralf\nHallo Ralf'], fenster_zu={RALF})
b.verarbeite({'id': 10, 'von': VOLKER, 'text': 'sag Ralf Bescheid'})
b.verarbeite({'id': 11, 'von': VOLKER, 'text': 'ja'})
ok('Fenster zu: nichts an Ralf durchgerutscht', not [g for g in gesendet if g[0] == RALF])
ok('Fenster zu: Text ist geparkt', RALF in b.z['geparkt'])
ok('Fenster zu: Volker wird erklärt, warum', '24-Stunden' in gesendet[-1][1])
b._senden = lambda an, text: (gesendet.append((an, text)), {'ok': True})[1]   # Fenster geht auf
b.verarbeite({'id': 12, 'von': RALF, 'text': 'Moin, alles klar?'})
ok('Fenster auf: geparkter Text geht nachträglich raus',
   [g for g in gesendet if g[0] == RALF and 'Hallo Ralf' in g[1]])
ok('Fenster auf: nichts bleibt liegen', not b.z['geparkt'].get(RALF))

# ── 8. Unbekannter Empfänger: kein Rätselraten, Volker bekommt den Text ──────
b, gesendet, prompts = frisch(['ENTWURF Sabine\nHallo Sabine'])
b.verarbeite({'id': 13, 'von': VOLKER, 'text': 'schreib Sabine'})
ok('Unbekannter Empfänger: nichts gesendet, Text an Volker',
   len(gesendet) == 1 and gesendet[0][0] == VOLKER and 'keine Nummer' in gesendet[0][1])
ok('Unbekannter Empfänger: kein Entwurf hängen geblieben', b.z['entwurf'] is None)

# ── 9. Notbremse gegen Endlosschleifen ───────────────────────────────────────
b, gesendet, prompts = frisch(['ANTWORT\nok'] * 3)
b.z['laeufe'] = [A.jetzt()] * CONF['laeufe_pro_stunde']
b.verarbeite({'id': 14, 'von': VOLKER, 'text': 'noch was'})
ok('Notbremse: Claude wird nicht mehr gerufen', not prompts)
ok('Notbremse: Volker erfährt es', 'Pause' in gesendet[-1][1])

# ── 10. Konnte Volker nicht erreicht werden, wird nachgereicht ───────────────
b, gesendet, prompts = frisch(['ANTWORT\nerste', 'ANTWORT\nzweite'], fenster_zu={VOLKER})
b.verarbeite({'id': 15, 'von': VOLKER, 'text': 'frage eins'})
ok('Fenster zu bei Volker: Notiz aufgehoben', b.z['notizen'] == ['erste'], b.z['notizen'])
b._senden = lambda an, text: (gesendet.append((an, text)), {'ok': True})[1]
b.verarbeite({'id': 16, 'von': VOLKER, 'text': 'frage zwei'})
ok('Nachreichen: beide Antworten in einer Nachricht',
   gesendet and 'erste' in gesendet[-1][1] and 'zweite' in gesendet[-1][1], gesendet[-1:])
ok('Nachreichen: Notizen sind geleert', b.z['notizen'] == [])

# ── 11. Auto-Modus: kurz vorlesen, aber Entwuerfe trotzdem ganz ─────────────
# Worum es geht: Volker laesst sich die Antwort im Auto von Android Auto
# vorlesen. Eine 3500-Zeichen-Antwort sind vorgelesen Minuten am Stueck.

ok('Kuerzen schneidet am Satzende',
   A.kuerzen('Satz eins. Satz zwei. Satz drei ist zu lang.', 35) == 'Satz eins. Satz zwei.',
   A.kuerzen('Satz eins. Satz zwei. Satz drei ist zu lang.', 35))
# Liegt das letzte Satzende so frueh, dass mehr als die halbe erlaubte Laenge
# wegfiele, wird stattdessen an der Wortgrenze geschnitten — sonst bliebe von
# einer 600-Zeichen-Antwort wegen eines fruehen Punktes ein Dreizeiler uebrig.
ok('Zu frueher Punkt wird verworfen, dann Wortgrenze',
   A.kuerzen('Erster Satz. Zweiter Satz laeuft ueber die Grenze hinaus.', 30)
   == 'Erster Satz. Zweiter Satz …',
   A.kuerzen('Erster Satz. Zweiter Satz laeuft ueber die Grenze hinaus.', 30))
ok('Kuerzen schneidet nie mitten im Wort',
   ' ' not in A.kuerzen('Erster Satz. Zweiter Satz laeuft ueber die Grenze hinaus.', 30)[-6:-2])
ok('Kuerzen laesst Kurzes in Ruhe', A.kuerzen('Passt schon.', 600) == 'Passt schon.')

b, gesendet, prompts = frisch([])
b.verarbeite({'id': 20, 'von': VOLKER, 'text': 'Auto an'})
ok('„Auto an" schaltet um', b.z.get('auto') is True)
ok('„Auto an" fragt Claude gar nicht erst', prompts == [], prompts)
ok('„Auto an" wird bestaetigt', gesendet and 'Auto-Modus an' in gesendet[-1][1], gesendet[-1:])
ok('Auto-Haltung haengt jetzt am Systemtext', 'IM AUTO' in b.systemtext())

lang = 'Satz eins ist fertig. ' * 60
b._denken = lambda prompt, sitzung: {'text': 'ANTWORT\n' + lang, 'sitzung': 'sid-1', 'fehler': ''}
b.verarbeite({'id': 21, 'von': VOLKER, 'text': 'und nun?'})
ok('Im Auto wird die Antwort gekuerzt',
   0 < len(gesendet[-1][1]) <= CONF.get('auto_max_zeichen', 600), len(gesendet[-1][1]))
ok('Gekuerzt wird sauber am Satzende', gesendet[-1][1].endswith('.'), gesendet[-1][1][-40:])

# Der wichtigste Fall: einen Entwurf muss er GANZ hoeren, sonst gibt er etwas
# frei, das er nur halb kennt.
entwurf = 'Moin Ralf! ' + ('Das ist eine lange Erklaerung. ' * 40)
b._denken = lambda prompt, sitzung: {'text': 'ENTWURF Ralf\n' + entwurf, 'sitzung': 'sid-1', 'fehler': ''}
b.verarbeite({'id': 22, 'von': VOLKER, 'text': 'schreib Ralf'})
ok('Entwurf wird trotz Auto-Modus ganz gezeigt',
   len(gesendet[-1][1]) > CONF.get('auto_max_zeichen', 600) and entwurf.strip() in gesendet[-1][1],
   len(gesendet[-1][1]))

# Umschalten muss auch mitten in einer offenen Freigabe gehen
ok('Entwurf liegt noch an', b.z.get('entwurf') is not None)
b.verarbeite({'id': 23, 'von': VOLKER, 'text': 'Bin da'})
ok('„Bin da" schaltet wieder aus', b.z.get('auto') is False)
ok('Umschalten laesst den offenen Entwurf stehen', b.z.get('entwurf') is not None)
ok('Auto-Haltung ist wieder weg', 'IM AUTO' not in b.systemtext())

# Und der Entwurf laesst sich danach normal freigeben
b.verarbeite({'id': 24, 'von': VOLKER, 'text': 'ja'})
ok('Freigabe nach dem Umschalten geht an Ralf', gesendet[-2][0] == RALF, gesendet[-2][0])

print('\n' + ('%d FEHLER: %s' % (len(fehler), ', '.join(fehler)) if fehler else 'Alles grün.'))
sys.exit(1 if fehler else 0)
