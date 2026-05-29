import { PREVIEW_ACTION_IDS } from '../../preview-gate/domain/preview-action.type';

// Slack section.text(mrkdwn) 의 최대 문자 수는 3000. 안전 마진 50 두고 2950 로.
// PR #26 (omc:code-reviewer MEDIUM-2) follow-up — 긴 careerLog / WBS 분해는 단일 section 으로
// 넣으면 Slack API 가 invalid_blocks 반환. 본 PR 부터 chunk 단위로 section 다중 발송.
// (Slack 메시지 당 50 block 제한 — chunk × 2950 → 약 140KB text 까지 안전.)
export const SECTION_MRKDWN_LIMIT = 2950;

// PO-2 Block Kit — preview 메시지 (✅ apply / ❌ cancel 버튼 + previewId).
// previewId 는 button.value 로 박힌다. block_id 는 매번 unique 가 좋음 — Slack API 가 같은 메시지 안 중복 block_id 거절.
// previewText 가 SECTION_MRKDWN_LIMIT 초과 시 newline boundary 우선 chunk 분할 → section 다중.
export const buildPreviewBlocks = ({
  previewText,
  previewId,
}: {
  previewText: string;
  previewId: string;
}): Array<Record<string, unknown>> => {
  const chunks = chunkMrkdwnText(previewText, SECTION_MRKDWN_LIMIT);
  return [
    ...chunks.map((chunk) => ({
      type: 'section',
      text: { type: 'mrkdwn', text: chunk },
    })),
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
};

// limit 초과 text 를 newline boundary 우선으로 chunk 분할.
// limit 안에 \n 이 있으면 가장 늦은 \n 위치로 자르고, 없으면 limit 그대로 hard cut.
// (last \n 이 limit/2 보다 앞이면 newline 무시 — chunk 비효율 회피.)
// chunk 사이 \n 은 trim — 다음 chunk 가 \n 으로 시작하면 mrkdwn 빈 줄로 보일 수 있음.
export const chunkMrkdwnText = (text: string, limit: number): string[] => {
  if (text.length <= limit) {
    return [text];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    const head = remaining.slice(0, limit);
    let cutAt = head.lastIndexOf('\n');
    if (cutAt < limit / 2) {
      cutAt = limit;
    }
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).replace(/^\n+/, '');
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
};
