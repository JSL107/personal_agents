// cross-domain 시간 범위 타입 — PO_EVAL(P4) 와 CEO(P5) 모두 동일한 'TODAY' | 'WEEK' 를 사용.
// 각 도메인 type 파일의 EvaluationRange / MetaRange 는 이 타입의 alias (호환성 유지).
export type AgentRunRange = 'TODAY' | 'WEEK';
