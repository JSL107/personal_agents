import {
  formatMorningDigest,
  MorningDigestInput,
} from './morning-digest.formatter';

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
  planFailure: null,
  schedules: [],
  upcomingSchedules: [],
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
          todos: [
            {
              title: '상벌점 입장 링크 확인',
              url: 'https://g/1',
              dayCount: null,
            },
            { title: '공지 첨부파일 저장 오류 고치기', url: null, dayCount: 3 },
          ],
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
    expect(
      formatMorningDigest(base({ todos: null, planFailure: '시간 초과' })),
    ).toContain('*오늘 할 일*\n• 오늘 계획을 만들지 못했어요 (시간 초과)');
    expect(formatMorningDigest(base())).toContain(
      '• 오늘 자동 수집된 할 일이 없어요',
    );
    expect(formatMorningDigest(base())).not.toContain('*어제 장애*');
  });
  it('할 일을 다섯 개까지 보여준다', () => {
    const todos = Array.from({ length: 7 }, (_, index) => ({
      title: String(index),
      url: null,
      dayCount: null,
    }));
    expect(formatMorningDigest(base({ todos }))).toContain('• 외 2개');
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
});
