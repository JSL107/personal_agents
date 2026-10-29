import { posix } from 'node:path';

// 압축을 푼 tar(ustar/pax) 의 항목을 해제 전에 검사한다. 시스템 tar 의 기본 거부 동작은 구현마다
// 다르다(bsdtar 는 `..`·심볼릭 링크를 거친 쓰기를 거부하지만 GNU tar 는 `../` 를 떼고 푼다) — 사본 밖에
// 쓰지 않는다는 보장을 tar 종류에 맡기지 않으려고 여기서 먼저 거른다.
//
// GitHub tarball 은 최상위 디렉터리 하나(`<owner>-<repo>-<sha>/`) 아래에 있고 해제 때 그것을 벗긴다
// (`--strip-components 1`). 그래서 경로는 첫 구간을 뗀 뒤 사본 루트 기준으로 판단한다.

const BLOCK = 512;
const HARD_LINK = '1';
const SYMBOLIC_LINK = '2';
const PAX_EXTENDED = 'x';
const PAX_GLOBAL = 'g';
const GNU_LONG_NAME = 'L';
const GNU_LONG_LINK = 'K';

const readString = ({
  block,
  offset,
  length,
}: {
  block: Buffer;
  offset: number;
  length: number;
}): string => {
  const raw = block.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf-8');
};

// "<len> <key>=<value>\n" 레코드 묶음에서 path·linkpath 만 꺼낸다. len 은 레코드 전체 바이트 수다 —
// 값에 줄바꿈이 들어갈 수 있어 줄 단위로 자르면 이름이 짧아져 검사를 비껴간다. 형식이 깨지면 거기서 멈춘다.
const readPaxRecords = (body: Buffer): Map<string, string> => {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    if (space === -1) {
      break;
    }
    // 길이는 10진수만 받는다 — `0x19`·`1e1` 을 받아들이면 bsdtar 가 버리는 레코드를 여기서만 읽어
    // 검사한 이름과 실제로 풀리는 이름이 갈린다. 길이가 1 이상이라 offset 은 매번 늘고 루프는 끝난다.
    const digits = body.subarray(offset, space).toString('ascii');
    const length = Number(digits);
    if (!/^\d+$/.test(digits) || length <= 0) {
      break;
    }
    // 끝의 줄바꿈 한 글자는 레코드 구분자다.
    const record = body
      .subarray(space + 1, offset + length - 1)
      .toString('utf-8');
    const separator = record.indexOf('=');
    if (separator > 0) {
      records.set(record.slice(0, separator), record.slice(separator + 1));
    }
    offset += length;
  }
  return records;
};

// 사본 루트 기준 경로가 루트 안에 머무는가. 빈 경로(최상위 디렉터리 자체)는 루트다.
const staysInside = (rootRelative: string): boolean => {
  const normalized = posix.normalize(rootRelative === '' ? '.' : rootRelative);
  return normalized !== '..' && !normalized.startsWith('../');
};

const stripTopLevel = (path: string): string =>
  path.split('/').slice(1).join('/');

const unsafeReason = ({
  path,
  type,
  linkPath,
}: {
  path: string;
  type: string;
  linkPath: string;
}): string | null => {
  if (path.startsWith('/') || path.split('/').includes('..')) {
    return `경로가 사본 밖을 가리킨다: ${path}`;
  }
  if (type !== HARD_LINK && type !== SYMBOLIC_LINK) {
    return null;
  }
  if (linkPath.startsWith('/')) {
    return `링크 대상이 절대경로다: ${path} -> ${linkPath}`;
  }
  // 하드 링크 대상은 아카이브 안 경로(같은 최상위 디렉터리 포함), 심볼릭 링크 대상은 링크가 있는 디렉터리 기준이다.
  const target =
    type === HARD_LINK
      ? stripTopLevel(linkPath)
      : posix.join(posix.dirname(stripTopLevel(path)), linkPath);
  return staysInside(target)
    ? null
    : `링크 대상이 사본 밖이다: ${path} -> ${linkPath}`;
};

interface TarEntry {
  path: string;
  type: string;
  linkPath: string;
}

interface TarEntries {
  entries: TarEntry[];
  // 헤더를 읽지 못해 거기서 멈췄으면 그 사유. 앞서 읽은 항목은 entries 에 남는다.
  error?: string;
}

const readTarEntries = (tar: Buffer): TarEntries => {
  const entries: TarEntry[] = [];
  let offset = 0;
  // 다음 항목에만 적용되는 긴 이름(pax 'x' · GNU 'L'/'K').
  let pendingPath: string | undefined;
  let pendingLinkPath: string | undefined;
  while (offset + BLOCK <= tar.length) {
    const block = tar.subarray(offset, offset + BLOCK);
    // 끝 표시(0 으로 채운 블록).
    if (block.every((byte) => byte === 0)) {
      break;
    }
    const size = parseInt(
      readString({ block, offset: 124, length: 12 }).trim() || '0',
      8,
    );
    if (Number.isNaN(size)) {
      return { entries, error: `tar 헤더를 읽지 못했다 (offset ${offset})` };
    }
    const type = readString({ block, offset: 156, length: 1 });
    const bodyStart = offset + BLOCK;
    const body = tar.subarray(bodyStart, bodyStart + size);
    offset = bodyStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === PAX_EXTENDED) {
      const records = readPaxRecords(body);
      pendingPath = records.get('path') ?? pendingPath;
      pendingLinkPath = records.get('linkpath') ?? pendingLinkPath;
      continue;
    }
    if (type === PAX_GLOBAL) {
      continue;
    }
    if (type === GNU_LONG_NAME || type === GNU_LONG_LINK) {
      const value = readString({ block: body, offset: 0, length: body.length });
      if (type === GNU_LONG_NAME) {
        pendingPath = value;
      } else {
        pendingLinkPath = value;
      }
      continue;
    }

    const name = readString({ block, offset: 0, length: 100 });
    const prefix = readString({ block, offset: 345, length: 155 });
    const path = pendingPath ?? (prefix === '' ? name : `${prefix}/${name}`);
    const linkPath =
      pendingLinkPath ?? readString({ block, offset: 157, length: 100 });
    pendingPath = undefined;
    pendingLinkPath = undefined;
    entries.push({ path, type, linkPath });
  }
  return { entries };
};

/** 위험한 항목의 사유 목록. 비어 있으면 풀어도 된다. 형식을 읽지 못하면 그 사실도 사유로 낸다. */
export const findUnsafeTarEntries = ({ tar }: { tar: Buffer }): string[] => {
  const { entries, error } = readTarEntries(tar);
  const reasons = entries
    .map((entry) => unsafeReason(entry))
    .filter((reason): reason is string => reason !== null);
  return error === undefined ? reasons : [...reasons, error];
};

/** 아카이브에 적힌 그대로의 항목 경로(최상위 디렉터리 포함). 해제 때 특정 항목을 뺄 이름으로 쓴다. */
export const listTarEntryNames = ({ tar }: { tar: Buffer }): string[] =>
  readTarEntries(tar).entries.map((entry) => entry.path);

/** 사본 루트 기준 경로 — 해제 때 벗기는 최상위 디렉터리를 뗀다. */
export const toSnapshotRelativePath = (path: string): string =>
  stripTopLevel(path);
