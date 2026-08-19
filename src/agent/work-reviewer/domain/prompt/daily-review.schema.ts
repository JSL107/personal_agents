import { OutputJsonSchema } from '../../../../model-router/domain/model-router.type';

// DailyReview 응답의 형태를 모델 샘플링 단계에서 고정한다 (codex `--output-schema`).
//
// 이 워커를 우선 적용한 이유: 원장(agent_run) 기준 파싱·형태 실패 9건 중 6건이 여기서 났다
// (2026-06-23·06-24 5건, 2026-08-14 1건). 나머지 워커는 같은 기간 0건이다.
//
// isDailyReviewShape 의 런타임 검사는 그대로 둔다 — 스키마는 codex 경로에만 걸리므로
// (claude CLI 는 미지원, mock provider 는 임의 문자열) 파서는 여전히 최후 방어선이다.
//
// improvementBeforeAfter 는 도메인상 nullable object 다. strict schema 는 선언한 property 를
// 전부 required 로 요구하므로 "없음" 을 키 누락이 아니라 null 로 표현한다.
export const DAILY_REVIEW_OUTPUT_SCHEMA: OutputJsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    impact: {
      type: 'object',
      properties: {
        quantitative: { type: 'array', items: { type: 'string' } },
        qualitative: { type: 'string' },
      },
      required: ['quantitative', 'qualitative'],
      additionalProperties: false,
    },
    improvementBeforeAfter: {
      type: ['object', 'null'],
      properties: {
        before: { type: 'string' },
        after: { type: 'string' },
      },
      required: ['before', 'after'],
      additionalProperties: false,
    },
    nextActions: { type: 'array', items: { type: 'string' } },
    oneLineAchievement: { type: 'string' },
  },
  required: [
    'summary',
    'impact',
    'improvementBeforeAfter',
    'nextActions',
    'oneLineAchievement',
  ],
  additionalProperties: false,
};
