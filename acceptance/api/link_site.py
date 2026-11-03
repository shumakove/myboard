"""Сайт-образец и приманка для приёмки EMB-01, EMB-02, EMB-04 (T7.3).

Запускается отдельным контейнером в сети стека: под именем `linksite` он разрешён
в LINK_PREVIEW_ALLOWED_HOSTS, под именем `decoy` — нет. Наружу порт опубликован, чтобы тесты
читали журнал запросов (`/log`) и браузер открывал страницы (`/bait`, `/host`).
Код продукта не импортируется; только стандартная библиотека.
"""

from __future__ import annotations

import base64
import gzip
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=="
)
LOG: list[dict[str, object]] = []
LOCK = threading.Lock()

BAIT = b"""<!doctype html><title>bait</title><script>
const out = {};
try { out.parent = String(parent.document.title); } catch (e) { out.parent = 'blocked'; }
try { out.cookie = document.cookie; } catch (e) { out.cookie = 'blocked'; }
try { out.referrer = document.referrer; } catch (e) { out.referrer = 'blocked'; }
try { top.location.href = '/navigated'; out.top = 'assigned'; } catch (e) { out.top = 'blocked'; }
try { out.alert = 'none'; window.alert('x'); out.alert = 'called'; } catch (e) { out.alert = 'blocked'; }
try { navigator.geolocation; out.geo = document.featurePolicy ? document.featurePolicy.allowsFeature('geolocation') : null; out.camera = document.featurePolicy ? document.featurePolicy.allowsFeature('camera') : null; } catch (e) {}
out.origin = String(self.origin);
out.frameRef = %s;
fetch('/report?data=' + encodeURIComponent(JSON.stringify(out)));
</script>bait page"""


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args: object) -> None:
        pass

    def _record(self, parts: object, query: dict[str, list[str]]) -> None:
        with LOCK:
            LOG.append(
                {
                    "path": self.path,
                    "host": self.headers.get("Host"),
                    "agent": self.headers.get("User-Agent"),
                    "referer": self.headers.get("Referer"),
                    "cookie": self.headers.get("Cookie"),
                    "at": time.time(),
                }
            )

    def _send(self, body: bytes, ctype: str = "text/html; charset=utf-8", status: int = 200, extra: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _meta(self, title: str, image: str | None = None) -> bytes:
        tag = f'<meta property="og:image" content="{image}">' if image is not None else ""
        return f"<!doctype html><html><head><title>{title}</title>{tag}</head><body>x</body></html>".encode()

    def do_GET(self) -> None:  # noqa: N802, C901, PLR0912, PLR0915
        parts = urlsplit(self.path)
        q = parse_qs(parts.query, keep_blank_values=True)
        path = parts.path
        arg = (q.get("to") or q.get("n") or q.get("src") or [""])[0]
        if path == "/log":
            with LOCK:
                self._send(json.dumps(LOG).encode(), "application/json")
            return
        self._record(parts, q)
        if path == "/page":
            self._send(self._meta("QA page title", "/img.png"))
        elif path == "/og":
            self._send(b'<html><head><title>plain</title><meta property="og:title" content="OG title"><meta name="twitter:image" content="/img.png"></head></html>')
        elif path == "/img.png":
            self._send(PNG, "image/png")
        elif path == "/notitle":
            self._send(b"<html><body>nothing</body></html>")
        elif path == "/xss":
            self._send(b'<html><head><title>&lt;img src=x onerror="window.__pwned=1"&gt;&lt;script&gt;window.__pwned=2&lt;/script&gt;</title><meta property="og:image" content="javascript:window.__pwned=3"></head></html>')
        elif path == "/longtitle":
            self._send(("<title>" + "t" * 5000 + "</title>").encode())
        elif path == "/cp1251":
            self._send("<title>Страница</title>".encode("cp1251"), "text/html; charset=windows-1251")
        elif path == "/badcharset":
            self._send(b"<title>charset</title>", "text/html; charset=no-such-charset")
        elif path == "/text":
            self._send(b"<title>not html</title>", "text/plain")
        elif path == "/json":
            self._send(b'{"title":"not html"}', "application/json")
        elif path == "/status":
            self._send(self._meta("error page"), status=int(arg or 500))
        elif path == "/redir":
            self._send(b"", status=int((q.get("code") or ["302"])[0]), extra={"Location": arg})
        elif path == "/chain":
            n = int(arg or 0)
            if n <= 0:
                self._send(self._meta("Chain end"))
            else:
                self._send(b"", status=302, extra={"Location": f"/chain?n={n - 1}"})
        elif path == "/loop":
            self._send(b"", status=302, extra={"Location": "/loop"})
        elif path == "/refresh":
            self._send(f'<meta http-equiv="refresh" content="0;url={arg}">'.encode())
        elif path == "/img-at":
            self._send(self._meta("Image elsewhere", arg))
        elif path == "/huge-head":
            # Название за пределом страницы.
            self._send(b"<!--" + b"x" * (3 * 1024 * 1024) + b"--><title>beyond limit</title>")
        elif path == "/near-limit":
            self._send(b"<title>inside limit</title>" + b"x" * (900 * 1024))
        elif path == "/endless":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            try:
                self.wfile.write(b"<title>endless</title>")
                chunk = b"x" * 65536
                sent = 0
                while sent < 2 * 1024 * 1024 * 1024:
                    self.wfile.write(chunk)
                    sent += len(chunk)
                with LOCK:
                    LOG.append({"path": "/endless:finished", "sent": sent})
            except OSError:
                with LOCK:
                    LOG.append({"path": "/endless:cut", "at": time.time()})
        elif path == "/bomb":
            body = gzip.compress(b"<title>bomb</title>" + b"\0" * (300 * 1024 * 1024), 9)
            self._send(body, "text/html", extra={"Content-Encoding": "gzip"})
        elif path == "/slow":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            try:
                for _ in range(120):
                    self.wfile.write(b"<!-- drip -->")
                    self.wfile.flush()
                    time.sleep(0.5)
            except OSError:
                pass
        elif path == "/hang":
            time.sleep(40)
            self.close_connection = True
        elif path == "/big-img":
            self._send(self._meta("Big image", "/big.png"))
        elif path == "/big.png":
            self._send(PNG + b"\0" * (6 * 1024 * 1024), "image/png")
        elif path == "/html-as-png":
            self._send(self._meta("Spoofed image", "/spoof.png"))
        elif path == "/spoof.png":
            self._send(b"<!doctype html><script>window.__pwned=9</script>", "image/png")
        elif path == "/svg-page":
            self._send(self._meta("Svg image", "/x.svg"))
        elif path == "/x.svg":
            self._send(b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "image/svg+xml")
        elif path == "/html-img":
            self._send(self._meta("Html as image", "/page"))
        elif path == "/control-img":
            self._send(b'<title>control</title><meta property="og:image" content="http://linksite:8099/a\x01b.png">')
        elif path == "/long-img":
            self._send(b'<title>long</title><meta property="og:image" content="http://linksite:8099/' + b"a" * 70000 + b'">')
        elif path == "/badport-img":
            self._send(b'<title>port</title><meta property="og:image" content="http://linksite:99999/a.png">')
        elif path == "/badhost-img":
            self._send(b'<title>host</title><meta property="og:image" content="http://[::1/a.png">')
        elif path == "/parser":
            kind = arg or (q.get("kind") or ["lt"])[0]
            size = 1024 * 1024 - 64
            unit = {
                "lt": b"<",
                "comment": b"<!--",
                "tag": b"<a ",
                "attr": b"<a b='",
                "pi": b"<?",
                "decl": b"<!",
                "close": b"</",
                "ent": b"&#",
                "title": b"<title>a</title>",
                "meta": b'<meta name="a" content="b">',
                "cdata": b"<![",
            }[kind]
            self._send((unit * (size // len(unit)))[:size], "text/html")
        elif path == "/bait":
            frame_ref = json.dumps(arg).encode()
            self._send(BAIT % frame_ref)
        elif path == "/host":
            # Внешняя страница с iframe: EMB-04 (тот же хост и другой сайт).
            src = (q.get("src") or [""])[0]
            self._send(
                f'<!doctype html><title>host page</title><h1>host page</h1><iframe id="f" src="{src}" width="1000" height="640"></iframe>'.encode(),
                extra={"Content-Security-Policy": "default-src * 'unsafe-inline'"},
            )
        elif path == "/report":
            self._send(b"ok", "text/plain")
        else:
            self._send(self._meta("Default"))


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8099), Handler).serve_forever()
