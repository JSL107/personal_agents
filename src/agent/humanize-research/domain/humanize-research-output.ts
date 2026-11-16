import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { extractJsonObjectText } from '../../../common/util/llm-json-extract.util';
import { HUMANIZE_RESEARCH_MAX_PROPOSALS } from './humanize-research.constant';
import {
  ConstrainedProposals,
  EnforcementGap,
  HumanizeResearchProposal,
  ParsedResearchOutput,
  ProposalSkipReason,
  ProposalTarget,
} from './humanize-research.type';
import { HumanizeResearchErrorCode } from './humanize-research-error-code.enum';

// 버린 제안을 원장에 남길 때의 길이 상한 — 원장이 모델 출력 전문으로 부풀지 않게 한다.
const SNAPSHOT_TEXT_LIMIT = 2_000;
const SNAPSHOT_EVIDENCE_LIMIT = 20;
const SNAPSHOT_ID_LIMIT = 200;
const SNAPSHOT_TEXT_KEYS = [
  'target',
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
  const gaps = Array.isArray(parsed.enforcementGaps)
    ? parsed.enforcementGaps
    : [];
  const enforcementGaps: EnforcementGap[] = gaps.flatMap((gap) => {
    if (!isRecord(gap)) {
      return [];
    }
    if (typeof gap.ruleId !== 'string' || !Array.isArray(gap.evidence)) {
      return [];
    }
    const evidenceValid = gap.evidence.every(
      (id: unknown) => typeof id === 'string',
    );
    if (!evidenceValid) {
      return [];
    }
    const evidence: string[] = gap.evidence;
    return [{ ruleId: gap.ruleId, evidence }];
  });
  return { proposals: parsed.proposals, injectionNotices, enforcementGaps };
};

export const constrainEnforcementGaps = ({
  gaps,
  includedIds,
  knownRuleIds,
}: {
  gaps: EnforcementGap[];
  includedIds: ReadonlySet<string>;
  knownRuleIds: ReadonlySet<string>;
}): EnforcementGap[] => {
  const grounded = gaps.filter((gap) => {
    const knownRule = knownRuleIds.has(gap.ruleId);
    const hasEvidence = gap.evidence.length > 0;
    const allIncluded = gap.evidence.every((id) => includedIds.has(id));
    const valid = knownRule && hasEvidence && allIncluded;
    return valid;
  });
  return grounded;
};

// quick-rules 표 행(`| A-1 | … |`)의 규칙 id 만 뽑는다. 본문 중간의 `| B-2 |` 는 행이 아니다.
export const quickRuleIds = (quickRules: string): string[] => {
  const matches = Array.from(quickRules.matchAll(/^\| ([A-Z]-\d+) \|/gmu));
  const ids = matches.map((match) => match[1]);
  return ids;
};

export const constrainResearchProposals = ({
  proposals,
  includedIds,
  gate,
}: {
  gate?: (proposal: HumanizeResearchProposal) => ProposalSkipReason | null;
  proposals: unknown[];
  includedIds: ReadonlySet<string>;
}): ConstrainedProposals => {
  const accepted: HumanizeResearchProposal[] = [];
  const skipped: ConstrainedProposals['skipped'] = [];
  for (const candidate of proposals) {
    const limitReached = accepted.length >= HUMANIZE_RESEARCH_MAX_PROPOSALS;
    const reason = judgeProposal({
      candidate,
      includedIds,
      gate,
      limitReached,
    });
    if (reason !== null) {
      skipped.push({ proposal: snapshotOf(candidate), reason });
      continue;
    }
    if (isProposal(candidate)) {
      accepted.push(candidate);
    }
  }
  return { proposals: accepted, skipped };
};

// 상한은 게이트를 통과한 제안만 센다 — 앞 제안이 게이트에서 걸리면 뒤 제안이 자리를 얻는다.
const judgeProposal = ({
  candidate,
  includedIds,
  gate,
  limitReached,
}: {
  candidate: unknown;
  includedIds: ReadonlySet<string>;
  gate?: (proposal: HumanizeResearchProposal) => ProposalSkipReason | null;
  limitReached: boolean;
}): ProposalSkipReason | null => {
  const validationReason = skipReasonOf({ candidate, includedIds });
  if (validationReason !== null || !isProposal(candidate)) {
    return validationReason ?? ProposalSkipReason.INVALID_SHAPE;
  }
  if (limitReached) {
    return ProposalSkipReason.OVER_LIMIT;
  }
  const gateReason = gate?.(candidate) ?? null;
  if (gateReason !== null) {
    return gateReason;
  }
  return null;
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
  includedIds,
}: {
  candidate: unknown;
  includedIds: ReadonlySet<string>;
}): ProposalSkipReason | null => {
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
  const targetValid = Object.values(ProposalTarget).some(
    (target) => target === value.target,
  );
  const valid =
    textsValid && replacementValid && evidenceValid && changed && targetValid;
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
