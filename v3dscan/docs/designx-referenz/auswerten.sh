#!/bin/bash
# Bereitet ein Schulungsvideo zur Auswertung vor:
#   <nr>/text.txt      Mitschrift, ein Block je ~20 s mit Zeitmarke
#   <nr>/bild_MMSS.jpg Standbild bei jedem deutlichen Bildwechsel (min. 8 s Abstand) + alle 45 s
# Aufruf: ./auswerten.sh 03   (im Ordner videos/)
set -e
n="$1"; cd "$(dirname "$0")/videos"
mkdir -p "$n"
# Mitschrift: Auto-Untertitel wiederholen Zeilen -> doppelte entfernen, in 20-s-Blöcke fassen
python3 -I - "$n.en.srt" "$n/text.txt" <<'EOF'
import re, sys
src, dst = sys.argv[1], sys.argv[2]
bl = re.split(r'\n\s*\n', open(src, encoding='utf-8').read())
out, last, cur, start = [], '', [], None
for b in bl:
    z = b.strip().splitlines()
    if len(z) < 3: continue
    m = re.match(r'(\d+):(\d+):(\d+)', z[1]);  t = int(m[1])*3600+int(m[2])*60+int(m[3])
    for line in z[2:]:
        line = re.sub(r'<[^>]+>', '', line).strip()
        if not line or line == last: continue
        last = line
        if start is None: start = t
        cur.append(line)
    if start is not None and t - start >= 20:
        out.append(f'[{start//60:02d}:{start%60:02d}] ' + ' '.join(cur)); cur, start = [], None
if cur: out.append(f'[{start//60:02d}:{start%60:02d}] ' + ' '.join(cur))
open(dst, 'w').write('\n'.join(out) + '\n')
EOF
# Standbilder: Zeitpunkte der Bildwechsel ermitteln
ffmpeg -hide_banner -loglevel info -i "$n.mp4" -vf "select='gt(scene,0.12)',showinfo" -f null - 2>&1 \
  | grep -o 'pts_time:[0-9.]*' | cut -d: -f2 > "$n/wechsel.txt" || true
dauer=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$n.mp4" | cut -d. -f1)
python3 -I - "$n/wechsel.txt" "$dauer" > "$n/zeiten.txt" <<'EOF'
import sys
w = [float(x) for x in open(sys.argv[1]) if x.strip()]
d = int(sys.argv[2])
ts = sorted(set([t + 1.5 for t in w] + list(range(5, d, 45))))
sel, lt = [], -99
for t in ts:
    if t - lt >= 8 and t < d: sel.append(t); lt = t
print('\n'.join(f'{t:.1f}' for t in sel))
EOF
while read t; do
  s=${t%.*}; name=$(printf 'bild_%02d%02d.jpg' $((s/60)) $((s%60)))
  ffmpeg -nostdin -loglevel error -ss "$t" -i "$n.mp4" -frames:v 1 -q:v 4 -y "$n/$name"
done < "$n/zeiten.txt"
echo "$n: $(ls $n/bild_*.jpg | wc -l) Bilder, $(wc -l < $n/text.txt) Textblöcke"
