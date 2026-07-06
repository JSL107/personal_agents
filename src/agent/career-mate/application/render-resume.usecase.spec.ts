import { CareerProfileData } from '../domain/career-mate.type';
import { RenderResumeUsecase } from './render-resume.usecase';

const PROFILE: CareerProfileData = {
  summary: 's',
  skills: [],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};

const makeNotion = () => ({
  findOrCreateChildPage: jest
    .fn()
    .mockResolvedValue({ pageId: 'r1', url: 'https://notion/r1' }),
  replaceAllBlocks: jest.fn().mockResolvedValue(undefined),
});

describe('RenderResumeUsecase', () => {
  it('프로필이 있으면 그대로 반환한다 (Build 미호출)', async () => {
    const repository = {
      findLatestBySlackUser: jest.fn().mockResolvedValue({
        id: 1,
        agentRunId: 5,
        profileJson: PROFILE,
        createdAt: new Date(),
      }),
    };
    const buildProfile = { execute: jest.fn() };
    const notion = makeNotion();
    const config = { get: jest.fn().mockReturnValue('RESUME_PARENT') };
    const usecase = new RenderResumeUsecase(
      repository as never,
      buildProfile as never,
      notion as never,
      config as never,
    );

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(result.profile).toEqual(PROFILE);
    expect(result.agentRunId).toBe(5);
    expect(buildProfile.execute).not.toHaveBeenCalled();
  });

  it('프로필이 없으면 자동 Build 후 반환한다', async () => {
    const repository = {
      findLatestBySlackUser: jest.fn().mockResolvedValue(null),
    };
    const buildProfile = {
      execute: jest.fn().mockResolvedValue({
        result: PROFILE,
        modelUsed: 'claude-cli',
        agentRunId: 88,
      }),
    };
    const notion = makeNotion();
    const config = { get: jest.fn().mockReturnValue('RESUME_PARENT') };
    const usecase = new RenderResumeUsecase(
      repository as never,
      buildProfile as never,
      notion as never,
      config as never,
    );

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(buildProfile.execute).toHaveBeenCalledWith({ slackUserId: 'U1' });
    expect(result.agentRunId).toBe(88);
    expect(result.profile).toEqual(PROFILE);
  });

  it('CAREER_RESUME_NOTION_PAGE_ID 설정 시 Notion 에 미러한다', async () => {
    const repository = {
      findLatestBySlackUser: jest.fn().mockResolvedValue({
        id: 1,
        agentRunId: 5,
        profileJson: PROFILE,
        createdAt: new Date(),
      }),
    };
    const notion = makeNotion();
    const config = { get: jest.fn().mockReturnValue('RESUME_PARENT') };
    const usecase = new RenderResumeUsecase(
      repository as never,
      { execute: jest.fn() } as never,
      notion as never,
      config as never,
    );

    await usecase.execute({ slackUserId: 'U1' });

    expect(notion.findOrCreateChildPage).toHaveBeenCalledTimes(1);
    expect(notion.replaceAllBlocks).toHaveBeenCalledTimes(1);
  });

  it('env 미설정 시 미러를 건너뛴다', async () => {
    const repository = {
      findLatestBySlackUser: jest.fn().mockResolvedValue({
        id: 1,
        agentRunId: 5,
        profileJson: PROFILE,
        createdAt: new Date(),
      }),
    };
    const notion = makeNotion();
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const usecase = new RenderResumeUsecase(
      repository as never,
      { execute: jest.fn() } as never,
      notion as never,
      config as never,
    );

    await usecase.execute({ slackUserId: 'U1' });

    expect(notion.findOrCreateChildPage).not.toHaveBeenCalled();
    expect(notion.replaceAllBlocks).not.toHaveBeenCalled();
  });

  it('미러 실패해도 결과는 정상 반환한다 (best-effort)', async () => {
    const repository = {
      findLatestBySlackUser: jest.fn().mockResolvedValue({
        id: 1,
        agentRunId: 5,
        profileJson: PROFILE,
        createdAt: new Date(),
      }),
    };
    const notion = makeNotion();
    notion.replaceAllBlocks = jest.fn().mockRejectedValue(new Error('boom'));
    const config = { get: jest.fn().mockReturnValue('RESUME_PARENT') };
    const usecase = new RenderResumeUsecase(
      repository as never,
      { execute: jest.fn() } as never,
      notion as never,
      config as never,
    );

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(result.agentRunId).toBe(5);
  });
});
