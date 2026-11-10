export type AiWeeklySourceStatus = 'ok' | 'missing' | 'error';
export type AiWeeklyScope = 'company' | 'personal' | 'unknown';

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

export interface AiWeeklyInventoryItems {
  total: number;
  added: number;
  unused: string[];
}

export interface AiWeeklyMetrics {
  version: 1;
  period: { since: string; until: string; prevSince: string };
  scope_rule: string;
  sources: Record<
    'claude' | 'codex' | 'git' | 'inventory' | 'hooks',
    AiWeeklySourceStatus
  >;
  scopes: Record<AiWeeklyScope, AiWeeklyScopeMetrics>;
  inferredSessions: number;
  tokens: {
    claude: {
      thisWeek: Record<string, number>;
      prevWeek: Record<string, number>;
    };
    codex: { thisWeek: number; prevWeek: number; zstSkipped: number };
  };
  reverts: number;
  verify: AiWeeklyCounts;
  clarify: AiWeeklyClarify;
  inventory: {
    skills: AiWeeklyInventoryItems;
    plugins: AiWeeklyInventoryItems;
    agents: AiWeeklyInventoryItems;
    hooks: { total: number };
  };
  hooks: {
    hooks: Array<{
      name: string;
      fired: number;
      delivered: number;
      blocked: number;
    }>;
  };
  corrupt: number;
}

export interface ParsedAiWeeklyMetrics {
  metrics: AiWeeklyMetrics;
  droppedNameCount: number;
}
