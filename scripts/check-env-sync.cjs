#!/usr/bin/env node
'use strict';

/**
 * check-env-sync — env 드리프트 게이트
 *
 * 단일 소스(SoT): `src/config/app.config.ts` 의 `EnvironmentVariables` class.
 * CLAUDE.md §2 #7 "새 env 추가 시 4곳 동기" 규칙 중 (.env.example ↔ app.config.ts)
 * 동기를 자동 강제한다. (README 동기는 v1 범위 외 — 후속 후보.)
 *
 * 규칙
 *   - ERROR: required(비-@IsOptional) 키가 `.env.example` 에 없음.
 *            → 필수 env 를 문서화하지 않은 채 추가한 경우.
 *   - ERROR: `.env.example` 의 active 키가 app.config 에 선언되지 않았고
 *            INFRA_ONLY_KEYS allowlist 에도 없음.
 *            → orphan/typo 또는 ConfigService 로만 읽고 validator 누락한 env.
 *   - WARN(비차단): optional 키가 `.env.example` 에 없음.
 *            → 문서화 권장 nudge. CI 를 깨뜨리지 않는다(v1). strict 승격은 후속.
 *
 * 실행: `pnpm check:env` (CI 및 로컬 공용). 의존성 없음(순수 node).
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_EXAMPLE_PATH = path.join(ROOT_DIR, '.env.example');
const APP_CONFIG_PATH = path.join(ROOT_DIR, 'src', 'config', 'app.config.ts');

// 앱(NestJS)이 ConfigService 로 읽지 않는, 인프라 전용(docker-compose) env.
// app.config.ts 에 선언되지 않는 것이 정상이다.
const INFRA_ONLY_KEYS = new Set(['POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD']);

function readLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
}

/** `.env.example` → { active: Set, commented: Set } */
function parseEnvExample(filePath) {
  const active = new Set();
  const commented = new Set();
  for (const raw of readLines(filePath)) {
    const line = raw.trim();
    const activeMatch = line.match(/^([A-Z][A-Z0-9_]*)=/u);
    if (activeMatch) {
      active.add(activeMatch[1]);
      continue;
    }
    const commentedMatch = line.match(/^#\s*([A-Z][A-Z0-9_]*)=/u);
    if (commentedMatch) {
      commented.add(commentedMatch[1]);
    }
  }
  return { active, commented };
}

/**
 * `app.config.ts` 의 EnvironmentVariables 속성 → { required: Set, optional: Set }
 * @IsOptional 데코레이터가 속성 직전 블록에 있으면 optional 로 분류한다.
 */
function parseAppConfig(filePath) {
  const required = new Set();
  const optional = new Set();
  let optionalFlag = false;
  for (const raw of readLines(filePath)) {
    const line = raw.trim();
    if (line.startsWith('@IsOptional')) {
      optionalFlag = true;
      continue;
    }
    const propertyMatch = raw.match(/^\s+([A-Z][A-Z0-9_]+)[?!]?\s*:/u);
    if (propertyMatch) {
      (optionalFlag ? optional : required).add(propertyMatch[1]);
      optionalFlag = false;
    }
  }
  return { required, optional };
}

function main() {
  for (const filePath of [ENV_EXAMPLE_PATH, APP_CONFIG_PATH]) {
    if (!fs.existsSync(filePath)) {
      console.error(`[check-env-sync] 파일을 찾을 수 없습니다: ${path.relative(ROOT_DIR, filePath)}`);
      process.exitCode = 1;
      return;
    }
  }

  const env = parseEnvExample(ENV_EXAMPLE_PATH);
  const config = parseAppConfig(APP_CONFIG_PATH);
  const documented = new Set([...env.active, ...env.commented]);

  const errors = [];
  const warnings = [];

  for (const key of config.required) {
    if (!documented.has(key)) {
      errors.push(`required env \`${key}\` 가 app.config.ts 에 있으나 .env.example 에 없습니다.`);
    }
  }

  for (const key of env.active) {
    if (!config.required.has(key) && !config.optional.has(key) && !INFRA_ONLY_KEYS.has(key)) {
      errors.push(
        `\`${key}\` 가 .env.example 에 있으나 app.config.ts 에 선언되지 않았습니다 ` +
          `(ConfigService 로 읽는다면 EnvironmentVariables 에 추가, 인프라 전용이면 INFRA_ONLY_KEYS 에 추가).`,
      );
    }
  }

  for (const key of config.optional) {
    if (!documented.has(key)) {
      warnings.push(key);
    }
  }

  if (warnings.length > 0) {
    console.warn(
      `[check-env-sync] WARN: optional env ${warnings.length}개가 .env.example 에 미문서화 ` +
        `(비차단 — 문서화 권장):\n  ${warnings.sort().join(', ')}`,
    );
  }

  if (errors.length > 0) {
    console.error('[check-env-sync] FAIL: env 드리프트 발견');
    for (const message of errors) {
      console.error(`  - ${message}`);
    }
    console.error(
      '\n수정: .env.example 과 src/config/app.config.ts 를 동기화하세요 (CLAUDE.md §2 #7).',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[check-env-sync] OK — required ${config.required.size}개 모두 문서화, ` +
      `orphan 0개. (optional 미문서화 ${warnings.length}개는 경고)`,
  );
}

if (require.main === module) {
  main();
}

module.exports = { parseEnvExample, parseAppConfig, INFRA_ONLY_KEYS };
