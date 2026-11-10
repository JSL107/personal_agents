import { AiWeeklyError } from './ai-weekly-error';
import {
  AiWeeklyClarify,
  AiWeeklyCounts,
  AiWeeklyInventoryItems,
  AiWeeklyMetrics,
  AiWeeklyScopeMetrics,
  AiWeeklySourceStatus,
  ParsedAiWeeklyMetrics,
} from './ai-weekly-metrics.type';

const NAME = /^[A-Za-z0-9:_.-]{1,80}$/;
const MODEL = new RegExp(String.raw`^[A-Za-z0-9:_.\[\]-]{1,80}$`);
const SCOPES = ['company', 'personal', 'unknown'] as const;
const SOURCES = ['claude', 'codex', 'git', 'inventory', 'hooks'] as const;

export const parseAiWeeklyMetrics = (raw: unknown): ParsedAiWeeklyMetrics => {
  const root = record(raw);
  if (root.version !== 1) {
    invalid();
  }
  const periodRaw = record(root.period);
  const period = {
    since: string(periodRaw.since),
    until: string(periodRaw.until),
    prevSince: string(periodRaw.prevSince),
  };
  const sourcesRaw = record(root.sources);
  const sources = {} as AiWeeklyMetrics['sources'];
  for (const source of SOURCES) {
    sources[source] = sourceStatus(sourcesRaw[source]);
  }
  const scopesRaw = record(root.scopes);
  const scopes = {} as AiWeeklyMetrics['scopes'];
  const dropped = { count: 0 };
  for (const scope of SCOPES) {
    scopes[scope] = scopeMetrics(scopesRaw[scope]);
  }
  const tokensRaw = record(root.tokens);
  const claudeRaw = record(tokensRaw.claude);
  const codexRaw = record(tokensRaw.codex);
  const inventoryRaw = record(root.inventory);
  const hooksRaw = record(root.hooks);
  if (!Array.isArray(hooksRaw.hooks)) {
    invalid();
  }
  const hooks = (hooksRaw.hooks as unknown[]).flatMap((item: unknown) => {
    const hook = record(item);
    const name = string(hook.name);
    const fired = count(hook.fired);
    const delivered = count(hook.delivered);
    const blocked = count(hook.blocked);
    if (!NAME.test(name)) {
      dropped.count += 1;
      return [];
    }
    return [{ name, fired, delivered, blocked }];
  });
  const metrics: AiWeeklyMetrics = {
    version: 1,
    period,
    scope_rule: string(root.scope_rule),
    sources,
    scopes,
    inferredSessions: count(root.inferredSessions),
    tokens: {
      claude: {
        thisWeek: models(claudeRaw.thisWeek),
        prevWeek: models(claudeRaw.prevWeek),
      },
      codex: {
        thisWeek: count(codexRaw.thisWeek),
        prevWeek: count(codexRaw.prevWeek),
        zstSkipped: count(codexRaw.zstSkipped),
      },
    },
    reverts: count(root.reverts),
    verify: counts(root.verify),
    clarify: clarify(root.clarify),
    inventory: {
      skills: inventoryItems(inventoryRaw.skills, dropped),
      plugins: inventoryItems(inventoryRaw.plugins, dropped),
      agents: inventoryItems(inventoryRaw.agents, dropped),
      hooks: { total: count(record(inventoryRaw.hooks).total) },
    },
    hooks: { hooks },
    corrupt: count(root.corrupt),
  };
  return { metrics, droppedNameCount: dropped.count };
};

const invalid = (): never => {
  throw new AiWeeklyError({ code: 'SHAPE', exitCode: null });
};

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid();
  }
  return value as Record<string, unknown>;
};

const string = (value: unknown): string => {
  if (typeof value !== 'string') {
    return invalid();
  }
  return value;
};

const count = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return invalid();
  }
  return value;
};

const sourceStatus = (value: unknown): AiWeeklySourceStatus => {
  if (value !== 'ok' && value !== 'missing' && value !== 'error') {
    return invalid();
  }
  return value;
};

const models = (value: unknown): Record<string, number> => {
  const values = record(value);
  const result: Record<string, number> = {};
  for (const [name, rawCount] of Object.entries(values)) {
    const tokenCount = count(rawCount);
    const safeName = MODEL.test(name) ? name : 'other';
    result[safeName] = (result[safeName] ?? 0) + tokenCount;
  }
  return result;
};

const counts = (value: unknown): AiWeeklyCounts => {
  const raw = record(value);
  return { total: count(raw.total), piped: count(raw.piped) };
};

const clarify = (value: unknown): AiWeeklyClarify => {
  const raw = record(value);
  return { humanTurns: count(raw.humanTurns), matched: count(raw.matched) };
};

const scopeMetrics = (value: unknown): AiWeeklyScopeMetrics => {
  const raw = record(value);
  return {
    tokens: models(raw.tokens),
    reverts: count(raw.reverts),
    verify: counts(raw.verify),
    clarify: clarify(raw.clarify),
  };
};

const inventoryItems = (
  value: unknown,
  dropped: { count: number },
): AiWeeklyInventoryItems => {
  const raw = record(value);
  if (!Array.isArray(raw.unused)) {
    invalid();
  }
  const unused = (raw.unused as unknown[]).filter(
    (name: unknown): name is string => {
      if (typeof name === 'string' && NAME.test(name)) {
        return true;
      }
      dropped.count += 1;
      return false;
    },
  );
  return { total: count(raw.total), added: count(raw.added), unused };
};
