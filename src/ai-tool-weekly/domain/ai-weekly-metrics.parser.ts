import { AiWeeklyError, AiWeeklyErrorCode } from './ai-weekly-error';
import {
  AiWeeklyClarify,
  AiWeeklyCounts,
  AiWeeklyHookCount,
  AiWeeklyHooks,
  AiWeeklyInventory,
  AiWeeklyInventoryItems,
  AiWeeklyMetrics,
  AiWeeklyPeriodText,
  AiWeeklyScope,
  AiWeeklyScopeMetrics,
  AiWeeklyScopes,
  AiWeeklySource,
  AiWeeklySources,
  AiWeeklySourceStatus,
  AiWeeklyTokens,
  ParsedAiWeeklyMetrics,
} from './ai-weekly-metrics.type';

const NAME = /^[A-Za-z0-9:_.-]{1,80}$/;
const MODEL = new RegExp(String.raw`^[A-Za-z0-9:_.\[\]-]{1,80}$`);

// 이름 검증에서 떨어진 항목 수. 여러 목록을 읽는 동안 함께 센다.
interface DroppedNames {
  count: number;
}

interface NamedListInput {
  value: unknown;
  dropped: DroppedNames;
}

export const parseAiWeeklyMetrics = (raw: unknown): ParsedAiWeeklyMetrics => {
  const root = record(raw);
  if (root.version !== 1) {
    invalid();
  }
  const dropped: DroppedNames = { count: 0 };
  const metrics: AiWeeklyMetrics = {
    version: 1,
    period: periodText(root.period),
    scope_rule: string(root.scope_rule),
    sources: sources(root.sources),
    scopes: scopes(root.scopes),
    inferredSessions: count(root.inferredSessions),
    tokens: tokens(root.tokens),
    reverts: count(root.reverts),
    verify: counts(root.verify),
    clarify: clarify(root.clarify),
    inventory: inventory({ value: root.inventory, dropped }),
    hooks: hooks({ value: root.hooks, dropped }),
    corrupt: count(root.corrupt),
  };
  return { metrics, droppedNameCount: dropped.count };
};

const invalid = (): never => {
  throw new AiWeeklyError({ code: AiWeeklyErrorCode.SHAPE, exitCode: null });
};

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid();
  }
  // typeof 검사는 object 까지만 좁힌다. 필드를 꺼내려면 이 단언이 필요하다.
  return value as Record<string, unknown>;
};

const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) {
    return invalid();
  }
  return value;
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

const periodText = (value: unknown): AiWeeklyPeriodText => {
  const raw = record(value);
  return {
    since: string(raw.since),
    until: string(raw.until),
    prevSince: string(raw.prevSince),
  };
};

const sources = (value: unknown): AiWeeklySources => {
  const raw = record(value);
  return {
    [AiWeeklySource.CLAUDE]: sourceStatus(raw[AiWeeklySource.CLAUDE]),
    [AiWeeklySource.CODEX]: sourceStatus(raw[AiWeeklySource.CODEX]),
    [AiWeeklySource.GIT]: sourceStatus(raw[AiWeeklySource.GIT]),
    [AiWeeklySource.INVENTORY]: sourceStatus(raw[AiWeeklySource.INVENTORY]),
    [AiWeeklySource.HOOKS]: sourceStatus(raw[AiWeeklySource.HOOKS]),
  };
};

const sourceStatus = (value: unknown): AiWeeklySourceStatus => {
  const found = Object.values(AiWeeklySourceStatus).find(
    (status) => status === value,
  );
  if (!found) {
    return invalid();
  }
  return found;
};

const scopes = (value: unknown): AiWeeklyScopes => {
  const raw = record(value);
  return {
    [AiWeeklyScope.COMPANY]: scopeMetrics(raw[AiWeeklyScope.COMPANY]),
    [AiWeeklyScope.PERSONAL]: scopeMetrics(raw[AiWeeklyScope.PERSONAL]),
    [AiWeeklyScope.UNKNOWN]: scopeMetrics(raw[AiWeeklyScope.UNKNOWN]),
  };
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

const tokens = (value: unknown): AiWeeklyTokens => {
  const raw = record(value);
  const claude = record(raw.claude);
  const codex = record(raw.codex);
  return {
    claude: {
      thisWeek: models(claude.thisWeek),
      prevWeek: models(claude.prevWeek),
    },
    codex: {
      thisWeek: count(codex.thisWeek),
      prevWeek: count(codex.prevWeek),
      zstSkipped: count(codex.zstSkipped),
    },
  };
};

// 검증을 통과하지 못한 모델 이름은 버리지 않고 'other' 로 합쳐 토큰 합계를 지킨다.
const models = (value: unknown): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const [name, rawCount] of Object.entries(record(value))) {
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

const inventory = ({ value, dropped }: NamedListInput): AiWeeklyInventory => {
  const raw = record(value);
  return {
    skills: inventoryItems({ value: raw.skills, dropped }),
    plugins: inventoryItems({ value: raw.plugins, dropped }),
    agents: inventoryItems({ value: raw.agents, dropped }),
    hooks: { total: count(record(raw.hooks).total) },
  };
};

const inventoryItems = ({
  value,
  dropped,
}: NamedListInput): AiWeeklyInventoryItems => {
  const raw = record(value);
  const unused: string[] = [];
  for (const name of array(raw.unused)) {
    if (typeof name === 'string' && NAME.test(name)) {
      unused.push(name);
      continue;
    }
    dropped.count += 1;
  }
  return { total: count(raw.total), added: count(raw.added), unused };
};

const hooks = ({ value, dropped }: NamedListInput): AiWeeklyHooks => {
  const found: AiWeeklyHookCount[] = [];
  for (const item of array(record(value).hooks)) {
    const raw = record(item);
    const hook: AiWeeklyHookCount = {
      name: string(raw.name),
      fired: count(raw.fired),
      delivered: count(raw.delivered),
      blocked: count(raw.blocked),
    };
    if (!NAME.test(hook.name)) {
      dropped.count += 1;
      continue;
    }
    found.push(hook);
  }
  return { hooks: found };
};
