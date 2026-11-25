/**
 * 주간 점검이 회사 작업을 가르는 기준. 공개 저장소라 조직명·경로 키워드를 코드에 두지 않고
 * `COMPANY_GITHUB_ORG`·`COMPANY_PATH_KEYWORDS` 로 받는다. 조직명이 없으면 회사로 가르지 않는다 —
 * 머지 PR 은 전부 개인으로, 세션은 remote 기준 개인으로 센다(보고서에는 회사 0건 경고가 뜬다).
 */
export interface AiWeeklyCompanyScope {
  org: string | null;
  pathKeywords: string[];
}

interface AiWeeklyCompanyScopeInput {
  orgRaw: string | undefined;
  pathKeywordsRaw: string | undefined;
}

export const parseAiWeeklyCompanyScope = ({
  orgRaw,
  pathKeywordsRaw,
}: AiWeeklyCompanyScopeInput): AiWeeklyCompanyScope => ({
  org: orgRaw?.trim() || null,
  pathKeywords: (pathKeywordsRaw ?? '')
    .split(',')
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0),
});

interface CompanyRepoQuery {
  repo: string;
  scope: AiWeeklyCompanyScope;
}

export const isCompanyRepo = ({ repo, scope }: CompanyRepoQuery): boolean =>
  scope.org !== null &&
  repo.split('/')[0].toLowerCase() === scope.org.toLowerCase();
