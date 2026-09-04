import { AgentType } from '../../model-router/domain/model-router.type';
import { buildDispatchReplyText } from './dispatch-reply.util';
import { DispatchResult } from './idaeri-router.port';

const baseResult: DispatchResult = {
  agentRunId: 42,
  workerType: AgentType.PM,
  output: {},
  modelUsed: 'codex',
  formattedText: '루트 결과',
};

describe('buildDispatchReplyText', () => {
  it('root 결과는 기존 Slack footer와 함께 반환한다', () => {
    expect(buildDispatchReplyText(baseResult)).toBe(
      '루트 결과\n\n_이대리 (PM) · agentRunId=42_',
    );
  });

  it('handoff 결과는 구분선과 chain footer로 결합한다', () => {
    expect(
      buildDispatchReplyText({
        ...baseResult,
        handoffResults: [
          {
            ...baseResult,
            agentRunId: 43,
            workerType: AgentType.BE,
            formattedText: '자식 결과',
          },
        ],
      }),
    ).toBe(
      '루트 결과\n\n---\n\n자식 결과\n\n_이대리 chain — PM → BE · agentRunIds=[42, 43]_',
    );
  });

  it('async ack sentinel은 footer 없이 본문만 반환한다', () => {
    expect(buildDispatchReplyText({ ...baseResult, agentRunId: 0 })).toBe(
      '루트 결과',
    );
  });
});
