import { composeExtraBody, splitExtraSections } from './saju-fortune-render';

describe('splitExtraSections', () => {
  it('구분줄로 나눈 구간 수가 맞으면 구간들을 돌려준다', () => {
    expect(
      splitExtraSections({
        text: '생일 글\n둘째 줄\n=====\n주간 글',
        expected: 2,
      }),
    ).toEqual(['생일 글\n둘째 줄', '주간 글']);
  });

  it('구간 수가 다르면 null', () => {
    expect(splitExtraSections({ text: '한 덩어리', expected: 2 })).toBeNull();
    expect(
      splitExtraSections({ text: '가\n=====\n나\n=====\n다', expected: 2 }),
    ).toBeNull();
  });

  it('앞뒤 공백과 빈 구간은 세지 않는다', () => {
    expect(
      splitExtraSections({ text: '\n=====\n가\n =====  \n나\n', expected: 2 }),
    ).toEqual(['가', '나']);
  });
});

describe('composeExtraBody', () => {
  const longSection = (label: string): string =>
    Array.from(
      { length: 20 },
      (_, index) => `${label} ${index} ${'가'.repeat(45)}`,
    ).join('\n');

  it('특집 셋 + 주간이 길어도 1,500 안에 코드 줄이 모두 남고 구간마다 첫 줄이 남는다', () => {
    const specialLines = [
      '🎂 생일 축하해, 길동!',
      '🧧 설날이야 — 새 한 해가 열리는 날',
      '🌱 오늘은 입춘 — 봄이 시작되는 날',
    ];
    const weeklyStarLine =
      '월 ★★★☆☆ · 화 ★★★★★ · 수 ★★★★☆ · 목 ★★☆☆☆ · 금 ★★★☆☆ · 토 ★★★☆☆ · 일 ★★★★☆';
    const body = composeExtraBody({
      sections: ['생일', '설날', '입춘', '주간'].map(longSection),
      specialLines,
      weeklyStarLine,
      maximum: 1_500,
    });

    expect(body.length).toBeLessThanOrEqual(1_500);
    [...specialLines, weeklyStarLine].forEach((line) =>
      expect(body).toContain(line),
    );
    ['생일 0', '설날 0', '입춘 0', '주간 0'].forEach((first) =>
      expect(body).toContain(first),
    );
  });

  it('구간마다 코드 줄을 앞에 두고, 특집 → 주간 순서다', () => {
    const body = composeExtraBody({
      sections: ['생일 글', '주간 글'],
      specialLines: ['🎂 생일 축하해, 길동!'],
      weeklyStarLine: '월 ★★★☆☆',
      maximum: 1_500,
    });

    expect(body).toBe('🎂 생일 축하해, 길동!\n생일 글\n\n월 ★★★☆☆\n주간 글');
  });

  it('AI 가 쓴 별·행운 줄은 지우되 코드가 그린 주간 별점 줄은 남긴다', () => {
    const body = composeExtraBody({
      sections: ['이번 주는 ★★★★★ 최고야\n행운의 숫자: 7\n천천히 가 보자'],
      specialLines: [],
      weeklyStarLine: '월 ★★★☆☆',
      maximum: 1_500,
    });

    expect(body).toBe('월 ★★★☆☆\n이번 주는 최고야\n천천히 가 보자');
    expect(body).not.toContain('🍀 행운 아이템');
  });

  it('구간 구분에 실패해 한 덩어리면 코드 줄을 모두 맨 앞에 모은다', () => {
    const body = composeExtraBody({
      sections: ['생일과 이번 주 이야기'],
      specialLines: ['🎂 생일 축하해, 길동!'],
      weeklyStarLine: '월 ★★★☆☆',
      maximum: 1_500,
    });

    expect(body).toBe(
      '🎂 생일 축하해, 길동!\n월 ★★★☆☆\n\n생일과 이번 주 이야기',
    );
  });
});

describe('composeExtraBody — 주간 항목 라벨', () => {
  it('주간 글의 항목 라벨을 굵게 한다', () => {
    const body = composeExtraBody({
      sections: [
        '이번 주는 차분해.\n총운: 월요일이 좋아.\n돈 : 화요일엔 아껴 봐.',
      ],
      specialLines: [],
      weeklyStarLine: '월 ★★★☆☆',
      maximum: 1_500,
    });

    expect(body).toBe(
      '월 ★★★☆☆\n이번 주는 차분해.\n*총운:* 월요일이 좋아.\n*돈:* 화요일엔 아껴 봐.',
    );
  });
});
