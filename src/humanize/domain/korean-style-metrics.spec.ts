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
    expect(metrics.colloquialEndingPercent).toBeGreaterThan(0);
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

    expect(metrics.colloquialEndingPercent).toBe(0);
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

describe('measureKoreanStyle — 종결체 축', () => {
  it('`~요` 와 `~습니다` 의 비율을 잰다', () => {
    const metrics = measureKoreanStyle(
      '이건 그렇습니다. 저건 이래요. 그건 저렇습니다. 요건 그래요.',
    );

    expect(metrics.yoEndingPercent).toBe(50);
  });

  // 발행본 2026-08-19-http-cache 재현: 구어 어미는 적지만 해요체로 쓴 글이다.
  // 축이 하나면 "구어 6%" 만 보여 딱딱한 글로 오독된다.
  it('구어 어미가 없어도 해요체는 요체 비율로 드러난다', () => {
    const metrics = measureKoreanStyle(
      '브라우저는 그대로 써도 된다고 봐요. 본문을 다시 안 보내게 만드는 기술에 가까워요. 약속을 하는 셈이에요.',
    );

    expect(metrics.colloquialEndingPercent).toBe(0);
    expect(metrics.yoEndingPercent).toBe(100);
  });

  it('명사 종결·목록은 분모에서 뺀다', () => {
    // 종결체가 아닌 문장이 분모에 들어가면 불릿 많은 글의 축이 통째로 내려간다.
    const metrics = measureKoreanStyle(
      ['- Cache-Control: 재사용 시간', '', '이렇게 씁니다. 저렇게 써요.'].join(
        '\n',
      ),
    );

    expect(metrics.yoEndingPercent).toBe(50);
  });

  // 합쇼체는 자음 뒤 `-습니다` / 모음 뒤 `-ㅂ니다` 로 갈린다. 어미를 열거하면 후자가 빠져
  // 합쇼체가 0 으로 세어지고, 딱딱한 글이 "요체 100%" 로 뒤집힌다.
  // `~죠` 는 `~지요` 의 축약이라 해요체인데 글자로는 `요` 로 끝나지 않는다. 빼놓으면 문단을
  // `~죠` 로 맺는 글이 "요체 6%" 로 찍혀 딱딱한 글로 오독된다(실측으로 걸렸다).
  it('`~죠` 도 요체로 센다', () => {
    const metrics = measureKoreanStyle(
      '이건 그렇습니다. 저건 그렇죠. 그건 이렇습니다. 요건 이렇죠.',
    );

    expect(metrics.yoEndingPercent).toBe(50);
  });

  it('`~죠` 로만 맺는 글은 요체 100%다', () => {
    const metrics = measureKoreanStyle('그렇죠. 이렇죠. 저렇죠.');

    expect(metrics.yoEndingPercent).toBe(100);
  });

  it('`-ㅂ니다` 활용형도 합쇼체로 센다', () => {
    const metrics = measureKoreanStyle('갑니다. 봅니다. 줍니다. 씁니다.');

    expect(metrics.yoEndingPercent).toBe(0);
  });

  // 마침표 뒤에 인용·강조가 오는 문장은 실제 본문에 흔하다. 닫는 문자를 안 보면 두 곳이 함께
  // 어긋난다 — 문장이 하나로 합쳐지고, 종결 어미도 그 문자에 막혀 누락된다(요체 50% → 0%).
  it.each([
    ['스마트 인용부호', '“이렇게 해요.” 다음에는 갑니다.'],
    ['마크다운 강조', '**이렇게 해요.** 다음에는 갑니다.'],
    ['한글 인용부호', '「이렇게 해요.」 다음에는 갑니다.'],
    ['괄호', '(이렇게 해요.) 다음에는 갑니다.'],
  ])('%s 로 끝나는 문장도 분리하고 종결 어미를 센다', (_label, text) => {
    const metrics = measureKoreanStyle(text);

    expect(metrics.sentenceCount).toBe(2);
    expect(metrics.yoEndingPercent).toBe(50);
  });

  it('닫는 문자 뒤의 구어 어미도 센다', () => {
    const metrics = measureKoreanStyle(
      '“그래서 이렇게 했거든요.” 그러고는 갑니다.',
    );

    expect(metrics.colloquialEndingPercent).toBe(50);
  });

  it('종결체가 하나도 없으면 0이다', () => {
    expect(measureKoreanStyle('- 항목 하나\n- 항목 둘').yoEndingPercent).toBe(
      0,
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
    expect(metrics.shortSentencePercent).toBeGreaterThanOrEqual(20);
    // 문단 축이 있어야 둘째 문단이 벽이라는 게 드러난다.
    expect(metrics.paragraph.paragraphCount).toBe(2);
    expect(metrics.paragraph.wallPercent).toBe(50);
  });

  it('빈 줄로 나누면 같은 글이 벽에서 벗어난다', () => {
    const 나눈글 = 벽문단
      .replace('달라집니다. ', '달라집니다.\n\n')
      .replace('되죠. ', '되죠.\n\n');

    expect(measureKoreanStyle(나눈글).paragraph.wallPercent).toBe(0);
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

    expect(measureKoreanStyle(세문장).paragraph.wallPercent).toBe(0);
    expect(measureKoreanStyle(네문장).paragraph.wallPercent).toBe(100);
  });

  it('길이 임계는 150자 초과부터다', () => {
    // 문단 길이는 공백을 포함해 센다. 문장 수로 걸리지 않도록 한 문장으로 만든다.
    const 딱150 = `${'가'.repeat(149)}.`;
    const 딱151 = `${'가'.repeat(150)}.`;

    expect(딱150.length).toBe(150);
    expect(measureKoreanStyle(딱150).paragraph.wallPercent).toBe(0);
    expect(딱151.length).toBe(151);
    expect(measureKoreanStyle(딱151).paragraph.wallPercent).toBe(100);
  });

  // 벽 비율을 저장 시점에 반올림하면 문단이 많은 글에서 남은 벽이 0% 로 사라진다.
  it('문단이 많아도 벽 한 개가 0%로 뭉개지지 않는다', () => {
    const 짧은문단 = '짧다. 이유는 뒤에 붙입니다.';
    const 벽 = `${'가'.repeat(160)}.`;
    const 글 = [...Array.from({ length: 24 }, () => 짧은문단), 벽].join('\n\n');

    const metrics = measureKoreanStyle(글);

    expect(metrics.paragraph.paragraphCount).toBe(25);
    expect(metrics.paragraph.wallPercent).toBe(4);
    expect(formatKoreanStyleMetrics(metrics)).toContain('벽 4%');
  });

  it('150자를 넘으면 문장 수가 적어도 벽으로 센다', () => {
    expect(
      measureKoreanStyle(`짧다. ${'가'.repeat(160)}입니다.`).paragraph
        .wallPercent,
    ).toBe(100);
  });

  // 벽 축의 반대쪽 실패. 발행본 43개 문단이 전부 2~3문장이었는데 wallPercent 는 19% 로
  // 낮게 찍혀 "문단은 괜찮다" 로 읽혔다. 균일함을 세는 축이 따로 있어야 드러난다.
  it('문단 크기가 한 값으로 몰리면 같은크기 비율이 높다', () => {
    const grid = [
      '캐시는 약속입니다. 만료가 지나면 다시 묻습니다.',
      '서버는 판단합니다. 바뀌지 않았다면 304 입니다.',
      '본문은 생략됩니다. 비용이 줄어듭니다.',
      '정리하면 두 축입니다. 시간과 확인입니다.',
    ].join('\n\n');

    const metrics = measureKoreanStyle(grid);

    expect(metrics.paragraph.paragraphCount).toBe(4);
    // 네 문단 전부 2문장 — 벽은 0% 인데도 이 축이 문제를 드러낸다.
    expect(metrics.paragraph.dominantParagraphSizePercent).toBe(100);
    expect(metrics.paragraph.wallPercent).toBe(0);
  });

  it('문단 크기가 섞이면 같은크기 비율이 내려간다', () => {
    const mixed = [
      '캐시는 약속입니다.',
      '만료가 지나면 다시 묻습니다. 서버는 판단합니다.',
      '바뀌지 않았다면 304 입니다. 본문은 생략됩니다. 비용이 줄어듭니다.',
      '정리하면 두 축입니다. 시간과 확인이죠. 앞은 재사용 기간입니다. 뒤는 확인 절차입니다.',
    ].join('\n\n');

    const metrics = measureKoreanStyle(mixed);

    expect(metrics.paragraph.paragraphCount).toBe(4);
    // 1·2·3·4문장이 하나씩 — 최빈값이 1개뿐이라 25% 다.
    expect(metrics.paragraph.dominantParagraphSizePercent).toBe(25);
  });

  // 4문장과 9문장을 한 칸에 묶으면 이 축이 벽 축과 같아진다. 크기별로 세는지 고정한다.
  it('큰 문단끼리도 크기가 다르면 같은 크기로 세지 않는다', () => {
    const paragraphs = [
      '가 문장 하나입니다. 두 번째입니다. 세 번째입니다. 네 번째입니다.',
      '나 문장 하나입니다. 두 번째입니다. 세 번째입니다. 네 번째입니다. 다섯 번째입니다.',
    ].join('\n\n');

    const metrics = measureKoreanStyle(paragraphs);

    // 둘 다 벽(4문장 이상)이지만 크기가 4·5로 달라 같은크기는 50% 다.
    expect(metrics.paragraph.wallPercent).toBe(100);
    expect(metrics.paragraph.dominantParagraphSizePercent).toBe(50);
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

  // 실제 발행본(142문장 중 구어 6개 = 4%)이 카드에 '구어 0%' 로 찍혀 "말투가 전혀 안 먹었다"
  // 로 읽혔다. 소수 1자리 반올림이 0~5% 를 전부 0 으로 만들었기 때문이다.
  it('구어 어미가 5% 미만이어도 0% 로 뭉개지지 않는다', () => {
    const sentences: string[] = [];
    for (let index = 0; index < 24; index += 1) {
      sentences.push('캐시는 응답을 다시 쓰기 위한 약속입니다.');
    }
    sentences.push('그건 재검증이거든요.');

    const metrics = measureKoreanStyle(sentences.join(' '));

    expect(metrics.sentenceCount).toBe(25);
    expect(metrics.colloquialEndingPercent).toBe(4);
    expect(formatKoreanStyleMetrics(metrics)).toContain('구어 4%');
  });
});
