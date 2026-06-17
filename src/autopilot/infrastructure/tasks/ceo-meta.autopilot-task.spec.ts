import { CeoException } from '../../../agent/ceo/domain/ceo.exception';
import { CeoErrorCode } from '../../../agent/ceo/domain/ceo-error-code.enum';
import { CeoMetaAutopilotTask } from './ceo-meta.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-17' };

describe('CeoMetaAutopilotTask', () => {
  it('id 는 ceo-meta', () => {
    expect(new CeoMetaAutopilotTask({} as never).id).toBe('ceo-meta');
  });

  it('NO_PO_EVAL_RUN 이면 graceful skip 안내(skip=false, 발송 가능)', async () => {
    const execute = jest.fn().mockRejectedValue(
      new CeoException({
        code: CeoErrorCode.NO_PO_EVAL_RUN,
        message: '없음',
        status: 502,
      } as never),
    );
    const task = new CeoMetaAutopilotTask({ execute } as never);

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.slackText).toContain('skip');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U1', range: 'WEEK' }),
    );
  });

  it('그 외 에러는 throw (consumer 가 실패 통지)', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(
      new CeoMetaAutopilotTask({ execute } as never).run(CTX),
    ).rejects.toThrow('boom');
  });
});
