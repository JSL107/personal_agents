import { Inject, Injectable, Logger } from '@nestjs/common';

import { DailyTodoEntryInput } from '../domain/daily-todo.type';
import { displayTitle } from '../domain/display-title';
import { kstStartOfDay } from '../domain/parse-due-date';
import {
  DAILY_TODO_REPOSITORY_PORT,
  DailyTodoRepositoryPort,
} from '../domain/port/daily-todo.repository.port';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import {
  ScheduleItemRecord,
  ScheduleSource,
  ScheduleStatus,
} from '../domain/schedule.type';
import { countTrackedDays } from '../domain/tracked-day-count';
import {
  ResolvedTurn,
  ResolveWorkTurnsUsecase,
} from './resolve-work-turns.usecase';

export interface EveningLine {
  title: string;
  url: string | null;
  detail: string | null;
  outsideMorningList: boolean;
}

export interface EveningTodoSummary {
  loadFailed: boolean;
  hasMorningList: boolean;
  done: EveningLine[];
  extraMergedPrCount: number;
  notDone: EveningLine[];
  ratio: { done: number; total: number } | null;
  waiting: { count: number; atLeast: boolean; longest: string | null } | null;
  backlog: { myTurn: number; waiting: number; unknown: number } | null;
}

interface BuildEveningInput {
  ownerId: string | null;
  kstDate: string;
  now: Date;
  mergedPullRequestUrls: string[] | null;
  morningDelivered: boolean;
}

interface RankedItem {
  item: ScheduleItemRecord;
  resolved: ResolvedTurn;
  dayCount: number;
}

interface FromMorningInput {
  ownerId: string;
  entries: DailyTodoEntryInput[];
  done: EveningLine[];
  extraMergedPrCount: number;
  from: Date;
  to: Date;
  now: Date;
}

interface RemainingCounts {
  waiting: EveningTodoSummary['waiting'];
  backlog: EveningTodoSummary['backlog'];
}

const unknown: ResolvedTurn = {
  turn: 'UNKNOWN',
  reason: null,
  observed: false,
  wait: null,
};

const empty = (loadFailed: boolean): EveningTodoSummary => ({
  loadFailed,
  hasMorningList: false,
  done: [],
  extraMergedPrCount: 0,
  notDone: [],
  ratio: null,
  waiting: null,
  backlog: null,
});

const line = (
  item: ScheduleItemRecord,
  outsideMorningList: boolean,
): EveningLine => ({
  title: displayTitle(item),
  url: item.sourceUrl ?? item.linkUrl,
  detail: null,
  outsideMorningList,
});

const turnRank = (resolved: ResolvedTurn): number => {
  switch (resolved.turn) {
    case 'MY_TURN':
      return 0;
    case 'UNKNOWN':
      return 1;
    case 'WAITING_OTHERS':
      return 2;
  }
};

const inRange = (date: Date | null, from: Date, to: Date): boolean =>
  date !== null && date >= from && date < to;

@Injectable()
export class BuildEveningTodoSummaryUsecase {
  private readonly logger = new Logger(BuildEveningTodoSummaryUsecase.name);

  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
    @Inject(DAILY_TODO_REPOSITORY_PORT)
    private readonly dailyTodoRepository: DailyTodoRepositoryPort,
    private readonly resolve: ResolveWorkTurnsUsecase,
  ) {}

  async execute({
    ownerId,
    kstDate,
    now,
    mergedPullRequestUrls,
    morningDelivered,
  }: BuildEveningInput): Promise<EveningTodoSummary> {
    if (!ownerId) {
      this.logger.warn(
        '업무 소유자 설정이 없어 저녁 업무를 불러올 수 없습니다.',
      );
      return empty(true);
    }

    const [year, month, day] = kstDate.split('-').map(Number);
    const from = kstStartOfDay({ year, month, day });
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

    try {
      const completed = (
        await this.repository.findCompletedBetween({
          slackUserId: ownerId,
          from,
          to,
        })
      ).filter(
        (item) =>
          item.status === ScheduleStatus.DONE &&
          inRange(item.completedAt, from, to),
      );
      const list = morningDelivered
        ? await this.dailyTodoRepository.findForDate({
            slackUserId: ownerId,
            kstDate,
          })
        : null;
      const hasMorningList = list?.status === 'LISTED';
      const entries = hasMorningList ? list.entries : [];
      const listedIds = new Set(entries.map((entry) => entry.scheduleItemId));
      const done = completed.map((item) =>
        line(item, hasMorningList && !listedIds.has(item.id)),
      );
      const mergedForDoneItems =
        await this.repository.findMergedPullRequestUrls(
          completed.map((item) => item.id),
        );
      const completedPrKeys = new Set(
        completed
          .filter((item) => item.source === ScheduleSource.GITHUB_PR)
          .map((item) => item.sourceKey)
          .filter((key): key is string => key !== null),
      );
      // 수집 경로가 URL 을 소문자로 비교하므로(reconcile-pull-requests) 여기서도 대소문자를 무시한다.
      const countedUrls = new Set(
        [...completedPrKeys, ...mergedForDoneItems].map((url) =>
          url.toLowerCase(),
        ),
      );
      const extraMergedPrCount = [
        ...new Set(
          (mergedPullRequestUrls ?? []).map((url) => url.toLowerCase()),
        ),
      ].filter((url) => !countedUrls.has(url)).length;

      if (hasMorningList) {
        return await this.fromMorningList({
          ownerId,
          entries,
          done,
          extraMergedPrCount,
          from,
          to,
          now,
        });
      }

      const undated = (await this.repository.findUndated(ownerId)).filter(
        (item) =>
          item.status === ScheduleStatus.IN_PROGRESS && item.dueDate === null,
      );
      const ranked = await this.rank(undated, now);
      const counts = this.countRemaining(ranked);
      return {
        loadFailed: false,
        hasMorningList: false,
        done,
        extraMergedPrCount,
        notDone: [],
        ratio: null,
        waiting: counts.waiting,
        backlog: counts.backlog,
      };
    } catch (error) {
      this.logger.warn(`저녁 업무 조회 실패: ${String(error)}`);
      return empty(true);
    }
  }

  private async fromMorningList(
    input: FromMorningInput,
  ): Promise<EveningTodoSummary> {
    const found = await Promise.all(
      input.entries.map((entry) =>
        this.repository.findById(entry.scheduleItemId),
      ),
    );
    const records = new Map<number, ScheduleItemRecord>();
    for (const item of found) {
      if (item && item.slackUserId === input.ownerId) {
        records.set(item.id, item);
      }
    }
    const ratioEntries = input.entries.filter((entry) => {
      const item = records.get(entry.scheduleItemId);
      if (
        !item ||
        entry.turn === 'WAITING_OTHERS' ||
        item.status === ScheduleStatus.SKIPPED
      ) {
        return false;
      }
      return !(
        item.status === ScheduleStatus.DONE &&
        item.completedAt !== null &&
        item.completedAt < input.from
      );
    });
    const ratio = ratioEntries.length
      ? {
          done: ratioEntries.filter((entry) => {
            const item = records.get(entry.scheduleItemId);
            return (
              item?.status === ScheduleStatus.DONE &&
              inRange(item.completedAt, input.from, input.to)
            );
          }).length,
          total: ratioEntries.length,
        }
      : null;
    const remaining = input.entries
      .map((entry) => records.get(entry.scheduleItemId))
      .filter(
        (item): item is ScheduleItemRecord =>
          item !== undefined &&
          [ScheduleStatus.OPEN, ScheduleStatus.IN_PROGRESS].includes(
            item.status,
          ),
      );
    const ranked = await this.rank(remaining, input.now);
    const counts = this.countRemaining(ranked);
    const notDone = ranked.map(({ item, resolved, dayCount }) => {
      const turnText =
        resolved.turn === 'WAITING_OTHERS'
          ? '남 기다림'
          : resolved.turn === 'UNKNOWN'
            ? '확인 못 함'
            : resolved.reason;
      // 아침과 같이 1일째는 일수를 쓰지 않는다.
      const detail = [
        ...(dayCount >= 2 ? [`${dayCount}일째`] : []),
        ...(turnText ? [turnText] : []),
      ].join(', ');
      return { ...line(item, false), detail };
    });
    return {
      loadFailed: false,
      hasMorningList: true,
      done: input.done,
      extraMergedPrCount: input.extraMergedPrCount,
      notDone,
      ratio,
      waiting: counts.waiting,
      backlog: counts.backlog,
    };
  }

  private async rank(
    items: ScheduleItemRecord[],
    now: Date,
  ): Promise<RankedItem[]> {
    const turns = await this.resolve.execute({ items, now });
    return items
      .map((item) => ({
        item,
        resolved: turns.get(item.id) ?? unknown,
        dayCount: countTrackedDays({ item, now }),
      }))
      .sort(
        (left, right) =>
          turnRank(left.resolved) - turnRank(right.resolved) ||
          right.dayCount - left.dayCount ||
          left.item.id - right.item.id,
      );
  }

  private countRemaining(ranked: RankedItem[]): RemainingCounts {
    if (ranked.length === 0) {
      return { waiting: null, backlog: null };
    }
    const waiting = ranked.filter(
      ({ resolved }) => resolved.turn === 'WAITING_OTHERS',
    );
    const longest = waiting
      .map(({ resolved }) => resolved.wait)
      .filter((wait) => wait?.days !== null && wait?.days !== undefined)
      .sort((left, right) => (right?.days ?? 0) - (left?.days ?? 0))[0];
    return {
      waiting: waiting.length
        ? {
            count: waiting.length,
            atLeast: ranked.some(({ resolved }) => !resolved.observed),
            longest: longest?.label ?? null,
          }
        : null,
      backlog: {
        myTurn: ranked.filter(({ resolved }) => resolved.turn === 'MY_TURN')
          .length,
        waiting: waiting.length,
        unknown: ranked.filter(({ resolved }) => resolved.turn === 'UNKNOWN')
          .length,
      },
    };
  }
}
