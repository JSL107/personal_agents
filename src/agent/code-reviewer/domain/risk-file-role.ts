import { isCompanionTestPath } from './companion-spec';
import { RiskFileRole } from './risk-map.type';

// 짝 테스트를 못 보는 언어도 코드로 센다 — 분류 밖이면 큰 변경도 아무 표시 없이 0점이 된다.
const CODE_EXTENSION =
  /\.(?:[cm]?[jt]sx?|php|py|go|java|kt|kts|rb|vue|svelte|graphql|gql|rs|cs|swift|c|cc|cpp|cxx|h|hpp|m|mm|scala|dart|sh|bash|lua|pl|ex|exs|erl|clj|fs)$/;
const VIEW_EXTENSION = /\.(?:html|scss|sass|css|less)$/;
// 짝 테스트 판정(companion-spec)이 지원하는 언어.
const PAIRABLE_SOURCE = /(?:\.[cm]?[jt]sx?|\.php)$/;
// 원래 테스트를 두지 않는 선언 파일. ponytail: 이름 휴리스틱이라 다른 이름 규칙의 레포는 빠진다(Farol 은 AST 로 본다).
const DECLARATION_FILE =
  /\.d\.[cm]?ts$|\.(?:types?|enum|dto|module|port|exception|constants?|interface|token)\.[cm]?tsx?$|(?:^|\/)index\.[cm]?[jt]sx?$/;

const LOCKFILE =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|composer\.lock|go\.sum|poetry\.lock|Pipfile\.lock|uv\.lock)$/;
const MANIFEST =
  /(?:^|\/)(?:package\.json|composer\.json|go\.mod|pyproject\.toml|Pipfile|requirements[^/]*\.txt)$/;
// 뒤 두 갈래는 XCTest·JUnit·xUnit 관례(`FooTests.swift`, `FooTest.java`, `AppTests/`).
const TEST =
  /(?:^|\/)(?:__tests__|tests?|e2e)\/|\.(?:spec|test)\.[^/]+$|_test\.(?:go|py)$|(?:^|\/)(?:test_[^/]+\.py|conftest\.py)$|[A-Za-z0-9]Tests?\.(?:swift|kt|kts|java|cs|scala)$|(?:^|\/)[A-Za-z0-9]+Tests\//;
const DOC = /\.(?:md|mdx|rst|adoc|txt)$|^docs\//i;
const SCHEMA = /(?:^|\/)schema\.prisma$|(?:^|\/)migrations?\/|\.sql$/i;
const ENV = /(?:^|\/)\.env(?:\.[^/]+)?$/;
const CONFIG =
  /(?:^|\/)(?:tsconfig[^/]*\.json|angular\.json|nest-cli\.json|nx\.json|project\.json|eslint\.config\.[^/]+|\.eslintrc[^/]*|jest\.config\.[^/]+|vite\.config\.[^/]+|webpack\.config\.[^/]+)$/;
const INFRA =
  /^\.github\/workflows\/|(?:^|\/)Dockerfile[^/]*$|(?:^|\/)docker-compose[^/]*\.ya?ml$|(?:^|\/)(?:k8s|kubernetes|helm|charts|deploy|deployment|infra|infrastructure|terraform)\/|\.tf$|(?:^|\/)(?:Jenkinsfile|Procfile)$/;

interface RoleRule {
  role: RiskFileRole;
  matches: (path: string) => boolean;
}

// 위에서부터 처음 맞는 규칙이 이긴다. 문서·테스트가 스키마보다 앞이라 `docs/migrations/plan.md` 가
// 스키마로 잡히지 않고, manifest 가 문서보다 앞이라 `requirements.txt` 가 문서로 빠지지 않는다.
const ROLE_RULES: RoleRule[] = [
  { role: RiskFileRole.TEST, matches: (path) => isCompanionTestPath(path) },
  { role: RiskFileRole.LOCKFILE, matches: (path) => LOCKFILE.test(path) },
  { role: RiskFileRole.MANIFEST, matches: (path) => MANIFEST.test(path) },
  { role: RiskFileRole.TEST, matches: (path) => TEST.test(path) },
  { role: RiskFileRole.DOC, matches: (path) => DOC.test(path) },
  { role: RiskFileRole.SCHEMA, matches: (path) => SCHEMA.test(path) },
  { role: RiskFileRole.ENV, matches: (path) => ENV.test(path) },
  { role: RiskFileRole.CONFIG, matches: (path) => CONFIG.test(path) },
  // 소스 코드는 어느 폴더에 있든 인프라가 아니다(Farol roles.ts 와 같은 규칙).
  {
    role: RiskFileRole.INFRA,
    matches: (path) => INFRA.test(path) && !CODE_EXTENSION.test(path),
  },
  { role: RiskFileRole.CODE, matches: (path) => CODE_EXTENSION.test(path) },
  { role: RiskFileRole.VIEW, matches: (path) => VIEW_EXTENSION.test(path) },
];

export const classifyRiskFileRole = (path: string): RiskFileRole =>
  ROLE_RULES.find((rule) => rule.matches(path))?.role ?? RiskFileRole.OTHER;

export const isPairableSource = (path: string): boolean =>
  PAIRABLE_SOURCE.test(path);

export const isDeclarationFile = (path: string): boolean =>
  DECLARATION_FILE.test(path);
