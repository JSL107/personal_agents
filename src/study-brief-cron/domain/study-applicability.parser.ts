import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  APPLICABILITY_VERDICT,
  ApplicabilityProposal,
  ApplicabilityVerdict,
  RawApplicabilityOutput,
} from './study-applicability.type';
import { StudyBriefException } from './study-brief.exception';
import { StudyBriefErrorCode } from './study-brief-error-code.enum';
import { stripCodeFence } from './study-research.parser';

export const parseApplicabilityOutput = (
  text: string,
): RawApplicabilityOutput => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text.trim()));
  } catch {
    return invalid('JSON 이 아닙니다.');
  }
  if (!isRecord(parsed)) {
    return invalid('최상위가 객체가 아닙니다.');
  }
  const { verdict, reason, citations, proposal } = parsed;
  if (!isVerdict(verdict)) {
    return invalid(`verdict 값이 올바르지 않습니다: ${String(verdict)}`);
  }
  if (typeof reason !== 'string') {
    return invalid('reason 이 문자열이 아닙니다.');
  }
  if (!Array.isArray(citations) || !citations.every(isCitation)) {
    return invalid('citations 형태가 올바르지 않습니다.');
  }
  if (proposal !== null && !isProposal(proposal)) {
    return invalid('proposal 형태가 올바르지 않습니다.');
  }
  return {
    verdict,
    reason,
    citations: citations.map(({ chunkId, why }) => ({ chunkId, why })),
    proposal: proposal === null ? null : pickProposal(proposal),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isVerdict = (value: unknown): value is ApplicabilityVerdict =>
  Object.values(APPLICABILITY_VERDICT).includes(value as ApplicabilityVerdict);

const isCitation = (
  value: unknown,
): value is { chunkId: string; why: string } =>
  isRecord(value) &&
  typeof value.chunkId === 'string' &&
  typeof value.why === 'string';

const PROPOSAL_KEYS = ['title', 'problem', 'change', 'verify'] as const;

const isProposal = (value: unknown): value is ApplicabilityProposal =>
  isRecord(value) &&
  PROPOSAL_KEYS.every((key) => typeof value[key] === 'string');

const pickProposal = (value: ApplicabilityProposal): ApplicabilityProposal => ({
  title: value.title,
  problem: value.problem,
  change: value.change,
  verify: value.verify,
});

const invalid = (message: string): never => {
  throw new StudyBriefException({
    code: StudyBriefErrorCode.INVALID_APPLICABILITY_OUTPUT,
    message: `적용 판정 출력 거부 — ${message}`,
    status: DomainStatus.BAD_GATEWAY,
  });
};
