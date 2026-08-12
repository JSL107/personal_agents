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
