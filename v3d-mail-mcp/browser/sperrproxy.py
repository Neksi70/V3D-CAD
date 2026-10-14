#!/usr/bin/env python3
"""Sperr-Proxy für den Server-Browser (Playwright MCP).

Chrome schickt JEDE Verbindung hierher (auch localhost, siehe <-loopback> in
config.json). Der Proxy löst den Namen selbst auf und verbindet nur zu
öffentlichen Adressen — und zwar zu genau der geprüften IP (kein DNS-Rebinding).
Gesperrt: der Server selbst, Heimnetz, Tailnet (100.64/10, fd7a:…), Link-Local,
Multicast, reservierte Bereiche. So kommt Claude über den Browser nicht an die
internen Dienste (Mail, CAD, Bank …), auch nicht per Weiterleitung.

Start: python3 sperrproxy.py [port]   (Standard 8813, bindet nur 127.0.0.1)
"""
import asyncio
import ipaddress
import socket
import sys
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8813
MAX_KOPF = 64 * 1024
VERBINDEN_FRIST = 15


def log(*teile):
    sys.stderr.write(time.strftime('%H:%M:%S ') + ' '.join(str(t) for t in teile) + '\n')


def erlaubt(ip):
    ip = ipaddress.ip_address(ip)
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


async def aufloesen(host, port):
    """Erste öffentliche Adresse — oder None, wenn IRGENDEINE Adresse intern ist."""
    host = host.strip('[]')
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    adressen = [i[4][0] for i in infos]
    if not adressen or not all(erlaubt(a) for a in adressen):
        return None
    return adressen[0]


async def weiterreichen(lesen, schreiben):
    try:
        while True:
            daten = await lesen.read(65536)
            if not daten:
                break
            schreiben.write(daten)
            await schreiben.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        try:
            schreiben.close()
        except Exception:
            pass


async def antwort(schreiben, code, text):
    body = text.encode()
    schreiben.write(('HTTP/1.1 %d %s\r\nContent-Type: text/plain; charset=utf-8\r\n'
                     'Content-Length: %d\r\nConnection: close\r\n\r\n' % (code, text, len(body))).encode() + body)
    try:
        await schreiben.drain()
    finally:
        schreiben.close()


def ziel_trennen(hostport, standard):
    if hostport.startswith('['):
        host, _, rest = hostport[1:].partition(']')
        port = rest.lstrip(':') or standard
    elif hostport.count(':') == 1:
        host, port = hostport.split(':')
    else:
        host, port = hostport, standard
    return host, int(port)


async def bearbeiten(c_lesen, c_schreiben):
    try:
        kopf = await asyncio.wait_for(c_lesen.readuntil(b'\r\n\r\n'), 30)
    except Exception:
        c_schreiben.close()
        return
    if len(kopf) > MAX_KOPF:
        return await antwort(c_schreiben, 431, 'Kopf zu gross')
    zeilen = kopf.decode('latin-1').split('\r\n')
    try:
        methode, ziel, version = zeilen[0].split(' ', 2)
    except ValueError:
        return await antwort(c_schreiben, 400, 'Bad Request')

    if methode == 'CONNECT':
        host, port = ziel_trennen(ziel, 443)
        rest = b''
    else:
        if not ziel.startswith('http://'):
            return await antwort(c_schreiben, 400, 'Nur http:// oder CONNECT')
        hostport, _, pfad = ziel[7:].partition('/')
        host, port = ziel_trennen(hostport, 80)
        # Anfrage in Server-Form umschreiben, Proxy-Kopfzeilen weg
        neu = ['%s /%s %s' % (methode, pfad, version)]
        neu += [z for z in zeilen[1:] if z and not z.lower().startswith(('proxy-', 'connection:'))]
        neu.append('Connection: close')
        rest = ('\r\n'.join(neu) + '\r\n\r\n').encode('latin-1')

    try:
        ip = await aufloesen(host, port)
    except OSError:
        return await antwort(c_schreiben, 502, 'Name nicht aufloesbar')
    if ip is None:
        log('GESPERRT', host, port)
        return await antwort(c_schreiben, 403, 'Gesperrt: interne Adresse')

    try:
        s_lesen, s_schreiben = await asyncio.wait_for(asyncio.open_connection(ip, port), VERBINDEN_FRIST)
    except Exception:
        return await antwort(c_schreiben, 502, 'Ziel nicht erreichbar')

    if methode == 'CONNECT':
        c_schreiben.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
        await c_schreiben.drain()
    else:
        s_schreiben.write(rest)
        await s_schreiben.drain()
    await asyncio.gather(weiterreichen(c_lesen, s_schreiben), weiterreichen(s_lesen, c_schreiben))


async def main():
    server = await asyncio.start_server(bearbeiten, '127.0.0.1', PORT, limit=MAX_KOPF)
    log('Sperr-Proxy auf 127.0.0.1:%d' % PORT)
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    asyncio.run(main())
