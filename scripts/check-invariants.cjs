'use strict';
// 이대리 불변식 게이트 — lint/test/build/GitGuardian이 못 잡는 프로젝트 불변식을 CI에서 강제한다.
// 위반이 하나라도 있으면 exit 1. 신규 자율 플래그는 AUTO_FLAGS에 등록할 것.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const AUTO_FLAGS = [
  'SESSION_DISPATCH_ENABLED',
  'GITHUB_ISSUE_AUTO_LABEL_ENABLED',
  'PR_CAREERLOG_AUTO_ENABLED',
];

function checkNoTypeorm(files, pkgJson) {
  const violations = [];
  const deps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };
  for (const name of Object.keys(deps)) {
    if (name === 'typeorm' || name === '@nestjs/typeorm') {
      violations.push(`package.json 의존성에 ${name} 금지 (ORM은 Prisma만).`);
    }
  }
  for (const file of files) {
    if (/from\s+['"]@?typeorm|from\s+['"]@nestjs\/typeorm/.test(file.content)) {
      violations.push(`${file.path}: typeorm import 금지 (ORM은 Prisma만).`);
    }
  }
  return violations;
}

// unsafe raw 호출의 인자 영역을 파싱해 injection 신호(템플릿 보간 ${} / 문자열 결합 +)를 판별한다.
// 문자열 리터럴 내부의 괄호·+ 는 무시하고, 템플릿 안의 ${ 는 보간으로 잡는다.
// openParenIdx 는 '(' 의 위치. 균형이 안 맞으면 null.
function analyzeCallArg(content, openParenIdx) {
  let depth = 0;
  let hasInterpolation = false;
  let masked = ''; // 문자열 리터럴을 ''로 치환한 코드 뷰 — 결합(+) 판별용.
  let i = openParenIdx;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < content.length) {
        const c = content[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (quote === '`' && c === '$' && content[i + 1] === '{') {
          hasInterpolation = true;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      masked += "''";
      continue;
    }
    if (ch === '(') {
      depth += 1;
      if (depth > 1) {
        masked += ch;
      }
      i += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return { hasInterpolation, hasConcat: /\+/.test(masked) };
      }
      masked += ch;
      i += 1;
      continue;
    }
    masked += ch;
    i += 1;
  }
  return null;
}

// unsafe raw 자체는 금지가 아니다 — 변수 보간/문자열 결합이 있는 호출만 injection 위험으로 막는다.
// 상수 문자열 인자(예: CREATE INDEX CONCURRENTLY DDL)는 허용. 동적 값은 Prisma.sql 태그로 parameterize할 것.
function checkNoUnsafeRawSql(files) {
  const violations = [];
  const methods = ['queryRawUnsafe', 'executeRawUnsafe'];
  for (const file of files) {
    for (const method of methods) {
      const token = `$${method}(`;
      let idx = file.content.indexOf(token);
      while (idx !== -1) {
        const parenIdx = idx + token.length - 1;
        const analysis = analyzeCallArg(file.content, parenIdx);
        if (analysis && (analysis.hasInterpolation || analysis.hasConcat)) {
          violations.push(
            `${file.path}: $${method} 에 변수 보간(\${})/문자열 결합(+) 금지 (SQL injection 위험). 동적 값은 Prisma.sql 태그로 parameterize할 것. 상수 문자열은 허용.`,
          );
        }
        idx = file.content.indexOf(token, idx + token.length);
      }
    }
  }
  return violations;
}

function checkNoCommittedEnv(trackedPaths) {
  const violations = [];
  for (const tracked of trackedPaths) {
    const base = tracked.split('/').pop();
    if (base === '.env' || (base.startsWith('.env.') && !base.endsWith('.example'))) {
      violations.push(`${tracked}: 실제 .env 커밋 금지 (.example만 허용).`);
    }
  }
  return violations;
}

function checkAutoFlagsDefaultOff(envExample, appConfigSource) {
  const violations = [];
  for (const flag of AUTO_FLAGS) {
    const match = new RegExp(`^${flag}=(.*)$`, 'm').exec(envExample);
    if (match) {
      const value = match[1].trim().toLowerCase();
      if (value === 'true' || value === '1') {
        violations.push(`.env.example의 ${flag}는 비어있거나 false여야 함 (자율 기능은 OFF로 출하).`);
      }
    }
    if (new RegExp(`['"]${flag}['"]\\s*\\)?\\s*[=?]{2,}?\\s*['"]true['"]`).test(appConfigSource)) {
      violations.push(`app.config의 ${flag}에 'true' 하드 기본값 금지.`);
    }
  }
  return violations;
}

function readSrcFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        files.push({ path: path.relative(root, full), content: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(path.join(root, 'src'));
  return files;
}

function runAllChecks(root) {
  const files = readSrcFiles(root);
  const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.trim().length > 0);
  const envExamplePath = path.join(root, '.env.example');
  const envExample = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, 'utf8') : '';
  const appConfigPath = path.join(root, 'src/config/app.config.ts');
  const appConfig = fs.existsSync(appConfigPath) ? fs.readFileSync(appConfigPath, 'utf8') : '';
  return [
    ...checkNoTypeorm(files, pkgJson),
    ...checkNoUnsafeRawSql(files),
    ...checkNoCommittedEnv(tracked),
    ...checkAutoFlagsDefaultOff(envExample, appConfig),
  ];
}

module.exports = {
  AUTO_FLAGS,
  checkNoTypeorm,
  checkNoUnsafeRawSql,
  checkNoCommittedEnv,
  checkAutoFlagsDefaultOff,
  runAllChecks,
};

if (require.main === module) {
  const violations = runAllChecks(path.resolve(__dirname, '..'));
  if (violations.length > 0) {
    console.error('불변식 위반:');
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }
  console.log('불변식 게이트 통과.');
}
