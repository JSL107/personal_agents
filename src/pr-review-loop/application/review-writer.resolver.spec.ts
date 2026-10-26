import { ConfigService } from '@nestjs/config';

import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { ReviewWriterResolver } from './review-writer.resolver';

const OWNER_CLIENT = { name: 'owner' } as unknown as GithubClientPort;
const BOT_CLIENT = { name: 'bot' } as unknown as GithubClientPort;

const BOT_ENV = {
  GITHUB_WEBHOOK_OWNER_LOGIN: 'JSL107',
  GITHUB_REVIEW_BOT_LOGIN: 'idaeri-bot',
  GITHUB_REVIEW_BOT_REPOS: 'JSL107/personal_agents, JSL107/blog',
};

const build = ({
  env,
  bot = BOT_CLIENT,
}: {
  env: Record<string, string | undefined>;
  bot?: GithubClientPort | null;
}): ReviewWriterResolver =>
  new ReviewWriterResolver(
    { get: (key: string) => env[key] } as unknown as ConfigService,
    OWNER_CLIENT,
    bot,
  );

describe('ReviewWriterResolver', () => {
  it('목록에 있는 레포는 봇 계정으로 쓴다', () => {
    const writer = build({ env: BOT_ENV }).forRepo('JSL107/blog');

    expect(writer).toEqual({ client: BOT_CLIENT, login: 'idaeri-bot' });
  });

  it('목록 밖 레포는 사용자 계정으로 쓴다', () => {
    const writer = build({ env: BOT_ENV }).forRepo('some-org/api');

    expect(writer).toEqual({ client: OWNER_CLIENT, login: 'JSL107' });
  });

  it.each([
    ['봇 토큰이 없으면', null, BOT_ENV],
    [
      '봇 로그인이 없으면',
      BOT_CLIENT,
      { ...BOT_ENV, GITHUB_REVIEW_BOT_LOGIN: '  ' },
    ],
    [
      '레포 목록이 비면',
      BOT_CLIENT,
      { ...BOT_ENV, GITHUB_REVIEW_BOT_REPOS: undefined },
    ],
  ])('%s 기존처럼 사용자 계정으로 쓴다', (_label, bot, env) => {
    const writer = build({ env, bot }).forRepo('JSL107/personal_agents');

    expect(writer.client).toBe(OWNER_CLIENT);
  });

  it('후보는 지금 쓰는 봇 계정이 앞, 전환 전 사용자 계정이 뒤다', () => {
    const writers = build({ env: BOT_ENV }).candidatesFor(
      'JSL107/personal_agents',
    );

    expect(writers.map((writer) => writer.login)).toEqual([
      'idaeri-bot',
      'JSL107',
    ]);
  });

  it('봇을 쓰지 않는 레포의 후보는 사용자 계정 하나다', () => {
    const writers = build({ env: BOT_ENV }).candidatesFor('some-org/api');

    expect(writers).toEqual([{ client: OWNER_CLIENT, login: 'JSL107' }]);
  });
});
