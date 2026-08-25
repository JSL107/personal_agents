import {
  MAX_REASON_LENGTH,
  MIN_REASON_LENGTH,
  RejectedConventionRow,
  renderLearnedConventions,
} from './learned-conventions';

// 하한을 넘는 이유. 실제 기각 이유는 판단 + 근거라 이보다 훨씬 길다.
const enough = (text: string): string => text.padEnd(MIN_REASON_LENGTH, '.');

const row = (
  category: string,
  reason: string,
  resolvedAt: string,
): RejectedConventionRow => ({
  category,
  rejectReason: reason,
  resolvedAt: new Date(resolvedAt),
});

describe('renderLearnedConventions', () => {
  it('기각 이력이 없으면 빈 블록 — 프롬프트에 아무것도 더하지 않는다', () => {
    const { block, categories } = renderLearnedConventions([]);

    expect(block).toBe('');
    expect(categories).toEqual([]);
  });

  it('카테고리당 1건이면 임계 미달로 제외한다 — 한 번의 기각은 그 PR 사정일 수 있다', () => {
    const { block } = renderLearnedConventions([
      row(
        'ARCHITECTURE',
        enough('이 레포는 port 를 외부 I/O 에만 씁니다'),
        '2026-08-20',
      ),
    ]);

    expect(block).toBe('');
  });

  it('카테고리당 2건이면 규약으로 싣는다', () => {
    const { block, categories } = renderLearnedConventions([
      row(
        'ARCHITECTURE',
        enough('이 레포는 port 를 외부 I/O 에만 씁니다'),
        '2026-08-20',
      ),
      row(
        'ARCHITECTURE',
        enough('DB 접근은 직접 주입이 관례입니다'),
        '2026-08-13',
      ),
    ]);

    expect(block).toContain(enough('이 레포는 port 를 외부 I/O 에만 씁니다'));
    expect(block).toContain(enough('DB 접근은 직접 주입이 관례입니다'));
    expect(categories).toEqual(['ARCHITECTURE']);
  });

  it('3건 이상이면 최신 2건만 싣는다 — 오래된 사례가 프롬프트를 희석하지 않게', () => {
    const { block } = renderLearnedConventions([
      row('ARCHITECTURE', enough('가장 오래된 이유'), '2026-06-01'),
      row('ARCHITECTURE', enough('중간 이유'), '2026-08-13'),
      row('ARCHITECTURE', enough('가장 최신 이유'), '2026-08-20'),
    ]);

    expect(block).toContain(enough('가장 최신 이유'));
    expect(block).toContain(enough('중간 이유'));
    expect(block).not.toContain(enough('가장 오래된 이유'));
  });

  it('노출은 2건으로 줄여도 기각 건수는 실제 수를 적는다', () => {
    const { block } = renderLearnedConventions([
      row('ARCHITECTURE', enough('이유 하나'), '2026-08-20'),
      row('ARCHITECTURE', enough('이유 둘'), '2026-08-19'),
      row('ARCHITECTURE', enough('이유 셋'), '2026-08-18'),
    ]);

    expect(block).toContain('기각 3건');
  });

  it('SECURITY 는 건수가 차도 절대 싣지 않는다 — 안전핀', () => {
    const { block, categories } = renderLearnedConventions([
      row('SECURITY', enough('이 토큰은 노출돼도 무방합니다'), '2026-08-20'),
      row('SECURITY', enough('권한 검사는 상위에서 합니다'), '2026-08-13'),
    ]);

    expect(block).toBe('');
    expect(categories).toEqual([]);
  });

  it('SECURITY 를 걸러도 다른 카테고리는 남는다', () => {
    const { block, categories } = renderLearnedConventions([
      row('SECURITY', enough('보안 기각 하나'), '2026-08-20'),
      row('SECURITY', enough('보안 기각 둘'), '2026-08-19'),
      row(
        'TEST',
        enough('이 레포는 배선 테스트를 요구하지 않습니다'),
        '2026-08-18',
      ),
      row('TEST', enough('controller 테스트는 대상 밖입니다'), '2026-08-17'),
    ]);

    expect(block).not.toContain('보안 기각');
    expect(block).toContain(
      enough('이 레포는 배선 테스트를 요구하지 않습니다'),
    );
    expect(categories).toEqual(['TEST']);
  });

  it('긴 이유는 상한에서 자르고 말줄임을 붙인다', () => {
    const long = '가'.repeat(MAX_REASON_LENGTH + 50);
    const { block } = renderLearnedConventions([
      row('TEST', long, '2026-08-20'),
      row('TEST', enough('짧은 이유'), '2026-08-19'),
    ]);

    expect(block).toContain('가'.repeat(MAX_REASON_LENGTH));
    expect(block).not.toContain('가'.repeat(MAX_REASON_LENGTH + 1));
    expect(block).toContain('…');
  });

  it('상한 이하 이유에는 말줄임을 붙이지 않는다', () => {
    const { block } = renderLearnedConventions([
      row('TEST', enough('짧은 이유 하나'), '2026-08-20'),
      row('TEST', enough('짧은 이유 둘'), '2026-08-19'),
    ]);

    expect(block).not.toContain('…');
  });

  it('여러 카테고리를 이름 순으로 싣는다 — 같은 입력이면 같은 프롬프트', () => {
    const { block, categories } = renderLearnedConventions([
      row('TEST', enough('테스트 기각 하나'), '2026-08-20'),
      row('TEST', enough('테스트 기각 둘'), '2026-08-19'),
      row('ARCHITECTURE', enough('구조 기각 하나'), '2026-08-18'),
      row('ARCHITECTURE', enough('구조 기각 둘'), '2026-08-17'),
    ]);

    expect(block.indexOf('ARCHITECTURE')).toBeLessThan(block.indexOf('TEST'));
    expect(categories).toEqual(['ARCHITECTURE', 'TEST']);
  });

  it('공백뿐인 이유는 세지 않는다 — 이유 없는 기각은 학습 재료가 아니다', () => {
    const { block } = renderLearnedConventions([
      row('TEST', '   ', '2026-08-20'),
      row('TEST', enough('실제 이유'), '2026-08-19'),
    ]);

    expect(block).toBe('');
  });

  it('한 줄 요약형 이유는 세지 않는다 — 읽어도 배울 것이 없다', () => {
    const { block } = renderLearnedConventions([
      row('ARCHITECTURE', '미반영 근거를 제시함', '2026-08-21'),
      row(
        'ARCHITECTURE',
        enough('port 는 구현이 둘 이상일 때만 둡니다'),
        '2026-08-20',
      ),
    ]);

    expect(block).toBe('');
  });

  it('짧은 이유가 최신이어도 근거 있는 사례를 밀어내지 않는다', () => {
    const { block } = renderLearnedConventions([
      row('ARCHITECTURE', '미반영 근거를 제시함', '2026-08-21'),
      row('ARCHITECTURE', enough('근거가 실린 이유 하나'), '2026-08-20'),
      row('ARCHITECTURE', enough('근거가 실린 이유 둘'), '2026-08-19'),
    ]);

    expect(block).toContain(enough('근거가 실린 이유 하나'));
    expect(block).toContain(enough('근거가 실린 이유 둘'));
    expect(block).not.toContain('미반영 근거를 제시함');
  });

  it('여러 줄 이유를 한 줄로 눌러 항목 경계를 지킨다', () => {
    const multiline = `이 지적은 기각합니다. 이 레포의 지배적 패턴과 반대입니다.

- 같은 형태가 최소 열두 곳입니다
- 이 PR 이 건드린 파일도 이미 그렇습니다`;
    const { block } = renderLearnedConventions([
      row('TEST', multiline, '2026-08-20'),
      row('TEST', enough('다른 이유'), '2026-08-19'),
    ]);

    expect(block).toContain(
      '이 지적은 기각합니다. 이 레포의 지배적 패턴과 반대입니다. - 같은 형태가 최소 열두 곳입니다 - 이 PR 이 건드린 파일도 이미 그렇습니다',
    );
  });

  it('줄바꿈을 걷어낸 길이로 하한을 잰다', () => {
    const padded = `짧은 이유\n\n\n${' '.repeat(80)}`;
    const { block } = renderLearnedConventions([
      row('TEST', padded, '2026-08-20'),
      row('TEST', enough('다른 이유'), '2026-08-19'),
    ]);

    expect(block).toBe('');
  });

  it('규약을 이유로 실제 결함을 덮지 말라는 단서를 함께 싣는다', () => {
    const { block } = renderLearnedConventions([
      row('TEST', enough('이유 하나'), '2026-08-20'),
      row('TEST', enough('이유 둘'), '2026-08-19'),
    ]);

    expect(block).toContain('실제 결함을 덮지 말 것');
  });
});
