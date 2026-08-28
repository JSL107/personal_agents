import 'reflect-metadata';

import { validateEnv } from './app.config';

const requiredEnv = {
  PORT: 3002,
  REDIS_HOST: 'localhost',
  REDIS_PORT: 6381,
  DATABASE_URL: 'postgresql://user:password@localhost:5434/database',
};

describe('validateEnv AI_CLI_ENV_SYNC_REPO', () => {
  it('빈 문자열은 graceful OFF 설정으로 허용한다', () => {
    expect(() =>
      validateEnv({ ...requiredEnv, AI_CLI_ENV_SYNC_REPO: '' }),
    ).not.toThrow();
  });

  it('비어 있지 않은 잘못된 repo 형식은 거부한다', () => {
    expect(() =>
      validateEnv({ ...requiredEnv, AI_CLI_ENV_SYNC_REPO: 'invalid-repo' }),
    ).toThrow();
  });
});

describe('validateEnv JOB_FEED_* 빈 문자열 — @Type(() => Number) 이 0 으로 바꾸는 것을 막는다', () => {
  // @IsOptional 은 null/undefined 만 건너뛴다. 빈 문자열은 @Type(() => Number) 가
  // plainToInstance 단계에서 먼저 Number('')=0 으로 바꿔버려, "미설정(중립)"과
  // "0"이 구분되지 않는다 — 연차 0년차 오채점, JOB_FEED_DETAIL_LIMIT 은 @Min(1)
  // 위반으로 앱 부팅 자체가 실패한다(실측 확인). @Transform 으로 빈 문자열을
  // undefined 로 되돌려야 한다.
  const numericJobFeedKeys = [
    'JOB_FEED_YEARS',
    'JOB_FEED_MATCH_THRESHOLD',
    'JOB_FEED_GAP_ANALYSIS_TOP_N',
    'JOB_FEED_DETAIL_LIMIT',
  ] as const;

  it.each(numericJobFeedKeys)(
    '%s 가 빈 문자열이면 0 이 아니라 undefined 로 정규화된다',
    (key) => {
      const validated = validateEnv({
        ...requiredEnv,
        [key]: '',
      }) as unknown as Record<string, unknown>;
      expect(validated[key]).toBeUndefined();
    },
  );

  it('넷 다 빈 문자열이어도 검증을 통과하며 부팅을 막지 않는다', () => {
    expect(() =>
      validateEnv({
        ...requiredEnv,
        JOB_FEED_YEARS: '',
        JOB_FEED_MATCH_THRESHOLD: '',
        JOB_FEED_GAP_ANALYSIS_TOP_N: '',
        JOB_FEED_DETAIL_LIMIT: '',
      }),
    ).not.toThrow();
  });

  it('실제 값이 오면 여전히 숫자로 변환된다 — Transform 이 정상 값까지 지우면 안 된다', () => {
    const validated = validateEnv({
      ...requiredEnv,
      JOB_FEED_YEARS: '5',
    });
    expect(validated.JOB_FEED_YEARS).toBe(5);
  });
});
