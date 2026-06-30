/* FinLens 로컬 프론트 서버 — 의존성 0 (Node 내장 http/fs/child_process).
 * 한 프로세스가 (1) 페이지 서빙 + (2) data.json 주기 자동 갱신을 모두 담당.
 *
 *   /            → dashboard.html
 *   /data.json   → analyze 가 생성한 집계 (no-store)
 *   /refresh     → 백그라운드 재집계 트리거 (즉시 응답, 비차단)
 *
 * 실행:  pnpm finlens        (= node scripts/token-analyzer/server.mjs)
 * 환경변수:
 *   FINLENS_PORT           포트 (기본 8091)
 *   FINLENS_REFRESH_HOURS  자동 갱신 주기 시간 (기본 6, 0 이면 자동 갱신 끔)
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(DIR, '..', '..');
const ANALYZE = path.join(DIR, 'analyze.ts');
const DATA = path.join(DIR, 'data.json');
const PORT = Number(process.env.FINLENS_PORT || 8091);
const HOST = '127.0.0.1';
const REFRESH_HOURS = Number(process.env.FINLENS_REFRESH_HOURS ?? 6);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

let refreshing = false;
let lastRefresh = null;

function refresh(reason) {
  if (refreshing) {
    return false;
  }
  refreshing = true;
  console.log(`[refresh] 시작 (${reason}) — analyze.ts 재집계...`);
  const child = spawn(process.execPath, ['-r', 'ts-node/register', ANALYZE], {
    cwd: REPO,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1', NODE_OPTIONS: '--max-old-space-size=4096' },
    stdio: 'ignore',
  });
  child.on('exit', (code) => {
    refreshing = false;
    lastRefresh = new Date().toISOString();
    console.log(`[refresh] 완료 (exit ${code}) @ ${lastRefresh}`);
  });
  child.on('error', (e) => {
    refreshing = false;
    console.error('[refresh] 실패:', e.message);
  });
  return true;
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    let rel = decodeURIComponent(url.pathname);

    if (rel === '/refresh') {
      const started = refresh('manual');
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ started, refreshing, lastRefresh }));
      return;
    }

    if (rel === '/' || rel === '') {
      rel = '/dashboard.html';
    }
    const target = path.normalize(path.join(DIR, rel));
    if (!target.startsWith(DIR)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(target, (err, buf) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('404: ' + rel + '\n(데이터가 없으면 /refresh 또는 pnpm finlens:refresh)');
        return;
      }
      const type = TYPES[path.extname(target)] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(buf);
    });
  } catch {
    res.writeHead(500).end('error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`FinLens → http://${HOST}:${PORT}`);
  if (!fs.existsSync(DATA)) {
    refresh('startup: data.json 없음');
  }
  if (REFRESH_HOURS > 0) {
    setInterval(() => refresh('interval'), REFRESH_HOURS * 3600 * 1000);
    console.log(`자동 갱신: ${REFRESH_HOURS}시간마다 (FINLENS_REFRESH_HOURS=0 으로 끔)`);
  }
});
