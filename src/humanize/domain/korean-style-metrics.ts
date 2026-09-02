import { maskFencedCodeBlocks, scanMarkdownBlocks } from './markdown-blocks';

// 윤문본이 "이 사람 말투" 에 얼마나 가까운지 재는 지표.
//
// 출처: `~/.claude/skills/humanize-korean/references/style-profile-juneseok.md`
// (「이대리 프로젝트」소개 글 본문 115문장 실측). 수치는 목표가 아니라 **재현 대상**이다.
//
// **2026-08-26 — 그 표본이 사용자 글이 아닐 가능성이 크다.** 프로파일 문서가 스스로 경고를
// 달았다: 「기준 코퍼스 0편 · 판정 보류」, 「1·7·8·9·10항의 수치와 예문은 출처가 확인될
// 때까지 재현 대상으로 쓰지 말 것」. 근거는 세 표본의 대조다 —
//
//   글                          문장   평균     편차   20자↓   구어
//   「이대리 프로젝트」(의심)     115   29.9자   13.7   26.1%   16.5%
//   「Redis란?」 노션 정리         83   31.4자   14.0   18.1%    0%
//   사용자 블로그(본인 확인)       15   44.7자     —     6.7%   33.3%
//
// 앞의 둘이 붙어 있고 본인 확인 글만 떨어져 있다. 즉 §1 수치는 **AI 글의 리듬을 개인 문체로
// 오인한 값으로 의심된다**. 사용자는 더 길게(44.7 vs 29.9자) · 더 구어체로(33.3 vs 16.5%) ·
// 짧은 문장은 훨씬 덜(6.7 vs 26.1%) 쓴다.
//
// 그래서 §1 에서 파생된 세 축(편차 · 짧은문장 · 구어)을 **판정에서 내렸다**. 그대로 두면
// 되먹임(`style-feedback.ts`)이 그 미달을 매 회차 프롬프트에 실어, 의심 표본의 리듬을 더
// 정확히 재현하라고 모델에 되먹인다 — 학습 루프가 반대로 도는 것이다. 실제로 2026-08-25
// 발행본 5편이 연속으로 「편차 미달」로 찍혔고 그 지적이 주입되고 있었다.
//
// **수치는 계속 잰다.** 카드에 값을 보여주는 것과, 그 값을 「목표 밖」으로 판정해 되먹이는
// 것은 다르다. 지금 내린 것은 판정뿐이다.
//
// **2026-09-02 — 그 조건이 충족됐다.** 기준 코퍼스는 이제 GitHub 블로그
// (`JSL107/JSL107.github.io`) 의 **사람이 손댄 발행본 9편 · 881문장**이다
// (`scripts/fetch-blog-baseline.ts` 로 재현). 아래 임계값은 전부 이 실측에서 나온다.
//
//   축        합산    편별 분포                                    옛 기준
//   평균     49.6자   38.6 ~ 57.0                                  ≥35 (임시 눈금)
//   어절     11.7개   10.9 ~ 12.7                                  ≥11
//   최장      146자   100 ~ 146 (9편 전부 80 초과)                 ≤80
//   교대율       0%   9편 전부 0%                                  ≤60
//   편차       23.5   18.0 ~ 24.9
//   짧은문장    10%   3 ~ 22%
//   구어        15%   9 ~ 24%
//
// **미수정 발행본은 코퍼스에서 뺀다.** 발행 커밋 하나뿐인 글은 사람이 통과시킨 것이 아니라
// 아직 손대지 않은 산출물이라, 넣으면 모델이 만든 값을 목표로 되먹인다 — 이 파일이 2026-08-26
// 에 겪은 사고와 같은 유형이다. 실제로 2026-09-01 발행본(커밋 1개)이 어절 최저값 9.5 를
// 만들고 있었고, 빼자 하한이 10.9 로 올라갔다.
//
// 편차 · 짧은문장 · 구어는 **여전히 판정 밖**이다. 이유가 바뀌었다 — 출처가 의심스러워서가
// 아니라, 이제 실측해 보니 **판정할 차이가 없기 때문**이다. 발행본(모델 산출)과 최종본(사람이
// 고친 글)이 같은 범위에 있다(편차 24.6 vs 23.5 · 짧은문장 8% vs 10% · 구어 10% vs 15%).
// 세 축을 켜도 걸리는 것이 없고, 기술 블로그 실측(토스·우아한형제들·네이버 D2·하이퍼커넥트
// 54편: 편차 28.5~37.7)을 기준으로 삼으면 **사용자 문체와 반대 방향으로 민다**.
//
// 이 지표는 지금도 발행을 막지 않는다. 카드에 수치를 적어 눈으로 보게 하는 용도다.

export type KoreanStyleMetrics = {
  sentenceCount: number;
  averageLength: number;
  lengthStandardDeviation: number;
  // 비율은 0~100 정수 퍼센트다. 소수 1자리로 반올림하면 0~5% 가 전부 0 으로 뭉개져
  // "구어 어미가 하나도 없다" 로 읽힌다(실측: 142문장 중 6개 = 4% 가 0% 로 표시됐다).
  shortSentencePercent: number;
  longestSentenceLength: number;
  // 가장 긴 문장 그대로. 상한을 넘겼을 때 **무엇이 길었는지** 사람이 봐야 처방이 갈린다 —
  // 끊어야 할 만연체와, 끊을 수 없는 영문 이름 나열은 길이만으로 구분되지 않는다.
  longestSentence: string;
  // 가장 긴 문장의 어절 수. 최장 판정은 글자 수로 하는데 그 값이 영문 이름 나열에 부풀려지므로
  // (위 주석의 「91자 중 77자가 영문」 사례), 어절을 함께 적어 사람이 끊어야 할 만연체와
  // 끊을 수 없는 이름 나열을 가를 수 있게 한다.
  longestSentenceWords: number;
  // 문장당 어절 수. **평균 글자 수가 통과해도 숨이 가쁠 수 있다** — 영문 식별자 하나가 20~30자를
  // 먹어서, 영문 비중이 10~46% 로 갈리는 글들은 글자 수로 비교되지 않는다.
  //
  // 실측(2026-09-01, 블로그 8월 글 9편): 사용자가 「문장 호흡이 짧다」 고 지적한 7편이
  // 8.7~9.9어절인데 평균 글자 수로는 41.9~50.9자라 하한(35자)을 **전부 넘겼다**. 지적받지 않은
  // 2편은 12.0~12.2어절이다. 두 무리가 겹치지 않아 이 축을 판정에 넣는다.
  wordsPerSentence: number;
  // 문장당 절 수(쉼표 + 연결어미로 추정). 어절이 같아도 절이 하나뿐이면 나열을 쉼표로 이어 붙인
  // 문장이라 호흡이 중간에서 한 번 더 끊긴다.
  //
  // **판정하지 않는다** — 위 두 무리의 값이 1.5~1.7 vs 1.8~2.4 로 간격이 0.1뿐이다.
  // 표본 하나가 흔들면 순서가 뒤집히는 폭이라, 간격이 2.3인 어절 축과 달리 관측값으로만 둔다.
  clausesPerSentence: number;
  colloquialEndingPercent: number;
  // 종결 어미 중 해요체(`~요`·`~죠`) 비율. 프로파일 실측은 "`~습니다` 와 `~요` 가 거의 반반이고,
  // 여기에 구어 어미가 6분의 1쯤 얹힌다" 다 — 즉 문체는 두 축이고, 구어 어미는 `~요` 축의
  // 부분집합이다. 이 축이 없으면 `~에요`·`~봐요` 로 쓴 글이 "구어 6%" 로만 보여 딱딱한 글로
  // 오독된다(실측: 발행본 2026-08-19-http-cache 가 그랬다).
  yoEndingPercent: number;
  // 종결체가 인접 문장에서 바뀌는 비율. 비율(`yoEndingPercent`) 이 반반이어도 문장마다
  // 갈아타면 그 자체가 기계적으로 읽힌다 — 비율과 배치는 다른 축이다. 실측: 사용자가 쓴
  // 노션 글 50% · 사용자가 직접 손본 발행본 37% vs 「한쪽으로 몰리지 않게」 지시로 만든
  // 발행본 73~88% (2026-08-21~23 세 편).
  endingAlternationPercent: number;
  bannedConnectiveCount: number;
  // 줄표(—) 개수. 스킬 룰북(`rewriting-playbook.md` J-3)이 "1문서 1~2회 이하" 로 정한 항목인데
  // 프롬프트에만 있고 세는 자리가 없어 발행본에 15개가 들어가도 어떤 지표에도 안 걸렸다
  // (2026-08-26 실측: 헤딩 6 · 목록 6 · 본문 3). 문장 축이 아니라 문서 축이라 40문장 미만에도 잰다.
  emDashCount: number;
  // 40문장 미만이면 문장 하나가 비율을 10%p씩 흔들어 정량 판정이 무의미하다.
  measurable: boolean;
  paragraph: KoreanStyleParagraphMetrics;
};

/**
 * 문단 축. 문서 전체 평균이 통과해도 개별 문단은 벽일 수 있다.
 *
 * 실측(run #980 `2026-08-20-agent-security-permission-boundaries`): 문서 지표는 네 항목 모두
 * 통과했는데(편차 15.2 · 짧은문장 20% · 구어 10% · 금지접속사 0) 산문 문단 25개 중 20개가
 * 4문장 이상이었고, **아래 기준(3문장 이상 · 공백 제외)으로 짧은 문장이 없는 문단이 11개**였다.
 * 짧은 문장이 몇몇 문단에 몰려 전체 비율만 채운 것이다. 평균으로 뭉개면 이 편중이 보이지 않는다.
 */
export type KoreanStyleParagraphMetrics = {
  paragraphCount: number;
  // 6문장 이상 또는 250자 초과 — 화면에서 벽으로 떨어지는 문단의 비율(0~100 정수 퍼센트).
  //
  // 기준을 4문장·150자에서 올린 이유(2026-08-28) — 그 값으로는 기업 기술 블로그가 죄다 벽으로
  // 찍힌다. 같은 파서로 잰 토스·우아한형제들·LINE 9편의 4문장 이상 문단 비율은 중앙값 22%
  // (최대 47%)였다. 4문장을 벽으로 세면 프롬프트가 그 상한을 지키려 모든 문단을 2~3문장으로
  // 찍어내고, 그 결과가 아래 dominantParagraphSizePercent 가 잡는 격자다. 벽은 실제로 벽인
  // 크기부터 세야 한다.
  //
  // 1문장 문단 비율도 같은 9편에서 중앙값 33%(14~45%)였다. 이 값은 지표로 두지 않는다 —
  // 실측(2026-08-28 A/B)에서 윤문 단계는 큰 덩어리를 쪼개 1문장 문단을 만들지 못했다
  // (지시를 넣어도 0%). 문단을 합칠 수 없는 어댑터 구조(값 하나 = 문단 하나)상 1문장 문단은
  // 초안이 주어야 하는 것이라, 윤문 결과를 그 비율로 판정하면 못 고칠 축으로 발행을 흔든다.
  // 소수 비율로 담지 않는 이유는 위 shortSentencePercent 와 같다. 25문단 중 1개(0.04)가
  // 0 으로 뭉개지면 남은 벽을 드러내려고 만든 지표가 벽을 숨긴다.
  wallPercent: number;
  // 3문장 이상인데 짧은 문장(20자 이하)이 한 개도 없는 문단 수. 호흡이 쉴 자리가 없는 덩어리다.
  //
  // 왜 2문장 문단은 세지 않는가 — J-5 처방으로 문단을 잘게 나누면 2문장 문단이 늘어나는데,
  // 거기까지 짧은 문장을 요구하면 처방을 따를수록 지표가 나빠진다. 호흡이 실제로 문제되는 것은
  // 문장이 여럿 이어지는 덩어리다.
  noShortSentenceParagraphs: number;
  // 가장 흔한 문장 수가 전체 문단에서 차지하는 비율(0~100). **벽의 반대쪽 실패**를 잡는다.
  //
  // 왜 필요한가 — 위 wallPercent 는 "너무 큰 문단" 만 센다. 그래서 지표만 보고 다듬으면 계속
  // 잘게 자르는 쪽으로만 압력이 걸리는데, 그 끝이 격자다: 2026-08-20 발행본은 산문 문단 43개가
  // 전부 2문장(29개) 아니면 3문장(14개) 이었고 문서 지표 네 항목이 모두 통과했다. 사람은 한
  // 문장 문단도 쓰고 여섯 문장 문단도 쓴다 — 균일함 자체가 기계 티다.
  //
  // 실측 기준선(2026-08-21, 같은 글): 격자 발행본 67% · 그 글을 만든 프롬프트로 재생성 55% ·
  // 나누기 전 벽 상태 35% · 「조각 크기를 고르게 맞추지 마라」 적용 6회 37·43·43·44·53·60%.
  //
  // **이 축만 보고 판정하지 마라 — wallPercent 와 반대로 움직인다.** 벽 상태가 35% 로 가장
  // "다양" 하게 찍히는데, 안 나누면 크기가 흩어지기 때문이다. 좋은 글은 둘이 함께 낮다
  // (벽 9% · 같은크기 53% 가 실측 최선). 한 축만 좋게 하려면 반대쪽으로 밀면 되므로,
  // 프롬프트를 손볼 때는 두 값을 항상 같이 읽어라.
  //
  // 문단 수가 적으면 이 값은 무의미하다(문단 2개면 최소 50% 다) — paragraphCount 를 함께 보라.
  dominantParagraphSizePercent: number;
};

const SHORT_SENTENCE_MAX = 20;
// 프로파일의 구어 종결어미. 이유를 문장 끊고 뒤에 던지는 이 문체의 표식이다.
//
// 이 목록에 `~에요`·`~아요` 를 넣지 않는다. 그 둘은 이유를 던지는 어미가 아니라 해요체 평서형이라
// 다른 축이고(→ yoEndingPercent), 기준값 16.5% 가 이 목록으로 실측된 것이라 늘리면 그 기준이
// 무효가 된다. 축을 섞지 말고 나란히 둔다.
const COLLOQUIAL_ENDINGS = [
  '니까요',
  '거든요',
  '더라고요',
  '잖아요',
  '죠',
  '네요',
];
// 이 문체가 쓰지 않는 접속사. 하나라도 있으면 AI 문체 쪽으로 끌린 신호다.
const BANNED_CONNECTIVES = [
  '또한',
  '따라서',
  '게다가',
  '뿐만 아니라',
  // '즉' 은 아래 정규식으로 따로 센다 — '즉시'·'즉각' 을 빼려고 쉼표를 붙였더니
  // '즉 이 방식은' 처럼 쉼표 없는 쓰임을 통째로 놓쳤다(PR #379 리뷰 지적).
  // 프롬프트가 금지하는 것은 구두점과 무관한 '즉' 자체다.
  '한편',
];

// '즉' 은 뒤에 한글이 붙지 않을 때만 접속사다. '즉시'·'즉각'·'즉효' 는 접속사가 아니라
// 제외해야 하는데, 쉼표를 붙여 피하면 '즉 그래서' 처럼 쉼표 없는 접속 용법을 놓친다.
const JEUK_PATTERN = /즉(?![가-힣])/;
const MEASURABLE_SENTENCE_MIN = 40;
/**
 * 상한을 넘긴 문장을 카드에 보여줄 때 잘라 낼 길이. 상한 자체는 `KOREAN_STYLE_TARGETS`
 * (`longestSentenceMax`)가 정본이다.
 *
 * 왜 문장을 보여주는가 — 넘겼다고 발행을 막지 않으므로 사람이 판단해야 하는데, **숫자만으로는
 * 판단이 안 선다.** 실측(2026-08-24, 같은 입력 4회)에서 80자 초과 네 문장 중 셋은 53·75·59자로
 * 끊겼고, 남은 하나는 네 회차 모두 91자 그대로였다. 그 하나는 공백 제외 91자 중 77자(85%)가
 * 영문 이름이라 절대 규칙(고유명사·항목 순서 불변)이 끊는 것을 막는다 — 끊어야 할 만연체와
 * 끊을 수 없는 이름 나열이 길이로는 갈리지 않는다.
 *
 * 한 줄에 들어갈 만큼만 보여준다. 판정에 필요한 것은 문장의 **성격**이지 전문이 아니다.
 */
const LONGEST_SENTENCE_PREVIEW = 60;
// 합쇼체 종결 판정. `습니다` 를 나열하지 않고 `니다` 로 본다 — 합쇼체는 자음 뒤에서 `-습니다`,
// 모음 뒤에서 `-ㅂ니다` 로 갈려 "씁니다·갑니다·봅니다" 처럼 활용형이 무한하다. 어미를 열거하면
// 정확히 그 활용형들이 빠져 합쇼체가 0 으로 세어진다(실측으로 걸렸다).
// 한계: "아니다" 같은 반말 평서형도 걸린다. 존댓말로 쓰는 이 문체에서는 나오지 않아 감수한다.
const FORMAL_ENDING = '니다';
// `~요` 와 합쇼체만 세고 나머지(명사 종결·인용·목록)는 분모에서 뺀다 — 분모에 넣으면 불릿이
// 많은 글의 종결체 비율이 통째로 내려가 축이 무의미해진다.
// 문단 벽 임계. 문장 길이와 달리 **공백을 포함해** 센다 — 이 지표가 재는 것은 어휘량이 아니라
// 화면에서 덩어리가 차지하는 면적이고, 거기엔 공백도 자리를 차지한다.
// 절 경계 추정에 쓰는 연결어미. 앞 절을 닫고 다음 절로 넘기는 것만 골랐다. 뒤에 공백을 둔
// 이유는 종결형과 겹치는 형태(`-고요`·`-지만요`)를 문장 끝에서 세지 않기 위해서다.
//
// 서로 포함 관계인 어미를 함께 넣지 않는다 — `면서 ` 와 `으면서` 를 같이 두면 "먹으면서 " 가
// 두 번 세어져 홑문장이 복문으로 찍힌다(실측으로 걸렸다). 받침 뒤 활용형(`-으면서`)은 짧은
// 쪽(`면서 `)이 이미 덮는다.
//
// 반대로 모음 뒤 활용형은 일부 놓친다 — `으니 ` 는 있지만 "하니 " 는 못 잡는다. `니 ` 로
// 넓히면 "그러니"·"아니" 가 걸려 절 수가 부풀려지므로, 부풀리는 오탐보다 놓치는 쪽을 택했다.
//
// 남는 한계: 형태소 경계를 보지 않으므로 `고` 로 끝나는 명사 뒤에 공백이 오면("사고 났어요",
// "보고 받았어요") 절로 센다. 위 실측에서 183건 중 7건(3.8%)이었다. 목록으로 막으면 다음
// 명사에 또 뚫리고, 형태소 분석기는 이 패키지가 쓰지 않는다. **절 축은 판정하지 않는
// 관측값이라**(`KOREAN_STYLE_UNJUDGED_AXES`) 이 정도 오차를 안고 간다.
const CLAUSE_CONNECTIVES = [
  // `고 ` 는 인용을 걸러야 해서 이 목록이 아니라 아래 `GO_CONNECTIVE` 정규식이 센다.
  '며 ',
  '지만 ',
  '는데 ',
  '면서 ',
  '어서 ',
  '아서 ',
  '니까 ',
  '으니 ',
  '도록 ',
  '다가 ',
  '거나 ',
  '든지 ',
  '기에 ',
  '느라 ',
  '자마자',
  '라서 ',
];

const PARAGRAPH_WALL_SENTENCE_MIN = 6;
const PARAGRAPH_WALL_LENGTH_MAX = 250;
const NO_SHORT_SENTENCE_MIN = 3;

// 마크다운에서 산문 문단만 골라 문장으로 자른다. 코드·표·헤딩이 섞이면 문장 길이 분포가
// 통째로 왜곡되므로 윤문 대상과 **같은 분해기**를 쓴다.
// 문장 끝에 붙는 닫는 문자. 마침표 뒤에 인용·강조가 오는 문장이 실제 본문에 흔하다
// (`"이 정도면 되겠지" 하고`, `**이렇게 해요.**`). 이걸 빼놓으면 두 곳이 함께 어긋난다 —
// 문장 분리가 안 돼 두 문장이 하나로 합쳐지고, 종결 어미 판정도 닫는 문자에 막혀 누락된다.
// 스마트 인용부호(“ ” ‘ ’)와 마크다운 강조(* _), 한글 인용부호(」 』)까지 함께 본다.
const CLOSING_CHARS = '"\'`)\\]*_”’」』';
const TRAILING_CLOSERS = new RegExp(`[.!?。${CLOSING_CHARS}]+$`);
const SENTENCE_BOUNDARY = new RegExp(
  `(?<=[.!?。][${CLOSING_CHARS}]*)\\s+|\\n+`,
);

// 문장 끝의 마침표·인용·강조를 걷어낸다. 종결 어미를 보는 모든 자리가 이 함수를 지나야
// 한 쪽만 고쳐져 지표가 갈리는 일이 없다.
const stripSentenceTail = (sentence: string): string =>
  sentence.replace(TRAILING_CLOSERS, '');

export const extractProseSentences = (markdown: string): string[] => {
  const { lines, blocks } = scanMarkdownBlocks(markdown);
  const prose = blocks
    .filter((block) => block.kind === 'prose')
    .map((block) => lines.slice(block.startLine, block.endLine + 1).join(' '))
    .join(' ');

  return prose
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
};

// 산문 문단을 그대로(합치지 않고) 꺼낸다. 윤문 어댑터가 모델에 넘기는 단위와 같아야
// "몇 번째 문단이 벽인가"가 카드의 `N/M문단 적용` 과 같은 축에서 읽힌다.
export const extractProseParagraphs = (markdown: string): string[] => {
  const { lines, blocks } = scanMarkdownBlocks(markdown);

  return blocks
    .filter((block) => block.kind === 'prose')
    .map((block) =>
      lines
        .slice(block.startLine, block.endLine + 1)
        .join(' ')
        .trim(),
    )
    .filter((paragraph) => paragraph.length > 0);
};

const splitSentences = (text: string): string[] =>
  text
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

const measureParagraphs = (markdown: string): KoreanStyleParagraphMetrics => {
  const paragraphs = extractProseParagraphs(markdown);
  if (paragraphs.length === 0) {
    return {
      paragraphCount: 0,
      wallPercent: 0,
      noShortSentenceParagraphs: 0,
      dominantParagraphSizePercent: 0,
    };
  }

  let wallCount = 0;
  let noShortCount = 0;
  // 문장 수 → 그 크기인 문단 개수. 4문장과 9문장을 한 칸에 묶지 않는다(묶으면 벽 축과 같아진다).
  const sizeCounts = new Map<number, number>();
  for (const paragraph of paragraphs) {
    const sentences = splitSentences(paragraph);
    sizeCounts.set(
      sentences.length,
      (sizeCounts.get(sentences.length) ?? 0) + 1,
    );
    if (
      sentences.length >= PARAGRAPH_WALL_SENTENCE_MIN ||
      paragraph.length > PARAGRAPH_WALL_LENGTH_MAX
    ) {
      wallCount += 1;
    }
    const hasShort = sentences.some(
      (sentence) => sentence.replace(/\s/g, '').length <= SHORT_SENTENCE_MAX,
    );
    if (sentences.length >= NO_SHORT_SENTENCE_MIN && !hasShort) {
      noShortCount += 1;
    }
  }

  return {
    paragraphCount: paragraphs.length,
    wallPercent: toPercent(wallCount, paragraphs.length),
    noShortSentenceParagraphs: noShortCount,
    dominantParagraphSizePercent: toPercent(
      Math.max(...sizeCounts.values()),
      paragraphs.length,
    ),
  };
};

// 줄표를 센다. 코드블록 안은 빼는데, 명령어나 출력 예시에 든 `—` 는 필자의 문체가 아니다.
//
// 펜스 처리는 `maskFencedCodeBlocks` 에 맡긴다. 직접 `/```[\s\S]*?```/` 로 자르면 `~~~` 펜스와
// ```` 로 연 블록(안쪽 ``` 에서 잘못 닫힌다)과 닫히지 않은 펜스를 놓쳐, 코드 예시가 든 글에서
// 문체에 없는 줄표가 상한을 넘긴다(리뷰 P2). 이 레포는 같은 함정을 이미 겪고 고쳤다.
//
// `keep` 블록 전체를 빼면 안 된다 — 헤딩과 목록 머리말이 함께 빠진다. 이번에 빠져나간 줄표
// 15개 중 12개가 바로 그 자리였다. 펜스만 가리는 이 함수가 맞다.
const countEmDashes = (markdown: string): number =>
  (maskFencedCodeBlocks(markdown).masked.match(/—/g) ?? []).length;

export const measureKoreanStyle = (markdown: string): KoreanStyleMetrics => {
  const sentences = extractProseSentences(markdown);
  if (sentences.length === 0) {
    return {
      sentenceCount: 0,
      averageLength: 0,
      lengthStandardDeviation: 0,
      shortSentencePercent: 0,
      longestSentenceLength: 0,
      longestSentence: '',
      longestSentenceWords: 0,
      wordsPerSentence: 0,
      clausesPerSentence: 0,
      colloquialEndingPercent: 0,
      yoEndingPercent: 0,
      endingAlternationPercent: 0,
      bannedConnectiveCount: 0,
      emDashCount: countEmDashes(markdown),
      measurable: false,
      paragraph: measureParagraphs(markdown),
    };
  }

  // 길이는 공백을 제외해 센다 — 프로파일 실측과 같은 기준이어야 값이 비교 가능하다.
  const lengths = sentences.map(
    (sentence) => sentence.replace(/\s/g, '').length,
  );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const average = total / lengths.length;
  const variance =
    lengths.reduce((sum, length) => sum + (length - average) ** 2, 0) /
    lengths.length;

  const longestIndex = lengths.indexOf(Math.max(...lengths));

  const wordCounts = sentences.map(countWords);
  const clauseCounts = sentences.map(countClauses);

  const colloquialCount = sentences.filter((sentence) =>
    COLLOQUIAL_ENDINGS.some((ending) =>
      stripSentenceTail(sentence).endsWith(ending),
    ),
  ).length;

  // 종결체 두 축.
  // `죠` 도 요체로 센다 — `~지요` 의 축약이라 해요체이면서 글자로는 `요` 로 끝나지 않는다.
  // 빼놓으면 `~죠` 로 문단을 맺는 글이 "요체 6%" 로 찍혀 딱딱한 글로 오독된다(실측: 구어 어미
  // 33개 중 28개가 `죠` 인 글이 그랬다).
  const endingKinds = sentences.map((sentence) => {
    const tail = stripSentenceTail(sentence);
    if (tail.endsWith('요') || tail.endsWith('죠')) {
      return 'yo';
    }
    return tail.endsWith(FORMAL_ENDING) ? 'formal' : 'other';
  });
  const yoCount = endingKinds.filter((kind) => kind === 'yo').length;
  const formalCount = endingKinds.filter((kind) => kind === 'formal').length;

  // 종결체 배치. 분류되지 않는 문장(명사 종결·인용·목록)은 빼고 남은 것들의 인접 쌍만 센다 —
  // 분모에 넣으면 한 문장 건너 끼어든 목록 때문에 배치가 실제보다 고르게 보인다.
  //
  // 문단 경계의 전환도 함께 센다(문서 전체를 평탄화한다). 문단을 `~습니다` 로 닫고 다음 문단을
  // `~요` 로 시작하는 것은 정상 배치라 문단별로 합산해야 한다는 지적을 받았고(PR #372), 개념은
  // 맞다. 그런데 실데이터로 재보면 방향이 반대다 — 문단별로만 세면 자동 발행본이 88→90% ·
  // 80→91% 로 오르고 사용자가 손본 발행본은 38→35% 로 내려간다. 문단이 2문장이면 내부 쌍이
  // 하나뿐이라 「`~요` → `~습니다` 로 닫기」(프롬프트가 권장하는 배치) 가 그 문단의 교대율
  // 100% 가 되기 때문이다. 2026-08-19 발행본(문단 9개 · 전부 2문장)은 문단별로 재면 100% 로
  // 자동 발행본(90%)보다 높아져 순서가 뒤집힌다. 그래서 평탄화를 유지한다.
  //
  // 남는 한계는 기록해 둔다 — 문단이 잘게 나뉜 글에서는 어느 정의를 써도 「정상 닫기」와
  // 「문장마다 갈아타기」를 완전히 분리하지 못한다. 이 값은 판정이 아니라 관측값이고, 카드에
  // 찍힌 숫자를 사람이 읽고 판단한다. 대안으로 뭉침 비율(같은 종결체가 2회 이상 이어지는 문장의
  // 비율)도 재봤다 — 사람 57~79% vs 자동 23~48% 로 갈리지만, 교대율의 여유(사람 최대 59% vs
  // 자동 최소 73%)가 더 커서 바꾸지 않았다.
  const rankedEndings = endingKinds.filter((kind) => kind !== 'other');
  const alternationCount = rankedEndings.filter(
    (kind, index) => index > 0 && kind !== rankedEndings[index - 1],
  ).length;

  const bannedConnectiveCount =
    BANNED_CONNECTIVES.reduce(
      (count, connective) =>
        count +
        sentences.filter((sentence) => sentence.includes(connective)).length,
      0,
    ) + sentences.filter((sentence) => JEUK_PATTERN.test(sentence)).length;

  return {
    sentenceCount: sentences.length,
    averageLength: round(average),
    lengthStandardDeviation: round(Math.sqrt(variance)),
    shortSentencePercent: toPercent(
      lengths.filter((length) => length <= SHORT_SENTENCE_MAX).length,
      lengths.length,
    ),
    longestSentenceLength: lengths[longestIndex],
    longestSentence: sentences[longestIndex],
    longestSentenceWords: wordCounts[longestIndex],
    wordsPerSentence: round(
      wordCounts.reduce((sum, count) => sum + count, 0) / wordCounts.length,
    ),
    clausesPerSentence: round(
      clauseCounts.reduce((sum, count) => sum + count, 0) / clauseCounts.length,
    ),
    colloquialEndingPercent: toPercent(colloquialCount, sentences.length),
    yoEndingPercent:
      yoCount + formalCount === 0
        ? 0
        : toPercent(yoCount, yoCount + formalCount),
    endingAlternationPercent:
      rankedEndings.length < 2
        ? 0
        : toPercent(alternationCount, rankedEndings.length - 1),
    bannedConnectiveCount,
    emDashCount: countEmDashes(markdown),
    measurable: sentences.length >= MEASURABLE_SENTENCE_MIN,
    paragraph: measureParagraphs(markdown),
  };
};

// 카드 한 줄로 적는 요약. 판정이 아니라 관측값이라는 게 드러나야 한다.
/**
 * 재현 목표. 출처는 `style-profile-juneseok.md` §1~§2 실측이다.
 *
 * 왜 코드에 두는가 — 지금까지 카드는 숫자만 던졌다. `편차 23.4` 를 보고도 그게 좋은 값인지
 * 나쁜 값인지 알 수 없어서, 발행본 5편의 지표가 원장에 남아 있는데도 아무도 판정하지 못했다.
 * 기준을 옆에 적어야 수치가 뜻을 갖는다.
 *
 * **이 값들은 발행을 막지 않는다.** 차단선을 정하려면 분포가 필요한데 지금 표본은 5편이고
 * 그중 문단 지표가 있는 것은 3편뿐이라, 한 편이 기준을 통째로 흔든다. 카드에 표시만 해서
 * 판정 사례를 쌓고, 분포가 서면 그때 차단 여부를 정한다.
 *
 * **편차·짧은문장·구어가 여기 없는 이유는 파일 헤더에 있다** — 2026-08-26 에는 표본 출처가
 * 의심스러워 내렸고, 2026-09-02 코퍼스를 확보한 지금은 **판정할 차이가 없어서** 그대로 둔다.
 * 세 축 모두 발행본과 최종본이 같은 범위에 있어, 켜도 걸리는 것이 없다.
 *
 * 값을 바꿀 때는 헤더의 코퍼스로 먼저 재라. **최종본을 실패로 찍는 임계값은 틀린 임계값이다** —
 * 사용자가 손봐서 통과시킨 글이 그 축의 정답이다. 지어낸 기준은 되먹임을 타고 산출물로 나간다.
 *
 * 문단 축(벽·같은크기)은 여기에 없다 — 프로파일 실측에 대응 항목이 없어 기준을 지어내야 한다.
 * 없는 기준으로 판정하느니 수치만 보여주는 편이 낫다.
 */
export const KOREAN_STYLE_TARGETS = {
  // 읽기 어려운 만연체 상한.
  //
  // 80 이었을 때 이 축은 **최종본 9편을 전부 실패로 찍었다**(분포 100~146자). 사용자가 손봐서
  // 통과시킨 글을 하나도 남김없이 목표 밖으로 판정하는 기준은 기준이 아니다. 실제 피해도 컸다 —
  // 2026-08-29 ~ 09-02 윤문 회차에 「최장 82자(≤80)」 류 지적이 매번 찍혔고, 되먹임
  // (`style-feedback.ts`)이 그 항목을 반복 갭으로 골라 다음 회차 프롬프트에 실었다. 모델은
  // 사용자가 신경 쓰지 않는 축을 매 회차 붙잡고 있었다.
  //
  // 150 은 코퍼스 최대(146)에 여유를 얹은 값이다. 최종본 9편은 전부 통과하고, 발행본에서
  // 관측된 191자는 그대로 걸린다.
  //
  // **프롬프트의 「80자를 넘기지 마라」(`humanize-system.prompt.ts`)와 값이 다른 것은 의도다.**
  // 그쪽은 짧게 가라는 **방향 지시**이고 이쪽은 「이건 확실히 잘못됐다」는 **방어선**이라 역할이
  // 다르다. 방향 지시를 150 으로 올리면 모델이 그 길이를 허용 범위로 읽을 수 있는데, 그렇게
  // 했을 때 어떻게 되는지는 실측이 없다(80 지시로도 191자가 나온 기록만 있다). 두 값을 맞추려면
  // 프롬프트를 바꿔 돌려 보고 그 결과로 정해야 한다.
  longestSentenceMax: 150,
  // 종결체 교대율 상한. 비율이 맞아도 문장마다 갈아타면 그 자체가 기계적으로 읽힌다.
  //
  // 실측(2026-09-02 코퍼스): 최종본 9편이 **전부 0%** vs 발행본 3편 9%. 두 무리가 겹치지
  // 않는다. 옛 값 60 은 발행본의 9% 도 통과시켜 사실상 아무것도 막지 않았다.
  //
  // 5 로 조인 것은 0 으로 두면 문장 하나의 측정 요동에 걸리기 때문이다. 사용자 글이 전부 0%
  // 이므로 이 여유가 최종본을 위태롭게 하지 않는다.
  endingAlternationPercentMax: 5,
  bannedConnectiveMax: 0,
  // 호흡. 편차만 보면 "들쭉날쭉한가" 는 알아도 "숨이 가쁜가" 는 모른다 — 2026-08-26 발행본이
  // 편차 11(통과)·평균 33.2자였는데 사용자 판정은 "호흡이 너무 짧다" 였다.
  //
  // **이 값의 근거는 그 판정 하나다.** 사용자 글의 평균 44.7자를 근거로 들었던 앞선 주석은
  // 지웠다 — 그 수치는 15문장 표본에서 나왔고, 이 파일이 스스로 집행하는 문턱
  // (`MEASURABLE_SENTENCE_MIN = 40`)을 통과하지 못한다. 자기가 무의미하다고 판정하는 크기의
  // 표본을 기준으로 삼고 있었다. 프로파일 문서도 그 항의 수치를 재현 대상으로 쓰지 말라고
  // 적어 두었는데 주석이 독자를 정확히 그 자리로 안내했다.
  //
  // **35 는 임시 눈금이었고, 이제 실측으로 바뀐다.** 코퍼스 9편의 편별 평균은 38.6 ~ 57.0자
  // (합산 49.6)이고, 38 은 그 최저값 바로 아래다. 최종본을 하나도 실패로 찍지 않는 선에서
  // 가장 높은 하한이 이 값이다.
  //
  // **이 값은 목표가 아니라 최소 방어선이다.** 사용자가 도달시키는 곳은 49.6자 부근이지만,
  // 하한을 거기 두면 코퍼스 9편 중 3편이 미달로 찍힌다 — 사용자 글을 실패시키는 기준은 틀린
  // 기준이다. 모델을 더 긴 호흡으로 미는 일은 하한이 아니라 프롬프트가 맡는다
  // (`renderBreathFeedback` 이 실측값을 돌려주는 경로).
  averageLengthMin: 38,
  // 호흡을 어절로 잰 하한. 위 `averageLengthMin` 이 글자 수라 영문 비중에 휘둘리는 것을 보완한다.
  //
  // 실측(2026-09-01, 블로그 8월 글 9편): 「호흡이 짧다」 고 지적받은 7편 8.7~9.9어절 vs 지적
  // 없던 2편 12.0~12.2어절. 두 무리가 겹치지 않아 그 사이에 둔다. 종결체 교대율과 같은 방식으로
  // 얻은 경계다.
  //
  // **이 축이 필요한 이유는 지적받은 7편이 글자 수 기준을 전부 통과했다는 데 있다.** 그중
  // 2026-08-24 발행본은 미달 축이 하나도 없는 상태로 「문장마다 끊겨 격자로 읽힌다」 는 판정을
  // 받았다. 평균 41.9자로 하한을 넘겼지만 8.7어절이었다.
  //
  // **11 → 10 (2026-09-02).** 위 실측은 지적 **당시**, 즉 사람이 고치기 전 상태였다. 그 뒤
  // 수정이 끝난 최종본 9편의 분포는 10.9 ~ 12.7어절이라, 11 은 하한이 10.9 편을 미달로 찍는다.
  // 10 이면 최종본은 전부 통과하고 위 8.7~9.9 무리는 그대로 걸린다 — 두 실측이 모순되지 않는다.
  wordsPerSentenceMin: 10,
  // 스킬 룰북 J-3 의 "1문서 1~2회 이하" 를 그대로 옮긴다. 0 이 아닌 이유는 한 번쯤은
  // 자연스러운 자리가 있기 때문이고, 상한을 두는 이유는 15개가 들어간 발행본이 실제로 나갔기 때문이다.
  emDashMax: 2,
} as const;

/**
 * 판정하지 않는 축과 그 이유. 카드 문구가 "모든 지표를 충족" 으로 읽히지 않게 하려면
 * 무엇이 판정 대상 밖인지 여기 적어 두어야 한다.
 *
 * - **편차 · 짧은문장 · 구어**(2026-08-26 추가): 프로파일 §1 에서 온 값인데 그 표본의 출처가
 *   의심된다. 본인 확인 글과 방향이 어긋나거나(짧은문장 6.7% vs 목표 20% 이상) 본인 글을
 *   상한으로 누른다(구어 33.3% vs 목표 20% 이하). 근거는 파일 헤더의 대조표.
 * - **요체 비율**: 기준이 없다. 프로파일의 "`~습니다` 와 `~요` 가 반반" 은 2026-08-24 에
 *   **재현 대상에서 내려갔다**(`humanize-system.prompt.ts` 의 종결체 절). 지금 지시는
 *   "해요체가 기본이고 `~습니다` 는 한 값의 절반을 넘기지 않는다" 라, 지시를 잘 따른 글일수록
 *   해요체가 높다. 낡은 40~60% 로 재면 잘 쓴 글이 목표 밖으로 찍힌다. 새 범위를 정할 실측
 *   분포가 아직 없어 **판정을 보류하고 수치만 보여준다**.
 * - **문단 축(벽·같은크기)**: 프로파일 실측에 대응 항목이 없다.
 */
export const KOREAN_STYLE_UNJUDGED_AXES = [
  '편차',
  '짧은문장',
  '구어',
  '요체 비율',
  '문단 축',
  '절',
] as const;

/**
 * 목표를 벗어난 항목만 골라 "값(기준)" 꼴로 돌려준다. 전부 맞으면 빈 배열이다.
 *
 * 40문장 미만이면 **문장 축**을 보류한다 — 문장 하나가 비율을 10%p 씩 흔들어 판정이 무의미하다.
 * 이때 카드에는 판정 줄 대신 기존의 "참고값" 단서만 남는다.
 *
 * 줄표는 문장 수와 무관한 **문서 축**이라 표본이 작아도 판정한다. 보류에 함께 묶으면 짧은 글은
 * 줄표가 몇 개든 카드에 안 찍힌다(리뷰 P2).
 */
// 목표 밖 항목 하나. `axis` 는 어느 축인지, `text` 는 사람이 읽는 표기다.
//
// 왜 축을 따로 내보내는가 — 재시도 수락 판정이 "새로 생긴 축이 있나" 를 물어야 하는데,
// 표기 문자열에서 축 이름을 파싱하면 라벨을 다듬는 순간 그 판정이 조용히 무력해진다.
// 조건은 아래 한 자리에만 두고, 축과 표기를 함께 만들어 나눠 준다.
type KoreanStyleGap = {
  axis: string;
  text: string;
};

const collectKoreanStyleGaps = (
  metrics: KoreanStyleMetrics,
): KoreanStyleGap[] => {
  const gaps: KoreanStyleGap[] = [];
  const T = KOREAN_STYLE_TARGETS;
  // 문장 축은 40문장 이상일 때만 판정한다. main 이 표본 출처 의심으로 편차·짧은문장·구어를
  // 내렸고(#398), 남은 축에 이번 평균 하한이 더해진다.
  if (metrics.measurable) {
    if (metrics.longestSentenceLength > T.longestSentenceMax) {
      gaps.push({
        axis: 'longestSentence',
        text: `최장 ${metrics.longestSentenceLength}자(≤${T.longestSentenceMax})`,
      });
    }
    if (metrics.endingAlternationPercent > T.endingAlternationPercentMax) {
      gaps.push({
        axis: 'endingAlternation',
        text: `종결체교대 ${metrics.endingAlternationPercent}%(≤${T.endingAlternationPercentMax}%)`,
      });
    }
    if (metrics.bannedConnectiveCount > T.bannedConnectiveMax) {
      gaps.push({
        axis: 'bannedConnective',
        text: `금지접속사 ${metrics.bannedConnectiveCount}회(0회)`,
      });
    }
    if (metrics.wordsPerSentence < T.wordsPerSentenceMin) {
      gaps.push({
        axis: 'wordsPerSentence',
        text: `어절 ${metrics.wordsPerSentence}개(≥${T.wordsPerSentenceMin}개)`,
      });
    }
    if (metrics.averageLength < T.averageLengthMin) {
      gaps.push({
        axis: 'averageLength',
        text: `평균 ${metrics.averageLength}자(≥${T.averageLengthMin}자)`,
      });
    }
  }
  // 줄표는 문장 수와 무관한 문서 축이라 표본이 작아도 판정한다.
  if (metrics.emDashCount > T.emDashMax) {
    gaps.push({
      axis: 'emDash',
      text: `줄표 ${metrics.emDashCount}회(≤${T.emDashMax}회)`,
    });
  }
  return gaps;
};

export const findKoreanStyleGaps = (metrics: KoreanStyleMetrics): string[] =>
  collectKoreanStyleGaps(metrics).map((gap) => gap.text);

// 목표 밖인 축의 이름만. 재시도 수락 판정이 개수가 아니라 **정체**를 보게 하려고 쓴다.
export const findKoreanStyleGapAxes = (metrics: KoreanStyleMetrics): string[] =>
  collectKoreanStyleGaps(metrics).map((gap) => gap.axis);

export const formatKoreanStyleMetrics = (
  metrics: KoreanStyleMetrics,
): string => {
  if (metrics.sentenceCount === 0) {
    return '문체 지표: 측정할 산문이 없음';
  }
  const head = `문체 지표: 문장 ${metrics.sentenceCount}개 · 평균 ${metrics.averageLength}자 · 어절 ${metrics.wordsPerSentence}개 · 절 ${metrics.clausesPerSentence}개 · 편차 ${metrics.lengthStandardDeviation} · 짧은문장 ${metrics.shortSentencePercent}% · 최장 ${metrics.longestSentenceLength}자 · 구어 ${metrics.colloquialEndingPercent}% · 요체 ${metrics.yoEndingPercent}% · 종결체교대 ${metrics.endingAlternationPercent}% · 금지접속사 ${metrics.bannedConnectiveCount}회 · 줄표 ${metrics.emDashCount}회`;
  const paragraph = `문단 ${metrics.paragraph.paragraphCount}개 · 벽 ${metrics.paragraph.wallPercent}% · 같은크기 ${metrics.paragraph.dominantParagraphSizePercent}% · 짧은문장 없는 문단 ${metrics.paragraph.noShortSentenceParagraphs}개`;
  // 참고값 단서는 문장 축 이야기다. 문단 줄 뒤에 붙이면 문단 지표까지 참고값이라는 오해를 부른다.
  const sentenceLine = metrics.measurable
    ? head
    : `${head} (40문장 미만이라 참고값)`;
  const gaps = findKoreanStyleGaps(metrics);
  // 수치만 있는 카드는 좋은 값인지 나쁜 값인지 알려주지 못한다. 기준을 값 옆에 붙여 적는다.
  // 문장 축이 보류돼도 줄표 같은 문서 축은 걸린다. "판정 대상 충족" 은 문장 축을 실제로 판정한
  // 글에만 쓴다 — 보류된 글에 붙이면 재지도 않은 축까지 통과한 것으로 읽힌다.
  const verdict =
    gaps.length > 0
      ? `\n목표 밖: ${gaps.join(' · ')}`
      : metrics.measurable
        ? `\n판정 대상 충족 (${KOREAN_STYLE_UNJUDGED_AXES.join('·')}은 판정 밖)`
        : '';
  // 판정 줄은 「기준에서 얼마나 벗어났나」까지만 알려준다. **무엇이 길었는지**는 숫자로 갈리지
  // 않는다 — 끊어야 할 만연체와, 고유명사 불변 규칙 때문에 끊을 수 없는 영문 이름 나열이
  // 같은 91자로 찍힌다. 넘겼을 때만 그 문장을 덧붙여 사람이 읽고 판단하게 한다.
  const longest =
    metrics.longestSentenceLength > KOREAN_STYLE_TARGETS.longestSentenceMax
      ? `\n최장 문장(${metrics.longestSentenceLength}자 · ${metrics.longestSentenceWords}어절): ${truncate(metrics.longestSentence, LONGEST_SENTENCE_PREVIEW)}`
      : '';
  return `${sentenceLine}\n${paragraph}${verdict}${longest}`;
};

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`;

const round = (value: number): number => Math.round(value * 10) / 10;

const countWords = (sentence: string): number =>
  sentence.trim().split(/\s+/).filter(Boolean).length;

// `고 ` 만 정규식으로 따로 센다. 앞 글자가 `다·라·냐·자` 면 인용·간접화법이라 앞 절을 닫지
// 않는데도 걸린다 — "…“lethal trifecta”라고 불렀잖아요"·"…있다고 설명해요" 가 그렇다.
// 블로그 9편 실측: `고 ` 매칭 183건 중 43건(23.5%)이 인용이었다.
const GO_CONNECTIVE = /(?<![다라냐자])고 /g;

const countClauses = (sentence: string): number =>
  1 +
  (sentence.match(/,/g) ?? []).length +
  (sentence.match(GO_CONNECTIVE) ?? []).length +
  CLAUSE_CONNECTIVES.reduce(
    (count, connective) => count + sentence.split(connective).length - 1,
    0,
  );

const toPercent = (count: number, total: number): number =>
  Math.round((count / total) * 100);
