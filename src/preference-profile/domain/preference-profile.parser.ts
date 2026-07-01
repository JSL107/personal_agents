import {
  EMPTY_PROFILE,
  ListDiff,
  PreferenceDiff,
  PreferenceProfile,
  RoutingHint,
  Verbosity,
  VerbosityPrefs,
} from './preference-profile.type';

const VERBOSITY_VALUES: Verbosity[] = ['terse', 'balanced', 'detailed'];

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
};

const asVerbosity = (value: unknown): Verbosity | undefined => {
  return VERBOSITY_VALUES.includes(value as Verbosity)
    ? (value as Verbosity)
    : undefined;
};

const asVerbosityPrefs = (value: unknown): VerbosityPrefs => {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const result: VerbosityPrefs = {};
  for (const key of ['briefing', 'plan', 'humanize'] as const) {
    const parsed = asVerbosity(record[key]);
    if (parsed) {
      result[key] = parsed;
    }
  }
  return result;
};

const asRoutingHints = (value: unknown): RoutingHint[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const hints: RoutingHint[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.phrase === 'string' &&
      typeof record.intent === 'string'
    ) {
      hints.push({ phrase: record.phrase, intent: record.intent });
    }
  }
  return hints;
};

export const parseProfile = (json: unknown): PreferenceProfile => {
  if (typeof json !== 'object' || json === null) {
    return { ...EMPTY_PROFILE };
  }
  const record = json as Record<string, unknown>;
  return {
    tone: asStringArray(record.tone),
    verbosity: asVerbosityPrefs(record.verbosity),
    priorities: asStringArray(record.priorities),
    doNot: asStringArray(record.doNot),
    routingHints: asRoutingHints(record.routingHints),
  };
};

const applyListDiff = (base: string[], diff?: ListDiff): string[] => {
  if (!diff) {
    return base;
  }
  const removed = new Set(diff.remove ?? []);
  const kept = base.filter((item) => !removed.has(item));
  const result = [...kept];
  for (const item of diff.add ?? []) {
    if (!result.includes(item)) {
      result.push(item);
    }
  }
  return result;
};

export const applyDiff = (
  base: PreferenceProfile,
  diff: PreferenceDiff,
): PreferenceProfile => {
  const routingRemove = new Set(diff.routingHints?.remove ?? []);
  const keptHints = base.routingHints.filter(
    (hint) => !routingRemove.has(hint.phrase),
  );
  const addedHints = diff.routingHints?.add ?? [];
  return {
    tone: applyListDiff(base.tone, diff.tone),
    verbosity: { ...base.verbosity, ...(diff.verbosity ?? {}) },
    priorities: applyListDiff(base.priorities, diff.priorities),
    doNot: applyListDiff(base.doNot, diff.doNot),
    routingHints: [...keptHints, ...addedHints],
  };
};
