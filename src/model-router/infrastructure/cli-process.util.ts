// CLI provider 가 자식 프로세스로 실행될 때 상속할 환경변수 allowlist.
// `.env` 의 SLACK_BOT_TOKEN / DATABASE_URL 등을 자식에게 넘기지 않아 prompt-injection 으로부터 시크릿을 격리한다.
//
// 격리 전략:
// 1. `HOME` / `PWD` 는 allowlist 에 포함하지 않고, 호출자가 `homeDir` / `cwd` 를 명시해 **throwaway 임시 경로로 고정** 한다.
//    → prompt-injected agent 가 `cat ~/.ssh/id_rsa` 같은 공격을 해도 빈 임시 디렉토리만 본다.
// 2. 단, CLI 자체의 auth 는 `CODEX_HOME` / `CLAUDE_CONFIG_DIR` 로 **실제 경로를 명시 전달** 해 구독 인증을 유지한다.
//    envVar 가 이미 있으면 그대로, 없으면 real HOME 기반으로 기본 경로 주입.
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

  // CLI 인증 보존: parent 의 CODEX_HOME / CLAUDE_CONFIG_DIR 을 실제 경로로 명시 전달한다.
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
