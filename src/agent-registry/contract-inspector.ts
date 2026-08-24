import { AgentType } from '../model-router/domain/model-router.type';
import { AGENT_CONTRACTS, COMPANY_FORBIDDEN_PHRASES } from './agent-contract';

/**
 * 직무 계약 검수기 — 산출물이 소속 부서의 계약을 지켰는지 검사한다.
 *
 * LLM 을 호출하지 않는 순수 함수다. 필수 필드 누락 · 금칙어 · 근거 부재처럼
 * 기계적으로 판정 가능한 것만 본다. "추상적인 감상으로 끝나지 않았는가" 같은
 * 판단형 기준은 다루지 않는다 (그건 검수 LLM 의 영역이고, 도입 여부는
 * 이 검수기가 쌓은 위반 통계를 보고 판단한다).
 *
 * 1단계에서는 **차단하지 않는다** — `AgentRunService` 가 결과를 기록만 하고
 * 실행 상태는 바꾸지 않는다. 기존 산출물이 새 계약을 얼마나 지키는지 모르는
 * 상태에서 반려를 걸면 매일 도는 cron 이 무더기로 막히기 때문이다.
 *
 * 설계 근거: `docs/superpowers/specs/2026-07-31-idaeri-company-rules-design.md`
 */

export type ContractViolationRule =
  | 'missingField'
  | 'forbiddenPhrase'
  | 'noEvidence';

export interface ContractViolation {
  readonly rule: ContractViolationRule;
  /** 위반 대상 — 누락된 필드명 / 발견된 금칙어 / 근거가 없는 에이전트 타입. */
  readonly detail: string;
}

/**
 * 근거로 인정하는 패턴.
 *
 * 텍스트 형태(URL · `#123` PR 참조 · `파일:라인`) 뿐 아니라 **구조화된 근거 필드**
 * 까지 본다. CODE_REVIEWER 는 근거를 본문 텍스트가 아니라 `findings[].file` /
 * `line` 으로 담기 때문에, 텍스트 패턴만 보면 근거가 충실한 산출물을 통째로
 * 위반으로 잡는다(2026-07-31 실측에서 확인).
 *
 * 구조화 필드는 **값까지** 본다. 키 존재만 보면 `{"file": ""}` 이나 `{"url": null}`
 * 처럼 값이 빈 산출물이 근거가 있는 것으로 통과해 관측 통계에 false negative 가 쌓인다
 * (`pr-review.parser.ts` 는 빈 문자열 `file` 을 허용한다).
 *
 * `taskId` 는 근거 목록에서 뺐다 — 내부 식별자일 뿐 사람이 따라가 확인할 수 있는
 * 출처가 아니다.
 */
const EVIDENCE_PATTERN = new RegExp(
  [
    'https?://', // URL
    '#\\d+', // PR / 이슈 참조
    '[\\w./-]+\\.(?:ts|tsx|js|md|prisma|json):\\d+', // 파일:라인
    // 구조화 문자열 근거 — 비어 있지 않은 값만 인정(공백뿐인 값도 배제).
    // 비공백 문자 클래스에서 따옴표를 빼는 게 중요하다. `\S` 로 두면 그것이 닫는 따옴표를
    // 먹고 다음 키까지 넘어가, `"file":""` 같은 빈 값이 `"","` 로 매치돼 통과한다.
    '"(?:file|url|link|notionUrl|htmlUrl|permalink)"\\s*:\\s*"[^"]*[^"\\s][^"]*"',
    // 구조화 숫자 근거 — 1 이상만. 줄 번호와 PR 번호는 1부터라 0 은 "값 없음" 의 표현이다.
    '"(?:prNumber|line)"\\s*:\\s*[1-9]\\d*',
  ].join('|'),
);

interface PlainObject {
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is PlainObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(value) === false
  );
}

/**
 * 필수 필드의 "비어 있음" 판정.
 *
 * 빈 배열·빈 객체는 비어 있다고 보지 않는다 — 지적 사항이 없어 `findings: []`,
 * 정량 근거가 없어 `quantitative: []` 인 경우는 정상 산출물이다. 이걸 위반으로
 * 잡으면 오탐이 쌓여 정작 봐야 할 신호가 묻힌다.
 */
function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  return false;
}

/**
 * "주장이 없으면 근거도 없다" — 계약이 지정한 주장 목록이 전부 비어 있는지 판정한다.
 *
 * CODE_REVIEWER 가 지적 없이 승인한 리뷰(`findings: []` · `mustFix: []`)는 근거를
 * 붙일 대상 자체가 없는 정상 산출물인데, 근거 패턴만 보면 통째로 위반으로 잡힌다.
 * 2026-08-03 실측에서 CODE_REVIEWER `noEvidence` 4건이 **전부** 이 경우였다
 * (성공 실행 14건 중 4건 = 29%, 정탐 0건).
 *
 * 어느 필드가 주장인지는 계약의 `claimFields` 가 정한다. 지정이 없으면 면제하지
 * 않는다 — 사유는 `AgentContract.claimFields` 주석 참조.
 */
function hasNoClaims(
  output: PlainObject,
  claimFields: readonly string[] | undefined,
): boolean {
  if (!claimFields || claimFields.length === 0) {
    return false;
  }
  const lists = claimFields.map((field) => output[field]).filter(Array.isArray);
  return lists.length > 0 && lists.every((list) => list.length === 0);
}

/**
 * 검수 결과 — 위반 목록과 그것을 점수로 환산한 값.
 *
 * 위반 목록만으로는 "얼마나" 를 알 수 없다. 필수 필드 3 개 중 1 개가 빈 산출물과
 * 3 개 모두 빈 산출물이 똑같이 "위반 있음" 으로 뭉개져, 워커별 산출물이 나빠지는
 * 추세를 볼 수 없다. 점수는 그 해상도를 준다.
 */
export interface ContractEvaluation {
  readonly violations: readonly ContractViolation[];
  /** 점수 분모 — 이 산출물에 실제로 적용된 검사 항목 수. */
  readonly checkedCount: number;
  /**
   * 통과한 검사 항목 수. **금칙어 차감 전** 값이다 — 금칙어는 항목이 아니라 감점이라
   * 이 수에 섞으면 "몇 항목을 지켰나" 를 읽을 수 없게 된다. 차감은 `score` 에만 반영된다.
   */
  readonly passedCount: number;
  /**
   * 0.0 ~ 1.0. 검사 항목이 0 개면 `null`.
   *
   * `null` 을 `1.0` 으로 바꾸지 않는 것이 이 설계의 핵심이다. 계약이 스텁이라 아무것도
   * 검사하지 않은 실행과 모든 검사를 통과한 실행이 같은 값을 가지면, 무검사가 만점으로
   * 위장돼 평균이 조용히 부풀려진다.
   */
  readonly score: number | null;
}

/**
 * 산출물을 계약과 대조해 위반과 점수를 함께 낸다.
 *
 * 금칙어는 **분모에 넣지 않는다.** 넣으면 모든 계약이 "금칙어 없음" 항목 하나를 공짜로
 * 통과해 점수가 위로 눌린다(2026-08-24 실측에서 공통 금칙어 4 개의 적중은 성공 실행
 * 1,067 건 중 0 건이었다). 대신 걸렸을 때 분자에서 깎아 실제로 점수가 내려가게 한다.
 *
 * 근거 요구는 면제되면(주장이 하나도 없는 산출물) 분모에서도 빠진다 — 검사하지 않은
 * 항목을 통과로 세면 그것도 점수를 부풀리는 쪽이다.
 */
export function evaluateContract(
  agentType: AgentType,
  output: unknown,
): ContractEvaluation {
  const contract = AGENT_CONTRACTS[agentType];

  // 산출물이 객체가 아니면(배열·문자열·null) 최상위 키 개념이 성립하지 않는다.
  //
  // 계약이 스텁이면 검사할 것이 없으니 그대로 건너뛴다 — 배열을 그대로 내보내는
  // REVIEW_REPLY_JUDGE 같은 경우다.
  //
  // 그러나 **계약이 요구하는 것이 있는데 객체가 아니면 그건 형식 오류다.** 이 경우도
  // `score: null` 로 두면 "계약이 스텁이라 무검사" 와 같은 값이 되어, 조회 스크립트가
  // 그 실행을 무검사 집계에 넣고 형식 오류를 숨긴다. 필수 필드를 하나도 확인할 수
  // 없었으므로 전부 누락으로 보고하고 0 점을 준다.
  if (isPlainObject(output) === false) {
    const evidenceChecked = contract.requireEvidence ? 1 : 0;
    const checkedCount = contract.deliverableFields.length + evidenceChecked;
    if (checkedCount === 0) {
      return {
        violations: [],
        checkedCount: 0,
        passedCount: 0,
        score: null,
      };
    }
    const violations: ContractViolation[] = contract.deliverableFields.map(
      (field) => ({ rule: 'missingField', detail: field }),
    );
    if (contract.requireEvidence) {
      violations.push({ rule: 'noEvidence', detail: agentType });
    }
    return {
      violations,
      checkedCount,
      passedCount: 0,
      score: 0,
    };
  }

  const violations: ContractViolation[] = [];

  let checkedCount = 0;
  let passedCount = 0;

  for (const field of contract.deliverableFields) {
    checkedCount += 1;
    if (isEmptyValue(output[field])) {
      violations.push({ rule: 'missingField', detail: field });
    } else {
      passedCount += 1;
    }
  }

  const serialized = JSON.stringify(output) ?? '';

  const forbidden = [
    ...COMPANY_FORBIDDEN_PHRASES,
    ...(contract.forbidPhrases ?? []),
  ];
  let forbiddenHits = 0;
  for (const phrase of forbidden) {
    if (serialized.includes(phrase)) {
      violations.push({ rule: 'forbiddenPhrase', detail: phrase });
      forbiddenHits += 1;
    }
  }

  if (
    contract.requireEvidence &&
    hasNoClaims(output, contract.claimFields) === false
  ) {
    checkedCount += 1;
    if (EVIDENCE_PATTERN.test(serialized)) {
      passedCount += 1;
    } else {
      violations.push({ rule: 'noEvidence', detail: agentType });
    }
  }

  // 금칙어는 분모를 늘리지 않고 분자에서만 깎는다. 하한 0 — 금칙어가 필수 필드보다
  // 많아도 음수 점수가 나오지 않게 한다.
  const scoredPass = Math.max(0, passedCount - forbiddenHits);

  return {
    violations,
    checkedCount,
    passedCount,
    score: checkedCount === 0 ? null : scoredPass / checkedCount,
  };
}

/**
 * 위반 목록만 필요한 호출부를 위한 얇은 래퍼.
 *
 * 검사 본체는 `evaluateContract` 하나다 — 두 함수가 각자 검사 로직을 들면 반드시
 * 어긋난다.
 */
export function inspectContract(
  agentType: AgentType,
  output: unknown,
): readonly ContractViolation[] {
  return evaluateContract(agentType, output).violations;
}
