export const PORTFOLIO_SITE_CLIENT_PORT = Symbol('PORTFOLIO_SITE_CLIENT_PORT');

// 사이트가 돌려주는 프로젝트 1건. data 는 사이트가 자유 jsonb 로 보관하는 본문이라
// 여기서 형태를 좁히지 않는다 (사이트 스키마가 늘어도 이대리를 고치지 않게).
export interface PortfolioSiteProject {
  id: string;
  slug: string;
  published: boolean;
  data: Record<string, unknown>;
}

export interface PortfolioSiteSkillGroup {
  id: string;
  sortOrder: number;
  data: Record<string, unknown>;
}

// Portfolio OS (`/me/*`) 쓰기 어댑터. 자동화 토큰 헤더로 인증한다.
// 공개 읽기(`/public/portfolios/:handle`)는 발행 결과를 되짚어 보는 검증용이라 별도 메서드.
export interface PortfolioSiteClientPort {
  listProjects(): Promise<PortfolioSiteProject[]>;
  createProject(data: Record<string, unknown>): Promise<PortfolioSiteProject>;
  updateProject(
    id: string,
    data: Record<string, unknown>,
  ): Promise<PortfolioSiteProject>;
  listSkillGroups(): Promise<PortfolioSiteSkillGroup[]>;
  createSkillGroup(
    data: Record<string, unknown>,
  ): Promise<PortfolioSiteSkillGroup>;
  updateSkillGroup(
    id: string,
    data: Record<string, unknown>,
  ): Promise<PortfolioSiteSkillGroup>;
  // 공개 페이지에 실제로 올라갔는지 되짚어 본다. handle 미설정이면 null (검증 불가와 실패를 구분).
  findPublicProjectSlugs(): Promise<string[] | null>;
}
