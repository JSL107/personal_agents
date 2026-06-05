import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import {
  buildJsonParseCauseMessage,
  extractJsonObjectText,
} from '../../../../common/util/llm-json-extract.util';
import { BeDiffGeneratorException } from '../be-diff-generator.exception';
import { BeDiffGenerationResult } from '../be-diff-generator.type';
import { BeDiffGeneratorErrorCode } from '../be-diff-generator-error-code.enum';

// 새 파일 / 기존 파일 header 동시 인식.
// (Phase 2a-3 의 `git apply` 가 정확히 받을 수 있는 형식인지 1차 sanity check 만 — 완벽 validator X.)
const FILE_HEADER_PATTERN = /^---\s+(?:\/dev\/null|a\/.+)$/m;
const HUNK_HEADER_PATTERN = /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m;
const FILE_PATH_FROM_NEW_HEADER = /^\+\+\+\s+b\/(.+)$/gm;

// LLM 응답 → BeDiffGenerationResult. JSON shape + diff 형식 기본 검증 + changedFiles 일치 확인.
// extractJsonObjectText 가 외부 code fence / mixed content 흡수 — 내부 diff 의 fence 는 JSON
// string 안이라 영향 없음.
export const parseBeDiffGeneration = (text: string): BeDiffGenerationResult => {
  const cleaned = extractJsonObjectText(text);
  const parsed = parseJson(cleaned, text);

  if (!isShape(parsed)) {
    throw new BeDiffGeneratorException({
      code: BeDiffGeneratorErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답이 BeDiffGenerationResult 스키마와 맞지 않습니다.',
      status: DomainStatus.BAD_GATEWAY,
    });
  }

  // diff 형식 1차 검증 — file header + hunk header 최소 1세트.
  if (!FILE_HEADER_PATTERN.test(parsed.diff)) {
    throw new BeDiffGeneratorException({
      code: BeDiffGeneratorErrorCode.INVALID_DIFF_FORMAT,
      message:
        'diff 에 unified diff file header (`--- a/...` 또는 `--- /dev/null`) 가 없습니다.',
      status: DomainStatus.BAD_GATEWAY,
    });
  }
  if (!HUNK_HEADER_PATTERN.test(parsed.diff)) {
    throw new BeDiffGeneratorException({
      code: BeDiffGeneratorErrorCode.INVALID_DIFF_FORMAT,
      message:
        'diff 에 hunk header (`@@ -... +... @@`) 가 없습니다 — 빈 diff 거절.',
      status: DomainStatus.BAD_GATEWAY,
    });
  }

  // changedFiles 일치 검증 — diff 안 `+++ b/<path>` 와 LLM 이 보낸 changedFiles 가 같은 집합인지.
  const extracted = extractChangedFiles(parsed.diff);
  const declared = new Set(parsed.changedFiles);
  const actual = new Set(extracted);
  if (extracted.length === 0) {
    throw new BeDiffGeneratorException({
      code: BeDiffGeneratorErrorCode.INVALID_DIFF_FORMAT,
      message:
        'diff 의 `+++ b/<path>` header 에서 변경 파일을 추출하지 못했습니다.',
      status: DomainStatus.BAD_GATEWAY,
    });
  }
  if (
    declared.size !== actual.size ||
    [...declared].some((p) => !actual.has(p))
  ) {
    throw new BeDiffGeneratorException({
      code: BeDiffGeneratorErrorCode.INVALID_DIFF_FORMAT,
      message: `changedFiles 가 diff header 와 불일치: declared=[${[...declared].join(', ')}] actual=[${extracted.join(', ')}]`,
      status: DomainStatus.BAD_GATEWAY,
    });
  }

  // 경로 traversal / 절대경로 거절 — `../` 또는 leading `/`.
  for (const path of extracted) {
    if (path.startsWith('/') || path.includes('..')) {
      throw new BeDiffGeneratorException({
        code: BeDiffGeneratorErrorCode.INVALID_DIFF_FORMAT,
        message: `unsafe path 거절: ${path} (절대경로 또는 traversal 포함).`,
        status: DomainStatus.BAD_GATEWAY,
      });
    }
  }

  return parsed;
};

const parseJson = (text: string, rawText: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    throw new BeDiffGeneratorException({
      code: BeDiffGeneratorErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답을 JSON 으로 파싱하지 못했습니다.',
      status: DomainStatus.BAD_GATEWAY,
      cause: new Error(buildJsonParseCauseMessage(error, rawText)),
    });
  }
};

const isShape = (value: unknown): value is BeDiffGenerationResult => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.diff === 'string' &&
    record.diff.trim().length > 0 &&
    typeof record.reasoning === 'string' &&
    Array.isArray(record.changedFiles) &&
    record.changedFiles.every((p) => typeof p === 'string')
  );
};

// diff 안 `+++ b/<path>` 패턴에서 변경 파일 경로들을 모두 추출 (중복 제거).
const extractChangedFiles = (diff: string): string[] => {
  const set = new Set<string>();
  for (const match of diff.matchAll(FILE_PATH_FROM_NEW_HEADER)) {
    const path = match[1].trim();
    if (path.length > 0) {
      set.add(path);
    }
  }
  return [...set];
};
