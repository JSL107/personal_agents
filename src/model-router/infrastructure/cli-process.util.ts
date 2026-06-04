import { homedir } from 'node:os';

// CLI provider 가 자식 프로세스로 실행될 때 상속할 환경변수 allowlist.
// `.env` 의 SLACK_BOT_TOKEN / DATABASE_URL 등을 자식에게 넘기지 않아 prompt-injection 으로부터 시크릿을 격리한다.
//
// 격리 전략:
// 1. `HOME` / `PWD` 는 allowlist 에 포함하지 않고, 호출자가 `homeDir` / `cwd` 를 명시해 **throwaway 임시 경로로 고정** 한다.
//    → prompt-injected agent 가 `cat ~/.ssh/id_rsa` 같은 공격을 해도 빈 임시 디렉토리만 본다.
// 2. 단, CLI 자체의 auth 는 `CODEX_HOME` / `CLAUDE_CONFIG_DIR` 로 **실제 경로를 명시 전달** 해 구독 인증을 유지한다.
//    envVar 가 이미 있으면 그대로, 없으면 real HOME 기반으로 기본 경로 주입.
//
// process.env 직접 참조 정책(AGENTS.md §5 / CODE_RULES §9 — ConfigService 우선) 의 예외 격리 위치:
// 자식 프로세스 환경변수 구성은 NestJS DI 컨텍스트 외부 시스템 호출이라 ConfigService 로 추상화하지 않는다.
// 다른 모듈에서 직접 `process.env.HOME` 을 읽는 대신 `getRealHomeDir()` 헬퍼를 통해 이 파일로 격리한다.
const SAFE_ENV_KEYS = [
  'PATH',
  'USER',
  'LANG',
  'LC_ALL',
  'SHELL',
  'TERM',
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
] as const;

const buildDefaultAuthDir = (subdir: string): string | undefined => {
  const realHome = process.env.HOME;
  if (!realHome) {
    return undefined;
  }
  return `${realHome}/${subdir}`;
};

export const buildSafeChildEnv = ({
  cwd,
  homeDir,
}: { cwd?: string; homeDir?: string } = {}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};

  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  if (homeDir) {
    env.HOME = homeDir;
  }

  if (cwd) {
    env.PWD = cwd;
  }

  // CLI 인증 보존: parent 의 CODEX_HOME / CLAUDE_CONFIG_DIR 를 명시 전달한다.
  // (HOME 을 throwaway 로 바꿨기 때문에 CLI 가 기본 추론하면 인증 파일을 못 찾는다)
  const codexHome = process.env.CODEX_HOME ?? buildDefaultAuthDir('.codex');
  if (codexHome) {
    env.CODEX_HOME = codexHome;
  }

  const claudeConfigDir =
    process.env.CLAUDE_CONFIG_DIR ??
    process.env.CLAUDE_HOME ??
    buildDefaultAuthDir('.claude');
  if (claudeConfigDir) {
    env.CLAUDE_CONFIG_DIR = claudeConfigDir;
  }

  return env;
};

// throwaway HOME 메커니즘이 안 되는 CLI 가 사용자 실제 HOME 을 직접 로드해야 할 때를 위해 유지.
// process.env.HOME 직접 참조를 이 파일로 격리. (이전 Gemini provider 가 사용했음 — 2026-06-04 제거)
export const getRealHomeDir = (): string => process.env.HOME ?? homedir();
