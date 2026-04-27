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
