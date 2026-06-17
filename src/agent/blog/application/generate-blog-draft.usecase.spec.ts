import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { NotionClientPort } from '../../../notion/domain/port/notion-client.port';
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

// 32-hex page id 가 붙은 Notion URL (notionPageIdFromUrl 이 추출 가능).
const PAGE_ID = '2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d';
const VALID_NOTION_URL = `https://notion.so/Title-${PAGE_ID}`;

const makeNotion = (): {
  client: NotionClientPort;
  updatePageProperties: jest.Mock;
} => {
  const updatePageProperties = jest.fn().mockResolvedValue(undefined);
  return {
    client: { updatePageProperties } as unknown as NotionClientPort,
    updatePageProperties,
  };
};

describe('GenerateBlogDraftUsecase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('빈 요청은 EMPTY_REQUEST 로 막는다', async () => {
    const runner: HermesRunnerPort = { run: jest.fn() };
    const usecase = new GenerateBlogDraftUsecase(
      agentRunStub,
      runner,
      makeNotion().client,
    );
    await expect(
      usecase.execute({ requestText: '   ', slackUserId: 'U1' }),
    ).rejects.toMatchObject({ blogErrorCode: BlogErrorCode.EMPTY_REQUEST });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('URL 미발견 시 NOTION_URL_NOT_FOUND', async () => {
    const runner: HermesRunnerPort = {
      run: jest.fn().mockResolvedValue({ stdout: '초안만 씀', stderr: '' }),
    };
    const usecase = new GenerateBlogDraftUsecase(
      agentRunStub,
      runner,
      makeNotion().client,
    );
    await expect(
      usecase.execute({ requestText: 'x', slackUserId: 'U1' }),
    ).rejects.toMatchObject({
      blogErrorCode: BlogErrorCode.NOTION_URL_NOT_FOUND,
    });
  });

  it('valid page id + 메타 → 발행(상태=발행) enrich, published=true', async () => {
    const runner: HermesRunnerPort = {
      run: jest.fn().mockResolvedValue({
        stdout: `완료\nTAGS: NestJS, Notion\nSUMMARY: 요약 문장.\nNOTION_URL: ${VALID_NOTION_URL}`,
        stderr: '',
      }),
    };
    const { client, updatePageProperties } = makeNotion();
    const usecase = new GenerateBlogDraftUsecase(agentRunStub, runner, client);

    const outcome = await usecase.execute({
      requestText: 'CS 블로그 써줘',
      slackUserId: 'U1',
    });

    expect(outcome.result.notionUrl).toBe(VALID_NOTION_URL);
    expect(outcome.result.published).toBe(true);
    expect(updatePageProperties).toHaveBeenCalledTimes(1);
    const arg = updatePageProperties.mock.calls[0][0];
    expect(arg.pageId).toBe(PAGE_ID);
    expect(arg.properties['상태']).toEqual({ select: { name: '발행' } });
    expect(arg.properties['태그']).toEqual({
      multi_select: [{ name: 'NestJS' }, { name: 'Notion' }],
    });
  });

  it('enrich 실패해도 초안 URL 회신(published=false)', async () => {
    const runner: HermesRunnerPort = {
      run: jest.fn().mockResolvedValue({
        stdout: `NOTION_URL: ${VALID_NOTION_URL}`,
        stderr: '',
      }),
    };
    const updatePageProperties = jest.fn().mockRejectedValue(new Error('boom'));
    const client = { updatePageProperties } as unknown as NotionClientPort;
    const usecase = new GenerateBlogDraftUsecase(agentRunStub, runner, client);

    const outcome = await usecase.execute({
      requestText: 'x',
      slackUserId: 'U1',
    });

    expect(outcome.result.notionUrl).toBe(VALID_NOTION_URL);
    expect(outcome.result.published).toBe(false);
  });

  it('page id 파싱 실패(non-hex URL) 시 enrich skip, published=false', async () => {
    const runner: HermesRunnerPort = {
      run: jest.fn().mockResolvedValue({
        stdout: 'NOTION_URL: https://notion.so/x',
        stderr: '',
      }),
    };
    const { client, updatePageProperties } = makeNotion();
    const usecase = new GenerateBlogDraftUsecase(agentRunStub, runner, client);

    const outcome = await usecase.execute({
      requestText: 'x',
      slackUserId: 'U1',
    });

    expect(outcome.result.published).toBe(false);
    expect(updatePageProperties).not.toHaveBeenCalled();
  });
});
