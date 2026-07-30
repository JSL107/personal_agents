import { join } from 'node:path';

export interface EnqueueDeps {
  readonly injectDir: string;
  readonly now: () => number;
  readonly seq: () => string;
  readonly mkdir: (dir: string) => void;
  readonly writeFile: (path: string, data: string) => void;
}

export interface ConsumeDeps {
  readonly injectDir: string;
  readonly readdir: (dir: string) => string[];
  readonly readFile: (path: string) => string | null;
  readonly removeFile: (path: string) => void;
  readonly rmdir: (dir: string) => void;
}

export interface InjectRecordInput {
  readonly instruction: string;
  readonly sessionId: string;
  readonly source: 'claude' | 'codex';
}

interface StoredRecord {
  readonly instruction: string;
  readonly sessionId: string;
  readonly source: 'claude' | 'codex';
  readonly enqueuedAt: number;
}

// pid 로 키잉한 파일 큐에 지시 1건을 기록한다. 지시 1건=파일 1개라 백엔드 쓰기와
// 훅 consume 이 공유 파일 RMW 경쟁을 하지 않는다. 잘못된 입력은 조용히 무시(무해).
export function enqueueInject(
  pid: number,
  record: InjectRecordInput,
  deps: EnqueueDeps,
): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  if (
    typeof record.instruction !== 'string' ||
    record.instruction.length === 0
  ) {
    return false;
  }
  if (typeof record.sessionId !== 'string' || record.sessionId.length === 0) {
    return false;
  }
  const dir = join(deps.injectDir, String(pid));
  deps.mkdir(dir);
  const enqueuedAt = deps.now();
  const stored: StoredRecord = {
    instruction: record.instruction,
    sessionId: record.sessionId,
    source: record.source,
    enqueuedAt,
  };
  deps.writeFile(
    join(dir, `${enqueuedAt}-${deps.seq()}.json`),
    JSON.stringify(stored),
  );
  return true;
}

// pid 큐에서 가장 오래된 sessionId 일치 항목 1건을 consume-once 로 반환한다.
// 불일치/오염 항목은 정리(같은 pid 를 쓰는 살아있는 세션은 유일하므로 죽은 소유자 것 = 삭제 안전).
// 삭제에 실패하면 그 항목은 전달하지 않는다(재전달 루프 방지).
export function consumeInject(
  pid: number,
  sessionId: string,
  deps: ConsumeDeps,
): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return null;
  }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return null;
  }
  const dir = join(deps.injectDir, String(pid));
  let files: string[];
  try {
    files = deps.readdir(dir);
  } catch {
    return null;
  }
  const jsonFiles = files.filter((file) => file.endsWith('.json')).sort();
  let delivered: string | null = null;
  for (const file of jsonFiles) {
    const fullPath = join(dir, file);
    const raw = deps.readFile(fullPath);
    let parsed: unknown = null;
    if (raw !== null) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    const stored = parsed as {
      instruction?: unknown;
      sessionId?: unknown;
    } | null;
    const corrupt = stored === null || typeof stored.instruction !== 'string';
    const mismatch = !corrupt && stored!.sessionId !== sessionId;
    if (corrupt || mismatch) {
      try {
        deps.removeFile(fullPath);
      } catch {
        // 정리 실패는 무해.
      }
      continue;
    }
    try {
      deps.removeFile(fullPath);
    } catch {
      continue;
    }
    delivered = stored!.instruction as string;
    break;
  }
  try {
    deps.rmdir(dir);
  } catch {
    // 비어있지 않으면 실패 — 무해.
  }
  return delivered;
}
