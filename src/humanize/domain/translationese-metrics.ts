import { extractProseSentences } from './korean-style-sentences';

// 번역투 축 — 프롬프트가 고치라고 지시하는 것을 실제로 세는 자리.
//
// 왜 필요한가 — `humanize-system.prompt.ts` 는 "번역투: 무생물 주어, 피동 남발 …" 을 고치라고
// 지시하는데 고쳐졌는지 세는 코드가 없었다. 재지 않으면 되먹임(`style-feedback.ts`)에 실리지
// 않아 그 지시가 실제로 먹었는지 회차로 확인할 방법이 없다. 지시는 증거가 아니다.
//
// 대상 패턴의 출처는 humanize-korean 스킬의 `references/metrics_v2.py`
// (`_DOUBLE_PASSIVE_TOKENS` · `_HAVE_MAKE_LITERAL_TOKENS` · `_BY_PASSIVE_RE` ·
// `inanimate_subject_rate`) 이지만, **세는 방식은 옮기지 않고 다시 짰다.** 이유는 각 상수 위에
// 실측값과 함께 적어 뒀다.
//
// **네 축 전부 관측값이고 판정하지 않는다. 2026-09-10 에 승격을 검토했고 넷 다 보류했다.**
//
// 승격 기준은 두 무리(사람이 손본 글 / 모델 산출)가 갈리는가다. GitHub 블로그의 발행본과
// 최종본 16편을 짝지어 쟀다(발행 카드 17건 중 파일이 남아 있는 16편) —
//
//   축          발행본(모델)        최종본(사람)
//   이중 피동    0/16 · 합 0        0/16 · 합 0
//   에 의해      0/16 · 합 0        0/16 · 합 0
//   무생물 주어  0/16 · 합 0        0/16 · 합 0
//   직역 경동사  3/16 · 합 6        6/16 · 합 8
//
// 앞의 셋은 **양쪽 다 전부 0** 이라 갈릴 값이 없다. 판정으로 올려도 걸리는 글이 없다.
//
// **직역 경동사는 사람 쪽이 더 많다.** 사람이 고치면서 `가지고 있다` 류를 오히려 늘렸다는
// 뜻이라, 판정으로 올리면 사용자 문체와 **반대 방향으로 민다**. 이 레포가 2026-08-25 에
// 겪은 「편차 미달」 사고와 같은 구조다(참조 코퍼스 기준이 사용자 글과 반대여서 세 축을
// 판정에서 내렸다 — `korean-style-metrics.ts` 헤더). 표본 16편으로 처방까지 빼기에는
// 차이가 작아 그대로 두되, 여기 적어 둔다.
//
// 승격을 다시 보려면 **발행본 쪽 표본이 새 프롬프트 산출이어야 한다.** 위 16편은 오늘 세 번
// 바뀌기 전 프롬프트의 결과다. 이 레포는 두 무리(사람이 손본 글 / 모델 산출)의
// 값이 갈릴 때만 축을 판정에 넣는데(`korean-style-metrics.ts` 헤더), 이 축들은 아직 블로그
// 기준선으로 실측한 적이 없다. 임계값을 스킬에서 베껴 오면 안 된다 — 스킬 기준은 「일반 AI
// 글」이고 이 레포 기준은 「이 사람 문체」다. 값이 쌓여 무리가 갈리는 것이 보이면 그때 올린다.

export type TranslationeseMetrics = {
  // 이중 피동. "판단되어진다"처럼 피동을 두 번 겹친 것. 단순 "판단된다"는 세지 않는다.
  doublePassiveCount: number;
  // `~에 의해`/`~에 의하여` 출현 횟수. 행위자를 주어로 되돌릴 수 있는 자리다.
  byAgentPhraseCount: number;
  // have/make 직역 경동사. "경쟁력을 가지고 있다" → "경쟁력이 강하다".
  literalLightVerbCount: number;
  // 무생물 주어 + 보편 서술어가 함께 있는 문장의 비율. 아래 판별 규칙의 한계를 함께 읽을 것.
  inanimateSubjectPercent: number;
  // 무엇이 잡혔는지. 개수만으로는 오탐인지 판단할 수 없다 — 구성 축의 `internalNames` 와 같은
  // 이유로 표면형을 함께 낸다(`korean-style-composition.ts`).
  samples: string[];
};

// **상류의 표면형 사전을 그대로 옮기지 않았다.** 2026-09-09 에 `metrics_v2.py` 를 직접 돌려
// 확인한 것이 두 가지다.
//
// 1) 겹치는 항목을 중복으로 센다. 사전을 하나씩 `text.count(tok)` 로 더하기 때문에 "결과가
//    보여진다." 1건이 4회로(`보여진다`·`보여진`·`여진다`·`여진`), "회의를 가지다." 1건이
//    2회로 잡힌다.
//
// 2) **활용형이 하나라도 어긋나면 통째로 놓친다.** 사전에 `보여진다`·`보여졌다`·`보여진` 만
//    있어 `보여져요`·`보여집니다` 는 0 이다. 상류 코퍼스는 하다체 AI 칼럼이지만 **이 레포가
//    재려는 글은 해요체다** — 프롬프트가 해요체로 쓰게 하고 발행본 요체 비율이 100% 다.
//    사전을 그대로 옮기면 정작 재려는 글에서 0 이 나오는 지표가 된다.
//
// 그래서 표면형 나열 대신 **어간 + 활용 음절**로 잡는다. 종결어미가 바뀌어도 값이 흔들리지
// 않고, 부분문자열 겹침이 없어 중복 계수도 함께 사라진다.

// 이중 피동 — `되어/보여/쓰여/…` 어간에 `지` 계열 활용이 붙은 것.
//
// 활용 음절을 빠짐없이 적는다. 처음에 `지·진·져·집` 만 두었다가 **과거형을 통째로 놓쳤다** —
// `보여졌다`·`보여졌어요`·`판단되어졌습니다` 가 전부 0 이었다(`져`+`ㅆ` 이 `졌` 한 음절로
// 합쳐진다). 상류 사전에는 `보여졌다`·`되어졌다`·`잊혀졌` 이 들어 있었으니 어간 방식으로
// 옮기면서 오히려 재현율을 떨어뜨린 셈이었다. `질`(보여질 것이다)도 같은 이유로 넣는다.
//
// 어간을 열거하는 이유는 범용 `여진` 을 쓰면 엉뚱한 것이 걸리기 때문이다 — "여진이 계속됐다"
// (명사)·"제안이 받아들여진다"(자연스러운 단일 피동)가 그렇다. 상류 사전은 둘 다 센다.
const DOUBLE_PASSIVE_PATTERN =
  /(?:되어|보여|쓰여|잊혀|닫혀|열려|불려|놓여)(?:지|진|져|졌|질|집)/g;

// `에 의해` 마커. **상류와 다르다** — 상류(`_BY_PASSIVE_RE`)는 뒤에 피동 서술어가 붙은 것만
// 세려고 `(?:되|받|당하|지)` 를 AND 조건으로 걸었는데, 한국어는 이 어간이 뒤 어미와 한 음절로
// 합쳐져서(되+ㄴ → 된) 그 글자가 표면에 남지 않는다. 2026-09-09 실측 —
//
//   "AI에 의해 생성되었다"    → 1  (되+었 이 살아남은 유일한 형태)
//   "AI에 의해 생성된다"      → 0
//   "정책에 의해 결정된 사항"  → 0
//   "시장에 의해 좌우된다"    → 0
//   "바람에 의해 흔들렸다"    → 0
//
// 여섯 중 하나만 잡는 값은 「번역투 없음」으로 오독된다. 스킬 룰북도 `A-9` 에서 이 표현 자체를
// 조건 없이 S2 로 두므로, 여기서는 마커를 세고 서술어 판별을 하지 않는다. 이름을
// `byAgentPhraseCount` 로 둔 것도 「피동까지 판별했다」고 읽히지 않게 하기 위해서다.
const BY_AGENT_PHRASE_PATTERN = /에\s*의(?:해|하여)/g;

// have/make 직역 경동사.
//
// 상류 사전의 `을/를 만들다` 계열과 `결정을 내리다` 는 뺐다 — "제품을 만들었다"·"결정을 내렸다"
// 는 그 자체로 자연스러운 한국어라, 넣으면 정상 문장이 대량으로 걸려 실제 신호를 덮는다.
// 사람이 카드를 읽고 거르는 관측값이므로 재현율보다 정밀도가 중요하다.
const LITERAL_LIGHT_VERB_PATTERN =
  /(?:가지고|갖고)\s*있|[을를]\s*(?:가지다|가지는|가진다|가졌|가져|가집)/g;

// 무생물 주어 판별. 첫 어절(관형사가 앞서면 그다음)을 주어로 보고 조사 하나를 떼어 맞춰 본다.
const INANIMATE_SUBJECTS = [
  '연구',
  '데이터',
  '분석',
  '결과',
  '시스템',
  '기술',
  '사례',
  '현상',
  '이론',
  '정책',
  '보고서',
  'AI',
  '인공지능',
  '모델',
  '알고리즘',
  '변화',
  '위기',
  '혁신',
  '사회',
  '경제',
] as const;

// 주어가 무엇이든 붙을 수 있는 서술어. 무생물 주어와 함께 나올 때만 번역투 신호로 본다.
// 여기도 어간 + 활용으로 잡는다 — 표면형을 나열하면 `보여준다` 는 잡고 `보여줘요` 는 놓친다.
//
// 상류에 있던 `만든다`·`만들어` 는 뺐다. 「주어가 무엇이든 붙는다」는 조건에는 맞지만 너무 흔해
// 정상 문장을 대량으로 끌어온다.
const UNIVERSAL_VERB_PATTERN =
  /보여(?:준|줬|주는|줘|줍)|시사(?:한|했|하는|해|합)|드러(?:낸|냈|내는)|제시(?:한|했|하는|해|합)|나타(?:낸|냈|내는)|증명(?:한|했|하는|해|합)|말해(?:준|줬|주는|줘|줍)|의미(?:한|하는|해|합)|가져(?:온|왔|오는|와|옵)/;

// 추상 명사를 만드는 한자 접미사. `-성`·`-적`·`-화` 처럼 무생물 주어가 되기 쉬운 형태다.
//
// 상류에 있던 `-원` 은 뺐다. 사람을 가리키는 쪽이 이 레포 글에 훨씬 자주 나온다 —
// `직원은 결과를 보여줬어요`·`연구원은 의미를 말해줬어요` 가 통째로 무생물 주어로 잡혔다.
// 하필 `보여주다`·`말해주다` 가 아래 보편 서술어에 있어 AND 조건도 이 오탐을 못 거른다.
// 대신 `자원은 한계를 보여준다` 류를 놓치는데, 사람 오탐보다 그쪽이 훨씬 드물다.
//
// **정밀도 한계** — "정도"·"노력"처럼 접미사가 아닌데 같은 글자로 끝나는 낱말은 여전히
// 걸린다. 보편 서술어와 동시에 나올 때만 세는 AND 조건이 대부분을 거르지만 오탐이 남는다.
// 그래서 이 축은 판정에 넣지 않고 `samples` 로 무엇이 잡혔는지 함께 낸다.
const HANJA_SUFFIXES = ['성', '적', '화', '도', '력', '감'] as const;

const SUBJECT_PARTICLES = ['은', '는', '이', '가', '도'] as const;

// 주어 앞에 붙는 관형사. 첫 어절만 보면 "본 분석은 …" 의 주어를 「본」으로 읽어 놓친다 —
// 하필 `humanize-system.prompt.ts` 가 번역투 예시로 든 형태가 `본 작업은…` 이다.
const SUBJECT_DETERMINERS = ['본', '이', '그', '해당', '동', '새'] as const;

const SAMPLE_LIMIT = 5;

// 굵게·인용부호 같은 장식은 주어 판별을 통째로 빗나가게 한다 — `**데이터는**` 은 어떤 사전에도
// 없다. 어절 양끝의 한글·영숫자가 아닌 문자를 떼고 본다.
const DECORATION_EDGE = /^[^가-힣A-Za-z0-9]+|[^가-힣A-Za-z0-9]+$/g;

const stripDecoration = (word: string): string =>
  word.replace(DECORATION_EDGE, '');

// 전역 플래그가 붙은 정규식을 `match` 에 넘기면 엔진이 `lastIndex` 를 스스로 0 으로 되돌리므로
// 모듈 상수를 그대로 재사용해도 호출 간에 상태가 새지 않는다.
const matchAll = (text: string, pattern: RegExp): string[] =>
  text.match(pattern) ?? [];

const stripSubjectParticle = (word: string): string => {
  const particle = SUBJECT_PARTICLES.find(
    (candidate) => word.length > 1 && word.endsWith(candidate),
  );
  return particle === undefined ? word : word.slice(0, -particle.length);
};

const isInanimateSubject = (word: string): boolean => {
  const stem = stripSubjectParticle(word);
  if (INANIMATE_SUBJECTS.some((subject) => subject === stem)) {
    return true;
  }
  return (
    stem.length >= 2 && HANJA_SUFFIXES.some((suffix) => stem.endsWith(suffix))
  );
};

// 관형사가 앞서면 그다음 어절이 주어다.
const toSubjectIndex = (words: string[]): number =>
  SUBJECT_DETERMINERS.some((determiner) => determiner === words[0]) ? 1 : 0;

const toPercent = (count: number, total: number): number =>
  total === 0 ? 0 : Math.round((count / total) * 100);

// 축을 번갈아 뽑는다. 앞 축부터 이어 붙이면 이중 피동만 다섯 개 나온 글에서 `에 의해`·
// 경동사 표본이 하나도 안 실린다 — 사람이 축별 오탐을 가리라고 내는 값인데 그 목적이 깨진다.
const toSamples = (groups: string[][]): string[] => {
  const interleaved: string[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < longest; index += 1) {
    for (const group of groups) {
      const sample = group[index];
      if (sample !== undefined) {
        interleaved.push(sample);
      }
    }
  }
  return [...new Set(interleaved)].slice(0, SAMPLE_LIMIT);
};

/**
 * 산문 문장만 대상으로 번역투 네 축을 잰다.
 *
 * 코드 블록·표는 `extractProseSentences` 가 이미 걷어낸다 — 다른 축과 같은 표본을 써야 카드에
 * 나란히 적힌 수치가 서로 비교 가능하다.
 */
export const measureTranslationese = (
  markdown: string,
): TranslationeseMetrics => {
  const sentences = extractProseSentences(markdown);
  const prose = sentences.join(' ');

  const doublePassive = matchAll(prose, DOUBLE_PASSIVE_PATTERN);
  const byAgentPhrase = matchAll(prose, BY_AGENT_PHRASE_PATTERN);
  const literalLightVerb = matchAll(prose, LITERAL_LIGHT_VERB_PATTERN);

  const inanimateHeads = sentences
    .map((sentence) =>
      sentence.trim().split(/\s+/).map(stripDecoration).filter(Boolean),
    )
    .map((words) => {
      const index = toSubjectIndex(words);
      return { head: words[index], rest: words.slice(index + 1) };
    })
    .filter(
      (sentence): sentence is { head: string; rest: string[] } =>
        sentence.head !== undefined &&
        isInanimateSubject(sentence.head) &&
        UNIVERSAL_VERB_PATTERN.test(sentence.rest.join(' ')),
    )
    .map((sentence) => sentence.head);

  return {
    doublePassiveCount: doublePassive.length,
    byAgentPhraseCount: byAgentPhrase.length,
    literalLightVerbCount: literalLightVerb.length,
    inanimateSubjectPercent: toPercent(inanimateHeads.length, sentences.length),
    samples: toSamples([
      doublePassive,
      byAgentPhrase,
      literalLightVerb,
      inanimateHeads,
    ]),
  };
};

/**
 * 원장에 남기는 형태. `samples` 는 뺀다 — 본문 조각이라 원장에 본문을 담지 않는다는 규칙
 * (`humanize.service.ts` 의 `output` 주석)에 걸리고, 나중에 임계를 정할 때 필요한 것은
 * 개수뿐이다.
 */
export type TranslationeseLedger = {
  doublePassiveCount: number;
  byAgentPhraseCount: number;
  literalLightVerbCount: number;
  inanimateSubjectPercent: number;
};

export const toTranslationeseLedger = (
  metrics: TranslationeseMetrics,
): TranslationeseLedger => ({
  doublePassiveCount: metrics.doublePassiveCount,
  byAgentPhraseCount: metrics.byAgentPhraseCount,
  literalLightVerbCount: metrics.literalLightVerbCount,
  inanimateSubjectPercent: metrics.inanimateSubjectPercent,
});
