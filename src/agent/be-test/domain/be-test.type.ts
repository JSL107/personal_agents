import { TriggerType } from '../../../agent-run/domain/agent-run.type';

export interface GenerateTestInput {
  filePath: string;
  slackUserId: string;
  triggerType?: TriggerType;
}

export interface BranchPath {
  kind: 'if' | 'else' | 'switch-case' | 'ternary' | 'try-catch';
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
