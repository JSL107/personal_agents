import { TriggerType } from '../../../agent-run/domain/agent-run.type';

export interface GeneratePoOutlineInput {
  subject: string;
  slackUserId: string;
  // /retry-run 같이 명시 trigger 가 필요할 때 외부에서 주입. 미지정 시 SLACK_COMMAND_PO_EXPAND.
  triggerType?: TriggerType;
}

export interface PoOutline {
  subject: string;
  outline: string[];
  clarifyingQuestions: string[];
  // parser 가 LLM JSON 응답을 파싱 못해 원문을 outline 으로 보존했을 때 true.
  // formatter 가 사용자에게 ⚠️ 힌트를 노출해 silent 통과를 막는다 (V3 mid-progress audit P2).
  parseError?: boolean;
}
