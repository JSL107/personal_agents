import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import {
  buildJsonParseCauseMessage,
  extractJsonObjectText,
} from '../../../../common/util/llm-json-extract.util';
import { BlogCategoryId, isBlogCategoryId } from '../astro-post';
import { BlogException } from '../blog.exception';
import { BlogErrorCode } from '../blog-error-code.enum';

// 편집 단계 산출물. 발행 부적합이면 이유만 남고 본문 필드는 오지 않는다.
export type EditedBlogDraft =
  | {
      publishable: true;
      reason: string;
      title: string;
      slug: string;
      description: string;
      body: string;
      // 모르는 값·빈 값이면 undefined. 분류 하나 때문에 발행 전체를 막지 않는다 —
      // 빠지면 블로그 화면에 '미분류' 로 드러나므로 사람이 알아챌 수 있다.
      category?: BlogCategoryId;
    }
  | { publishable: false; reason: string };

// URL 이 되는 값이라 형식을 엄격히 본다. 한 번 발행하면 바꿀 때 링크가 깨진다.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const parseBlogEdit = (text: string): EditedBlogDraft => {
  const parsed = parseJson(text);
  if (typeof parsed !== 'object' || parsed === null) {
    throw editParseFailed('JSON 객체가 아닙니다.', text);
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.publishable !== 'boolean') {
    throw editParseFailed('publishable 은 boolean 이어야 합니다.', text);
  }

  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
  if (reason.length === 0) {
    // 이유 없는 판정은 학습도 추적도 안 된다 — 빈 reason 은 계약 위반으로 끊는다.
    throw editParseFailed('reason 이 비어 있습니다.', text);
  }

  if (!record.publishable) {
    return { publishable: false, reason };
  }

  const title = readNonEmptyString(record.title, 'title', text);
  const slug = readNonEmptyString(record.slug, 'slug', text);
  const description = readNonEmptyString(
    record.description,
    'description',
    text,
  );
  const body = readNonEmptyString(record.body, 'body', text);

  if (!SLUG_PATTERN.test(slug)) {
    throw editParseFailed(
      `slug 형식이 맞지 않습니다(영문 소문자·숫자·하이픈만): ${slug}`,
      text,
    );
  }

  const category = readCategory(record.category);

  return {
    publishable: true,
    reason,
    title,
    slug,
    description,
    body,
    ...(category ? { category } : {}),
  };
};

// slug 과 달리 형식 위반을 예외로 끊지 않는다. slug 은 URL 이라 틀리면 링크가 영구히
// 깨지지만, 분류는 빠져도 글이 '미분류' 로 보일 뿐이라 발행을 막을 이유가 없다.
const readCategory = (value: unknown): BlogCategoryId | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return isBlogCategoryId(normalized) ? normalized : undefined;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(extractJsonObjectText(text));
  } catch (error: unknown) {
    throw new BlogException({
      code: BlogErrorCode.EDIT_PARSE_FAILED,
      message: '블로그 편집 결과를 해석하지 못했습니다.',
      status: DomainStatus.BAD_GATEWAY,
      cause: new Error(buildJsonParseCauseMessage(error, text)),
    });
  }
};

const readNonEmptyString = (
  value: unknown,
  field: string,
  rawText: string,
): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw editParseFailed(`${field} 가 비어 있습니다.`, rawText);
  }
  return value.trim();
};

const editParseFailed = (detail: string, rawText: string): BlogException =>
  new BlogException({
    code: BlogErrorCode.EDIT_PARSE_FAILED,
    message: '블로그 편집 결과를 해석하지 못했습니다.',
    status: DomainStatus.BAD_GATEWAY,
    cause: new Error(buildJsonParseCauseMessage(new Error(detail), rawText)),
  });
