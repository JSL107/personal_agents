// 글 몇 편을 코퍼스로 묶어 문체 지표를 재는 스크립트 — 개인 문체 프로파일을 갱신할 때 쓴다.
//
// 왜 humanize-markdown.ts 로 안 되는가 — 그쪽은 모델을 불러 윤문한 결과를 잰다. 여기서 재려는
// 것은 **사람이 쓴 원본**이라 윤문이 끼면 안 되고, 여러 편을 합쳐야 40문장 문턱을 넘긴다.
// 모델을 부르지 않으므로 Nest 부팅도 없다(측정은 순수 도메인 함수다).
//
// 사용법:
//   pnpm exec ts-node scripts/measure-style.ts <글.md> [글2.md ...] [--each]
//   pnpm exec ts-node scripts/measure-style.ts --selftest   # 분류표 자체 검사
//
// 기본은 **합산**이다. 입력을 한 편의 코퍼스로 이어 붙여 재고, 40문장을 못 넘기면
// `measurable: false` 라 판정 보류로 찍는다. --each 를 주면 편별 지표도 함께 낸다.
//
// 접속사는 도메인 지표(bannedConnectiveCount)가 **총합만** 주므로 여기서 낱말별로 따로 센다.
// 프로파일 §6 은 화이트리스트라 「무엇이 몇 번」이 있어야 갱신되는데 총합 하나로는 못 만든다.
// 허용 목록까지 세는 이유도 같다.
//
// 세는 단위는 **문장 수**다(한 문장에 두 번 나와도 1). 도메인 지표는 낱말 등장마다 세므로
// 두 숫자는 어긋날 수 있고, 어긋나는 것은 목적이 다르기 때문이지 어느 한쪽이 틀린 게 아니다.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import {
  extractProseSentences,
  formatKoreanStyleMetrics,
  measureKoreanStyle,
} from '../src/humanize/domain/korean-style-metrics';

// 종결 형태별 문장 수. 장르를 가르는 축이라 비율보다 먼저 본다 — 학습 정리는 하다체로만
// 끝나고 블로그 서술은 해요체로 끝나서, 이 표만 봐도 같은 축에 놓을 글인지 갈린다.
type EndingCounts = Map<string, number>;

type SampleReport = {
  label: string;
  markdown: string;
};

// 짧은 문장·편차·최장 문장은 자동 판정 기준이 아니라 코퍼스의 분포를 보기 위한 관측값이다.
const LONG_SENTENCE_MIN = 61;
// 문장 끝에 붙는 닫는 문자. `korean-style-metrics` 의 CLOSING_CHARS 를 **손으로 복사한 것**이다
// (export 되어 있지 않다). 그쪽이 바뀌면 여기도 같이 고쳐야 종결 판정이 갈리지 않는다.
const TRAILING_CLOSERS = /["'`)\]*_”’」』.!?。]+$/;

// 종결 형태 판정 순서가 곧 우선순위다. 구어 어미를 해요체보다 먼저 봐야 「거든요」가
// 「~요(기타)」로 흡수되지 않는다.
const ENDING_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['~니까요', /(니까요|니깐요)$/],
  ['~거든요', /거든요$/],
  ['~더라고요', /(더라고요|더라구요)$/],
  ['~잖아요', /잖아요$/],
  ['~네요', /네요$/],
  ['~죠', /(죠|지요)$/],
  ['~요 (해요체 기타)', /요$/],
  // 합쇼체는 활용형이 무한해(씁니다·갑니다·봅니다) 어미를 열거하면 통째로 빠진다 — `니다`
  // 로 본다. 다만 하다체 평서형 「아니다」가 같이 걸리므로 그것만 뺀다. 존댓말 글에서는
  // 안 나와 도메인 지표는 감수하지만, 이 스크립트는 하다체 글도 재므로 갈라야 한다.
  ['~습니다 (합쇼체)', /(?<!아)니다$/],
  ['~다 (하다체 평서)', /다$/],
];

// 프로파일 §6 의 두 목록.
//
// **문장 첫머리에 앵커하지 않는다.** 「뿐만 아니라」는 앞 명사에 붙어(「A뿐만 아니라 B도」)
// 문장 처음에 오는 일이 없어 앵커하면 언제나 0 이 나오고, 「또한」·「따라서」도 쉼표 뒤에
// 흔히 붙는다. 대신 앞뒤 경계를 요구해 「즉시」·「사실상」 같은 낱말을 걸러낸다.
const boundary = (word: string): RegExp =>
  new RegExp(`(^|[\\s,(「"'])${word}[\\s,]`);

const BANNED_CONNECTIVES: ReadonlyArray<readonly [string, RegExp]> = [
  ['또한', boundary('또한')],
  ['따라서', boundary('따라서')],
  ['게다가', boundary('게다가')],
  // 조사처럼 붙어 다녀 앞 경계를 요구할 수 없다. 다른 낱말에 섞일 여지도 없다.
  ['뿐만 아니라', /뿐만 아니라/],
  ['즉', boundary('즉')],
  ['한편', boundary('한편')],
  ['물론', boundary('물론')],
  ['아울러', boundary('아울러')],
  ['그러므로', boundary('그러므로')],
];
const ALLOWED_CONNECTIVES: ReadonlyArray<readonly [string, RegExp]> = [
  ['그래서', boundary('그래서')],
  ['다만', boundary('다만')],
  ['대신', boundary('대신')],
  ['예를 들어', /예를 들어/],
  ['근데', boundary('근데')],
  ['그럼', boundary('그럼')],
  ['참고로', boundary('참고로')],
  ['사실', boundary('사실')],
  ['그리고', boundary('그리고')],
  ['하지만', boundary('하지만')],
];

// 1인칭 표식. 「문제 」·「언제 」가 `제\s` 에 걸리는 오탐을 봤으므로 어절 경계를 요구한다.
//
// **「제일」은 세지 않는다.** 프로파일 §9 가 1인칭 예문으로 든 「제일 마음에 드는 건」에서
// 「제일」은 저+의가 아니라 최상급(=가장)이다. 낱말만 떼어 오면 「제일 중요한 부분」까지
// 1인칭으로 세어져 비율이 부풀려진다(PR #381 리뷰, 두 리뷰어 일치).
//
// 반말 1인칭(나·내)도 센다. 다만 **「나는」은 문장 첫머리에서만** 본다 — 「하늘을 나는 새」의
// 날다 활용형과 구분할 방법이 없어서, 흔한 쪽인 「나는 …」으로 문장을 여는 용법만 취한다.
// 「하나는」·「하나도」·「하나를」은 앞 경계 요구로 걸러진다.
const FIRST_PERSON =
  /(^|[\s(「"'])(제가|제[는를의]|제 [가-힣]|저는|저를|저도|저한테|내가|내 [가-힣]|나도|나를)|^나는[\s,]/;

const stripTail = (sentence: string): string =>
  sentence.replace(TRAILING_CLOSERS, '').trim();

const countEndings = (sentences: readonly string[]): EndingCounts => {
  const counts: EndingCounts = new Map();
  for (const sentence of sentences) {
    const stripped = stripTail(sentence);
    const matched = ENDING_RULES.find(([, pattern]) => pattern.test(stripped));
    const key = matched ? matched[0] : '조각·기타';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const countConnectives = (
  sentences: readonly string[],
  rules: ReadonlyArray<readonly [string, RegExp]>,
): EndingCounts => {
  const counts: EndingCounts = new Map();
  for (const [name, pattern] of rules) {
    const hits = sentences.filter((sentence) =>
      pattern.test(sentence.trim()),
    ).length;
    if (hits > 0) {
      counts.set(name, hits);
    }
  }
  return counts;
};

const percent = (count: number, total: number): string =>
  total === 0 ? '0%' : `${((count / total) * 100).toFixed(1)}%`;

const formatCounts = (counts: EndingCounts, total: number): string => {
  if (counts.size === 0) {
    return '  (없음)';
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(
      ([name, count]) =>
        `  ${name.padEnd(18)} ${String(count).padStart(3)}  ${percent(count, total)}`,
    )
    .join('\n');
};

const describe = (label: string, markdown: string): void => {
  const sentences = extractProseSentences(markdown);
  const metrics = measureKoreanStyle(markdown);
  if (sentences.length === 0) {
    console.log(
      `\n## ${label}\n  산문 문장이 없다 — 헤딩·불릿·코드만 있는 글이다.`,
    );
    return;
  }

  const lengths = sentences.map(
    (sentence) => sentence.replace(/\s/g, '').length,
  );
  const longCount = lengths.filter(
    (length) => length >= LONG_SENTENCE_MIN,
  ).length;
  const firstPersonCount = sentences.filter((sentence) =>
    FIRST_PERSON.test(sentence),
  ).length;

  const verdict = metrics.measurable
    ? '판정 가능'
    : `판정 보류 (40문장 미만 — ${40 - sentences.length}문장 부족)`;

  console.log(`\n## ${label}`);
  console.log(`상태    문장 ${sentences.length}개 · ${verdict}`);
  console.log(
    `리듬    평균 ${metrics.averageLength}자 · 편차 ${metrics.lengthStandardDeviation} · 최장 ${metrics.longestSentenceLength}자 · 20자↓ ${metrics.shortSentencePercent}% · 61자↑ ${percent(longCount, sentences.length)}`,
  );
  console.log(
    `종결    해요체 ${metrics.yoEndingPercent}% · 구어 ${metrics.colloquialEndingPercent}% · 교대율 ${metrics.endingAlternationPercent}%`,
  );
  console.log(
    `1인칭   ${firstPersonCount}문장 (${percent(firstPersonCount, sentences.length)})`,
  );
  console.log(`\n종결 분포:`);
  console.log(formatCounts(countEndings(sentences), sentences.length));
  console.log(`\n금지 접속사가 든 문장 (프로파일 §6):`);
  console.log(
    formatCounts(
      countConnectives(sentences, BANNED_CONNECTIVES),
      sentences.length,
    ),
  );
  console.log(`\n허용 접속사가 든 문장:`);
  console.log(
    formatCounts(
      countConnectives(sentences, ALLOWED_CONNECTIVES),
      sentences.length,
    ),
  );
  console.log(`\n[도메인 지표] ${formatKoreanStyleMetrics(metrics)}`);
};

// 분류표 자체를 검사한다. 이 파일에서 실제로 세 번 틀렸던 자리들이다 — 「아니다」가 합쇼체로,
// 「문제 」가 1인칭으로, 「뿐만 아니라」가 언제나 0 으로 세어졌다. 표는 눈으로 봐서는 맞아
// 보이므로 깨뜨려 보는 검사를 남긴다.
//   pnpm exec ts-node scripts/measure-style.ts --selftest
const selfTest = (): void => {
  const endingOf = (sentence: string): string =>
    [...countEndings([sentence]).keys()][0];
  const bannedIn = (sentence: string): string[] => [
    ...countConnectives([sentence], BANNED_CONNECTIVES).keys(),
  ];
  const firstPersonIn = (sentence: string): boolean =>
    FIRST_PERSON.test(sentence);

  assert.equal(
    endingOf('완벽하게 해결하는 구조는 아니다.'),
    '~다 (하다체 평서)',
  );
  assert.equal(endingOf('저는 매일 글을 씁니다.'), '~습니다 (합쇼체)');
  assert.equal(endingOf('그게 더 빠르거든요.'), '~거든요');
  assert.equal(endingOf('그래서 다시 재봤어요.'), '~요 (해요체 기타)');
  assert.equal(endingOf('최대 세 번까지'), '조각·기타');

  assert.deepEqual(bannedIn('즉 Redis는 빠르다.'), ['즉']);
  assert.deepEqual(bannedIn('속도뿐만 아니라 안정성도 좋다.'), ['뿐만 아니라']);
  assert.deepEqual(bannedIn('변경은 즉시 반영된다.'), []);
  assert.deepEqual(bannedIn('값을 재고, 또한 기록한다.'), ['또한']);

  assert.equal(firstPersonIn('문제 상황에 맞게 골랐다.'), false);
  assert.equal(firstPersonIn('그래서 언제 갱신할지 정한다.'), false);
  assert.equal(firstPersonIn('제일 중요한 부분이에요.'), false);
  assert.equal(firstPersonIn('그 중 하나는 빠졌다.'), false);
  assert.equal(firstPersonIn('하늘을 나는 새를 봤다.'), false);
  assert.equal(firstPersonIn('제가 직접 손봤어요.'), true);
  assert.equal(firstPersonIn('제 주관이에요.'), true);
  assert.equal(firstPersonIn('나는 그때 몰랐다.'), true);
  assert.equal(firstPersonIn('내가 만든 규칙이다.'), true);

  console.log('selftest ok');
};

const main = (): void => {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) {
    selfTest();
    return;
  }
  const each = args.includes('--each');
  const paths = args.filter((arg) => !arg.startsWith('--'));
  if (paths.length === 0) {
    throw new Error(
      '사용법: pnpm exec ts-node scripts/measure-style.ts <글.md> [글2.md ...] [--each]',
    );
  }

  const samples: SampleReport[] = paths.map((path) => ({
    label: path,
    markdown: readFileSync(path, 'utf8'),
  }));

  if (each) {
    for (const sample of samples) {
      describe(sample.label, sample.markdown);
    }
  }

  // 합산이 본편이다. 개별 글은 대부분 40문장을 못 넘겨 정량 판정이 안 되고, 프로파일이
  // 재현 대상으로 삼는 것도 한 편이 아니라 "이 사람이 요즘 쓰는 글" 전체다.
  describe(
    `코퍼스 합산 (${samples.length}편)`,
    samples.map((sample) => sample.markdown).join('\n\n'),
  );
};

main();
