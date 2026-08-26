#!/usr/bin/env node
/**
 * export-ai-cli-env.cjs 가 만든 디렉터리를 새 PC 에서 되감는다.
 * manifest 에 담긴 도구(Claude Code · Codex)를 각각 복원하며, CLI 가 없는 쪽은 건너뛴다.
 *
 *   node scripts/bootstrap-ai-cli-env.cjs <내보낸경로> [--dry-run] [--all] [--with-hooks] [--replace-hooks] [--replace-global-docs]
 *
 *   --dry-run              실제로 바꾸지 않고 실행할 명령·복사 대상만 보여준다 (먼저 이걸로 확인할 것)
 *   --all                  아래 세 플래그를 한 번에 켠다. 내 PC 를 그대로 옮기는 게 목적일 때 쓴다.
 *                          (남의 PC 나 공용 머신에 적용할 때는 켜지 말 것 — 그 머신의 hooks·전역 규칙을 덮는다)
 *   --with-hooks           hooks 설정까지 적용한다 (기본은 안내만)
 *   --replace-hooks        이 PC 에 이미 hooks 가 있어도 덮어쓴다 (없으면 건너뛰고 알린다)
 *   --replace-global-docs  이 PC 에 이미 있는 전역 지침 문서(~/.claude/CLAUDE.md · ~/.codex/AGENTS.md)를
 *                          덮어쓴다. 기본은 건너뛴다 — 그 머신에서 수기로 더한 규칙이 날아가기 때문이다.
 *
 * 하는 일
 *   1. 마켓플레이스 등록 → 플러그인 설치
 *   2. MCP 서버 등록 (env·headers 값은 현재 셸의 환경 변수에서 채운다 — 없으면 건너뛰고 알린다)
 *   3. skills / agents / commands / rules / AGENTS.md 등 자산 복사 (기존 것은 백업)
 *   4. hooks 는 통째로 교체하며, 명령 안의 옛 홈 경로를 이 PC 의 홈으로 치환
 *
 * permissions 와 defaultMode 는 옮기지 않는다. 새 PC 의 승인 게이트는 그 PC 에서 정한다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const CODEX_DIR = path.join(HOME, '.codex');
const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const CODEX_HOOKS = path.join(CODEX_DIR, 'hooks.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
// --all 은 "이 스냅샷이 곧 내 환경" 인 경우의 프리셋이다. 기본값이 보수적인 이유(hooks 는 매 세션 도는
// 코드, 전역 규칙에는 그 머신 수기분이 있을 수 있음)는 남의 PC 를 전제한 것이라, 내 PC 를 옮길 때는
// 매번 플래그 세 개를 기억해야 하는 쪽이 오히려 사고를 부른다 (붙이지 않으면 hooks 가 한 줄도 안 붙는다).
const ALL = args.includes('--all');
const WITH_HOOKS = ALL || args.includes('--with-hooks');
const REPLACE_HOOKS = ALL || args.includes('--replace-hooks');
const REPLACE_GLOBAL_DOCS = ALL || args.includes('--replace-global-docs');
const EXPORT_DIR = path.resolve(args.find((arg) => !arg.startsWith('--')) || 'ai-cli-env-export');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const warnings = [];
let sourceHome = HOME;

/**
 * displayArgs 를 주면 로그에는 그것만 찍는다.
 * MCP 등록 인자에는 실제 토큰이 채워진 값이 들어가므로, 화면·CI 로그에는
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
    if (/already exists|already installed/i.test(detail)) {
      console.log(`  = ${printable} (이미 등록됨)`);
      return true;
    }
    console.log(`  ✗ ${printable}\n      ${detail || error.message}`);
    warnings.push(`실패: ${printable}`);
    return false;
  }
}

function hasCommand(command) {
  try {
    execFileSync('which', [command], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** 마켓플레이스 source 를 `marketplace add` 인자로 바꾼다. */
function marketplaceTarget(source) {
  if (!source) {
    return null;
  }
  if (typeof source === 'string') {
    return source;
  }
  if (source.source === 'github' && source.repo) {
    return source.repo;
  }
  return source.url || source.path || null;
}

/** `${VAR}` 플레이스홀더를 현재 환경 변수로 채운다. 하나라도 비면 null 을 돌려준다. */
function fillSecrets(values, label) {
  const missing = [];
  const filled = {};
  for (const [key, value] of Object.entries(values || {})) {
    const resolved = String(value).replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => {
      if (!process.env[name]) {
        missing.push(name);
        return match;
      }
      return process.env[name];
    });
    filled[key] = resolved;
  }
  if (missing.length) {
    warnings.push(`${label} 건너뜀 — 환경 변수 없음: ${[...new Set(missing)].join(', ')}`);
    return null;
  }
  return filled;
}

/**
 * protectExisting 이면 이 PC 에 이미 있는 항목은 덮지 않고 건너뛴다.
 * 전역 CLAUDE.md 처럼 그 머신에서 수기로 더한 규칙이 섞이는 파일에 쓴다 — hooks 와 같은 급의 보호다.
 */
function copyAsset(sourceDir, destinationDir, entries, label, protectExisting) {
  if (!entries || !entries.length) {
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
    if (protectExisting && fs.existsSync(to)) {
      console.log(`  건너뜀 ${entry} — 이 PC 에 이미 있다 (덮어쓰려면 --replace-global-docs).`);
      warnings.push(`${label}/${entry} 미적용 — 이 PC 의 기존 파일 보존 (덮어쓰려면 --replace-global-docs)`);
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
function rewriteHome(hooks) {
  if (!sourceHome || sourceHome === HOME) {
    return { hooks, replaced: 0 };
  }
  const parts = JSON.stringify(hooks).split(sourceHome);
  return { hooks: JSON.parse(parts.join(HOME)), replaced: parts.length - 1 };
}

/** 이 PC 에만 있는 경로를 가리키는 hook 명령을 찾는다 (앱 번들·패키지 매니저 경로 등). */
function collectFragileHookPaths(hooks) {
  const found = new Set();
  JSON.stringify(hooks).replace(/[^"\s]*(plugins\/cache|\/Applications\/|\/opt\/)[^"\s]*/g, (match) => {
    found.add(match);
    return match;
  });
  return [...found];
}

// ------------------------------------------------------------------ hooks 적용

/**
 * hooks 설정 전체를 교체한다. 기존 값이 있으면 --replace-hooks 없이는 건드리지 않는다.
 * 이벤트별로 병합하지 않는 이유는, 같은 훅이 양쪽에 있을 때 조용히 두 번 실행되기 때문이다.
 */
function applyHooks(label, hooks, targetPath) {
  const hookEvents = Object.keys(hooks || {});
  if (!hookEvents.length) {
    return;
  }
  console.log(`\n[${label} hooks] ${hookEvents.length}종`);

  const fragile = collectFragileHookPaths(hooks);
  if (fragile.length) {
    warnings.push(
      `${label} hook ${fragile.length}건이 이 PC 전용 경로(플러그인 캐시·앱 번들 등)를 가리킨다 — 새 PC 에서 확인 필요.`,
    );
  }

  if (!WITH_HOOKS) {
    console.log('  건너뜀 — 적용하려면 --with-hooks 를 붙일 것.');
    console.log('  (hook 은 매 세션 실행되는 코드다. 내용을 먼저 읽고 결정하는 편이 안전하다.)');
    return;
  }

  const current = fs.existsSync(targetPath) ? JSON.parse(fs.readFileSync(targetPath, 'utf8')) : {};
  const existingEvents = Object.keys(current.hooks || {});
  if (existingEvents.length && !REPLACE_HOOKS) {
    console.log(`  건너뜀 — 이 PC 에 이미 hooks ${existingEvents.length}종이 있다.`);
    console.log('  덮어쓰려면 --replace-hooks 를 붙일 것 (기존 파일은 백업된다).');
    warnings.push(`${label} hooks 미적용 — 기존 ${existingEvents.length}종 보존 (덮어쓰려면 --replace-hooks)`);
    return;
  }

  const { hooks: rewritten, replaced } = rewriteHome(hooks);
  console.log(`  홈 경로 치환 ${replaced}곳 (${sourceHome} → ${HOME})`);
  if (DRY_RUN) {
    console.log(`  [dry-run] ${targetPath} 의 hooks 를 ${hookEvents.length}종으로 교체 (기존은 백업)`);
    return;
  }

  const hadFile = fs.existsSync(targetPath);
  if (hadFile) {
    fs.copyFileSync(targetPath, `${targetPath}.bak-${stamp}`);
  }
  current.hooks = rewritten;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(
    `  ✓ hooks ${hookEvents.length}종 적용${hadFile ? ` (기존 파일은 .bak-${stamp} 로 백업)` : ' (기존 파일 없음 — 새로 만듦)'}`,
  );
}

// ---------------------------------------------------------------- Claude Code

function restoreClaude(claude) {
  if (!claude) {
    return;
  }
  console.log('\n=== Claude Code ===');
  if (!hasCommand('claude')) {
    console.log('  claude CLI 가 없다 — 플러그인·MCP 등록을 건너뛰고 자산만 복사한다.');
    warnings.push('claude CLI 없음 — 플러그인·MCP 미등록');
  } else {
    console.log(`\n[마켓플레이스] ${Object.keys(claude.marketplaces || {}).length}곳`);
    for (const [name, source] of Object.entries(claude.marketplaces || {})) {
      const target = marketplaceTarget(source);
      if (!target) {
        warnings.push(`마켓플레이스 ${name} — 출처를 해석할 수 없음`);
        continue;
      }
      run('claude', ['plugin', 'marketplace', 'add', target]);
    }

    console.log(`\n[플러그인] ${(claude.enabledPlugins || []).length}개`);
    for (const pluginId of claude.enabledPlugins || []) {
      run('claude', ['plugin', 'install', pluginId]);
    }

    console.log(`\n[MCP] ${Object.keys(claude.mcpServers || {}).length}개`);
    for (const [name, definition] of Object.entries(claude.mcpServers || {})) {
      const copy = JSON.parse(JSON.stringify(definition));
      let skip = false;
      for (const field of ['env', 'headers']) {
        if (!copy[field]) {
          continue;
        }
        const filled = fillSecrets(copy[field], `MCP ${name}`);
        if (!filled) {
          skip = true;
          break;
        }
        copy[field] = filled;
      }
      if (skip) {
        console.log(`  - ${name} 건너뜀 (환경 변수 미설정)`);
        continue;
      }
      const mcpArgs = ['mcp', 'add-json', '--scope', 'user', name];
      run('claude', [...mcpArgs, JSON.stringify(copy)], [...mcpArgs, JSON.stringify(definition)]);
    }
  }

  for (const [directory, entries] of Object.entries(claude.assets || {})) {
    if (directory === 'files') {
      // 전역 CLAUDE.md — 이 PC 에서 수기로 더한 규칙이 있을 수 있어 기본은 덮지 않는다.
      copyAsset(path.join(EXPORT_DIR, 'claude'), CLAUDE_DIR, entries, 'claude/파일', !REPLACE_GLOBAL_DOCS);
      continue;
    }
    copyAsset(
      path.join(EXPORT_DIR, 'claude', directory),
      path.join(CLAUDE_DIR, directory),
      entries,
      `claude/${directory}`,
    );
  }

  applyHooks('Claude', claude.hooks, CLAUDE_SETTINGS);
}

// ---------------------------------------------------------------------- Codex

/** `codex mcp add <name> [--env K=V]... (--url <url> | -- <command> <args...>)` 인자를 만든다. */
function codexMcpArgs(name, definition) {
  const mcpArgs = ['mcp', 'add', name];
  for (const [key, value] of Object.entries(definition.env || {})) {
    mcpArgs.push('--env', `${key}=${value}`);
  }
  // 값이 아니라 변수 이름이라 그대로 넘긴다. 빠뜨리면 인증 없이 등록돼 연결에 실패한다.
  if (definition.bearerTokenEnvVar) {
    mcpArgs.push('--bearer-token-env-var', definition.bearerTokenEnvVar);
  }
  if (definition.url) {
    mcpArgs.push('--url', definition.url);
    return mcpArgs;
  }
  mcpArgs.push('--', definition.command, ...(definition.args || []));
  return mcpArgs;
}

function restoreCodex(codex) {
  if (!codex) {
    return;
  }
  console.log('\n=== Codex ===');
  if (!hasCommand('codex')) {
    console.log('  codex CLI 가 없다 — 플러그인·MCP 등록을 건너뛰고 자산만 복사한다.');
    warnings.push('codex CLI 없음 — 플러그인·MCP 미등록');
  } else {
    console.log(`\n[마켓플레이스] ${Object.keys(codex.marketplaces || {}).length}곳`);
    for (const source of Object.values(codex.marketplaces || {})) {
      run('codex', ['plugin', 'marketplace', 'add', source]);
    }

    console.log(`\n[플러그인] ${(codex.plugins || []).length}개`);
    for (const pluginId of codex.plugins || []) {
      run('codex', ['plugin', 'add', pluginId]);
    }

    const servers = Object.entries(codex.mcpServers || {});
    console.log(`\n[MCP] ${servers.length}개`);
    for (const [name, definition] of servers) {
      if (definition.enabled === false) {
        console.log(`  - ${name} 건너뜀 (원본에서 비활성)`);
        continue;
      }
      if (!definition.url && !definition.command) {
        console.log(`  - ${name} 건너뜀 (url 도 실행 명령도 없음)`);
        warnings.push(`MCP ${name} — url·command 가 비어 등록할 수 없음`);
        continue;
      }
      // `codex mcp add` 에는 헤더 옵션이 없다 — 등록은 하되 헤더가 빠진다는 사실을 알린다.
      if (definition.headers || definition.envHttpHeaders) {
        warnings.push(`MCP ${name} — HTTP 헤더 설정은 복원되지 않는다. config.toml 에서 직접 추가할 것`);
      }
      const filled = fillSecrets(definition.env, `MCP ${name}`);
      if (!filled) {
        console.log(`  - ${name} 건너뜀 (환경 변수 미설정)`);
        continue;
      }
      run(
        'codex',
        codexMcpArgs(name, { ...definition, env: filled }),
        codexMcpArgs(name, definition),
      );
    }
  }

  for (const [directory, entries] of Object.entries(codex.assets || {})) {
    if (directory === 'files') {
      // 전역 AGENTS.md — CLAUDE.md 와 같은 위험(그 머신 수기분 유실)이라 같은 보호를 준다.
      copyAsset(path.join(EXPORT_DIR, 'codex'), CODEX_DIR, entries, 'codex/파일', !REPLACE_GLOBAL_DOCS);
      continue;
    }
    copyAsset(
      path.join(EXPORT_DIR, 'codex', directory),
      path.join(CODEX_DIR, directory),
      entries,
      `codex/${directory}`,
    );
  }

  applyHooks('Codex', codex.hooks, CODEX_HOOKS);
}

// ----------------------------------------------------------------------- 실행

function main() {
  const manifestPath = path.join(EXPORT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`manifest.json 을 찾을 수 없다: ${manifestPath}`);
    console.error('export-ai-cli-env.cjs 가 만든 디렉터리 경로를 인자로 넘길 것.');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  sourceHome = manifest.sourceHome;

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}복원 대상: ${EXPORT_DIR}`);
  console.log(`  내보낸 PC 의 홈: ${sourceHome} → 이 PC: ${HOME}`);

  restoreClaude(manifest.claude);
  restoreCodex(manifest.codex);

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

main();
