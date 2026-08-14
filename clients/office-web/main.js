// 이대리 오피스를 윈도우 PC 에 설치해 띄우는 껍데기.
//
// 그림은 `office.js`·`live.js` 가 그대로 그린다. 이 파일이 맡는 일은 두 가지다 —
// **어느 맥에 붙을지 기억하고**, 그 맥을 창과 같은 출처로 만들어 준다.
//
// 왜 창에서 백엔드로 바로 부르지 않는가: 백엔드가 `Access-Control-Allow-Origin` 을 주지
// 않아 다른 출처에서 온 fetch 를 브라우저가 막는다. Electron 은 그 방어를 끌 수 있지만
// (`webSecurity: false`) 그건 창 전체의 보호를 내리는 대가다. 대신 loopback 서버를 하나
// 띄워 창을 그 주소에 붙이면 `live.js` 의 `fetch("/v1/...")` 와
// `EventSource("/v1/console/stream")` 이 개발용 `serve.py` 아래서와 **똑같은 코드로** 돈다.

const { app, BrowserWindow, Menu, dialog } = require("electron");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

/** 설정 화면이 처음 보여 줄 주소. 맥에서 직접 띄워 볼 때는 이 주소가 맞다. */
const DEFAULT_SERVER_URL = "http://127.0.0.1:3099";
/**
 * 한 방 요청(스냅샷·연결 확인)의 상한(밀리초).
 *
 * 실시간 스트림에는 걸지 않는다 — 응답이 끝나지 않는 형식이라 상한을 걸면 정상 연결을
 * 끊는다. 반대로 스냅샷에 상한이 없으면 맥이 켜져 있으면서 응답만 안 주는 상태(절전 진입
 * 직후가 그렇다)에서 화면이 "읽는 중" 에 영영 멈춘다.
 */
const REQUEST_TIMEOUT_MS = 10_000;
/** 설정 본문의 상한. 주소와 토큰 두 줄짜리 JSON 보다 크면 우리 화면이 보낸 것이 아니다. */
const SETTINGS_BODY_LIMIT = 4096;
/** 연결 확인 응답을 받아 둘 상한. 스냅샷은 수십 KB 라 이보다 크면 이대리 백엔드가 아니다. */
const PROBE_BODY_LIMIT = 1_000_000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

let server = null;
let serverPort = 0;
let mainWindow = null;

// MARK: - 설정

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

/** 저장된 서버 주소와 토큰. 첫 실행이면 빈 주소를 돌려준다(오류가 아니다). */
function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return { url: String(parsed.url ?? ""), token: String(parsed.token ?? "") };
  } catch {
    return { url: "", token: "" };
  }
}

function writeSettings(next) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
}

/**
 * 사람이 친 주소를 URL 로 만든다.
 *
 * `100.101.102.103:3099` 처럼 스킴을 빼고 치는 쪽이 오히려 자연스럽다 — 붙여 주지 않으면
 * 주소 해석이 실패해 "주소 형식이 아니다" 로 되돌려 보내게 된다.
 */
function normalizeServerUrl(raw) {
  const trimmed = String(raw ?? "").trim().replace(/\/+$/, "");
  if (trimmed === "") {
    return "";
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

// MARK: - 정적 파일

/**
 * 스프라이트 102 장이 놓인 자리.
 *
 * 개발 실행(맥) 에서 `sprites` 는 맥 앱 리소스로 가는 심볼릭 링크다 — 에셋을 두 벌 두지
 * 않으려고 2단계에서 그렇게 뒀으므로 여기서도 링크를 따라간다. 설치본에는 링크를 넣을 수
 * 없어 `extraResources` 로 실제 파일이 복사되고, 그때는 그쪽을 본다.
 */
function spritesRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "sprites")
    : path.join(__dirname, "sprites");
}

/**
 * URL 경로를 실제 파일 경로로 옮긴다. 루트 밖으로 나가는 요청은 `null` 을 돌려준다.
 *
 * loopback 서버라도 포트를 알아낸 브라우저 탭 하나가 요청을 보낼 수 있으므로 `..` 를
 * 끼워 넣어 앱 밖 파일을 읽어 가려는 경로는 여기서 끊는다.
 */
function resolveStaticPath(pathname) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const isSprite = decoded.startsWith("/sprites/");
  const root = isSprite ? spritesRoot() : __dirname;
  const relative = isSprite
    ? decoded.slice("/sprites/".length)
    : decoded.replace(/^\/+/, "");
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

function serveStatic(pathname, response) {
  const filePath = resolveStaticPath(pathname);
  if (filePath === null) {
    respondJson(response, 403, { message: "앱 밖의 파일은 주지 않는다" });
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      respondJson(response, 404, { message: `${pathname} 을 못 찾았다` });
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(content);
  });
}

function respondJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

// MARK: - 백엔드

/** 설정된 맥으로 보낼 헤더. */
function backendHeaders(settings, accept) {
  const headers = { Accept: accept ?? "*/*" };
  // 백엔드의 읽기 경로는 지금 토큰을 검사하지 않는다(`console-write.guard.ts` 주석 참조).
  // 그래도 실어 보내는 이유는 서버에 가드가 생기는 날 앱을 다시 깔지 않아도 되게 함이다.
  if (settings.token !== "") {
    headers["x-console-token"] = settings.token;
  }
  return headers;
}

function backendClient(target) {
  return target.protocol === "https:" ? https : http;
}

/** `/v1/*` 을 설정된 맥으로 넘긴다. 스냅샷과 실시간 스트림이 같은 경로를 쓴다. */
function proxyToBackend(request, response, settings) {
  if (settings.url === "") {
    respondJson(response, 503, { message: "서버 주소가 아직 정해지지 않았다" });
    return;
  }
  let target = null;
  try {
    target = new URL(request.url, settings.url);
  } catch {
    respondJson(response, 500, { message: `서버 주소를 읽을 수 없다: ${settings.url}` });
    return;
  }
  const isStream = target.pathname.endsWith("/stream");
  const options = { headers: backendHeaders(settings, request.headers.accept) };
  if (!isStream) {
    options.timeout = REQUEST_TIMEOUT_MS;
  }
  const upstream = backendClient(target).request(target, options, (incoming) => {
    response.writeHead(incoming.statusCode ?? 502, {
      "Content-Type": incoming.headers["content-type"] ?? "application/json",
      "Cache-Control": "no-cache",
    });
    incoming.pipe(response);
  });
  upstream.on("timeout", () => {
    upstream.destroy(new Error(`${REQUEST_TIMEOUT_MS / 1000}초 안에 응답이 없었다`));
  });
  upstream.on("error", (error) => {
    if (response.headersSent) {
      // 이미 흘려보낸 응답 중간에 끊긴 것 — 스트림이 그렇다. 화면 쪽이 다시 붙는다.
      response.end();
      return;
    }
    respondJson(response, 502, { message: `맥에 못 닿았다: ${error.message}` });
  });
  // 창을 닫거나 스트림을 다시 붙으면 이쪽 연결도 정리한다. 남겨 두면 맥에 죽은 구독이 쌓인다.
  response.on("close", () => upstream.destroy());
  upstream.end();
}

/**
 * 입력한 주소가 실제로 이대리 백엔드인지 한 번 찔러 본다.
 *
 * 사람이 0 명인 응답을 성공으로 넘기지 않는 이유는 1단계와 같다 — 빈 사무실을 정상으로
 * 받아 두면 "주소는 맞는데 백엔드가 준비되지 않았다" 가 텅 빈 화면으로만 나타난다.
 */
function probeBackend(settings) {
  return new Promise((resolve) => {
    let target = null;
    try {
      target = new URL("/v1/console/snapshot", settings.url);
    } catch {
      resolve({ ok: false, message: "주소 형식이 아니다" });
      return;
    }
    let settled = false;
    let overallTimer = null;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(overallTimer);
      resolve(result);
    };
    const request = backendClient(target).request(
      target,
      { headers: backendHeaders(settings, "application/json"), timeout: REQUEST_TIMEOUT_MS },
      (incoming) => {
        const chunks = [];
        let size = 0;
        incoming.on("data", (chunk) => {
          size += chunk.length;
          // 스냅샷은 수십 KB 다. 이보다 큰 응답을 계속 받아 두면 엉뚱한 주소 하나로 앱의
          // 메모리가 찬다 — 여기서 끊고 "이대리 백엔드가 아니다" 로 답한다.
          if (size > PROBE_BODY_LIMIT) {
            request.destroy(new Error("응답이 너무 크다 — 이대리 백엔드가 아닌 것 같다"));
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("end", () => {
          if (incoming.statusCode !== 200) {
            finish({ ok: false, message: `맥이 HTTP ${incoming.statusCode} 를 줬다` });
            return;
          }
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const data = payload.data ?? payload;
            const people = (data.agents ?? []).length;
            finish(
              people > 0
                ? { ok: true, message: `사무실에 ${people}명 있다` }
                : {
                    ok: false,
                    message: "응답은 왔는데 사람이 0명이다 — 이대리 백엔드가 맞는지 확인하라",
                  }
            );
          } catch {
            finish({ ok: false, message: "이대리 백엔드의 응답 형식이 아니다" });
          }
        });
      }
    );
    // `timeout` 옵션은 **소켓이 조용할 때만** 발동한다. 상류가 데이터를 조금씩 계속 흘리면
    // 유휴가 아니므로 영영 걸리지 않는다 — 전체 시간에도 같은 상한을 둔다.
    overallTimer = setTimeout(() => {
      request.destroy(new Error(`${REQUEST_TIMEOUT_MS / 1000}초 안에 응답이 끝나지 않았다`));
    }, REQUEST_TIMEOUT_MS);
    request.on("timeout", () => {
      request.destroy(new Error(`${REQUEST_TIMEOUT_MS / 1000}초 안에 응답이 없었다`));
    });
    request.on("error", (error) => finish({ ok: false, message: error.message }));
    request.end();
  });
}

// MARK: - 설정 화면이 쓰는 창구

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > SETTINGS_BODY_LIMIT) {
        request.destroy();
        reject(new Error("본문이 너무 크다"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function handleSettings(request, response, current) {
  // 다른 웹페이지가 이 포트를 알아내 설정을 **읽거나** 바꾸지 못하게 한다. 읽기도 막는
  // 이유는 응답에 토큰이 실려 있기 때문이다. 우리 창에서 온 요청은 같은 출처라 브라우저가
  // `Origin` 을 아예 안 붙이거나(GET) 자기 주소로 붙인다(POST) — 남의 페이지에서 오면
  // 항상 그쪽 주소가 찍히므로 여기서 갈린다.
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== `http://127.0.0.1:${serverPort}`) {
    respondJson(response, 403, { message: "다른 출처에서 온 요청이다" });
    return;
  }
  if (request.method === "GET") {
    respondJson(response, 200, { url: current.url || DEFAULT_SERVER_URL, token: current.token });
    return;
  }
  if (request.method !== "POST") {
    respondJson(response, 405, { message: "GET 과 POST 만 받는다" });
    return;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(await readBody(request));
  } catch (error) {
    respondJson(response, 400, { message: `설정을 읽을 수 없다: ${error.message}` });
    return;
  }
  const next = {
    url: normalizeServerUrl(parsed.url),
    token: String(parsed.token ?? "").trim(),
  };
  if (next.url === "") {
    respondJson(response, 400, { message: "서버 주소를 입력하라" });
    return;
  }
  const probe = await probeBackend(next);
  // 확인에 실패해도 저장한다 — 맥이 지금 꺼져 있을 뿐인데 주소를 다시 치게 만들 이유가 없다.
  writeSettings(next);
  respondJson(response, 200, { saved: true, url: next.url, probe });
}

async function handleRequest(request, response) {
  // 이 주소로 온 요청만 받는다.
  //
  // `Origin` 대조만으로는 **DNS rebinding 을 막지 못한다.** 공격자 도메인이 127.0.0.1 로
  // 해석되게 만들면 브라우저 입장에서는 같은 출처가 되어, 같은 출처 GET 이 그렇듯 `Origin`
  // 을 아예 붙이지 않고 지나간다. 그러면 `/settings` 의 토큰과 토큰이 자동으로 실려 나가는
  // `/v1/*` 응답까지 읽힌다. 그때 브라우저가 보내는 `Host` 는 그 도메인이므로 여기서 갈린다
  // — 우리 창은 언제나 `127.0.0.1:<포트>` 를 로드한다.
  if (request.headers.host !== `127.0.0.1:${serverPort}`) {
    respondJson(response, 403, { message: "이 주소로 온 요청만 받는다" });
    return;
  }
  const settings = readSettings();
  const [pathname] = request.url.split("?");
  if (pathname.startsWith("/v1/")) {
    proxyToBackend(request, response, settings);
    return;
  }
  if (pathname === "/settings") {
    await handleSettings(request, response, settings);
    return;
  }
  // 첫 실행은 어느 맥에 붙을지 모른다 — 사무실 대신 설정 화면을 연다.
  const wanted = pathname === "/" ? (settings.url === "" ? "/setup.html" : "/index.html") : pathname;
  serveStatic(wanted, response);
}

// MARK: - 창

function pageUrl(page) {
  return `http://127.0.0.1:${serverPort}/${page}`;
}

/**
 * `--capture=<파일>` — 사무실을 한 판 그려 PNG 로 저장하고 끝낸다.
 *
 * 웹 렌더러의 `?static=1`, 맥 앱의 `--render` 에 해당하는 입구다. 확인 수단이 "사람이 창을
 * 열어 본다" 하나뿐이면, 포장이 그림을 깨뜨려도(스프라이트 경로가 어긋나거나 프록시가
 * 스냅샷을 못 받아도) **아무 오류 없이 텅 빈 창**만 남는다.
 */
function captureTargetFromArgv() {
  const flag = process.argv.find((argument) => argument.startsWith("--capture="));
  return flag === undefined ? null : flag.slice("--capture=".length);
}

/**
 * 다 그려지길 기다렸다가 찍는다. 그리는 중에 찍으면 반쯤 빈 화면이 저장된다.
 *
 * **다 그렸다는 표식만 보면 부족하다.** 화면은 스냅샷을 못 받아도 방과 가구를 그려 내므로,
 * 사람이 0명인 사무실이 "정상 그림" 으로 저장된다. 상태 줄이 오류를 달고 있는지 함께 보고,
 * 그러면 기다리지 않고 바로 실패로 끊는다.
 */
async function captureOnce(window, target) {
  const deadline = Date.now() + 15_000;
  let rendered = false;
  let failed = false;
  while (Date.now() < deadline) {
    [rendered, failed] = await window.webContents.executeJavaScript(
      "[document.body.dataset.rendered === '1'," +
        " document.getElementById('status')?.classList.contains('error') ?? false]"
    );
    if (rendered || failed) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  // 상태 줄을 함께 남긴다 — 못 그렸을 때 그 이유(스냅샷 실패·그림 0장)가 거기 찍혀 있다.
  const status = await window.webContents.executeJavaScript(
    "document.getElementById('status')?.textContent ?? ''"
  );
  fs.writeFileSync(target, (await window.webContents.capturePage()).toPNG());
  const succeeded = rendered && !failed;
  console.log(`${succeeded ? "그렸다" : "다 그리지 못했다"} → ${target}`);
  console.log(`상태: ${status}`);
  return succeeded;
}

/**
 * `--self-check` — 바깥에서 온 문자열을 다루는 두 함수의 경계 조건을 검사하고 끝낸다.
 *
 * `normalizeServerUrl` 은 사람이 친 글자를 **요청이 나갈 주소**로 바꾸고, `resolveStaticPath`
 * 는 URL 을 **열어 줄 파일 경로**로 바꾼다. 뒤쪽이 무너지면 앱 밖 파일이 새므로, 확인을
 * "사람이 curl 로 두드려 본다" 에만 맡기지 않는다. 이 디렉터리는 브라우저·Electron 코드라
 * 레포의 jest 대상(`src/**`)에 들어가지 않아 여기에 둔다.
 */
function selfCheck() {
  const results = [];
  const expect = (label, actual, expected) => {
    results.push({ label, actual, expected, ok: actual === expected });
  };

  expect("스킴 없는 주소에 http 를 붙인다", normalizeServerUrl("127.0.0.1:3099"), "http://127.0.0.1:3099");
  expect("꼬리 슬래시를 떼낸다", normalizeServerUrl("http://mac:3099/"), "http://mac:3099");
  expect("https 는 그대로 둔다", normalizeServerUrl("https://mac:3099"), "https://mac:3099");
  expect("공백만 있으면 빈 값", normalizeServerUrl("   "), "");
  expect("앞뒤 공백을 떼낸다", normalizeServerUrl(" 100.1.2.3:3099 "), "http://100.1.2.3:3099");

  expect("앱 안 파일은 그 경로", resolveStaticPath("/index.html"), path.join(__dirname, "index.html"));
  expect("스프라이트는 스프라이트 뿌리", resolveStaticPath("/sprites/char-down.png"), path.join(spritesRoot(), "char-down.png"));
  expect("상위로 올라가는 경로는 거절", resolveStaticPath("/../main.js"), null);
  expect("스프라이트에서 빠져나가는 경로는 거절", resolveStaticPath("/sprites/../../main.js"), null);
  expect("인코딩된 상위 경로도 거절", resolveStaticPath("/%2e%2e%2f%2e%2e%2fmain.js"), null);
  expect("깨진 인코딩은 거절", resolveStaticPath("/%zz"), null);

  const failed = results.filter((one) => !one.ok);
  for (const one of failed) {
    console.error(`실패: ${one.label}\n  받은 값 ${one.actual}\n  기대   ${one.expected}`);
  }
  console.log(`${results.length - failed.length}/${results.length} 통과`);
  return failed.length === 0;
}

function createWindow() {
  const settings = readSettings();
  const captureTarget = captureTargetFromArgv();
  mainWindow = new BrowserWindow({
    // 2단계에서 맥 앱(`--size 1400x820`) 과 칸 단위로 대조한 창 크기다. 캔버스는 창에서
    // 가로 24px·세로 52px 을 뺀 크기라, 이 값이 맥 화면과 같은 배치를 만든다.
    width: 1424,
    height: 872,
    minWidth: 960,
    minHeight: 563,
    backgroundColor: "#17151a",
    title: "이대리 오피스",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  if (captureTarget !== null) {
    // 사무실은 정지 렌더로 연다 — 실시간 스트림을 열면 "다 그렸다" 에 도달하지 않아 영영
    // 기다린다. 서버 주소를 아직 안 정했으면 그때 실제로 열리는 화면(설정)을 찍는다.
    mainWindow.loadURL(
      pageUrl(settings.url === "" ? "setup.html" : "index.html?static=1&hour=12")
    );
    mainWindow.webContents.once("did-finish-load", async () => {
      const rendered = await captureOnce(mainWindow, captureTarget);
      // 못 그린 것을 성공으로 끝내면 게이트가 텅 빈 그림을 통과시킨다.
      //
      // 종료 코드를 `app.exit` 로 직접 넘기는 이유는 **`process.exitCode` 를 세우고
      // `app.quit()` 을 부르면 그 값이 묻혀 항상 0 으로 끝나기 때문**이다. 판정은 맞는데
      // 종료 코드만 0 이면, 이 입구를 쓰는 게이트는 실패를 통과로 읽는다.
      app.exit(rendered ? 0 : 1);
    });
    return;
  }
  mainWindow.loadURL(pageUrl(settings.url === "" ? "setup.html" : "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "사무실",
        submenu: [
          {
            label: "서버 설정",
            accelerator: "CmdOrCtrl+,",
            click: () => mainWindow?.loadURL(pageUrl("setup.html")),
          },
          { label: "새로 고침", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.reload() },
          {
            label: "개발자 도구",
            accelerator: "CmdOrCtrl+Alt+I",
            click: () => mainWindow?.webContents.toggleDevTools(),
          },
          { type: "separator" },
          { role: "quit", label: "종료" },
        ],
      },
    ])
  );
}

app.whenReady().then(() => {
  if (process.argv.includes("--self-check")) {
    app.exit(selfCheck() ? 0 : 1);
    return;
  }
  server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (!response.headersSent) {
        respondJson(response, 500, { message: String(error) });
      }
    });
  });
  server.on("error", (error) => {
    dialog.showErrorBox("이대리 오피스", `창을 띄울 준비를 못 했다: ${error.message}`);
    app.quit();
  });
  // 포트 0 = 남는 포트를 운영체제가 고른다. 고정 포트를 쓰면 다른 프로그램이 그 포트를
  // 잡고 있을 때 기동이 실패하거나, 더 나쁘게는 엉뚱한 서버에 창을 붙이게 된다.
  server.listen(0, "127.0.0.1", () => {
    serverPort = server.address().port;
    // 포트가 매번 달라 진단할 때 알 방법이 없다 — 띄운 자리를 남긴다.
    console.log(`창이 붙을 자리: http://127.0.0.1:${serverPort}  (맥: ${readSettings().url || "아직 없음"})`);
    console.log(`설정 파일: ${settingsPath()}`);
    buildMenu();
    createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
