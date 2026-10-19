"""Client-IP und Rate-Limit (übernommen vom V3D-Mail-Connector).

Der Dienst lauscht nur auf 127.0.0.1; von außen kommt man über nginx (setzt
X-Real-IP hart) bzw. den Tailscale-Funnel (setzt X-Forwarded-For).
"""
import time
from collections import defaultdict, deque

from starlette.responses import JSONResponse

# (Pfad-Präfix, Anfragen, Zeitfenster in s) — erste passende Regel gilt
REGELN = [
    ('/register', 10, 3600),
    ('/login', 20, 600),
    ('/authorize', 30, 600),
    ('/token', 60, 600),
    ('/revoke', 30, 600),
    ('/mcp', 600, 60),
    ('', 120, 60),
]


def client_ip(scope):
    kopf = dict(scope.get('headers') or [])
    for name in (b'x-real-ip', b'x-forwarded-for'):
        if name in kopf:
            erste = kopf[name].decode('latin-1').split(',')[0].strip()
            if erste:
                return erste[:64]
    c = scope.get('client')
    return c[0] if c else 'unbekannt'


class RateLimit:
    def __init__(self, app):
        self.app = app
        self.fenster = defaultdict(deque)

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        pfad = scope.get('path') or ''
        for praefix, anzahl, sekunden in REGELN:
            if pfad.startswith(praefix):
                break
        schluessel = (client_ip(scope), praefix)
        jetzt = time.monotonic()
        q = self.fenster[schluessel]
        while q and q[0] < jetzt - sekunden:
            q.popleft()
        if len(q) >= anzahl:
            antwort = JSONResponse({'error': 'rate_limited', 'error_description': 'Zu viele Anfragen'},
                                   status_code=429, headers={'Retry-After': str(sekunden)})
            return await antwort(scope, receive, send)
        q.append(jetzt)
        if len(self.fenster) > 5000:        # Speicher begrenzen
            self.fenster.clear()
        return await self.app(scope, receive, send)
