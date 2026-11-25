import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';

enum RepositoryAccess {
  READ = 'READ',
  WRITE = 'WRITE',
}

// `Record` 라 port 에 메서드가 늘면 여기서 분류하기 전까지 빌드가 끊긴다. 쓰기를 빠뜨리면
// 오류 없이 콘솔 캘린더만 조용히 낡으므로, 새 메서드가 분류를 건너뛸 수 없게 한다.
const SCHEDULE_REPOSITORY_ACCESS: Record<
  keyof ScheduleRepositoryPort,
  RepositoryAccess
> = {
  save: RepositoryAccess.WRITE,
  saveMany: RepositoryAccess.WRITE,
  findByDateRange: RepositoryAccess.READ,
  findTrackingMonth: RepositoryAccess.READ,
  findUndated: RepositoryAccess.READ,
  findOpenLinkedPullRequestUrls: RepositoryAccess.READ,
  findMergedPullRequestUrls: RepositoryAccess.READ,
  findCompletedBetween: RepositoryAccess.READ,
  findUnfinished: RepositoryAccess.READ,
  findAllByOwner: RepositoryAccess.READ,
  findBySource: RepositoryAccess.READ,
  findBySourceKey: RepositoryAccess.READ,
  findById: RepositoryAccess.READ,
  updateStatus: RepositoryAccess.WRITE,
  updateShortTitle: RepositoryAccess.WRITE,
  transition: RepositoryAccess.WRITE,
  createCollected: RepositoryAccess.WRITE,
  updateSourceWorkspace: RepositoryAccess.WRITE,
  updateSourceStatus: RepositoryAccess.WRITE,
  updateFields: RepositoryAccess.WRITE,
  countActiveCandidates: RepositoryAccess.READ,
  claimDueReminders: RepositoryAccess.WRITE,
  claimDueFollowUps: RepositoryAccess.WRITE,
  markReminded: RepositoryAccess.WRITE,
  markFollowUpNotified: RepositoryAccess.WRITE,
  saveFollowUpDraft: RepositoryAccess.WRITE,
  expireCandidates: RepositoryAccess.WRITE,
  addFollowUp: RepositoryAccess.WRITE,
  updateFollowUp: RepositoryAccess.WRITE,
  addNote: RepositoryAccess.WRITE,
  addEvent: RepositoryAccess.WRITE,
  recordEventAndTransition: RepositoryAccess.WRITE,
  findDetail: RepositoryAccess.READ,
  countPendingFollowUps: RepositoryAccess.READ,
  markAsHoliday: RepositoryAccess.WRITE,
  deleteById: RepositoryAccess.WRITE,
};

interface RepositoryMethod {
  (...args: unknown[]): Promise<unknown>;
}

interface NotifyOnScheduleWriteInput {
  readonly repository: ScheduleRepositoryPort;
  readonly onChanged: () => void;
}

// 쓰기 메서드가 아무것도 바꾸지 않았음을 알리는 반환값. 리마인더 선점처럼 매분 도는 쓰기가
// 대부분 빈손으로 끝나므로, 이때까지 알리면 앱이 이유 없이 매분 캘린더를 다시 읽는다.
const isUnchanged = (result: unknown): boolean =>
  result === null ||
  result === false ||
  result === 0 ||
  result === 'DUPLICATE' ||
  (Array.isArray(result) && result.length === 0);

/**
 * 일정 저장소를 감싸 쓰기가 성공하면 `onChanged` 를 부른다.
 *
 * 일정을 쓰는 곳은 Slack 발화·자동 수집·리마인더·콘솔 화면으로 흩어져 있지만 모두 이 port
 * 를 지난다. 호출부마다 알림을 붙이면 하나만 빠져도 그 경로의 변경이 화면에 안 보이므로,
 * 모두가 지나는 이 지점에서 한 번 건다. 저장소 클래스는 영속성만 맡도록 그대로 둔다.
 */
export function notifyOnScheduleWrite({
  repository,
  onChanged,
}: NotifyOnScheduleWriteInput): ScheduleRepositoryPort {
  const entries = (
    Object.keys(SCHEDULE_REPOSITORY_ACCESS) as (keyof ScheduleRepositoryPort)[]
  ).map((name) => {
    const method: RepositoryMethod = (...args) =>
      (repository[name] as RepositoryMethod).apply(repository, args);
    if (SCHEDULE_REPOSITORY_ACCESS[name] === RepositoryAccess.READ) {
      return [name, method];
    }
    const notifying: RepositoryMethod = async (...args) => {
      const result = await method(...args);
      if (!isUnchanged(result)) {
        onChanged();
      }
      return result;
    };
    return [name, notifying];
  });
  return Object.fromEntries(entries) as ScheduleRepositoryPort;
}
