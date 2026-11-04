import { Inject, Injectable, Logger } from '@nestjs/common';

import { DailyTodoEntryInput } from '../domain/daily-todo.type';
import { displayTitle } from '../domain/display-title';
import {
  DAILY_TODO_REPOSITORY_PORT,
  DailyTodoRepositoryPort,
} from '../domain/port/daily-todo.repository.port';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import { ScheduleItemRecord, ScheduleStatus } from '../domain/schedule.type';
import { countTrackedDays } from '../domain/tracked-day-count';
import { ReconcilePullRequestsUsecase } from './reconcile-pull-requests.usecase';
import {
  ResolvedTurn,
  ResolveWorkTurnsUsecase,
} from './resolve-work-turns.usecase';

export interface MorningTodoLine {
  title: string;
  url: string | null;
  dayCount: number;
  detail: string | null;
}
export interface MorningTodoSections {
  loadFailed: boolean;
  today: MorningTodoLine[];
  waiting: MorningTodoLine[];
  unstarted: MorningTodoLine[];
}
interface BuildInput {
  ownerId: string | null;
  kstDate: string;
  now: Date;
  alreadyReconciled?: boolean;
}
interface ReconcileBeforeListingInput {
  ownerId: string | null;
  now: Date;
}
interface RankedItem {
  item: ScheduleItemRecord;
  resolved: ResolvedTurn;
  dayCount: number;
}
const failed = (): MorningTodoSections => ({
  loadFailed: true,
  today: [],
  waiting: [],
  unstarted: [],
});
const compare = (a: RankedItem, b: RankedItem): number =>
  b.dayCount - a.dayCount || a.item.id - b.item.id;
const line = ({ item, resolved, dayCount }: RankedItem): MorningTodoLine => ({
  title: displayTitle(item),
  url: item.sourceUrl ?? item.linkUrl,
  dayCount,
  detail:
    resolved.turn === 'WAITING_OTHERS'
      ? (resolved.wait?.label ?? '리뷰 대기')
      : resolved.turn === 'MY_TURN'
        ? resolved.reason
        : null,
});

@Injectable()
export class BuildMorningTodosUsecase {
  private readonly logger = new Logger(BuildMorningTodosUsecase.name);
  constructor(
    private readonly reconcile: ReconcilePullRequestsUsecase,
    private readonly resolve: ResolveWorkTurnsUsecase,
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
    @Inject(DAILY_TODO_REPOSITORY_PORT)
    private readonly dailyTodoRepository: DailyTodoRepositoryPort,
  ) {}

  async reconcileBeforeListing({
    ownerId,
    now,
  }: ReconcileBeforeListingInput): Promise<void> {
    if (!ownerId) {
      return;
    }
    try {
      const result = await this.reconcile.execute({ ownerId, now });
      if (!result.ok) {
        this.logger.warn('PR 정합 실패, 기존 업무 목록으로 계속합니다.');
      }
    } catch (error) {
      this.logger.warn(
        `PR 정합 실패, 기존 업무 목록으로 계속합니다: ${String(error)}`,
      );
    }
  }

  async execute({
    ownerId,
    kstDate,
    now,
    alreadyReconciled = false,
  }: BuildInput): Promise<MorningTodoSections> {
    if (!ownerId) {
      this.logger.warn(
        '업무 소유자 설정이 없어 오늘 할 일을 불러올 수 없습니다.',
      );
      return failed();
    }
    if (!alreadyReconciled) {
      await this.reconcileBeforeListing({ ownerId, now });
    }
    let sections: MorningTodoSections;
    let entries: DailyTodoEntryInput[];
    try {
      const items = (await this.repository.findUndated(ownerId)).filter(
        (item) => item.dueDate === null && !item.isHoliday,
      );
      const active = items.filter(
        (item) => item.status === ScheduleStatus.IN_PROGRESS,
      );
      const resolved = await this.resolve.execute({ items: active, now });
      const ranked = active.map(
        (item): RankedItem => ({
          item,
          resolved: resolved.get(item.id) ?? {
            turn: 'UNKNOWN',
            reason: null,
            observed: false,
            wait: null,
          },
          dayCount: countTrackedDays({ item, now }),
        }),
      );
      const mine = ranked
        .filter((entry) => entry.resolved.turn === 'MY_TURN')
        .sort(compare);
      const unknown = ranked
        .filter((entry) => entry.resolved.turn === 'UNKNOWN')
        .sort(compare);
      const waiting = ranked
        .filter((entry) => entry.resolved.turn === 'WAITING_OTHERS')
        .sort(compare);
      const ordered = [...mine, ...unknown, ...waiting];
      entries = ordered.map(({ item, resolved: turn }, position) => ({
        scheduleItemId: item.id,
        turn: turn.turn,
        observed: turn.observed,
        position,
      }));
      sections = {
        loadFailed: false,
        today: [...mine, ...unknown].map(line),
        waiting: waiting.map(line),
        unstarted: items
          .filter((item) => item.status === ScheduleStatus.OPEN)
          .map((item) => ({
            title: displayTitle(item),
            url: item.sourceUrl ?? item.linkUrl,
            dayCount: countTrackedDays({ item, now }),
            detail: null,
          })),
      };
    } catch (error) {
      this.logger.warn(`오늘 할 일 조회 실패: ${String(error)}`);
      sections = failed();
      entries = [];
    }
    try {
      await this.dailyTodoRepository.replaceForDate({
        slackUserId: ownerId,
        kstDate,
        status: sections.loadFailed
          ? 'LOAD_FAILED'
          : entries.length
            ? 'LISTED'
            : 'EMPTY',
        entries,
      });
    } catch (error) {
      // 목록은 이미 만들었으니 아침에는 그대로 보여 준다. 저녁은 저장된 목록이 없으면 「아침 목록 없음」으로 다룬다.
      this.logger.warn(`오늘 할 일 저장 실패: ${String(error)}`);
    }
    return sections;
  }
}
