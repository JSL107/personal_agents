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
//
// 발행 결과 검증도 이 인증 경로(listProjects)로 한다. 공개 페이지(`/public/portfolios/:handle`)로는
// 검증할 수 없다 — 발행물이 `published: false` 라 공개 응답에 원래 나오지 않으므로, 거기서
// "안 보인다"는 결과는 성공과 실패를 구분하지 못한다.
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
}
