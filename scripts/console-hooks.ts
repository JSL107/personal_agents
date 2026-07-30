/* 이대리 콘솔 inject Stop 훅 설치/제거. 사용:
 *   pnpm console:install-hooks
 *   pnpm console:uninstall-hooks
 * claude(~/.claude/settings.json) + codex(~/.codex/hooks.json)에 동기 Stop 훅을 추가/제거한다.
 * 훅 커맨드는 컴파일된 entry 절대경로를 가리킨다(pnpm build 선행 필요). idempotent.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { HookFsDeps } from '../src/local-sessions/domain/inject-hook-install';
import {
  installInjectHooks,
  uninstallInjectHooks,
} from '../src/local-sessions/domain/inject-hook-install';

const fsDeps: HookFsDeps = {
  readJson: (path) => {
    if (!existsSync(path)) {
      return {};
    }
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      throw new Error(
        `설정 파일이 유효한 JSON 이 아닙니다: ${path} — 덮어쓰기 방지를 위해 중단합니다. 파일을 고친 뒤 다시 실행하세요.`,
      );
    }
  },
  writeJson: (path, data) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  },
};

const repoRoot = join(__dirname, '..');
const entry = join(
  repoRoot,
  'dist',
  'src',
  'local-sessions',
  'infrastructure',
  'inject-hook.entry.js',
);
const claudeSettingsPath = join(homedir(), '.claude', 'settings.json');
const codexHooksPath = join(homedir(), '.codex', 'hooks.json');
const stopHookCommand = `"${process.execPath}" "${entry}"`;

const mode = process.argv[2];
if (mode === 'install') {
  if (!existsSync(entry)) {
    console.error(`entry 없음: ${entry} — 먼저 pnpm build 를 실행하세요.`);
    process.exit(1);
  }
  try {
    const result = installInjectHooks(
      { claudeSettingsPath, codexHooksPath, stopHookCommand },
      fsDeps,
    );
    console.log(
      result.changed.length > 0
        ? `설치됨: ${result.changed.join(', ')}`
        : '이미 설치됨(변경 없음).',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
} else if (mode === 'uninstall') {
  try {
    const result = uninstallInjectHooks(
      { claudeSettingsPath, codexHooksPath },
      fsDeps,
    );
    console.log(
      result.changed.length > 0
        ? `제거됨: ${result.changed.join(', ')}`
        : '설치된 이대리 훅 없음(변경 없음).',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
} else {
  console.error('usage: ts-node scripts/console-hooks.ts <install|uninstall>');
  process.exit(1);
}
