import { OutputJsonSchema } from '../../model-router/domain/model-router.type';

// strict schema requires every property; a missing proposal is represented as null.
export const STUDY_APPLICABILITY_OUTPUT_SCHEMA: OutputJsonSchema = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['APPLY', 'REFERENCE', 'NOT_APPLICABLE'],
    },
    reason: { type: 'string' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          chunkId: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['chunkId', 'why'],
        additionalProperties: false,
      },
    },
    proposal: {
      type: ['object', 'null'],
      properties: {
        title: { type: 'string' },
        problem: { type: 'string' },
        change: { type: 'string' },
        verify: { type: 'string' },
      },
      required: ['title', 'problem', 'change', 'verify'],
      additionalProperties: false,
    },
  },
  required: ['verdict', 'reason', 'citations', 'proposal'],
  additionalProperties: false,
};
