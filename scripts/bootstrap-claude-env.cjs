#!/usr/bin/env node
/**
 * export-claude-env.cjs 가 만든 디렉터리를 새 PC 에서 되감는다.
 *
 *   node scripts/bootstrap-claude-env.cjs <내보낸경로> [--dry-run] [--with-hooks]
 *
 *   --dry-run        실제로 바꾸지 않고 실행할 명령·복사 대상만 보여준다 (먼저 이걸로 확인할 것)
 *   --with-hooks     settings.json 의 hooks 블록까지 적용한다 (기본은 안내만)
 *   --replace-hooks  이 PC 에 이미 hooks 가 있어도 덮어쓴다 (없으면 건너뛰고 알린다)
 *
 * 하는 일
 *   1. 마켓플레이스 등록 → 활성 플러그인 설치
 *   2. MCP 서버 등록 (env·headers 값은 현재 셸의 환경 변수에서 채운다 — 없으면 건너뛰고 알린다)
 *   3. skills / agents / commands / hooks 파일 복사 (기존 것은 백업)
 *   4. hooks 는 settings.hooks 를 통째로 교체하며, 명령 안의 옛 홈 경로를 이 PC 의 홈으로 치환
 *
 * permissions 와 defaultMode 는 옮기지 않는다. 새 PC 의 승인 게이트는 그 PC 에서 정한다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const WITH_HOOKS = args.includes('--with-hooks');
const REPLACE_HOOKS = args.includes('--replace-hooks');
const EXPORT_DIR = path.resolve(args.find((arg) => !arg.startsWith('--')) || 'claude-env-export');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const warnings = [];

/**
 * displayArgs 를 주면 로그에는 그것만 찍는다.
 * MCP 등록 인자에는 실제 토큰이 채워진 JSON 이 들어가므로, 화면·CI 로그에는
 * 플레이스홀더 상태의 정의를 대신 보여줘야 한다 (dry-run 도 마찬가지다).
 */
function run(command, commandArgs, displayArgs) {
  const printable = `${command} ${(displayArgs || commandArgs).join(' ')}`;
  if (DRY_RUN) {
    console.log(`  [dry-run] ${printable}`);
    return true;
  }
  try {
    execFileSync(command, commandArgs, { stdio: 'pipe' });
    console.log(`  ✓ ${printable}`);
    return true;
  } catch (error) {
    const detail = (error.stderr || error.stdout || Buffer.from('')).toString().trim().split('\n')[0];
    // 이미 등록된 항목은 실패가 아니다 — 토큰을 채우고 다시 돌리는 흐름이 정상 사용법이라 재실행이 잦다.
    if (/already exists/i.test(detail)) {
      console.log(`  = ${printable} (이미 등록됨)`);
      return true;
    }
    console.log(`  ✗ ${printable}\n      ${detail || error.message}`);
    warnings.push(`실패: ${printable}`);
    return false;
  }
}

/** 마켓플레이스 source 객체를 `claude plugin marketplace add` 인자로 바꾼다. */
function marketplaceTarget(source) {
  if (!source) {
    return null;
  }
  if (source.source === 'github' && source.repo) {
    return source.repo;
  }
  if (source.url) {
    return source.url;
  }
  if (source.path) {
    return source.path;
  }
  return null;
}

/** `${VAR}` 플레이스홀더를 현재 환경 변수로 채운다. 하나라도 비면 null 을 돌려준다. */
function fillSecrets(definition, mcpName) {
  const serialized = JSON.stringify(definition);
  const missing = [];
  const filled = serialized.replace(/\$\{([A-Z0-9_]+)\}/g, (match, key) => {
    const value = process.env[key];
    if (!value) {
      missing.push(key);
      return match;
    }
    return JSON.stringify(value).slice(1, -1);
  });
  if (missing.length) {
    warnings.push(`MCP ${mcpName} 건너뜀 — 환경 변수 없음: ${missing.join(', ')}`);
    return null;
  }
  return filled;
}

function copyAsset(sourceDir, destinationDir, entries, label) {
  if (!entries.length) {
    return;
  }
  console.log(`\n[${label}] ${entries.length}개`);
  if (!DRY_RUN) {
    fs.mkdirSync(destinationDir, { recursive: true });
  }
  for (const entry of entries) {
    const from = path.join(sourceDir, entry);
    const to = path.join(destinationDir, entry);
    if (!fs.existsSync(from)) {
      warnings.push(`${label}/${entry} — 내보낸 디렉터리에 없음`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  [dry-run] ${entry}${fs.existsSync(to) ? ' (기존 백업 후 덮어씀)' : ''}`);
      continue;
    }
    if (fs.existsSync(to)) {
      fs.renameSync(to, `${to}.bak-${stamp}`);
    }
    fs.cpSync(from, to, { recursive: true });
    console.log(`  ✓ ${entry}`);
  }
}

/**
 * hooks 명령 문자열의 옛 홈 경로를 이 PC 의 홈으로 바꾼다.
 * 치환 건수를 함께 돌려줘 dry-run 에서도 몇 곳이 바뀌는지 보이게 한다.
 */
function rewriteHome(hooks, sourceHome) {
  if (!sourceHome || sourceHome === HOME) {
    return { hooks, replaced: 0 };
  }
  const parts = JSON.stringify(hooks).split(sourceHome);
  return { hooks: JSON.parse(parts.join(HOME)), replaced: parts.length - 1 };
}

function collectFragileHookPaths(hooks) {
  const found = new Set();
  JSON.stringify(hooks).replace(/[^"\s]*plugins\/cache\/[^"\s]*/g, (match) => {
    found.add(match);
    return match;
  });
  return [...found];
}

function main() {
  const manifestPath = path.join(EXPORT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`manifest.json 을 찾을 수 없다: ${manifestPath}`);
    console.error('export-claude-env.cjs 가 만든 디렉터리 경로를 인자로 넘길 것.');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}복원 대상: ${EXPORT_DIR}`);
  console.log(`  내보낸 PC 의 홈: ${manifest.sourceHome} → 이 PC: ${HOME}`);

  console.log(`\n[마켓플레이스] ${Object.keys(manifest.marketplaces || {}).length}곳`);
  for (const [name, source] of Object.entries(manifest.marketplaces || {})) {
    const target = marketplaceTarget(source);
    if (!target) {
      warnings.push(`마켓플레이스 ${name} — 출처를 해석할 수 없음`);
      continue;
    }
    run('claude', ['plugin', 'marketplace', 'add', target]);
  }

  console.log(`\n[플러그인] ${(manifest.enabledPlugins || []).length}개`);
  for (const pluginId of manifest.enabledPlugins || []) {
    run('claude', ['plugin', 'install', pluginId]);
  }

  console.log(`\n[MCP] ${Object.keys(manifest.mcpServers || {}).length}개`);
  for (const [name, definition] of Object.entries(manifest.mcpServers || {})) {
    const filled = fillSecrets(definition, name);
    if (!filled) {
      console.log(`  - ${name} 건너뜀 (환경 변수 미설정)`);
      continue;
    }
    const mcpArgs = ['mcp', 'add-json', '--scope', 'user', name];
    run('claude', [...mcpArgs, filled], [...mcpArgs, JSON.stringify(definition)]);
  }

  const assets = manifest.assets || {};
  copyAsset(path.join(EXPORT_DIR, 'skills'), path.join(CLAUDE_DIR, 'skills'), assets.skills || [], 'skills');
  copyAsset(path.join(EXPORT_DIR, 'agents'), path.join(CLAUDE_DIR, 'agents'), assets.agents || [], 'agents');
  copyAsset(
    path.join(EXPORT_DIR, 'commands'),
    path.join(CLAUDE_DIR, 'commands'),
    assets.commands || [],
    'commands',
  );
  copyAsset(path.join(EXPORT_DIR, 'hooks'), path.join(CLAUDE_DIR, 'hooks'), assets.hooks || [], 'hooks');

  applyHooks(manifest);

  console.log('\n--- 결과 ---');
  if (warnings.length) {
    console.log(`주의 ${warnings.length}건:`);
    warnings.forEach((warning) => console.log(`  - ${warning}`));
  } else {
    console.log('경고 없음.');
  }
  console.log(`\n남은 수동 작업은 ${path.join(EXPORT_DIR, 'SECRETS-TODO.md')} 참고.`);
  if (DRY_RUN) {
    console.log('실제 적용하려면 --dry-run 을 빼고 다시 실행할 것.');
  }
}

function applyHooks(manifest) {
  const hookEvents = Object.keys(manifest.hooks || {});
  if (!hookEvents.length) {
    return;
  }
  console.log(`\n[hooks] ${hookEvents.length}종`);

  const fragile = collectFragileHookPaths(manifest.hooks);
  if (fragile.length) {
    warnings.push(
      `hook ${fragile.length}건이 플러그인 캐시 경로를 직접 가리킨다 — 새 PC 의 플러그인 버전이 다르면 깨진다. 설치 후 settings.json 에서 경로 확인 필요.`,
    );
  }

  if (!WITH_HOOKS) {
    console.log('  건너뜀 — 병합하려면 --with-hooks 를 붙일 것.');
    console.log('  (hook 은 매 세션 실행되는 코드다. 내용을 먼저 읽고 결정하는 편이 안전하다.)');
    return;
  }

  // 이 PC 에 이미 hooks 가 있으면 덮어쓰지 않는다. settings.hooks 는 통째로 교체되는 값이라
  // 그 PC 에서 쓰던 훅이 즉시 비활성화된다. 백업은 남지만 실행 환경은 이미 바뀐 뒤다.
  const existingEvents = Object.keys(
    (fs.existsSync(SETTINGS_PATH) ? JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) : {}).hooks || {},
  );
  if (existingEvents.length && !REPLACE_HOOKS) {
    console.log(`  건너뜀 — 이 PC 에 이미 hooks ${existingEvents.length}종이 있다.`);
    console.log('  덮어쓰려면 --replace-hooks 를 붙일 것 (기존 settings.json 은 백업된다).');
    warnings.push(`hooks 미적용 — 기존 ${existingEvents.length}종 보존 (덮어쓰려면 --replace-hooks)`);
    return;
  }

  const { hooks: rewritten, replaced } = rewriteHome(manifest.hooks, manifest.sourceHome);
  console.log(`  홈 경로 치환 ${replaced}곳 (${manifest.sourceHome} → ${HOME})`);
  if (DRY_RUN) {
    console.log(`  [dry-run] settings.json 의 hooks 를 ${hookEvents.length}종으로 교체 (기존은 백업)`);
    return;
  }

  const hadSettings = fs.existsSync(SETTINGS_PATH);
  const settings = hadSettings ? JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) : {};
  if (hadSettings) {
    fs.copyFileSync(SETTINGS_PATH, `${SETTINGS_PATH}.bak-${stamp}`);
  }
  settings.hooks = rewritten;
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(
    `  ✓ hooks ${hookEvents.length}종 적용${hadSettings ? ` (기존 settings.json 은 .bak-${stamp} 로 백업)` : ' (기존 settings.json 없음 — 새로 만듦)'}`,
  );
}

main();
