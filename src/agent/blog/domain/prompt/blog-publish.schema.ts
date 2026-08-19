import { OutputJsonSchema } from '../../../../model-router/domain/model-router.type';

// 발행 파이프라인 두 호출(익명화·편집)의 응답 형태를 모델 샘플링 단계에서 고정한다
// (codex `--output-schema`).
//
// 이 워커에 적용하는 이유: BLOG_PUBLISH 의 **최초 실행(run#864)** 이 익명화 응답 파싱에서
// 죽었다. 원인은 우리 쪽 추출기 결함이었지만(문자열 안 코드펜스를 응답 펜스로 오인), 애초에
// 모델이 코드펜스로 감싸거나 앞뒤에 설명을 붙일 수 없었다면 그 결함이 드러날 자리도 없었다.
//
// 파서의 런타임 검사는 그대로 둔다 — 스키마는 codex 경로에만 걸리고(claude CLI 미지원,
// mock provider 는 임의 문자열) 파서가 여전히 최후 방어선이다.
export const BLOG_ANONYMIZE_OUTPUT_SCHEMA: OutputJsonSchema = {
  type: 'object',
  properties: {
    slug: { type: 'string' },
    description: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['slug', 'description', 'body'],
  additionalProperties: false,
};

// 편집 단계. publishable 이 false 면 나머지 값은 빈 문자열로 온다 —
// strict schema 는 선언한 property 를 전부 required 로 요구하므로 "없음" 을 키 누락이 아니라
// 빈 문자열로 표현한다(파서가 그 조합을 이유만 남기는 판정으로 해석한다).
export const BLOG_EDIT_OUTPUT_SCHEMA: OutputJsonSchema = {
  type: 'object',
  properties: {
    publishable: { type: 'boolean' },
    reason: { type: 'string' },
    title: { type: 'string' },
    slug: { type: 'string' },
    description: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['publishable', 'reason', 'title', 'slug', 'description', 'body'],
  additionalProperties: false,
};
