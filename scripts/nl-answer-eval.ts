import { AsyncLocalStorage } from 'node:async_hooks';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getQueueToken } from '@nestjs/bullmq';
import { Module, Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';

import { PublishNotionDraftUsecase } from '../src/agent/blog/application/publish-notion-draft.usecase';
import { BlogDispatcher } from '../src/agent/blog/infrastructure/blog.dispatcher';
import { AnalyzeJdGapUsecase } from '../src/agent/career-mate/application/analyze-jd-gap.usecase';
import { AuditResumeUsecase } from '../src/agent/career-mate/application/audit-resume.usecase';
import { BuildCareerProfileUsecase } from '../src/agent/career-mate/application/build-career-profile.usecase';
import { CalibrateResumeUsecase } from '../src/agent/career-mate/application/calibrate-resume.usecase';
import { ReflectPrUsecase } from '../src/agent/career-mate/application/reflect-pr.usecase';
import { CeoDispatcher } from '../src/agent/ceo/infrastructure/ceo.dispatcher';
import { ReviewPullRequestUsecase } from '../src/agent/code-reviewer/application/review-pull-request.usecase';
import { parsePrReference } from '../src/agent/code-reviewer/domain/pr-reference.parser';
import { ImpactReporterDispatcher } from '../src/agent/impact-reporter/infrastructure/impact-reporter.dispatcher';
import { AddApplicationUsecase } from '../src/agent/job-application/application/add-application.usecase';
import { UpdateApplicationUsecase } from '../src/agent/job-application/application/update-application.usecase';
import { PmDispatcher } from '../src/agent/pm/infrastructure/pm.dispatcher';
import { PoEvalDispatcher } from '../src/agent/po-eval/infrastructure/po-eval.dispatcher';
import { PoShadowDispatcher } from '../src/agent/po-shadow/infrastructure/po-shadow.dispatcher';
import { CancelLeaveUsecase } from '../src/agent/vacation/application/cancel-leave.usecase';
import { RegisterLeaveUsecase } from '../src/agent/vacation/application/register-leave.usecase';
import { VideoWatchDispatcher } from '../src/agent/video-watch/infrastructure/video-watch.dispatcher';
import { WorkReviewerDispatcher } from '../src/agent/work-reviewer/infrastructure/work-reviewer.dispatcher';
import { AgentRunService } from '../src/agent-run/application/agent-run.service';
import { ModelRouterUsecase } from '../src/model-router/application/model-router.usecase';
import { AgentType } from '../src/model-router/domain/model-router.type';
import { MODEL_CALL_LOG_PORT } from '../src/model-router/domain/port/model-call-log.port';
import { NotificationPublisher } from '../src/notification/application/notification-publisher.service';
import { NOTIFICATION_QUEUE } from '../src/notification/domain/notification.type';
import { PreviewGateModule } from '../src/preview-gate/preview-gate.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConversationMemoryService } from '../src/router/application/conversation-memory.service';
import { HandleConversationTurnUsecase } from '../src/router/application/handle-conversation-turn.usecase';
import { IntentClassifierUsecase } from '../src/router/application/intent-classifier.usecase';
import { buildDispatchReplyText } from '../src/router/domain/dispatch-reply.util';
import { ROUTING_NO_RUN_PORT } from '../src/router/domain/port/routing-no-run.port';
import { NL_ANSWER_EVAL_CASES } from '../src/router/eval/nl-answer-eval.cases';
import {
  summarizeCase,
  summarizeSplits,
} from '../src/router/eval/nl-answer-eval.scorer';
import {
  EvalCase,
  EvalDestination,
  EvalIntercept,
  EvalModelCall,
  EvalRunRecord,
} from '../src/router/eval/nl-answer-eval.type';
import {
  EvalWriteBlockedException,
  readOnlyPrismaExtension,
} from '../src/router/eval/read-only-prisma';
import { RouterModule } from '../src/router/router.module';
import { RegisterScheduleUsecase } from '../src/schedule/application/register-schedule.usecase';

/**
 * 자연어 질문 eval — 실 분류기·실 워커 파서·실 대화 답변을 부르고, 쓰기는 하나도 실행하지 않는다.
 * (plan: docs/superpowers/plans/2026-10-07-nl-answer-fidelity.md §4 1단계)
 *
 * 사용법: pnpm eval:nl-answer [--runs 3] [--concurrency 2] [--split tuning|holdout|all]
 *                             [--only id1,id2] [--out <path>]
 *
 * 운영 서버와 같은 DB·LLM 구독을 쓰므로 다음을 지킨다.
 * - AppModule 을 띄우지 않는다. 전체 부팅은 실행 중인 서버의 BullMQ repeatable job 과 cron 을
 *   건드린다(scripts/review-pr-dry.ts 와 같은 이유). RouterModule 만 조립한다.
 * - `compile()` 만 하고 `init()` 은 부르지 않는다. 부팅 훅(중단된 승인 작업 재개 등)이 돌지 않는다.
 * - DB 는 Prisma 쿼리 단계에서 쓰기를 막는다(read-only-prisma.ts). 쓰기 usecase 는 기록만 하는
 *   가짜로 바꾸고, 원장·모델 호출 로그·라우팅 기록·대화 기억·알림 큐도 가짜로 바꾼다.
 * - 무거운 워커(PM·회고·임팩트 등)는 실행하지 않고 "그쪽으로 라우팅됐다"만 남긴다.
 * - LLM 쿼터를 운영과 함께 쓰므로 동시 실행은 기본 2.
 */

interface RunContext {
  intercepts: EvalIntercept[];
  modelCalls: EvalModelCall[];
  routedTo?: EvalDestination;
}

const runContext = new AsyncLocalStorage<RunContext>();

// 가로챈 쓰기·외부 실행. 기록한 뒤 이 신호로 dispatch 를 끝낸다 — 실행된 척하는 가짜 결과를
// 만들면 formatter 가 그 결과로 성공 문구를 지어내 채점이 흐려진다.
class EvalInterceptSignal extends Error {
  constructor(readonly interceptName: string) {
    super(`eval: ${interceptName} 가로챔`);
  }
}

class EvalStubRoutedSignal extends Error {
  constructor(readonly agentType: AgentType) {
    super(`eval: ${agentType} 는 실행하지 않음`);
  }
}

const record = (name: string, args: Record<string, unknown>): never => {
  // 결과 파일에 사용자 식별자를 남기지 않는다.
  const { slackUserId: _omit, ...rest } = args;
  void _omit;
  runContext.getStore()?.intercepts.push({ name, args: rest });
  throw new EvalInterceptSignal(name);
};

const interceptor = (name: string) => ({
  execute: (args: Record<string, unknown>): never => record(name, args),
});

const WRITE_USECASES: ReadonlyArray<[Type<unknown>, string]> = [
  [RegisterLeaveUsecase, 'RegisterLeaveUsecase'],
  [CancelLeaveUsecase, 'CancelLeaveUsecase'],
  [AddApplicationUsecase, 'AddApplicationUsecase'],
  [UpdateApplicationUsecase, 'UpdateApplicationUsecase'],
  [PublishNotionDraftUsecase, 'PublishNotionDraftUsecase'],
  [BuildCareerProfileUsecase, 'BuildCareerProfileUsecase'],
  [AnalyzeJdGapUsecase, 'AnalyzeJdGapUsecase'],
  [CalibrateResumeUsecase, 'CalibrateResumeUsecase'],
  [AuditResumeUsecase, 'AuditResumeUsecase'],
  [ReflectPrUsecase, 'ReflectPrUsecase'],
  [RegisterScheduleUsecase, 'RegisterScheduleUsecase'],
];

// 실행하지 않는 무거운 워커 — GitHub·Notion 조회와 긴 LLM 생성, 일부는 외부 게시까지 한다.
const STUB_DISPATCHERS: ReadonlyArray<[Type<unknown>, AgentType]> = [
  [PmDispatcher, AgentType.PM],
  [WorkReviewerDispatcher, AgentType.WORK_REVIEWER],
  [ImpactReporterDispatcher, AgentType.IMPACT_REPORTER],
  [PoShadowDispatcher, AgentType.PO_SHADOW],
  [PoEvalDispatcher, AgentType.PO_EVAL],
  [CeoDispatcher, AgentType.CEO],
  [BlogDispatcher, AgentType.BLOG],
  [VideoWatchDispatcher, AgentType.VIDEO_WATCH],
];

const LIFECYCLE_HOOKS: ReadonlySet<string> = new Set([
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
]);

// 원장 대체 — run() 은 실행하고 결과만 돌려준다. 행을 만들지 않으므로 id 는 음수 sentinel.
const fakeAgentRunService = new Proxy(
  {
    async execute<T>({
      run,
    }: {
      run: () => Promise<{ result: T; modelUsed: string }>;
    }): Promise<{ result: T; modelUsed: string; agentRunId: number }> {
      const { result, modelUsed } = await run();
      return { result, modelUsed, agentRunId: -1 };
    },
  },
  {
    get(target, property) {
      if (property in target) {
        return target[property as keyof typeof target];
      }
      // Promise 판별과 Nest 생명주기 훅 조회에는 "없음" 으로 답한다.
      if (property === 'then' || LIFECYCLE_HOOKS.has(String(property))) {
        return undefined;
      }
      // 빠뜨린 원장 경로를 조용히 넘기지 않는다 — 어디서 불렀는지 드러나게 실패시킨다.
      return () => {
        throw new Error(
          `eval: AgentRunService.${String(property)} 는 지원하지 않는다`,
        );
      };
    },
  },
);

const noop = async (): Promise<void> => undefined;

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
};

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    // 앱에서는 AppModule 이 전역으로 등록한다. 승인 후 실행기(applier)는 비워 둔다 — eval 은
    // 미리보기를 승인하지 않고, 미리보기 생성도 읽기 전용 Prisma 에서 막힌다.
    PreviewGateModule.forRoot({ appliers: [] }),
    RouterModule,
  ],
})
class NlAnswerEvalModule {}

const buildModule = async (): Promise<TestingModule> => {
  const readOnlyPrisma = new PrismaClient().$extends(readOnlyPrismaExtension);
  let builder = Test.createTestingModule({ imports: [NlAnswerEvalModule] })
    .overrideProvider(PrismaService)
    .useValue(readOnlyPrisma)
    .overrideProvider(AgentRunService)
    .useValue(fakeAgentRunService)
    .overrideProvider(MODEL_CALL_LOG_PORT)
    .useValue({ record: noop })
    .overrideProvider(ROUTING_NO_RUN_PORT)
    .useValue({ record: noop })
    .overrideProvider(ConversationMemoryService)
    .useValue({ getRecentTurns: async () => [], appendTurn: noop })
    // 모델 쿼터·인증 장애 알림은 운영 서버를 거쳐 실제 Slack DM 으로 나간다.
    .overrideProvider(NotificationPublisher)
    .useValue(
      new Proxy(
        {},
        {
          get: (_target, property) =>
            property === 'then' || LIFECYCLE_HOOKS.has(String(property))
              ? undefined
              : (payload: unknown) => {
                  process.stderr.write(
                    `[eval] 알림 억제: ${String(property)} ${String(JSON.stringify(payload) ?? '').slice(0, 200)}\n`,
                  );
                },
        },
      ),
    )
    .overrideProvider(getQueueToken(NOTIFICATION_QUEUE))
    .useValue({})
    .overrideProvider(ReviewPullRequestUsecase)
    .useValue({
      // 참조 파싱은 운영과 같은 함수로 한다 — 형식 오류는 운영처럼 사용자 오류로 나가고,
      // 파싱에 성공하면 리뷰를 실행한 것으로 기록한다(실제 리뷰·게시는 하지 않는다).
      execute: (args: { prRef: string; publish?: boolean }): never => {
        const ref = parsePrReference(args.prRef);
        return record('ReviewPullRequestUsecase', {
          repo: ref.repo,
          number: ref.number,
          publish: args.publish,
        });
      },
    });
  for (const [token, name] of WRITE_USECASES) {
    builder = builder.overrideProvider(token).useValue(interceptor(name));
  }
  for (const [token, agentType] of STUB_DISPATCHERS) {
    builder = builder.overrideProvider(token).useValue({
      agentType,
      dispatch: (): never => {
        throw new EvalStubRoutedSignal(agentType);
      },
    });
  }
  return builder.compile();
};

// 분류기·파서 응답을 회차별로 남긴다 — 가드 이전의 파서 판단은 여기서만 복원된다.
const instrument = (moduleRef: TestingModule): void => {
  const modelRouter = moduleRef.get(ModelRouterUsecase);
  const route = modelRouter.route.bind(modelRouter);
  modelRouter.route = (async (request: Parameters<typeof route>[0]) => {
    const response = await route(request);
    runContext.getStore()?.modelCalls.push({
      agentType: String(request.agentType),
      responseText: response.text.slice(0, 4000),
    });
    return response;
  }) as typeof modelRouter.route;

  const classifier = moduleRef.get(IntentClassifierUsecase);
  const classify = classifier.classify.bind(classifier);
  classifier.classify = (async (...args: Parameters<typeof classify>) => {
    const classification = await classify(...args);
    const store = runContext.getStore();
    if (store !== undefined) {
      store.routedTo =
        classification.agentType === 'UNKNOWN'
          ? 'REPLIED'
          : classification.agentType;
    }
    return classification;
  }) as typeof classifier.classify;
};

const runOnce = async (
  turn: HandleConversationTurnUsecase,
  slackUserId: string,
  evalCase: EvalCase,
  runIndex: number,
): Promise<EvalRunRecord> => {
  const context: RunContext = { intercepts: [], modelCalls: [] };
  const startedAt = Date.now();
  const base = { caseId: evalCase.id, split: evalCase.split, runIndex };
  return runContext.run(context, async () => {
    try {
      const result = await turn.execute({
        slackUserId,
        conversationKey: `eval:${evalCase.id}:${runIndex}`,
        text: evalCase.text,
        source: 'SLACK_MESSAGE',
        priorTurns: evalCase.priorTurns ?? [],
        shouldRemember: false,
      });
      return {
        ...base,
        outcome: result.kind === 'REPLIED' ? 'REPLIED' : 'WORKER_RAN',
        destination:
          result.kind === 'REPLIED' ? 'REPLIED' : result.result.workerType,
        text:
          result.kind === 'REPLIED'
            ? result.text
            : buildDispatchReplyText(result.result),
        intercepts: context.intercepts,
        modelCalls: context.modelCalls,
        durationMs: Date.now() - startedAt,
      };
    } catch (error: unknown) {
      const outcome =
        error instanceof EvalInterceptSignal
          ? 'INTERCEPTED'
          : error instanceof EvalStubRoutedSignal
            ? 'STUB_ROUTED'
            : 'ERROR';
      if (error instanceof EvalWriteBlockedException) {
        // 가짜로 바꾸지 못한 쓰기 경로 — eval 조립의 구멍이므로 문항 실패로 드러낸다.
        context.intercepts.push({
          name: `PrismaWrite:${error.model ?? 'raw'}.${error.operation}`,
          args: {},
        });
      }
      return {
        ...base,
        outcome,
        destination:
          error instanceof EvalStubRoutedSignal
            ? error.agentType
            : context.routedTo,
        text:
          outcome === 'ERROR'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
        intercepts: context.intercepts,
        modelCalls: context.modelCalls,
        durationMs: Date.now() - startedAt,
      };
    }
  });
};

const WRITE_ACTION = /"action"\s*:\s*"(REGISTER|CANCEL|ADD|UPDATE_STATUS)"/;

// 파서가 쓰기 액션을 고른 회차 수 — 0단계 가드가 막기 전의 판단이다.
const countParserWriteDecisions = (runs: EvalRunRecord[]): number =>
  runs.filter((run) =>
    run.modelCalls.some(
      (call) =>
        (call.agentType === AgentType.VACATION ||
          call.agentType === AgentType.JOB_APPLICATION) &&
        WRITE_ACTION.test(call.responseText),
    ),
  ).length;

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, lane),
  );
  return results;
};

const main = async (): Promise<void> => {
  const runs = Number(readOption('runs') ?? '3');
  const concurrency = Number(readOption('concurrency') ?? '2');
  const split = readOption('split') ?? 'all';
  const only = readOption('only')?.split(',');
  const out =
    readOption('out') ?? join(tmpdir(), `nl-answer-eval-${Date.now()}.json`);

  const cases = NL_ANSWER_EVAL_CASES.filter(
    (evalCase) =>
      (split === 'all' || evalCase.split === split) &&
      (only === undefined || only.includes(evalCase.id)),
  );
  if (cases.length === 0) {
    throw new Error('실행할 문항이 없다 — --split / --only 를 확인하라');
  }

  const moduleRef = await buildModule();
  try {
    instrument(moduleRef);
    // 휴가·지원 기록은 1인 사용자 봇이라 사용자가 하나다. id 는 출력하지 않는다.
    const prisma = moduleRef.get<PrismaClient>(PrismaService);
    const owner = await prisma.leaveUsage.findFirst({
      select: { slackUserId: true },
    });
    if (owner === null) {
      throw new Error('휴가 기록이 없어 eval 사용자를 정할 수 없다');
    }
    const turn = moduleRef.get(HandleConversationTurnUsecase);

    const jobs = cases.flatMap((evalCase) =>
      Array.from({ length: runs }, (_, runIndex) => ({ evalCase, runIndex })),
    );
    process.stderr.write(
      `[eval] 문항 ${cases.length}개 × ${runs}회 = ${jobs.length}회차, 동시 ${concurrency}\n`,
    );
    let done = 0;
    const records = await mapWithConcurrency(jobs, concurrency, async (job) => {
      const recorded = await runOnce(
        turn,
        owner.slackUserId,
        job.evalCase,
        job.runIndex,
      );
      done += 1;
      process.stderr.write(
        `[eval] ${done}/${jobs.length} ${job.evalCase.id}#${job.runIndex} → ${recorded.outcome} ${recorded.destination ?? ''} (${Math.round(recorded.durationMs / 1000)}s)\n`,
      );
      return recorded;
    });

    const summaries = cases.map((evalCase) => {
      const caseRuns = records.filter(
        (recorded) => recorded.caseId === evalCase.id,
      );
      return {
        ...summarizeCase(evalCase, caseRuns),
        parserWriteDecisions: countParserWriteDecisions(caseRuns),
      };
    });
    const report = {
      generatedAt: new Date().toISOString(),
      runsPerCase: runs,
      splits: summarizeSplits(summaries),
      cases: summaries,
      records,
    };
    writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');

    for (const summary of summaries) {
      process.stdout.write(
        `${summary.satisfied ? 'O' : 'X'} ${summary.caseId} ${summary.passes}/${summary.runs}` +
          `${summary.parserWriteDecisions > 0 ? ` (파서 쓰기 판단 ${summary.parserWriteDecisions})` : ''}` +
          `${summary.stubRouted > 0 ? ` (미실행 워커 ${summary.stubRouted})` : ''}` +
          `${summary.failures.length > 0 ? ` — ${summary.failures.join(' / ')}` : ''}\n`,
      );
    }
    for (const splitSummary of report.splits) {
      process.stdout.write(
        `${splitSummary.split}: ${splitSummary.satisfied}/${splitSummary.cases} 충족\n`,
      );
    }
    process.stdout.write(`저장: ${out}\n`);
  } finally {
    await moduleRef.get<PrismaClient>(PrismaService).$disconnect();
    await moduleRef.close();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
