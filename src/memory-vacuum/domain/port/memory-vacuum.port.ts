import { VacuumOutcome } from '../memory-index.type';
import { MemoryVacuumState } from './memory-store.port';

export interface RunMemoryVacuumInput {
  // false 면 진단만 하고 파일을 쓰지 않는다(수동 확인·회귀 검증용).
  apply: boolean;
}

export interface MemoryVacuumOutcome {
  outcomes: VacuumOutcome[];
  // 백업 실패·쓰기 실패로 청소를 못 한 프로젝트. 조용한 0건과 구분하려면 이유가 필요하다.
  failures: { project: string; reason: string }[];
}

export interface MemoryVacuumPort {
  run(input: RunMemoryVacuumInput): Promise<MemoryVacuumOutcome>;
  // 마지막 청소 실태. 관제 화면 전용 — 한 번도 안 돌았으면 null.
  lastState(): Promise<MemoryVacuumState | null>;
}

export const MEMORY_VACUUM_PORT = Symbol('MEMORY_VACUUM_PORT');
