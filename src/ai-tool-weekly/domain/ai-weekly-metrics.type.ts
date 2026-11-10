// 집계 스크립트(scripts/ai-weekly-metrics.py) 출력 version 1 의 형태. 값은 JSON 문자열과 같다.
export enum AiWeeklySourceStatus {
  OK = 'ok',
  MISSING = 'missing',
  ERROR = 'error',
}

export enum AiWeeklyScope {
  COMPANY = 'company',
  PERSONAL = 'personal',
  UNKNOWN = 'unknown',
}

export enum AiWeeklySource {
  CLAUDE = 'claude',
  CODEX = 'codex',
  GIT = 'git',
  INVENTORY = 'inventory',
  HOOKS = 'hooks',
}

export type AiWeeklySources = Record<AiWeeklySource, AiWeeklySourceStatus>;

export interface AiWeeklyCounts {
  total: number;
  piped: number;
}

export interface AiWeeklyClarify {
  humanTurns: number;
  matched: number;
}

export interface AiWeeklyScopeMetrics {
  tokens: Record<string, number>;
  reverts: number;
  verify: AiWeeklyCounts;
  clarify: AiWeeklyClarify;
}

export type AiWeeklyScopes = Record<AiWeeklyScope, AiWeeklyScopeMetrics>;

export interface AiWeeklyPeriodText {
  since: string;
  until: string;
  prevSince: string;
}

export interface AiWeeklyClaudeTokens {
  thisWeek: Record<string, number>;
  prevWeek: Record<string, number>;
}

export interface AiWeeklyCodexTokens {
  thisWeek: number;
  prevWeek: number;
  zstSkipped: number;
}

export interface AiWeeklyTokens {
  claude: AiWeeklyClaudeTokens;
  codex: AiWeeklyCodexTokens;
}

export interface AiWeeklyInventoryItems {
  total: number;
  added: number;
  unused: string[];
}

export interface AiWeeklyHookInventory {
  total: number;
}

export interface AiWeeklyInventory {
  skills: AiWeeklyInventoryItems;
  plugins: AiWeeklyInventoryItems;
  agents: AiWeeklyInventoryItems;
  hooks: AiWeeklyHookInventory;
}

export interface AiWeeklyHookCount {
  name: string;
  fired: number;
  delivered: number;
  blocked: number;
}

export interface AiWeeklyHooks {
  hooks: AiWeeklyHookCount[];
}

export interface AiWeeklyMetrics {
  version: 1;
  period: AiWeeklyPeriodText;
  scope_rule: string;
  sources: AiWeeklySources;
  scopes: AiWeeklyScopes;
  inferredSessions: number;
  tokens: AiWeeklyTokens;
  reverts: number;
  verify: AiWeeklyCounts;
  clarify: AiWeeklyClarify;
  inventory: AiWeeklyInventory;
  hooks: AiWeeklyHooks;
  corrupt: number;
}

export interface ParsedAiWeeklyMetrics {
  metrics: AiWeeklyMetrics;
  droppedNameCount: number;
}
