import { PreferenceSection } from '../preference-profile.type';

export const PREFERENCE_PROFILE_PORT = Symbol('PREFERENCE_PROFILE_PORT');

export interface PreferenceProfilePort {
  // 소비 게이트 OFF or 프로필 없음 → '' (동작 변화 0).
  getInjectionBlock(section: PreferenceSection): Promise<string>;
}
