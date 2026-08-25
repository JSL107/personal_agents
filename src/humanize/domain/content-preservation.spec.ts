import {
  findPreservationViolations,
  shouldRollbackField,
} from './content-preservation';

describe('content preservation', () => {
  it('토큰이 같은 정상 윤문은 위반 없이 통과한다', () => {
    const violations = findPreservationViolations(
      'PR #275에서 `buildSafeChildEnv`를 확인하세요. 링크: https://example.com/jobs/29',
      'PR #275의 `buildSafeChildEnv` 확인 링크: https://example.com/jobs/29',
    );

    expect(violations).toEqual([]);
    expect(shouldRollbackField(violations)).toBe(false);
  });

  it('#275를 #278로 바꾸면 pr 주입과 소실로 롤백한다', () => {
    const violations = findPreservationViolations(
      'PR #275를 검토했습니다.',
      'PR #278을 검토했습니다.',
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        { kind: 'pr', token: '#278', direction: 'injected' },
        { kind: 'pr', token: '#275', direction: 'lost' },
      ]),
    );
    expect(violations).toHaveLength(2);
    expect(shouldRollbackField(violations)).toBe(true);
  });

  it('29종을 32종으로 바꾸면 number 주입으로 롤백한다', () => {
    const violations = findPreservationViolations(
      '도구 29종을 지원합니다.',
      '도구 32종을 지원합니다.',
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        { kind: 'number', token: '32', direction: 'injected' },
        { kind: 'number', token: '29', direction: 'lost' },
      ]),
    );
    expect(violations).toHaveLength(2);
    expect(shouldRollbackField(violations)).toBe(true);
  });

  it('3개를 세 개로 바꾼 number 소실만 있으면 롤백하지 않는다', () => {
    const violations = findPreservationViolations(
      '할 일이 3개 있습니다.',
      '할 일이 세 개 있습니다.',
    );

    expect(violations).toEqual([
      { kind: 'number', token: '3', direction: 'lost' },
    ]);
    expect(shouldRollbackField(violations)).toBe(false);
  });

  it('URL이 사라지면 롤백한다', () => {
    const violations = findPreservationViolations(
      '문서는 https://example.com/guide 에 있습니다.',
      '문서는 안내 페이지에 있습니다.',
    );

    expect(violations).toEqual([
      {
        kind: 'url',
        token: 'https://example.com/guide',
        direction: 'lost',
      },
    ]);
    expect(shouldRollbackField(violations)).toBe(true);
  });

  it('백틱 코드 식별자가 사라지면 롤백한다', () => {
    const violations = findPreservationViolations(
      '`buildSafeChildEnv`를 호출합니다.',
      '안전한 환경 생성 함수를 호출합니다.',
    );

    expect(violations).toEqual([
      {
        kind: 'code',
        token: '`buildSafeChildEnv`',
        direction: 'lost',
      },
    ]);
    expect(shouldRollbackField(violations)).toBe(true);
  });

  it('같은 토큰의 등장 횟수만 줄어들면 집합 비교로 통과한다', () => {
    const violations = findPreservationViolations(
      '3회 점검했고 3건을 처리했습니다.',
      '3회 점검했습니다.',
    );

    expect(violations).toEqual([]);
    expect(shouldRollbackField(violations)).toBe(false);
  });

  it('URL 안 숫자는 number로 중복 계산하지 않는다', () => {
    const violations = findPreservationViolations(
      'https://example.com/releases/275',
      '릴리스 링크',
    );

    expect(violations).toEqual([
      {
        kind: 'url',
        token: 'https://example.com/releases/275',
        direction: 'lost',
      },
    ]);
  });

  it('URL 뒤에 쉼표만 추가되면 같은 URL로 보고 통과한다', () => {
    const violations = findPreservationViolations(
      'https://example.com/a',
      'https://example.com/a,',
    );

    expect(violations).toEqual([]);
    expect(shouldRollbackField(violations)).toBe(false);
  });

  it('URL 뒤에 마침표만 추가되면 같은 URL로 보고 통과한다', () => {
    const violations = findPreservationViolations(
      'https://a.io/b',
      'https://a.io/b.',
    );

    expect(violations).toEqual([]);
    expect(shouldRollbackField(violations)).toBe(false);
  });

  it.each([';', ':', '!', '?', ')', ']', '}', "'", '"'])(
    'URL 뒤 문장부호 %s만 추가되면 같은 URL로 보고 통과한다',
    (punctuation) => {
      const violations = findPreservationViolations(
        'https://example.com/a',
        `https://example.com/a${punctuation}`,
      );

      expect(violations).toEqual([]);
      expect(shouldRollbackField(violations)).toBe(false);
    },
  );

  it('URL 뒤 문장부호가 연속되어도 끝 문장부호만 제외하고 통과한다', () => {
    const violations = findPreservationViolations(
      'https://example.com/a',
      'https://example.com/a).',
    );

    expect(violations).toEqual([]);
    expect(shouldRollbackField(violations)).toBe(false);
  });

  it('URL 내부 마침표가 그대로면 같은 URL로 보고 통과한다', () => {
    const violations = findPreservationViolations(
      'https://a.io/b.html',
      'https://a.io/b.html',
    );

    expect(violations).toEqual([]);
    expect(shouldRollbackField(violations)).toBe(false);
  });

  it('URL 내부 확장자가 바뀌면 URL 변경으로 롤백한다', () => {
    const violations = findPreservationViolations(
      'https://a.io/b.html',
      'https://a.io/b.htm',
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        {
          kind: 'url',
          token: 'https://a.io/b.htm',
          direction: 'injected',
        },
        {
          kind: 'url',
          token: 'https://a.io/b.html',
          direction: 'lost',
        },
      ]),
    );
    expect(violations).toHaveLength(2);
    expect(shouldRollbackField(violations)).toBe(true);
  });

  it('천 단위 쉼표 숫자가 유지되면 한 토큰으로 보고 통과한다', () => {
    const violations = findPreservationViolations('1,000건', '1,000건 남짓');

    expect(violations).toEqual([]);
    expect(shouldRollbackField(violations)).toBe(false);
  });

  it('1,000을 1000으로 바꾸면 숫자 표기 변경 한 건으로 롤백한다', () => {
    const violations = findPreservationViolations('1,000건', '1000건');

    expect(violations).toEqual(
      expect.arrayContaining([
        { kind: 'number', token: '1000', direction: 'injected' },
        { kind: 'number', token: '1,000', direction: 'lost' },
      ]),
    );
    expect(violations).toHaveLength(2);
    expect(shouldRollbackField(violations)).toBe(true);
  });

  it('여러 천 단위 쉼표를 포함한 수치를 한 토큰으로 비교한다', () => {
    const violations = findPreservationViolations(
      '12,345,678건',
      '12,345,679건',
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        { kind: 'number', token: '12,345,679', direction: 'injected' },
        { kind: 'number', token: '12,345,678', direction: 'lost' },
      ]),
    );
    expect(violations).toHaveLength(2);
  });

  it('소수점 숫자를 기존처럼 한 토큰으로 비교한다', () => {
    const violations = findPreservationViolations(
      '비율은 4.5입니다.',
      '비율은 4.6입니다.',
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        { kind: 'number', token: '4.6', direction: 'injected' },
        { kind: 'number', token: '4.5', direction: 'lost' },
      ]),
    );
    expect(violations).toHaveLength(2);
  });

  it('숫자 나열의 쉼표 뒤 한 자리는 천 단위 구분자로 합치지 않는다', () => {
    const violations = findPreservationViolations(
      '3, 4번 항목을 확인했습니다.',
      '3, 5번 항목을 확인했습니다.',
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        { kind: 'number', token: '5', direction: 'injected' },
        { kind: 'number', token: '4', direction: 'lost' },
      ]),
    );
    expect(violations).toHaveLength(2);
  });
});
