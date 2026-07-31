// eslint-disable-next-line @typescript-eslint/no-require-imports
const checks = require('../../scripts/check-invariants.cjs');

describe('check-invariants 순수 함수', () => {
  it('TypeORM import를 위반으로 잡는다', () => {
    const violations = checks.checkNoTypeorm(
      [
        {
          path: 'src/a.ts',
          content: ["import { Repo } from 'type", "orm';"].join(''),
        },
      ],
      { dependencies: {}, devDependencies: {} },
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  it('package.json의 typeorm 의존성을 위반으로 잡는다', () => {
    const violations = checks.checkNoTypeorm([], {
      dependencies: { ['type' + 'orm']: '^0.3.0' },
      devDependencies: {},
    });
    expect(violations.length).toBeGreaterThan(0);
  });

  it('깨끗하면 빈 배열', () => {
    const violations = checks.checkNoTypeorm(
      [
        {
          path: 'src/a.ts',
          content: "import { PrismaClient } from '@prisma/client';",
        },
      ],
      { dependencies: { '@prisma/client': '^6' }, devDependencies: {} },
    );
    expect(violations).toEqual([]);
  });

  it('unsafe raw에 변수 보간(${})이 있으면 위반으로 잡는다', () => {
    const violations = checks.checkNoUnsafeRawSql([
      {
        path: 'src/x.ts',
        content: [
          'prisma.$query',
          'RawUnsafe(`SELECT * FROM t WHERE id = ${',
          'userId}`)',
        ].join(''),
      },
    ]);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('unsafe raw에 문자열 결합(+)이 있으면 위반으로 잡는다', () => {
    const violations = checks.checkNoUnsafeRawSql([
      {
        path: 'src/x.ts',
        content: ['prisma.$execute', "RawUnsafe('SELECT ' + userId)"].join(''),
      },
    ]);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('unsafe raw의 상수 문자열 인자는 허용한다 (CONCURRENTLY DDL 등)', () => {
    const violations = checks.checkNoUnsafeRawSql([
      {
        path: 'src/x.ts',
        content: [
          'prisma.$execute',
          'RawUnsafe(`CREATE INDEX IF NOT EXISTS idx ON t USING gin (c)`)',
        ].join(''),
      },
    ]);
    expect(violations).toEqual([]);
  });

  it('추적된 .env(실파일)를 위반으로 잡고 .env.example은 허용', () => {
    expect(
      checks.checkNoCommittedEnv(['.env', 'src/a.ts']).length,
    ).toBeGreaterThan(0);
    expect(checks.checkNoCommittedEnv(['.env.example', 'src/a.ts'])).toEqual(
      [],
    );
  });

  it('자율 플래그가 example에서 true면 위반', () => {
    const violations = checks.checkAutoFlagsDefaultOff(
      'SESSION_DISPATCH_ENABLED=true\n',
      "config.get('SESSION_DISPATCH_ENABLED')",
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  it('자율 플래그가 example에서 비어있으면 통과', () => {
    const violations = checks.checkAutoFlagsDefaultOff(
      'SESSION_DISPATCH_ENABLED=\n',
      '',
    );
    expect(violations).toEqual([]);
  });
});
