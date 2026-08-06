import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { CtoException } from '../cto.exception';
import {
  EvaluateStudyTopicInput,
  StudyConceptVerdict,
  StudyToolVerdict,
  StudyTopicKind,
  StudyTopicVerdict,
} from '../cto.type';
import { CtoErrorCode } from '../cto-error-code.enum';

const COMMON_SYSTEM_PROMPT = `너는 개발자의 사수(멘토)다. 회사가 도입할지를 판단하지 말고, 이 개발자가 왜 지금 이 주제를 알아야 하는지 판정한다.
과장하지 말고 조사 원문에서 확인되는 것만 쓴다. JSON 하나만 출력하고 설명·주석·코드펜스를 붙이지 않는다.
minutes는 0 이상의 정수다.`;

export const STUDY_CONCEPT_SYSTEM_PROMPT = `${COMMON_SYSTEM_PROMPT}
whyNow는 2문장 이내다. 이 사람의 역량·현재 작업과 연결되는 이유만 쓴다.
whereItLands는 한 줄이다. 주어진 모듈 목록 안에서 고른 이름을 쉼표로 쓴다. 설명 문장을 붙이지 마라. 목록에 닿는 것이 없을 때만 "레포에서 확인 못 함"이라고 쓴다. 목록에 없는 경로를 지어내지 않는다.
번호 목록(\`1. … 2. …\`)이나 여러 단계 나열을 어느 필드에도 넣지 마라 — 그건 본문 \`## 오늘 할 일\`의 몫이다.
minutes는 읽기 예상 시간이다.
스키마: {"whyNow":"프로필 근거","whereItLands":"모듈 이름","minutes":30}`;

export const STUDY_TOOL_SYSTEM_PROMPT = `${COMMON_SYSTEM_PROMPT}
whatImproves는 2문장 이내다.
adoptionCost는 한 줄이다.
caution은 한 줄. 없으면 필드를 생략한다.
번호 목록(\`1. … 2. …\`)이나 여러 단계 나열을 어느 필드에도 넣지 마라 — 그건 본문 \`## 오늘 할 일\`의 몫이다.
minutes는 설치·연결 예상 시간이다. caution이 없으면 생략한다.
스키마: {"whatImproves":"현재 방식 대비 개선","adoptionCost":"설치·인증·중복 비용","caution":"선택 주의점","minutes":15}`;

export const buildStudyTopicPrompt = ({
  research,
  profileSummary,
  profileSkills,
  repoModules,
}: EvaluateStudyTopicInput): string =>
  [
    '[조사 주제]',
    `kind: ${research.kind}`,
    `topic: ${research.topic}`,
    `sources: ${research.sourceUrls.join(', ') || '(없음)'}`,
    '',
    '[Hermes 조사 전문]',
    research.reportMd,
    '',
    '[개발자 프로필]',
    `summary: ${profileSummary ?? '(없음)'}`,
    `skills: ${profileSkills?.join(', ') || '(없음)'}`,
    '',
    '[레포 모듈 목록]',
    repoModules !== undefined && repoModules.length > 0
      ? repoModules
          .map(({ name, description }) =>
            description.length > 0 ? `- ${name}: ${description}` : `- ${name}`,
          )
          .join('\n')
      : '(없음)',
  ].join('\n');

export const parseStudyVerdict = (
  text: string,
  kind: StudyTopicKind,
): StudyTopicVerdict => {
  const root = parseRoot(text);
  if (kind === 'CONCEPT') {
    return parseConceptVerdict(root);
  }
  return parseToolVerdict(root);
};

const parseRoot = (text: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch (error) {
    return invalidVerdict('CTO 학습 판정 출력이 JSON이 아닙니다.', error);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return invalidVerdict('CTO 학습 판정 출력이 객체가 아닙니다.');
  }
  return parsed as Record<string, unknown>;
};

const parseConceptVerdict = (
  root: Record<string, unknown>,
): StudyConceptVerdict => ({
  kind: 'CONCEPT',
  whyNow: readString(root.whyNow, 'whyNow'),
  whereItLands: readString(root.whereItLands, 'whereItLands'),
  minutes: readMinutes(root.minutes),
});

const parseToolVerdict = (root: Record<string, unknown>): StudyToolVerdict => {
  const caution = readOptionalString(root.caution, 'caution');
  return {
    kind: 'TOOL',
    whatImproves: readString(root.whatImproves, 'whatImproves'),
    adoptionCost: readString(root.adoptionCost, 'adoptionCost'),
    ...(caution !== undefined ? { caution } : {}),
    minutes: readMinutes(root.minutes),
  };
};

const readString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') {
    return invalidVerdict(`${field} 필드가 없거나 string이 아닙니다.`);
  }
  return value;
};

const readOptionalString = (
  value: unknown,
  field: string,
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return readString(value, field);
};

const readMinutes = (value: unknown): number => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return invalidVerdict(
      `minutes 필드는 0 이상의 유한 정수여야 합니다: ${String(value)}`,
    );
  }
  return value;
};

const invalidVerdict = (message: string, cause?: unknown): never => {
  throw new CtoException({
    code: CtoErrorCode.INVALID_STUDY_VERDICT,
    message,
    status: DomainStatus.BAD_GATEWAY,
    cause,
  });
};

const stripCodeFence = (text: string): string =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
