import { App } from '@slack/bolt';

import { AgentRunVerdictRepositoryPort } from '../../agent-run/domain/port/agent-run-verdict.repository.port';
import { RunVerdictActionHandler } from './run-verdict-action.handler';

type ActionHandler = (args: {
  ack: jest.Mock;
  body: unknown;
  respond: jest.Mock;
  client: { chat: { update: jest.Mock } };
}) => Promise<void>;

const buildAppMock = (): { app: App; getHandler: () => ActionHandler } => {
  let captured: ActionHandler | undefined;
  const app = {
    action: jest.fn((_constraint: unknown, handler: ActionHandler) => {
      captured = handler;
    }),
  } as unknown as App;
  return {
    app,
    getHandler: () => {
      if (!captured) {
        throw new Error('action handler 미등록');
      }
      return captured;
    },
  };
};

const buildBody = (value: string, userId = 'U1') => ({
  user: { id: userId },
  actions: [{ value }],
  container: { channel_id: 'C1', message_ts: '2.2' },
});

const validValue = (verdict: string) =>
  JSON.stringify({
    agentRunId: 6300,
    facet: 'retro_problem',
    verdict,
    facets: ['retro_problem', 'overall'],
  });

const setup = (
  repositoryOverride: Partial<jest.Mocked<AgentRunVerdictRepositoryPort>> = {},
) => {
  const repository: jest.Mocked<AgentRunVerdictRepositoryPort> = {
    record: jest.fn().mockResolvedValue(undefined),
    findByRun: jest.fn().mockResolvedValue([]),
    ...repositoryOverride,
  };
  const { app, getHandler } = buildAppMock();
  new RunVerdictActionHandler(repository).register(app);
  const respond = jest.fn().mockResolvedValue(undefined);
  const update = jest.fn().mockResolvedValue({ ok: true });
  const invoke = (value: string, userId?: string) =>
    getHandler()({
      ack: jest.fn().mockResolvedValue(undefined),
      body: buildBody(value, userId),
      respond,
      client: { chat: { update } },
    });
  return { repository, respond, update, invoke };
};

describe('RunVerdictActionHandler', () => {
  it('허용 목록 밖 값은 저장하지 않고 누른 사람에게 알린다', async () => {
    const { repository, respond, invoke } = setup();

    await invoke(validValue('GOOD')); // retro_problem 축에는 GOOD 이 없다

    expect(repository.record).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ response_type: 'ephemeral' }),
    );
  });

  it('누르면 저장하고 그 댓글을 판정됨으로 다시 그린다 — 다시 누르면 새 값으로 덮어쓴다', async () => {
    const { repository, update, respond, invoke } = setup();
    repository.findByRun
      .mockResolvedValueOnce([
        { facet: 'retro_problem', verdict: 'REAL', slackUserId: 'U1' },
      ])
      .mockResolvedValueOnce([
        { facet: 'retro_problem', verdict: 'FABRICATED', slackUserId: 'U1' },
      ]);

    await invoke(validValue('REAL'));
    await invoke(validValue('FABRICATED'));

    expect(repository.record).toHaveBeenNthCalledWith(2, {
      agentRunId: 6300,
      facet: 'retro_problem',
      verdict: 'FABRICATED',
      slackUserId: 'U1',
      source: 'button',
    });
    const lastUpdate = update.mock.calls[1][0];
    expect(lastUpdate).toMatchObject({ channel: 'C1', ts: '2.2' });
    expect(JSON.stringify(lastUpdate.blocks)).toContain(
      '판정됨: 지어낸 것 <@U1> (바꾸려면 다시 누르기)',
    );
    // 처음 낸 축 목록을 유지한다 — 회고 전체 줄도 그대로 남는다.
    expect(JSON.stringify(lastUpdate.blocks)).toContain(
      '*회고 전체* — 판정 전',
    );
    expect(repository.findByRun).toHaveBeenCalledWith(6300);
    expect(respond).not.toHaveBeenCalled();
  });

  it('거의 동시에 두 사람이 누르면 늦게 도착한 오래된 조회가 댓글을 덮어쓰지 않는다', async () => {
    const { repository, update, invoke } = setup();
    // 첫 클릭의 조회는 U1 만 보이는 시점의 목록이고, 응답이 늦게 온다.
    let releaseStaleRead: (rows: unknown) => void = () => undefined;
    repository.findByRun
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseStaleRead = resolve as (rows: unknown) => void;
          }),
      )
      .mockResolvedValueOnce([
        { facet: 'retro_problem', verdict: 'REAL', slackUserId: 'U1' },
        { facet: 'retro_problem', verdict: 'FABRICATED', slackUserId: 'U2' },
      ]);

    const first = invoke(validValue('REAL'), 'U1');
    const second = invoke(validValue('FABRICATED'), 'U2');
    // 둘째 클릭이 먼저 끝날 기회를 준 뒤에 첫 조회를 풀어 준다.
    await new Promise((resolve) => setImmediate(resolve));
    releaseStaleRead([
      { facet: 'retro_problem', verdict: 'REAL', slackUserId: 'U1' },
    ]);
    await Promise.all([first, second]);

    expect(update).toHaveBeenCalledTimes(2);
    const lastBlocks = JSON.stringify(update.mock.calls[1][0].blocks);
    expect(lastBlocks).toContain('<@U1>');
    expect(lastBlocks).toContain('<@U2>');
  });

  it('저장이 실패하면 조용히 넘기지 않고 누른 사람에게 알린다', async () => {
    const { update, respond, invoke } = setup({
      record: jest.fn().mockRejectedValue(new Error('DB down')),
    });

    await invoke(validValue('REAL'));

    expect(update).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        response_type: 'ephemeral',
        text: expect.stringContaining('판정 저장 실패'),
      }),
    );
  });

  it('저장 뒤 댓글 갱신만 실패하면 저장됐다는 사실과 함께 알린다', async () => {
    const { respond, update, invoke } = setup();
    update.mockRejectedValue(new Error('message_not_found'));

    await invoke(validValue('REAL'));

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '판정은 저장했지만 댓글 표시를 갱신하지 못했습니다.',
      }),
    );
  });
});
