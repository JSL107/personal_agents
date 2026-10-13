/**
 * 리뷰 입력에 변경 파일의 기존 테스트 본문(`[기존 테스트]`)을 붙이기 위한 순수 함수들.
 *
 * 왜 필요한가: PR #412 카드 571 은 `backend-role.filter.spec.ts:145` 가 이미 덮고 있던 시나리오를
 * "검증되지 않는다" 로 지적했다. diff 가 480KB 라 뒤로 밀린 spec 이 잘려 모델이 본문을 못 봤다.
 * 파일이 있다는 사실만으로는 안 풀린다 — 그 안에 해당 케이스가 있는지 보려면 본문이 필요하다.
 * 설계: `docs/superpowers/specs/2026-09-08-pr-review-depth-and-learning-design.md` §4 2단계.
 */

// 첨부 본문 합계 상한. 이 레포 spec 중앙값 4,050 bytes 기준 15개 분량(스펙 §4 초깃값, 실측 후 조정).
export const COMPANION_SPEC_MAX_BYTES = 60 * 1024;
// 작은 파일이 많으면 바이트 예산이 차기 전에 조회 수가 커진다 — 개수로도 끊는다.
export const COMPANION_SPEC_MAX_FILES = 20;
// 트리 조회 + 본문 조회 전체에 쓰는 시간. 넘기면 모은 데까지만 싣는다(제약 B — 머지까지 10~20분).
export const COMPANION_SPEC_FETCH_TIMEOUT_MS = 10_000;
export const COMPANION_SPEC_FETCH_CONCURRENCY = 4;
// 블록 머리에 나열하는 생략·미조회 경로 수. 변경 파일이 수백 개면 경로 나열만으로 바이트 예산을 넘는다.
export const COMPANION_SPEC_MAX_LISTED_PATHS = 10;

const JS_SOURCE = /\.[cm]?[jt]sx?$/;
const JS_TEST = /^(.+)\.(?:spec|test)(\.[cm]?[jt]sx?)$/;
const PHP_TEST = /^(.+)Test\.php$/;
const PHP_TEST_DIR = /(?:^|\/)tests?\//;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;

const basename = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1);
const dirname = (path: string): string => {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
};
const stripExtension = (name: string): string => {
  const index = name.lastIndexOf('.');
  return index <= 0 ? name : name.slice(0, index);
};

export const isCompanionTestPath = (path: string): boolean => {
  const name = basename(path);
  return JS_TEST.test(name) || (PHP_TEST.test(name) && PHP_TEST_DIR.test(path));
};

const isJsSource = (path: string): boolean =>
  JS_SOURCE.test(path) &&
  !DECLARATION_FILE.test(path) &&
  !JS_TEST.test(basename(path));
const isPhpSource = (path: string): boolean =>
  path.endsWith('.php') && !PHP_TEST.test(basename(path));

// 가장 긴 이름이 이긴다 — `user.ts` 와 `user.service.ts` 가 같은 폴더에 있으면
// `user.service.spec.ts` 는 뒤쪽 소스의 테스트다.
const longestOwner = (candidates: string[]): string | undefined => {
  const ranked = [...candidates].sort(
    (left, right) =>
      stripExtension(basename(right)).length -
      stripExtension(basename(left)).length,
  );
  if (ranked.length === 0) {
    return undefined;
  }
  return ranked[0];
};

/**
 * 트리의 테스트 파일마다 짝 소스를 정해 소스 → 테스트 목록으로 돌려준다. 규칙은 리뷰 대상
 * 레포 7곳의 트리를 실측해 정했다(2026-10-12, 결과 문서 §1):
 * - JS/TS: 같은 폴더의 `X.spec|test.ext` 와 `X.<주제>.spec|test.ext`(한 소스에 spec 여러 개).
 * - PHP: `tests/` 아래의 `X*Test.php`. 기능 이름으로 쪼갠 `SurveyV3DrawTest.php` 도 `SurveyV3.php` 의 것이다.
 *   같은 길이의 이름이 여러 폴더에 있으면 `tests/` 를 뺀 같은 폴더를 고르고, 그래도 못 고르면 버린다.
 * `__tests__/` 와 `test/*.int.spec.ts` 같은 통합 테스트는 실측상 0건이거나 1:1 짝이 없어 다루지 않는다.
 *
 * ponytail: 파일 이름 휴리스틱이다 — 테스트가 다른 이름의 소스를 검증하면 짝을 못 찾는다.
 */
export const mapTestsToSources = (
  paths: readonly string[],
): Map<string, string[]> => {
  const jsByDir = new Map<string, string[]>();
  const phpByStem = new Map<string, string[]>();
  for (const path of paths) {
    if (isJsSource(path)) {
      const dir = dirname(path);
      jsByDir.set(dir, [...(jsByDir.get(dir) ?? []), path]);
    } else if (isPhpSource(path)) {
      const stem = stripExtension(basename(path));
      phpByStem.set(stem, [...(phpByStem.get(stem) ?? []), path]);
    }
  }

  const testsBySource = new Map<string, string[]>();
  const attach = (source: string, test: string): void => {
    testsBySource.set(source, [...(testsBySource.get(source) ?? []), test]);
  };

  for (const path of paths) {
    const name = basename(path);
    const jsMatch = name.match(JS_TEST);
    if (jsMatch) {
      const stem = jsMatch[1];
      const owner = longestOwner(
        (jsByDir.get(dirname(path)) ?? []).filter((source) => {
          const sourceStem = stripExtension(basename(source));
          return stem === sourceStem || stem.startsWith(`${sourceStem}.`);
        }),
      );
      if (owner !== undefined) {
        attach(owner, path);
      }
      continue;
    }
    const phpMatch = name.match(PHP_TEST);
    if (!phpMatch || !PHP_TEST_DIR.test(path)) {
      continue;
    }
    const stem = phpMatch[1];
    const ownerStem = longestOwner(
      [...phpByStem.keys()]
        .filter((sourceStem) => stem.startsWith(sourceStem))
        .map((sourceStem) => `${sourceStem}.php`),
    );
    if (ownerStem === undefined) {
      continue;
    }
    const sources = phpByStem.get(stripExtension(ownerStem)) ?? [];
    const mirroredDir = dirname(path).replace(PHP_TEST_DIR, (match) =>
      match.startsWith('/') ? '/' : '',
    );
    const owner =
      sources.length === 1
        ? sources[0]
        : sources.find((source) => dirname(source) === mirroredDir);
    if (owner !== undefined) {
      attach(owner, path);
    }
  }
  return testsBySource;
};

/** diff 에서 파일별 바뀐 줄 수(추가 + 삭제). 첨부 순서를 정하는 데 쓴다. */
export const countChangedLines = (diff: string): Map<string, number> => {
  const counts = new Map<string, number>();
  let current: string | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/ b\/(.+)$/);
      current = match ? match[1] : null;
      if (current !== null && !counts.has(current)) {
        counts.set(current, 0);
      }
      continue;
    }
    if (current === null || line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+') || line.startsWith('-')) {
      counts.set(current, (counts.get(current) ?? 0) + 1);
    }
  }
  return counts;
};

export interface CompanionSpecCandidate {
  path: string;
  // 트리가 잘려 경로를 추측한 후보는 크기를 모른다.
  size: number | undefined;
  // 짝 소스(또는 그 spec 자신)의 바뀐 줄 수. 큰 것부터 싣는다.
  weight: number;
}

export interface CompanionSpecSelection {
  candidates: CompanionSpecCandidate[];
  // 예산·개수 상한으로 조회하지 않은 테스트 경로. 트리에서 존재를 확인한 것만 — 추측 경로는 넣지 않는다.
  omitted: string[];
}

/**
 * 변경 파일 → 짝 테스트 후보를 모으고, 바뀐 줄 수가 큰 순으로 예산 안에서 고른다.
 *
 * - diff 에 포함된 spec 도 빼지 않는다 — diff 는 바뀐 hunk 만 보여 나머지 케이스는 안 보인다.
 * - 트리가 잘렸으면 짝을 못 찾은 JS/TS 소스에 `X.spec.ext`·`X.test.ext` 를 추측 후보로 둔다(개별 조회로 확인).
 * - 바뀐 줄 수를 모르는 파일은 0 으로 쳐 뒤로 간다. 호출부는 `pulls.listFiles` 의 파일별 값을 넘긴다 —
 *   잘린 diff 로만 세면 뒤쪽 파일이 전부 0 이 돼 순서가 경로순으로 무너진다(#412).
 */
export const selectCompanionSpecs = ({
  changedPaths,
  changedLines,
  tree,
  treeTruncated,
  maxBytes = COMPANION_SPEC_MAX_BYTES,
  maxFiles = COMPANION_SPEC_MAX_FILES,
}: {
  changedPaths: readonly string[];
  changedLines: ReadonlyMap<string, number>;
  tree: readonly { path: string; size: number }[];
  treeTruncated: boolean;
  maxBytes?: number;
  maxFiles?: number;
}): CompanionSpecSelection => {
  const sizes = new Map(tree.map((entry) => [entry.path, entry.size]));
  const testsBySource = mapTestsToSources(tree.map((entry) => entry.path));
  const byPath = new Map<string, CompanionSpecCandidate>();
  const add = (path: string, weight: number): void => {
    const found = byPath.get(path);
    if (found !== undefined) {
      found.weight = Math.max(found.weight, weight);
      return;
    }
    byPath.set(path, { path, size: sizes.get(path), weight });
  };

  for (const changed of changedPaths) {
    const weight = changedLines.get(changed) ?? 0;
    if (isCompanionTestPath(changed)) {
      // 삭제된 테스트는 head 트리에 없다. 잘린 트리에서는 있는지 알 수 없어 조회로 확인한다.
      if (sizes.has(changed) || treeTruncated) {
        add(changed, weight);
      }
      continue;
    }
    const tests = testsBySource.get(changed) ?? [];
    for (const test of tests) {
      add(test, weight);
    }
    if (tests.length === 0 && treeTruncated && isJsSource(changed)) {
      const dir = dirname(changed);
      const name = basename(changed);
      const stem = stripExtension(name);
      const extension = name.slice(stem.length);
      const prefix = dir.length > 0 ? `${dir}/` : '';
      add(`${prefix}${stem}.spec${extension}`, weight);
      add(`${prefix}${stem}.test${extension}`, weight);
    }
  }

  const ranked = [...byPath.values()].sort(
    (left, right) =>
      right.weight - left.weight || left.path.localeCompare(right.path),
  );
  const candidates: CompanionSpecCandidate[] = [];
  const omitted: string[] = [];
  let reservedBytes = 0;
  for (const candidate of ranked) {
    const size = candidate.size ?? 0;
    if (candidates.length >= maxFiles || reservedBytes + size > maxBytes) {
      // 크기를 모르는 후보는 잘린 트리에서 경로를 추측한 것이라 있는지조차 모른다. "생략했지만 테스트는 있다"
      // 로 적으면 없는 테스트를 있다고 단정하게 된다 — 트리가 잘렸다는 안내가 이미 따로 나간다.
      if (candidate.size !== undefined) {
        omitted.push(candidate.path);
      }
      continue;
    }
    candidates.push(candidate);
    reservedBytes += size;
  }
  return { candidates, omitted };
};

export interface CompanionSpecFile {
  path: string;
  content: string;
}

export interface AssembledCompanionSpecs {
  text: string;
  bytes: number;
  includedPaths: string[];
  omittedPaths: string[];
}

const numbered = (content: string): string =>
  content
    .split('\n')
    .map((text, index) => `${index + 1}: ${text}`)
    .join('\n');

/**
 * 읽어 온 테스트를 줄 번호와 함께 이어 붙인다. 예산을 넘는 파일은 통째로 빼고 다음 파일로 넘어간다 —
 * 파일 중간에서 자르면 "이 케이스가 없다" 를 판단할 근거가 반쪽이 된다.
 */
export const assembleCompanionSpecs = (
  files: readonly CompanionSpecFile[],
  maxBytes: number = COMPANION_SPEC_MAX_BYTES,
): AssembledCompanionSpecs => {
  const parts: string[] = [];
  const includedPaths: string[] = [];
  const omittedPaths: string[] = [];
  let used = 0;
  for (const file of files) {
    const fileBytes = Buffer.byteLength(file.content, 'utf-8');
    const piece = `### ${file.path} (전체 ${fileBytes} bytes)\n${numbered(file.content)}\n\n`;
    const size = Buffer.byteLength(piece, 'utf-8');
    if (used + size > maxBytes) {
      omittedPaths.push(file.path);
      continue;
    }
    parts.push(piece);
    includedPaths.push(file.path);
    used += size;
  }
  return {
    text: parts.join('').trimEnd(),
    bytes: used,
    includedPaths,
    omittedPaths,
  };
};
