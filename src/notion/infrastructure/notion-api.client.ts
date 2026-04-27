import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@notionhq/client';
import { match } from 'ts-pattern';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import { NotionException } from '../domain/notion.exception';
import { NotionTask } from '../domain/notion.type';
import { NotionErrorCode } from '../domain/notion-error-code.enum';
import {
  AppendBlocksOptions,
  FindOrCreateDailyPageOptions,
  ListActiveTasksOptions,
  NOTION_CLIENT_INSTANCE,
  NotionClientPort,
  NotionDailyPlanPage,
  NotionPlanBlock,
  ReplaceCheckInSectionOptions,
} from '../domain/port/notion-client.port';

const DEFAULT_PER_DB_LIMIT = 50;

// Notion blocks.children.append API 한 요청당 최대 100 child block — 이 이상은 분할 append.
// codex review bcpccaqik P2 지적 대응.
const APPEND_BLOCKS_CHUNK_SIZE = 100;

@Injectable()
export class NotionApiClient implements NotionClientPort {
  private readonly logger = new Logger(NotionApiClient.name);

  // 동일 (databaseId|title) 에 대한 동시 findOrCreate 를 직렬화하는 in-process mutex.
  // codex review bcpccaqik P2: Slack retry / /today + /worklog 동시 호출 시 중복 page 생성 방지.
  // 멀티-instance 배포 시에는 post-create dedupe 가 추가로 필요하나 현재 싱글 프로세스 전제.
  private readonly dayPageLocks = new Map<
    string,
    Promise<NotionDailyPlanPage>
  >();

  // 같은 pageId 에 대한 동시 replaceCheckInSection 을 직렬화 — 두 /today 가 같은 시점에
  // 들어오면 둘 다 동일 초기 state 를 읽고 각자 append 해 Check in 섹션이 두 개 남는 race
  // 방지 (codex review aaed1c2 P2 지적).
  private readonly checkInLocks = new Map<string, Promise<void>>();

  constructor(
    @Inject(NOTION_CLIENT_INSTANCE) private readonly client: Client | null,
    private readonly configService: ConfigService,
  ) {}

  async listActiveTasks({
    databaseIds,
    perDatabaseLimit = DEFAULT_PER_DB_LIMIT,
    lastEditedSinceIsoDateTime,
  }: ListActiveTasksOptions = {}): Promise<NotionTask[]> {
    if (!this.client) {
      throw new NotionException({
        code: NotionErrorCode.TOKEN_NOT_CONFIGURED,
        message:
          'NOTION_TOKEN 이 .env 에 설정되지 않아 Notion API 호출이 불가합니다.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }

    const targetDbs = databaseIds ?? this.resolveDatabaseIdsFromEnv();
    if (targetDbs.length === 0) {
      // 토큰은 있지만 DB ID 가 없으면 빈 결과 — graceful (PM 이 그냥 없는 입력으로 처리).
      return [];
    }

    const tasks: NotionTask[] = [];
    for (const databaseId of targetDbs) {
      const response = await this.queryDbOrNull(
        databaseId,
        perDatabaseLimit,
        lastEditedSinceIsoDateTime,
      );
      if (!response) {
        continue;
      }
      for (const page of response.results) {
        if (!isFullPage(page)) {
          continue;
        }
        tasks.push(this.toNotionTask(page, databaseId));
      }
    }

    return tasks;
  }

  // 한 DB 가 권한 미부여 / not_found 면 null 반환 — 다른 DB 는 계속 (listActiveTasks 안에서 skip).
  // try/catch + null 패턴을 별도 helper 로 추출해 caller 가 let 없이 const 로 받게 한다.
  // OPS-6: lastEditedSinceIsoDateTime 이 있으면 last_edited_time timestamp filter 추가 — long-tail 컷.
  private async queryDbOrNull(
    databaseId: string,
    perDatabaseLimit: number,
    lastEditedSinceIsoDateTime?: string,
  ): Promise<Awaited<ReturnType<Client['databases']['query']>> | null> {
    try {
      return await this.client!.databases.query({
        database_id: databaseId,
        page_size: perDatabaseLimit,
        ...(lastEditedSinceIsoDateTime
          ? {
              filter: {
                timestamp: 'last_edited_time' as const,
                last_edited_time: { on_or_after: lastEditedSinceIsoDateTime },
              },
            }
          : {}),
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Notion DB ${databaseId} 조회 실패 (skip): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  async findOrCreateDailyPage({
    databaseId,
    title,
  }: FindOrCreateDailyPageOptions): Promise<NotionDailyPlanPage> {
    this.assertClientConfigured('findOrCreateDailyPage');

    // 같은 (databaseId, title) 요청이 동시에 들어오면 in-process mutex 로 직렬화.
    const lockKey = `${databaseId}|${title}`;
    const pending = this.dayPageLocks.get(lockKey);
    if (pending) {
      return pending;
    }
    const work = this.resolveDayPage(databaseId, title).finally(() => {
      this.dayPageLocks.delete(lockKey);
    });
    this.dayPageLocks.set(lockKey, work);
    return work;
  }

  // mutex 안에서 실제 Notion 호출 수행. 기존 page 있으면 재사용, 없으면 create + post-create dedupe.
  private async resolveDayPage(
    databaseId: string,
    title: string,
  ): Promise<NotionDailyPlanPage> {
    const titlePropertyName = await this.resolveTitlePropertyName(databaseId);

    const existing = await this.queryByTitle(
      databaseId,
      titlePropertyName,
      title,
    );
    if (existing) {
      return existing;
    }

    try {
      const response = await this.client!.pages.create({
        parent: { database_id: databaseId },
        properties: {
          [titlePropertyName]: {
            title: [{ text: { content: title } }],
          },
        },
      });
      const pageId = typeof response.id === 'string' ? response.id : '';
      const url =
        'url' in response && typeof response.url === 'string'
          ? response.url
          : '';
      return { pageId, url };
    } catch (error: unknown) {
      throw new NotionException({
        code: NotionErrorCode.REQUEST_FAILED,
        message: `Notion day-page 생성 실패 (DB ${databaseId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        cause: error,
      });
    }
  }

  private async queryByTitle(
    databaseId: string,
    titlePropertyName: string,
    title: string,
  ): Promise<NotionDailyPlanPage | null> {
    try {
      const existing = await this.client!.databases.query({
        database_id: databaseId,
        filter: {
          property: titlePropertyName,
          title: { equals: title },
        },
        page_size: 1,
      });
      const first = existing.results[0];
      if (first && isFullPage(first)) {
        return { pageId: first.id, url: first.url };
      }
      return null;
    } catch (error: unknown) {
      throw new NotionException({
        code: NotionErrorCode.REQUEST_FAILED,
        message: `Notion DB ${databaseId} 조회 실패: ${
          error instanceof Error ? error.message : String(error)
        }`,
        cause: error,
      });
    }
  }

  // /today 가 같은 day-page 에 여러 번 호출돼도 Notion 에 누적되지 않도록 — 기존 "Check in *"
  // heading_2 섹션(다음 heading_2 직전까지) 들을 모두 archive 후 신규 blocks 를 append.
  // /worklog 의 "Check Out" 처럼 다른 heading_2 로 시작하는 섹션은 보존된다.
  // 순서가 중요: (1) 기존 Check in block id 수집 → (2) 신규 append → (3) 수집한 기존 id archive.
  // append 가 실패하면 throw 만 하고 기존 Check in 은 그대로 살아남는다 (codex review aaed1c2 P2 지적).
  async replaceCheckInSection({
    pageId,
    blocks,
  }: ReplaceCheckInSectionOptions): Promise<void> {
    this.assertClientConfigured('replaceCheckInSection');

    // per-page mutex — 동시 /today N건이 직렬 실행되도록 chain-and-replace.
    // `await pending` 후 새 work 생성 패턴은 N≥3 일 때 첫 한 건만 직렬화되고 나머지가
    // 동시에 풀리는 race 가 있어 (codex review 64070f3 P2), previous.then(...) 으로
    // map 항목 자체를 chain 시킨다. 모든 후속 호출이 이전 work 의 완료를 보장 후 시작.
    const previous = this.checkInLocks.get(pageId) ?? Promise.resolve();
    // 이전 호출이 throw 했어도 후속 호출은 정상 진행돼야 한다 — catch 로 swallow.
    // finally 도 동일 work chain 안에 fold — caller 의 await/catch 가 cleanup 까지 커버.
    // finally 를 별도 promise 로 분기하면 reject 시 unhandled rejection 으로 누수 (codex review a8b249d P1).
    const work: Promise<void> = previous
      .catch(() => undefined)
      .then(() => this.runReplaceCheckInSection(pageId, blocks))
      .finally(() => {
        // 후속 호출이 이미 lock 을 교체했을 수 있으므로 자기 work 일 때만 삭제.
        if (this.checkInLocks.get(pageId) === work) {
          this.checkInLocks.delete(pageId);
        }
      });
    this.checkInLocks.set(pageId, work);
    return work;
  }

  private async runReplaceCheckInSection(
    pageId: string,
    blocks: NotionPlanBlock[],
  ): Promise<void> {
    let existingIds: string[];
    try {
      existingIds = await this.collectCheckInSectionBlockIds(pageId);
    } catch (error: unknown) {
      throw new NotionException({
        code: NotionErrorCode.REQUEST_FAILED,
        message: `Notion page ${pageId} 의 기존 Check in 섹션 조회 실패: ${
          error instanceof Error ? error.message : String(error)
        }`,
        cause: error,
      });
    }

    // 신규 append 가 먼저 — 이 단계가 실패하면 기존 Check in 은 그대로 남는다 (P2 mitigation).
    await this.appendBlocks({ pageId, blocks });

    // 신규가 안전히 들어간 뒤에야 기존 archive. archive 실패하면 두 섹션이 잠시 공존 — append 가
    // 0건일 때보다 나은 trade-off (사용자가 lost data 경험 안 하도록).
    for (const blockId of existingIds) {
      try {
        // archive — Notion API 의 blocks.delete 는 archive=true 로 마킹 (hard delete 아님).
        await this.client!.blocks.delete({ block_id: blockId });
      } catch (error: unknown) {
        this.logger.warn(
          `Notion page ${pageId} 기존 Check in block ${blockId} archive 실패 (skip — 신규는 정상 추가됨): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  // 페이지의 자식 블록을 순회하면서 "Check in *" heading_2 부터 다음 heading_2 직전까지의 block id 를 수집.
  // 같은 page 에 과거 호출로 여러 Check in 섹션이 누적돼 있으면 모두 잡아서 한 번에 archive 한다.
  private async collectCheckInSectionBlockIds(
    pageId: string,
  ): Promise<string[]> {
    const ids: string[] = [];
    let inCheckInSection = false;
    let cursor: string | undefined;

    do {
      const response = await this.client!.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
        page_size: 100,
      });
      for (const child of response.results) {
        const heading = isHeading2WithCheckInPrefix(child);
        if (heading.isHeading2) {
          inCheckInSection = heading.startsWithCheckIn;
          if (inCheckInSection) {
            ids.push((child as { id: string }).id);
          }
          continue;
        }
        if (inCheckInSection) {
          ids.push((child as { id: string }).id);
        }
      }
      cursor = response.has_more
        ? (response.next_cursor ?? undefined)
        : undefined;
    } while (cursor);

    return ids;
  }

  async appendBlocks({ pageId, blocks }: AppendBlocksOptions): Promise<void> {
    this.assertClientConfigured('appendBlocks');
    if (blocks.length === 0) {
      return;
    }
    // Notion API 는 한 요청당 child 100개 제한 — 그 이상은 chunk 순차 append.
    const children = blocks.map(toNotionBlock);
    const chunks = Array.from(
      { length: Math.ceil(children.length / APPEND_BLOCKS_CHUNK_SIZE) },
      (_, index) =>
        children.slice(
          index * APPEND_BLOCKS_CHUNK_SIZE,
          (index + 1) * APPEND_BLOCKS_CHUNK_SIZE,
        ),
    );
    for (const [index, chunk] of chunks.entries()) {
      try {
        await this.client!.blocks.children.append({
          block_id: pageId,
          children: chunk as Parameters<
            Client['blocks']['children']['append']
          >[0]['children'],
        });
      } catch (error: unknown) {
        throw new NotionException({
          code: NotionErrorCode.REQUEST_FAILED,
          message: `Notion page ${pageId} block append 실패 (chunk ${index}): ${
            error instanceof Error ? error.message : String(error)
          }`,
          cause: error,
        });
      }
    }
  }

  private assertClientConfigured(operation: string): void {
    if (!this.client) {
      throw new NotionException({
        code: NotionErrorCode.TOKEN_NOT_CONFIGURED,
        message: `NOTION_TOKEN 이 .env 에 설정되지 않아 Notion API 호출이 불가합니다. (${operation})`,
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
  }

  // DB schema 에서 type === 'title' 인 property 의 이름을 반환 (DB 마다 "이름"/"Name"/"Title" 등 다름).
  // 매 호출마다 databases.retrieve 호출 — /today 는 하루 몇 번이라 성능 우려 없음.
  private async resolveTitlePropertyName(databaseId: string): Promise<string> {
    const db = await this.client!.databases.retrieve({
      database_id: databaseId,
    });
    if (!('properties' in db)) {
      throw new NotionException({
        code: NotionErrorCode.REQUEST_FAILED,
        message: `Notion DB ${databaseId} schema 조회 실패 — partial response.`,
      });
    }
    for (const [name, prop] of Object.entries(db.properties)) {
      if (
        typeof prop === 'object' &&
        prop !== null &&
        (prop as { type?: string }).type === 'title'
      ) {
        return name;
      }
    }
    throw new NotionException({
      code: NotionErrorCode.REQUEST_FAILED,
      message: `Notion DB ${databaseId} 에 title property 가 없습니다.`,
    });
  }

  private resolveDatabaseIdsFromEnv(): string[] {
    const raw = this.configService.get<string>('NOTION_TASK_DB_IDS');
    if (!raw) {
      return [];
    }
    return raw
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
  }

  private toNotionTask(page: FullPage, databaseId: string): NotionTask {
    const entries = Object.entries(page.properties);
    const titleEntry = entries.find(([, raw]) => raw.type === 'title');
    const titleText = titleEntry ? collectPlainText(titleEntry[1].title) : '';
    const title = titleText.length > 0 ? titleText : '(제목 없음)';

    const propertiesEntries = entries
      .filter(([, raw]) => raw.type !== 'title')
      .map(([name, raw]) => [name, propertyToString(raw)] as const)
      .filter(
        (entry): entry is readonly [string, string] =>
          entry[1] !== null && entry[1].length > 0,
      );

    return {
      databaseId,
      pageId: page.id,
      url: page.url,
      title,
      properties: Object.fromEntries(propertiesEntries),
    };
  }
}

// PRO-2++: link 가 있고 http(s) 스킴이면 rich_text 의 link annotation 적용 (전체 텍스트 클릭 가능).
// http(s) 외 스킴은 broken link 회피 위해 plain text 로 fallback (Slack renderTitleWithLink 와 동일 정책).
const isSafeHttpUrl = (url: string): boolean =>
  url.startsWith('http://') || url.startsWith('https://');

const buildRichText = (
  text: string,
  link?: string,
): Array<Record<string, unknown>> => {
  if (link && link.length > 0 && isSafeHttpUrl(link)) {
    return [{ type: 'text', text: { content: text, link: { url: link } } }];
  }
  return [{ type: 'text', text: { content: text } }];
};

// NotionPlanBlock → Notion API block 형식.
// discriminated union 6종 — ts-pattern 으로 exhaustive 매칭.
const toNotionBlock = (block: NotionPlanBlock): Record<string, unknown> => {
  return match(block)
    .with({ type: 'divider' }, () => ({
      object: 'block',
      type: 'divider',
      divider: {},
    }))
    .with({ type: 'heading' }, ({ text }) => ({
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: buildRichText(text) },
    }))
    .with({ type: 'subheading' }, ({ text }) => ({
      object: 'block',
      type: 'heading_3',
      heading_3: { rich_text: buildRichText(text) },
    }))
    .with({ type: 'bullet' }, ({ text, link }) => ({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: buildRichText(text, link) },
    }))
    .with({ type: 'todo' }, ({ text, checked, link }) => ({
      object: 'block',
      type: 'to_do',
      to_do: {
        rich_text: buildRichText(text, link),
        checked: checked === true,
      },
    }))
    .with({ type: 'paragraph' }, ({ text, link }) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: buildRichText(text, link) },
    }))
    .exhaustive();
};

// 최소한의 page 구조 (full page 만 사용 — partial response 는 isFullPage 로 필터).
type FullPage = {
  id: string;
  url: string;
  properties: Record<string, NotionProperty>;
};

const isFullPage = (page: unknown): page is FullPage => {
  if (typeof page !== 'object' || page === null) {
    return false;
  }
  const record = page as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.url === 'string' &&
    typeof record.properties === 'object' &&
    record.properties !== null
  );
};

// blocks.children.list 결과의 child 가 heading_2 인지, 그렇다면 "Check in *" 으로 시작하는지 판별.
// Notion API child block 의 shape: { id, type: 'heading_2', heading_2: { rich_text: [{ plain_text }, ...] } }
// 다른 type 의 child 는 isHeading2=false 로 응답해 caller 가 "이전 heading 의 섹션 본문" 으로 처리.
const isHeading2WithCheckInPrefix = (
  child: unknown,
): { isHeading2: boolean; startsWithCheckIn: boolean } => {
  if (typeof child !== 'object' || child === null) {
    return { isHeading2: false, startsWithCheckIn: false };
  }
  const record = child as { type?: unknown; heading_2?: unknown };
  if (record.type !== 'heading_2') {
    return { isHeading2: false, startsWithCheckIn: false };
  }
  const heading = record.heading_2 as { rich_text?: unknown } | undefined;
  const text = heading ? collectPlainText(heading.rich_text) : '';
  return {
    isHeading2: true,
    startsWithCheckIn: text.trim().startsWith('Check in'),
  };
};

// Notion property 종류는 많지만 PM evidence 용도엔 사람이 읽는 string 표현이면 충분.
// 알려지지 않은 type 은 null 로 두고 호출자가 skip.
type NotionProperty = { type: string } & Record<string, unknown>;

const collectPlainText = (segments: unknown): string => {
  if (!Array.isArray(segments)) {
    return '';
  }
  return segments
    .map((seg) => {
      if (typeof seg !== 'object' || seg === null) {
        return '';
      }
      const record = seg as Record<string, unknown>;
      return typeof record.plain_text === 'string' ? record.plain_text : '';
    })
    .join('')
    .trim();
};

const propertyToString = (prop: NotionProperty): string | null => {
  const readStringField = (): string =>
    typeof prop[prop.type] === 'string' ? (prop[prop.type] as string) : '';
  return match(prop.type)
    .with('rich_text', () => collectPlainText(prop.rich_text))
    .with('select', () => readNamedOption(prop.select))
    .with('status', () => readNamedOption(prop.status))
    .with('multi_select', () => readNamedOptionsList(prop.multi_select))
    .with('people', () => readPeople(prop.people))
    .with('date', () => readDateRange(prop.date))
    .with('checkbox', () => (prop.checkbox === true ? '✓' : '✗'))
    .with('number', () =>
      prop.number === null || prop.number === undefined
        ? ''
        : String(prop.number),
    )
    .with('url', 'email', 'phone_number', readStringField)
    .with('unique_id', () => readUniqueId(prop.unique_id))
    .with('formula', () => readFormula(prop.formula))
    .with('created_time', 'last_edited_time', readStringField)
    .with('created_by', 'last_edited_by', () =>
      readSinglePerson(prop[prop.type]),
    )
    .otherwise(() => null);
};

const readNamedOption = (option: unknown): string => {
  if (typeof option !== 'object' || option === null) {
    return '';
  }
  const record = option as Record<string, unknown>;
  return typeof record.name === 'string' ? record.name : '';
};

const readNamedOptionsList = (options: unknown): string => {
  if (!Array.isArray(options)) {
    return '';
  }
  return options
    .map((opt) => readNamedOption(opt))
    .filter(Boolean)
    .join(', ');
};

const readPeople = (people: unknown): string => {
  if (!Array.isArray(people)) {
    return '';
  }
  return people.map(readSinglePerson).filter(Boolean).join(', ');
};

const readSinglePerson = (person: unknown): string => {
  if (typeof person !== 'object' || person === null) {
    return '';
  }
  const record = person as Record<string, unknown>;
  if (typeof record.name === 'string') {
    return record.name;
  }
  return typeof record.id === 'string' ? record.id : '';
};

const readDateRange = (date: unknown): string => {
  if (typeof date !== 'object' || date === null) {
    return '';
  }
  const record = date as Record<string, unknown>;
  const start = typeof record.start === 'string' ? record.start : '';
  const end = typeof record.end === 'string' ? record.end : '';
  if (start && end) {
    return `${start} → ${end}`;
  }
  return start;
};

const readUniqueId = (uniqueId: unknown): string => {
  if (typeof uniqueId !== 'object' || uniqueId === null) {
    return '';
  }
  const record = uniqueId as Record<string, unknown>;
  const prefix = typeof record.prefix === 'string' ? record.prefix : '';
  const number = record.number;
  if (number === null || number === undefined) {
    return '';
  }
  return prefix ? `${prefix}-${String(number)}` : String(number);
};

const readFormula = (formula: unknown): string => {
  if (typeof formula !== 'object' || formula === null) {
    return '';
  }
  const record = formula as Record<string, unknown>;
  return match(record.type)
    .with('string', () =>
      typeof record.string === 'string' ? record.string : '',
    )
    .with('number', () =>
      record.number === null || record.number === undefined
        ? ''
        : String(record.number),
    )
    .with('boolean', () => (record.boolean === true ? '✓' : '✗'))
    .with('date', () => readDateRange(record.date))
    .otherwise(() => '');
};
