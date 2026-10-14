import {
  toDislikedCandidate,
  toNlAnswerCandidate,
} from './nl-answer-candidate';

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

describe('toDislikedCandidate', () => {
  // 2026-10-08T01:00:30Z 에 게시된 답글
  const signal = {
    messageTs: '1791421230.000100',
    messageText: '직접 선별·제외는\n못 해요.',
    promptText: '<@U0BOT> 공고 중에서 필요 없는 공고 빼는 법 알려줘',
  };
  const routerRun = (id: number, startedAt: string, routedText: string) => ({
    id,
    agentType: 'ROUTER',
    status: 'SUCCEEDED',
    startedAt: new Date(startedAt),
    inputSnapshot: { routedText },
    output: { outcome: 'UNCLASSIFIED' },
  });

  it('질문 원문이 같고 답보다 먼저 시작한 가장 최근 run 에 잇는다 — 답 이후 run 은 쓰지 않는다', () => {
    const candidate = toDislikedCandidate(signal, [
      routerRun(
        1,
        '2026-10-07T01:00:00Z',
        '공고 중에서 필요 없는 공고 빼는 법 알려줘',
      ),
      routerRun(
        2,
        '2026-10-08T01:00:10Z',
        '공고 중에서  필요 없는 공고 빼는 법 알려줘',
      ),
      routerRun(
        3,
        '2026-10-08T02:00:00Z',
        '공고 중에서 필요 없는 공고 빼는 법 알려줘',
      ),
      routerRun(4, '2026-10-08T01:00:20Z', '다른 질문'),
    ]);

    expect(candidate).toEqual({
      agentRunId: 2,
      startedAt: '2026-10-08T01:00:10.000Z',
      worker: 'ROUTER',
      text: '공고 중에서 필요 없는 공고 빼는 법 알려줘',
      reason: 'DISLIKED',
      detail: '답: 직접 선별·제외는 못 해요.',
    });
  });

  it('원장 원문이 500자에서 잘렸으면 앞부분으로 맞춘다', () => {
    const longPrompt = '가'.repeat(600);
    const candidate = toDislikedCandidate(
      { ...signal, promptText: longPrompt },
      [routerRun(9, '2026-10-08T01:00:00Z', `${'가'.repeat(500)}…[잘림]`)],
    );
    expect(candidate?.agentRunId).toBe(9);
  });

  it('잇는 run 이 없어도 질문·답으로 후보를 낸다', () => {
    const candidate = toDislikedCandidate(signal, []);
    expect(candidate).toMatchObject({
      agentRunId: null,
      worker: 'run 미연결',
      startedAt: '2026-10-08T01:00:30.000Z',
      reason: 'DISLIKED',
    });
  });

  it('질문이 없는 반응(최상위 cron 발송 등)과 이미 eval 문항인 원문은 후보가 아니다', () => {
    expect(toDislikedCandidate({ ...signal, promptText: null }, [])).toBeNull();
    expect(
      toDislikedCandidate(
        signal,
        [],
        new Set(['공고 중에서 필요 없는 공고 빼는 법 알려줘']),
      ),
    ).toBeNull();
  });
});
