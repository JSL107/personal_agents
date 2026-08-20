import { OutputJsonSchema } from '../../../../model-router/domain/model-router.type';

export const PO_SHADOW_OUTPUT_SCHEMA: OutputJsonSchema = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', enum: [2] },
    quiet: { type: 'boolean', enum: [false] },
    headline: {
      type: 'string',
      minLength: 1,
      maxLength: 80,
      pattern: '.*\\S.*',
    },
    findings: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          factIds: {
            type: 'array',
            minItems: 1,
            items: { type: 'string' },
          },
          point: {
            type: 'string',
            minLength: 1,
            maxLength: 60,
            pattern: '.*\\S.*',
          },
          suggestion: {
            type: 'string',
            minLength: 1,
            maxLength: 60,
            pattern: '.*\\S.*',
          },
        },
        required: ['factIds', 'point', 'suggestion'],
        additionalProperties: false,
      },
    },
    purposeConflict: {
      type: ['string', 'null'],
      minLength: 1,
      pattern: '.*\\S.*',
    },
    factSummary: { type: 'array', maxItems: 0, items: { type: 'string' } },
    droppedFindingCount: { type: 'integer', enum: [0] },
    degradedSources: { type: 'array', maxItems: 0, items: { type: 'string' } },
  },
  required: [
    'schemaVersion',
    'quiet',
    'headline',
    'findings',
    'purposeConflict',
    'factSummary',
    'droppedFindingCount',
    'degradedSources',
  ],
  additionalProperties: false,
};
