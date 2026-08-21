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

describe('measureKoreanStyle — 문단 축', () => {
  // run #980 `2026-08-20-agent-security-permission-boundaries` 의 첫 문단을 그대로 쓴다.
  // 문서 지표 네 항목이 모두 통과한 글인데도 이 문단은 5문장 벽이다.
  const 벽문단 =
    '협업 메신저 봇이 외부 콘텐츠를 읽고 비공개 데이터에 접근해 직접 행동하기 시작하면 이야기가 달라집니다. prompt injection은 단순한 오답이 아닙니다. 권한 오남용과 정보 유출의 문제가 되죠. 에이전트 보안의 핵심은 모델이 절대 속지 않게 하는 데 있지 않습니다. 속더라도 넘지 못할 권한 경계를 만드는 데 있습니다.';

  it('문서 평균이 통과해도 벽 문단을 드러낸다', () => {
    const metrics = measureKoreanStyle(
      ['짧다. 또 짧다.', '', 벽문단].join('\n'),
    );

    // 문장 축만 보면 짧은 문장이 절반이라 아무 문제가 없다.
    expect(metrics.shortSentenceRatio).toBeGreaterThanOrEqual(0.2);
    // 문단 축이 있어야 둘째 문단이 벽이라는 게 드러난다.
    expect(metrics.paragraph.paragraphCount).toBe(2);
    expect(metrics.paragraph.wallRatio).toBe(0.5);
  });

  it('빈 줄로 나누면 같은 글이 벽에서 벗어난다', () => {
    const 나눈글 = 벽문단
      .replace('달라집니다. ', '달라집니다.\n\n')
      .replace('되죠. ', '되죠.\n\n');

    expect(measureKoreanStyle(나눈글).paragraph.wallRatio).toBe(0);
    // 글자는 그대로다 — 빈 줄만 넣었을 뿐이라 문장 축 지표는 움직이지 않는다.
    expect(measureKoreanStyle(나눈글).sentenceCount).toBe(
      measureKoreanStyle(벽문단).sentenceCount,
    );
  });

  it('3문장 이상인데 짧은 문장이 없으면 호흡 없는 문단으로 센다', () => {
    const metrics = measureKoreanStyle(
      '이 문장은 스물다섯 자를 넘기도록 넉넉하게 늘여 쓴 문장입니다. 이 문장 역시 짧은 문장으로 세어지지 않도록 충분히 길게 늘여 두었습니다. 세 번째 문장도 같은 이유로 넉넉한 길이를 유지합니다.',
    );

    expect(metrics.paragraph.noShortSentenceParagraphs).toBe(1);
  });

  // J-5 처방을 따를수록 지표가 나빠지면 안 된다 — 2문장 문단은 세지 않는 이유다.
  it('2문장으로 나뉜 문단은 짧은 문장이 없어도 세지 않는다', () => {
    const metrics = measureKoreanStyle(
      '이 문장은 스물다섯 자를 넘기도록 넉넉하게 늘여 쓴 문장입니다. 이 문장 역시 짧은 문장으로 세어지지 않도록 충분히 길게 늘여 두었습니다.',
    );

    expect(metrics.paragraph.noShortSentenceParagraphs).toBe(0);
  });

  // 임계 경계 — 비교 연산자가 한 칸 밀리면 여기서 갈린다.
  it('정확히 4문장이면 벽, 3문장이면 벽이 아니다', () => {
    const 문장 = '이 문장은 서른 자를 넘지 않도록 적당한 길이로 씁니다.';
    const 세문장 = [문장, 문장, 문장].join(' ');
    const 네문장 = [문장, 문장, 문장, 문장].join(' ');

    expect(measureKoreanStyle(세문장).paragraph.wallRatio).toBe(0);
    expect(measureKoreanStyle(네문장).paragraph.wallRatio).toBe(1);
  });

  it('길이 임계는 150자 초과부터다', () => {
    // 문단 길이는 공백을 포함해 센다. 문장 수로 걸리지 않도록 한 문장으로 만든다.
    const 딱150 = `${'가'.repeat(149)}.`;
    const 딱151 = `${'가'.repeat(150)}.`;

    expect(딱150.length).toBe(150);
    expect(measureKoreanStyle(딱150).paragraph.wallRatio).toBe(0);
    expect(딱151.length).toBe(151);
    expect(measureKoreanStyle(딱151).paragraph.wallRatio).toBe(1);
  });

  // 벽 비율을 저장 시점에 반올림하면 문단이 많은 글에서 남은 벽이 0% 로 사라진다.
  it('문단이 많아도 벽 한 개가 0%로 뭉개지지 않는다', () => {
    const 짧은문단 = '짧다. 이유는 뒤에 붙입니다.';
    const 벽 = `${'가'.repeat(160)}.`;
    const 글 = [...Array.from({ length: 24 }, () => 짧은문단), 벽].join('\n\n');

    const metrics = measureKoreanStyle(글);

    expect(metrics.paragraph.paragraphCount).toBe(25);
    expect(metrics.paragraph.wallRatio).toBeCloseTo(0.04, 5);
    expect(formatKoreanStyleMetrics(metrics)).toContain('벽 4%');
  });

  it('150자를 넘으면 문장 수가 적어도 벽으로 센다', () => {
    expect(
      measureKoreanStyle(`짧다. ${'가'.repeat(160)}입니다.`).paragraph
        .wallRatio,
    ).toBe(1);
  });

  it('산문이 없으면 문단 수는 0이다', () => {
    expect(
      measureKoreanStyle('```ts\nconst a = 1;\n```').paragraph.paragraphCount,
    ).toBe(0);
  });
});

describe('formatKoreanStyleMetrics', () => {
  it('관측값임이 드러나게 한 줄로 적는다', () => {
    const line = formatKoreanStyleMetrics(
      measureKoreanStyle('짧다. 조금 더 긴 문장을 하나 넣습니다.'),
    );

    expect(line).toContain('문체 지표: 문장 2개');
    expect(line).toContain('편차');
    // 참고값 단서는 문장 축에만 붙는다 — 문단 줄까지 참고값으로 읽히면 안 된다.
    expect(line.split('\n')[0]).toContain('40문장 미만이라 참고값');
    expect(line.split('\n')[1]).toContain('문단');
  });
});
