import { formatOpsSupervisor } from './ops-supervisor.formatter';

describe('formatOpsSupervisor', () => {
  it('이상 0건이면 1줄 하트비트', () => {
    const text = formatOpsSupervisor(
      {
        agents: [
          {
            agentType: 'PM',
            total: 10,
            failed: 0,
            failRate: 0,
            retries: 0,
            retryRate: 0,
            sweptCount: 0,
          },
        ],
        previews: [],
      },
      [],
      null,
      '2026-08-01',
    );

    expect(text).toContain('이상 없음');
    expect(text.split('\n')).toHaveLength(1);
  });

  it('이상 있으면 헤더 + 항목 + 제안', () => {
    const text = formatOpsSupervisor(
      { agents: [], previews: [] },
      [
        {
          scope: 'agent',
          key: 'PM',
          kind: 'FAIL_RATE',
          detail: '실패율 30% (3/10, 좀비 제외)',
        },
      ],
      '- PM: 인증 만료 의심',
      '2026-08-01',
    );

    expect(text).toContain('PM');
    expect(text).toContain('실패율 30%');
    expect(text).toContain('인증 만료 의심');
  });

  it('preview만 점검한 하트비트에도 점검 범위를 표시한다', () => {
    const text = formatOpsSupervisor(
      {
        agents: [],
        previews: [
          {
            kind: 'PM_WRITE_BACK',
            total: 1,
            applied: 1,
            cancelled: 0,
            expired: 0,
            rejectRate: 0,
          },
        ],
      },
      [],
      null,
      '2026-08-01',
    );

    expect(text).toContain('1개 preview 종류');
  });

  it('제안이 null이면 생략 표기', () => {
    const text = formatOpsSupervisor(
      { agents: [], previews: [] },
      [
        {
          scope: 'agent',
          key: 'PM',
          kind: 'FAIL_RATE',
          detail: '실패율 30%',
        },
      ],
      null,
      '2026-08-01',
    );

    expect(text).toContain('제안 생략');
  });
});
