import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AuthorPullRequestSignals,
  AuthorTurnReason,
} from '../../github/domain/author-pr-signals.type';
import { classifyAuthorPullRequestTurn } from '../../github/domain/classify-author-pr-turn';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
  PullRequestRef,
} from '../../github/domain/port/github-client.port';
import {
  describeReviewWait,
  ReviewWaitDescription,
} from '../../github/domain/review-wait';
import { WorkTurn } from '../domain/daily-todo.type';
import { parsePullRequestUrl } from '../domain/github-source-url';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import { ScheduleItemRecord, ScheduleSource } from '../domain/schedule.type';

export interface ResolvedTurn {
  turn: WorkTurn;
  reason: AuthorTurnReason | null;
  observed: boolean;
  wait: ReviewWaitDescription | null;
}
interface ResolveWorkTurnsInput {
  items: ScheduleItemRecord[];
  now: Date;
}
const keyOf = (ref: PullRequestRef): string =>
  `${ref.repo.toLowerCase()}#${ref.number}`;
const unknown = (observed: boolean): ResolvedTurn => ({
  turn: 'UNKNOWN',
  reason: null,
  observed,
  wait: null,
});

@Injectable()
export class ResolveWorkTurnsUsecase {
  private readonly logger = new Logger(ResolveWorkTurnsUsecase.name);

  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
    @Inject(GITHUB_CLIENT_PORT) private readonly github: GithubClientPort,
  ) {}

  async execute({
    items,
    now,
  }: ResolveWorkTurnsInput): Promise<Map<number, ResolvedTurn>> {
    const result = new Map<number, ResolvedTurn>();
    let links = new Map<number, string[]>();
    let linksFailed = false;
    try {
      links = await this.repository.findOpenLinkedPullRequestUrls(
        items
          .filter((item) => item.source !== ScheduleSource.GITHUB_PR)
          .map((item) => item.id),
      );
    } catch (error) {
      this.logger.warn(
        `연결 PR 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      linksFailed = true;
    }
    const refsByItem = new Map<number, PullRequestRef[]>();
    const refs = new Map<string, PullRequestRef>();
    for (const item of items) {
      if (linksFailed && item.source !== ScheduleSource.GITHUB_PR) {
        result.set(item.id, unknown(false));
        continue;
      }
      const urls =
        item.source === ScheduleSource.GITHUB_PR
          ? [item.sourceKey ?? '']
          : (links.get(item.id) ?? []);
      if (urls.length === 0) {
        result.set(item.id, unknown(true));
        continue;
      }
      const parsed = urls.map(parsePullRequestUrl);
      if (parsed.some((ref) => ref === null)) {
        result.set(item.id, unknown(false));
        continue;
      }
      const itemRefs = parsed.filter(
        (ref): ref is PullRequestRef => ref !== null,
      );
      refsByItem.set(item.id, itemRefs);
      for (const ref of itemRefs) {
        refs.set(keyOf(ref), ref);
      }
    }
    if (refs.size === 0) {
      return result;
    }
    let signals: AuthorPullRequestSignals[];
    try {
      signals = await this.github.fetchAuthorPullRequestSignals([
        ...refs.values(),
      ]);
    } catch (error) {
      this.logger.warn(
        `PR 신호 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      for (const id of refsByItem.keys()) {
        result.set(id, unknown(false));
      }
      return result;
    }
    const signalMap = new Map(
      signals.map((signal) => [keyOf(signal.ref), signal]),
    );
    const waiting = signals.filter(
      (signal) =>
        classifyAuthorPullRequestTurn(signal).turn === 'WAITING_OTHERS' &&
        refs.has(keyOf(signal.ref)),
    );
    const waitMap = new Map<string, ReviewWaitDescription>();
    if (waiting.length > 0) {
      try {
        const waits = await this.github.fetchReviewWaits(
          waiting.map(({ ref, pendingReviewers }) => ({
            ref,
            pendingReviewers,
          })),
        );
        for (const wait of waits) {
          // complete=false 면 describeReviewWait 가 기간 없이 「리뷰 대기」를 돌려준다.
          waitMap.set(keyOf(wait.ref), describeReviewWait({ wait, now }));
        }
      } catch (error) {
        this.logger.warn(
          `PR 리뷰 이력 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    for (const [id, itemRefs] of refsByItem) {
      const itemSignals = itemRefs.map((ref) => signalMap.get(keyOf(ref)));
      if (itemSignals.some((signal) => !signal || !signal.observed)) {
        result.set(id, unknown(false));
        continue;
      }
      const turns = itemSignals.map((signal) =>
        classifyAuthorPullRequestTurn(signal!),
      );
      const mine = turns.find((turn) => turn.turn === 'MY_TURN');
      if (mine) {
        result.set(id, { ...mine, observed: true, wait: null });
        continue;
      }
      if (turns.every((turn) => turn.turn === 'WAITING_OTHERS')) {
        const descriptions = itemRefs.map(
          (ref) =>
            waitMap.get(keyOf(ref)) ?? { label: '리뷰 대기', days: null },
        );
        const wait = descriptions.reduce((best, current) =>
          (current.days ?? 0) > (best.days ?? 0) ? current : best,
        );
        result.set(id, {
          turn: 'WAITING_OTHERS',
          reason: '리뷰 대기',
          observed: true,
          wait,
        });
      } else {
        result.set(id, unknown(true));
      }
    }
    return result;
  }
}
