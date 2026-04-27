import { AgentRunOutcome } from '../../agent-run/application/agent-run.service';
import { sanitizeForSlackLink } from './mrkdwn.util';

// 모든 슬래시 명령 응답 끝에 붙는 공통 푸터 — 어떤 모델/run id 로 응답이 만들어졌는지 노출.
// PRO-3: 디버깅·품질 회고용 (어떤 provider 가 어떤 응답을 만들었는지 즉시 추적).
// agentRunId 는 DB 의 agent_run.id 와 1:1 매칭이라 사후 분석/Failure Replay 에 그대로 사용 가능.
// modelUsed 는 외부 CLI stdout 파싱 결과라 Slack mrkdwn 안전하게 sanitize.
export const formatModelFooter = ({
  modelUsed,
  agentRunId,
}: AgentRunOutcome<unknown>): string =>
  `\n\n_model: ${sanitizeForSlackLink(modelUsed)} · run #${agentRunId}_`;
