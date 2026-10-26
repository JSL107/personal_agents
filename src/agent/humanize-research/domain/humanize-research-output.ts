import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { extractJsonObjectText } from '../../../common/util/llm-json-extract.util';
import {
  HumanizeResearchOutput,
  HumanizeResearchProposal,
  ProposalSkipReason,
  SkippedHumanizeResearchProposal,
} from './humanize-research.type';
import { HumanizeResearchErrorCode } from './humanize-research-error-code.enum';

// 3단계 A/B 비용 상한(설계 §6). 프롬프트 안내문도 이 값을 읽는다.
export const HUMANIZE_RESEARCH_MAX_PROPOSALS = 3;

export class InvalidHumanizeResearchResponseError extends DomainException {
  readonly errorCode = HumanizeResearchErrorCode.INVALID_RESPONSE;
  readonly status = DomainStatus.BAD_GATEWAY;
}

interface ParsedResearchOutput {
  proposals: unknown[];
  injectionNotices: string[];
}

export const parseResearchOutput = (text: string): ParsedResearchOutput => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObjectText(text)) as unknown;
  } catch {
    throw new InvalidHumanizeResearchResponseError(
      '윤문 규칙 제안 JSON 파싱 실패',
    );
  }
  const isObject = typeof parsed === 'object' && parsed !== null;
  if (!isObject || Array.isArray(parsed)) {
    throw new InvalidHumanizeResearchResponseError(
      '윤문 규칙 제안 최상위 객체 없음',
    );
  }
  const output = parsed as Record<string, unknown>;
  if (!Array.isArray(output.proposals)) {
    throw new InvalidHumanizeResearchResponseError(
      '윤문 규칙 제안 proposals 배열 없음',
    );
  }
  const injectionNotices = Array.isArray(output.injectionNotices)
    ? output.injectionNotices.filter(
        (notice): notice is string => typeof notice === 'string',
      )
    : [];
  return { proposals: output.proposals, injectionNotices };
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isProposal = (value: unknown): value is HumanizeResearchProposal => {
  const isObject = typeof value === 'object' && value !== null;
  if (!isObject || Array.isArray(value)) {
    return false;
  }
  const proposal = value as Record<string, unknown>;
  const fields = [
    proposal.file,
    proposal.oldString,
    proposal.targetMetric,
    proposal.rationale,
  ];
  // newString 은 비어도 된다 — 규칙을 지우는 제안이다(2026-10-26 실회차에서 G-3 삭제
  // 제안이 형태 오류로 버려졌다). 빈 oldString 은 대상을 특정하지 못하므로 막는다.
  const fieldsValid =
    fields.every(isNonEmptyString) && typeof proposal.newString === 'string';
  const evidenceValid =
    Array.isArray(proposal.evidence) &&
    proposal.evidence.length > 0 &&
    proposal.evidence.every(isNonEmptyString);
  const changed = proposal.oldString !== proposal.newString;
  return fieldsValid && evidenceValid && changed;
};

const proposalSnapshot = (value: unknown): Record<string, unknown> => {
  const isObject = typeof value === 'object' && value !== null;
  if (!isObject || Array.isArray(value)) {
    return {};
  }
  const candidate = value as Record<string, unknown>;
  const snapshot: Record<string, unknown> = {};
  for (const key of [
    'file',
    'oldString',
    'newString',
    'targetMetric',
    'rationale',
  ]) {
    const field = candidate[key];
    if (typeof field === 'string') {
      snapshot[key] = field.slice(0, 2_000);
    }
  }
  if (Array.isArray(candidate.evidence)) {
    snapshot.evidence = candidate.evidence
      .filter((id): id is string => typeof id === 'string')
      .slice(0, 20)
      .map((id) => id.slice(0, 200));
  }
  return snapshot;
};

export const constrainResearchProposals = ({
  proposals,
  includedIds,
}: {
  proposals: unknown[];
  includedIds: ReadonlySet<string>;
}): Pick<HumanizeResearchOutput, 'proposals' | 'skipped'> => {
  const accepted: HumanizeResearchProposal[] = [];
  const skipped: SkippedHumanizeResearchProposal[] = [];
  proposals.forEach((candidate, index) => {
    const proposal = proposalSnapshot(candidate);
    let reason: ProposalSkipReason | null = null;
    if (index >= HUMANIZE_RESEARCH_MAX_PROPOSALS) {
      reason = ProposalSkipReason.OVER_LIMIT;
    } else if (!isProposal(candidate)) {
      reason = ProposalSkipReason.INVALID_SHAPE;
    } else if (!candidate.evidence.every((id) => includedIds.has(id))) {
      reason = ProposalSkipReason.NO_EVIDENCE;
    }
    if (reason !== null) {
      skipped.push({ proposal, reason });
      return;
    }
    accepted.push(candidate as HumanizeResearchProposal);
  });
  return { proposals: accepted, skipped };
};
