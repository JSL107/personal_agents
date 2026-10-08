import { toNlAnswerCandidate } from './nl-answer-candidate';

const row = (
  overrides: Partial<{
    agentType: string;
    status: string;
    inputSnapshot: unknown;
    output: unknown;
  }>,
) => ({
  id: 7,
  agentType: 'VACATION',
  status: 'SUCCEEDED',
  startedAt: new Date('2026-10-08T01:00:00.000Z'),
  inputSnapshot: { routedText: '휴가 3일 쓰면 며칠 남아?', action: 'UNKNOWN' },
  output: { usedFallback: false },
  ...overrides,
});

describe('toNlAnswerCandidate', () => {
  it('사실 기반 답을 못 내고 표로 대신 답한 회차는 FALLBACK — 사유를 함께 싣는다', () => {
    expect(
      toNlAnswerCandidate(
        row({
          output: {
            usedFallback: true,
            numberCheck: { ok: false, unexpected: ['11'] },
          },
        }),
      ),
    ).toMatchObject({
      reason: 'FALLBACK',
      detail: '근거 없는 값: 11',
      agentRunId: 7,
    });
  });

  it('쓰기를 보류한 회차는 HELD_WRITE', () => {
    expect(
      toNlAnswerCandidate(
        row({
          inputSnapshot: {
            routedText: '내일 휴가 써도 될까?',
            action: 'UNKNOWN',
            parsedIntent: { heldWrite: { action: 'REGISTER', marker: '?' } },
          },
        }),
      ),
    ).toMatchObject({ reason: 'HELD_WRITE' });
  });

  it('분류기가 담당을 못 고른 회차는 UNCLASSIFIED', () => {
    expect(
      toNlAnswerCandidate(
        row({
          agentType: 'ROUTER',
          inputSnapshot: { routedText: '오늘 저녁 뭐 먹지' },
          output: { outcome: 'UNCLASSIFIED' },
        }),
      ),
    ).toMatchObject({ reason: 'UNCLASSIFIED', worker: 'ROUTER' });
  });

  it('정상 메뉴 실행(BALANCE 등)과 원문 없는 회차는 후보가 아니다', () => {
    expect(
      toNlAnswerCandidate(
        row({
          inputSnapshot: { routedText: '휴가 며칠 남았어', action: 'BALANCE' },
        }),
      ),
    ).toBeNull();
    expect(
      toNlAnswerCandidate(row({ inputSnapshot: { action: 'UNKNOWN' } })),
    ).toBeNull();
  });

  it('이미 eval 문항에 있는 원문은 멘션·공백 차이를 무시하고 뺀다', () => {
    expect(
      toNlAnswerCandidate(
        row({
          inputSnapshot: {
            routedText: '<@U0AULUXLF9B>  8일 기준이라면 4일이 남은게 맞아?',
            action: 'UNKNOWN',
          },
        }),
      ),
    ).toBeNull();
  });

  it('처리 중 오류로 끝난 회차는 사실 답이 아니라 FAILED 로 분류한다', () => {
    expect(
      toNlAnswerCandidate(row({ status: 'FAILED', output: null })),
    ).toMatchObject({ reason: 'FAILED' });
  });
});
