import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AddApplicationUsecase } from '../application/add-application.usecase';
import { ListApplicationsUsecase } from '../application/list-applications.usecase';
import { UpdateApplicationUsecase } from '../application/update-application.usecase';
import { JobApplicationDispatcher } from './job-application.dispatcher';

const makeRoute = (text: string) =>
  jest.fn().mockResolvedValue({
    text,
    modelUsed: 'codex-cli',
    provider: 'CHATGPT',
  });

describe('JobApplicationDispatcher', () => {
  it('ADD → addApplication.execute 호출 + formattedText', async () => {
    const route = makeRoute(
      '{"action":"ADD","company":"토스","role":"백엔드"}',
    );
    const addExecute = jest.fn().mockResolvedValue({
      agentRunId: 7,
      modelUsed: 'deterministic',
      result: {
        id: 1,
        slackUserId: 'U1',
        company: '토스',
        role: '백엔드',
        jdUrl: null,
        status: 'APPLIED',
        appliedAt: { year: 2026, month: 6, day: 16 },
        deadline: null,
        nextFollowUpAt: null,
        notes: null,
        createdAt: new Date(),
      },
    });
    const dispatcher = new JobApplicationDispatcher(
      { route } as unknown as ModelRouterUsecase,
      { execute: addExecute } as unknown as AddApplicationUsecase,
      {} as UpdateApplicationUsecase,
      {} as ListApplicationsUsecase,
    );

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '토스 백엔드 지원했어',
    });

    expect(route).toHaveBeenCalled();
    expect(addExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: 'U1',
        company: '토스',
        role: '백엔드',
        status: 'APPLIED',
      }),
    );
    expect(outcome.agentRunId).toBe(7);
    expect(outcome.formattedText).toContain('등록');
  });

  it('UPDATE_STATUS → updateApplication.execute 호출', async () => {
    const route = makeRoute(
      '{"action":"UPDATE_STATUS","ref":"토스","status":"SCREENING"}',
    );
    const updateExecute = jest.fn().mockResolvedValue({
      agentRunId: 9,
      modelUsed: 'deterministic',
      result: {
        id: 1,
        slackUserId: 'U1',
        company: '토스',
        role: '백엔드',
        jdUrl: null,
        status: 'SCREENING',
        appliedAt: { year: 2026, month: 6, day: 16 },
        deadline: null,
        nextFollowUpAt: null,
        notes: null,
        createdAt: new Date(),
      },
    });
    const dispatcher = new JobApplicationDispatcher(
      { route } as unknown as ModelRouterUsecase,
      {} as AddApplicationUsecase,
      { execute: updateExecute } as unknown as UpdateApplicationUsecase,
      {} as ListApplicationsUsecase,
    );

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '토스 서류 합격',
    });

    expect(updateExecute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      ref: '토스',
      status: 'SCREENING',
    });
    expect(outcome.formattedText).toContain('서류심사');
  });

  it('LIST → listApplications.execute 호출 (agentRunId 0)', async () => {
    const route = makeRoute('{"action":"LIST"}');
    const listExecute = jest.fn().mockResolvedValue([]);
    const dispatcher = new JobApplicationDispatcher(
      { route } as unknown as ModelRouterUsecase,
      {} as AddApplicationUsecase,
      {} as UpdateApplicationUsecase,
      { execute: listExecute } as unknown as ListApplicationsUsecase,
    );

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '지원 현황',
    });

    expect(listExecute).toHaveBeenCalledWith({ slackUserId: 'U1' });
    expect(outcome.agentRunId).toBe(0);
    expect(outcome.formattedText).toContain('지원 현황');
  });

  it('UNKNOWN → 안내 문구', async () => {
    const route = makeRoute('{"action":"UNKNOWN"}');
    const dispatcher = new JobApplicationDispatcher(
      { route } as unknown as ModelRouterUsecase,
      {} as AddApplicationUsecase,
      {} as UpdateApplicationUsecase,
      {} as ListApplicationsUsecase,
    );

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '아무말',
    });

    expect(outcome.agentRunId).toBe(0);
    expect(outcome.formattedText).toContain('도와드릴까요');
  });
});
