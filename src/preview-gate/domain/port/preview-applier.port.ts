import { ApplyResult } from '../apply-result.type';
import { PreviewAction, PreviewKind } from '../preview-action.type';

// PreviewApplier 들을 multi-provider 로 모으기 위한 DI 토큰. NestJS providers 에 array 로 inject.
export const PREVIEW_APPLIERS = Symbol('PREVIEW_APPLIERS');

// 여러 단계로 나뉜 반영이 "어디까지 끝났는지" 를 원장에 남기는 통로.
//
// 프로세스가 반영 도중 죽으면 그 진행은 메모리와 함께 사라진다. 남은 것은 PENDING 카드뿐이라
// 사용자는 "안 눌렸다" 로 읽고 다시 누르고, 이미 끝난 단계가 한 번 더 실행된다. 그 중복을
// 막을 수 있는 유일한 자리가 단계마다 즉시 쓰는 이 기록이다.
export interface ApplyProgress {
  // 재시작 전에 이미 끝난 단계들. 첫 실행이면 빈 배열이다.
  readonly done: readonly string[];
  // 단계 하나가 끝날 때마다 호출한다. **다음 단계를 시작하기 전에 await 해야 한다** — 기록이
  // 단계보다 늦으면 그 사이에 죽었을 때 끝난 단계가 안 끝난 것으로 남는다.
  record(step: string): Promise<void>;
}

// Strategy — kind 별 실제 부작용 (Notion/GitHub write 등) 수행.
// PM-2 가 PM_WRITE_BACK applier 를 등록. 추가 kind 는 새 PreviewApplier 구현체로 확장.
export interface PreviewApplier {
  readonly kind: PreviewKind;
  // 중단된 뒤 이어서 돌려도 안전한가. `apply` 가 단계마다 `progress.record` 를 남기는 applier 만
  // true 다 — 그 기록이 없으면 재개가 이미 끝난 단계를 처음부터 다시 실행한다.
  //
  // 생략(= false)이면 부팅 훅은 **재개하지 않고** 실패로 마감한 뒤 사용자에게 알린다. 단발
  // 외부 호출로 끝나는 applier 가 그렇다 — 죽은 시점에 그 호출이 상대에게 닿았는지를 알 수
  // 없으므로, 모르는 채 다시 부르면 중복 발행이다. 판단은 사람에게 넘긴다.
  readonly resumable?: boolean;
  // 사용자 ✅ 클릭 후 호출. preview 객체 전체를 받아 payload 를 strategy 자체 schema 로 narrow.
  // 실패 시 throw — apply usecase 가 그대로 사용자에게 노출. payload validation 도 strategy 책임.
  // 반환 ApplyResult.message 는 Slack 메시지, ApplyResult.artifacts 는 실행 후 ResultVerifier 가
  // 재조회 검증할 산출물 (없으면 빈 배열).
  //
  // `progress` 는 옵셔널이다 — 단계가 하나뿐인 applier 는 받지 않아도 된다. 단위 테스트에서
  // 직접 호출할 때도 빠질 수 있으므로, 쓰는 쪽은 없을 때의 동작(= 처음부터 전부 실행)을
  // 함께 성립시켜야 한다.
  apply(preview: PreviewAction, progress?: ApplyProgress): Promise<ApplyResult>;
}
