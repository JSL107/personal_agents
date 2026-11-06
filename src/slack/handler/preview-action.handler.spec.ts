import { App } from '@slack/bolt';

import { ApplyPreviewUsecase } from '../../preview-gate/application/apply-preview.usecase';
import { CancelPreviewUsecase } from '../../preview-gate/application/cancel-preview.usecase';
import { PREVIEW_ACTION_IDS } from '../../preview-gate/domain/preview-action.type';
import { PreviewActionHandler } from './preview-action.handler';

describe('PreviewActionHandler', () => {
  const register = (
    applyExecute = jest.fn().mockResolvedValue({ resultText: '동기화 완료' }),
  ) => {
    const handlers = new Map<string, (args: never) => Promise<void>>();
    const app = {
      action: (id: string, handler: (args: never) => Promise<void>) =>
        handlers.set(id, handler),
    } as unknown as App;
    const applyPreview = {
      execute: applyExecute,
    } as unknown as ApplyPreviewUsecase;
    const cancelPreview = {
      execute: jest.fn().mockResolvedValue(undefined),
    } as unknown as CancelPreviewUsecase;
    new PreviewActionHandler(applyPreview, cancelPreview).register(app);
    return handlers;
  };

  const args = (respond: jest.Mock) => ({
    ack: jest.fn().mockResolvedValue(undefined),
    body: { user: { id: 'U1' }, actions: [{ value: 'p1' }] },
    respond,
  });

  it('적용 안내에 내부 이름과 줄표를 싣지 않는다', async () => {
    const respond = jest.fn();
    await register().get(PREVIEW_ACTION_IDS.APPLY)?.(args(respond) as never);
    const text = respond.mock.calls[0][0].text as string;
    expect(text).toContain('✅ 적용 완료: 동기화 완료');
    expect(text).not.toContain('Preview');
    expect(text).not.toContain('—');
  });

  it('적용이 실패하면 재시도 버튼이 남은 카드를 덮어쓰지 않는다', async () => {
    const respond = jest.fn();
    const handlers = register(
      jest.fn().mockRejectedValue(new Error('HTTP 400')),
    );
    await handlers.get(PREVIEW_ACTION_IDS.APPLY)?.(args(respond) as never);
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ replace_original: false }),
    );
  });

  it('취소 안내에 줄표를 싣지 않는다', async () => {
    const respond = jest.fn();
    await register().get(PREVIEW_ACTION_IDS.CANCEL)?.(args(respond) as never);
    expect(respond.mock.calls[0][0].text).toBe(
      '❌ 취소했어요. 다른 변경은 없어요.',
    );
  });
});
