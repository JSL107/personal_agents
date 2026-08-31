// Slack Bolt block_actions body 에서 button 의 value (previewId) 추출.
// body 의 정확한 타입은 Bolt 가 union 으로 노출하므로 안전하게 narrowing.
export const extractActionValue = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const actions = (body as { actions?: unknown }).actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    return null;
  }
  const value = (actions[0] as { value?: unknown }).value;
  return typeof value === 'string' && value.length > 0 ? value : null;
};

// static_select 등 선택형 element 가 고른 값. button 의 value 와 달리
// selected_option 안에 들어온다.
export const extractSelectedOptionValue = (body: unknown): string | null => {
  const action = firstAction(body);
  if (action === null) {
    return null;
  }
  const selected = (action as { selected_option?: unknown }).selected_option;
  if (typeof selected !== 'object' || selected === null) {
    return null;
  }
  const value = (selected as { value?: unknown }).value;
  return typeof value === 'string' && value.length > 0 ? value : null;
};

// 이벤트를 일으킨 element 가 속한 블록의 id. element 자체 value 를 못 쓰는
// 선택형 컨트롤에서 대상 식별자를 실어 보내는 통로로 쓴다.
export const extractActionBlockId = (body: unknown): string | null => {
  const action = firstAction(body);
  if (action === null) {
    return null;
  }
  const blockId = (action as { block_id?: unknown }).block_id;
  return typeof blockId === 'string' && blockId.length > 0 ? blockId : null;
};

// plain_text_input(dispatch_action) 이 보내온 입력값.
// extractActionValue 와 달리 빈 값을 null 로 접지 않는다 — 사용자가 칸을 비우고 Enter 를
// 누르면 Slack 이 value=null 을 보내는데, 그걸 "이벤트 해석 실패" 로 버리면 한 번 적은
// 내용을 지울 방법이 없어진다. 지움도 유효한 입력이라 빈 문자열로 정규화해 돌려준다.
export const extractInputValue = (body: unknown): string | null => {
  const action = firstAction(body);
  if (action === null) {
    return null;
  }
  const value = (action as { value?: unknown }).value;
  if (value === null || value === undefined) {
    return '';
  }
  return typeof value === 'string' ? value : null;
};

// 이벤트가 일어난 메시지의 좌표(channel/ts). chat.update 로 그 카드를 다시 그릴 때 쓴다.
//
// response_url + replace_original 대신 이 경로를 쓰는 이유: 승인 카드는 chat.postMessage 로
// 올라간다. 같은 카드를 종결 상태로 다시 그리는 기존 경로(SlackPreviewCardUpdater)도 저장된
// 좌표에 chat.update 를 건다 — 이 레포에서 실제로 도는 것이 확인된 방식은 그쪽이다.
export const extractActionMessageRef = (
  body: unknown,
): { channel: string; ts: string } | null => {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const container = (record.container ?? {}) as Record<string, unknown>;
  const message = (record.message ?? {}) as Record<string, unknown>;
  const channelRecord = (record.channel ?? {}) as Record<string, unknown>;
  const channel = firstString([container.channel_id, channelRecord.id]);
  const ts = firstString([container.message_ts, message.ts]);
  if (channel === null || ts === null) {
    return null;
  }
  return { channel, ts };
};

const firstString = (candidates: unknown[]): string | null => {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
};

const firstAction = (body: unknown): unknown => {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const actions = (body as { actions?: unknown }).actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    return null;
  }
  return actions[0];
};

export const extractActionUserId = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const user = (body as { user?: unknown }).user;
  if (typeof user !== 'object' || user === null) {
    return null;
  }
  const id = (user as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
};
