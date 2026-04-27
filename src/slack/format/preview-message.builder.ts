import { PREVIEW_ACTION_IDS } from '../../preview-gate/domain/preview-action.type';

// PO-2 Block Kit — preview 메시지 (✅ apply / ❌ cancel 버튼 + previewId).
// previewId 는 button.value 로 박힌다. block_id 는 매번 unique 가 좋음 — Slack API 가 같은 메시지 안 중복 block_id 거절.
export const buildPreviewBlocks = ({
  previewText,
  previewId,
}: {
  previewText: string;
  previewId: string;
}): Array<Record<string, unknown>> => [
  {
    type: 'section',
    text: { type: 'mrkdwn', text: previewText },
  },
  {
    type: 'actions',
    block_id: `preview-actions:${previewId}`,
    elements: [
      {
        type: 'button',
        action_id: PREVIEW_ACTION_IDS.APPLY,
        text: { type: 'plain_text', text: '✅ 적용' },
        value: previewId,
        style: 'primary',
      },
      {
        type: 'button',
        action_id: PREVIEW_ACTION_IDS.CANCEL,
        text: { type: 'plain_text', text: '❌ 취소' },
        value: previewId,
        style: 'danger',
      },
    ],
  },
];
