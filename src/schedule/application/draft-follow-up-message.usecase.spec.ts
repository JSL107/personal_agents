import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { DraftFollowUpMessageInput } from '../domain/draft-follow-up-message.type';
import { DraftFollowUpMessageUsecase } from './draft-follow-up-message.usecase';

describe('DraftFollowUpMessageUsecase', () => {
  const route = jest.fn();
  const execute = jest.fn();
  const input = {
    item: { id: 1, title: '결제 API', memo: '배포 완료' },
    followUp: { id: 2, recipient: 'PM', topic: '결과 전달' },
    recentEvents: [{ kind: 'STATUS_CHANGED', payload: { text: '완료' } }],
  } as unknown as DraftFollowUpMessageInput;
  const usecase = new DraftFollowUpMessageUsecase(
    { route } as unknown as ModelRouterUsecase,
    { execute } as unknown as AgentRunService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    execute.mockImplementation(
      async ({ run }: { run: () => Promise<unknown> }) => ({
        result: ((await run()) as { result: string }).result,
      }),
    );
    route.mockResolvedValue({
      text: '배포했습니다. 확인 부탁드립니다.',
      modelUsed: 'codex-cli',
    });
  });

  it('초안용 자유 텍스트를 요청하고 신뢰할 수 없는 메모와 사건을 감싼다', async () => {
    expect(await usecase.execute(input)).toBe(
      '배포했습니다. 확인 부탁드립니다.',
    );
    expect(route.mock.calls[0][0].request.outputSchema).toBeUndefined();
    expect(route.mock.calls[0][0].request.prompt).toContain(
      '<untrusted-input>',
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        inputSnapshot: expect.objectContaining({ followUpId: 2 }),
      }),
    );
  });

  it('모델 실패 시 null로 접어 알림을 막지 않는다', async () => {
    route.mockRejectedValue(new Error('quota'));
    expect(await usecase.execute(input)).toBeNull();
  });
});
