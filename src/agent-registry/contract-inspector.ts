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
 * "주장이 없으면 근거도 없다" — 목록형 산출물이 전부 비어 있는지 판정한다.
 *
 * CODE_REVIEWER 가 지적 없이 승인한 리뷰(`findings: []` · `mustFix: []`)는 근거를
 * 붙일 대상 자체가 없는 정상 산출물인데, 근거 패턴만 보면 통째로 위반으로 잡힌다.
 * 2026-08-03 실측에서 CODE_REVIEWER `noEvidence` 4건이 **전부** 이 경우였다
 * (성공 실행 14건 중 4건 = 29%, 정탐 0건).
 *
 * 보는 대상은 **계약이 요구한 필드(`deliverableFields`) 중 배열인 것**뿐이다.
 * 산출물 전체의 배열을 훑으면 계약과 무관한 부수 배열 하나가 비어 있다는 이유로
 * 근거 요구가 통째로 꺼진다. 계약이 목록으로 내라고 한 것이 하나도 없는 산출물
 * (BLOG 의 `notionUrl`·`published`)은 면제 대상이 아니다 — 비어 있음을 판정할
 * 목록이 없는데 면제하면 근거 요구가 무력해진다.
 */
function hasNoClaims(
  output: PlainObject,
  deliverableFields: readonly string[],
): boolean {
  const lists = deliverableFields
    .map((field) => output[field])
    .filter(Array.isArray);
  return lists.length > 0 && lists.every((list) => list.length === 0);
}

export function inspectContract(
  agentType: AgentType,
  output: unknown,
): readonly ContractViolation[] {
  // 산출물이 객체가 아니면(배열·문자열·null) 최상위 키 개념이 성립하지 않는다.
  // 계약을 억지로 적용하지 않고 검사를 건너뛴다.
  if (isPlainObject(output) === false) {
    return [];
  }

  const contract = AGENT_CONTRACTS[agentType];
  const violations: ContractViolation[] = [];

  for (const field of contract.deliverableFields) {
    if (isEmptyValue(output[field])) {
      violations.push({ rule: 'missingField', detail: field });
    }
  }

  const serialized = JSON.stringify(output) ?? '';

  const forbidden = [
    ...COMPANY_FORBIDDEN_PHRASES,
    ...(contract.forbidPhrases ?? []),
  ];
  for (const phrase of forbidden) {
    if (serialized.includes(phrase)) {
      violations.push({ rule: 'forbiddenPhrase', detail: phrase });
    }
  }

  if (
    contract.requireEvidence &&
    hasNoClaims(output, contract.deliverableFields) === false &&
    EVIDENCE_PATTERN.test(serialized) === false
  ) {
    violations.push({ rule: 'noEvidence', detail: agentType });
  }

  return violations;
}
