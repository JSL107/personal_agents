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
