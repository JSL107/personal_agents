import { Injectable } from '@nestjs/common';

import { EvidenceInput } from '../../../agent-run/domain/agent-run.type';
import {
  DailyPlanContext,
  SLACK_MENTION_SINCE_HOURS,
} from './daily-plan-context.collector';

// DailyPlanContext → AgentRun 에 기록할 EvidenceInput 배열.
// source 추가 시 여기 한 곳에서 대응 (OCP).
@Injectable()
export class DailyPlanEvidenceBuilder {
  build(context: DailyPlanContext): EvidenceInput[] {
    const {
      userText,
      slackUserId,
      githubTasks,
      previousPlan,
      previousWorklog,
      eveningRetro,
      slackMentions,
      notionTasks,
    } = context;

    const evidence: EvidenceInput[] = [
      {
        sourceType: 'SLACK_COMMAND_TODAY',
        sourceId: slackUserId,
        payload: { tasksText: userText },
      },
    ];
    if (githubTasks) {
      evidence.push({
        sourceType: 'GITHUB_ASSIGNED_TASKS',
        sourceId: 'me',
        payload: {
          issues: githubTasks.issues,
          pullRequests: githubTasks.pullRequests,
        },
      });
    }
    if (previousPlan) {
      evidence.push({
        sourceType: 'PRIOR_DAILY_PLAN',
        sourceId: String(previousPlan.agentRunId),
        payload: {
          plan: previousPlan.plan,
          endedAt: previousPlan.endedAt.toISOString(),
        },
      });
    }
    if (previousWorklog) {
      evidence.push({
        sourceType: 'PRIOR_DAILY_REVIEW',
        sourceId: String(previousWorklog.agentRunId),
        payload: {
          review: previousWorklog.review,
          endedAt: previousWorklog.endedAt.toISOString(),
        },
      });
    }
    // 회고는 오늘 일정의 1차 재료다. 근거로 남기지 않으면 "이 할 일이 어디서 왔나" 를
    // 되짚을 때 어제 계획·worklog 까지만 추적되고 그 앞이 끊긴다.
    if (eveningRetro) {
      evidence.push({
        sourceType: 'PRIOR_EVENING_RETRO',
        sourceId: String(eveningRetro.agentRunId),
        payload: {
          reflection: eveningRetro.reflection,
          endedAt: eveningRetro.endedAt.toISOString(),
        },
      });
    }
    if (slackMentions.length > 0) {
      evidence.push({
        sourceType: 'SLACK_MENTIONS',
        sourceId: slackUserId,
        payload: {
          sinceHours: SLACK_MENTION_SINCE_HOURS,
          mentions: slackMentions,
        },
      });
    }
    if (notionTasks.length > 0) {
      evidence.push({
        sourceType: 'NOTION_TASKS',
        sourceId: 'me',
        payload: {
          tasks: notionTasks,
        },
      });
    }
    return evidence;
  }
}
