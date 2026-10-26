#!/usr/bin/env python3
# Druckfehler-Doktor: Bambu-Studio-Begriffe (englische msgid) -> deutsche msgstr aus BambuStudio.mo.
# Eingabe: JSON-Liste der msgids auf stdin. Ausgabe: JSON {msgid: msgstr|null}.
# Mit --js: fertige Zeile "const _DFD_T = {...};" für volme3d.html.
import gettext, json, sys
MO = '/home/v3da/tools/bambustudio/squashfs-root/resources/i18n/de/BambuStudio.mo'
t = gettext.GNUTranslations(open(MO, 'rb'))
terms = json.load(sys.stdin)
out = {k: t._catalog.get(k) for k in terms}
if '--js' in sys.argv:
    miss = [k for k, v in out.items() if v is None]
    if miss: sys.exit('fehlt in .mo: ' + ', '.join(miss))
    print('const _DFD_T = ' + json.dumps(out, ensure_ascii=False, sort_keys=True) + ';')
else:
    print(json.dumps(out, ensure_ascii=False))
