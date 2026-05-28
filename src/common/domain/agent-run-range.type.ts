// cross-domain 시간 범위 타입 — PO_EVAL(P4) 와 CEO(P5) 모두 동일한 'TODAY' | 'WEEK' 를 사용.
// 도입 plan: docs/superpowers/plans/2026-05-28-context-drift-rnd-plan.md (R&D plan 의 phase
// loop 회고 단위) + workflow-phase-definition.md §5.2 (Weekly Summary CRON 의 range 단위).
export type AgentRunRange = 'TODAY' | 'WEEK';
