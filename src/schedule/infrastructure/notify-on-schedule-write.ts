import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';

enum RepositoryAccess {
  READ = 'READ',
}

type RepositoryResult<Name extends keyof ScheduleRepositoryPort> = Awaited<
  ReturnType<ScheduleRepositoryPort[Name]>
>;

// 쓰기 메서드마다 "실제로 바뀌었는가" 를 그 메서드의 반환 타입으로 판단한다. 값 하나로
// 모든 메서드를 뭉뚱그려 판단하면 메서드마다 다른 반환값의 뜻을 어림하게 되고, 반환 타입이
// 바뀌어도 알 수 없다. 매핑 타입이라 port 에 메서드가 늘거나 반환 타입이 바뀌면 여기서
// 다시 정하기 전까지 빌드가 끊긴다 — 쓰기를 빠뜨리면 오류 없이 콘솔 캘린더만 낡기 때문이다.
type ScheduleRepositoryChanges = {
  readonly [Name in keyof ScheduleRepositoryPort]:
    | RepositoryAccess.READ
    | ((result: RepositoryResult<Name>) => boolean);
};

const always = (): boolean => true;
const exists = <T>(result: T | null): boolean => result !== null;
const notDuplicate = (result: unknown): boolean => result !== 'DUPLICATE';

const SCHEDULE_REPOSITORY_CHANGES: ScheduleRepositoryChanges = {
  save: always,
  saveMany: (saved) => saved.length > 0,
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
  updateStatus: always,
  updateShortTitle: (updated) => updated,
  transition: exists,
  createCollected: notDuplicate,
  updateSourceWorkspace: always,
  updateSourceStatus: always,
  updateFields: exists,
  countActiveCandidates: RepositoryAccess.READ,
  // 리마인더 선점은 매분 돌고 대부분 빈손으로 끝난다. 이때까지 알리면 앱이 매분 다시 읽는다.
  claimDueReminders: (claimed) => claimed.length > 0,
  claimDueFollowUps: (claimed) => claimed.length > 0,
  markReminded: (marked) => marked,
  markFollowUpNotified: (marked) => marked,
  saveFollowUpDraft: (saved) => saved,
  expireCandidates: (expiredCount) => expiredCount > 0,
  addFollowUp: exists,
  updateFollowUp: exists,
  addNote: exists,
  addEvent: notDuplicate,
  recordEventAndTransition: notDuplicate,
  findDetail: RepositoryAccess.READ,
  countPendingFollowUps: RepositoryAccess.READ,
  markAsHoliday: always,
  deleteById: always,
};

interface RepositoryMethod {
  (...args: unknown[]): Promise<unknown>;
}

interface ChangeCheck {
  (result: unknown): boolean;
}

interface NotifyOnScheduleWriteInput {
  readonly repository: ScheduleRepositoryPort;
  readonly onChanged: () => void;
}

/**
 * 일정 저장소를 감싸 쓰기가 실제로 무언가를 바꿨을 때 `onChanged` 를 부른다.
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
    Object.keys(SCHEDULE_REPOSITORY_CHANGES) as (keyof ScheduleRepositoryPort)[]
  ).map((name) => {
    const method: RepositoryMethod = (...args) =>
      (repository[name] as RepositoryMethod).apply(repository, args);
    const change = SCHEDULE_REPOSITORY_CHANGES[name];
    if (change === RepositoryAccess.READ) {
      return [name, method];
    }
    // 매핑 타입이 메서드별 결과 타입을 이미 맞춰 두었다. 이름으로 순회하는 이 자리에서만
    // 그 짝을 TS 가 따라오지 못해 넓힌다.
    const changed = change as ChangeCheck;
    const notifying: RepositoryMethod = async (...args) => {
      const result = await method(...args);
      if (changed(result)) {
        onChanged();
      }
      return result;
    };
    return [name, notifying];
  });
  return Object.fromEntries(entries) as ScheduleRepositoryPort;
}
