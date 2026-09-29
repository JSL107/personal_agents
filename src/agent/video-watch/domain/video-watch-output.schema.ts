import { OutputJsonSchema } from '../../../model-router/domain/model-router.type';

export const VIDEO_WATCH_OUTPUT_SCHEMA: OutputJsonSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    highlights: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          timestampSec: { type: 'integer', minimum: 0 },
          note: { type: 'string' },
        },
        required: ['timestampSec', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['answer', 'highlights'],
  additionalProperties: false,
};
