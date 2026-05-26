import { TriggerType } from '../../../agent-run/domain/agent-run.type';

export interface GenerateTestInput {
  filePath: string;
  slackUserId: string;
  triggerType?: TriggerType;
}

// codex P3 — `else if` 는 else 와 if 를 별개로 셀 때 이중 카운트되므로 'else-if' kind 로 합친다.
// short-circuit 분기 (`a && b`, `a || b`, `a ?? b`) 는 'logical' kind 로 별도 카운트한다.
export interface BranchPath {
  kind:
    | 'if'
    | 'else'
    | 'else-if'
    | 'switch-case'
    | 'ternary'
    | 'try-catch'
    | 'logical';
  startLine: number;
  endLine: number;
  condition: string;
}

export interface PortDependency {
  paramName: string;
  typeName: string;
  isInjectToken: boolean;
  injectToken?: string;
}

export interface FunctionAnalysis {
  name: string;
  startLine: number;
  endLine: number;
  branches: BranchPath[];
  parameters: { name: string; type: string }[];
  isAsync: boolean;
}

export interface FileAnalysis {
  filePath: string;
  className?: string;
  ports: PortDependency[];
  functions: FunctionAnalysis[];
  cyclomaticComplexity: number;
  rawSource: string;
}

// V3 §8 self-correction revival (2026-05-05 plan) — sandbox tmpfs 주입이 끝나
// 호스트 fs 변조 위험 없이 spec 검증 + retry 루프 재도입.
// attempts: 실제 sandbox 호출 횟수 (1 이면 LLM 1차 spec 이 곧바로 통과).
// stderrTail: validated=false 일 때 마지막 sandbox stderr 의 끝 1KB — formatter 가 사용자에게 노출.
// nonRetryableReason: stderr 가 assertion fail 등 LLM 재생성으로 회복 불가 패턴일 때 조기 stop 사유.
export interface GeneratedTest {
  filePath: string;
  specCode: string;
  validated: boolean;
  selfCorrectionAttempts: number;
  selfCorrectionStderrTail?: string;
  selfCorrectionStopReason?:
    | 'PASSED'
    | 'MAX_ATTEMPTS_EXHAUSTED'
    | 'NON_RETRYABLE'
    | 'SANDBOX_UNAVAILABLE';
}
