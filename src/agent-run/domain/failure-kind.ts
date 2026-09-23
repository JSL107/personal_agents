import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';

/**
 * 실패한 실행이 "라우팅을 의심할 표본" 인지 "워커·환경 문제" 인지 가르는 꼬리표.
 *
 * 원장에 실패 문구와 errorCode 는 남지만, 그것만으로는 **분류가 틀려서 죽은 회차**와
 * **제대로 배달됐는데 워커가 죽은 회차**를 가릴 수 없다. 둘을 손으로 가르려면 24개 enum 에
 * 흩어진 errorCode 를 전수로 훑어야 하고, 그 판정표는 새 코드가 늘 때마다 조용히 낡는다.
 *
 * 그래서 새 판정표를 만들지 않고 **던지는 자리가 이미 정해 둔 `DomainStatus`** 를 쓴다.
 * 그 값은 예외를 던진 사람이 원인을 알고 고른 것이고, 실측 분포도 의미 있게 갈린다
 * (2026-09-23 기준 161개 throw 지점: BAD_GATEWAY 37 · BAD_REQUEST 35 · INTERNAL 33 ·
 * PRECONDITION_FAILED 24 · NOT_FOUND 22 · 그 외 10).
 *
 * **`INPUT_REJECTED` 는 "오분류다" 라는 판정이 아니다** — 워커가 입력을 거절했다는 사실일 뿐이다.
 * 라우팅은 맞았는데 사용자가 값을 잘못 친 경우(`VACATION_INVALID_DATE_RANGE`)도 여기 들어온다.
 * 이 꼬리표는 수천 건을 눈으로 볼 수십 건으로 줄이는 **체**이고, 최종 판정은 `routedText` 와
 * `routedTo` 를 사람이 대조해야 나온다. 이름을 `MISROUTE_SUSPECT` 로 두지 않은 이유가 이것이다.
 */
export type FailureKind = 'INPUT_REJECTED' | 'WORKER_FAULT' | 'UNCLASSIFIED';

/**
 * `Record<DomainStatus, …>` 라 새 status 가 늘면 컴파일이 결정을 강제한다 —
 * 산문으로 "알아서 분류하라" 고 적어 두면 늘어난 값은 조용히 빠진다.
 *
 * `INPUT_REJECTED` 를 BAD_REQUEST·UNPROCESSABLE_ENTITY 둘로만 좁게 잡은 이유:
 * 이 둘로 던지는 코드가 오분류의 지문 그 자체다 (`PM_AGENT_EMPTY_TASKS_INPUT`,
 * `WORK_REVIEWER_EMPTY_WORK_INPUT`, `CODE_REVIEWER_INVALID_PR_REFERENCE`,
 * `CAREER_MATE_JD_EMPTY` — "PR 리뷰해줘" 가 PM 으로 잘못 가면 PM 은 할 일 목록이 없어
 * EMPTY_TASKS_INPUT 으로 죽는다).
 *
 * 반면 PRECONDITION_FAILED 는 전수로 열어 보니 전부 선행 데이터·설정 문제였고
 * (`NO_RECENT_PLAN`, `HIRE_DATE_NOT_CONFIGURED`, `TOKEN_NOT_CONFIGURED`,
 * `PUBLISH_CONFIG_REQUIRED`), NOT_FOUND 도 대상 소실 쪽이 많아 둘 다 뺐다.
 * 표본 풀은 넓이보다 **순도**가 중요하다 — 환경 실패가 섞이면 눈으로 볼 수 없는 크기가 된다.
 */
const FAILURE_KIND_BY_STATUS: Record<DomainStatus, FailureKind> = {
  [DomainStatus.BAD_REQUEST]: 'INPUT_REJECTED',
  [DomainStatus.UNPROCESSABLE_ENTITY]: 'INPUT_REJECTED',
  [DomainStatus.UNAUTHORIZED]: 'WORKER_FAULT',
  [DomainStatus.FORBIDDEN]: 'WORKER_FAULT',
  [DomainStatus.NOT_FOUND]: 'WORKER_FAULT',
  [DomainStatus.CONFLICT]: 'WORKER_FAULT',
  [DomainStatus.PRECONDITION_FAILED]: 'WORKER_FAULT',
  [DomainStatus.INTERNAL]: 'WORKER_FAULT',
  [DomainStatus.BAD_GATEWAY]: 'WORKER_FAULT',
  [DomainStatus.SERVICE_UNAVAILABLE]: 'WORKER_FAULT',
  [DomainStatus.GATEWAY_TIMEOUT]: 'WORKER_FAULT',
};

/**
 * 도메인 예외가 아니면 `UNCLASSIFIED` — 워커가 예상 못 한 곳에서 깨진 것이라
 * 라우팅 신호로 쓸 수 없다. "모르겠다" 를 `WORKER_FAULT` 로 적으면 원인을 안다고
 * 위장하는 것이고, 나중에 이 버킷을 훑을 때 진짜 워커 결함과 섞여 구분이 안 된다.
 */
export const classifyFailure = (error: unknown): FailureKind => {
  if (!(error instanceof DomainException)) {
    return 'UNCLASSIFIED';
  }
  return FAILURE_KIND_BY_STATUS[error.status] ?? 'UNCLASSIFIED';
};
