import { Inject, Injectable, Logger } from '@nestjs/common';

import { ReviewFinding } from '../../agent/code-reviewer/domain/code-reviewer.type';
import { computeRiskMap } from '../../agent/code-reviewer/domain/risk-map';
import {
  CreateReviewCommentResult,
  PullRequestDetail,
  PullRequestDiff,
} from '../../github/domain/github.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
  IssueCommentSummary,
} from '../../github/domain/port/github-client.port';
import {
  FileHunkRanges,
  firstCommentableLine,
  parseDiffHunks,
  SNAP_MAX_DISTANCE,
  snapToCommentableLine,
} from '../domain/diff-hunk.parser';
import {
  buildDiffCoverageNote,
  buildFindingCommentBody,
  buildPartialReviewCommentBody,
  buildPrWideFindingsCommentBody,
  IDAERI_REVIEW_MARKER,
} from '../domain/finding-comment.body';
import { buildFindingFingerprint } from '../domain/finding-fingerprint';
import { sameLogin } from '../domain/harvest-signal';
import {
  PR_REVIEW_FINDING_REPOSITORY_PORT,
  PrReviewFindingRepositoryPort,
} from '../domain/port/pr-review-finding.repository.port';
import {
  CreateFindingInput,
  FindingPostMode,
  PrReviewFindingRecord,
} from '../domain/pr-review-finding.type';
import { PublishOutcome } from '../domain/publish-outcome.type';
import { isRepoAllowed, planPublication } from '../domain/publish-policy';
import {
  buildRiskMapCommentBody,
  RISK_MAP_COMMENT_TAG,
} from '../domain/risk-map-comment.body';
import { ReviewWriter, ReviewWriterResolver } from './review-writer.resolver';

const AGENT_TYPE = 'CODE_REVIEWER';

// 이보다 젊은 NOT_POSTED 카드는 다른 경로가 아직 게시하는 중일 수 있어 복구하지 않는다(recoverUnposted 참조).
// 게시는 몇 초면 끝나고 스윕 주기가 3분이라, 5분이면 진행 중인 게시와 겹치지 않으면서 다음 회차에 바로 집힌다.
const UNPOSTED_RECOVERY_MIN_AGE_MS = 5 * 60 * 1000;

export interface PublishFindingsInput {
  agentRunId: number;
  repo: string;
  pullNumber: number;
  headSha: string;
  diff: string;
  // 자르기 전 diff 전체 바이트(PullRequestDiff.bytes). diff 보다 크면 잘린 것이고, 게시할 때
  // 코드가 "N/M 바이트만 검토" 를 남긴다. 선택값으로 두면 빠뜨린 호출부가 조용히 안내를 잃는다.
  diffTotalBytes: number;
  findings: ReviewFinding[];
  max: number;
  dryRun: boolean;
  allowlistRaw: string | undefined;
}

export interface UpsertRiskMapInput {
  repo: string;
  pullNumber: number;
  detail: PullRequestDetail;
  diff: PullRequestDiff;
  findings: ReviewFinding[];
  dryRun: boolean;
  allowlistRaw: string | undefined;
}

// 이 계정이 쓴 코멘트인가. 표식만 보면 남이 흉내 낸 코멘트를 고치려다 403 을 받고 위험 지도가 영영
// 안 달린다. 대소문자는 수확기(sameLogin)처럼 무시한다. 계정 login 을 모르면 표식만으로 찾는다.
const isWrittenBy = (writer: ReviewWriter, authorLogin: string): boolean => {
  const login = writer.login?.trim() ?? '';
  return login.length === 0 || sameLogin(authorLogin, login);
};

interface RiskMapComment {
  writer: ReviewWriter;
  comment: IssueCommentSummary;
}

// 앞선 계정(지금 쓰는 계정)이 단 지도를 먼저 찾는다. 찾은 지도는 그 지도를 쓴 계정으로 고쳐야 한다 —
// 봇은 사용자 계정이 단 코멘트를 고칠 수 있다고 보장되지 않는다.
const findRiskMapComment = ({
  writers,
  comments,
}: {
  writers: ReviewWriter[];
  comments: IssueCommentSummary[];
}): RiskMapComment | null => {
  for (const writer of writers) {
    const comment = comments.find(
      (item) =>
        item.body.startsWith(IDAERI_REVIEW_MARKER) &&
        item.body.includes(RISK_MAP_COMMENT_TAG) &&
        isWrittenBy(writer, item.authorLogin),
    );
    if (comment !== undefined) {
      return { writer, comment };
    }
  }
  return null;
};

@Injectable()
export class PublishFindingsService {
  private readonly logger = new Logger(PublishFindingsService.name);
  // PR 별 위험 지도 갱신을 한 줄로 세운다. `/review-pr` 와 스윕이 같은 PR 을 동시에 돌면 둘 다 "없음" 을
  // 보고 코멘트를 두 개 단다. 두 경로가 한 프로세스 안이라 메모리 체인으로 충분하다.
  // ponytail: 프로세스를 여럿 띄우면 이 직렬화는 무력하다 — 그때는 DB 잠금이 필요하다.
  private readonly riskMapQueue = new Map<string, Promise<void>>();

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    @Inject(PR_REVIEW_FINDING_REPOSITORY_PORT)
    private readonly repository: PrReviewFindingRepositoryPort,
    private readonly writers: ReviewWriterResolver,
  ) {}

  async publish(input: PublishFindingsInput): Promise<PublishOutcome> {
    const outcome: PublishOutcome = {
      inline: 0,
      file: 0,
      issueComment: 0,
      dryRun: 0,
      notPosted: 0,
      dropped: 0,
      duplicate: 0,
    };
    const plan = planPublication({
      findings: input.findings,
      max: input.max,
    });

    // 연습 모드는 정책 계산(정렬·상한) + 집계만 하는 순수 미리보기다. 지문은 게시 여부를
    // 포함하지 않아 카드를 만들면 실게시로 전환할 때 "중복"으로 막혀 버린다 — DB 에 아예 쓰지 않는다.
    if (input.dryRun) {
      outcome.dryRun = plan.toPost.length;
      outcome.dropped = plan.dropped.length;
      return outcome;
    }

    const canPost = isRepoAllowed(input.repo, input.allowlistRaw);
    const hunks = parseDiffHunks(input.diff);
    const fallback: {
      record: PrReviewFindingRecord;
      finding: ReviewFinding;
    }[] = [];

    for (const finding of plan.toPost) {
      const record = await this.createCard({
        input,
        finding,
        // 게시 성공 시 markPosted 가 INLINE/FILE/ISSUE_COMMENT 로 갱신한다.
        postMode: 'NOT_POSTED',
        // allowlist 밖이면 게시를 시도조차 하지 않는다. 그 사실을 **만들 때** 상태에 담아,
        // 생성과 종결이 한 번의 쓰기로 끝나게 한다(둘로 나누면 사이에서 실패한 행이
        // 영구히 OPEN 으로 남는다 — 지문 중복 때문에 다시 손댈 수 없다).
        status: canPost ? 'OPEN' : 'SUPPRESSED',
      });
      if (record === null) {
        outcome.duplicate += 1;
        continue;
      }
      if (!canPost) {
        outcome.notPosted += 1;
        continue;
      }
      await this.postWithFallback({
        input,
        finding,
        record,
        hunks,
        outcome,
        fallback,
      });
    }

    for (const finding of plan.dropped) {
      const record = await this.createCard({
        input,
        finding,
        postMode: 'NOT_POSTED',
        // 게이트가 떨군 지적도 GitHub 에 올라가지 않는다. 지문은 남겨 같은 지적의 재등장을
        // 막되, 상태는 처음부터 종결로 둔다.
        status: 'SUPPRESSED',
      });
      if (record === null) {
        outcome.duplicate += 1;
        continue;
      }
      outcome.dropped += 1;
    }

    if (fallback.length > 0) {
      await this.postPrWideComment({ input, fallback, outcome });
    }

    if (canPost) {
      await this.postCoverageNote(input, outcome);
    }

    return outcome;
  }

  async recoverUnposted({
    repo,
    pullNumber,
    dryRun,
    allowlistRaw,
  }: {
    repo: string;
    pullNumber: number;
    dryRun: boolean;
    allowlistRaw: string | undefined;
  }): Promise<number> {
    if (dryRun || !isRepoAllowed(repo, allowlistRaw)) {
      return 0;
    }
    try {
      // 막 만든 카드는 다른 게시 경로(수동 /review-pr 의 publish)가 지금 올리는 중일 수 있다.
      // 그 사이에 복구가 끼면 같은 지적이 두 번 달린다. 게시는 몇 초면 끝나므로 일정 시간이 지나도
      // NOT_POSTED 인 카드만 실패한 것으로 본다.
      const settledBefore = Date.now() - UNPOSTED_RECOVERY_MIN_AGE_MS;
      const cards = (
        await this.repository.findUnpostedOpenCards({ repo, pullNumber })
      ).filter((record) => record.createdAt.getTime() <= settledBefore);
      if (cards.length === 0) {
        return 0;
      }
      const client = this.writers.forRepo(repo).client;
      const [threadResult, comments] = await Promise.all([
        client.listReviewThreads({ repo, number: pullNumber }),
        client.listIssueComments({ repo, number: pullNumber }),
      ]);
      // 잘린 목록을 부재로 판단하면 이미 게시한 카드를 중복 게시한다.
      if (threadResult.truncated) {
        throw new Error('리뷰 스레드 목록이 잘렸습니다');
      }
      // 열린 PR 검색은 인덱스가 늦어 이미 머지·종료된 PR 을 섞어 준다. 닫힌 PR 에는 올리지 않는다.
      if (threadResult.pullRequestState !== 'OPEN') {
        return 0;
      }
      // 코멘트 하나는 카드 하나에만 대응시킨다. 스레드에는 파일 경로가 없어 본문만으로 맞추는데, 두 파일에
      // 같은 문장의 카드가 있고 하나만 올라갔다면 둘 다 "게시됨" 으로 접혀 나머지 하나가 사라진다.
      const usedThreadComments = new Set<number>();
      const usedIssueItems = new Set<string>();
      const remaining: {
        record: PrReviewFindingRecord;
        finding: ReviewFinding;
      }[] = [];
      let recovered = 0;
      for (const record of cards) {
        const finding: ReviewFinding = {
          category: record.category,
          severity: record.severity,
          body: record.body,
          ...(record.filePath === null ? {} : { file: record.filePath }),
          ...(record.line === null ? {} : { line: record.line }),
        };
        const body = buildFindingCommentBody(finding);
        const isUnusedMatch = (item: { databaseId: number; body: string }) =>
          item.body === body && !usedThreadComments.has(item.databaseId);
        const thread = threadResult.threads.find((item) =>
          item.comments.some(isUnusedMatch),
        );
        const comment = thread?.comments.find(isUnusedMatch);
        const issueBody = buildPrWideFindingsCommentBody([finding])
          .split('\n\n')
          .slice(1)
          .join('\n\n');
        const issue = comments.find(
          (item) =>
            item.body.includes(issueBody) &&
            !usedIssueItems.has(`${item.id}|${issueBody}`),
        );
        if (thread && comment) {
          usedThreadComments.add(comment.databaseId);
          await this.repository.markPosted({
            id: record.id,
            postMode: record.line === null ? 'FILE' : 'INLINE',
            githubCommentId: String(comment.databaseId),
            githubThreadNodeId: thread.threadId,
          });
          recovered += 1;
        } else if (issue) {
          usedIssueItems.add(`${issue.id}|${issueBody}`);
          await this.repository.markPosted({
            id: record.id,
            postMode: 'ISSUE_COMMENT',
            githubCommentId: String(issue.id),
            githubThreadNodeId: null,
          });
          recovered += 1;
        } else {
          remaining.push({ record, finding });
        }
      }
      if (remaining.length === 0) {
        return recovered;
      }
      const [headSha, diff] = await Promise.all([
        this.githubClient.getPullRequestHeadSha({ repo, number: pullNumber }),
        this.githubClient.getPullRequestDiff({ repo, number: pullNumber }),
      ]);
      const input: PublishFindingsInput = {
        agentRunId: 0,
        repo,
        pullNumber,
        headSha,
        diff: diff.diff,
        diffTotalBytes: diff.bytes,
        findings: [],
        max: 0,
        dryRun,
        allowlistRaw,
      };
      const outcome: PublishOutcome = {
        inline: 0,
        file: 0,
        issueComment: 0,
        dryRun: 0,
        notPosted: 0,
        dropped: 0,
        duplicate: 0,
      };
      const fallback: {
        record: PrReviewFindingRecord;
        finding: ReviewFinding;
      }[] = [];
      const hunks = parseDiffHunks(diff.diff);
      for (const item of remaining) {
        // 카드를 만든 뒤 push 가 있었으면 저장된 줄 번호가 지금 코드의 그 줄이라는 보장이 없다.
        // 스냅은 20줄까지 끌어당겨 엉뚱한 코드에 붙일 수 있으니, 줄을 버리고 그 파일 단위 스레드로 올린다.
        await this.postWithFallback({
          input,
          ...item,
          hunks,
          outcome,
          fallback,
          skipLineAnchor: item.record.headSha !== headSha,
        });
      }
      if (fallback.length > 0) {
        await this.postPrWideComment({ input, fallback, outcome });
      }
      return recovered + outcome.inline + outcome.file + outcome.issueComment;
    } catch (error: unknown) {
      this.logger.warn(
        `미게시 지적 복구 실패 (${repo}#${pullNumber}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  // 승인자용 위험 지도를 PR 코멘트 하나로 남긴다. push 뒤 재리뷰에서는 새로 달지 않고 그 코멘트를
  // 고쳐 쓴다 — 회차마다 쌓이면 어느 것이 최신인지 읽는 사람이 가려야 한다.
  // 지적 카드와 달리 지적 0건이어도 단다(위험은 지적 유무와 별개다). 게시 범위는 지적과 같은 허용 목록·
  // 연습 모드를 따른다. 안내일 뿐이라 실패해도 리뷰·게시 결과를 바꾸지 않는다.
  async upsertRiskMap(input: UpsertRiskMapInput): Promise<void> {
    const key = `${input.repo}#${input.pullNumber}`;
    const previous = this.riskMapQueue.get(key) ?? Promise.resolve();
    const current = previous.then(() => this.upsertRiskMapNow(input));
    this.riskMapQueue.set(key, current);
    try {
      return await current;
    } finally {
      if (this.riskMapQueue.get(key) === current) {
        this.riskMapQueue.delete(key);
      }
    }
  }

  private async upsertRiskMapNow(input: UpsertRiskMapInput): Promise<void> {
    const label = `${input.repo}#${input.pullNumber}`;
    // 계산도 try 안에 둔다 — 스윕은 이 뒤에 지적 카드를 게시하므로, 여기서 새는 예외가 카드 게시를 막는다.
    try {
      const map = computeRiskMap({
        detail: input.detail,
        diff: input.diff,
        findings: input.findings,
      });
      if (input.dryRun || !isRepoAllowed(input.repo, input.allowlistRaw)) {
        this.logger.log(
          `위험 지도 미게시 (${label}, ${input.dryRun ? '연습 모드' : '허용 목록 밖'}): ${map.level} ${map.score}/100`,
        );
        return;
      }
      // 리뷰하는 사이 새 커밋이 올라왔으면 쓰지 않는다 — 새 head 의 리뷰가 따로 돈다. 직렬화만으로는
      // 늦게 끝난 옛 스냅샷이 최신 지도를 덮어쓰는 것을 막지 못한다.
      const headSha = await this.githubClient.getPullRequestHeadSha({
        repo: input.repo,
        number: input.pullNumber,
      });
      if (headSha !== input.detail.headSha) {
        this.logger.log(
          `위험 지도 미게시 (${label}, 리뷰한 커밋 ${input.detail.headSha.slice(0, 7)} 이 최신 head ${headSha.slice(0, 7)} 가 아님)`,
        );
        return;
      }
      const body = buildRiskMapCommentBody(map);
      const comments = await this.githubClient.listIssueComments({
        repo: input.repo,
        number: input.pullNumber,
      });
      // 봇 전환 전에 사용자 계정이 단 지도도 찾는다. 지금 계정으로만 찾으면 전환 시점에 열려 있던 PR 에
      // 지도가 두 개 남는다.
      const writers = this.writers.candidatesFor(input.repo);
      const match = findRiskMapComment({ writers, comments });
      if (match === null) {
        await writers[0].client.addIssueComment({
          repo: input.repo,
          number: input.pullNumber,
          body,
        });
        return;
      }
      if (match.comment.body === body) {
        return;
      }
      await match.writer.client.updateIssueComment({
        repo: input.repo,
        commentId: match.comment.id,
        body,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `위험 지도 게시 실패 (${label}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // diff 가 잘렸으면 PR 에 따로 알린다 — 카드만 보면 전체를 본 리뷰로 읽힌다.
  // - 지적 0건: 온디맨드(`/review-pr`·라우터) 경로는 지적 없음 코멘트가 없어 PR 에 아무 흔적도 남지
  //   않으므로 안내만 단다. 스윕은 지적 0건이면 여기 오기 전에 자기 "지적 없음" 코멘트로 끝난다.
  // - 지적이 있는데 하나도 안 올렸으면(전부 중복·게이트 탈락) 새로 알릴 리뷰가 없어 남기지 않는다.
  // 안내일 뿐이라 실패해도 게시 결과를 바꾸지 않는다.
  private async postCoverageNote(
    input: PublishFindingsInput,
    outcome: PublishOutcome,
  ): Promise<void> {
    const note = buildDiffCoverageNote(input.diff, input.diffTotalBytes);
    const posted = outcome.inline + outcome.file + outcome.issueComment;
    if (note === null || (input.findings.length > 0 && posted === 0)) {
      return;
    }
    try {
      await this.writers.forRepo(input.repo).client.addIssueComment({
        repo: input.repo,
        number: input.pullNumber,
        body: buildPartialReviewCommentBody(note),
      });
    } catch (error: unknown) {
      this.logger.warn(
        `부분 검토 안내 게시 실패 (${input.repo}#${input.pullNumber}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async createCard({
    input,
    finding,
    postMode,
    status,
  }: {
    input: PublishFindingsInput;
    finding: ReviewFinding;
    postMode: FindingPostMode;
    status?: CreateFindingInput['status'];
  }): Promise<PrReviewFindingRecord | null> {
    const filePath = finding.file ?? null;
    const createInput: CreateFindingInput = {
      agentRunId: input.agentRunId,
      agentType: AGENT_TYPE,
      repo: input.repo,
      pullNumber: input.pullNumber,
      headSha: input.headSha,
      category: finding.category,
      severity: finding.severity,
      filePath,
      line: finding.line ?? null,
      body: finding.body,
      fingerprint: buildFindingFingerprint({
        repo: input.repo,
        pullNumber: input.pullNumber,
        filePath,
        body: finding.body,
      }),
      postMode,
      status,
    };
    return await this.repository.createIfAbsent(createInput);
  }

  // 1) 줄 단위 → 2) 같은 파일에 파일 단위 → 3) PR 전체 의견 코멘트. 지적이 조용히 유실되지 않게 한다.
  // 1·2 는 리뷰 스레드라 👍/👎·답글·Resolve 가 수확되지만, 3 은 일반 코멘트라 수확되지 않는다 —
  // 그래서 파일이 diff 에 있으면 3 으로 가기 전에 반드시 2 를 거친다.
  private async postWithFallback({
    input,
    finding,
    record,
    hunks,
    outcome,
    fallback,
    skipLineAnchor = false,
  }: {
    input: PublishFindingsInput;
    finding: ReviewFinding;
    record: PrReviewFindingRecord;
    hunks: FileHunkRanges[];
    outcome: PublishOutcome;
    fallback: { record: PrReviewFindingRecord; finding: ReviewFinding }[];
    // 줄 위치를 믿을 수 없을 때(복구 시점의 head 가 카드의 head 와 다름) 줄 게시를 건너뛰고 파일 단위로 올린다.
    skipLineAnchor?: boolean;
  }): Promise<void> {
    const filePath = finding.file;
    // diff 에 없는 경로는 GitHub 이 422 로 거절한다 — 모델이 file 자리에 "PR 본문" 같은
    // 라벨을 넣는 경우가 실제로 있었다(#492). 헛호출 없이 곧장 PR 전체 의견으로 보낸다.
    if (
      filePath === undefined ||
      !hunks.some((file) => file.filePath === filePath)
    ) {
      fallback.push({ record, finding });
      return;
    }

    // line 이 없어도 파일 단위로 강등하지 않는다 — 파일 헤더에 붙은 코멘트는 어느 줄에 대한
    // 지적인지 보이지 않아 리뷰로서 쓸모가 없다. 그 파일 첫 변경 줄에 인라인으로 붙인다.
    const snapped = skipLineAnchor
      ? null
      : finding.line === undefined
        ? firstCommentableLine({ hunks, filePath })
        : snapToCommentableLine({
            hunks,
            filePath,
            line: finding.line,
            maxDistance: SNAP_MAX_DISTANCE,
          });

    const inline =
      snapped === null
        ? null
        : await this.tryCreateReviewComment({
            input,
            finding,
            filePath,
            line: snapped,
          });
    // 줄 게시가 거절되면(스냅한 줄이 GitHub 기준 diff 와 어긋나는 등) 같은 파일에 파일 단위로 —
    // 파일 머리라도 스레드로 남아야 수확된다. 스냅할 줄이 없을 때도 같은 파일 단위 한 번이다.
    const posted =
      inline ??
      (await this.tryCreateReviewComment({
        input,
        finding,
        filePath,
        line: null,
      }));
    const line = inline === null ? null : snapped;
    if (posted === null) {
      fallback.push({ record, finding });
      return;
    }

    // 게시는 이미 성공했다 — DB 상태 갱신 실패는 지적 유실이 아니므로 집계·폴백에 영향을 주지 않는다.
    if (line === null) {
      outcome.file += 1;
    } else {
      outcome.inline += 1;
    }
    try {
      await this.repository.markPosted({
        id: record.id,
        postMode: line === null ? 'FILE' : 'INLINE',
        githubCommentId: posted.commentId,
        githubThreadNodeId: posted.nodeId,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `게시 성공, DB 상태 갱신 실패 (${filePath}:${line ?? 'file'}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // 실패는 null 로 돌려준다 — 강등 여부는 호출부가 정한다.
  private async tryCreateReviewComment({
    input,
    finding,
    filePath,
    line,
  }: {
    input: PublishFindingsInput;
    finding: ReviewFinding;
    filePath: string;
    line: number | null;
  }): Promise<CreateReviewCommentResult | null> {
    try {
      return await this.writers.forRepo(input.repo).client.createReviewComment({
        repo: input.repo,
        pullNumber: input.pullNumber,
        commitSha: input.headSha,
        filePath,
        line,
        body: buildFindingCommentBody({
          category: finding.category,
          severity: finding.severity,
          body: finding.body,
        }),
      });
    } catch (error: unknown) {
      this.logger.warn(
        `${line === null ? '파일 단위' : '인라인'} 게시 실패 (${filePath}:${line ?? 'file'}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async postPrWideComment({
    input,
    fallback,
    outcome,
  }: {
    input: PublishFindingsInput;
    fallback: { record: PrReviewFindingRecord; finding: ReviewFinding }[];
    outcome: PublishOutcome;
  }): Promise<void> {
    try {
      await this.writers.forRepo(input.repo).client.addIssueComment({
        repo: input.repo,
        number: input.pullNumber,
        body: buildPrWideFindingsCommentBody(
          fallback.map((item) => item.finding),
        ),
      });
    } catch (error: unknown) {
      this.logger.error(
        `PR 전체 의견 게시까지 실패 — 카드는 NOT_POSTED 로 남는다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      outcome.notPosted += fallback.length;
      return;
    }

    // 게시는 이미 성공했다(PR 전체 의견 코멘트 1건). 카드별 DB 상태 갱신 실패는 지적 유실이 아니므로
    // 집계는 게시 결과만 반영하고, markPosted 실패는 로그만 남긴다.
    for (const item of fallback) {
      outcome.issueComment += 1;
      try {
        await this.repository.markPosted({
          id: item.record.id,
          postMode: 'ISSUE_COMMENT',
          githubCommentId: null,
          githubThreadNodeId: null,
        });
      } catch (error: unknown) {
        this.logger.warn(
          `게시 성공, DB 상태 갱신 실패 (id=${item.record.id}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
