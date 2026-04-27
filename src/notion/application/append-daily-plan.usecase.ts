import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DailyPlan,
  DailyPlanSource,
  TaskItem,
} from '../../agent/pm/domain/pm-agent.type';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
  NotionDailyPlanPage,
  NotionPlanBlock,
} from '../domain/port/notion-client.port';

export interface AppendDailyPlanInput {
  plan: DailyPlan;
  planDate: Date; // day-precision (UTC 00:00, PM usecase 가 KST 로 정규화해 전달)
  // PM-2++: plan 이 어떤 외부 데이터(GitHub Issue/PR · Notion task · Slack 멘션 ·
  // 직전 PM/Work Reviewer 실행) 를 참조해 만들어졌는지 — Notion check-in 섹션 맨 위에
  // "참조 소스" 로 노출. Slack /today 응답 sources 와 동일 데이터.
  sources: DailyPlanSource[];
}

const KST_OFFSET_HOURS = 9;

// PM Agent `/today` 성공 후 Notion day-page 의 "Check in HH:MM" 섹션을 갱신.
// 같은 날 page 가 이미 있으면 재사용 (사용자 "일일 회고" 템플릿 — /today Check in + /worklog Check Out 같은 page).
// /today 가 같은 날 여러 번 호출돼도 누적 append 되지 않도록 기존 Check in 섹션을 모두
// archive 후 신규 한 건만 남긴다 (replaceCheckInSection). /worklog 의 Check Out 섹션은 보존.
// DB 미설정 시 null — 호출자는 graceful skip.
@Injectable()
export class AppendDailyPlanUsecase {
  private readonly logger = new Logger(AppendDailyPlanUsecase.name);

  constructor(
    @Inject(NOTION_CLIENT_PORT) private readonly client: NotionClientPort,
    private readonly configService: ConfigService,
  ) {}

  async execute({
    plan,
    planDate,
    sources,
  }: AppendDailyPlanInput): Promise<NotionDailyPlanPage | null> {
    const databaseId = this.resolveDailyPlanDatabaseId();
    if (!databaseId) {
      this.logger.warn(
        'NOTION_DAILY_PLAN_DATABASE_ID 미설정 — Notion 기록 skip (task DB 재사용 금지: day-page 가 task 로 되돌아오는 오염 방지)',
      );
      return null;
    }

    const title = formatDayPageTitle(planDate);
    const page = await this.client.findOrCreateDailyPage({
      databaseId,
      title,
    });
    await this.client.replaceCheckInSection({
      pageId: page.pageId,
      blocks: buildCheckInBlocks(plan, sources),
    });
    return page;
  }

  // day-page DB 는 반드시 NOTION_DAILY_PLAN_DATABASE_ID 로 명시되어야 한다.
  // NOTION_TASK_DB_IDS 와 공유 시 listActiveTasks() 가 self-authored day-page 를 task 로 잘못 인식해
  // 다음 /today 에서 prompt 에 누적되는 오염이 발생함 (codex review bhtilxlpc P1 지적).
  private resolveDailyPlanDatabaseId(): string | null {
    const explicit = this.configService
      .get<string>('NOTION_DAILY_PLAN_DATABASE_ID')
      ?.trim();
    return explicit && explicit.length > 0 ? explicit : null;
  }
}

// "YYYY.MM.DD" — 사용자 "일일 회고" 템플릿의 page title 형식.
export const formatDayPageTitle = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
};

// 현재 KST 시각을 "HH:MM" 문자열로 반환.
const getKstHourMinute = (): string => {
  const nowMs = Date.now();
  const kstDate = new Date(nowMs + KST_OFFSET_HOURS * 60 * 60 * 1000);
  const hour = String(kstDate.getUTCHours()).padStart(2, '0');
  const minute = String(kstDate.getUTCMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
};

// DailyPlan → Check in 섹션 blocks.
// 사용자 "일일 회고" 템플릿 포맷: Check in HH:MM (heading2) / 참조 소스 / 오늘의 할 일 (heading3) / 최우선·오전·오후·Blocker 구조.
// TaskItem 의 subtasks (WBS) 는 부모 todo 뒤에 들여쓴 todo 로, isCriticalPath 는 제목 앞에 ⚠ 마커로.
// PRO-2++: task.url 이 있으면 해당 block 에 link 를 입혀 Notion 페이지에서도 PR/Issue/Notion 으로 클릭 이동 가능.
// PM-2++: sources 가 있으면 "오늘의 할 일" 위에 "참조 소스" subheading 으로 데이터 출처를 노출.
const buildCheckInBlocks = (
  plan: DailyPlan,
  sources: DailyPlanSource[],
): NotionPlanBlock[] => {
  const blocks: NotionPlanBlock[] = [
    { type: 'heading', text: `Check in ${getKstHourMinute()}` },
  ];
  appendSourceBlocks(blocks, sources);
  blocks.push(
    { type: 'subheading', text: '오늘의 할 일' },
    {
      type: 'bullet',
      text: `최우선: ${renderTaskTitle(plan.topPriority)}`,
      link: plan.topPriority.url,
    },
  );
  appendSubtaskBlocks(blocks, plan.topPriority);

  if (plan.morning.length > 0) {
    blocks.push({ type: 'bullet', text: '오전' });
    for (const task of plan.morning) {
      blocks.push({
        type: 'todo',
        text: renderTaskTitle(task),
        link: task.url,
      });
      appendSubtaskBlocks(blocks, task);
    }
  }

  if (plan.afternoon.length > 0) {
    blocks.push({ type: 'bullet', text: '오후' });
    for (const task of plan.afternoon) {
      blocks.push({
        type: 'todo',
        text: renderTaskTitle(task),
        link: task.url,
      });
      appendSubtaskBlocks(blocks, task);
    }
  }

  if (plan.blocker) {
    blocks.push({ type: 'bullet', text: `Blocker: ${plan.blocker}` });
  }

  // 이월 항목이 없어도 analysisReasoning 이 있으면 자율 판단 근거 노출
  // (codex review bi531458d P3 — Eisenhower 판단 근거 보존).
  const { rolledOverTasks, analysisReasoning } = plan.varianceAnalysis;
  if (rolledOverTasks.length > 0 || analysisReasoning.length > 0) {
    blocks.push({ type: 'subheading', text: '어제 이월' });
    for (const rolled of rolledOverTasks) {
      blocks.push({ type: 'bullet', text: rolled });
    }
    if (analysisReasoning.length > 0) {
      blocks.push({
        type: 'paragraph',
        text: `이월 근거 — ${analysisReasoning}`,
      });
    }
  }

  blocks.push({
    type: 'paragraph',
    text: `예상 소요 ${plan.estimatedHours}h — ${plan.reasoning}`,
  });
  blocks.push({ type: 'divider' });

  return blocks;
};

// TaskItem 의 isCriticalPath (⚠) / source 표시를 포함한 한 줄 제목.
const renderTaskTitle = (task: TaskItem): string => {
  const critical = task.isCriticalPath ? '⚠ ' : '';
  return `${critical}${task.title} (${task.source})`;
};

// 참조 소스 섹션을 Check in heading 직후에 추가. URL 이 있는 항목은 bullet 자체가 클릭 가능.
// label 을 "참조 소스" 단일 subheading 으로 묶고, 한 항목당 한 bullet — Slack /today 응답의
// `*참조 소스*` 섹션과 동일 정보를 Notion 에서도 그대로 확인 가능.
const appendSourceBlocks = (
  blocks: NotionPlanBlock[],
  sources: DailyPlanSource[],
): void => {
  if (sources.length === 0) {
    return;
  }
  blocks.push({ type: 'subheading', text: '참조 소스' });
  for (const source of sources) {
    blocks.push({
      type: 'bullet',
      text: source.label,
      link: source.url,
    });
  }
};

// WBS 서브태스크를 부모 todo 바로 아래에 "  - subtitle (Nm)" 형태의 paragraph 들로 append.
// Notion API 에 nested children 을 한 번에 보내려면 block_object 의 children 필드가 필요해 복잡 —
// 지금은 들여쓰기 paragraph 로 단순 표현 (템플릿 가독성과 충돌 안 남).
const appendSubtaskBlocks = (
  blocks: NotionPlanBlock[],
  task: TaskItem,
): void => {
  for (const sub of task.subtasks) {
    blocks.push({
      type: 'paragraph',
      text: `   ↳ ${sub.title} (${sub.estimatedMinutes}m)`,
    });
  }
};
