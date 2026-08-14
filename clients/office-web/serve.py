#!/usr/bin/env python3
"""웹 렌더러를 브라우저에 띄우기 위한 개발용 서버.

정적 파일을 서빙하면서 `/v1/*` 요청만 이대리 백엔드로 넘긴다.

**프록시가 필요한 이유는 CORS 다.** 백엔드(`127.0.0.1:3099`)가 `Access-Control-Allow-Origin`
을 주지 않아 브라우저가 다른 포트에서 온 fetch 를 막는다. 백엔드에 헤더를 여는 대신 여기서
같은 출처로 만든다 — 백엔드는 로컬 관제용이라 열어 둘 이유가 없고, 3단계에서 Electron 으로
포장하면 브라우저 출처 제약 자체가 사라져 이 파일은 개발용으로만 남는다.

    python3 serve.py [포트]        기본 8777
    IDAERI_CONSOLE_URL=... python3 serve.py
"""

import os
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BACKEND = os.environ.get("IDAERI_CONSOLE_URL", "http://127.0.0.1:3099")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        if self.path.startswith("/v1/"):
            self.proxy()
            return
        super().do_GET()

    def proxy(self):
        url = f"{BACKEND}{self.path}"
        try:
            upstream = urllib.request.urlopen(url, timeout=None)
        except urllib.error.URLError as error:
            self.send_error(502, f"백엔드에 못 닿았다: {error}")
            return
        self.send_response(200)
        content_type = upstream.headers.get("Content-Type", "application/json")
        self.send_header("Content-Type", content_type)
        # 실시간 스트림(SSE)은 길이를 모른 채 계속 흐른다 — 버퍼링을 끄지 않으면
        # 이벤트가 뭉쳐서 도착해 화면이 뚝뚝 끊긴다.
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        try:
            # 줄 단위로 넘긴다. SSE 는 줄로 끊어지는 형식이라 이벤트가 도착하는 즉시
            # 흘러가고, 한 덩어리로 오는 JSON 응답도 같은 경로로 처리된다.
            for line in upstream:
                self.wfile.write(line)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # 브라우저가 탭을 닫은 것 — 정상 종료다
        finally:
            upstream.close()

    def log_message(self, fmt, *args):
        # 스프라이트 102장 요청이 매번 쏟아져 실제로 봐야 할 오류가 묻힌다.
        if "/v1/" in self.path or "layout" in self.path:
            super().log_message(fmt, *args)


if __name__ == "__main__":
    print(f"오피스 웹 렌더러: http://127.0.0.1:{PORT}  (백엔드 {BACKEND})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
