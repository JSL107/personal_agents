import { PreviewCardState } from '../../preview-gate/domain/port/preview-card.port';
import { PREVIEW_ACTION_IDS } from '../../preview-gate/domain/preview-action.type';
import { linkifyBareUrls } from './mrkdwn.util';

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
  // 카드 본문에도 맨 주소 접기를 적용한다 — 승인 카드는 사용자가 가장 오래 들여다보는 화면이라
  // 주소 한 줄이 판단 근거를 밀어내면 안 된다. 이미 `<url|이름>` 인 링크는 그대로 통과한다(멱등).
  const chunks = chunkMrkdwnText(
    linkifyBareUrls(previewText),
    SECTION_MRKDWN_LIMIT,
  );
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
    // 자를 자리가 `<url|이름>` 한가운데면 링크가 두 조각으로 갈려 양쪽 모두 깨진 텍스트가 된다.
    // 열린 채 끝나는 링크가 있으면 그 링크 시작 앞으로 당긴다.
    // (링크 하나가 limit 을 통째로 넘기는 극단은 당길 자리가 없어 그대로 자른다 — 무한 루프 방지.)
    const beforeCut = remaining.slice(0, cutAt);
    const lastOpen = beforeCut.lastIndexOf('<');
    if (lastOpen > 0 && lastOpen > beforeCut.lastIndexOf('>')) {
      cutAt = lastOpen;
    }
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).replace(/^\n+/, '');
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
};

// 상태별 카드 머리말. APPLY_FAILED 만 버튼을 되살려 재시도를 허용한다.
const RESOLVED_HEADERS: Record<PreviewCardState, string> = {
  APPLYING: '⏳ *처리 중* — 완료되면 이 메시지가 결과로 바뀝니다.',
  APPLIED: '✅ *적용 완료*',
  CANCELLED: '❌ *취소됨* — 부작용 없이 마감되었습니다.',
  EXPIRED: '⌛ *만료됨* — 승인 없이 마감되었습니다.',
  APPLY_FAILED: '⚠️ *적용 실패* — 아래 버튼으로 다시 시도할 수 있습니다.',
};

// PO-2 카드 갱신 — chat.update 로 다시 그릴 블록. 머리말 + 본문 section.
// APPLY_FAILED 는 buildPreviewBlocks 의 버튼을 그대로 이어 붙여 재시도 경로를 유지한다.
export const buildResolvedPreviewBlocks = ({
  state,
  bodyText,
  previewId,
}: {
  state: PreviewCardState;
  bodyText: string;
  previewId: string;
}): Array<Record<string, unknown>> => {
  const header = RESOLVED_HEADERS[state];
  const bodyChunks = chunkMrkdwnText(
    linkifyBareUrls(bodyText),
    SECTION_MRKDWN_LIMIT,
  );
  const sections: Array<Record<string, unknown>> = [
    { type: 'section', text: { type: 'mrkdwn', text: header } },
    ...bodyChunks.map((chunk) => ({
      type: 'section',
      text: { type: 'mrkdwn', text: chunk },
    })),
  ];
  if (state === 'APPLY_FAILED') {
    // buildPreviewBlocks 의 마지막 요소가 actions 블록 — 버튼만 이어 붙인다.
    const withButtons = buildPreviewBlocks({ previewText: '', previewId });
    const actionsBlock = withButtons[withButtons.length - 1];
    return [...sections, actionsBlock];
  }
  return sections;
};
