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

  it.each([
    [
      '날짜가 바뀌면 롤백한다',
      '2026-09-23에 발행합니다.',
      '2026-09-24에 발행합니다.',
    ],
    [
      '한국어 날짜가 바뀌면 롤백한다',
      '2026년 9월 23일에 발행합니다.',
      '2026년 9월 24일에 발행합니다.',
    ],
  ])('%s', (_label, original, rewritten) => {
    const violations = findPreservationViolations(
      original,
      rewritten,
      'personal-blog',
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'date', direction: 'lost' }),
        expect.objectContaining({ kind: 'date', direction: 'injected' }),
      ]),
    );
    expect(shouldRollbackField(violations)).toBe(true);
  });

  it('발화 표지가 있는 직접 인용이 바뀌면 롤백한다', () => {
    const violations = findPreservationViolations(
      '김 대표는 "다음 주에 공개합니다"라고 밝혔습니다.',
      '김 대표는 "이번 주에 공개합니다"라고 밝혔습니다.',
      'personal-blog',
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'quote', direction: 'lost' }),
        expect.objectContaining({ kind: 'quote', direction: 'injected' }),
      ]),
    );
    expect(shouldRollbackField(violations)).toBe(true);
  });

  it('강조용 따옴표는 직접 인용 보존 대상으로 오인하지 않는다', () => {
    const violations = findPreservationViolations(
      '이 기능은 "자동화"라는 이름으로 소개됐습니다.',
      '이 기능은 자동화라는 이름으로 소개됐습니다.',
      'personal-blog',
    );

    expect(violations).toEqual([]);
    expect(shouldRollbackField(violations)).toBe(false);
  });

  it('인용문 안의 발화 표현은 직접 인용 표지로 오인하지 않는다', () => {
    const violations = findPreservationViolations(
      '문장은 "이 표현을 뭐라고 할까요"로 소개됐습니다.',
      '문장은 이 표현을 뭐라고 할까요로 소개됐습니다.',
      'personal-blog',
    );

    expect(violations).toEqual([]);
    expect(shouldRollbackField(violations)).toBe(false);
  });

  it('법조문 참조가 바뀌면 롤백한다', () => {
    const violations = findPreservationViolations(
      '개인정보보호법 제15조 제1항을 적용합니다.',
      '개인정보보호법 제16조 제1항을 적용합니다.',
      'personal-blog',
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'legal', direction: 'lost' }),
        expect.objectContaining({ kind: 'legal', direction: 'injected' }),
      ]),
    );
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

  it('블로그에서는 동일한 날짜·인용·법조문 참조의 등장 횟수 감소를 감지한다', () => {
    const original =
      '2026-09-23에 제15조를 확인했습니다. 김 대표는 "공개합니다"라고 밝혔습니다. 2026-09-23에 제15조를 다시 확인했습니다. 김 대표는 "공개합니다"라고 밝혔습니다.';
    const rewritten =
      '2026-09-23에 제15조를 확인했습니다. 김 대표는 "공개합니다"라고 밝혔습니다.';

    const violations = findPreservationViolations(
      original,
      rewritten,
      'personal-blog',
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        { kind: 'date', token: '2026-09-23', direction: 'lost' },
        { kind: 'quote', token: '"공개합니다"', direction: 'lost' },
        { kind: 'legal', token: '제15조', direction: 'lost' },
      ]),
    );
    expect(shouldRollbackField(violations)).toBe(true);
  });

  it('기본 보고서에서는 블로그 전용 인용 검사를 적용하지 않는다', () => {
    const violations = findPreservationViolations(
      '김 대표는 "계획"이라고 밝혔습니다.',
      '김 대표는 계획이라고 밝혔습니다.',
    );

    expect(violations).toEqual([]);
  });

  it('줄바꿈·500자 초과·콜론으로 도입한 직접 인용의 내용 변경을 감지한다', () => {
    const original = `김 대표의 발언은 다음과 같습니다: "${'계획을 설명합니다. '.repeat(40)}\n다음 주에 공개합니다."`;
    const rewritten = original.replace('다음 주에', '이번 주에');

    const violations = findPreservationViolations(
      original,
      rewritten,
      'personal-blog',
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'quote', direction: 'lost' }),
        expect.objectContaining({ kind: 'quote', direction: 'injected' }),
      ]),
    );
  });

  it('근처 발언 뒤의 용어 따옴표 제거는 인용 소실로 오인하지 않는다', () => {
    const violations = findPreservationViolations(
      '김 대표는 "계획"이라고 밝혔습니다. 이후 "자동화"라는 이름을 썼습니다.',
      '김 대표는 "계획"이라고 밝혔습니다. 이후 자동화라는 이름을 썼습니다.',
      'personal-blog',
    );

    expect(violations).toEqual([]);
  });

  it('절차 소개 뒤의 용어 따옴표는 발언으로 오인하지 않는다', () => {
    const violations = findPreservationViolations(
      '절차는 다음과 같습니다: "자동화" 단계를 실행합니다.',
      '절차는 다음과 같습니다: 자동화 단계를 실행합니다.',
      'personal-blog',
    );

    expect(violations).toEqual([]);
  });

  it('같은 문장 안에서 용어 따옴표 뒤에 발언 인용이 나와도 용어 변경은 허용한다', () => {
    const violations = findPreservationViolations(
      '문서에는 "용어"라고 설명했고, 이어서 "발언"이라고 밝혔다.',
      '문서에는 용어라고 설명했고, 이어서 "발언"이라고 밝혔다.',
      'personal-blog',
    );

    expect(violations).toEqual([]);
  });

  it.each([
    '김 대표는 "계획"이라고 했습니다.',
    '김 대표는 "계획"이라고 답했습니다.',
    '김민수는 "계획"이라고 밝혔습니다.',
    '교육부는 "계획"이라고 밝혔습니다.',
  ])('이름·기관·일반 발언 동사도 직접 인용으로 보존한다: %s', (original) => {
    const violations = findPreservationViolations(
      original,
      original.replace('"계획"', '"변경"'),
      'personal-blog',
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        { kind: 'quote', token: '"계획"', direction: 'lost' },
        { kind: 'quote', token: '"변경"', direction: 'injected' },
      ]),
    );
  });

  it('같은 문장의 뒤쪽 실제 발언 변경은 보존 위반으로 감지한다', () => {
    const violations = findPreservationViolations(
      '문서에는 "용어"라고 설명했고, 이어서 "발언"이라고 밝혔다.',
      '문서에는 "용어"라고 설명했고, 이어서 "변경"이라고 밝혔다.',
      'personal-blog',
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        { kind: 'quote', token: '"발언"', direction: 'lost' },
        { kind: 'quote', token: '"변경"', direction: 'injected' },
      ]),
    );
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

  it.each([
    ['음수 소수', '-3.2', '3.2', '3.2', '-3.2'],
    ['음수 백분율', '-3%', '3%', '3%', '-3%'],
    ['선행 소수점', '.5', '5', '5', '.5'],
    ['통화 기호', '$100', '100', '100', '$100'],
    ['양수 부호', '+3', '3', '3', '+3'],
    ['원화 기호', '₩100', '100', '100', '₩100'],
    ['유로 기호', '€100', '100', '100', '€100'],
    ['파운드 기호', '£100', '100', '100', '£100'],
  ])(
    '%s 표기가 바뀌면 값 변경으로 롤백한다',
    (_, original, rewritten, injected, lost) => {
      const violations = findPreservationViolations(original, rewritten);

      expect(violations).toEqual(
        expect.arrayContaining([
          { kind: 'number', token: injected, direction: 'injected' },
          { kind: 'number', token: lost, direction: 'lost' },
        ]),
      );
      expect(violations).toHaveLength(2);
      expect(shouldRollbackField(violations)).toBe(true);
    },
  );

  it('날짜 하이픈은 음수 부호로 해석하지 않고 동일하면 통과한다', () => {
    const violations = findPreservationViolations(
      '기준일은 2026-08-25입니다.',
      '기준일은 2026-08-25입니다.',
    );

    expect(violations).toEqual([]);
    expect(shouldRollbackField(violations)).toBe(false);
  });

  it('날짜 일부가 바뀌면 날짜 토큰으로 진단한다', () => {
    const violations = findPreservationViolations(
      '기준일은 2026-08-25입니다.',
      '기준일은 2026-09-25입니다.',
      'personal-blog',
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        { kind: 'date', token: '2026-09-25', direction: 'injected' },
        { kind: 'date', token: '2026-08-25', direction: 'lost' },
      ]),
    );
    expect(violations).toHaveLength(2);
  });

  it('음수 소수가 그대로면 같은 숫자 토큰으로 보고 통과한다', () => {
    const violations = findPreservationViolations('변동률 -3.2', '변동률 -3.2');

    expect(violations).toEqual([]);
    expect(shouldRollbackField(violations)).toBe(false);
  });

  it('균형 잡힌 URL 끝 괄호가 삭제되면 URL 훼손으로 롤백한다', () => {
    const original =
      'https://en.wikipedia.org/wiki/Ruby_(programming_language)';
    const rewritten =
      'https://en.wikipedia.org/wiki/Ruby_(programming_language';
    const violations = findPreservationViolations(original, rewritten);

    expect(violations).toEqual(
      expect.arrayContaining([
        { kind: 'url', token: rewritten, direction: 'injected' },
        { kind: 'url', token: original, direction: 'lost' },
      ]),
    );
    expect(violations).toHaveLength(2);
    expect(shouldRollbackField(violations)).toBe(true);
  });

  it('URL을 감싼 문장 괄호가 제거되어도 같은 URL로 보고 통과한다', () => {
    const violations = findPreservationViolations(
      '(https://a.io/b)',
      'https://a.io/b',
    );

    expect(violations).toEqual([]);
    expect(shouldRollbackField(violations)).toBe(false);
  });
});

// 실측 회귀: 같은 문단이 3회 재실행 내내 윤문되지 못했다. 윤문이 조사만 바꿨는데 그 조사가
// URL 토큰에 붙어 있어 "주소가 바뀌었다" 로 잡히고, 보존 검사가 문단을 통째로 되돌렸다.
describe('마크다운 링크 뒤 조사', () => {
  const 원문 =
    '[Osmani](https://addyosmani.com/blog/loop-engineering/)가 이렇게 정리했다.';
  const 윤문본 =
    '[Osmani](https://addyosmani.com/blog/loop-engineering/)는 이렇게 정리했어요.';

  it('조사만 바뀐 문장을 주소 변경으로 보지 않는다', () => {
    expect(findPreservationViolations(원문, 윤문본)).toEqual([]);
  });

  // 조사를 떼느라 주소 자체의 변경까지 놓치면 안 된다.
  it('주소가 실제로 바뀌면 여전히 잡는다', () => {
    const 바뀐본 =
      '[Osmani](https://example.com/blog/loop-engineering/)는 이렇게 정리했어요.';
    const violations = findPreservationViolations(원문, 바뀐본);
    expect(violations.some((item) => item.direction === 'lost')).toBe(true);
    expect(violations.some((item) => item.direction === 'injected')).toBe(true);
  });
});

// 경계를 조사가 아니라 괄호로 잡는 이유. 한글을 URL 문자에서 제외하면 조사 문제는 사라지지만
// **한글 경로의 변조가 통째로 안 보인다** — 양쪽 모두 첫 한글 앞에서 잘려 같은 토큰이 된다.
// 리뷰가 지적한 회귀이고, 여기서 실제로 잡히는지 못 박는다.
describe('퍼센트 인코딩되지 않은 한글 주소', () => {
  it('한글 경로가 바뀌면 잡는다', () => {
    const violations = findPreservationViolations(
      '자세한 내용은 https://example.com/문서 를 봤다.',
      '자세한 내용은 https://example.com/문건 를 봤다.',
    );
    expect(violations).toContainEqual({
      kind: 'url',
      token: 'https://example.com/문서',
      direction: 'lost',
    });
    expect(violations).toContainEqual({
      kind: 'url',
      token: 'https://example.com/문건',
      direction: 'injected',
    });
  });

  it('한글 경로가 그대로면 문장이 바뀌어도 통과한다', () => {
    expect(
      findPreservationViolations(
        '자세한 내용은 https://example.com/문서 를 봤다.',
        '자세한 내용은 https://example.com/문서 를 봤어요.',
      ),
    ).toEqual([]);
  });

  // 주소 안에 정상적으로 짝이 맞는 괄호가 있으면 끊지 않는다 (위키 등).
  it('짝이 맞는 괄호는 주소의 일부로 남긴다', () => {
    const violations = findPreservationViolations(
      '[문서](https://ko.wikipedia.org/wiki/노드_(자료구조))를 봤다.',
      '[문서](https://ko.wikipedia.org/wiki/노드_(자료구조))를 봤어요.',
    );
    expect(violations).toEqual([]);
  });
});
