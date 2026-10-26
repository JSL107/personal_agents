import { classifyRiskFileRole } from './risk-file-role';
import { RiskFileRole } from './risk-map.type';

describe('classifyRiskFileRole', () => {
  it.each([
    ['src/user/user.service.ts', RiskFileRole.CODE],
    ['src/user/user.service.spec.ts', RiskFileRole.TEST],
    ['tests/Unit/SurveyTest.php', RiskFileRole.TEST],
    ['app/Models/Survey.php', RiskFileRole.CODE],
    ['src/app/home/home.component.html', RiskFileRole.VIEW],
    ['prisma/schema.prisma', RiskFileRole.SCHEMA],
    ['database/migrations/2026_01_01_create.php', RiskFileRole.SCHEMA],
    ['.env.example', RiskFileRole.ENV],
    ['pnpm-lock.yaml', RiskFileRole.LOCKFILE],
    ['package.json', RiskFileRole.MANIFEST],
    ['requirements.txt', RiskFileRole.MANIFEST],
    ['README.md', RiskFileRole.DOC],
    ['tsconfig.build.json', RiskFileRole.CONFIG],
    ['eslint.config.mjs', RiskFileRole.CONFIG],
    ['.github/workflows/ci.yml', RiskFileRole.INFRA],
    ['docker-compose.yml', RiskFileRole.INFRA],
    // 소스 코드는 deploy/ 폴더에 있어도 인프라가 아니다.
    ['deploy/run.ts', RiskFileRole.CODE],
    ['src/main.rs', RiskFileRole.CODE],
    ['Sources/App.swift', RiskFileRole.CODE],
    ['Sources/AppTests/MascotChatterTests.swift', RiskFileRole.TEST],
    ['src/main/java/a/UserServiceTest.java', RiskFileRole.TEST],
    // 문서·테스트가 스키마보다 먼저다.
    ['docs/migrations/plan.md', RiskFileRole.DOC],
    ['test/fixtures/seed.sql', RiskFileRole.TEST],
    ['assets/logo.png', RiskFileRole.OTHER],
  ])('%s → %s', (path, role) => {
    expect(classifyRiskFileRole(path)).toBe(role);
  });
});
