import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { renderInjectionBlock } from '../domain/preference-injection.renderer';
import { PreferenceSection } from '../domain/preference-profile.type';
import { PreferenceProfilePort } from '../domain/port/preference-profile.port';
import {
  PREFERENCE_PROFILE_REPOSITORY,
  PreferenceProfileRepositoryPort,
} from '../domain/port/preference-profile.repository.port';

@Injectable()
export class PreferenceProfileService implements PreferenceProfilePort {
  private readonly logger = new Logger(PreferenceProfileService.name);

  constructor(
    @Inject(PREFERENCE_PROFILE_REPOSITORY)
    private readonly repository: PreferenceProfileRepositoryPort,
    private readonly configService: ConfigService,
  ) {}

  async getInjectionBlock(section: PreferenceSection): Promise<string> {
    if (!this.isInjectionEnabled()) {
      return '';
    }
    const ownerUserId = this.configService.get<string>(
      'AUTOPILOT_OWNER_SLACK_USER_ID',
    );
    if (!ownerUserId) {
      return '';
    }
    try {
      const active = await this.repository.findActive(ownerUserId);
      if (!active) {
        return '';
      }
      return renderInjectionBlock(active.profile, section);
    } catch (error) {
      // best-effort — 조회 실패 시 개인화 없이 진행(원 프롬프트 보존).
      this.logger.warn(
        `프로필 주입 조회 실패, 무개인화 진행: ${error instanceof Error ? error.message : String(error)}`,
      );
      return '';
    }
  }

  private isInjectionEnabled(): boolean {
    return (
      this.configService.get<string>('PREFERENCE_PROFILE_INJECTION_ENABLED') ===
      'true'
    );
  }
}
