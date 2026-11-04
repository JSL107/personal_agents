import { OutputJsonSchema } from '../../../model-router/domain/model-router.type';

export const MENTION_REQUEST_OUTPUT_SCHEMA: OutputJsonSchema = {
  type: 'object',
  properties: {
    isRequest: { type: 'boolean' },
    title: { type: 'string' },
    dueDate: {
      anyOf: [
        { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        { type: 'null' },
      ],
    },
  },
  required: ['isRequest', 'title', 'dueDate'],
  additionalProperties: false,
};
