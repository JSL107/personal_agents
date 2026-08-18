import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { CareerMateException } from '../career-mate.exception';
import {
  AuditItem,
  CareerProfileData,
  CareerTargetJdData,
  JdFinding,
  RejectionRisk,
  ResumeAuditData,
} from '../career-mate.type';
import { CareerMateErrorCode } from '../career-mate-error-code.enum';

export const RESUME_AUDIT_SYSTEM_PROMPT = `너는 지원자의 이력서를 "증거가 있는가"만으로 판정하는 서류 심사자다.
채용 담당자 시각(기본 자격·키워드)과 실무 관리자 시각(기술 깊이)을 섞지 말고, 아래 기준 하나만 적용한다.
아래 JSON 하나로만 출력한다. 설명/주석/코드펜스 없이 JSON 만.

판정 기준:
- "PROVEN": 상황·행동·결과가 모두 있고 결과에 수치·규모·비율이 있다.
  quote 에 입력 원문을 그대로 복사해 근거를 남긴다. 원문에서 복사할 수 없으면 PROVEN 이 아니다.
- "WEAK": 언급은 있으나 위 요소 중 하나 이상이 없다(수치 없음, 한 일만 나열, 결과 불명).
- "MISSING": 해당 내용이 이력서에 아예 없다.
- 애매하면 낮은 쪽(WEAK)으로 내린다. 관대한 판정은 이 작업의 실패다.

verdict 규칙:
- 항목 수를 세어 쓰지 않는다 — 집계는 코드가 하고, 네가 센 숫자와 어긋나면 화면에 모순된 수가 함께 뜬다.
- 무엇이 부족한지만 한두 문장으로 쓴다.

items 규칙:
- 입력 [성과] 목록의 모든 항목을 하나도 빼지 않고 판정한다.
- title 은 입력 제목을 글자 그대로 쓴다. 입력에 없는 성과를 새로 만들지 않는다.

rewrite 규칙(WEAK 항목에만):
- before 는 입력 원문 그대로, after 는 고쳐 쓴 문장.
- frame 은 입력에 실제로 대안 검토·기술 판단 근거가 있을 때만 "STAR4"
  ([문제]→[검토한 대안]→[고른 이유]→[결과]). 그런 근거가 없으면 "STAR3"([상황]→[한 일]→[결과]).
  없는 대안 검토를 지어내지 않는다.
- 입력에 없는 숫자·기술·경험을 after 에 새로 넣지 않는다. 수치를 넣을 근거가 없으면
  after 안에 "(수치 필요: 무엇을 측정해야 하는지)" 를 남긴다.

rejectionRisks 규칙:
- 합격 확률을 매기지 않는다 — 지원자 풀·채용 인원을 모르므로 근거가 없다.
- 대신 이 이력서가 탈락할 가장 그럴듯한 이유 2개를 쓴다.
- 이력서 안의 내용으로 반박할 수 있으면 rebuttal 에 그 근거를, 반박할 수 없으면 null.

jdFindings 규칙:
- 입력에 [목표 공고] 가 없으면 빈 배열.
- 있으면 공고를 한 줄씩 훑어 요구사항을 뽑는다. 공고에 적힌 것은 "MUST"/"PREFERRED",
  적혀 있지 않지만 문맥상 요구되는 것은 "IMPLICIT".
- 각 요구를 위 판정 기준으로 판정한다.

스키마:
{"verdict":"한 줄 총평","items":[{"title":"...","status":"PROVEN|WEAK|MISSING","quote":"...","why":"...","rewrite":{"before":"...","after":"...","frame":"STAR3|STAR4"}}],"jdFindings":[{"requirement":"...","priority":"MUST|PREFERRED|IMPLICIT","status":"PROVEN|WEAK|MISSING","quote":"...","why":"..."}],"rejectionRisks":[{"reason":"...","rebuttal":"..."}]}`;

export const buildResumeAuditPrompt = (
  profile: CareerProfileData,
  targetJd: CareerTargetJdData | null,
): string => {
  const accomplishments = profile.accomplishments
    .map((accomplishment) => {
      const evidence = accomplishment.evidence
        .map((item) => `${item.repo}#${item.pr}`)
        .join(', ');
      return [
        `### ${accomplishment.title}`,
        accomplishment.bullet,
        `상황: ${accomplishment.star.situation}`,
        `과제: ${accomplishment.star.task}`,
        `행동: ${accomplishment.star.action}`,
        `결과: ${accomplishment.star.result}`,
        `기술: ${accomplishment.techTags.join(', ') || '(없음)'}`,
        `근거: ${evidence || '(없음)'}`,
      ].join('\n');
    })
    .join('\n\n');
  const skills = profile.skills
    .map((skill) => `- ${skill.name} (${skill.category}/${skill.proficiency})`)
    .join('\n');
  const sections = [
    '[내 이력서 요약]',
    profile.summary,
    '',
    '[성과]',
    accomplishments || '(없음)',
    '',
    '[스킬]',
    skills || '(없음)',
  ];
  if (targetJd) {
    sections.push(
      '',
      `[목표 공고] ${targetJd.company} / ${targetJd.role}`,
      targetJd.jdText,
    );
  }
  return sections.join('\n');
};

const stripCodeFence = (text: string): string =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

const invalid = (message: string): never => {
  throw new CareerMateException({
    code: CareerMateErrorCode.INVALID_MODEL_OUTPUT,
    message,
    status: DomainStatus.BAD_GATEWAY,
  });
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isModelAuditStatus = (value: unknown): boolean =>
  value === 'PROVEN' || value === 'WEAK' || value === 'MISSING';

const isAuditItem = (value: unknown): value is AuditItem => {
  if (!isObject(value)) {
    return false;
  }
  const rewrite = value.rewrite;
  // rewrite 키를 아예 생략한 항목을 거부하지 않는다 — PROVEN 항목에서 모델이 키를 쓰지 않는
  // 것이 실제 출력의 기본이고(실측 25건 중 11건), 거부하면 항목 하나 때문에 감사 전체가
  // 파싱 실패로 죽는다. 아래 toAuditItem 이 null 로 정규화해 하류 계약을 지킨다.
  const validRewrite =
    rewrite === null ||
    rewrite === undefined ||
    (isObject(rewrite) &&
      typeof rewrite.before === 'string' &&
      typeof rewrite.after === 'string' &&
      (rewrite.frame === 'STAR3' || rewrite.frame === 'STAR4'));
  return (
    typeof value.title === 'string' &&
    isModelAuditStatus(value.status) &&
    typeof value.quote === 'string' &&
    typeof value.why === 'string' &&
    validRewrite
  );
};

const isJdFinding = (value: unknown): value is JdFinding => {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.requirement === 'string' &&
    (value.priority === 'MUST' ||
      value.priority === 'PREFERRED' ||
      value.priority === 'IMPLICIT') &&
    isModelAuditStatus(value.status) &&
    typeof value.quote === 'string' &&
    typeof value.why === 'string'
  );
};

const isRejectionRisk = (value: unknown): value is RejectionRisk => {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.reason === 'string' &&
    (typeof value.rebuttal === 'string' || value.rebuttal === null)
  );
};

export const parseResumeAuditOutput = (text: string): ResumeAuditData => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return invalid('이력서 감사 실패 — 모델 출력이 JSON 이 아닙니다.');
  }
  if (!isObject(parsed) || typeof parsed.verdict !== 'string') {
    return invalid('이력서 감사 실패 — verdict 누락 또는 출력 형식 오류.');
  }
  if (
    !Array.isArray(parsed.items) ||
    !Array.isArray(parsed.jdFindings) ||
    !Array.isArray(parsed.rejectionRisks)
  ) {
    return invalid('이력서 감사 실패 — 결과 배열 형식 오류.');
  }
  // formatter 는 모델 문자열을 곧바로 escape 한다. 중첩 필드까지 여기서 검증하지 않으면
  // 감사 자체가 아니라 Slack 렌더 단계에서 TypeError 로 실패해 원인을 잃는다.
  if (parsed.items.some((item) => !isAuditItem(item))) {
    return invalid('이력서 감사 실패 — items 요소 형태 오류.');
  }
  if (parsed.jdFindings.some((finding) => !isJdFinding(finding))) {
    return invalid('이력서 감사 실패 — jdFindings 요소 형태 오류.');
  }
  if (parsed.rejectionRisks.some((risk) => !isRejectionRisk(risk))) {
    return invalid('이력서 감사 실패 — rejectionRisks 요소 형태 오류.');
  }
  return {
    verdict: parsed.verdict,
    items: (parsed.items as AuditItem[]).map(toAuditItem),
    jdFindings: parsed.jdFindings as JdFinding[],
    rejectionRisks: parsed.rejectionRisks as RejectionRisk[],
  };
};

// 생략된 rewrite 를 null 로 채워, guard·formatter 가 항상 null 또는 객체만 보게 한다.
const toAuditItem = (item: AuditItem): AuditItem => ({
  ...item,
  rewrite: item.rewrite ?? null,
});
