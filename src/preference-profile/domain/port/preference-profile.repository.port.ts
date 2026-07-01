import { PreferenceProfile } from '../preference-profile.type';

export const PREFERENCE_PROFILE_REPOSITORY = Symbol(
  'PREFERENCE_PROFILE_REPOSITORY',
);

export interface ActiveProfile {
  version: number;
  profile: PreferenceProfile;
}

export interface PreferenceProfileRepositoryPort {
  findActive(ownerUserId: string): Promise<ActiveProfile | null>;
  // 새 version row insert + 이전 active row supersededAt 세팅을 하나의 트랜잭션으로.
  saveNewVersion(
    ownerUserId: string,
    version: number,
    profile: PreferenceProfile,
  ): Promise<void>;
}
