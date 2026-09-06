import { CeoErrorCode } from '../../agent/ceo/domain/ceo-error-code.enum';
import { CtoErrorCode } from '../../agent/cto/domain/cto-error-code.enum';
import { PoEvalErrorCode } from '../../agent/po-eval/domain/po-eval-error-code.enum';
import { PoShadowErrorCode } from '../../agent/po-shadow/domain/po-shadow-error-code.enum';
import { AgentType } from '../../model-router/domain/model-router.type';

// 콘솔 리모컨 2A.2 — precondition 예외를 "먼저 당길 선행 worker"로 매핑한다.
// errorCode 하나가 실패 worker + 없는 선행 + (필요 시)합성 인자를 함의한다.
// PREREQ: 선행 worker를 먼저 실행하면 원래 worker가 진행 가능.
// UNRESOLVABLE: 선행은 있으나 조건 미충족(비결정적) — 자동해소 불가, 즉시 안내.
export type ChainResolution =
  | {
      readonly kind: 'PREREQ';
      readonly failedWorkerLabel: string;
      readonly prereqWorker: AgentType;
      readonly needsRecentArg?: boolean;
    }
  | { readonly kind: 'UNRESOLVABLE' };

export const PRECONDITION_CHAIN_MAP: Readonly<Record<string, ChainResolution>> =
  {
    [PoShadowErrorCode.NO_RECENT_PLAN]: {
      kind: 'PREREQ',
      failedWorkerLabel: 'PO_SHADOW',
      prereqWorker: AgentType.PM,
    },
    [CeoErrorCode.NO_PO_EVAL_RUN]: {
      kind: 'PREREQ',
      failedWorkerLabel: 'CEO',
      prereqWorker: AgentType.PO_EVAL,
    },
    [PoEvalErrorCode.NO_SUB_AGENT_RUNS]: {
      kind: 'PREREQ',
      failedWorkerLabel: 'PO_EVAL',
      prereqWorker: AgentType.IMPACT_REPORTER,
      needsRecentArg: true,
    },
    // 선행이 아니라 모델 출력이 스키마와 안 맞는 경우 — 재실행으로 자동 해소되지 않는다.
    [CtoErrorCode.INVALID_STUDY_VERDICT]: { kind: 'UNRESOLVABLE' },
  };

export function resolveChain(errorCode: string): ChainResolution | undefined {
  return PRECONDITION_CHAIN_MAP[errorCode];
}
