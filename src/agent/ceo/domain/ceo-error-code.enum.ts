export enum CeoErrorCode {
  // range 안에 PO_EVAL 의 SUCCEEDED run 이 없음 — CEO 합성의 필수 입력.
  // PM/CTO 는 선택이므로 graceful, PO_EVAL 만 hard requirement.
  NO_PO_EVAL_RUN = 'NO_PO_EVAL_RUN',
  // LLM 출력이 MetaOutput schema 와 안 맞음.
  PARSE_FAILED = 'PARSE_FAILED',
}
