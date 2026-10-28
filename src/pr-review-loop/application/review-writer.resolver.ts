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

  // 봇 계정으로 쓰는 레포인지. 스윕은 이 레포만 작성자를 가리지 않고 리뷰한다.
  usesBot(repo: string): boolean {
    return this.botFor(repo) !== null;
  }

  // 리뷰·게시를 허용하는 레포 목록(콤마 구분 원문). PR_REVIEW_INLINE_REPOS 에 봇이 쓰는 레포를
  // 더한다 — 봇 레포는 GITHUB_REVIEW_BOT_REPOS 에만 적어도 리뷰된다. 봇을 못 쓰면 봇 목록은
  // 더하지 않는다: 사용자 계정으로 남의 PR 에 코멘트가 달린다.
  publishAllowlistRaw(): string {
    const inlineRepos =
      this.configService.get<string>('PR_REVIEW_INLINE_REPOS') ?? '';
    const botRepos =
      this.botLogin() === undefined
        ? ''
        : (this.configService.get<string>('GITHUB_REVIEW_BOT_REPOS') ?? '');
    return [inlineRepos, botRepos]
      .filter((item) => item.trim().length > 0)
      .join(',');
  }

  // 지금 쓰는 계정이 앞, 봇 전환 전에 사용자 계정이 단 코멘트를 찾기 위한 사용자 계정이 뒤.
  candidatesFor(repo: string): ReviewWriter[] {
    const bot = this.botFor(repo);
    return bot === null ? [this.owner()] : [bot, this.owner()];
  }

  private botFor(repo: string): ReviewWriter | null {
    const login = this.botLogin();
    const repos = this.configService.get<string>('GITHUB_REVIEW_BOT_REPOS');
    if (
      this.botClient === null ||
      login === undefined ||
      !isRepoAllowed(repo, repos)
    ) {
      return null;
    }
    return { client: this.botClient, login };
  }

  // 로그인을 모르는 봇은 쓰지 않는다 — 표식만으로 찾으면 사용자 계정이 단 코멘트를 봇이 고치려 든다.
  private botLogin(): string | undefined {
    if (this.botClient === null) {
      return undefined;
    }
    const login = this.configService
      .get<string>('GITHUB_REVIEW_BOT_LOGIN')
      ?.trim();
    return login ? login : undefined;
  }

  private owner(): ReviewWriter {
    return {
      client: this.ownerClient,
      login: this.configService.get<string>('GITHUB_WEBHOOK_OWNER_LOGIN'),
    };
  }
}
