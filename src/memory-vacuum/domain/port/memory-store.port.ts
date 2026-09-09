import { MemoryIndexSnapshot } from '../memory-index.type';

// 마지막 청소 실태. 관제 화면이 이 한 장만 읽는다 — 스냅샷마다 프로젝트 전체를
// 다시 훑으면(파일 수백 개) 장식용 조회 하나가 화면 전체를 죽인다.
export interface MemoryVacuumState {
  ranAtIso: string;
  projectCount: number;
  cleanedCount: number; // 이번 회차에 청소기가 실제로 치운 건수
  pendingProjects: number; // 청소 뒤에도 초과라 사람 판단이 필요한 프로젝트 수
}

// 세션 기억 저장소 접근 포트. 구현은 로컬 파일시스템(~/.claude/projects/*/memory)이지만,
// 도메인은 "스냅샷을 읽고 색인을 쓴다" 만 안다.
export interface MemoryStorePort {
  // 프로젝트별 색인 스냅샷. memory 디렉터리가 없는 프로젝트는 제외한다.
  loadSnapshots(): Promise<MemoryIndexSnapshot[]>;
  // 청소 직전 통째 백업. 되돌릴 수 없는 쓰기 앞에 두는 유일한 안전장치라,
  // 실패하면 쓰기를 하지 않는다(호출자가 예외를 그대로 전파시킬 것).
  backup(snapshot: MemoryIndexSnapshot): Promise<string>;
  writeIndex(snapshot: MemoryIndexSnapshot, content: string): Promise<void>;
  saveState(state: MemoryVacuumState): Promise<void>;
  loadState(): Promise<MemoryVacuumState | null>;
}

export const MEMORY_STORE_PORT = Symbol('MEMORY_STORE_PORT');
