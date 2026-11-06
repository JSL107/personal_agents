import {
  EveningDigestInput,
  formatEveningDigest,
} from './evening-digest.formatter';

const base = (
  overrides: Partial<EveningDigestInput> = {},
): EveningDigestInput => ({
  firedAtKst: '2026-11-04',
  mergedPrCount: 4,
  keep: null,
  problem: null,
  tryNext: null,
  retroFailure: null,
  invest: null,
  carriedApprovalCount: 0,
  incidents: [],
  ...overrides,
});

describe('formatEveningDigest', () => {
  it('spec 예시의 한 일, 못 한 일, 숫자를 그대로 낸다', () => {
    const text = formatEveningDigest({
      ...base(),
      todoSummary: {
        loadFailed: false,
        hasMorningList: true,
        done: [
          {
            title: '작업 현황 정리',
            url: null,
            detail: null,
            outsideMorningList: false,
          },
          {
            title: '학교 관리자 화면',
            url: null,
            detail: null,
            outsideMorningList: false,
          },
        ],
        extraMergedPrCount: 0,
        notDone: [
          {
            title: '알림 설정 화면 고치기',
            url: null,
            detail: '2일째, 충돌 있음',
            outsideMorningList: false,
          },
          {
            title: '공지 첨부파일 저장 오류',
            url: null,
            detail: '8일째, 남 기다림',
            outsideMorningList: false,
          },
          {
            title: '상벌점 입장 링크',
            url: null,
            detail: '6일째, 남 기다림',
            outsideMorningList: false,
          },
        ],
        ratio: { done: 2, total: 3 },
        waiting: {
          count: 2,
          atLeast: false,
          longest: '리뷰 요청 후 3일째 답 없음',
        },
        backlog: { myTurn: 1, waiting: 2, unknown: 0 },
      },
    } as EveningDigestInput);
    expect(text).toContain('*한 일*\n• 작업 현황 정리\n• 학교 관리자 화면');
    expect(text).toContain(
      '*못 한 일*\n• 알림 설정 화면 고치기 (2일째, 충돌 있음)\n• 공지 첨부파일 저장 오류 (8일째, 남 기다림)\n• 상벌점 입장 링크 (6일째, 남 기다림)',
    );
    expect(text).toContain(
      '*숫자로 보면*\n• 아침 할 일 3개 중 2개 끝냄 (67%)\n• 남을 기다린 일 2개, 가장 긴 것은 리뷰 요청 후 3일째 답 없음\n• 밀린 일 3개: 내 차례 1개, 남 기다림 2개, 확인 못 함 0개',
    );
    expect(text).not.toContain('• PR 4건 머지');
  });
  const doneSummary = (
    done: { title: string; outsideMorningList: boolean }[],
  ): NonNullable<EveningDigestInput['todoSummary']> => ({
    loadFailed: false,
    hasMorningList: true,
    done: done.map((line) => ({ ...line, url: null, detail: null })),
    extraMergedPrCount: 0,
    notDone: [],
    ratio: null,
    waiting: null,
    backlog: null,
  });
  it('한 일은 다섯 줄로 접고 남은 PR 수를 덧붙인다', () => {
    const text = formatEveningDigest({
      ...base(),
      todoSummary: {
        ...doneSummary(
          Array.from({ length: 6 }, (_, index) => ({
            title: `업무 ${index + 1}`,
            outsideMorningList: false,
          })),
        ),
        extraMergedPrCount: 2,
      },
    });
    expect(text).not.toContain('업무 6');
    expect(text).toContain(
      '*한 일*\n• 할 일과 연결 안 된 머지 PR 2건\n• 업무 1',
    );
    expect(text).toContain('• 업무 5\n• 외 1개');
  });
  it('아침 목록 밖 일은 줄마다 꼬리 대신 소제목 한 줄 아래에 모은다', () => {
    const text = formatEveningDigest({
      ...base(),
      todoSummary: doneSummary([
        { title: '밖 1', outsideMorningList: true },
        { title: '안 1', outsideMorningList: false },
        { title: '밖 2', outsideMorningList: true },
      ]),
    });
    expect(text).toContain('*한 일*\n• 안 1\n_아침 목록 밖_\n• 밖 1\n• 밖 2');
    expect(text).not.toContain('(아침 목록 밖)');
  });
  it('한 일이 전부 아침 목록 밖이면 소제목은 한 번만 나온다', () => {
    const text = formatEveningDigest({
      ...base(),
      todoSummary: doneSummary(
        Array.from({ length: 5 }, (_, index) => ({
          title: `밖 ${index + 1}`,
          outsideMorningList: true,
        })),
      ),
    });
    expect(text.split('아침 목록 밖')).toHaveLength(2);
    expect(text).toContain('*한 일*\n_아침 목록 밖_\n• 밖 1');
  });
  it('넘친 줄과 PR 조회 실패가 있어도 소제목 아래에는 목록 밖 일만 온다', () => {
    const text = formatEveningDigest({
      ...base(),
      mergedPrCount: null,
      todoSummary: doneSummary([
        ...Array.from({ length: 3 }, (_, index) => ({
          title: `안 ${index + 1}`,
          outsideMorningList: false,
        })),
        ...Array.from({ length: 4 }, (_, index) => ({
          title: `밖 ${index + 1}`,
          outsideMorningList: true,
        })),
      ]),
    });
    expect(text).toContain(
      '*한 일*\n• 머지한 PR을 확인하지 못했어요\n• 안 1\n• 안 2\n• 안 3\n_아침 목록 밖_\n• 밖 1\n• 밖 2\n• 외 2개',
    );
  });
  it('잘린 줄에만 목록 밖 일이 있으면 소제목을 내지 않는다', () => {
    const text = formatEveningDigest({
      ...base(),
      todoSummary: doneSummary([
        ...Array.from({ length: 5 }, (_, index) => ({
          title: `안 ${index + 1}`,
          outsideMorningList: false,
        })),
        { title: '밖 1', outsideMorningList: true },
      ]),
    });
    expect(text).not.toContain('아침 목록 밖');
    expect(text).toContain('• 안 5\n• 외 1개');
  });
  it('조회 실패면 기존 PR 줄을 복원하고 목록 숫자를 쓰지 않는다', () => {
    const text = formatEveningDigest({
      ...base(),
      todoSummary: {
        loadFailed: true,
        hasMorningList: false,
        done: [],
        extraMergedPrCount: 0,
        notDone: [],
        ratio: null,
        waiting: null,
        backlog: null,
      },
    });
    expect(text).toContain('*한 일*\n• PR 4건 머지');
    expect(text).not.toContain('*숫자로 보면*');
  });
  it('업무는 읽혔고 머지 PR 조회만 실패하면 빈 한 일에도 실패를 알린다', () => {
    const text = formatEveningDigest(
      base({
        mergedPrCount: null,
        todoSummary: {
          loadFailed: false,
          hasMorningList: false,
          done: [],
          extraMergedPrCount: 0,
          notDone: [],
          ratio: null,
          waiting: null,
          backlog: null,
        },
      }),
    );

    expect(text).toContain('*한 일*\n• 머지한 PR을 확인하지 못했어요');
  });
  it('미관측 대기는 이상으로 쓰고 빈 항목은 숨긴다', () => {
    const text = formatEveningDigest({
      ...base(),
      todoSummary: {
        loadFailed: false,
        hasMorningList: false,
        done: [],
        extraMergedPrCount: 0,
        notDone: [],
        ratio: null,
        waiting: { count: 2, atLeast: true, longest: null },
        backlog: { myTurn: 0, waiting: 2, unknown: 0 },
      },
    });
    expect(text).toContain('• 남을 기다린 일 2개 이상');
    expect(text).not.toContain('*못 한 일*');
    expect(text).not.toContain('*한 일*');
  });
  it('한 일과 회고를 순서대로 낸다', () => {
    expect(
      formatEveningDigest(
        base({
          keep: '원인을 오전에 찾아 같은 날 고쳤다.',
          problem: '리뷰 요청이 늦어 답이 내일로 밀렸다.',
          tryNext: '리뷰 요청은 오전에 먼저 보낸다.',
        }),
      ),
    ).toBe(
      [
        '🌙 *11/4(수) 마감*',
        '',
        '*한 일*',
        '• PR 4건 머지',
        '',
        '*아쉬운 점*',
        '• 리뷰 요청이 늦어 답이 내일로 밀렸다.',
        '',
        '*잘한 점*',
        '• 원인을 오전에 찾아 같은 날 고쳤다.',
        '',
        '*내일 추천*',
        '• 리뷰 요청은 오전에 먼저 보낸다.',
      ].join('\n'),
    );
  });
  it('조회와 회고 실패를 알린다', () => {
    const text = formatEveningDigest(
      base({ mergedPrCount: null, retroFailure: '시간 초과' }),
    );
    expect(text).toContain('확인하지 못했어요');
    expect(text).toContain(
      '_회고를 만들지 못했어요 (시간 초과). 내일 다시 시도해요._',
    );
  });
  it('투자와 승인 대기는 그 밖에 둔다', () => {
    const text = formatEveningDigest(
      base({
        carriedApprovalCount: 1,
        invest: {
          returns: [{ accountName: 'LONG_TERM', returnRate: '1.2' }],
          filled: { buyCount: 0, sellCount: 0 },
          next: null,
        },
      }),
    );
    expect(text).toContain('*그 밖에*\n• 장기투자 수익률 +1.2%');
    expect(text).toContain('• 승인 대기 1장');
  });
});
