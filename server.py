"""Servidor local (opcional): serve o app e executa a verificação no seu PC.

Uso:  python server.py     e abra  http://127.0.0.1:8770
Só escuta em 127.0.0.1. O app online (GitHub Pages) funciona sem isto.
"""
import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import enjoei_alert as core

PORT = 8770  # a 8765 é usada pelo Garimpo
SITE = core.BASE / "docs"
USER_FILES = {"alerts.json", "watch.json", "discarded.json", "run.json"}  # o app pode gravar estes
mimetypes.add_type("application/manifest+json", ".webmanifest")

_lock = threading.Lock()
_state = {"running": False, "pending": False}


def trigger_check():
    """Roda a verificação em segundo plano; edições durante a execução geram uma nova rodada."""
    with _lock:
        if _state["running"]:
            _state["pending"] = True
            return
        _state["running"] = True

    def work():
        while True:
            try:
                core.check()
            except Exception as e:
                print("Erro na verificação:", e)
            with _lock:
                if not _state["pending"]:
                    _state["running"] = False
                    return
                _state["pending"] = False

    threading.Thread(target=work, daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json", cache="no-store"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith(("text", "application/json")) else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/status":
            return self.send(200, {"running": _state["running"] or _state["pending"]})
        rel = "index.html" if path == "/" else path.lstrip("/")
        f = (SITE / rel).resolve()
        if SITE.resolve() not in f.parents or not f.is_file():
            return self.send(404, {"erro": "não encontrado"})
        self.send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] or "application/octet-stream")

    def origin_ok(self):
        return self.headers.get("Origin") in (None, f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}")

    def body(self):
        return self.rfile.read(int(self.headers.get("Content-Length") or 0))

    def do_PUT(self):
        name = self.path.split("?")[0].removeprefix("/data/")
        if not self.origin_ok() or name not in USER_FILES:
            return self.send(403, {"erro": "não permitido"})
        try:
            data = json.loads(self.body())
            core.save(name, data)
        except Exception as e:
            return self.send(400, {"erro": str(e)})
        trigger_check()
        self.send(200, {"ok": True})

    def do_POST(self):
        if not self.origin_ok():
            return self.send(403, {"erro": "origem não permitida"})
        if self.path == "/api/run":
            trigger_check()
            return self.send(200, {"ok": True})
        self.send(404, {"erro": "não encontrado"})


if __name__ == "__main__":
    print(f"Abra http://127.0.0.1:{PORT}  (Ctrl+C para sair)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
