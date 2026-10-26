import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  GITHUB_CLIENT_PORT,
  GITHUB_REVIEW_BOT_CLIENT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import { isRepoAllowed } from '../domain/publish-policy';

export interface ReviewWriter {
  client: GithubClientPort;
  // 이 계정의 GitHub login. 모르면 undefined — 작성자 비교 없이 표식만으로 자기 코멘트를 찾는다.
  login: string | undefined;
}

// PR 에 쓰는 계정을 레포별로 고른다. 봇 토큰·로그인이 있고 GITHUB_REVIEW_BOT_REPOS 에 적힌 레포만
// 봇 계정으로 쓰고, 나머지는 기존 사용자 계정으로 쓴다(봇이 초대되지 않은 레포는 404 로 거절된다).
// 공개 레포는 초대 없이도 코멘트가 달리므로 실패 여부로 접근 권한을 추정하지 않고 목록으로 정한다.
@Injectable()
export class ReviewWriterResolver {
  constructor(
    private readonly configService: ConfigService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly ownerClient: GithubClientPort,
    @Inject(GITHUB_REVIEW_BOT_CLIENT)
    private readonly botClient: GithubClientPort | null,
  ) {}

  forRepo(repo: string): ReviewWriter {
    return this.botFor(repo) ?? this.owner();
  }

  // 지금 쓰는 계정이 앞, 봇 전환 전에 사용자 계정이 단 코멘트를 찾기 위한 사용자 계정이 뒤.
  candidatesFor(repo: string): ReviewWriter[] {
    const bot = this.botFor(repo);
    return bot === null ? [this.owner()] : [bot, this.owner()];
  }

  private botFor(repo: string): ReviewWriter | null {
    const login = this.configService
      .get<string>('GITHUB_REVIEW_BOT_LOGIN')
      ?.trim();
    const repos = this.configService.get<string>('GITHUB_REVIEW_BOT_REPOS');
    // 로그인을 모르는 봇은 쓰지 않는다 — 표식만으로 찾으면 사용자 계정이 단 코멘트를 봇이 고치려 든다.
    if (this.botClient === null || !login || !isRepoAllowed(repo, repos)) {
      return null;
    }
    return { client: this.botClient, login };
  }

  private owner(): ReviewWriter {
    return {
      client: this.ownerClient,
      login: this.configService.get<string>('GITHUB_WEBHOOK_OWNER_LOGIN'),
    };
  }
}
