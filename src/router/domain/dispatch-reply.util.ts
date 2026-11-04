import { formatRunIdLine } from '../../common/util/run-id-line.util';
import { DispatchResult } from './idaeri-router.port';

// 이 dispatch 가 원장에 남긴 AgentRun id — 본 실행 다음 핸드오프 순서. 0 은 run 을 남기지 않은
// 분기(결정론·UNKNOWN)의 sentinel 이라 뺀다. 응답 문구의 `agentRunId=` 꼬리표를 소비자가 파싱하지
// 않게 구조화 필드로 넘기는 용도다 — 문구는 생산자가 바꾸는 순간 조용히 깨진다.
export const collectDispatchRunIds = (result: DispatchResult): number[] =>
  [
    result.agentRunId,
    ...(result.handoffResults ?? []).map((handoff) => handoff.agentRunId),
  ].filter((agentRunId) => agentRunId > 0);

export const buildDispatchReplyText = (result: DispatchResult): string => {
  const entries = [result, ...(result.handoffResults ?? [])];
  const blocks = entries.map(withRunIdLine);
  return blocks.join('\n\n---\n\n');
};

// 실행 번호 0 은 원장에 run 을 남기지 않은 분기라 번호 줄을 붙이지 않는다.
const withRunIdLine = (entry: DispatchResult): string => {
  if (entry.agentRunId <= 0) {
    return entry.formattedText;
  }
  return `${entry.formattedText}\n${formatRunIdLine(entry.agentRunId)}`;
};
