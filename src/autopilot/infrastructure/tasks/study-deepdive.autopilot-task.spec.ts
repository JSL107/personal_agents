import { ConfigService } from '@nestjs/config';

import { ExpandStudyBriefUsecase } from '../../../study-brief-cron/application/expand-study-brief.usecase';
import { StudyDeepdiveAutopilotTask } from './study-deepdive.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-08-20' };

interface BuildOptions {
  enabled?: string;
  configured?: boolean;
  result?: unknown;
}

const build = (options: BuildOptions = {}) => {
  const execute = jest.fn().mockResolvedValue({
    result: options.result ?? {
      status: 'created',
      briefId: 42,
      topic: 'Agentic AI Threat Modeling',
      title: '에이전트 권한 경계 설계',
      tags: [],
      bodyLength: 5_200,
      notionUrl: 'https://notion.so/1',
    },
    modelUsed: 'hermes-cli',
    agentRunId: 7,
  });
  const expandStudyBrief = {
    execute,
    isConfigured: jest.fn(() => options.configured ?? true),
  } as unknown as jest.Mocked<ExpandStudyBriefUsecase>;
  const config = {
    get: jest.fn(() => options.enabled),
  } as unknown as jest.Mocked<ConfigService>;
  return {
    task: new StudyDeepdiveAutopilotTask(expandStudyBrief, config),
    execute,
  };
};

describe('StudyDeepdiveAutopilotTask', () => {
  it('확장 결과를 evening digest 한 줄로 보고한다', async () => {
    const { task, execute } = build();

    const result = await task.run(context);

    expect(execute).toHaveBeenCalledWith({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-08-20',
    });
    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('Agentic AI Threat Modeling');
    expect(result.summaryText).toContain('5,200자');
    expect(result.summaryText).toContain('https://notion.so/1');
  });

  it("STUDY_DEEPDIVE_ENABLED='false' 면 실행하지 않는다", async () => {
    const { task, execute } = build({ enabled: 'false' });

    expect(await task.run(context)).toEqual({ skip: true });
    expect(execute).not.toHaveBeenCalled();
  });

  // 초안 DB 를 설정하지 않은 환경에서 매일 FAILED AgentRun 만 쌓이는 것을 막는다.
  it('초안 DB 설정이 없으면 조용히 넘긴다', async () => {
    const { task, execute } = build({ configured: false });

    expect(await task.run(context)).toEqual({ skip: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it('확장할 브리프가 없으면 알리지 않는다', async () => {
    const { task } = build({
      result: { status: 'empty', message: '확장할 오늘의 공부가 없습니다.' },
    });

    expect(await task.run(context)).toEqual({ skip: true });
  });
});
