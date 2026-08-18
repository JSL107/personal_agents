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
    // 형식이 어긋나면 빈 목록으로 삼키지 않고 끊는다 — 비정상 200 이나 계약 변경을 "기존 항목
    // 없음" 으로 오판하면 이미 있는 항목을 다시 만들려 든다. 프로젝트는 유니크 제약에 걸려
    // 실패로 드러나지만, 스킬 그룹에는 그 제약이 없어 중복 그룹이 조용히 쌓인다.
    if (!Array.isArray(body?.projects)) {
      throw this.contractViolation('GET /me/projects', 'projects 배열', body);
    }
    return body.projects
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
    if (!Array.isArray(body?.skillGroups)) {
      throw this.contractViolation(
        'GET /me/skill-groups',
        'skillGroups 배열',
        body,
      );
    }
    return body.skillGroups
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

  private requireProject(body: unknown): PortfolioSiteProject {
    const project = toProject(body);
    if (!project) {
      throw this.contractViolation('프로젝트 응답', 'id·slug', body);
    }
    return project;
  }

  private requireSkillGroup(body: unknown): PortfolioSiteSkillGroup {
    const group = toSkillGroup(body);
    if (!group) {
      throw this.contractViolation('스킬 그룹 응답', 'id', body);
    }
    return group;
  }

  // 사이트 응답이 계약과 어긋난 경우 — 조용히 기본값으로 흘리지 않고 호출자에게 끊어 올린다.
  private contractViolation(
    operation: string,
    expected: string,
    body: unknown,
  ): CareerMateException {
    return new CareerMateException({
      code: CareerMateErrorCode.CONFIG_MISSING,
      message: `사이트 ${operation} 형식이 예상과 다릅니다(${expected} 없음): ${JSON.stringify(body)?.slice(0, 200)}`,
      status: DomainStatus.INTERNAL,
    });
  }

  // 사이트의 모든 API 는 Vercel 의 `/backend/*` rewrite 를 통해 도달한다. 그래서 이대리가
  // 아는 주소는 사이트 주소 하나뿐이고, 실제 API 서버(Render) 주소는 알 필요가 없다.
  private async request(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const siteUrl = this.requireConfig('PORTFOLIO_SITE_URL').replace(
      /\/+$/,
      '',
    );
    const headers: Record<string, string> = {
      Accept: 'application/json',
      [AUTOMATION_TOKEN_HEADER]: this.requireConfig(
        'PORTFOLIO_AUTOMATION_TOKEN',
      ),
    };
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
