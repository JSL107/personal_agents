import {
  extractProseSentences,
  findKoreanStyleGaps,
  formatKoreanStyleMetrics,
  KOREAN_STYLE_TARGETS,
  KoreanStyleMetrics,
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

  // 「최장 91자」만 보면 만연체인지 영문 이름 나열인지 갈리지 않는다. 둘은 처방이 정반대다
  // — 만연체는 끊어야 하고, 나열은 끊을 수 없다(고유명사 불변이 절대 규칙이다).
  it('최장 문장이 상한을 넘으면 그 문장을 함께 돌려준다', () => {
    const metrics = measureKoreanStyle(`짧다. ${'가'.repeat(120)}입니다.`);

    expect(metrics.longestSentence).toBe(`${'가'.repeat(120)}입니다.`);
    expect(formatKoreanStyleMetrics(metrics)).toContain('최장 문장(124자):');
  });

  it('최장 문장이 상한 이하면 문장을 덧붙이지 않는다', () => {
    const metrics = measureKoreanStyle('짧습니다. 이것도 짧아요.');

    expect(formatKoreanStyleMetrics(metrics)).not.toContain('최장 문장(');
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
  // run #980 `2026-08-20-agent-security-permission-boundaries` 의 첫 문단(5문장)에 같은 글의
  // 톤으로 한 문장을 더해 6문장으로 만든 것이다. 벽 기준을 6문장으로 올린 뒤로 5문장은 벽이
  // 아니라, 원문 그대로는 이 테스트가 재려는 "문서 평균은 통과하는데 문단 하나가 벽" 상태를
  // 만들지 못한다. 문서 지표 네 항목이 모두 통과한 글이라는 점은 그대로다.
  const 벽문단 =
    '협업 메신저 봇이 외부 콘텐츠를 읽고 비공개 데이터에 접근해 직접 행동하기 시작하면 이야기가 달라집니다. prompt injection은 단순한 오답이 아닙니다. 권한 오남용과 정보 유출의 문제가 되죠. 에이전트 보안의 핵심은 모델이 절대 속지 않게 하는 데 있지 않습니다. 속더라도 넘지 못할 권한 경계를 만드는 데 있습니다. 그 경계를 어디에 그을지가 설계의 몫입니다.';

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
  it('정확히 6문장이면 벽, 5문장이면 벽이 아니다', () => {
    // 재는 것은 문장 수 축이다. 길이(250자)로 먼저 걸리면 경계가 검증되지 않으므로
    // 여섯 문장을 이어도 250자를 넘지 않는 짧은 문장을 쓴다. 길이 축은 아래 두 테스트가 맡는다.
    const 문장 = '짧게 씁니다.';
    const 다섯문장 = Array.from({ length: 5 }, () => 문장).join(' ');
    const 여섯문장 = Array.from({ length: 6 }, () => 문장).join(' ');

    expect(여섯문장.length).toBeLessThanOrEqual(250);
    expect(measureKoreanStyle(다섯문장).paragraph.wallPercent).toBe(0);
    expect(measureKoreanStyle(여섯문장).paragraph.wallPercent).toBe(100);
  });

  it('길이 임계는 250자 초과부터다', () => {
    // 문단 길이는 공백을 포함해 센다. 문장 수로 걸리지 않도록 한 문장으로 만든다.
    const 딱250 = `${'가'.repeat(249)}.`;
    const 딱251 = `${'가'.repeat(250)}.`;

    expect(딱250.length).toBe(250);
    expect(measureKoreanStyle(딱250).paragraph.wallPercent).toBe(0);
    expect(딱251.length).toBe(251);
    expect(measureKoreanStyle(딱251).paragraph.wallPercent).toBe(100);
  });

  // 벽 비율을 저장 시점에 반올림하면 문단이 많은 글에서 남은 벽이 0% 로 사라진다.
  it('문단이 많아도 벽 한 개가 0%로 뭉개지지 않는다', () => {
    const 짧은문단 = '짧다. 이유는 뒤에 붙입니다.';
    const 벽 = `${'가'.repeat(260)}.`;
    const 글 = [...Array.from({ length: 24 }, () => 짧은문단), 벽].join('\n\n');

    const metrics = measureKoreanStyle(글);

    expect(metrics.paragraph.paragraphCount).toBe(25);
    expect(metrics.paragraph.wallPercent).toBe(4);
    expect(formatKoreanStyleMetrics(metrics)).toContain('벽 4%');
  });

  it('250자를 넘으면 문장 수가 적어도 벽으로 센다', () => {
    expect(
      measureKoreanStyle(`짧다. ${'가'.repeat(260)}입니다.`).paragraph
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

  // 6문장과 9문장을 한 칸에 묶으면 이 축이 벽 축과 같아진다. 크기별로 세는지 고정한다.
  it('큰 문단끼리도 크기가 다르면 같은 크기로 세지 않는다', () => {
    const paragraphs = [
      '가 하나입니다. 둘입니다. 셋입니다. 넷입니다. 다섯입니다. 여섯입니다.',
      '나 하나입니다. 둘입니다. 셋입니다. 넷입니다. 다섯입니다. 여섯입니다. 일곱입니다.',
    ].join('\n\n');

    const metrics = measureKoreanStyle(paragraphs);

    // 둘 다 벽(6문장 이상)이지만 크기가 6·7로 달라 같은크기는 50% 다.
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
  // 비율과 배치는 다른 축이다. 요체 비율이 같은데 배치만 다른 두 입력으로 확인한다 — 이 대조군이
  // 없으면 「한쪽으로 몰리지 않게」 지시가 만든 문장 단위 지그재그를 지표가 그대로 통과시킨다
  // (실측: 발행본 세 편이 교대율 73~88% 인데 요체 비율만 보면 문제로 보이지 않았다).
  it('종결체 비율이 같아도 문장마다 갈아타면 교대율로 갈린다', () => {
    const zigzag = measureKoreanStyle(
      '캐시는 재사용 시간을 정해요. 그 시간이 지나면 다시 묻습니다. 본문은 저장한 것을 그대로 써요. 네트워크 비용은 줄어듭니다.',
    );
    const grouped = measureKoreanStyle(
      '캐시는 재사용 시간을 정해요. 그 시간이 지나면 다시 물어요. 본문은 저장한 것을 그대로 씁니다. 네트워크 비용은 줄어듭니다.',
    );

    expect(zigzag.yoEndingPercent).toBe(50);
    expect(grouped.yoEndingPercent).toBe(50);
    expect(zigzag.endingAlternationPercent).toBe(100);
    expect(grouped.endingAlternationPercent).toBe(33);
    expect(formatKoreanStyleMetrics(zigzag)).toContain('종결체교대 100%');
  });

  // 분류되지 않는 문장을 분모에 넣으면 그 문장 하나가 인접 쌍을 둘로 쪼개 교대가 실제보다
  // 심하게 보인다. 같은 종결체 두 문장 사이에 명사 종결 문장을 끼워 0% 인지 확인한다.
  it('종결체로 분류되지 않는 문장은 인접 쌍에서 빠진다', () => {
    const metrics = measureKoreanStyle(
      '캐시는 재사용 시간을 정해요. 핵심은 재검증. 본문은 저장한 것을 그대로 써요.',
    );

    expect(metrics.sentenceCount).toBe(3);
    expect(metrics.endingAlternationPercent).toBe(0);
  });

  it('종결체 문장이 하나뿐이면 교대율은 0 이다', () => {
    expect(
      measureKoreanStyle('캐시는 재사용 시간을 정해요.')
        .endingAlternationPercent,
    ).toBe(0);
  });
});

describe('줄표(—) 세기', () => {
  // 갭 판정에 넘길 최소 픽스처. 다른 축은 전부 목표 안이라 줄표만 판정에 영향을 준다.
  const BASE_FOR_DASH: KoreanStyleMetrics = {
    sentenceCount: 100,
    averageLength: 40,
    lengthStandardDeviation: 15,
    shortSentencePercent: 25,
    longestSentenceLength: 70,
    longestSentence: '이 문장은 상한 안에 든다.',
    colloquialEndingPercent: 15,
    yoEndingPercent: 50,
    endingAlternationPercent: 30,
    bannedConnectiveCount: 0,
    emDashCount: 0,
    measurable: true,
    paragraph: {
      paragraphCount: 10,
      wallPercent: 10,
      noShortSentenceParagraphs: 0,
      dominantParagraphSizePercent: 40,
    },
  };

  // 스킬 룰북 J-3 은 "1문서 1~2회 이하" 인데 프롬프트에만 있고 세는 자리가 없어,
  // 발행본에 15개가 들어가고도 어떤 지표에도 안 걸렸다(2026-08-26). 세는 쪽을 고정한다.
  it('본문의 줄표를 센다', () => {
    const metrics = measureKoreanStyle(
      '첫 문장이에요 — 부연이고요.\n\n둘째 — 셋째 — 넷째.',
    );
    expect(metrics.emDashCount).toBe(3);
  });

  it('코드블록 안의 줄표는 세지 않는다', () => {
    const metrics = measureKoreanStyle(
      '본문이에요.\n\n```bash\necho "a — b — c"\n```\n\n끝이에요.',
    );
    expect(metrics.emDashCount).toBe(0);
  });

  // 자체 정규식(/```[\s\S]*?```/)은 세 개 백틱만 처리해 아래 세 형태를 놓쳤다. 공용
  // `maskFencedCodeBlocks` 로 넘긴 이유이자, 되돌아가면 깨지는 자리다(리뷰 P2).
  it('물결 펜스 안의 줄표도 세지 않는다', () => {
    const metrics = measureKoreanStyle(
      '본문이에요.\n\n~~~bash\necho "a — b"\n~~~\n\n끝이에요.',
    );
    expect(metrics.emDashCount).toBe(0);
  });

  it('네 개 백틱으로 연 블록은 안쪽 세 개에서 닫히지 않는다', () => {
    const metrics = measureKoreanStyle(
      '본문이에요.\n\n````md\n```\na — b\n```\n````\n\n끝이에요.',
    );
    expect(metrics.emDashCount).toBe(0);
  });

  it('닫히지 않은 펜스 안의 줄표도 세지 않는다', () => {
    const metrics = measureKoreanStyle('본문이에요.\n\n```bash\necho "a — b"');
    expect(metrics.emDashCount).toBe(0);
  });

  // 코드만 빼야 한다. `keep` 블록 전체(헤딩·목록·인용·표)를 빼면 이번에 문제가 된 자리가
  // 통째로 사라진다 — 발행본에서 빠져나간 15개 중 12개가 헤딩과 목록 머리말이었다.
  it('헤딩과 목록 머리말의 줄표를 센다', () => {
    const metrics = measureKoreanStyle(
      '## 채점관 — /goal\n\n본문이에요.\n\n- **채점관** — 조건을 확인해요.\n- **알람** — 시간을 봐요.\n',
    );
    expect(metrics.emDashCount).toBe(3);
  });

  // 줄표는 문장 수와 무관한 문서 축이다. 문장 축 보류(40문장 미만)에 함께 묶여 있어서,
  // 짧은 글은 줄표가 몇 개든 카드에 안 찍혔다(리뷰 P2).
  it('40문장 미만이라 문장 축이 보류돼도 줄표는 판정한다', () => {
    const gaps = findKoreanStyleGaps({
      ...BASE_FOR_DASH,
      sentenceCount: 12,
      measurable: false,
      // 문장 축 값은 전부 목표 밖이지만 보류라 잡히지 않아야 한다.
      lengthStandardDeviation: 1,
      shortSentencePercent: 0,
      emDashCount: 9,
    });
    expect(gaps).toEqual(['줄표 9회(≤2회)']);
  });

  it('보류된 글에 위반이 없으면 판정 줄을 만들지 않는다', () => {
    const gaps = findKoreanStyleGaps({
      ...BASE_FOR_DASH,
      sentenceCount: 12,
      measurable: false,
      lengthStandardDeviation: 1,
      emDashCount: 1,
    });
    expect(gaps).toEqual([]);
  });

  it('상한을 넘기면 목표 밖으로 잡는다', () => {
    const gaps = findKoreanStyleGaps({
      ...BASE_FOR_DASH,
      emDashCount: 15,
    });
    expect(gaps.some((gap) => gap.startsWith('줄표'))).toBe(true);
  });

  it('두 번까지는 통과한다', () => {
    const gaps = findKoreanStyleGaps({ ...BASE_FOR_DASH, emDashCount: 2 });
    expect(gaps.some((gap) => gap.startsWith('줄표'))).toBe(false);
  });
});

describe('재현 목표 판정', () => {
  // 타입을 그대로 받는다 — `as unknown as` 로 캐스팅하면 지표에 필드가 늘어도 컴파일러가
  // 잡아 주지 못해, 손으로 조립한 이 픽스처만 옛 형태로 남아 런타임에 터진다(실제로 겪었다).
  const base: KoreanStyleMetrics = {
    sentenceCount: 100,
    averageLength: 40,
    lengthStandardDeviation: 15,
    shortSentencePercent: 25,
    longestSentenceLength: 70,
    longestSentence: '이 문장은 상한 안에 든다.',
    colloquialEndingPercent: 15,
    yoEndingPercent: 50,
    endingAlternationPercent: 30,
    bannedConnectiveCount: 0,
    emDashCount: 0,
    measurable: true,
    paragraph: {
      paragraphCount: 20,
      wallPercent: 10,
      dominantParagraphSizePercent: 50,
      noShortSentenceParagraphs: 2,
    },
  };

  it('목표 안이면 지적할 것이 없다', () => {
    expect(findKoreanStyleGaps(base)).toEqual([]);
  });

  it('초장문 하나는 여전히 잡는다', () => {
    // 편차가 판정에서 내려가며 AND 짝은 사라졌다. 최장은 상한이라 홀로 남아도 의심 표본의
    // 리듬을 재현시키지 않는다 — 지금 이 축이 막는 것은 읽기 어려운 만연체뿐이다.
    const gaps = findKoreanStyleGaps({ ...base, longestSentenceLength: 159 });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('최장 159자');
  });

  it('출처가 의심되는 세 축(편차·짧은문장·구어)은 판정하지 않는다', () => {
    // 프로파일 §1 표본이 사용자 글이 아닐 가능성이 크다(파일 헤더 대조표). 판정하면 그
    // 미달이 되먹임을 타고 프롬프트로 들어가, 의심 표본의 리듬을 재현하라고 되먹인다.
    //
    // 본인 확인 글과 **정반대 방향**인 값으로 검사한다 — 옛 기준이 살아 있으면 셋 다 잡힌다.
    expect(
      findKoreanStyleGaps({
        ...base,
        lengthStandardDeviation: 3,
        shortSentencePercent: 6,
        colloquialEndingPercent: 33,
      }),
    ).toEqual([]);
    // 상한 쪽도 마찬가지다 — 구어는 하한만이 아니라 판정 자체가 없다.
    expect(
      findKoreanStyleGaps({ ...base, colloquialEndingPercent: 0 }),
    ).toEqual([]);
  });

  it('내린 축의 임계값은 코드에도 남기지 않는다', () => {
    // 값만 남겨 두면 다음 사람이 판정을 되살릴 때 근거 없는 숫자를 그대로 쓴다.
    // 되살리려면 헤더의 갱신 절차(본인 글 40문장 이상)를 먼저 밟아야 한다.
    for (const key of [
      'lengthStandardDeviationMin',
      'shortSentencePercentMin',
      'colloquialEndingPercentMin',
      'colloquialEndingPercentMax',
    ]) {
      expect(KOREAN_STYLE_TARGETS).not.toHaveProperty(key);
    }
  });

  it('내린 축은 카드의 판정 밖 목록에 이름이 실린다', () => {
    // 수치는 계속 보여준다. 「충족」이 편차까지 통과한 뜻으로 읽히면 안 된다.
    const line = formatKoreanStyleMetrics(base);
    expect(line).toContain('편차');
    expect(line).toContain('판정 대상 충족');
    for (const axis of ['편차', '짧은문장', '구어']) {
      expect(line).toContain(axis);
    }
  });

  it('40문장 미만이면 판정하지 않는다', () => {
    // 문장 하나가 비율을 10%p 씩 흔들어 판정이 무의미하다.
    expect(
      findKoreanStyleGaps({
        ...base,
        measurable: false,
        longestSentenceLength: 200,
      }),
    ).toEqual([]);
  });

  it('카드에 판정 결과가 함께 실린다', () => {
    expect(formatKoreanStyleMetrics(base)).toContain('판정 대상 충족');
    expect(
      formatKoreanStyleMetrics({ ...base, longestSentenceLength: 120 }),
    ).toContain('목표 밖: 최장 120자(≤80)');
  });

  it.each([
    ['금지접속사', { bannedConnectiveCount: 3 }, '금지접속사 3회(0회)'],
    ['종결체교대', { endingAlternationPercent: 85 }, '종결체교대 85%(≤60%)'],
  ])('%s 분기도 기준을 넘으면 잡는다', (_name, patch, expected) => {
    // 분기마다 테스트가 없으면 비교 방향(< vs >)이 뒤집혀도 초록이 유지된다.
    const gaps = findKoreanStyleGaps({ ...base, ...patch });
    expect(gaps).toContain(expected);
  });

  it.each([
    ['최장 상한 경계', { longestSentenceLength: 80 }],
    ['교대율 상한 경계', { endingAlternationPercent: 60 }],
  ])('%s 값은 통과다(경계 포함)', (_name, patch) => {
    expect(findKoreanStyleGaps({ ...base, ...patch })).toEqual([]);
  });

  it('요체 비율은 판정하지 않는다', () => {
    // 프로파일의 "반반" 은 2026-08-24 에 재현 대상에서 내려갔다. 지금 지시는 해요체가
    // 기본이라, 낡은 40~60% 로 재면 지시를 잘 따른 글이 목표 밖으로 찍힌다.
    expect(findKoreanStyleGaps({ ...base, yoEndingPercent: 5 })).toEqual([]);
    expect(findKoreanStyleGaps({ ...base, yoEndingPercent: 95 })).toEqual([]);
    expect(KOREAN_STYLE_TARGETS).not.toHaveProperty('yoEndingPercentMin');
  });

  it('판정 밖 축이 있음을 카드가 밝힌다', () => {
    // "목표 충족" 이라고만 쓰면 요체·문단까지 통과한 것으로 읽힌다.
    const line = formatKoreanStyleMetrics(base);
    expect(line).toContain('판정 대상 충족');
    expect(line).toContain('요체 비율');
  });

  it('문단 축은 판정하지 않는다', () => {
    // 프로파일 실측에 대응 항목이 없어 기준을 지어내야 한다 — 수치만 보여준다.
    const wall = findKoreanStyleGaps({
      ...base,
      paragraph: { ...base.paragraph, wallPercent: 90 },
    });
    expect(wall).toEqual([]);
    expect(KOREAN_STYLE_TARGETS).not.toHaveProperty('wallPercentMax');
  });
});

describe('금지접속사 "즉" 탐지', () => {
  const build = (sentence: string): string =>
    Array.from({ length: 45 }, (_, i) =>
      i === 0 ? sentence : `문장 ${i} 입니다.`,
    ).join('\n\n');

  it.each([
    '즉, 이 방식은 빠릅니다.',
    '즉 이 방식은 빠릅니다.',
    '즉. 다음은 이렇습니다.',
  ])('구두점과 무관하게 센다: %s', (sentence) => {
    // 쉼표를 붙여 '즉시' 오탐을 피했더니 쉼표 없는 접속 용법을 통째로 놓쳤다.
    expect(
      measureKoreanStyle(build(sentence)).bannedConnectiveCount,
    ).toBeGreaterThan(0);
  });

  it.each(['즉시 반영됩니다.', '즉각 처리했습니다.'])(
    '접속사가 아닌 낱말은 세지 않는다: %s',
    (sentence) => {
      expect(measureKoreanStyle(build(sentence)).bannedConnectiveCount).toBe(0);
    },
  );
});
