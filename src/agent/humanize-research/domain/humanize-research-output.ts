import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { extractJsonObjectText } from '../../../common/util/llm-json-extract.util';
import { HUMANIZE_RESEARCH_MAX_PROPOSALS } from './humanize-research.constant';
import {
  ConstrainedProposals,
  HumanizeResearchProposal,
  ParsedResearchOutput,
  ProposalSkipReason,
} from './humanize-research.type';
import { HumanizeResearchErrorCode } from './humanize-research-error-code.enum';

// 버린 제안을 원장에 남길 때의 길이 상한 — 원장이 모델 출력 전문으로 부풀지 않게 한다.
const SNAPSHOT_TEXT_LIMIT = 2_000;
const SNAPSHOT_EVIDENCE_LIMIT = 20;
const SNAPSHOT_ID_LIMIT = 200;
const SNAPSHOT_TEXT_KEYS = [
  'file',
  'oldString',
  'newString',
  'targetMetric',
  'rationale',
] as const;

export class InvalidHumanizeResearchResponseError extends DomainException {
  readonly errorCode = HumanizeResearchErrorCode.INVALID_RESPONSE;
  readonly status = DomainStatus.BAD_GATEWAY;
}

export const parseResearchOutput = (text: string): ParsedResearchOutput => {
  const parsed = parseJsonObject(text);
  if (!Array.isArray(parsed.proposals)) {
    throw new InvalidHumanizeResearchResponseError(
      '윤문 규칙 제안 proposals 배열 없음',
    );
  }
  const notices = Array.isArray(parsed.injectionNotices)
    ? parsed.injectionNotices
    : [];
  const injectionNotices = notices.filter(
    (notice): notice is string => typeof notice === 'string',
  );
  return { proposals: parsed.proposals, injectionNotices };
};

export const constrainResearchProposals = ({
  proposals,
  includedIds,
}: {
  proposals: unknown[];
  includedIds: ReadonlySet<string>;
}): ConstrainedProposals => {
  const judged = proposals.map((candidate, index) => ({
    candidate,
    reason: skipReasonOf({ candidate, index, includedIds }),
  }));
  const accepted = judged
    .filter(({ reason }) => reason === null)
    .map(({ candidate }) => candidate as HumanizeResearchProposal);
  const skipped = judged.flatMap(({ candidate, reason }) =>
    reason === null ? [] : [{ proposal: snapshotOf(candidate), reason }],
  );
  return { proposals: accepted, skipped };
};

const parseJsonObject = (text: string): Record<string, unknown> => {
  const parsed = parseJson(text);
  if (!isRecord(parsed)) {
    throw new InvalidHumanizeResearchResponseError(
      '윤문 규칙 제안 최상위 객체 없음',
    );
  }
  return parsed;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(extractJsonObjectText(text)) as unknown;
  } catch {
    throw new InvalidHumanizeResearchResponseError(
      '윤문 규칙 제안 JSON 파싱 실패',
    );
  }
};

const skipReasonOf = ({
  candidate,
  index,
  includedIds,
}: {
  candidate: unknown;
  index: number;
  includedIds: ReadonlySet<string>;
}): ProposalSkipReason | null => {
  if (index >= HUMANIZE_RESEARCH_MAX_PROPOSALS) {
    return ProposalSkipReason.OVER_LIMIT;
  }
  if (!isProposal(candidate)) {
    return ProposalSkipReason.INVALID_SHAPE;
  }
  // 정확 일치만 인정한다 — 접두·부분 일치를 허용하면 실린 적 없는 id 가 근거로 통과한다.
  const grounded = candidate.evidence.every((id) => includedIds.has(id));
  if (!grounded) {
    return ProposalSkipReason.NO_EVIDENCE;
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  const isObject = typeof value === 'object' && value !== null;
  const isPlainObject = isObject && !Array.isArray(value);
  return isPlainObject;
};

const isNonEmptyString = (value: unknown): value is string => {
  const nonEmpty = typeof value === 'string' && value.trim().length > 0;
  return nonEmpty;
};

const isProposal = (value: unknown): value is HumanizeResearchProposal => {
  if (!isRecord(value)) {
    return false;
  }
  const requiredTexts = [
    value.file,
    value.oldString,
    value.targetMetric,
    value.rationale,
  ];
  // newString 은 비어도 된다 — 규칙을 지우는 제안이다(2026-10-26 실회차에서 G-3 삭제
  // 제안이 형태 오류로 버려졌다). 빈 oldString 은 대상을 특정하지 못하므로 막는다.
  const textsValid = requiredTexts.every(isNonEmptyString);
  const replacementValid = typeof value.newString === 'string';
  const evidenceValid = isEvidence(value.evidence);
  const changed = value.oldString !== value.newString;
  const valid = textsValid && replacementValid && evidenceValid && changed;
  return valid;
};

const isEvidence = (value: unknown): value is string[] => {
  const hasItems = Array.isArray(value) && value.length > 0;
  const allTexts = hasItems && value.every(isNonEmptyString);
  return allTexts;
};

const snapshotOf = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    return {};
  }
  const texts = SNAPSHOT_TEXT_KEYS.flatMap((key) => {
    const text = value[key];
    return typeof text === 'string'
      ? [[key, text.slice(0, SNAPSHOT_TEXT_LIMIT)]]
      : [];
  });
  const evidence = Array.isArray(value.evidence)
    ? value.evidence
        .filter((id): id is string => typeof id === 'string')
        .slice(0, SNAPSHOT_EVIDENCE_LIMIT)
        .map((id) => id.slice(0, SNAPSHOT_ID_LIMIT))
    : undefined;
  const snapshot: Record<string, unknown> = Object.fromEntries(texts);
  if (evidence) {
    snapshot.evidence = evidence;
  }
  return snapshot;
};
