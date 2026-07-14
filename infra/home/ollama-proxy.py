#!/usr/bin/env python3
"""Proxy Ollama for Cloudflare Tunnel (rewrites Host so Ollama accepts requests)."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request

OLLAMA = "http://127.0.0.1:11434"
LISTEN = ("127.0.0.1", 11435)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print(f"[ollama-proxy] {self.address_string()} {fmt % args}")

    def _proxy(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(
            f"{OLLAMA}{self.path}",
            data=body,
            method=self.command,
        )
        for key, value in self.headers.items():
            if key.lower() == "host":
                continue
            req.add_header(key, value)
        req.add_header("Host", "127.0.0.1:11434")
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                self.send_response(resp.status)
                for key, value in resp.headers.items():
                    if key.lower() in ("transfer-encoding", "connection"):
                        continue
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(resp.read())
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.end_headers()
            self.wfile.write(e.read())

    def do_GET(self):
        self._proxy()

    def do_POST(self):
        self._proxy()

    def do_DELETE(self):
        self._proxy()


if __name__ == "__main__":
    server = ThreadingHTTPServer(LISTEN, Handler)
    print(f"Ollama proxy on http://{LISTEN[0]}:{LISTEN[1]} -> {OLLAMA}")
    server.serve_forever()
