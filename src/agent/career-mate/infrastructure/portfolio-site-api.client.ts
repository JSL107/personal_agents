import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { CareerMateException } from '../domain/career-mate.exception';
import { CareerMateErrorCode } from '../domain/career-mate-error-code.enum';
import {
  PortfolioSiteClientPort,
  PortfolioSiteProject,
  PortfolioSiteSkillGroup,
} from '../domain/port/portfolio-site.client.port';

// 사이트 API 는 Render 무료 플랜이라 잠들었을 때 첫 요청이 18.4초 걸린다(2026-08-18 실측).
// 60초면 콜드스타트를 자르지 않고, worker lockDuration(690s+)에도 한참 못 미친다.
const REQUEST_TIMEOUT_MS = 60_000;

// 사람 세션(쿠키) 대신 쓰는 자동화 헤더. 사이트 쪽 JwtAuthGuard 와 이름이 맞아야 한다.
const AUTOMATION_TOKEN_HEADER = 'x-automation-token';

interface ProjectListResponse {
  projects?: unknown;
}

interface SkillGroupListResponse {
  skillGroups?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toProject = (value: unknown): PortfolioSiteProject | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { id, slug, published, data } = value;
  if (typeof id !== 'string' || typeof slug !== 'string') {
    return null;
  }
  return {
    id,
    slug,
    published: Boolean(published),
    data: isRecord(data) ? data : {},
  };
};

const toSkillGroup = (value: unknown): PortfolioSiteSkillGroup | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { id, sortOrder, data } = value;
  if (typeof id !== 'string') {
    return null;
  }
  return {
    id,
    sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
    data: isRecord(data) ? data : {},
  };
};

@Injectable()
export class PortfolioSiteApiClient implements PortfolioSiteClientPort {
  private readonly logger = new Logger(PortfolioSiteApiClient.name);

  constructor(private readonly configService: ConfigService) {}

  async listProjects(): Promise<PortfolioSiteProject[]> {
    const body = (await this.request(
      'GET',
      '/me/projects',
    )) as ProjectListResponse | null;
    const raw = Array.isArray(body?.projects) ? body.projects : [];
    return raw
      .map(toProject)
      .filter((project): project is PortfolioSiteProject => project !== null);
  }

  async createProject(
    data: Record<string, unknown>,
  ): Promise<PortfolioSiteProject> {
    return this.requireProject(
      await this.request('POST', '/me/projects', data),
    );
  }

  async updateProject(
    id: string,
    data: Record<string, unknown>,
  ): Promise<PortfolioSiteProject> {
    return this.requireProject(
      await this.request('PATCH', `/me/projects/${id}`, data),
    );
  }

  async listSkillGroups(): Promise<PortfolioSiteSkillGroup[]> {
    const body = (await this.request(
      'GET',
      '/me/skill-groups',
    )) as SkillGroupListResponse | null;
    const raw = Array.isArray(body?.skillGroups) ? body.skillGroups : [];
    return raw
      .map(toSkillGroup)
      .filter((group): group is PortfolioSiteSkillGroup => group !== null);
  }

  async createSkillGroup(
    data: Record<string, unknown>,
  ): Promise<PortfolioSiteSkillGroup> {
    return this.requireSkillGroup(
      await this.request('POST', '/me/skill-groups', data),
    );
  }

  async updateSkillGroup(
    id: string,
    data: Record<string, unknown>,
  ): Promise<PortfolioSiteSkillGroup> {
    return this.requireSkillGroup(
      await this.request('PATCH', `/me/skill-groups/${id}`, data),
    );
  }

  async findPublicProjectSlugs(): Promise<string[] | null> {
    const handle = this.configService
      .get<string>('PORTFOLIO_SITE_HANDLE')
      ?.trim();
    if (!handle) {
      // handle 미설정 = 되짚어 볼 주소를 모른다. "검증 실패" 와 구분하려고 null 을 돌린다.
      return null;
    }
    const body = await this.request(
      'GET',
      `/public/portfolios/${encodeURIComponent(handle)}`,
      undefined,
      { authenticated: false },
    );
    if (!isRecord(body) || !Array.isArray(body.projects)) {
      return [];
    }
    return body.projects
      .map((project) =>
        isRecord(project) && typeof project.slug === 'string'
          ? project.slug
          : null,
      )
      .filter((slug): slug is string => slug !== null);
  }

  private requireProject(body: unknown): PortfolioSiteProject {
    const project = toProject(body);
    if (!project) {
      throw new CareerMateException({
        code: CareerMateErrorCode.CONFIG_MISSING,
        message: `사이트 프로젝트 응답 형식이 예상과 다릅니다: ${JSON.stringify(body)?.slice(0, 200)}`,
        status: DomainStatus.INTERNAL,
      });
    }
    return project;
  }

  private requireSkillGroup(body: unknown): PortfolioSiteSkillGroup {
    const group = toSkillGroup(body);
    if (!group) {
      throw new CareerMateException({
        code: CareerMateErrorCode.CONFIG_MISSING,
        message: `사이트 스킬 그룹 응답 형식이 예상과 다릅니다: ${JSON.stringify(body)?.slice(0, 200)}`,
        status: DomainStatus.INTERNAL,
      });
    }
    return group;
  }

  // 사이트의 모든 API 는 Vercel 의 `/backend/*` rewrite 를 통해 도달한다. 그래서 이대리가
  // 아는 주소는 사이트 주소 하나뿐이고, 실제 API 서버(Render) 주소는 알 필요가 없다.
  private async request(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: Record<string, unknown>,
    options?: { authenticated?: boolean },
  ): Promise<unknown> {
    const siteUrl = this.requireConfig('PORTFOLIO_SITE_URL').replace(
      /\/+$/,
      '',
    );
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options?.authenticated !== false) {
      headers[AUTOMATION_TOKEN_HEADER] = this.requireConfig(
        'PORTFOLIO_AUTOMATION_TOKEN',
      );
    }
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${siteUrl}/backend${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new CareerMateException({
        code: CareerMateErrorCode.CONFIG_MISSING,
        message: `사이트 API ${method} ${path} 실패 — HTTP ${response.status} ${detail.slice(0, 200)}`,
        status: DomainStatus.INTERNAL,
      });
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  private requireConfig(key: string): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      this.logger.warn(`${key} 미설정 — 사이트 발행을 진행할 수 없습니다.`);
      throw new CareerMateException({
        code: CareerMateErrorCode.CONFIG_MISSING,
        message: `${key} 가 설정되지 않았습니다 (.env 확인).`,
        status: DomainStatus.INTERNAL,
      });
    }
    return value;
  }
}
