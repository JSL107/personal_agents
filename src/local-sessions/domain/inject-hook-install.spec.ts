import {
  INJECT_HOOK_MARKER,
  installInjectHooks,
  uninstallInjectHooks,
} from './inject-hook-install';

function memoryJsonFs(seed: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(seed));
  return {
    store,
    deps: {
      readJson: (path: string) =>
        (store.get(path) as Record<string, unknown>) ?? {},
      writeJson: (path: string, data: unknown) => {
        store.set(path, data);
      },
    },
  };
}

const options = {
  claudeSettingsPath: '/claude/settings.json',
  codexHooksPath: '/codex/hooks.json',
  stopHookCommand:
    '"/node" "/repo/dist/src/local-sessions/infrastructure/inject-hook.entry.js"',
};

describe('inject-hook-install', () => {
  it('claude/codex 양쪽에 동기 Stop 훅을 추가하고 변경 경로를 반환', () => {
    const fs = memoryJsonFs();
    const result = installInjectHooks(options, fs.deps);
    expect(result.changed.sort()).toEqual(
      ['/claude/settings.json', '/codex/hooks.json'].sort(),
    );
    const claude = fs.store.get('/claude/settings.json') as any;
    const entry = claude.hooks.Stop[0].hooks[0];
    expect(entry.command).toContain(INJECT_HOOK_MARKER);
    expect(entry.async).toBeUndefined();
  });

  it('마커가 이미 있으면 재설치는 중복을 만들지 않음(idempotent)', () => {
    const fs = memoryJsonFs();
    installInjectHooks(options, fs.deps);
    const second = installInjectHooks(options, fs.deps);
    expect(second.changed).toEqual([]);
    const claude = fs.store.get('/claude/settings.json') as any;
    expect(claude.hooks.Stop).toHaveLength(1);
  });

  it('기존 다른 Stop 훅(예: async 텔레메트리)과 공존 — 기존 항목 보존', () => {
    const fs = memoryJsonFs({
      '/claude/settings.json': {
        hooks: {
          Stop: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'other-tool', async: true }],
            },
          ],
        },
      },
    });
    installInjectHooks(options, fs.deps);
    const claude = fs.store.get('/claude/settings.json') as any;
    expect(claude.hooks.Stop).toHaveLength(2);
    expect(JSON.stringify(claude.hooks.Stop)).toContain('other-tool');
  });

  it('readJson 이 throw 하면 install 은 전파하고 아무것도 쓰지 않는다(malformed 보호)', () => {
    const writes: string[] = [];
    const deps = {
      readJson: () => {
        throw new Error('malformed');
      },
      writeJson: (path: string) => {
        writes.push(path);
      },
    };
    expect(() => installInjectHooks(options, deps)).toThrow('malformed');
    expect(writes).toHaveLength(0);
  });

  it('uninstall 은 이대리 마커 항목만 제거하고 남의 것은 보존', () => {
    const fs = memoryJsonFs({
      '/claude/settings.json': {
        hooks: {
          Stop: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'other-tool', async: true }],
            },
          ],
        },
      },
    });
    installInjectHooks(options, fs.deps);
    uninstallInjectHooks(
      {
        claudeSettingsPath: options.claudeSettingsPath,
        codexHooksPath: options.codexHooksPath,
      },
      fs.deps,
    );
    const claude = fs.store.get('/claude/settings.json') as any;
    expect(claude.hooks.Stop).toHaveLength(1);
    expect(claude.hooks.Stop[0].hooks[0].command).toBe('other-tool');
  });
});
