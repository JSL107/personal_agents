import { TriggerType } from '../../../agent-run/domain/agent-run.type';

export interface AnalyzePrConventionInput {
  prRef: string; // 'owner/repo#123' 또는 '#123' 또는 '123'
  slackUserId: string;
  triggerType?: TriggerType;
}

export interface ConventionViolation {
  filePath: string;
  line?: number;
  category:
    | 'magic-number'
    | 'naming'
    | 'missing-braces'
    | 'unused-import'
    | 'other';
  message: string;
  suggestedFix: string; // markdown / code fence
}

export interface PrConventionReport {
  prRef: string;
  prTitle: string;
  baseSha: string;
  headSha: string;
  diffByteLength: number;
  diffTruncated: boolean;
  violations: ConventionViolation[];
  summary: string; // 짧은 한국어 요약
  parseError?: boolean;
}
