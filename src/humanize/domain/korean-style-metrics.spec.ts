import {
  extractProseSentences,
  formatKoreanStyleMetrics,
  measureKoreanStyle,
} from './korean-style-metrics';

describe('extractProseSentences', () => {
  it('코드블록·표·헤딩은 문장으로 세지 않는다', () => {
    const markdown = [
      '## 헤딩은 제외',
      '',
      '첫 문장입니다. 둘째 문장이거든요.',
      '',
      '```ts',
      'const a = 1; const b = 2;',
      '```',
      '',
      '| 표 | 값 |',
    ].join('\n');

    expect(extractProseSentences(markdown)).toEqual([
      '첫 문장입니다.',
      '둘째 문장이거든요.',
    ]);
  });
});

describe('measureKoreanStyle', () => {
  it('사람 말투 표본은 편차가 크고 구어 어미가 섞인다', () => {
    const humanLike = [
      '캐시는 결국 약속입니다.',
      '짧게 갑니다.',
      '브라우저가 서버에 다시 물어보는 절차가 있는데, 이게 재검증이거든요.',
      '그래서 304가 옵니다.',
      '서버가 ETag를 붙여 보내면 브라우저는 다음 요청에 그 값을 실어 보내면서 바뀐 게 있는지 묻습니다.',
      '처음엔 저도 헷갈렸어요.',
    ].join(' ');

    const metrics = measureKoreanStyle(humanLike);

    expect(metrics.sentenceCount).toBe(6);
    expect(metrics.lengthStandardDeviation).toBeGreaterThan(11);
    expect(metrics.colloquialEndingRatio).toBeGreaterThan(0);
    expect(metrics.bannedConnectiveCount).toBe(0);
    // 40문장 미만은 정량 판정을 하지 않는다 — 문장 하나가 비율을 크게 흔든다.
    expect(metrics.measurable).toBe(false);
  });

  // 상한만 보면 이 대조군이 통과한다. 구어 어미 하한과 금지 접속사 카운트가 그것을 가른다.
  it('전형적 AI 문체 대조군은 구어 어미 0에 금지 접속사가 잡힌다', () => {
    const aiLike = [
      '본 문서는 캐시의 동작 방식을 설명하기 위한 것이다.',
      '또한 재검증 절차에 대해서도 함께 살펴볼 수 있다.',
      '따라서 성능 개선의 효과를 기대할 수 있을 것으로 보여진다.',
    ].join(' ');

    const metrics = measureKoreanStyle(aiLike);

    expect(metrics.colloquialEndingRatio).toBe(0);
    expect(metrics.bannedConnectiveCount).toBe(2);
  });

  it('만연체 한 문장은 최장 문장 길이로 드러난다', () => {
    const metrics = measureKoreanStyle(`짧다. ${'가'.repeat(120)}입니다.`);

    expect(metrics.longestSentenceLength).toBeGreaterThan(80);
  });

  it('산문이 없으면 측정 불가로 표시한다', () => {
    const metrics = measureKoreanStyle('```ts\nconst a = 1;\n```');

    expect(metrics.sentenceCount).toBe(0);
    expect(metrics.measurable).toBe(false);
    expect(formatKoreanStyleMetrics(metrics)).toBe(
      '문체 지표: 측정할 산문이 없음',
    );
  });
});

describe('formatKoreanStyleMetrics', () => {
  it('관측값임이 드러나게 한 줄로 적는다', () => {
    const line = formatKoreanStyleMetrics(
      measureKoreanStyle('짧다. 조금 더 긴 문장을 하나 넣습니다.'),
    );

    expect(line).toContain('문체 지표: 문장 2개');
    expect(line).toContain('편차');
    expect(line).toContain('40문장 미만이라 참고값');
  });
});
