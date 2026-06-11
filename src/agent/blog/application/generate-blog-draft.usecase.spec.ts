import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { BlogErrorCode } from '../domain/blog-error-code.enum';
import { HermesRunnerPort } from '../domain/port/hermes-runner.port';
import { GenerateBlogDraftUsecase } from './generate-blog-draft.usecase';

// AgentRunService.execute 를 "run 클로저를 그대로 실행하고 outcome 으로 감싸는" stub 으로 대체.
const agentRunStub = {
  execute: jest.fn(async ({ run }) => {
    const r = await run({ agentRunId: 1 });
    return { result: r.result, modelUsed: r.modelUsed, agentRunId: 1 };
  }),
} as unknown as AgentRunService;

describe('GenerateBlogDraftUsecase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('빈 요청은 EMPTY_REQUEST 로 막는다', async () => {
    const runner: HermesRunnerPort = { run: jest.fn() };
    const usecase = new GenerateBlogDraftUsecase(agentRunStub, runner);
    await expect(
      usecase.execute({ requestText: '   ', slackUserId: 'U1' }),
    ).rejects.toMatchObject({ blogErrorCode: BlogErrorCode.EMPTY_REQUEST });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('Hermes stdout 에서 Notion URL 을 추출해 결과로 반환한다', async () => {
    const runner: HermesRunnerPort = {
      run: jest.fn().mockResolvedValue({
        stdout: '완료\nNOTION_URL: https://notion.so/x',
        stderr: '',
      }),
    };
    const usecase = new GenerateBlogDraftUsecase(agentRunStub, runner);
    const outcome = await usecase.execute({
      requestText: 'CS 블로그 써줘',
      slackUserId: 'U1',
    });
    expect(outcome.result.notionUrl).toBe('https://notion.so/x');
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect((runner.run as jest.Mock).mock.calls[0][0]).toContain(
      'tistory-blog 스킬을 사용해라',
    );
  });

  it('URL 미발견 시 NOTION_URL_NOT_FOUND', async () => {
    const runner: HermesRunnerPort = {
      run: jest.fn().mockResolvedValue({ stdout: '초안만 씀', stderr: '' }),
    };
    const usecase = new GenerateBlogDraftUsecase(agentRunStub, runner);
    await expect(
      usecase.execute({ requestText: 'x', slackUserId: 'U1' }),
    ).rejects.toMatchObject({ blogErrorCode: BlogErrorCode.NOTION_URL_NOT_FOUND });
  });
});
