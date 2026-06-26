import {
  chunkMrkdwnText,
  SECTION_MRKDWN_LIMIT,
} from './preview-message.builder';

export const SUBCONSCIOUS_PROPOSAL_ACTION_IDS = {
  APPLY: 'subconscious_proposal_apply',
  DISMISS: 'subconscious_proposal_dismiss',
} as const;

// Subconscious proposal Block Kit — proposalText + ✅실행 / ❌무시 버튼.
// proposalId (number) 는 button.value 에 string 변환 후 박힌다.
export const buildSubconsciousProposalBlocks = ({
  proposalText,
  proposalId,
}: {
  proposalText: string;
  proposalId: number;
}): Array<Record<string, unknown>> => {
  const proposalIdStr = String(proposalId);
  const chunks = chunkMrkdwnText(proposalText, SECTION_MRKDWN_LIMIT);
  return [
    ...chunks.map((chunk) => ({
      type: 'section',
      text: { type: 'mrkdwn', text: chunk },
    })),
    {
      type: 'actions',
      block_id: `subconscious-proposal-actions:${proposalIdStr}`,
      elements: [
        {
          type: 'button',
          action_id: SUBCONSCIOUS_PROPOSAL_ACTION_IDS.APPLY,
          text: { type: 'plain_text', text: '✅ 실행' },
          value: proposalIdStr,
          style: 'primary',
        },
        {
          type: 'button',
          action_id: SUBCONSCIOUS_PROPOSAL_ACTION_IDS.DISMISS,
          text: { type: 'plain_text', text: '❌ 무시' },
          value: proposalIdStr,
          style: 'danger',
        },
      ],
    },
  ];
};
