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
whereItLands는 실제 파일/모듈 경로를 근거로 쓴다. 확인하지 못하면 "레포에서 확인 못 함"이라고 쓰고 경로를 지어내지 않는다.
minutes는 읽기 예상 시간이다.
스키마: {"whyNow":"프로필 근거","whereItLands":"실제 파일/모듈","readingPlan":"읽는 순서","minutes":30}`;

export const STUDY_TOOL_SYSTEM_PROMPT = `${COMMON_SYSTEM_PROMPT}
installHint에는 자격증명·토큰 값을 넣지 않는다. 발급이 필요하면 "토큰 발급 필요"라고만 쓴다.
minutes는 설치·연결 예상 시간이다. caution이 없으면 생략한다.
스키마: {"whatImproves":"현재 방식 대비 개선","adoptionCost":"설치·인증·중복 비용","installHint":"명령어 수준 경로","caution":"선택 주의점","minutes":15}`;

export const buildStudyTopicPrompt = ({
  research,
  profileSummary,
  profileSkills,
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
  readingPlan: readString(root.readingPlan, 'readingPlan'),
  minutes: readMinutes(root.minutes),
});

const parseToolVerdict = (root: Record<string, unknown>): StudyToolVerdict => {
  const caution = readOptionalString(root.caution, 'caution');
  return {
    kind: 'TOOL',
    whatImproves: readString(root.whatImproves, 'whatImproves'),
    adoptionCost: readString(root.adoptionCost, 'adoptionCost'),
    installHint: readString(root.installHint, 'installHint'),
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
