import { TriggerType } from '../../../agent-run/domain/agent-run.type';

export interface AnalyzeStackTraceInput {
  stackTrace: string;
  slackUserId: string;
  triggerType?: TriggerType;
}

export interface StackFrame {
  // 'at FooService.doWork (/repo/src/foo/foo.service.ts:42:15)' 같은 line 에서 추출.
  function?: string;
  filePath?: string;
  line?: number;
  column?: number;
  rawLine: string;
}

export interface SreAnalysis {
  stackTrace: string;
  // 파싱된 frame 들. ts/js 파일만 + node_modules 제외.
  frames: StackFrame[];
  // Code Graph query 결과 — 영향 받는 파일 list (frames 의 filePath 의 caller 들 + 본인).
  affectedFiles: string[];
  // LLM 분석 결과.
  rootCauseHypothesis: string;
  patchProposal: string; // markdown, 코드 fence 포함 가능
  reasoning: string;
  parseError?: boolean;
}
