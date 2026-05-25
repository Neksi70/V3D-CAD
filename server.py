#!/usr/bin/env python3
"""HTTP-Server für Volme3D — serviert volme3d-occt.wasm als gzip (Content-Encoding)."""
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

WASM_GZ = 'volme3d-occt.wasm.gz'

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] == '/volme3d-occt.wasm' and os.path.exists(WASM_GZ):
            with open(WASM_GZ, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'application/wasm')
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(data)))
            SimpleHTTPRequestHandler.end_headers(self)  # kein CORS-Override hier
            self.wfile.write(data)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = HTTPServer(('', 8080), Handler)
    print('Volme3D Server: http://localhost:8080')
    server.serve_forever()
