/* .env 의 cron 관련 라인이 ConfigService (= @nestjs/config 의 dotenv 기반) 가 보는 값과 동일한지 검증.
 *
 * 사용:
 *   pnpm exec ts-node scripts/check-env-cron.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const KEYS = [
  'MORNING_BRIEFING_OWNER_SLACK_USER_ID',
  'MORNING_BRIEFING_CRON',
  'MORNING_BRIEFING_TIMEZONE',
  'MORNING_BRIEFING_DELIVERY_TARGETS',
  'DAILY_EVAL_OWNER_SLACK_USER_ID',
  'DAILY_EVAL_CRON',
  'CEO_META_CRON_OWNER_SLACK_USER_ID',
  'CEO_META_CRON_CRON',
  'IMPACT_REPORT_RECENT_OWNER_SLACK_USER_ID',
  'IMPACT_REPORT_RECENT_CRON',
];

const main = (): void => {
  const envPath = path.join(__dirname, '..', '.env');
  const raw = fs.readFileSync(envPath, 'utf-8');
  // dotenv 의 parser 와 동일 규칙 — `KEY=value` + 따옴표 strip + comment ignore + multiline 미지원.
  const parsed: Record<string, string> = {};
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trimStart();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }

  console.log(`=== .env (${envPath}) parsed values ===\n`);
  for (const key of KEYS) {
    const value = parsed[key];
    if (value === undefined) {
      console.log(`  ${key} = (미설정)`);
    } else if (value.length === 0) {
      console.log(`  ${key} = "" (빈 값)`);
    } else {
      console.log(
        `  ${key} = "${value}" (length=${value.length}, trimmed length=${value.trim().length})`,
      );
    }
  }

  console.log(
    `\n=== process.env 의 동일 키 (shell export / 다른 source) ===\n`,
  );
  for (const key of KEYS) {
    const value = process.env[key];
    if (value === undefined) {
      console.log(`  ${key} = (미설정)`);
    } else {
      console.log(`  ${key} = "${value}"`);
    }
  }
};

main();
