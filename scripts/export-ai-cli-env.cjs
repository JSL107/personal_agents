#!/usr/bin/env node
/**
 * 이 PC 의 AI CLI 개인 환경을 다른 PC 에서 재현할 수 있는 형태로 내보낸다.
 * Claude Code(`~/.claude`) 와 Codex(`~/.codex`) 둘 다 다루며, 설치돼 있지 않은 쪽은 건너뛴다.
 *
 *   node scripts/export-ai-cli-env.cjs [출력경로]
 *
 * 산출물 (기본 ./ai-cli-env-export/)
 *   manifest.json      도구별 마켓플레이스·플러그인·MCP 정의 (비밀값은 ${VAR} 플레이스홀더)
 *   claude/            skills · agents · commands · hooks 사본
 *   codex/             agents · skills · rules · AGENTS.md 사본
 *   SECRETS-TODO.md    새 PC 에서 직접 발급·로그인해야 하는 항목
 *
 * 심볼릭 링크는 실체로 풀어서 복사한다.
 * 비밀값(토큰·API 키)과 인증 파일(`~/.codex/auth.json` 등)은 담지 않는다.
 * permissions / defaultMode 도 담지 않는다 — 이식하면 새 PC 의 승인 게이트가 풀린다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const CODEX_DIR = path.join(HOME, '.codex');
const CLAUDE_JSON = path.join(HOME, '.claude.json');
const OUT_DIR = path.resolve(process.argv[2] || 'ai-cli-env-export');

/**
 * 자산 복사 시 건너뛸 것들 — 백업 잔재와 숨김 항목.
 * 숨김 항목은 도구가 스스로 관리하는 영역이다(`.DS_Store`, `~/.codex/skills/.system` 의
 * 기본 제공 스킬 등). 옮기면 새 PC 의 런타임이 설치한 버전과 어긋난다.
 */
const SKIP_PATTERNS = [/^\./, /\.bak(-[\w-]+)?$/];
/** url·args 에 자격 증명이 박혀 있을 수 있는 흔한 형태 — 치환은 못 하니 경고만 한다. */
const CREDENTIAL_IN_TEXT = /(token|key|secret|password|auth|credential|access[-_]?code)=|:\/\/[^/@\s]+:[^/@\s]+@/i;
/** 이 PC 에서만 유효한 경로 — 새 PC 에 같은 위치가 없으므로 옮기지 않는다. */
const LOCAL_PATH = /^(\/|\.\.?\/|~\/)/;

const CLAUDE_ASSET_DIRS = ['skills', 'agents', 'commands', 'hooks'];
const CODEX_ASSET_DIRS = ['agents', 'skills', 'rules'];
const CODEX_ASSET_FILES = ['AGENTS.md'];

/** 새 PC 에서 채워야 하는 값 — {tool, mcp, field, envKey}. */
const secretsRequired = [];
/** url·args 에 자격 증명이 보이는 MCP — 사람이 직접 확인해야 한다. */
const credentialWarnings = [];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** CLI 를 실행해 JSON 출력을 받는다. 명령이 없거나 실패하면 null. */
function readCommandJson(command, commandArgs) {
  try {
    return JSON.parse(execFileSync(command, commandArgs, { encoding: 'utf8', stdio: 'pipe' }));
  } catch {
    return null;
  }
}

function shouldSkip(name) {
  return SKIP_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * 심볼릭 링크를 실체로 풀어서 복사한다.
 * ~/.claude/skills 와 agents 는 상당수가 ~/.agents, ~/im-not-ai 로 가는 링크라,
 * dereference 없이 복사하면 새 PC 에서 전부 끊어진 링크가 된다.
 */
function copyAssets(sourceDir, destinationDir) {
  if (!fs.existsSync(sourceDir)) {
    return [];
  }
  const copied = [];
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir)) {
    if (shouldSkip(entry)) {
      continue;
    }
    try {
      fs.cpSync(path.join(sourceDir, entry), path.join(destinationDir, entry), {
        recursive: true,
        dereference: true,
      });
      copied.push(entry);
    } catch (error) {
      console.warn(`  ! ${entry} 복사 실패 (끊어진 링크로 추정): ${error.message}`);
    }
  }
  return copied;
}

function copyFile(sourcePath, destinationDir) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }
  fs.mkdirSync(destinationDir, { recursive: true });
  fs.cpSync(sourcePath, path.join(destinationDir, path.basename(sourcePath)), { dereference: true });
  return true;
}

/** 실행 정의(command·args·url)가 이 PC 안의 경로를 가리키는지 본다. */
function pointsAtLocalPath(values) {
  return values.filter((value) => typeof value === 'string').some((value) => LOCAL_PATH.test(value));
}

/**
 * env·headers 값을 ${키이름} 플레이스홀더로 바꾼다.
 *
 * 키 이름 패턴(token·secret 따위)으로 고르지 않고 값을 전부 바꾼다.
 * `Cookie`·`DSN`·`ACCESS_CODE` 처럼 이름만 봐서는 비밀인지 알 수 없는 키가 흔하고,
 * 하나라도 놓치면 자격 증명이 그대로 파일에 남기 때문이다.
 * 비밀이 아닌 값은 새 PC 에서 같은 이름으로 export 하면 그대로 복원된다.
 */
function redactFields(target, tool, mcpName) {
  for (const field of ['env', 'headers']) {
    for (const key of Object.keys(target[field] || {})) {
      target[field][key] = `\${${key}}`;
      secretsRequired.push({ tool, mcp: mcpName, field, envKey: key });
    }
  }
}

function noteCredentialInText(tool, mcpName, values) {
  if (values.filter((value) => typeof value === 'string').some((value) => CREDENTIAL_IN_TEXT.test(value))) {
    credentialWarnings.push(`${tool}/${mcpName}`);
  }
}

// ---------------------------------------------------------------- Claude Code

function collectClaude() {
  if (!fs.existsSync(CLAUDE_DIR)) {
    return null;
  }
  const settings = readJson(path.join(CLAUDE_DIR, 'settings.json')) || {};
  const claudeJson = readJson(CLAUDE_JSON) || {};
  const marketplaces = readJson(path.join(CLAUDE_DIR, 'plugins', 'known_marketplaces.json')) || {};

  const mcpServers = {};
  for (const [name, definition] of Object.entries(claudeJson.mcpServers || {})) {
    const copy = JSON.parse(JSON.stringify(definition));
    redactFields(copy, 'claude', name);
    noteCredentialInText('claude', name, [copy.url, ...(copy.args || [])]);
    mcpServers[name] = copy;
  }

  const assets = {};
  for (const directory of CLAUDE_ASSET_DIRS) {
    assets[directory] = copyAssets(
      path.join(CLAUDE_DIR, directory),
      path.join(OUT_DIR, 'claude', directory),
    );
  }

  return {
    marketplaces: Object.fromEntries(
      Object.entries(marketplaces).map(([name, entry]) => [name, entry.source]),
    ),
    enabledPlugins: Object.entries(settings.enabledPlugins || {})
      .filter(([, enabled]) => enabled)
      .map(([id]) => id),
    mcpServers,
    hooks: settings.hooks || {},
    assets,
  };
}

// ---------------------------------------------------------------------- Codex

/**
 * Codex 는 config.toml 이 단일 소스지만 TOML 파서를 들이지 않고 CLI 의 JSON 출력을 쓴다.
 * 로컬 경로에서 오는 마켓플레이스·플러그인(코덱스 설치본이 기본 제공)과 데스크톱 앱이
 * 주입한 MCP 는 새 PC 에서 자동으로 다시 생기므로 옮기지 않고 목록만 남긴다.
 */
function collectCodex() {
  if (!fs.existsSync(CODEX_DIR)) {
    return null;
  }
  const marketplaceList = readCommandJson('codex', ['plugin', 'marketplace', 'list', '--json']);
  if (!marketplaceList) {
    console.warn('  ! codex CLI 를 실행할 수 없어 Codex 설정은 건너뛴다 (자산만 복사).');
  }

  const skipped = { marketplaces: [], plugins: [], mcpServers: [] };

  const marketplaces = {};
  for (const entry of marketplaceList?.marketplaces || []) {
    const source = entry.marketplaceSource || {};
    if (source.sourceType !== 'git') {
      skipped.marketplaces.push(`${entry.name} (${source.sourceType || '출처 불명'})`);
      continue;
    }
    marketplaces[entry.name] = source.source;
  }

  const pluginList = readCommandJson('codex', ['plugin', 'list', '--json']);
  const plugins = [];
  for (const entry of pluginList?.installed || []) {
    if (!entry.installed || !entry.enabled) {
      continue;
    }
    if (!marketplaces[entry.marketplaceName]) {
      skipped.plugins.push(`${entry.pluginId} (기본 제공 마켓)`);
      continue;
    }
    plugins.push(entry.pluginId);
  }

  const mcpServers = {};
  for (const entry of readCommandJson('codex', ['mcp', 'list', '--json']) || []) {
    const transport = entry.transport || {};
    const launchValues = [transport.command, ...(transport.args || [])];
    if (pointsAtLocalPath(launchValues)) {
      skipped.mcpServers.push(`${entry.name} (이 PC 경로 실행)`);
      continue;
    }
    const copy = {
      type: transport.type,
      command: transport.command,
      args: transport.args || [],
      url: transport.url,
      env: transport.env || {},
      enabled: entry.enabled,
    };
    redactFields(copy, 'codex', entry.name);
    noteCredentialInText('codex', entry.name, [copy.url, ...copy.args]);
    mcpServers[entry.name] = copy;
  }

  const assets = {};
  for (const directory of CODEX_ASSET_DIRS) {
    assets[directory] = copyAssets(
      path.join(CODEX_DIR, directory),
      path.join(OUT_DIR, 'codex', directory),
    );
  }
  assets.files = CODEX_ASSET_FILES.filter((name) =>
    copyFile(path.join(CODEX_DIR, name), path.join(OUT_DIR, 'codex')),
  );

  return {
    marketplaces,
    plugins,
    mcpServers,
    hooks: (readJson(path.join(CODEX_DIR, 'hooks.json')) || {}).hooks || {},
    assets,
    skipped,
  };
}

// ----------------------------------------------------------------------- 실행

function summarize(label, tool) {
  if (!tool) {
    console.log(`  ${label}: 설치돼 있지 않아 건너뜀`);
    return;
  }
  const pluginCount = (tool.enabledPlugins || tool.plugins || []).length;
  const assetCount = Object.values(tool.assets)
    .filter(Array.isArray)
    .reduce((sum, entries) => sum + entries.length, 0);
  console.log(
    `  ${label}: 마켓 ${Object.keys(tool.marketplaces).length} · 플러그인 ${pluginCount} · MCP ${Object.keys(tool.mcpServers).length} · 자산 ${assetCount} · hook 이벤트 ${Object.keys(tool.hooks).length}`,
  );
  for (const [kind, entries] of Object.entries(tool.skipped || {})) {
    if (entries.length) {
      console.log(`    - ${kind} 제외 ${entries.length}건: ${entries.join(', ')}`);
    }
  }
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const claude = collectClaude();
  const codex = collectCodex();

  if (!claude && !codex) {
    console.error('~/.claude 도 ~/.codex 도 없다. 내보낼 것이 없다.');
    process.exit(1);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceHome: HOME,
    claude,
    codex,
    secretsRequired,
    notes: [
      'permissions / defaultMode 는 의도적으로 제외 — 이식하면 새 PC 의 승인 게이트가 풀린다.',
      '인증 파일(~/.codex/auth.json, keychain)과 대화 기록(sessions·projects·memories)은 담지 않는다.',
      'hooks 의 명령 문자열에 남은 sourceHome 경로는 bootstrap 이 새 PC 의 홈으로 치환한다.',
      '로컬 경로에서 오는 Codex 마켓플레이스·플러그인·MCP 는 새 PC 에서 자동으로 다시 생기므로 제외한다.',
    ],
  };

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, 'SECRETS-TODO.md'), buildSecretsDoc());

  console.log(`내보내기 완료 → ${OUT_DIR}`);
  summarize('Claude Code', claude);
  summarize('Codex', codex);
  console.log(`  비밀값 ${secretsRequired.length}건 마스킹`);
  if (credentialWarnings.length) {
    console.log(`\n  ! ${credentialWarnings.join(', ')} 의 url/args 에 자격 증명으로 보이는 값이 있다.`);
    console.log('    이 부분은 자동 치환하지 않았다 — manifest.json 을 열어 직접 확인할 것.');
  }
  console.log(`\n새 PC 로 ${path.basename(OUT_DIR)} 디렉터리를 옮긴 뒤:`);
  console.log('  node scripts/bootstrap-ai-cli-env.cjs <옮긴경로> --dry-run');
}

function buildSecretsDoc() {
  const envLines = secretsRequired.length
    ? secretsRequired
        .map((item) => `- \`${item.envKey}\` — ${item.tool} 의 MCP \`${item.mcp}\` (\`${item.field}\`)`)
        .join('\n')
    : '- (없음)';

  return `# 새 PC 에서 직접 해야 하는 것

MCP 의 env·headers 값은 이름과 무관하게 전부 플레이스홀더로 바뀌어 있다. 아래는 새 PC 에서
사람이 직접 채우거나 로그인해야 하는 항목이다.

## 환경 변수 (bootstrap 실행 전에 export)

비밀이 아닌 값(예: 로그 레벨)도 같은 규칙으로 빠져 있으니, 원래 값을 그대로 export 하면 된다.

${envLines}

## 대화형 인증 (명령으로 옮길 수 없음)

- Notion · Figma · Slack MCP — 첫 사용 시 브라우저 OAuth
- \`codex login\` (ChatGPT 구독) — \`~/.codex/auth.json\` 은 내보내지 않는다
- \`claude setup-token\` 또는 keychain 로그인

## 이대리 본체 (AI CLI 환경과 별개)

- \`.env\` 전체 — Slack 봇/앱 토큰, \`DATABASE_URL\`, GitHub PAT
- PostgreSQL @ 5434 · Redis @ 6381 — \`docker compose up -d\`
- \`pnpm install\` → \`pnpm prisma:generate\` → \`pnpm db:push\`
- Slack 앱 재설치 (슬래시 커맨드 + \`app_mention\` 이벤트 구독)
`;
}

main();
