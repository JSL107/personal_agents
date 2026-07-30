// 이대리 자체 동기 Stop 훅을 claude/codex 설정에 설치/제거한다(순수 — json 읽기/쓰기는 주입).
// 마커는 stopHookCommand 에 반드시 포함되는 substring(entry 파일명). mds install.ts 이식본.

export const INJECT_HOOK_MARKER = 'inject-hook.entry';

export interface HookFsDeps {
  readonly readJson: (path: string) => Record<string, unknown>;
  readonly writeJson: (path: string, data: unknown) => void;
}

export interface HookInstallOptions {
  readonly claudeSettingsPath: string;
  readonly codexHooksPath: string;
  readonly stopHookCommand: string;
}

interface HookLeaf {
  readonly type: string;
  readonly command: string;
  readonly async?: boolean;
}

interface HookEntry {
  matcher?: string;
  hooks?: HookLeaf[];
}

function hasMarker(entries: HookEntry[], marker: string): boolean {
  return entries.some((entry) =>
    (entry.hooks ?? []).some(
      (leaf) =>
        typeof leaf.command === 'string' && leaf.command.includes(marker),
    ),
  );
}

function appendStopHook(
  path: string,
  entry: HookEntry,
  marker: string,
  deps: HookFsDeps,
): boolean {
  const data = deps.readJson(path);
  const hooks = (data.hooks as Record<string, HookEntry[]>) ?? {};
  const stop = hooks.Stop ?? [];
  if (hasMarker(stop, marker)) {
    return false;
  }
  stop.push(entry);
  hooks.Stop = stop;
  data.hooks = hooks;
  deps.writeJson(path, data);
  return true;
}

function removeStopHook(
  path: string,
  marker: string,
  deps: HookFsDeps,
): boolean {
  const data = deps.readJson(path);
  const hooks = (data.hooks as Record<string, HookEntry[]>) ?? {};
  const stop = hooks.Stop;
  if (!Array.isArray(stop)) {
    return false;
  }
  const kept = stop.filter(
    (entry) =>
      !(entry.hooks ?? []).some(
        (leaf) =>
          typeof leaf.command === 'string' && leaf.command.includes(marker),
      ),
  );
  if (kept.length === stop.length) {
    return false;
  }
  hooks.Stop = kept;
  data.hooks = hooks;
  deps.writeJson(path, data);
  return true;
}

export function installInjectHooks(
  options: HookInstallOptions,
  deps: HookFsDeps,
): { changed: string[] } {
  const changed = new Set<string>();
  const leaf: HookLeaf = { type: 'command', command: options.stopHookCommand };
  // claude 는 matcher 필드를 쓰고, codex 는 안 쓴다(mds 관측). 동기(async 미지정) — stdout 을 읽어야 함.
  if (
    appendStopHook(
      options.claudeSettingsPath,
      { matcher: '', hooks: [leaf] },
      INJECT_HOOK_MARKER,
      deps,
    )
  ) {
    changed.add(options.claudeSettingsPath);
  }
  if (
    appendStopHook(
      options.codexHooksPath,
      { hooks: [leaf] },
      INJECT_HOOK_MARKER,
      deps,
    )
  ) {
    changed.add(options.codexHooksPath);
  }
  return { changed: [...changed] };
}

export function uninstallInjectHooks(
  options: Omit<HookInstallOptions, 'stopHookCommand'>,
  deps: HookFsDeps,
): { changed: string[] } {
  const changed = new Set<string>();
  if (removeStopHook(options.claudeSettingsPath, INJECT_HOOK_MARKER, deps)) {
    changed.add(options.claudeSettingsPath);
  }
  if (removeStopHook(options.codexHooksPath, INJECT_HOOK_MARKER, deps)) {
    changed.add(options.codexHooksPath);
  }
  return { changed: [...changed] };
}
