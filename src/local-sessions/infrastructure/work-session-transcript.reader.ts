import {
  closeSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import {
  parseClaudeTranscript,
  parseCodexRollout,
  WORK_SESSION_FILE_TAIL_BYTES,
  WORK_SESSION_MAX_FILES,
  WorkSessionDigest,
} from '../domain/work-session-digest';

export interface ReadWorkSessionsParams {
  readonly claudeProjectsDir: string;
  readonly codexSessionsDir: string;
  readonly since: Date;
}

const CLAUDE_SESSION_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const CODEX_ROLLOUT_NAME = /^rollout-.*\.jsonl$/;
const FIRST_LINE_MAX_BYTES = 64 * 1024;

// 파싱 전 후보 — 수정 시각만 먼저 모아 최근 것부터 상한까지만 연다.
interface SessionFileCandidate {
  readonly modifiedAtMs: number;
  readonly parse: () => WorkSessionDigest | null;
}

export const readWorkSessionDigests = ({
  claudeProjectsDir,
  codexSessionsDir,
  since,
}: ReadWorkSessionsParams): WorkSessionDigest[] => {
  try {
    if (Number.isNaN(since.getTime())) {
      return [];
    }
    const candidates = [
      ...listClaudeCandidates(claudeProjectsDir, since),
      ...listCodexCandidates(codexSessionsDir, since),
    ]
      .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)
      .slice(0, WORK_SESSION_MAX_FILES);
    const digests: WorkSessionDigest[] = [];
    for (const candidate of candidates) {
      try {
        const digest = candidate.parse();
        if (digest) {
          digests.push(digest);
        }
      } catch (error) {
        void error;
      }
    }
    return digests;
  } catch (error) {
    void error;
    return [];
  }
};

const listClaudeCandidates = (
  projectsDir: string,
  since: Date,
): SessionFileCandidate[] => {
  const root = safeRealpath(projectsDir);
  if (!root) {
    return [];
  }
  const candidates: SessionFileCandidate[] = [];
  for (const projectDirectory of listDirectories(root, root)) {
    for (const filename of listFiles(projectDirectory, root)) {
      if (!CLAUDE_SESSION_NAME.test(filename)) {
        continue;
      }
      const path = join(projectDirectory, filename);
      const modifiedAtMs = recentRegularFileModifiedAt(path, root, since);
      if (modifiedAtMs === null) {
        continue;
      }
      const sessionId = filename.slice(0, -'.jsonl'.length);
      candidates.push({
        modifiedAtMs,
        parse: () => parseClaudeTranscript(readLines(path), since, sessionId),
      });
    }
  }
  return candidates;
};

const listCodexCandidates = (
  sessionsDir: string,
  since: Date,
): SessionFileCandidate[] => {
  const root = safeRealpath(sessionsDir);
  if (!root) {
    return [];
  }
  // 날짜 폴더로 거르지 않는다 — Codex 는 세션을 시작한 날짜 폴더에 계속 기록해서,
  // 2주 전에 연 Desktop 세션이 오늘까지 쓰인다(2026-10-15 실측: 09/29 폴더의 82MB 파일).
  // 기간 판정은 파일 mtime 과 레코드 timestamp 가 맡는다.
  const candidates: SessionFileCandidate[] = [];
  for (const yearDirectory of listDirectories(root, root)) {
    if (!/^\d{4}$/.test(yearDirectory.slice(-4))) {
      continue;
    }
    for (const monthDirectory of listDirectories(yearDirectory, root)) {
      if (!/^(0[1-9]|1[0-2])$/.test(monthDirectory.slice(-2))) {
        continue;
      }
      for (const dayDirectory of listDirectories(monthDirectory, root)) {
        if (!/^([0-2]\d|3[0-1])$/.test(dayDirectory.slice(-2))) {
          continue;
        }
        for (const filename of listFiles(dayDirectory, root)) {
          if (!CODEX_ROLLOUT_NAME.test(filename)) {
            continue;
          }
          const path = join(dayDirectory, filename);
          const modifiedAtMs = recentRegularFileModifiedAt(path, root, since);
          if (modifiedAtMs === null) {
            continue;
          }
          candidates.push({
            modifiedAtMs,
            parse: () => parseCodexRollout(readLines(path, true), since),
          });
        }
      }
    }
  }
  return candidates;
};

const listDirectories = (parent: string, root: string): string[] => {
  try {
    return readdirSync(parent)
      .map((name) => join(parent, name))
      .filter((path) => isSafeEntry(path, root, 'directory'));
  } catch (error) {
    void error;
    return [];
  }
};

const listFiles = (parent: string, root: string): string[] => {
  try {
    return readdirSync(parent).filter((name) =>
      isSafeEntry(join(parent, name), root, 'file'),
    );
  } catch (error) {
    void error;
    return [];
  }
};

// 기간 안에 수정된 일반 파일이면 수정 시각, 아니면 null. 읽기 실패도 null.
const recentRegularFileModifiedAt = (
  path: string,
  root: string,
  since: Date,
): number | null => {
  try {
    const file = lstatSync(path);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      file.mtimeMs < since.getTime() ||
      !isWithinRoot(realpathSync(path), root)
    ) {
      return null;
    }
    return file.mtimeMs;
  } catch (error) {
    void error;
    return null;
  }
};

const isSafeEntry = (
  path: string,
  root: string,
  kind: 'directory' | 'file',
): boolean => {
  try {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) {
      return false;
    }
    if (kind === 'directory' && !entry.isDirectory()) {
      return false;
    }
    if (kind === 'file' && !entry.isFile()) {
      return false;
    }
    return isWithinRoot(realpathSync(path), root);
  } catch (error) {
    void error;
    return false;
  }
};

const isWithinRoot = (path: string, root: string): boolean => {
  const difference = relative(root, path);
  return (
    difference !== '..' &&
    !difference.startsWith(`..${sep}`) &&
    !isAbsolute(difference)
  );
};

const safeRealpath = (path: string): string | null => {
  try {
    return realpathSync(path);
  } catch (error) {
    void error;
    return null;
  }
};

const readLines = (path: string, includeCodexMetadata = false): string[] => {
  const size = lstatSync(path).size;
  if (size <= WORK_SESSION_FILE_TAIL_BYTES) {
    return readFileSync(path, 'utf8').split('\n');
  }
  const descriptor = openSync(path, 'r');
  try {
    const tail = Buffer.alloc(WORK_SESSION_FILE_TAIL_BYTES);
    const bytesRead = readSync(
      descriptor,
      tail,
      0,
      tail.length,
      size - tail.length,
    );
    const firstNewline = tail.subarray(0, bytesRead).indexOf(10);
    const lines =
      firstNewline < 0
        ? []
        : tail
            .subarray(firstNewline + 1, bytesRead)
            .toString('utf8')
            .split('\n');
    if (!includeCodexMetadata) {
      return lines;
    }
    const prefix = Buffer.alloc(FIRST_LINE_MAX_BYTES);
    const prefixBytesRead = readSync(descriptor, prefix, 0, prefix.length, 0);
    const metadataEnd = prefix.subarray(0, prefixBytesRead).indexOf(10);
    if (metadataEnd < 0) {
      return lines;
    }
    return [prefix.subarray(0, metadataEnd).toString('utf8'), ...lines];
  } finally {
    closeSync(descriptor);
  }
};
