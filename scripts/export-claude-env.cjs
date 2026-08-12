#!/usr/bin/env node
/**
 * 이 PC 의 Claude Code 개인 환경 (플러그인 / MCP / skills / agents / commands / hooks) 을
 * 다른 PC 에서 재현할 수 있는 형태로 내보낸다.
 *
 *   node scripts/export-claude-env.cjs [출력경로]
 *
 * 산출물 (기본 ./claude-env-export/)
 *   manifest.json      플러그인·마켓플레이스·MCP 정의 (비밀값은 ${VAR} 플레이스홀더로 치환)
 *   skills/ agents/ commands/ hooks/   자산 사본 — 심볼릭 링크는 실체로 풀어서 복사
 *   SECRETS-TODO.md    새 PC 에서 직접 발급·로그인해야 하는 항목
 *
 * 비밀값 (토큰·API 키) 은 절대 담지 않는다. permissions / defaultMode 도 담지 않는다
 * (이 PC 는 bypassPermissions 라 그대로 옮기면 새 PC 의 안전장치가 풀린다).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const CLAUDE_JSON = path.join(HOME, '.claude.json');
const OUT_DIR = path.resolve(process.argv[2] || 'claude-env-export');

/** 자산 복사 시 건너뛸 것들 — 백업 잔재와 macOS 메타파일. */
const SKIP_PATTERNS = [/^\.DS_Store$/, /^\.sync-backup-/, /\.bak(-[\w-]+)?$/];
/** env 키 이름이 이 패턴이면 값 대신 ${키이름} 플레이스홀더를 남긴다. */
const SECRET_KEY = /token|key|secret|password|auth|credential/i;

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

/** MCP 서버 정의에서 비밀값을 ${키이름} 으로 바꾸고, 필요한 키 목록을 모은다. */
function redactMcpServers(servers, secretsRequired) {
  const redacted = {};
  for (const [name, definition] of Object.entries(servers || {})) {
    const copy = JSON.parse(JSON.stringify(definition));
    for (const key of Object.keys(copy.env || {})) {
      if (SECRET_KEY.test(key)) {
        copy.env[key] = `\${${key}}`;
        secretsRequired.push({ mcp: name, envKey: key });
      }
    }
    for (const key of Object.keys(copy.headers || {})) {
      if (SECRET_KEY.test(key)) {
        copy.headers[key] = `\${${key}}`;
        secretsRequired.push({ mcp: name, envKey: key });
      }
    }
    redacted[name] = copy;
  }
  return redacted;
}

function main() {
  const settings = readJson(path.join(CLAUDE_DIR, 'settings.json')) || {};
  const claudeJson = readJson(CLAUDE_JSON) || {};
  const marketplaces = readJson(path.join(CLAUDE_DIR, 'plugins', 'known_marketplaces.json')) || {};

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const secretsRequired = [];
  const mcpServers = redactMcpServers(claudeJson.mcpServers, secretsRequired);

  const enabledPlugins = Object.entries(settings.enabledPlugins || {})
    .filter(([, enabled]) => enabled)
    .map(([id]) => id);

  const assets = {
    skills: copyAssets(path.join(CLAUDE_DIR, 'skills'), path.join(OUT_DIR, 'skills')),
    agents: copyAssets(path.join(CLAUDE_DIR, 'agents'), path.join(OUT_DIR, 'agents')),
    commands: copyAssets(path.join(CLAUDE_DIR, 'commands'), path.join(OUT_DIR, 'commands')),
    hooks: copyAssets(path.join(CLAUDE_DIR, 'hooks'), path.join(OUT_DIR, 'hooks')),
  };

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceHome: HOME,
    marketplaces: Object.fromEntries(
      Object.entries(marketplaces).map(([name, entry]) => [name, entry.source]),
    ),
    enabledPlugins,
    mcpServers,
    secretsRequired,
    hooks: settings.hooks || {},
    assets,
    notes: [
      'permissions / defaultMode 는 의도적으로 제외 — 이 PC 는 bypassPermissions 라 이식하면 새 PC 의 승인 게이트가 풀린다.',
      'hooks 의 명령 문자열에 남은 sourceHome 경로는 bootstrap 이 새 PC 의 홈으로 치환한다.',
      '플러그인 캐시 경로를 직접 가리키는 hook 은 버전이 바뀌면 깨진다 — bootstrap 이 경고한다.',
    ],
  };

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, 'SECRETS-TODO.md'), buildSecretsDoc(secretsRequired));

  console.log(`내보내기 완료 → ${OUT_DIR}`);
  console.log(`  마켓플레이스 ${Object.keys(manifest.marketplaces).length}곳`);
  console.log(`  활성 플러그인 ${enabledPlugins.length}개`);
  console.log(`  MCP 서버 ${Object.keys(mcpServers).length}개 (비밀값 ${secretsRequired.length}건 마스킹)`);
  console.log(
    `  자산 — skills ${assets.skills.length} / agents ${assets.agents.length} / commands ${assets.commands.length} / hooks ${assets.hooks.length}`,
  );
  console.log(`  hook 이벤트 ${Object.keys(manifest.hooks).length}종`);
  console.log(`\n새 PC 로 ${path.basename(OUT_DIR)} 디렉터리를 옮긴 뒤:`);
  console.log('  node scripts/bootstrap-claude-env.cjs <옮긴경로> --dry-run');
}

function buildSecretsDoc(secretsRequired) {
  const envLines = secretsRequired.length
    ? secretsRequired.map((item) => `- \`${item.envKey}\` — MCP \`${item.mcp}\` 용`).join('\n')
    : '- (없음)';

  return `# 새 PC 에서 직접 해야 하는 것

내보내기에는 비밀값이 담기지 않는다. 아래는 새 PC 에서 사람이 직접 발급·로그인해야 하는 항목이다.

## 환경 변수 (bootstrap 실행 전에 export)

${envLines}

## 대화형 인증 (명령으로 옮길 수 없음)

- Notion MCP — 첫 사용 시 브라우저 OAuth
- Figma / Slack MCP — 워크스페이스 재인증
- \`codex\` CLI — \`codex login\` (ChatGPT 구독)
- \`claude\` CLI — \`claude setup-token\` 또는 keychain 로그인

## 이대리 본체 (Claude Code 환경과 별개)

- \`.env\` 전체 — Slack 봇/앱 토큰, \`DATABASE_URL\`, GitHub PAT
- PostgreSQL @ 5434 · Redis @ 6381 — \`docker compose up -d\`
- \`pnpm install\` → \`pnpm prisma:generate\` → \`pnpm db:push\`
- Slack 앱 재설치 (슬래시 커맨드 + \`app_mention\` 이벤트 구독)
`;
}

main();
