import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { CeoException } from '../ceo.exception';
import { MetaOutput } from '../ceo.type';
import { CeoErrorCode } from '../ceo-error-code.enum';

// LLM 이 반환하는 부분 — contextDriftReport + docsQualityReport + finalSummary.
// range / sourcePhaseRuns / schemaVersion 은 manager 가 채운다.
export type MetaLlmOutput = Pick<
  MetaOutput,
  'contextDriftReport' | 'docsQualityReport' | 'finalSummary'
>;

export const parseMetaOutput = (raw: string): MetaLlmOutput => {
  const cleaned = stripCodeFence(raw.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new CeoException({
      code: CeoErrorCode.PARSE_FAILED,
      message: `CEO 응답 JSON parse 실패: ${cleaned.slice(0, 120)}`,
      status: DomainStatus.INTERNAL,
      cause: error,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CeoException({
      code: CeoErrorCode.PARSE_FAILED,
      message: `CEO 응답이 객체가 아님: ${typeof parsed}`,
      status: DomainStatus.INTERNAL,
    });
  }
  const root = parsed as Record<string, unknown>;
  return {
    contextDriftReport: parseContextDriftReport(root.contextDriftReport),
    docsQualityReport: parseDocsQualityReport(root.docsQualityReport),
    finalSummary:
      typeof root.finalSummary === 'string' ? root.finalSummary : '',
  };
};

const parseContextDriftReport = (
  raw: unknown,
): MetaLlmOutput['contextDriftReport'] => {
  if (typeof raw !== 'object' || raw === null) {
    throw new CeoException({
      code: CeoErrorCode.PARSE_FAILED,
      message: 'contextDriftReport 필드가 객체가 아님',
      status: DomainStatus.INTERNAL,
    });
  }
  const obj = raw as Record<string, unknown>;
  return {
    observations: parseStringArray(
      obj.observations,
      'contextDriftReport.observations',
    ),
  };
};

const parseDocsQualityReport = (
  raw: unknown,
): MetaLlmOutput['docsQualityReport'] => {
  if (typeof raw !== 'object' || raw === null) {
    throw new CeoException({
      code: CeoErrorCode.PARSE_FAILED,
      message: 'docsQualityReport 필드가 객체가 아님',
      status: DomainStatus.INTERNAL,
    });
  }
  const obj = raw as Record<string, unknown>;
  return {
    findings: parseStringArray(obj.findings, 'docsQualityReport.findings'),
  };
};

const parseStringArray = (raw: unknown, label: string): string[] => {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new CeoException({
      code: CeoErrorCode.PARSE_FAILED,
      message: `${label} 가 array 가 아님`,
      status: DomainStatus.INTERNAL,
    });
  }
  return raw.filter((item): item is string => typeof item === 'string');
};

const stripCodeFence = (text: string): string =>
  text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
