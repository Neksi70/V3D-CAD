# Kern + App-Teil in volme3d.html zurückschreiben (Block zwischen den Markern)
import re
h = open('/home/v3da/volme3d.html').read()
core = open('/home/v3da/tools/adventskalender/adv_core.js').read().rstrip() + '\n'
app = open('/home/v3da/tools/adventskalender/adv_app.js').read().rstrip() + '\n'
a = h.index('// ═══ ADVENTSKALENDER-GENERATOR'); b = h.index('// ═══ ALIGN / MIRROR')
h = h[:a] + core + '\n' + app + '\n' + h[b:]
open('/home/v3da/volme3d.html', 'w').write(h)
print('ok')
