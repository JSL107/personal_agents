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
// 읽기 결과. 색인을 못 읽은 프로젝트를 스냅샷과 갈라서 낸다 — 빈 색인으로 뭉뚱그리면
// 그 프로젝트의 기억 전부가 고아로 판정되어, 청소기가 멀쩡한 색인을 파일 목록으로
// 덮어쓴다(그때 백업에도 빈 내용이 저장되어 되돌릴 수도 없다).
export interface MemoryStoreLoadResult {
  snapshots: MemoryIndexSnapshot[];
  unreadable: { project: string; reason: string }[];
}

export interface MemoryStorePort {
  // 프로젝트별 색인 스냅샷. memory 디렉터리가 없는 프로젝트는 제외한다.
  loadSnapshots(): Promise<MemoryStoreLoadResult>;
  // 청소 직전 통째 백업. 되돌릴 수 없는 쓰기 앞에 두는 유일한 안전장치라,
  // 실패하면 쓰기를 하지 않는다(호출자가 예외를 그대로 전파시킬 것).
  backup(snapshot: MemoryIndexSnapshot): Promise<string>;
  // `expected` 는 스냅샷을 읽던 시점의 색인 내용이다. 쓰기 직전에 실제 파일과 대조해
  // 다르면 쓰지 않는다 — 진단 이후 다른 세션이 추가한 기억을 통째로 덮어써 조용히
  // 잃는 경로(lost update)를 막는다. 파일 락이 아니라 창을 좁히는 것이라 완전하지는 않다.
  writeIndex(
    snapshot: MemoryIndexSnapshot,
    content: string,
    expected: string,
  ): Promise<void>;
  saveState(state: MemoryVacuumState): Promise<void>;
  loadState(): Promise<MemoryVacuumState | null>;
}

export const MEMORY_STORE_PORT = Symbol('MEMORY_STORE_PORT');
