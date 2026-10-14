import { OutputJsonSchema } from '../../model-router/domain/model-router.type';

export const IDEA_TRIAGE_OUTPUT_SCHEMA: OutputJsonSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['BUILD', 'REVISE_THEN_BUILD', 'DROP'] },
    reason: { type: 'string' },
    counterpoint: { type: 'string' },
    scheduleTitle: { type: 'string' },
    effort: { type: 'string', enum: ['S', 'M', 'L'] },
  },
  required: ['verdict', 'reason', 'counterpoint', 'scheduleTitle', 'effort'],
  additionalProperties: false,
};
