import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DailyTodoEntryInput, STALLED_TURN } from '../domain/daily-todo.type';
import { displayTitle } from '../domain/display-title';
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
  // 오래 움직임 없는 내 PR. 닫지 않고 보이게만 둔다.
  stalled: MorningTodoLine[];
  // 노션 상태가 진행 중인 카드와 노션 외 항목. 상태를 아직 모르는 노션 카드도 숨기지 않고 여기 둔다.
  unstarted: MorningTodoLine[];
  // 노션 상태가 진행 중이 아닌(시작 전·보류 등) 카드 수. 제목 대신 건수만 싣는다.
  backlogCount: number;
}
interface BuildInput {
  ownerId: string | null;
  kstDate: string;
  now: Date;
  alreadyReconciled?: boolean;
  alreadyDelivered?: boolean;
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
interface CollectedTodos {
  sections: MorningTodoSections;
  entries: DailyTodoEntryInput[];
}
const failed = (): MorningTodoSections => ({
  loadFailed: true,
  today: [],
  waiting: [],
  stalled: [],
  unstarted: [],
  backlogCount: 0,
});
// shortcut: 세 DB 의 진행 중 값을 기본값으로 박았다 — 상태값 이름이 바뀌면 env 로 덮는다.
const DEFAULT_ACTIVE_VALUES = ['진행 중', '진행중', '테스트'];
const compare = (left: RankedItem, right: RankedItem): number =>
  right.dayCount - left.dayCount || left.item.id - right.item.id;
const line = ({ item, resolved, dayCount }: RankedItem): MorningTodoLine => ({
  title: displayTitle(item),
  url: item.sourceUrl ?? item.linkUrl,
  dayCount,
  detail:
    resolved.turn === 'WAITING_OTHERS'
      ? (resolved.wait?.label ?? '리뷰 대기')
      : resolved.turn === 'MY_TURN'
        ? resolved.reason
        : (resolved.wait?.label ?? null),
});
const stalledLine = (ranked: RankedItem): MorningTodoLine => ({
  ...line(ranked),
  detail:
    [ranked.resolved.reason, ranked.resolved.wait?.label]
      .filter(Boolean)
      .join(', ') || null,
});
const isStalled = ({ resolved }: RankedItem): boolean =>
  resolved.turn !== 'WAITING_OTHERS' && resolved.wait !== null;

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
    private readonly config: ConfigService,
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
    alreadyDelivered = false,
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
    const collected = await this.collect({ ownerId, now });
    const sections = collected?.sections ?? failed();
    const entries = collected?.entries ?? [];
    try {
      if (alreadyDelivered) {
        const found = await this.dailyTodoRepository.findForDate({
          slackUserId: ownerId,
          kstDate,
        });
        if (found) {
          return sections;
        }
      }
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

  private async collect({
    ownerId,
    now,
  }: {
    ownerId: string;
    now: Date;
  }): Promise<CollectedTodos | null> {
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
      const stalled = ranked.filter(isStalled).sort(compare);
      const moving = ranked.filter((entry) => !isStalled(entry));
      const mine = moving
        .filter((entry) => entry.resolved.turn === 'MY_TURN')
        .sort(compare);
      const unknown = moving
        .filter((entry) => entry.resolved.turn === 'UNKNOWN')
        .sort(compare);
      const waiting = moving
        .filter((entry) => entry.resolved.turn === 'WAITING_OTHERS')
        .sort(compare);
      // 저녁 회고가 이 순서·turn 으로 완료율을 센다 — 멈춘 일은 STALLED 로 남겨 분모에서 뺀다.
      const entries = [
        ...[...mine, ...unknown, ...waiting].map(({ item, resolved }) => ({
          scheduleItemId: item.id,
          turn: resolved.turn,
          observed: resolved.observed,
        })),
        ...stalled.map(({ item, resolved }) => ({
          scheduleItemId: item.id,
          turn: STALLED_TURN,
          observed: resolved.observed,
        })),
      ].map((entry, position) => ({ ...entry, position }));
      const activeValues = this.readActiveValues();
      const opened = items.filter(
        (item) => item.status === ScheduleStatus.OPEN,
      );
      const isBacklog = (item: ScheduleItemRecord): boolean =>
        item.source === ScheduleSource.NOTION_TASK &&
        typeof item.sourceStatus === 'string' &&
        !activeValues.includes(item.sourceStatus);
      const sections: MorningTodoSections = {
        loadFailed: false,
        today: [...mine, ...unknown].map(line),
        waiting: waiting.map(line),
        stalled: stalled.map(stalledLine),
        unstarted: opened
          .filter((item) => !isBacklog(item))
          .map((item) => ({
            title: displayTitle(item),
            url: item.sourceUrl ?? item.linkUrl,
            dayCount: countTrackedDays({ item, now }),
            detail: null,
          })),
        backlogCount: opened.filter(isBacklog).length,
      };
      return { sections, entries };
    } catch (error) {
      this.logger.warn(`오늘 할 일 조회 실패: ${String(error)}`);
      return null;
    }
  }

  private readActiveValues(): string[] {
    const values = (
      this.config.get<string>('SCHEDULE_NOTION_ACTIVE_VALUES') ?? ''
    )
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return values.length > 0 ? values : DEFAULT_ACTIVE_VALUES;
  }
}
