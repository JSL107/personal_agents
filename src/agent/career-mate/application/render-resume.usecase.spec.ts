import { CareerProfileData } from '../domain/career-mate.type';
import { RenderResumeUsecase } from './render-resume.usecase';

const PROFILE: CareerProfileData = {
  summary: 's',
  skills: [],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};

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
    const usecase = new RenderResumeUsecase(
      repository as never,
      buildProfile as never,
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
    const usecase = new RenderResumeUsecase(
      repository as never,
      buildProfile as never,
    );

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(buildProfile.execute).toHaveBeenCalledWith({ slackUserId: 'U1' });
    expect(result.agentRunId).toBe(88);
    expect(result.profile).toEqual(PROFILE);
  });
});
