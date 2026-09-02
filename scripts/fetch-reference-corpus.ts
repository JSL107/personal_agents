// 한국 기술 블로그 글을 RSS 로 받아 참조 코퍼스를 만든다 — 우리 글이 **닮아가려는 목표**다.
//
// `fetch-blog-baseline.ts` 와 역할이 다르다. 그쪽은 사용자가 손봐서 통과시킨 우리 글을 받아
// **방어선**(이 아래로 떨어지면 잘못)을 세운다. 이쪽은 남의 글을 받아 **목표**(이쪽으로 가고
// 싶다)를 세운다. 두 기준은 값이 다르고, 다른 것이 정상이다 — 실측(2026-09-02)상 길이 편차는
// 우리 최종본 23.5 vs 기술 블로그 28.5~37.7 이다.
//
// **목표를 방어선 자리에 넣지 마라.** 남의 글 수치로 우리 글을 실패 판정하면 사용자가 통과시킨
// 글이 목표 밖으로 찍히고, 그 지적이 되먹임을 타고 프롬프트로 들어간다. 이 파일이 2026-08-26 에
// 겪은 사고가 정확히 그것이다(`korean-style-metrics.ts` 헤더).
//
// 사용법:
//   pnpm exec ts-node scripts/fetch-reference-corpus.ts [출력디렉터리]
//   pnpm exec ts-node scripts/measure-style.ts <출력디렉터리>/*.md
//
// 수집이 되는 곳만 담았다(2026-09-02 확인). 카카오는 RSS 에 본문이 없고(요약만), Medium 을 쓰는
// 곳(당근·쿠팡·무신사)은 RSS 요청에 HTML 을 돌려주며, 컬리는 403 이다. 브라우저 User-Agent 는
// 필수다 — 없으면 우아한형제들이 403 으로 막힌다.
//
// **RSS 는 최신 N 편만 준다.** 같은 스크립트가 09-02 오전 55편 · 오후 60편을 받았다. 값을
// 인용할 때 편수를 근거로 적지 말고 수집 시점을 적어라 — 편수는 재현되지 않는다.
//
// **아래 변환은 근사라 표·복잡한 마크업에서 문장 축이 오염된다.** 네이버 D2 회차에서 표와 코드가
// 한 문장으로 붙어 편차 228 · 최장 4,393자가 나온 적이 있다(정상 범위는 28~38). 문장 길이·편차
// 를 인용하기 전에 최장 값을 보고 이상치를 걸러라. 소제목 수·분량 같은 구성 축은 문장 분해와
// 무관해 그 회차에도 멀쩡했다.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 옛 산출물을 지우고 시작한다. 대상이 줄어든 회차에서 지난번 `.md` 가 남으면 다음 측정이
// glob 으로 그것까지 집어 들어, 코퍼스에 없는 글이 기준값에 섞인다.
// 디렉터리를 통째로 지우지 않고 `.md` 만 지운다 — 인자로 받은 경로라 사용자가 다른 것을
// 가리켰을 때 그 안의 다른 파일까지 날리면 안 된다.
const clearMarkdown = (directory: string): void => {
  for (const name of readdirSync(directory)) {
    if (name.endsWith('.md')) {
      rmSync(join(directory, name));
    }
  }
};

interface ReferenceFeed {
  name: string;
  url: string;
  // 해요체로 쓰는 블로그. 우리 블로그가 해요체라 문체(어투·종결어미) 목표는 이쪽에서만 나온다.
  // 구성(소제목 밀도·전개)은 문체와 무관하므로 평서체 블로그도 함께 본다.
  politeStyle: boolean;
}

const FEEDS: readonly ReferenceFeed[] = [
  { name: 'toss', url: 'https://toss.tech/rss.xml', politeStyle: true },
  {
    name: 'woowahan',
    url: 'https://techblog.woowahan.com/feed/',
    politeStyle: false,
  },
  { name: 'naver-d2', url: 'https://d2.naver.com/d2.atom', politeStyle: false },
  {
    name: 'hyperconnect',
    url: 'https://hyperconnect.github.io/feed.xml',
    politeStyle: false,
  },
];

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// 산문이 이만큼도 안 되는 항목은 공지·링크 모음이라 문체 표본이 되지 않는다.
const MINIMUM_BODY_LENGTH = 800;

const DEFAULT_OUTPUT_DIRECTORY = '/tmp/reference-corpus';

const HTML_ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
  '&amp;': '&',
};

const decodeEntities = (text: string): string =>
  // `&amp;` 를 마지막에 풀어야 `&amp;lt;` 가 `<` 로 두 번 풀리지 않는다.
  Object.entries(HTML_ENTITIES).reduce(
    (acc, [entity, char]) => acc.split(entity).join(char),
    text,
  );

const stripCdata = (text: string): string =>
  text.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');

/**
 * HTML 본문을 마크다운으로 근사 변환한다.
 *
 * 완벽한 변환이 목적이 아니다 — 문장 분해기(`extractProseSentences`)가 산문만 골라낼 수 있으면
 * 충분하다. 코드는 펜스로 감싸 **산문 측정에서 빠지게** 하는 것이 핵심이다. 감싸지 않으면
 * 코드 한 줄이 문장으로 세어져 평균·최장이 통째로 왜곡된다.
 */
const htmlToMarkdown = (html: string): string => {
  const withFences = html
    .replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, '\n```\ncode\n```\n')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/g, '`$1`')
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g,
      (_match, level: string, inner: string) =>
        `\n${'#'.repeat(Number(level))} ${inner}\n`,
    )
    .replace(/<\/p>|<br\s*\/?>/g, '\n\n')
    .replace(/<li[^>]*>/g, '\n- ')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(withFences)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

interface ReferencePost {
  title: string;
  body: string;
}

// RSS(`<item>` + `<content:encoded>`)와 Atom(`<entry>` + `<content>`)을 모두 받는다.
// 네이버 D2 만 Atom 이라 한쪽만 지원하면 표본이 통째로 빠진다.
const parseFeed = (xml: string): ReferencePost[] => {
  const posts: ReferencePost[] = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [];
  for (const block of blocks) {
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const bodyMatch =
      block.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/) ??
      block.match(/<content[^>]*>([\s\S]*?)<\/content>/);
    if (!bodyMatch) {
      continue;
    }
    // 여기서 디코딩하지 않는다. `htmlToMarkdown` 이 태그를 지운 **뒤에** 한 번만 푼다 —
    // 먼저 풀면 본문에 인용된 `&lt;div&gt;` 같은 예시가 진짜 태그가 되어 통째로 지워지고,
    // 그만큼 참조 코퍼스의 문체 지표가 왜곡된다.
    const body = htmlToMarkdown(stripCdata(bodyMatch[1]));
    if (body.length < MINIMUM_BODY_LENGTH) {
      continue;
    }
    posts.push({
      title: titleMatch ? stripCdata(titleMatch[1]).trim() : '(제목 없음)',
      body,
    });
  }
  return posts;
};

const fetchFeed = async (feed: ReferenceFeed): Promise<ReferencePost[]> => {
  const response = await fetch(feed.url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    // 한 곳이 막혀도 나머지는 받는다. 표본이 줄어든 것을 모르고 지나가지 않게 이유를 남긴다.
    console.warn(`${feed.name}: HTTP ${response.status} — 건너뛴다`);
    return [];
  }
  return parseFeed(await response.text());
};

const main = async (): Promise<void> => {
  const outputDirectory = process.argv[2] ?? DEFAULT_OUTPUT_DIRECTORY;
  mkdirSync(outputDirectory, { recursive: true });
  clearMarkdown(outputDirectory);

  let total = 0;
  for (const feed of FEEDS) {
    const posts = await fetchFeed(feed);
    posts.forEach((post, index) => {
      const fileName = `${feed.name}-${String(index + 1).padStart(2, '0')}.md`;
      writeFileSync(
        join(outputDirectory, fileName),
        `# ${post.title}\n\n${post.body}\n`,
      );
    });
    total += posts.length;
    const styleLabel = feed.politeStyle ? '해요체' : '평서체';
    console.log(`${feed.name}(${styleLabel}): ${posts.length}편`);
  }

  console.log(`\n참조 코퍼스: ${total}편 → ${outputDirectory}`);
  console.log(
    `다음: pnpm exec ts-node scripts/measure-style.ts ${outputDirectory}/*.md`,
  );
};

void main();
