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

// V3 mid-progress audit (codex P1) — sandbox self-correction 루프는 호스트 fs 위험 때문에 MVP 에서 제거.
// validated 는 향후 sandbox 디자인이 강화된 후 다시 채워질 자리. 현재는 항상 false 로 사용자가 직접 검증.
export interface GeneratedTest {
  filePath: string;
  specCode: string;
  validated: false;
}
