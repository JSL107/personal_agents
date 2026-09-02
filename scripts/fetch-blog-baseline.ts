// 문체 기준선 코퍼스를 GitHub 블로그에서 받아온다 — `korean-style-metrics.ts` 의 임계값을
// 다시 잴 때 쓴다.
//
// **사람이 손댄 글만 받는다.** 발행 커밋 하나뿐인 글은 사용자가 통과시킨 것이 아니라 아직
// 손대지 않은 모델 산출물이라, 코퍼스에 섞이면 모델이 만든 값을 목표로 되먹인다. 실제로
// 2026-09-01 발행본(커밋 1개)이 어절 최저값 9.5 를 만들고 있었고, 빼자 하한이 10.9 로
// 올라갔다. 커밋 수는 그 판정의 대용이다 — 발행 커밋 뒤에 무엇이든 붙었다면 사람이 읽고
// 고쳤다는 뜻이다.
//
// 측정은 하지 않는다. 받아 놓기만 하고 `scripts/measure-style.ts` 에 넘긴다 — 그쪽은 네트워크
// 없이 파일만 읽는 순수 측정기이고, 그 성격을 유지하는 편이 둘 다 단순하다.
//
// 사용법:
//   pnpm exec ts-node scripts/fetch-blog-baseline.ts [출력디렉터리]
//   pnpm exec ts-node scripts/measure-style.ts <출력디렉터리>/*.md
//
// `gh` CLI 인증을 그대로 쓴다(공개 저장소라 토큰이 없어도 되지만 rate limit 이 넉넉해진다).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 기본값은 이 사용자의 블로그다. 다른 저장소를 재려면 env 로 덮는다.
// (Nest DI 컨텍스트 밖의 스크립트라 `process.env` 직접 접근이 허용된다 — CODE_RULES §9)
const REPOSITORY = process.env.BLOG_PUBLISH_REPO ?? 'JSL107/JSL107.github.io';
const POSTS_PATH = process.env.BLOG_PUBLISH_PATH_PREFIX ?? 'src/content/posts';
const DEFAULT_OUTPUT_DIRECTORY = '/tmp/blog-baseline';

// 발행 커밋 하나만 있는 글을 걸러내는 문턱. 2 = 발행 + 사람 수정 최소 1회.
//
// **한계: 커밋 수는 「사람이 문체를 고쳤나」의 대용일 뿐이다.** 오타 한 글자만 고친 글도 2가
// 되어 코퍼스에 들어온다. 지금 코퍼스(2026-08 발행분)는 수정 커밋이 전부 문체 교정이라
// 문제가 없지만, 표본이 늘어 값이 흔들리면 여기를 먼저 의심하라 — 변경량으로 거르는 편이
// 정확하다. 지금 그렇게 하지 않는 것은 문턱을 정할 근거가 없기 때문이다.
const MINIMUM_COMMIT_COUNT = 2;

// 오래된 글은 문체가 지금과 다르다. 2022년 글은 코딩테스트 풀이라 산문이 20문장뿐이었고
// 평서체(요체 0%)였다 — 해요체 기준선에 섞으면 안 된다. 파일명 앞의 날짜로 자른다.
const MINIMUM_DATE_PREFIX = process.env.BLOG_BASELINE_SINCE ?? '2026-01-01';

interface PostEntry {
  name: string;
  commitCount: number;
}

const gh = (endpoint: string, jqFilter: string): string =>
  execFileSync('gh', ['api', endpoint, '--jq', jqFilter], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }).trim();

const listMarkdownNames = (): string[] =>
  gh(
    `repos/${REPOSITORY}/contents/${POSTS_PATH}`,
    '.[] | select(.name | endswith(".md")) | .name',
  )
    .split('\n')
    .filter((name) => name.length > 0)
    .filter((name) => name >= MINIMUM_DATE_PREFIX)
    .sort();

// per_page 를 문턱에 맞춰 잘라 받는다. 커밋이 몇 개인지가 아니라 "문턱을 넘겼는가" 만
// 알면 되므로, 수정이 많이 붙은 글에서 목록을 통째로 받아 올 이유가 없다.
const countCommits = (name: string): number =>
  Number(
    gh(
      `repos/${REPOSITORY}/commits?path=${POSTS_PATH}/${name}&per_page=${MINIMUM_COMMIT_COUNT}`,
      'length',
    ),
  );

const fetchBody = (name: string): string =>
  Buffer.from(
    gh(`repos/${REPOSITORY}/contents/${POSTS_PATH}/${name}`, '.content'),
    'base64',
  ).toString('utf8');

const main = (): void => {
  const outputDirectory = process.argv[2] ?? DEFAULT_OUTPUT_DIRECTORY;
  mkdirSync(outputDirectory, { recursive: true });

  const names = listMarkdownNames();
  const entries: PostEntry[] = names.map((name) => ({
    name,
    commitCount: countCommits(name),
  }));

  const edited = entries.filter(
    (entry) => entry.commitCount >= MINIMUM_COMMIT_COUNT,
  );
  const skipped = entries.filter(
    (entry) => entry.commitCount < MINIMUM_COMMIT_COUNT,
  );

  for (const entry of edited) {
    writeFileSync(join(outputDirectory, entry.name), fetchBody(entry.name));
  }

  console.log(`기준선 코퍼스: ${edited.length}편 → ${outputDirectory}`);
  if (skipped.length > 0) {
    // 무엇이 왜 빠졌는지 남긴다. 표본이 갑자기 줄면 이 줄이 먼저 답을 준다.
    console.log(
      `제외 ${skipped.length}편(발행 후 미수정): ${skipped
        .map((entry) => entry.name)
        .join(', ')}`,
    );
  }
  console.log(
    `\n다음: pnpm exec ts-node scripts/measure-style.ts ${outputDirectory}/*.md`,
  );
};

main();
