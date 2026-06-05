import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import {
  buildJsonParseCauseMessage,
  extractJsonObjectText,
} from '../../../../common/util/llm-json-extract.util';
import { IssueLabelerException } from '../issue-labeler.exception';
import { IssueLabelInference } from '../issue-labeler.type';
import { IssueLabelerErrorCode } from '../issue-labeler-error-code.enum';

// LLM 응답 → IssueLabelInference. extractJsonObjectText 가 code fence / mixed content
// 모두 흡수. vocab 필터링은 caller 책임 — parser 는 shape 검증만.
export const parseIssueLabelInference = (text: string): IssueLabelInference => {
  const cleaned = extractJsonObjectText(text);
  const parsed = parseJson(cleaned, text);

  if (!isIssueLabelInferenceShape(parsed)) {
    throw new IssueLabelerException({
      code: IssueLabelerErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답이 IssueLabelInference 스키마와 맞지 않습니다.',
      status: DomainStatus.BAD_GATEWAY,
    });
  }

  return parsed;
};

const parseJson = (text: string, rawText: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    throw new IssueLabelerException({
      code: IssueLabelerErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답을 JSON 으로 파싱하지 못했습니다.',
      status: DomainStatus.BAD_GATEWAY,
      cause: new Error(buildJsonParseCauseMessage(error, rawText)),
    });
  }
};

const isIssueLabelInferenceShape = (
  value: unknown,
): value is IssueLabelInference => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return isStringArray(record.labels) && typeof record.reasoning === 'string';
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
