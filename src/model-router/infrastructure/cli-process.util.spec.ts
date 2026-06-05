import { buildSafeChildEnv } from './cli-process.util';

describe('buildSafeChildEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('PATH / USER 등 allowlist 키를 보존한다', () => {
    process.env.PATH = '/usr/local/bin:/usr/bin';
    process.env.USER = 'tester';

    const env = buildSafeChildEnv();

    expect(env.PATH).toBe('/usr/local/bin:/usr/bin');
    expect(env.USER).toBe('tester');
  });

  it('SLACK_BOT_TOKEN / DATABASE_URL 등 시크릿은 자식 env 에 전파되지 않는다', () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-very-secret';
    process.env.DATABASE_URL = 'postgresql://u:p@h/db';
    process.env.REDIS_PORT = '6381';

    const env = buildSafeChildEnv();

    expect(env.SLACK_BOT_TOKEN).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.REDIS_PORT).toBeUndefined();
  });

  it('parent 의 HOME 은 기본적으로 상속하지 않는다 (prompt-injected agent 가 ~/.ssh 접근 차단)', () => {
    process.env.HOME = '/Users/me';

    const env = buildSafeChildEnv();

    expect(env.HOME).toBeUndefined();
  });

  it('parent 의 PWD 는 상속하지 않는다 (repo 경로 유출 방지)', () => {
    process.env.PWD = '/Users/me/secret-repo';

    const env = buildSafeChildEnv();

    expect(env.PWD).toBeUndefined();
  });

  it('cwd 인자를 주면 PWD 를 해당 값으로 고정한다', () => {
    const env = buildSafeChildEnv({ cwd: '/tmp/idaeri-sandbox' });
    expect(env.PWD).toBe('/tmp/idaeri-sandbox');
  });

  it('homeDir 인자를 주면 HOME 을 throwaway 경로로 고정한다', () => {
    process.env.HOME = '/Users/me';

    const env = buildSafeChildEnv({ homeDir: '/tmp/idaeri-home-xxxxx' });

    expect(env.HOME).toBe('/tmp/idaeri-home-xxxxx');
  });

  it('CODEX_HOME 이 있으면 그대로, 없으면 real HOME 기반 기본 경로로 주입한다 (CLI 인증 보존)', () => {
    process.env.HOME = '/Users/me';
    delete process.env.CODEX_HOME;

    const env = buildSafeChildEnv();

    expect(env.CODEX_HOME).toBe('/Users/me/.codex');
  });

  it('CLAUDE_CONFIG_DIR 이 없으면 real HOME 기반 기본 경로로 주입한다', () => {
    process.env.HOME = '/Users/me';
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_HOME;

    const env = buildSafeChildEnv();

    expect(env.CLAUDE_CONFIG_DIR).toBe('/Users/me/.claude');
  });

  it('CLAUDE_HOME 은 fallback 으로만 쓰고 CLAUDE_CONFIG_DIR 이 우선한다', () => {
    process.env.HOME = '/Users/me';
    process.env.CLAUDE_CONFIG_DIR = '/custom/claude-config';
    process.env.CLAUDE_HOME = '/custom/claude-home';

    const env = buildSafeChildEnv();

    expect(env.CLAUDE_CONFIG_DIR).toBe('/custom/claude-config');
  });

  it('throwaway HOME 을 넘겨도 CODEX_HOME 은 여전히 real HOME 기반 (인증 유지)', () => {
    process.env.HOME = '/Users/me';
    delete process.env.CODEX_HOME;

    const env = buildSafeChildEnv({ homeDir: '/tmp/throwaway' });

    expect(env.HOME).toBe('/tmp/throwaway');
    expect(env.CODEX_HOME).toBe('/Users/me/.codex');
  });

  it('additionalEnv 를 넘기면 자식 env 에 추가 forward 된다 (provider-specific 시크릿 경로)', () => {
    const env = buildSafeChildEnv({
      additionalEnv: { ANTHROPIC_API_KEY: 'sk-test', CLAUDE_CODE_SIMPLE: '1' },
    });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(env.CLAUDE_CODE_SIMPLE).toBe('1');
  });

  it('additionalEnv 의 값은 SAFE_ENV_KEYS / 기본 주입을 덮어쓴다 (호출자 의도 우선)', () => {
    process.env.PATH = '/parent/bin';
    process.env.HOME = '/Users/me';

    const env = buildSafeChildEnv({
      homeDir: '/tmp/throwaway',
      additionalEnv: { PATH: '/override/bin', CLAUDE_CONFIG_DIR: '/custom' },
    });

    expect(env.PATH).toBe('/override/bin');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/custom');
  });

  it('additionalEnv 의 undefined 값은 skip (실수로 secret 을 빈 값으로 덮어쓰지 않음)', () => {
    process.env.PATH = '/parent/bin';

    const env = buildSafeChildEnv({
      additionalEnv: { PATH: undefined, NEW_KEY: 'value' },
    });

    expect(env.PATH).toBe('/parent/bin');
    expect(env.NEW_KEY).toBe('value');
  });

  it('additionalEnv 가 없으면 시크릿 키 (ANTHROPIC_API_KEY 등) 가 자식 env 에 절대 들어가지 않는다', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-parent-secret';

    const env = buildSafeChildEnv();

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
