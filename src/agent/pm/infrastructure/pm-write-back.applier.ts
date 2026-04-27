import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
  NotionPlanBlock,
} from '../../../notion/domain/port/notion-client.port';
import { PreviewApplier } from '../../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { SubTask, TaskItem } from '../domain/pm-agent.type';

// PM-2 Write-back payload — `/sync-plan` 호출 시 PreviewAction 에 박혀 들어가는 데이터.
// PM Agent 의 DailyPlan 에서 GITHUB / NOTION source 인 task 만 골라 두고, applier 가 받으면 외부 시스템에 코멘트/Todo 로 append.
export interface PmWriteBackPayload {
  tasks: TaskItem[];
}

// 1개 task → "WBS 동기화" 코멘트 마크다운. subtasks 없는 task 는 호출자(usecase) 단에서 미리 걸러야 함.
const buildIssueCommentBody = (task: TaskItem): string => {
  const lines: string[] = ['🤖 *이대리 PM 동기화 — WBS 분해 결과*', ''];
  if (task.subtasks.length === 0) {
    lines.push('_(WBS 분해 항목 없음 — 본 태스크는 단일 단위로 처리됩니다.)_');
  } else {
    for (const sub of task.subtasks) {
      lines.push(`- [ ] ${sub.title} (${sub.estimatedMinutes}m)`);
    }
  }
  return lines.join('\n');
};

const buildNotionTodoBlocks = (task: TaskItem): NotionPlanBlock[] => {
  if (task.subtasks.length === 0) {
    return [];
  }
  return [
    {
      type: 'subheading',
      text: `🤖 이대리 PM 동기화 — WBS (${task.title})`,
    },
    ...task.subtasks.map(
      (sub: SubTask): NotionPlanBlock => ({
        type: 'todo',
        text: `${sub.title} (${sub.estimatedMinutes}m)`,
      }),
    ),
  ];
};

// PM-2 Strategy 구현 — PreviewAction kind=PM_WRITE_BACK 에 매칭.
// GITHUB / NOTION source 별로 외부 시스템에 코멘트/Todo append.
// 멱등성은 PreviewAction 의 status 전이 (PENDING → APPLIED) 가 보장 — 같은 preview 두 번 apply 안 됨.
// 같은 task 가 여러 plan 에 등장(이월) 하면 매번 코멘트 추가됨 — 향후 marker 기반 dedup 도입 deferred.
@Injectable()
export class PmWriteBackApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.PM_WRITE_BACK;

  private readonly logger = new Logger(PmWriteBackApplier.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
  ) {}

  async apply(preview: PreviewAction): Promise<string> {
    const tasks = this.parsePayload(preview.payload);
    let githubCount = 0;
    let notionCount = 0;

    for (const task of tasks) {
      if (task.subtasks.length === 0) {
        continue;
      }
      try {
        if (task.source === 'GITHUB') {
          await this.writeBackGithub(task);
          githubCount += 1;
        } else if (task.source === 'NOTION') {
          await this.writeBackNotion(task);
          notionCount += 1;
        }
      } catch (error: unknown) {
        // 한 task 실패가 전체 apply 를 막지 않도록 graceful — 결과 메시지에 카운트만 누락.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `PM Write-back ${task.source} task ${task.id} 실패: ${message}`,
        );
      }
    }

    return `GitHub ${githubCount}개, Notion ${notionCount}개 동기화 완료`;
  }

  private async writeBackGithub(task: TaskItem): Promise<void> {
    // task.id 는 'owner/repo#number' 자연 키 — id 자체에서 repo/number 파싱.
    const match = task.id.match(/^(.+)#(\d+)$/);
    if (!match) {
      throw new Error(
        `GITHUB task id '${task.id}' 가 'owner/repo#number' 형식이 아닙니다.`,
      );
    }
    const [, repo, numberRaw] = match;
    await this.githubClient.addIssueComment({
      repo,
      number: Number.parseInt(numberRaw, 10),
      body: buildIssueCommentBody(task),
    });
  }

  private async writeBackNotion(task: TaskItem): Promise<void> {
    // NOTION source 의 task.id 는 page id — appendBlocks 로 page 안에 todo 추가.
    const blocks = buildNotionTodoBlocks(task);
    if (blocks.length === 0) {
      return;
    }
    await this.notionClient.appendBlocks({ pageId: task.id, blocks });
  }

  // payload narrowing — Prisma JSON 에서 unknown 으로 들어옴.
  private parsePayload(payload: unknown): TaskItem[] {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !Array.isArray((payload as { tasks?: unknown }).tasks)
    ) {
      throw new Error('PmWriteBackPayload.tasks 배열이 누락되었습니다.');
    }
    return (payload as PmWriteBackPayload).tasks;
  }
}
