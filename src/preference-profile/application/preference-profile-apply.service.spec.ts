import { EMPTY_PROFILE } from '../domain/preference-profile.type';
import { PreferenceProfileApplyService } from './preference-profile-apply.service';

describe('PreferenceProfileApplyService.apply', () => {
  const buildDeps = () => {
    const profileRepo = {
      findActive: jest.fn(),
      saveNewVersion: jest.fn().mockResolvedValue(undefined),
    };
    const proposalRepo = {
      findById: jest.fn(),
      markResolved: jest.fn().mockResolvedValue(undefined),
    };
    return { profileRepo, proposalRepo };
  };

  it('baseVersion 이 active 와 일치하면 새 version 저장 + APPROVED', async () => {
    const { profileRepo, proposalRepo } = buildDeps();
    proposalRepo.findById.mockResolvedValue({
      id: 7,
      ownerUserId: 'U1',
      baseVersion: 2,
      diff: { tone: { add: ['간결'] } },
      rationale: 'r',
      status: 'PENDING',
      createdAt: new Date(),
    });
    profileRepo.findActive.mockResolvedValue({ version: 2, profile: EMPTY_PROFILE });

    const service = new PreferenceProfileApplyService(
      profileRepo as never,
      proposalRepo as never,
    );
    const result = await service.apply(7);

    expect(result).toBe('APPLIED');
    expect(profileRepo.saveNewVersion).toHaveBeenCalledWith(
      'U1',
      3,
      expect.objectContaining({ tone: ['간결'] }),
    );
    expect(proposalRepo.markResolved).toHaveBeenCalledWith(7, 'APPROVED');
  });

  it('첫 프로필(active 없음) 이면 version 1 생성', async () => {
    const { profileRepo, proposalRepo } = buildDeps();
    proposalRepo.findById.mockResolvedValue({
      id: 1,
      ownerUserId: 'U1',
      baseVersion: 0,
      diff: { tone: { add: ['단정적'] } },
      rationale: 'r',
      status: 'PENDING',
      createdAt: new Date(),
    });
    profileRepo.findActive.mockResolvedValue(null);

    const service = new PreferenceProfileApplyService(
      profileRepo as never,
      proposalRepo as never,
    );
    expect(await service.apply(1)).toBe('APPLIED');
    expect(profileRepo.saveNewVersion).toHaveBeenCalledWith(
      'U1',
      1,
      expect.objectContaining({ tone: ['단정적'] }),
    );
  });

  it('baseVersion 이 active 와 다르면 STALE (저장 안 함)', async () => {
    const { profileRepo, proposalRepo } = buildDeps();
    proposalRepo.findById.mockResolvedValue({
      id: 9,
      ownerUserId: 'U1',
      baseVersion: 2,
      diff: {},
      rationale: 'r',
      status: 'PENDING',
      createdAt: new Date(),
    });
    profileRepo.findActive.mockResolvedValue({ version: 5, profile: EMPTY_PROFILE });

    const service = new PreferenceProfileApplyService(
      profileRepo as never,
      proposalRepo as never,
    );
    expect(await service.apply(9)).toBe('STALE');
    expect(profileRepo.saveNewVersion).not.toHaveBeenCalled();
  });
});
