import { NotionTask } from '../notion.type';

export const NOTION_CLIENT_PORT = Symbol('NOTION_CLIENT_PORT');

// @notionhq/client Client 인스턴스를 주입하기 위한 DI 토큰. 어댑터 외부 직접 참조 금지.
// `NotionApiClient` 의 생성자에서만 주입받아 테스트 시 mock 으로 교체 가능하게 한다.
export const NOTION_CLIENT_INSTANCE = Symbol('NOTION_CLIENT_INSTANCE');

export interface ListActiveTasksOptions {
  // 미지정 시 NOTION_TASK_DB_IDS env 를 그대로 사용.
  databaseIds?: string[];
  // DB 한 건당 최대 결과 수 (무한 페이지네이션 방지).
  perDatabaseLimit?: number;
  // OPS-6: Notion API 의 last_edited_time on_or_after 필터에 들어갈 ISO 8601 datetime (UTC).
  // 미지정 시 cutoff 적용 안 함 — usecase 가 ConfigService 기준으로 채워 넣는다.
  lastEditedSinceIsoDateTime?: string;
}

// Day-page 블록 변환용 추상 타입. 도메인이 Notion SDK 에 의존하지 않도록 block 종류만 enum 형태로 노출.
// 어댑터가 Notion block 형식 (heading_2 / heading_3 / bulleted_list_item / paragraph / to_do / divider) 으로 변환.
// PRO-2++: bullet / paragraph / todo 3종에 optional `link?: string` — 있으면 전체 text 가 클릭 가능한 링크가 된다.
// http(s) 가 아닌 url 은 어댑터가 plain text 로 fallback 처리 (broken link 회피).
export type NotionPlanBlock =
  | { type: 'heading'; text: string } // heading_2 — "Check in HH:MM" 등
  | { type: 'subheading'; text: string } // heading_3 — "오늘의 할 일" 등
  | { type: 'bullet'; text: string; link?: string }
  | { type: 'paragraph'; text: string; link?: string }
  | { type: 'todo'; text: string; checked?: boolean; link?: string }
  | { type: 'divider' };

export interface FindOrCreateDailyPageOptions {
  databaseId: string;
  title: string;
}

export interface AppendBlocksOptions {
  pageId: string;
  blocks: NotionPlanBlock[];
}

export interface NotionDailyPlanPage {
  pageId: string;
  url: string;
}

export interface NotionClientPort {
  listActiveTasks(options?: ListActiveTasksOptions): Promise<NotionTask[]>;
  // Day-page 조회: title 과 일치하는 기존 page 가 있으면 반환, 없으면 생성 (properties: title 만).
  // /today 는 Check-in 섹션, /worklog 는 Check-out 섹션을 같은 day-page 에 append 하는 방식.
  findOrCreateDailyPage(
    options: FindOrCreateDailyPageOptions,
  ): Promise<NotionDailyPlanPage>;
  // 기존 page 에 block 추가. /today /worklog 가 섹션을 append 하는 용도.
  appendBlocks(options: AppendBlocksOptions): Promise<void>;
}
