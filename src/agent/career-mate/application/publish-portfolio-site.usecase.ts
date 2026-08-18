import { Inject, Injectable, Logger } from '@nestjs/common';

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
  // 공개 페이지 재조회 결과. handle 미설정이면 null (검증 불가 ≠ 검증 실패).
  publicSlugsAfter: string[] | null;
  agentRunId: number;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
  ) {}

  async execute({
    slackUserId,
  }: PublishPortfolioSiteInput): Promise<PublishPortfolioSiteResult> {
    const { profile, agentRunId } = await this.resolveProfile(slackUserId);
    const payload = buildPortfolioSitePayload(profile);
    const failures: PublishPortfolioSiteFailure[] = [];

    const projects = await this.publishProjects(payload.projects, failures);
    const skillGroups = await this.publishSkillGroups(
      payload.skillGroups,
      failures,
    );

    // 실제로 사이트에 남았는지 되짚어 본다 — 쓰기 응답만 믿으면 사이트 스키마가 바뀐 날
    // "성공했다"는 보고와 빈 화면이 함께 남는다.
    const publicSlugsAfter = await this.siteClient
      .findPublicProjectSlugs()
      .catch((error: unknown) => {
        failures.push({
          target: 'public-verify',
          reason: errorMessage(error),
        });
        return null;
      });

    return {
      ...projects,
      ...skillGroups,
      skippedTitles: payload.skippedTitles,
      failures,
      publicSlugsAfter,
      agentRunId,
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
          // 사람이 편집기에서 이미 게시한 항목을 다시 비공개로 되돌리지 않는다 —
          // published 는 갱신 대상에서 뺀다.
          const { published: _published, ...updatable } = payload;
          void _published;
          await this.siteClient.updateProject(existingId, updatable);
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
