import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CareerProfileData } from '../domain/career-mate.type';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import {
  PORTFOLIO_SITE_CLIENT_PORT,
  PortfolioSiteClientPort,
} from '../domain/port/portfolio-site.client.port';
import {
  buildPortfolioSitePayload,
  PortfolioSitePayloadOptions,
  PortfolioSiteProjectPayload,
  PortfolioSiteSkillGroupPayload,
} from '../domain/portfolio-site-payload';
import { BuildCareerProfileUsecase } from './build-career-profile.usecase';

export interface PublishPortfolioSiteInput {
  slackUserId: string;
}

export interface PublishPortfolioSiteFailure {
  target: string;
  reason: string;
}

export interface PublishPortfolioSiteResult {
  createdProjects: string[];
  updatedProjects: string[];
  createdSkillGroups: string[];
  updatedSkillGroups: string[];
  // 근거 PR 이 없어 멱등 키를 만들 수 없던 성과 제목.
  skippedTitles: string[];
  failures: PublishPortfolioSiteFailure[];
  // 발행 후 재조회에서 확인되지 않은 slug. 정상이면 빈 배열.
  missingAfterPublish: string[];
  agentRunId: number;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// `PORTFOLIO_ANONYMIZED_OWNERS=owner-a,owner-b` → ['owner-a', 'owner-b'].
const parseAnonymizedOwners = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((owner) => owner.trim().toLowerCase())
    .filter((owner) => owner.length > 0);

// 경력 프로필을 포트폴리오 사이트(Portfolio OS)에 비공개 초안으로 발행한다.
//
// `RenderPortfolioUsecase` 의 형제 — 같은 프로필을 Notion 페이지 대신 사이트 API 로 보낸다.
// 승인 카드를 거치지 않는 이유는 발행이 `published: false` 라 공개되는 부작용이 없고,
// "공개" 게이트가 사이트 편집기에 사람 손으로 이미 있기 때문이다.
// 설계: docs/superpowers/plans/2026-08-18-portfolio-site-automation.md §4-C.
@Injectable()
export class PublishPortfolioSiteUsecase {
  private readonly logger = new Logger(PublishPortfolioSiteUsecase.name);

  constructor(
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    private readonly buildProfile: BuildCareerProfileUsecase,
    @Inject(PORTFOLIO_SITE_CLIENT_PORT)
    private readonly siteClient: PortfolioSiteClientPort,
    private readonly configService: ConfigService,
  ) {}

  async execute({
    slackUserId,
  }: PublishPortfolioSiteInput): Promise<PublishPortfolioSiteResult> {
    const { profile, agentRunId } = await this.resolveProfile(slackUserId);
    const payload = buildPortfolioSitePayload(profile, this.payloadOptions());
    const failures: PublishPortfolioSiteFailure[] = [];

    const projects = await this.publishProjects(payload.projects, failures);
    const skillGroups = await this.publishSkillGroups(
      payload.skillGroups,
      failures,
    );
    const missingAfterPublish = await this.verifyPublished(
      [...projects.createdProjects, ...projects.updatedProjects],
      failures,
    );

    return {
      ...projects,
      ...skillGroups,
      skippedTitles: payload.skippedTitles,
      failures,
      missingAfterPublish,
      agentRunId,
    };
  }

  private payloadOptions(): PortfolioSitePayloadOptions {
    return {
      anonymizedOwners: parseAnonymizedOwners(
        this.configService.get<string>('PORTFOLIO_ANONYMIZED_OWNERS'),
      ),
    };
  }

  private async resolveProfile(
    slackUserId: string,
  ): Promise<{ profile: CareerProfileData; agentRunId: number }> {
    const latest = await this.repository.findLatestBySlackUser(slackUserId);
    if (latest) {
      return {
        profile: latest.profileJson,
        agentRunId: latest.agentRunId ?? 0,
      };
    }
    const built = await this.buildProfile.execute({ slackUserId });
    return { profile: built.result, agentRunId: built.agentRunId };
  }

  // 쓰기 응답만 믿지 않고 목록을 다시 읽어 확인한다.
  //
  // 공개 페이지(`/public/portfolios/:handle`)로 확인하지 않는 이유 — 발행물이 `published: false`
  // 라 공개 응답에는 원래 나오지 않는다. 거기서 "안 보인다"는 결과는 발행 성공과 실패를 구분하지
  // 못하므로 검증이 아니라 장식이 된다. 인증 경로는 비공개 초안도 그대로 돌려준다.
  private async verifyPublished(
    expectedSlugs: string[],
    failures: PublishPortfolioSiteFailure[],
  ): Promise<string[]> {
    if (expectedSlugs.length === 0) {
      return [];
    }
    try {
      const after = await this.siteClient.listProjects();
      const slugs = new Set(after.map((project) => project.slug));
      const missing = expectedSlugs.filter((slug) => !slugs.has(slug));
      if (missing.length > 0) {
        this.logger.warn(
          `사이트 발행 확인 실패 — 재조회에 없는 slug ${missing.join(', ')}`,
        );
      }
      return missing;
    } catch (error) {
      failures.push({ target: 'verify', reason: errorMessage(error) });
      return [];
    }
  }

  // slug 를 멱등 키로 쓴다 — 사이트에 (userId, slug) 유니크 제약이 있어 같은 성과가 두 번
  // 올라가지 않는다. 있으면 PATCH, 없으면 POST.
  private async publishProjects(
    payloads: PortfolioSiteProjectPayload[],
    failures: PublishPortfolioSiteFailure[],
  ): Promise<{ createdProjects: string[]; updatedProjects: string[] }> {
    const createdProjects: string[] = [];
    const updatedProjects: string[] = [];
    if (payloads.length === 0) {
      return { createdProjects, updatedProjects };
    }

    const existing = await this.siteClient.listProjects();
    const idBySlug = new Map(
      existing.map((project) => [project.slug, project.id]),
    );

    for (const payload of payloads) {
      const existingId = idBySlug.get(payload.slug);
      try {
        if (existingId) {
          await this.siteClient.updateProject(
            existingId,
            toUpdatePayload(payload),
          );
          updatedProjects.push(payload.slug);
          continue;
        }
        await this.siteClient.createProject({ ...payload });
        createdProjects.push(payload.slug);
      } catch (error) {
        failures.push({
          target: `project:${payload.slug}`,
          reason: errorMessage(error),
        });
      }
    }
    this.logger.log(
      `사이트 프로젝트 발행 — 신규 ${createdProjects.length}건, 갱신 ${updatedProjects.length}건, 실패 ${failures.length}건`,
    );
    return { createdProjects, updatedProjects };
  }

  // 스킬 그룹에는 slug 가 없어서 제목으로 맞춘다(사이트에서도 제목이 그룹의 정체성이다).
  private async publishSkillGroups(
    payloads: PortfolioSiteSkillGroupPayload[],
    failures: PublishPortfolioSiteFailure[],
  ): Promise<{ createdSkillGroups: string[]; updatedSkillGroups: string[] }> {
    const createdSkillGroups: string[] = [];
    const updatedSkillGroups: string[] = [];
    if (payloads.length === 0) {
      return { createdSkillGroups, updatedSkillGroups };
    }

    const existing = await this.siteClient.listSkillGroups();
    const idByTitle = new Map<string, string>();
    for (const group of existing) {
      const title = group.data.title;
      if (typeof title === 'string') {
        idByTitle.set(title, group.id);
      }
    }

    for (const payload of payloads) {
      const existingId = idByTitle.get(payload.title);
      try {
        if (existingId) {
          await this.siteClient.updateSkillGroup(existingId, { ...payload });
          updatedSkillGroups.push(payload.title);
          continue;
        }
        await this.siteClient.createSkillGroup({ ...payload });
        createdSkillGroups.push(payload.title);
      } catch (error) {
        failures.push({
          target: `skill-group:${payload.title}`,
          reason: errorMessage(error),
        });
      }
    }
    return { createdSkillGroups, updatedSkillGroups };
  }
}

// 갱신 payload 에서는 사람이 편집기에서 정한 표시 상태를 빼고 보낸다.
//
// published 는 공개 여부, featured 는 대표작 지정이다. 둘 다 사람이 손으로 켜는 값인데
// 매일 도는 발행이 payload 기본값(false)을 실어 보내면 그 지정이 하루마다 풀린다.
// 사이트는 "필드가 있으면 덮는다"(content.service.ts 의 `"featured" in data`) 라서
// 값을 넣지 않는 것이 유일한 보존 방법이다.
const toUpdatePayload = (
  payload: PortfolioSiteProjectPayload,
): Record<string, unknown> => {
  const { published: _published, featured: _featured, ...updatable } = payload;
  void _published;
  void _featured;
  return updatable;
};
