import { ConfigService } from '@nestjs/config';

import { EMPTY_PROFILE } from '../domain/preference-profile.type';
import { PreferenceProfileService } from './preference-profile.service';

describe('PreferenceProfileService.getInjectionBlock', () => {
  const buildConfig = (enabled: string | undefined) =>
    ({ get: jest.fn().mockReturnValue(enabled) }) as unknown as ConfigService;

  const ownerUserId = 'U_OWNER';
  const buildConfigWithOwner = (enabled: string | undefined) =>
    ({
      get: jest.fn((key: string) =>
        key === 'PREFERENCE_PROFILE_INJECTION_ENABLED'
          ? enabled
          : ownerUserId,
      ),
    }) as unknown as ConfigService;

  it('소비 게이트 미설정(\'true\' 아님)이면 repository 조회 없이 빈 문자열', async () => {
    const repo = { findActive: jest.fn() };
    const service = new PreferenceProfileService(
      repo as never,
      buildConfig(undefined),
    );
    expect(await service.getInjectionBlock('briefing')).toBe('');
    expect(repo.findActive).not.toHaveBeenCalled();
  });

  it('게이트 ON + 프로필 없음 → 빈 문자열', async () => {
    const repo = { findActive: jest.fn().mockResolvedValue(null) };
    const service = new PreferenceProfileService(
      repo as never,
      buildConfigWithOwner('true'),
    );
    expect(await service.getInjectionBlock('briefing')).toBe('');
  });

  it('게이트 ON + 프로필 존재 → 블록 포함', async () => {
    const repo = {
      findActive: jest.fn().mockResolvedValue({
        version: 1,
        profile: { ...EMPTY_PROFILE, tone: ['간결'] },
      }),
    };
    const service = new PreferenceProfileService(
      repo as never,
      buildConfigWithOwner('true'),
    );
    expect(await service.getInjectionBlock('briefing')).toContain('간결');
  });
});
