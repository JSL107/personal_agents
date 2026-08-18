/* PR #54 의 자식 페이지 패턴 검증 — 부모 페이지 아래 "YYYY-MM-DD (요일)" 자식 페이지 생성/조회 + append.
 *
 * 사용 (.env 로딩은 Node 22 내장 --env-file 사용 — dotenv 파서 직접 구현 X):
 *   node --env-file=.env -r ts-node/register/transpile-only scripts/check-notion-child-page.ts
 *
 * 부작용:
 *   1. 오늘 날짜의 자식 페이지 (예: "2026-06-01 (월)") 가 없으면 생성.
 *   2. 같은 호출을 두 번 — 두 번째는 같은 자식 페이지 재사용 (생성 X).
 *   3. 자식 페이지에 divider + paragraph append.
 */
import { Client } from '@notionhq/client';

const PARENT_PAGE_ID = '34b69cbba394807588c4e2e5b95f4be9';

// KST 기준 "YYYY-MM-DD (요일)". ko-KR 의 weekday:'short' 는 "금" 한 글자라 별도 절단 불필요.
const buildDailyTitle = (): string => {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const weekday = new Intl.DateTimeFormat('ko-KR', {
    weekday: 'short',
    timeZone: 'Asia/Seoul',
  }).format(now);
  return `${date} (${weekday})`;
};

const findChildPageIdByTitle = async (
  client: Client,
  parentId: string,
  title: string,
): Promise<string | null> => {
  let cursor: string | undefined;
  do {
    const response = await client.blocks.children.list({
      block_id: parentId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const child of response.results) {
      if (
        'type' in child &&
        child.type === 'child_page' &&
        'child_page' in child &&
        (child.child_page as { title?: string } | undefined)?.title === title
      ) {
        return child.id;
      }
    }
    cursor =
      response.has_more && response.next_cursor
        ? response.next_cursor
        : undefined;
  } while (cursor !== undefined);
  return null;
};

type ChildPageResult = {
  id: string;
  created: boolean;
};

const findOrCreateChildPage = async (
  client: Client,
  parentId: string,
  title: string,
): Promise<ChildPageResult> => {
  const found = await findChildPageIdByTitle(client, parentId, title);
  if (found) {
    return { id: found, created: false };
  }
  const created = await client.pages.create({
    parent: { page_id: parentId },
    properties: {
      title: { title: [{ text: { content: title } }] },
    },
  });
  return { id: created.id, created: true };
};

const main = async (): Promise<void> => {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error('NOTION_TOKEN 미설정 — --env-file=.env 를 붙였는지 확인');
  }
  const client = new Client({ auth: token });

  const title = buildDailyTitle();
  console.log(`[1/3] 오늘 KST 자식 페이지 title: "${title}"`);

  console.log(
    `[2/3] findOrCreateChildPage(parent=${PARENT_PAGE_ID}, title="${title}")`,
  );
  const first = await findOrCreateChildPage(client, PARENT_PAGE_ID, title);
  console.log(
    `     ✅ ${first.created ? '신규 생성' : '기존 재사용'} — pageId=${first.id}`,
  );

  console.log(`[3/3] 동일 title 두 번째 호출 — 멱등성 (재사용) 검증`);
  const second = await findOrCreateChildPage(client, PARENT_PAGE_ID, title);
  if (second.created) {
    throw new Error(
      `멱등성 깨짐 — 두 번째 호출에서 신규 생성됨 (id=${second.id})`,
    );
  }
  if (second.id !== first.id) {
    throw new Error(
      `멱등성 깨짐 — 다른 페이지 id (first=${first.id}, second=${second.id})`,
    );
  }
  console.log(`     ✅ 같은 pageId 재사용 (멱등성 OK)`);

  console.log(`[append] 자식 페이지에 divider + paragraph 적재`);
  await client.blocks.children.append({
    block_id: first.id,
    children: [
      { object: 'block', type: 'divider', divider: {} },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: `✅ 자식 페이지 패턴 검증 — ${new Date().toISOString()}`,
              },
            },
          ],
        },
      },
    ],
  });
  console.log(`     ✅ append OK\n`);
  console.log(
    `결론: 부모 "${PARENT_PAGE_ID}" 아래 일별 자식 페이지 "${title}" — 생성/조회/append 모두 동작.`,
  );
  console.log(
    `\nNotion 페이지를 새로고침하면 부모 페이지에 "${title}" 자식 페이지가 보이고, 그 안에 검증 라인이 누적됩니다.`,
  );
};

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n❌ 실패: ${message}`);
  process.exit(1);
});
