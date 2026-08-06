/* Autopilot cron 관련 env 값이 실제로 어떤 값으로 도달하는지 확인한다.
 *
 * `.env` 를 손으로 파싱하지 않는다 — dotenv 는 inline comment 제거, `export` 접두사 제거,
 * 따옴표 안 `#` 보존, multiline quoted value 를 처리하는데, 그 규칙을 흉내내면 어긋난 만큼이
 * 그대로 오진이 된다. Node 22 내장 `--env-file` 이 같은 규칙으로 읽어 주므로 그 결과만 읽는다.
 * `--env-file` 도 dotenv 도 **이미 있는 process.env 를 덮지 않는다** — ConfigService 와 같은
 * 우선순위라, 아래 두 실행의 차이가 곧 "shell export 가 .env 를 덮고 있는가" 의 답이다.
 *
 * 사용:
 *   # 1) .env 가 반영된 값 (= ConfigService 가 보는 값)
 *   node --env-file=.env -r ts-node/register/transpile-only scripts/check-env-cron.ts
 *
 *   # 2) shell 환경만 (.env 미적용)
 *   pnpm exec ts-node scripts/check-env-cron.ts
 *
 * 2) 에서 값이 보이면 그 키는 shell 에 export 돼 있다는 뜻이고, `.env` 를 고쳐도 반영되지 않는다.
 */

// Autopilot 스케줄러가 읽는 키는 전부 이 접두사다 — 고정 2개(`AUTOPILOT_OWNER_SLACK_USER_ID`,
// `AUTOPILOT_TARGET`) 와 그룹별 `AUTOPILOT_<그룹 첫 항목 ID>_SCHEDULE` / `_TIMEZONE`
// (`autopilot.scheduler.ts` 의 `AUTOPILOT_${envKey}_${suffix}`).
// 키를 손으로 나열하면 플레이북이 바뀔 때마다 어긋나므로 접두사로 훑는다.
const PREFIX = 'AUTOPILOT_';

const main = (): void => {
  const keys = Object.keys(process.env)
    .filter((key) => key.startsWith(PREFIX))
    .sort();

  if (keys.length === 0) {
    console.log(
      `${PREFIX}* 키가 하나도 없다. --env-file=.env 없이 실행했다면 정상이다(= shell 오염 없음).`,
    );
    return;
  }

  console.log(`=== ${PREFIX}* (${keys.length}개) ===\n`);
  for (const key of keys) {
    const value = process.env[key] ?? '';
    if (value.length === 0) {
      console.log(`  ${key} = "" (빈 값)`);
    } else if (value !== value.trim()) {
      console.log(
        `  ${key} = "${value}" ⚠️ 앞뒤 공백 있음 (trimmed="${value.trim()}")`,
      );
    } else {
      console.log(`  ${key} = "${value}"`);
    }
  }
};

main();
