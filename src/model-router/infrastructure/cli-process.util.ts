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
  // macOS Keychain access + 일부 POSIX 도구가 LOGNAME 으로 user 식별 — USER 와 함께 forward 필수.
  // Claude CLI 가 keychain 접근 시 user 식별 실패하면 침묵 exit=1 (no stderr).
  'LOGNAME',
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
  additionalEnv,
}: {
  cwd?: string;
  homeDir?: string;
  // 호출 provider 가 추가로 forward 할 env (예: ClaudeCliProvider 의 ANTHROPIC_API_KEY).
  // SAFE_ENV_KEYS 를 거치지 않으므로 provider-specific 시크릿을 다른 CLI 에 노출하지 않는다.
  // 같은 key 가 SAFE_ENV_KEYS 에도 있으면 마지막에 덮어쓰므로 호출자 값이 우선.
  additionalEnv?: NodeJS.ProcessEnv;
} = {}): NodeJS.ProcessEnv => {
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

  if (additionalEnv) {
    for (const [key, value] of Object.entries(additionalEnv)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
  }

  return env;
};

// throwaway HOME 메커니즘이 안 되는 CLI 가 사용자 실제 HOME 을 직접 로드해야 할 때를 위해 유지.
// process.env.HOME 직접 참조를 이 파일로 격리. (이전 Gemini provider 가 사용했음 — 2026-06-04 제거)
export const getRealHomeDir = (): string => process.env.HOME ?? homedir();

// LLM CLI 자식 프로세스 + 그 자식들(grandchild)까지 프로세스 그룹 단위로 강제 종료한다.
//
// 배경: `child.kill('SIGKILL')` 은 직접 자식(codex/claude CLI)만 죽인다. 그런데 codex 는
// app-server broker, claude 는 MCP 서버(notion/figma/serena 등) 류의 grandchild 를 띄우는데,
// 이들이 살아남아 stdio 를 물고 있으면 자식의 `'close'` 이벤트가 오지 않아 provider 의
// spawn Promise 가 영구 hang 한다 — 단일 LLM 호출이 timeout(180s)·worker lockDuration(7.5m)을
// 넘겨 16분 넘게 지속되는 관측의 유력 원인. (정확한 메커니즘은 런타임 계측으로 추가 확인 필요.)
//
// 해결: provider 가 자식을 `detached: true` 로 spawn 해 프로세스 그룹 리더로 만들고, 음수 pid 로
// 그룹 전체에 SIGKILL 을 보내 grandchild 까지 한 번에 정리한다. 그룹 kill 이 실패(그룹 없음/이미
// 종료)하면 단일 pid 로 fallback 하고, 그것도 실패하면(이미 종료) 조용히 무시한다.
// detached child 는 음수 pid kill 의 전제 — detached 없이 -pid 를 쓰면 부모 그룹(봇 자신)까지 죽을 수 있다.
export const killProcessTree = (pid: number | undefined): void => {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 이미 종료된 프로세스 — no-op.
    }
  }
};
