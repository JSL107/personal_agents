import { extractProseSentences } from './korean-style-sentences';
import { CODE_MASK_PATTERN, maskFencedCodeBlocks } from './markdown-blocks';

// 구성 축. 문장과 문단이 다 통과해도 **글 전체의 짜임**은 따로 틀어진다.
//
// 왜 이 파일이 생겼나 — 2026-09-02~03 에 8~9월 발행본 11편을 12항목으로 채점하며 137곳을
// 고쳤는데, 가장 많이 나온 결함 넷이 `korean-style-metrics.ts` 의 어느 축에도 잡히지 않았다.
// 인용체·헤딩 형태·리프 절 길이·확인 범위는 세는 자리가 아예 없었다.
//
// **기준은 사용자가 손본 발행본에서 뽑는다.** 참조 코퍼스(기업 기술 블로그)로 잡으면 사용자
// 문체와 반대 방향으로 민다 — `korean-style-metrics.ts` 헤더가 편차·짧은문장·구어를 판정에서
// 내리며 적어 둔 그 함정이다. 채점 회차에 쓴 기준(명사구 0% · 900자 절 0개)이 실제로 그랬다.
// 실측해 보니 기술 블로그 소제목은 78%가 명사구고 900자 넘는 절이 글마다 중앙 1개다. 그
// 기준을 지표로 굳혔다면 사용자 글 9편도 함께 탈락한다.
//
// 실측(2026-09-03 · 방어선 = 사용자가 커밋 2회 이상으로 손본 발행본 9편 / 참조 = RSS 60편):
//
//   축                방어선 중앙 · 최대    참조 중앙 · 최대     채택 기준
//   인용체              1% · 6%            0% · 2%            6%
//   헤딩 명사구         57% · 67%          78% · 100%         70%
//   리프 절 최대자      1160 · 1528        1087 · 5849        1600
//
// 셋 다 **방어선 최대에 소폭 여유**를 둔 값이다. 사용자 글은 전부 통과하고, 그 범위를 벗어난
// 것만 걸린다. 참조 코퍼스는 헤딩 축에서 방어선보다 느슨하므로(78% vs 57%) 기준으로 쓰지 않는다.

export type KoreanStyleCompositionMetrics = {
  // 사실을 출처 뒤에 숨긴 문장 수와 비율(0~100 정수 퍼센트).
  //
  // 「문서는 ~라고 해요」·「~에 따르면」·「README 에 명시돼 있어요」가 그것이다. 조사한 내용을
  // 옮겨 적는 글에서 특히 늘어나는데, 그러면 글쓴이의 판단이 사라지고 필기가 된다.
  // 2026-08-27 발행본이 88문장 중 8문장(9.1%)으로 가장 심했다.
  attributionCount: number;
  attributionPercent: number;
  // `##` 이하 헤딩 수와, 그중 종결어미로 끝나지 않는 것의 비율.
  //
  // **개념 명사구가 나쁘다는 뜻이 아니다.** 참조 코퍼스는 중앙 78%가 명사구다. 이 축이 잡는 것은
  // 소제목이 **전부** 명사구여서 이어 읽어도 흐름이 안 보이는 글이다. 기준 70%는 방어선 최대
  // 67% 바로 위에 둔 값이라, 사용자가 쓰던 만큼 쓰는 것은 걸리지 않는다.
  headingCount: number;
  nounPhraseHeadingPercent: number;
  // 하위 헤딩이 없는 절의 산문 글자 수 가운데 최대값(코드·표·목록 제외).
  //
  // 900자가 아니라 1600자인 이유 — 채점 회차에 쓴 900자 상한은 방어선(최대 1528자)도 참조
  // 코퍼스(중앙 1087자)도 통과하지 못하는 값이었다. 여기서 잡으려는 것은 화면에서 실제로 벽인
  // 절이지, 조금 긴 절이 아니다.
  sectionCount: number;
  longestSectionProse: number;
  // 어디까지 확인했는지 밝힌 문장이 있나. **판정하지 않고 경고만 한다.**
  //
  // 장르 표준이 아니기 때문이다 — 참조 코퍼스는 18%, 방어선도 22%만 밝힌다. 판정에 넣으면 거의
  // 모든 글이 걸려 다른 지적을 덮는다. 그래도 세는 이유는 이 블로그의 사정이다. 조사해 쓴 글이
  // 매일 자동으로 나가는데, 2026-08-31 발행본이 「붙지 않는 전제 위에 쓴 글」로 판명돼 사용자가
  // 절을 통째로 새로 써야 했다. 그 글은 문체 지표를 전부 통과했고 드러난 신호는 수정률뿐이었다.
  hasVerificationScope: boolean;
};

// 출처 뒤에 숨는 문장. 「~고 해요」류는 앞 글자를 함께 봐야 인용으로 갈린다.
const ATTRIBUTION_PATTERN = new RegExp(
  [
    '에 따르면',
    // 「~라고 해요/불러요」는 출처 주어가 없으면 그냥 정의문이다 — 「이 패턴을 어댑터라고 해요」
    // 가 인용체로 집계됐다(리뷰 지적). 귀속 동사만 남기고, 명명 표현은 아래 출처 패턴에 맡긴다.
    '라고 (설명|언급|밝혀|적혀)',
    '(명시|설명|언급|안내|기술)(돼|되어) 있',
    // `공식` 을 단독으로 두면 「공식 API 사용법을 설명해요」 처럼 출처가 주어가 아닌 문장까지
    // 잡는다(리뷰 지적). 뒤에 오는 말까지 묶어 출처를 가리킬 때만 걸리게 한다.
    '(문서|README|블로그|가이드|레퍼런스|reference|스펙|릴리스 노트|공식 (문서|저장소|예제|가이드|레퍼런스))[^.!?]{0,60}(설명|언급|밝혀|적혀|명시|소개|정의|불러|부릅|한다고 해)',
  ].join('|'),
);

// 확인 범위를 밝히는 표현. 「읽고 정리했다」쪽과 「아직 안 해봤다」쪽을 모두 센다.
const VERIFICATION_SCOPE_PATTERN = new RegExp(
  [
    // `대` 한 글자는 「읽고 대응했어요」 를 잡는다(리뷰 지적). 실측에서 이 조각으로만 걸린 글이
    // 0편이라 활용형으로 좁혔다. 대신 실제로 쓰이는 「읽고 쓴」·「대조해」 를 넣는다.
    '읽고 (정리|확인|쓴|대 ?보|대 ?봤|비춰|그려)',
    '대조해 ?[본봤보]|비교해 ?[본봤보]',
    '돌려 ?본|붙여 ?본|띄워 ?본|겪어 ?본',
    '아직 (아니|안 |못 )',
    '확인하지 (못|않)|해 ?보지 (않|는)|단정은 못',
    // 「것은 아니에요」는 넓기만 하고 실측에서 추가로 잡는 글이 0편이라 뺐다.
    '기록은 아니|결과는 아니',
    '직접 (해|써|돌려|붙여|나눠)',
  ].join('|'),
);

// 종결어미로 끝나면 판단을 담은 문장 제목이고, 아니면 개념 명사구로 본다.
//
// **활용형까지 함께 본다.** `요`·`다` 한 글자로 판정하면 `## 개요`·`## 제도` 같은 명사가
// 문장형으로 잡히고, 거꾸로 `## 왜 필요한가` 같은 의문형은 명사구로 잡힌다(리뷰 지적).
// `라`·`자` 를 넣으면 `## 인프라`·`## 연산자` 가 문장형이 된다(리뷰 지적). 의문형은 `한가`·`던가`
// 까지 봐야 `## 왜 필요한가` 가 잡힌다.
const SENTENCE_HEADING_ENDING =
  /(니다|습니다|[어아여해예에]요|죠|[는은인한던]가|나요|다|까|\?|!)$/;

const HEADING_PATTERN = /^(#{2,6}) +(.+)$/gm;
// 목록·표·인용은 산문이 아니라 절 길이에서 뺀다. 펜스 코드는 마스킹이 걷어내고, 4칸 들여쓴
// 코드블록은 여기서 뺀다 — 마스킹은 펜스만 다루기 때문이다(코드 리뷰 지적).
// 마커 뒤 **공백을 요구한다.** 선택으로 두면 `**핵심은 이렇습니다.**` 처럼 강조로 시작하는 산문이
// 목록으로 오인돼 절 길이에서 통째로 빠진다(리뷰 지적). 순서 목록은 `1.` 과 `1)` 을 모두 받는다.
const NON_PROSE_LINE =
  /^(\s*[-*+]\s+.*|\s*\d+[.)]\s+.*|\s*[|>].*| {4,}\S.*)$/gm;

const stripHeadings = (text: string): string =>
  text.replace(/^#{1,6} .*$/gm, '');

// 마스킹이 코드블록을 남기는 `<!-- CODE_BLOCK_… -->` 주석은 산문이 아니다. 빼지 않으면 절마다
// 코드 개수 × 26자쯤이 길이에 얹혀, 코드가 많은 글일수록 절이 길다고 잘못 찍힌다.
const CODE_MASK_GLOBAL = new RegExp(CODE_MASK_PATTERN.source, 'g');

const countProseChars = (text: string): number =>
  text
    .replace(CODE_MASK_GLOBAL, '')
    .replace(NON_PROSE_LINE, '')
    .replace(/\s/g, '').length;

type HeadingBlock = {
  level: number;
  body: string;
};

/**
 * 헤딩으로 글을 잘라 각 절의 본문을 모은다. 첫 헤딩 앞의 리드 문단은 절이 아니라 버린다.
 */
const splitByHeadings = (markdown: string): HeadingBlock[] => {
  const matches = [...markdown.matchAll(/^(#{1,6}) +.+$/gm)];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? markdown.length;
    return {
      level: match[1].length,
      body: markdown.slice(start, end),
    };
  });
};

/**
 * 헤딩마다 **그 헤딩 바로 아래 산문**의 글자 수를 모은다.
 *
 * 하위 헤딩이 있는 절도 센다. `splitByHeadings` 가 이미 다음 헤딩 전까지만 자르므로 각 body 는
 * 그 절의 자체 산문뿐이고, 하위 절의 분량은 섞이지 않는다. 이전에는 하위 헤딩이 있으면 통째로
 * 건너뛰었는데, 그러면 `## A` 아래 500자를 쓰고 `### B` 를 연 글에서 그 500자가 사라졌다
 * (리뷰 지적 — 「A 의 길이는 B·C 를 합친 값」이라던 전제가 틀렸다).
 */
const measureSectionProse = (markdown: string): number[] =>
  splitByHeadings(markdown)
    .map((block) => countProseChars(block.body))
    .filter((length) => length > 0);

const toPercent = (count: number, total: number): number =>
  total === 0 ? 0 : Math.round((count / total) * 100);

/**
 * 구성 축을 잰다. 코드블록은 마스킹해 빼므로 예시 코드 안의 문장은 세지 않는다.
 */
export const measureKoreanStyleComposition = (
  markdown: string,
): KoreanStyleCompositionMetrics => {
  const { masked } = maskFencedCodeBlocks(markdown);
  // 문장 분해는 `korean-style-sentences.ts` 것을 그대로 쓴다. 자체 구현하면 닫는 인용부호와
  // `。` 를 놓쳐 두 문장이 하나로 붙고(리뷰 지적), 같은 글을 두 파서가 다르게 세어 인용체 비율이
  // 문장 축과 어긋난다.
  const sentences = extractProseSentences(markdown);
  const headings = [...masked.matchAll(HEADING_PATTERN)].map((match) =>
    match[2].replace(/[`*_]/g, '').trim().replace(/\.$/, ''),
  );
  const nounPhraseHeadings = headings.filter(
    (heading) => !SENTENCE_HEADING_ENDING.test(heading),
  );
  const sections = measureSectionProse(masked);
  const attributionCount = sentences.filter((sentence) =>
    ATTRIBUTION_PATTERN.test(sentence),
  ).length;

  return {
    attributionCount,
    attributionPercent: toPercent(attributionCount, sentences.length),
    headingCount: headings.length,
    nounPhraseHeadingPercent: toPercent(
      nounPhraseHeadings.length,
      headings.length,
    ),
    sectionCount: sections.length,
    longestSectionProse: sections.length === 0 ? 0 : Math.max(...sections),
    hasVerificationScope: VERIFICATION_SCOPE_PATTERN.test(
      stripHeadings(masked),
    ),
  };
};
