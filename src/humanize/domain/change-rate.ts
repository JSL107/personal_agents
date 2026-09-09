// 윤문 전후 변경률 — "문체만 손댔는가, 아니면 통째로 새로 썼는가" 를 재는 축.
//
// 왜 필요한가 — `humanize-system.prompt.ts` 의 「과윤문 금지」 절은 의미를 바꾸지 말라고
// 지시하지만, 실제로 얼마나 바뀌었는지 재는 자리가 없었다. 내용 훼손은
// `content-preservation.ts` 가 숫자·고유명사·URL 단위로 잡는데, 그 셋을 건드리지 않으면서
// 문장을 통째로 갈아 끼우는 경우는 어느 축에도 안 걸린다.
//
// **상류(`metrics_v2.py` 의 `change_rate`)와 계산식이 다르다.** 상류는 파이썬 `difflib`
// (Ratcliff/Obershelp) 문자 유사도의 보수를 쓰는데 Node 에는 대응물이 없고, 최장 공통
// 부분수열은 장문(1만 자 본문)에서 O(n·m) 이라 발행 경로에 얹기 부담스럽다. 여기서는
// **문자 바이그램 Dice 계수의 보수**를 쓴다 — O(n) 이고 의존성이 없다.
//
// 그래서 **상류의 임계값(0.30 경고 · 0.50 중단)을 그대로 쓸 수 없다.** 계산식이 다르면 같은
// 글에서 다른 수가 나온다. 임계는 이 레포의 실측으로 따로 정한다(아래 상수 주석 참조).

// 공백 묶음은 하나로 본다 — 줄바꿈을 다시 흘려 담은 것은 문체 변경이 아니다.
const WHITESPACE_RUN = /\s+/g;

// 자모 분해형(NFD)을 조합형으로 맞춘다. macOS 파일·클립보드 경유 텍스트가 NFD 로 들어오면
// 같은 글자가 코드포인트로는 달라서, 어미만 바꾼 글이 「전면 교체(1.0)」로 잡힌다.
const normalize = (text: string): string =>
  text.normalize('NFC').replace(WHITESPACE_RUN, ' ').trim();

const toBigramCounts = (text: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (let index = 0; index + 1 < text.length; index += 1) {
    const bigram = text.slice(index, index + 2);
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }
  return counts;
};

const countTotal = (counts: Map<string, number>): number => {
  let total = 0;
  for (const count of counts.values()) {
    total += count;
  }
  return total;
};

const countShared = (
  left: Map<string, number>,
  right: Map<string, number>,
): number => {
  let shared = 0;
  for (const [bigram, count] of left) {
    shared += Math.min(count, right.get(bigram) ?? 0);
  }
  return shared;
};

/**
 * 0(그대로) ~ 1(완전히 다른 글). 문자 바이그램이 얼마나 겹치는지로 잰다.
 *
 * 어순만 바꾼 문장은 낮게 나온다 — 이 축이 잡으려는 것은 "통째로 새로 썼는가" 이지
 * "얼마나 정교하게 고쳤는가" 가 아니다.
 */
export const measureChangeRate = (before: string, after: string): number => {
  const left = normalize(before);
  const right = normalize(after);
  if (left === right) {
    return 0;
  }
  // 한 글자짜리는 바이그램이 없다. 같지 않다는 것은 위에서 이미 갈렸으므로 전면 교체로 본다.
  if (left.length < 2 || right.length < 2) {
    return 1;
  }
  const leftCounts = toBigramCounts(left);
  const rightCounts = toBigramCounts(right);
  const total = countTotal(leftCounts) + countTotal(rightCounts);
  if (total === 0) {
    return 0;
  }
  return 1 - (2 * countShared(leftCounts, rightCounts)) / total;
};

// 과윤문 롤백선 — **변경률로는 판정하지 않는다.**
//
// 변경률을 임계로 쓰려던 설계를 실측으로 접었다. 2026-09-09 —
//
//   정상 간결화 「현재 시점에서는 해당 기능을 사용하는 것이 불가능한 상태입니다.」
//              → 「지금은 이 기능을 쓸 수 없어요.」                        0.804
//   완전히 무관한 두 글                                                    0.816
//
// **두 무리의 간격이 0.012 다.** 어떤 임계를 놔도 갈라지지 않는다. 이 레포 프롬프트가 길이를
// 원문의 70% 이하로 줄이라고 시키므로(`HUMANIZE_CONCISE_RULES`) 충실한 윤문도 문자를 대부분
// 버리기 때문이다. 상류 스킬이 0.30/0.50 을 쓸 수 있는 것은 그쪽이 길이 축소를 지시하지 않아서다.
// 두 무리가 겹치는 축은 판정에 넣지 않는다는 이 레포의 원칙(`korean-style-metrics.ts` 헤더)이
// 그대로 적용된다 — 변경률은 원장에 쌓는 관측값으로만 둔다.
//
// 대신 **길이 유지율**로 판정한다. 문자 유사도와 달리 이 축은 갈린다 —
//
//   프롬프트가 지시하는 목표                          0.70
//   위 정상 간결화 실측(17자 / 32자)                  0.53
//   내용을 날려 먹은 출력(한 줄 요약으로 대체 등)     0.20 미만
//
// 그래서 지시받은 목표(0.70)의 절반보다도 낮은 자리에 둔다.
//
// **이 가드가 못 잡는 것을 분명히 해 둔다** — 길이가 비슷하면서 내용만 다른 글은 안 걸린다.
// 그건 의미 판정이라 문자로는 불가능하고, 숫자·고유명사·URL 훼손은 `content-preservation.ts`
// 가 따로 잡는다. 여기서 막는 것은 「내용을 통째로 날린 출력」 하나다.
export const MIN_LENGTH_RETENTION = 0.3;

// 이보다 짧은 필드는 판정하지 않는다. 한두 낱말을 덜어낸 것만으로 비율이 크게 흔들린다.
export const OVER_REWRITE_MIN_LENGTH = 20;

/**
 * 윤문본이 원문 대비 얼마나 남았는가. 1 이면 같은 길이, 0.5 면 절반으로 줄었다.
 */
export const measureLengthRetention = (
  before: string,
  after: string,
): number => {
  const beforeLength = normalize(before).length;
  if (beforeLength === 0) {
    return 1;
  }
  return normalize(after).length / beforeLength;
};

/**
 * 내용을 통째로 날린 출력인가. 원문으로 되돌려야 한다.
 *
 * 이름에 「과윤문」을 쓰지 않은 것은 실제로 재는 것이 길이 유지율이기 때문이다 — 문장을
 * 통째로 갈아 끼웠지만 길이가 비슷한 경우는 여기 안 걸린다(위 상수 주석 참조).
 */
export const isContentDropped = (before: string, after: string): boolean =>
  normalize(before).length >= OVER_REWRITE_MIN_LENGTH &&
  measureLengthRetention(before, after) < MIN_LENGTH_RETENTION;
