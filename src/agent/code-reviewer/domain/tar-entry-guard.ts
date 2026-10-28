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

// "<len> <key>=<value>\n" 레코드 묶음에서 path·linkpath 만 꺼낸다.
const readPaxRecords = (body: Buffer): Map<string, string> => {
  const records = new Map<string, string>();
  for (const line of body.toString('utf-8').split('\n')) {
    const match = /^\d+ ([^=]+)=(.*)$/.exec(line);
    if (match !== null) {
      records.set(match[1], match[2]);
    }
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

/** 위험한 항목의 사유 목록. 비어 있으면 풀어도 된다. 형식을 읽지 못하면 그 사실도 사유로 낸다. */
export const findUnsafeTarEntries = ({ tar }: { tar: Buffer }): string[] => {
  const reasons: string[] = [];
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
      reasons.push(`tar 헤더를 읽지 못했다 (offset ${offset})`);
      break;
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

    const reason = unsafeReason({ path, type, linkPath });
    if (reason !== null) {
      reasons.push(reason);
    }
  }
  return reasons;
};
