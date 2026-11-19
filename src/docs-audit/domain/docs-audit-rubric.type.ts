import { DocEdit } from './port/docs-audit.port';

// 평가자가 예/아니오로 답하는 채점 항목. 값은 LLM 출력 스키마의 key 로 그대로 쓰인다.
export enum RubricItemKey {
  FACTUAL = 'factual',
  COMPLETE = 'complete',
  SCOPED = 'scoped',
  CITED = 'cited',
  STYLED = 'styled',
}

export interface RubricItemSpec {
  key: RubricItemKey;
  label: string;
  // 평가자에게 그대로 보여 주는 질문 — "예" 가 좋은 쪽이 되게 쓴다.
  question: string;
  weight: number;
  required: boolean;
}

// LLM 이 채우는 원자료. 점수·통과 여부는 여기서 코드가 계산한다.
export interface RubricItemVerdict {
  key: RubricItemKey;
  passed: boolean;
  evidence: string;
}

export interface RubricScore {
  // 항목이 하나라도 빠지면 false — 0점과 "형식이 깨져 판정 못 함" 을 구별한다.
  judgeable: boolean;
  pass: boolean;
  score: number;
  failedRequired: RubricItemKey[];
  // 실패 항목별 "key(label): 근거" 줄 — 다음 회차 수정 지시로 그대로 넘어간다.
  feedback: string;
}

export interface PrecheckEditsParams {
  fullDoc: string;
  edits: DocEdit[];
}

// 사전검사가 편집을 순서대로 가상 적용하는 동안의 문서와 누적 실패 사유.
export interface PrecheckState {
  content: string;
  reasons: string[];
}

export interface FindVerdictParams {
  items: readonly RubricItemVerdict[];
  key: RubricItemKey;
}
