import {
  formatMorningDigest,
  MorningDigestInput,
} from './morning-digest.formatter';

const todoLine = ({
  title,
  dayCount = 1,
  detail = null,
}: {
  title: string;
  dayCount?: number;
  detail?: string | null;
}) => ({
  title,
  url: null,
  dayCount,
  detail,
});

const base = (
  overrides: Partial<MorningDigestInput> = {},
): MorningDigestInput => ({
  firedAtKst: '2026-11-04',
  approvalLabels: [],
  incidents: [],
  resolvedIncidents: [],
  postings: null,
  invest: null,
  todos: [],
  todoSections: { loadFailed: false, today: [], waiting: [], unstarted: [] },
  planFailure: null,
  schedules: [],
  upcomingSchedules: [],
  tracking: [],
  asset: null,
  study: null,
  portfolio: null,
  ...overrides,
});

describe('formatMorningDigest', () => {
  it('네 칸을 순서대로 낸다', () => {
    expect(
      formatMorningDigest(
        base({
          todoSections: {
            loadFailed: false,
            today: [
              {
                ...todoLine({ title: '상벌점 입장 링크 확인' }),
                url: 'https://g/1',
              },
              todoLine({
                title: '공지 첨부파일 저장 오류 고치기',
                dayCount: 3,
              }),
            ],
            waiting: [],
            unstarted: [],
          },
          incidents: [{ label: '포트폴리오 사이트 발행 실패', dayCount: 2 }],
          resolvedIncidents: ['아침신문'],
          schedules: ['• 14:00 팀 회의'],
          invest: { buyCount: 2, sellCount: 1 },
        }),
      ),
    ).toBe(
      [
        '☀️ *11/4(수) 아침* · 🔴 장애: 포트폴리오 사이트 발행 실패',
        '',
        '*오늘 할 일*',
        '• <https://g/1|상벌점 입장 링크 확인>',
        '• 공지 첨부파일 저장 오류 고치기 (3일째)',
        '',
        '*어제 장애*',
        '• 포트폴리오 사이트 발행 실패 (2일째)',
        '• 아침신문, 지금은 복구됨',
        '',
        '*오늘 일정*',
        '• 14:00 팀 회의',
        '',
        '*그 밖에*',
        '• 투자: 오늘 시가 매수 2, 매도 1 예정',
      ].join('\n'),
    );
  });
  it('실패와 빈 계획을 구분한다', () => {
    const failed = formatMorningDigest(
      base({ todos: null, planFailure: '시간 초과' }),
    );
    expect(failed).toContain('*오늘 할 일*\n• 오늘 할 일이 없어요');
    expect(failed).toContain('*어제 장애*\n• 오늘 계획 생성 실패');
    expect(formatMorningDigest(base())).toContain('• 오늘 할 일이 없어요');
    expect(formatMorningDigest(base())).not.toContain('*어제 장애*');
  });
  it('할 일을 다섯 개까지 보여준다', () => {
    const today = Array.from({ length: 7 }, (_, index) =>
      todoLine({ title: String(index) }),
    );
    expect(
      formatMorningDigest(
        base({
          todoSections: {
            loadFailed: false,
            today,
            waiting: [],
            unstarted: [],
          },
        }),
      ),
    ).toContain('• 외 2개');
  });
  it('첫 줄에는 가장 급한 장애 이름을 쓰고 계획 실패도 장애로 센다', () => {
    expect(
      formatMorningDigest(
        base({
          incidents: [{ label: '공고 수집 멈춤', dayCount: null }],
          approvalLabels: ['블로그 후보'],
          postings: [{ company: 'A', title: '개발자' }],
        }),
      ),
    ).toContain(
      '☀️ *11/4(수) 아침* · 🔴 장애: 공고 수집 멈춤 · ✋ 승인 1 · 공고 1',
    );
    expect(
      formatMorningDigest(base({ todos: null, planFailure: '시간 초과' })),
    ).toContain('☀️ *11/4(수) 아침* · 🔴 장애: 오늘 계획 생성 실패');
  });
  it('장애가 없으면 첫 승인 이름이나 공고 회사명을 첫 줄에 쓴다', () => {
    expect(
      formatMorningDigest(base({ approvalLabels: ['블로그 후보'] })).split(
        '\n',
      )[0],
    ).toContain('✋ 승인 1 (블로그 후보)');
    expect(
      formatMorningDigest(
        base({ postings: [{ company: '하마랩', title: '개발자' }] }),
      ).split('\n')[0],
    ).toContain('공고 1: 하마랩');
  });
  it('빈 칸은 그리지 않고 공고의 외 N은 회사 수로 센다', () => {
    const text = formatMorningDigest(
      base({
        postings: [
          { company: 'A', title: '1' },
          { company: 'A', title: '2' },
          { company: 'B', title: '3' },
          { company: 'C', title: '4' },
        ],
      }),
    );
    expect(text).toContain('A · B 외 1');
    expect(text).not.toContain('*어제 장애*');
    expect(text).not.toContain('*오늘 일정*');
    expect(text).not.toContain('*다가오는 마감*');
  });
  it('다가오는 마감과 자산은 지정된 칸에 한 줄씩 싣는다', () => {
    const text = formatMorningDigest(
      base({
        upcomingSchedules: ['• 11/7(토) 이력서 제출 (D-3)'],
        asset: '140만원 · 매입가 대비 +25%',
      }),
    );
    expect(text).toContain('*다가오는 마감*\n• 11/7(토) 이력서 제출 (D-3)');
    expect(text).toContain('*그 밖에*\n• 자산: 140만원 · 매입가 대비 +25%');
  });

  it('업무 추적 줄은 그 밖에 칸 맨 앞에 붙는다', () => {
    const text = formatMorningDigest(
      base({
        tracking: ['새 후보 2건'],
        asset: '1,000원',
      }),
    );
    expect(text).toContain('*그 밖에*\n• 새 후보 2건\n• 자산: 1,000원');
    expect(text).not.toContain('진행 중 1건');
  });

  it('남 기다리는 일은 3줄까지만 쓰고 0개면 칸을 뺀다', () => {
    const waiting = Array.from({ length: 5 }, (_, index) =>
      todoLine({ title: `대기 ${index}` }),
    );
    const text = formatMorningDigest(
      base({
        todoSections: { loadFailed: false, today: [], waiting, unstarted: [] },
      }),
    );
    expect(text).toContain(
      '*남 기다리는 일 5개*\n• 대기 0\n• 대기 1\n• 대기 2\n• 외 2개',
    );
    expect(text).not.toContain('• 대기 3');
    expect(formatMorningDigest(base())).not.toContain('남 기다리는 일');
  });

  it('시작 안 한 일은 수만 표시하고 0개면 줄을 뺀다', () => {
    const text = formatMorningDigest(
      base({
        todoSections: {
          loadFailed: false,
          today: [],
          waiting: [],
          unstarted: [todoLine({ title: '첫째' }), todoLine({ title: '둘째' })],
        },
      }),
    );
    expect(text).toContain('• 시작 안 한 일 2개 (목록은 댓글에)');
    expect(text).not.toContain('• 첫째');
    expect(formatMorningDigest(base())).not.toContain('시작 안 한 일');
  });

  it('저장소 실패는 불러오기 실패만 쓰고 PM 장애로 세지 않는다', () => {
    const text = formatMorningDigest(
      base({
        todoSections: {
          loadFailed: true,
          today: [],
          waiting: [],
          unstarted: [],
        },
      }),
    );
    expect(text).toContain('*오늘 할 일*\n• 오늘 할 일을 불러오지 못했어요');
    expect(text).not.toContain('오늘 계획 생성 실패');
    expect(text).not.toContain('*어제 장애*');
  });

  it('괄호는 일수와 사유를 쉼표로 잇고 첫날 일수는 뺀다', () => {
    const text = formatMorningDigest(
      base({
        todoSections: {
          loadFailed: false,
          today: [
            todoLine({ title: '충돌', dayCount: 3, detail: '충돌 있음' }),
            todoLine({ title: '승인', dayCount: 1, detail: '승인됨' }),
            todoLine({ title: '미관측', dayCount: 4 }),
          ],
          waiting: [
            todoLine({
              title: '리뷰',
              dayCount: 5,
              detail: '리뷰 요청 후 3일째 답 없음',
            }),
          ],
          unstarted: [],
        },
      }),
    );
    expect(text).toContain('• 충돌 (3일째, 충돌 있음)');
    expect(text).toContain('• 승인 (승인됨)');
    expect(text).toContain('• 미관측 (4일째)');
    expect(text).toContain('• 리뷰 (리뷰 요청 후 3일째 답 없음)');
  });

  it('같은 업무는 각 칸에 한 번만 나타난다', () => {
    const text = formatMorningDigest(
      base({
        todoSections: {
          loadFailed: false,
          today: [todoLine({ title: '내 차례' })],
          waiting: [todoLine({ title: '상대 차례' })],
          unstarted: [todoLine({ title: '시작 전' })],
        },
      }),
    );
    expect(text.match(/• 내 차례/g)).toHaveLength(1);
    expect(text.match(/• 상대 차례/g)).toHaveLength(1);
    expect(text).not.toContain('• 시작 전');
  });
});
