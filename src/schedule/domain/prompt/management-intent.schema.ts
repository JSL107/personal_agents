import { OutputJsonSchema } from '../../../model-router/domain/model-router.type';
import { ManagementAction } from '../management-intent.type';
import { FollowUpTrigger } from '../schedule.type';

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] };

// strict 규칙상 모든 키가 required 다. 동작에 쓰지 않는 키는 null 로 받고, 해석기
// (`parseManagementIntent`)가 동작별로 필요한 값만 다시 검증한다.
export const MANAGEMENT_INTENT_OUTPUT_SCHEMA: OutputJsonSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: Object.values(ManagementAction) },
    titleQuery: { type: 'string' },
    status: NULLABLE_STRING,
    remindAt: NULLABLE_STRING,
    recipient: NULLABLE_STRING,
    topic: NULLABLE_STRING,
    trigger: {
      anyOf: [
        { type: 'string', enum: Object.values(FollowUpTrigger) },
        { type: 'null' },
      ],
    },
    triggerAt: NULLABLE_STRING,
    note: NULLABLE_STRING,
  },
  required: [
    'action',
    'titleQuery',
    'status',
    'remindAt',
    'recipient',
    'topic',
    'trigger',
    'triggerAt',
    'note',
  ],
  additionalProperties: false,
};
