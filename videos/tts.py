#!/usr/bin/env python3
"""Sprachausgabe für die Howto-Videos (Piper, offline, deutsche Stimme).

Aufruf:  python3 tts.py <auftrag.json>
Eingabe: {"outDir":"work/xy", "voice":"...onnx", "speed":1.0,
          "lines":[{"id":"s0","text":"Moin!"}, ...]}
Ausgabe (stdout, JSON): [{"id":"s0","file":"work/xy/s0.wav","dur":3.42}, ...]

Die gemessenen Dauern steuern das Timing der Aufnahme: eine Szene bleibt
immer mindestens so lange stehen, wie ihr Satz gesprochen wird.
"""
import json
import os
import sys
import wave

DEFAULT_VOICE = os.path.expanduser(
    '~/.local/share/piper-voices/de_DE-thorsten-medium.onnx')


def main():
    if len(sys.argv) < 2:
        sys.exit('Aufruf: tts.py <auftrag.json>')
    with open(sys.argv[1], encoding='utf-8') as fh:
        job = json.load(fh)

    out_dir = job['outDir']
    os.makedirs(out_dir, exist_ok=True)

    from piper import PiperVoice, SynthesisConfig
    voice = PiperVoice.load(job.get('voice') or DEFAULT_VOICE)

    # length_scale > 1 = langsamer. Für Tutorials etwas ruhiger als Standard,
    # damit Zuschauer beim Mitklicken hinterherkommen.
    syn = SynthesisConfig(length_scale=1.0 / float(job.get('speed', 0.94)))

    result = []
    for line in job['lines']:
        path = os.path.join(out_dir, line['id'] + '.wav')
        text = line['text'].strip()
        if not text:
            result.append({'id': line['id'], 'file': None, 'dur': 0.0})
            continue
        with wave.open(path, 'wb') as wf:
            voice.synthesize_wav(text, wf, syn_config=syn)
        with wave.open(path, 'rb') as wf:
            dur = wf.getnframes() / float(wf.getframerate())
        result.append({'id': line['id'], 'file': path, 'dur': round(dur, 3)})

    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
