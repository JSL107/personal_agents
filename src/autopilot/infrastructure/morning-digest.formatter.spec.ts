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
        '☀️ *11/4(수) 아침* 🔴 장애 1',
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
});
