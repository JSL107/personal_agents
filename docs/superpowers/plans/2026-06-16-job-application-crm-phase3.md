# 이직 메이트 Phase 3 구현 계획 — 지원 추적 CRM (JOB_APPLICATION)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 신규 자체 에이전트 `JOB_APPLICATION`(VACATION 스타일) 추가 — 자연어로 지원 기록/상태갱신/조회(CRUD, Postgres 영속) + 매일 넛지 cron(마감 임박/팔로업 지남 → Slack DM).

**Architecture:** VACATION 패턴 복제 — 자체 에이전트(dispatcher + LLM 파라미터 추출 + 결정론 CRUD usecase + Prisma repository) + CeoMetaCron 복제(BullMQ repeatable 넛지). LLM(ChatGPT)은 ADD/UPDATE 파라미터 추출에만, CRUD 는 결정론. 날짜는 plain-date 헬퍼(@db.Date).

**Tech Stack:** NestJS 10, Prisma(PostgreSQL@5434), BullMQ cron, Slack, class-validator, jest. LLM=ChatGPT(model-router).
**선행:** Phase 1·2·4 (이미 main). 브랜치 `feat/job-application-crm`. **설계서:** `docs/superpowers/specs/2026-06-16-job-application-crm-phase3-design.md`

**확정 사실 (탐색 verbatim):**
- VACATION usecase: register/cancel(상태변경) → `agentRunService.execute` 래핑 `(context)=>{result, modelUsed:'deterministic', output}`; list(조회) → 비래핑, repository 직접.
- `LeaveUsageRepository`: `constructor(prisma: PrismaService)`, save/findActiveByUser(`where canceledAt:null`)/softCancel(`updateMany`+count). plain-date 변환(`plainDateToUtcDate`/`utcDateToPlainDate`).
- Prisma `LeaveUsage`: `@db.Date`, AgentRun 역관계 없음(독립 테이블).
- plain-date(`src/agent/vacation/domain/plain-date.ts`): `parsePlainDate`, `plainDateToIso`, `plainDateToUtcDate`, `utcDateToPlainDate`, `todayInKst`, `comparePlainDate`, `addDays`.
- 등록 9단계 현재: AgentType 끝 `CAREER_MATE`, AGENT_TO_PROVIDER 끝 `CAREER_MATE:CLAUDE`(VACATION:CHATGPT), TriggerType 끝 `SLACK_MENTION_CAREER_MATE`, router.module imports+inject 끝 `CareerMateModule`/`CareerMateDispatcher`. JOB_APPLICATION 은 멘션 전용 → app.module 직접 등록 X(RouterModule 경유, CAREER_MATE 와 동일). 넛지 cron 모듈만 app.module 등록.
- 넛지 cron = CeoMetaCron 복제(scheduler OnApplicationBootstrap + repeatable, consumer @Processor+deliverOnce+SlackNotifierPort+NotificationPublisher). import: `CronIdempotencyService`(`common/queue/`), `getTodayKstDate`(`common/util/kst-date.util`), `SLACK_NOTIFIER_PORT`(`morning-briefing/domain/port/slack-notifier.port`), `LONG_RUNNING_WORKER_OPTIONS`(`common/queue/worker-options.constant`).

---

## File Structure

**신규 `src/agent/job-application/`**: domain(type/error/exception/prompt/port) · application(add/update/list usecase) · infrastructure(dispatcher/prisma.repository/formatter) · module
**신규 `src/job-application-nudge-cron/`**: domain(type) · application(scheduler) · infrastructure(consumer) · module
**수정**: `prisma/schema.prisma` · `model-router.type.ts` · `model-router.usecase.ts` · `agent-run.type.ts` · `response-code.enum.ts` · `router.module.ts` · `intent-classifier-system.prompt.ts` · `retry-run.handler.ts` · `agent-registry.ts` · `app.module.ts` · `app.config.ts` · `.env.example`

---

## Task 1: Prisma JobApplication 모델

**Files:** Modify `prisma/schema.prisma`

- [ ] **Step 1: 모델 추가** (LeaveUsage 모델 아래)
```prisma
model JobApplication {
  id             Int       @id @default(autoincrement())
  slackUserId    String    @map("slack_user_id")
  company        String
  role           String
  jdUrl          String?   @map("jd_url")
  status         String
  appliedAt      DateTime  @map("applied_at") @db.Date
  deadline       DateTime? @db.Date
  nextFollowUpAt DateTime? @map("next_follow_up_at") @db.Date
  notes          String?   @db.Text
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  @@index([slackUserId, status])
  @@map("job_application")
}
```
- [ ] **Step 2:** `pnpm -C "<wt>" prisma format && pnpm -C "<wt>" db:push && pnpm -C "<wt>" prisma:generate` → `job_application` 테이블 생성.
- [ ] **Step 3:** `pnpm -C "<wt>" build` → 성공.
- [ ] **Step 4: Commit** `git add prisma/schema.prisma && git commit -m "feat(job-application): JobApplication Prisma 모델"`

---

## Task 2: 도메인 타입 + 에러 + 예외

**Files:** Create `src/agent/job-application/domain/job-application.type.ts`, `job-application-error-code.enum.ts`, `job-application.exception.ts`

- [ ] **Step 1: 타입**
```typescript
// job-application.type.ts
import { PlainDate } from '../../vacation/domain/plain-date';

export type ApplicationStatus =
  | 'APPLIED' | 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'REJECTED' | 'WITHDRAWN';

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN',
];
export const TERMINAL_STATUSES: ApplicationStatus[] = ['OFFER', 'REJECTED', 'WITHDRAWN'];

export type JobApplicationAction = 'ADD' | 'UPDATE_STATUS' | 'LIST' | 'UNKNOWN';

export interface JobApplicationIntent {
  action: JobApplicationAction;
  company?: string;
  role?: string;
  jdUrl?: string;
  status?: ApplicationStatus;
  deadline?: PlainDate;
  ref?: string;            // UPDATE 대상 회사명 매칭용
}

export interface JobApplicationRecord {
  id: number;
  slackUserId: string;
  company: string;
  role: string;
  jdUrl: string | null;
  status: ApplicationStatus;
  appliedAt: PlainDate;
  deadline: PlainDate | null;
  nextFollowUpAt: PlainDate | null;
  notes: string | null;
  createdAt: Date;
}

export interface AddApplicationInput {
  slackUserId: string;
  company: string;
  role: string;
  jdUrl?: string;
  status?: ApplicationStatus;   // 기본 APPLIED
  appliedAt: PlainDate;          // 기본 today (dispatcher 가 주입)
  deadline?: PlainDate;
}
export interface UpdateApplicationInput {
  slackUserId: string;
  ref: string;
  status: ApplicationStatus;
}
export interface ListApplicationsInput {
  slackUserId: string;
}
```
- [ ] **Step 2: 에러코드** (VACATION 패턴)
```typescript
// job-application-error-code.enum.ts
export enum JobApplicationErrorCode {
  NL_PARSE_FAILED = 'JOB_APPLICATION_NL_PARSE_FAILED',
  MISSING_FIELDS = 'JOB_APPLICATION_MISSING_FIELDS',
  NOT_FOUND = 'JOB_APPLICATION_NOT_FOUND',
  INVALID_STATUS = 'JOB_APPLICATION_INVALID_STATUS',
}
```
- [ ] **Step 3: 예외** — `src/agent/vacation/domain/vacation.exception.ts` 를 그대로 복제하되 이름만 `JobApplicationException` + `jobApplicationErrorCode: JobApplicationErrorCode`. (DomainException 상속, errorCode getter, options{message,code,status,cause}.)
- [ ] **Step 4:** `pnpm -C "<wt>" build` → 성공.
- [ ] **Step 5: Commit** `git commit -m "feat(job-application): 도메인 타입·에러·예외"`

---

## Task 3: 파싱 프롬프트 + parseJobApplicationIntent

**Files:** Create `src/agent/job-application/domain/prompt/job-application-parse.prompt.ts` (+spec)

- [ ] **Step 1: 실패 테스트** (`...spec.ts`)
```typescript
import { JobApplicationException } from '../job-application.exception';
import { parseJobApplicationIntent } from './job-application-parse.prompt';

describe('parseJobApplicationIntent', () => {
  it('ADD 파싱 (회사/직무/마감)', () => {
    const i = parseJobApplicationIntent('{"action":"ADD","company":"토스","role":"백엔드","deadline":"2026-06-30"}');
    expect(i.action).toBe('ADD');
    expect(i.company).toBe('토스');
    expect(i.deadline).toEqual({ year: 2026, month: 6, day: 30 });
  });
  it('UPDATE_STATUS 파싱 (ref+status)', () => {
    const i = parseJobApplicationIntent('{"action":"UPDATE_STATUS","ref":"토스","status":"SCREENING"}');
    expect(i).toMatchObject({ action: 'UPDATE_STATUS', ref: '토스', status: 'SCREENING' });
  });
  it('LIST 파싱', () => {
    expect(parseJobApplicationIntent('{"action":"LIST"}').action).toBe('LIST');
  });
  it('잘못된 status 는 INVALID_STATUS 예외', () => {
    expect(() => parseJobApplicationIntent('{"action":"UPDATE_STATUS","ref":"토스","status":"WUT"}')).toThrow(JobApplicationException);
  });
  it('JSON 아니면 NL_PARSE_FAILED', () => {
    expect(() => parseJobApplicationIntent('헛소리')).toThrow(JobApplicationException);
  });
  it('알 수 없는 action → UNKNOWN', () => {
    expect(parseJobApplicationIntent('{"action":"FOO"}').action).toBe('UNKNOWN');
  });
});
```
- [ ] **Step 2:** `pnpm -C "<wt>" test job-application-parse` → FAIL.
- [ ] **Step 3: 구현**
```typescript
import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { parsePlainDate } from '../../../vacation/domain/plain-date';
import { JobApplicationException } from '../job-application.exception';
import { JobApplicationErrorCode } from '../job-application-error-code.enum';
import {
  APPLICATION_STATUSES, ApplicationStatus, JobApplicationAction, JobApplicationIntent,
} from '../job-application.type';

export const JOB_APPLICATION_PARSE_SYSTEM_PROMPT = `너는 "지원 추적" 봇의 자연어 의도 분류기다.
사용자 메시지를 아래 JSON 하나로만 변환한다. 설명/주석 없이 JSON 만.

action 은 다음 중 하나:
- "ADD": 새 지원 기록. company(회사)·role(직무) 필수. deadline(YYYY-MM-DD)·jdUrl·status 선택.
- "UPDATE_STATUS": 기존 지원의 상태 변경. ref(회사명)·status 필요.
- "LIST": 지원 현황 조회.
- "UNKNOWN": 위에 해당 없음.

status 는: APPLIED|SCREENING|INTERVIEW|OFFER|REJECTED|WITHDRAWN.
상대 날짜는 입력의 [오늘: YYYY-MM-DD] 기준으로 절대 날짜(YYYY-MM-DD)로.

예: {"action":"ADD","company":"토스","role":"백엔드","deadline":"2026-06-30"}
{"action":"UPDATE_STATUS","ref":"토스","status":"SCREENING"}
{"action":"LIST"}`;

const VALID_ACTIONS: JobApplicationAction[] = ['ADD', 'UPDATE_STATUS', 'LIST', 'UNKNOWN'];

const stripCodeFence = (text: string): string =>
  text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

const fail = (code: JobApplicationErrorCode, message: string): never => {
  throw new JobApplicationException({ code, message, status: DomainStatus.BAD_GATEWAY });
};

const parseStatus = (raw: unknown): ApplicationStatus => {
  if (typeof raw === 'string' && (APPLICATION_STATUSES as string[]).includes(raw)) {
    return raw as ApplicationStatus;
  }
  return fail(JobApplicationErrorCode.INVALID_STATUS, `상태는 ${APPLICATION_STATUSES.join('/')} 중 하나여야 합니다.`);
};

export const parseJobApplicationIntent = (text: string): JobApplicationIntent => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return fail(JobApplicationErrorCode.NL_PARSE_FAILED, '요청을 이해하지 못했습니다 — 예: "토스 백엔드 지원했어".');
  }
  if (typeof parsed !== 'object' || parsed === null || !('action' in parsed)) {
    return { action: 'UNKNOWN' };
  }
  const obj = parsed as Record<string, unknown>;
  const action = VALID_ACTIONS.includes(obj.action as JobApplicationAction)
    ? (obj.action as JobApplicationAction) : 'UNKNOWN';

  if (action === 'ADD') {
    const company = typeof obj.company === 'string' ? obj.company.trim() : '';
    const role = typeof obj.role === 'string' ? obj.role.trim() : '';
    if (!company || !role) {
      return fail(JobApplicationErrorCode.MISSING_FIELDS, '회사와 직무를 알려주세요 (예: "토스 백엔드 지원했어").');
    }
    const result: JobApplicationIntent = { action, company, role };
    if (typeof obj.jdUrl === 'string' && obj.jdUrl.trim()) { result.jdUrl = obj.jdUrl.trim(); }
    if (typeof obj.deadline === 'string') {
      const d = parsePlainDate(obj.deadline);
      if (d) { result.deadline = d; }
    }
    if (typeof obj.status === 'string') { result.status = parseStatus(obj.status); }
    return result;
  }
  if (action === 'UPDATE_STATUS') {
    const ref = typeof obj.ref === 'string' ? obj.ref.trim() : '';
    if (!ref) {
      return fail(JobApplicationErrorCode.NOT_FOUND, '어느 지원 건인지 회사명으로 알려주세요.');
    }
    return { action, ref, status: parseStatus(obj.status) };
  }
  return { action };  // LIST | UNKNOWN
};
```
- [ ] **Step 4:** `pnpm -C "<wt>" test job-application-parse` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(job-application): 자연어 파싱 프롬프트 + 파서"`

---

## Task 4: 리포지토리 (포트 + Prisma)

**Files:** Create `domain/port/job-application.repository.port.ts`, `infrastructure/job-application.prisma.repository.ts` (+spec)

- [ ] **Step 1: 포트**
```typescript
// job-application.repository.port.ts
import { ApplicationStatus, JobApplicationRecord } from '../job-application.type';
import { PlainDate } from '../../../vacation/domain/plain-date';

export const JOB_APPLICATION_REPOSITORY_PORT = Symbol('JOB_APPLICATION_REPOSITORY_PORT');

export interface SaveApplicationInput {
  slackUserId: string; company: string; role: string; jdUrl?: string;
  status: ApplicationStatus; appliedAt: PlainDate; deadline?: PlainDate;
}
export interface JobApplicationRepositoryPort {
  save(input: SaveApplicationInput): Promise<JobApplicationRecord>;
  updateStatusByCompany(input: { slackUserId: string; companyRef: string; status: ApplicationStatus }): Promise<JobApplicationRecord | null>;
  listByUser(slackUserId: string): Promise<JobApplicationRecord[]>;
  findDueNudges(input: { slackUserId: string; today: PlainDate; deadlineWithinDays: number }): Promise<JobApplicationRecord[]>;
}
```
- [ ] **Step 2: 실패 테스트** (mock PrismaService — VACATION repo spec 패턴; create/findFirst/updateMany/findMany mock 후 호출 인자 검증). 최소:
```typescript
import { JobApplicationPrismaRepository } from './job-application.prisma.repository';
import { PrismaService } from '../../../prisma/prisma.service';

describe('JobApplicationPrismaRepository', () => {
  it('save 는 plainDate 를 UTC Date 로 저장하고 record 반환', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 1, slackUserId: 'U1', company: '토스', role: '백엔드', jdUrl: null,
      status: 'APPLIED', appliedAt: new Date(Date.UTC(2026, 5, 16)), deadline: null,
      nextFollowUpAt: null, notes: null, createdAt: new Date(),
    });
    const prisma = { jobApplication: { create } } as unknown as PrismaService;
    const repo = new JobApplicationPrismaRepository(prisma);
    const rec = await repo.save({ slackUserId: 'U1', company: '토스', role: '백엔드', status: 'APPLIED', appliedAt: { year: 2026, month: 6, day: 16 } });
    expect(rec.company).toBe('토스');
    expect(rec.appliedAt).toEqual({ year: 2026, month: 6, day: 16 });
    expect(create.mock.calls[0][0].data.slackUserId).toBe('U1');
  });
  it('updateStatusByCompany — 없으면 null', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = { jobApplication: { findFirst } } as unknown as PrismaService;
    const repo = new JobApplicationPrismaRepository(prisma);
    expect(await repo.updateStatusByCompany({ slackUserId: 'U1', companyRef: 'X', status: 'SCREENING' })).toBeNull();
  });
});
```
- [ ] **Step 3:** `pnpm -C "<wt>" test job-application.prisma.repository` → FAIL.
- [ ] **Step 4: 구현**
```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  addDays, plainDateToUtcDate, utcDateToPlainDate, PlainDate,
} from '../../vacation/domain/plain-date';
import {
  ApplicationStatus, JobApplicationRecord, TERMINAL_STATUSES,
} from '../job-application.type';
import {
  JobApplicationRepositoryPort, SaveApplicationInput,
} from '../domain/port/job-application.repository.port';

type Row = {
  id: number; slackUserId: string; company: string; role: string; jdUrl: string | null;
  status: string; appliedAt: Date; deadline: Date | null; nextFollowUpAt: Date | null;
  notes: string | null; createdAt: Date;
};
const mapRow = (row: Row): JobApplicationRecord => ({
  id: row.id, slackUserId: row.slackUserId, company: row.company, role: row.role,
  jdUrl: row.jdUrl, status: row.status as ApplicationStatus,
  appliedAt: utcDateToPlainDate(row.appliedAt),
  deadline: row.deadline ? utcDateToPlainDate(row.deadline) : null,
  nextFollowUpAt: row.nextFollowUpAt ? utcDateToPlainDate(row.nextFollowUpAt) : null,
  notes: row.notes, createdAt: row.createdAt,
});

@Injectable()
export class JobApplicationPrismaRepository implements JobApplicationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(input: SaveApplicationInput): Promise<JobApplicationRecord> {
    const row = await this.prisma.jobApplication.create({
      data: {
        slackUserId: input.slackUserId, company: input.company, role: input.role,
        jdUrl: input.jdUrl ?? null, status: input.status,
        appliedAt: plainDateToUtcDate(input.appliedAt),
        deadline: input.deadline ? plainDateToUtcDate(input.deadline) : null,
      },
    });
    return mapRow(row);
  }

  // 회사명 부분일치 + 비종료 상태 중 최신 1건의 status 갱신.
  async updateStatusByCompany({
    slackUserId, companyRef, status,
  }: { slackUserId: string; companyRef: string; status: ApplicationStatus }): Promise<JobApplicationRecord | null> {
    const target = await this.prisma.jobApplication.findFirst({
      where: {
        slackUserId,
        company: { contains: companyRef, mode: Prisma.QueryMode.insensitive },
        status: { notIn: TERMINAL_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!target) { return null; }
    const row = await this.prisma.jobApplication.update({
      where: { id: target.id }, data: { status },
    });
    return mapRow(row);
  }

  async listByUser(slackUserId: string): Promise<JobApplicationRecord[]> {
    const rows = await this.prisma.jobApplication.findMany({
      where: { slackUserId }, orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapRow);
  }

  // (마감 today~+N일 & 비종료) OR (nextFollowUpAt ≤ today & 비종료)
  async findDueNudges({
    slackUserId, today, deadlineWithinDays,
  }: { slackUserId: string; today: PlainDate; deadlineWithinDays: number }): Promise<JobApplicationRecord[]> {
    const todayUtc = plainDateToUtcDate(today);
    const horizonUtc = plainDateToUtcDate(addDays(today, deadlineWithinDays));
    const rows = await this.prisma.jobApplication.findMany({
      where: {
        slackUserId,
        status: { notIn: TERMINAL_STATUSES },
        OR: [
          { deadline: { gte: todayUtc, lte: horizonUtc } },
          { nextFollowUpAt: { lte: todayUtc } },
        ],
      },
      orderBy: { deadline: 'asc' },
    });
    return rows.map(mapRow);
  }
}
```
- [ ] **Step 5:** `pnpm -C "<wt>" test job-application.prisma.repository` → PASS.
- [ ] **Step 6: Commit** `git commit -m "feat(job-application): 리포지토리 포트 + Prisma 구현"`

---

## Task 5: CRUD usecases (Add/Update/List)

**Files:** Create `application/add-application.usecase.ts`, `update-application.usecase.ts`, `list-applications.usecase.ts` (+specs)

> Add/Update 는 VACATION register/cancel 처럼 `agentRunService.execute` 래핑(상태변경 audit). List 는 비래핑(조회).

- [ ] **Step 1: 실패 테스트** (각 usecase, mock repository + agentRunService). 예 (Add):
```typescript
import { AddApplicationUsecase } from './add-application.usecase';
const makeAgentRun = () => ({
  execute: jest.fn(async ({ run }: { run: (c: { agentRunId: number }) => Promise<{ result: unknown; modelUsed: string; output: unknown }> }) => {
    const r = await run({ agentRunId: 7 }); return { result: r.result, modelUsed: r.modelUsed, agentRunId: 7 };
  }),
});
describe('AddApplicationUsecase', () => {
  it('repository.save 호출 + 결과 반환', async () => {
    const repository = { save: jest.fn().mockResolvedValue({ id: 1, company: '토스', role: '백엔드', status: 'APPLIED' }) };
    const agentRunService = makeAgentRun();
    const u = new AddApplicationUsecase(repository as never, agentRunService as never);
    const outcome = await u.execute({ slackUserId: 'U1', company: '토스', role: '백엔드', status: 'APPLIED', appliedAt: { year: 2026, month: 6, day: 16 } });
    expect(outcome.result.company).toBe('토스');
    expect(repository.save).toHaveBeenCalledTimes(1);
  });
});
```
(Update spec: repository.updateStatusByCompany → null 이면 JobApplicationException(NOT_FOUND). List spec: repository.listByUser 직접 반환, agentRun 미사용.)
- [ ] **Step 2:** `pnpm -C "<wt>" test add-application list-applications update-application` → FAIL.
- [ ] **Step 3: 구현**
```typescript
// add-application.usecase.ts
import { Inject, Injectable } from '@nestjs/common';
import { AgentRunOutcome, AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { AddApplicationInput, JobApplicationRecord } from '../domain/job-application.type';
import { JOB_APPLICATION_REPOSITORY_PORT, JobApplicationRepositoryPort } from '../domain/port/job-application.repository.port';

@Injectable()
export class AddApplicationUsecase {
  constructor(
    @Inject(JOB_APPLICATION_REPOSITORY_PORT) private readonly repository: JobApplicationRepositoryPort,
    private readonly agentRunService: AgentRunService,
  ) {}
  async execute(input: AddApplicationInput): Promise<AgentRunOutcome<JobApplicationRecord>> {
    return this.agentRunService.execute<JobApplicationRecord>({
      agentType: AgentType.JOB_APPLICATION,
      triggerType: TriggerType.SLACK_MENTION_JOB_APPLICATION,
      inputSnapshot: { slackUserId: input.slackUserId, company: input.company, role: input.role, action: 'ADD' },
      run: async () => {
        const record = await this.repository.save(input);
        return { result: record, modelUsed: 'deterministic', output: record };
      },
    });
  }
}
```
```typescript
// update-application.usecase.ts
import { Inject, Injectable } from '@nestjs/common';
import { AgentRunOutcome, AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { JobApplicationException } from '../domain/job-application.exception';
import { JobApplicationErrorCode } from '../domain/job-application-error-code.enum';
import { JobApplicationRecord, UpdateApplicationInput } from '../domain/job-application.type';
import { JOB_APPLICATION_REPOSITORY_PORT, JobApplicationRepositoryPort } from '../domain/port/job-application.repository.port';

@Injectable()
export class UpdateApplicationUsecase {
  constructor(
    @Inject(JOB_APPLICATION_REPOSITORY_PORT) private readonly repository: JobApplicationRepositoryPort,
    private readonly agentRunService: AgentRunService,
  ) {}
  async execute({ slackUserId, ref, status }: UpdateApplicationInput): Promise<AgentRunOutcome<JobApplicationRecord>> {
    return this.agentRunService.execute<JobApplicationRecord>({
      agentType: AgentType.JOB_APPLICATION,
      triggerType: TriggerType.SLACK_MENTION_JOB_APPLICATION,
      inputSnapshot: { slackUserId, ref, status, action: 'UPDATE_STATUS' },
      run: async () => {
        const updated = await this.repository.updateStatusByCompany({ slackUserId, companyRef: ref, status });
        if (!updated) {
          throw new JobApplicationException({
            code: JobApplicationErrorCode.NOT_FOUND,
            message: `"${ref}" 에 해당하는 진행 중 지원 건을 찾지 못했습니다.`,
            status: DomainStatus.NOT_FOUND,
          });
        }
        return { result: updated, modelUsed: 'deterministic', output: updated };
      },
    });
  }
}
```
```typescript
// list-applications.usecase.ts
import { Inject, Injectable } from '@nestjs/common';
import { JobApplicationRecord, ListApplicationsInput } from '../domain/job-application.type';
import { JOB_APPLICATION_REPOSITORY_PORT, JobApplicationRepositoryPort } from '../domain/port/job-application.repository.port';

@Injectable()
export class ListApplicationsUsecase {
  constructor(
    @Inject(JOB_APPLICATION_REPOSITORY_PORT) private readonly repository: JobApplicationRepositoryPort,
  ) {}
  async execute({ slackUserId }: ListApplicationsInput): Promise<JobApplicationRecord[]> {
    return this.repository.listByUser(slackUserId);
  }
}
```
- [ ] **Step 4:** `pnpm -C "<wt>" test add-application list-applications update-application` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(job-application): Add/Update/List usecase"`

---

## Task 6: 포매터

**Files:** Create `infrastructure/job-application.formatter.ts` (+spec)

- [ ] **Step 1: 실패 테스트** — `formatApplicationList([record])` 가 회사/직무/상태 포함 + 빈 목록 안내; `formatAdded(record)`·`formatUpdated(record)`·`formatNudge(records)` 가 회사명 포함 + LLM/사용자 텍스트(company/role/notes) escape. (career-mate.formatter 의 escapeSlackMrkdwn 로컬 const 동일 복제.)
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: 구현** — `formatApplicationList`(상태별/최신순 목록), `formatAdded`, `formatUpdated`, `formatNudge`(마감 임박/팔로업 리스트), `formatUnknownJobApplication`(사용법). 모든 사용자 입력 필드(company/role/notes)에 `escapeSlackMrkdwn(&<>)` 적용. plainDateToIso 로 날짜 표시.
- [ ] **Step 4:** PASS. - [ ] **Step 5: Commit** `git commit -m "feat(job-application): Slack 포매터"`

---

## Task 7: 디스패처 + 모듈

**Files:** Create `infrastructure/job-application.dispatcher.ts` (+spec), `job-application.module.ts`

- [ ] **Step 1: 실패 테스트** — dispatch("{action:ADD,...}") → addApplication 호출; UPDATE_STATUS → update; LIST → list; UNKNOWN → 안내. (mock modelRouter.route + usecases. VacationDispatcher spec 패턴.)
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: 구현** (VacationDispatcher 패턴)
```typescript
import { Injectable } from '@nestjs/common';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import { AgentDispatcher, DispatchOutcome } from '../../../router/domain/port/agent-dispatcher.port';
import { plainDateToIso, todayInKst } from '../../vacation/domain/plain-date';
import { AddApplicationUsecase } from '../application/add-application.usecase';
import { ListApplicationsUsecase } from '../application/list-applications.usecase';
import { UpdateApplicationUsecase } from '../application/update-application.usecase';
import {
  JOB_APPLICATION_PARSE_SYSTEM_PROMPT, parseJobApplicationIntent,
} from '../domain/prompt/job-application-parse.prompt';
import {
  formatAdded, formatApplicationList, formatUnknownJobApplication, formatUpdated,
} from './job-application.formatter';

@Injectable()
export class JobApplicationDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.JOB_APPLICATION;
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly addApplication: AddApplicationUsecase,
    private readonly updateApplication: UpdateApplicationUsecase,
    private readonly listApplications: ListApplicationsUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const slackUserId = input.slackUserId;
    const today = todayInKst(new Date());
    const completion = await this.modelRouter.route({
      agentType: AgentType.JOB_APPLICATION,
      request: { prompt: `[오늘: ${plainDateToIso(today)}]\n${input.text ?? ''}`, systemPrompt: JOB_APPLICATION_PARSE_SYSTEM_PROMPT },
    });
    const intent = parseJobApplicationIntent(completion.text);
    switch (intent.action) {
      case 'ADD': {
        const outcome = await this.addApplication.execute({
          slackUserId, company: intent.company!, role: intent.role!,
          jdUrl: intent.jdUrl, status: intent.status ?? 'APPLIED',
          appliedAt: today, deadline: intent.deadline,
        });
        return this.toOutcome(outcome.agentRunId, outcome.result, formatAdded(outcome.result));
      }
      case 'UPDATE_STATUS': {
        const outcome = await this.updateApplication.execute({ slackUserId, ref: intent.ref!, status: intent.status! });
        return this.toOutcome(outcome.agentRunId, outcome.result, formatUpdated(outcome.result));
      }
      case 'LIST': {
        const records = await this.listApplications.execute({ slackUserId });
        return this.toOutcome(0, records, formatApplicationList(records));
      }
      default:
        return this.toOutcome(0, { action: 'UNKNOWN' }, formatUnknownJobApplication());
    }
  }
  private toOutcome(agentRunId: number, output: unknown, formattedText: string): DispatchOutcome {
    return { agentRunId, output, modelUsed: 'deterministic', formattedText };
  }
}
```
- [ ] **Step 4: 모듈** (VacationModule 패턴)
```typescript
import { Module } from '@nestjs/common';
import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { AddApplicationUsecase } from './application/add-application.usecase';
import { ListApplicationsUsecase } from './application/list-applications.usecase';
import { UpdateApplicationUsecase } from './application/update-application.usecase';
import { JOB_APPLICATION_REPOSITORY_PORT } from './domain/port/job-application.repository.port';
import { JobApplicationDispatcher } from './infrastructure/job-application.dispatcher';
import { JobApplicationPrismaRepository } from './infrastructure/job-application.prisma.repository';

@Module({
  imports: [AgentRunModule, ModelRouterModule],
  providers: [
    { provide: JOB_APPLICATION_REPOSITORY_PORT, useClass: JobApplicationPrismaRepository },
    AddApplicationUsecase, UpdateApplicationUsecase, ListApplicationsUsecase, JobApplicationDispatcher,
  ],
  exports: [AddApplicationUsecase, UpdateApplicationUsecase, ListApplicationsUsecase, JobApplicationDispatcher],
})
export class JobApplicationModule {}
```
- [ ] **Step 5:** `pnpm -C "<wt>" test job-application.dispatcher` → PASS. (build 는 Task 8 의 AgentType 추가 후 통과 — 이 시점 AgentType.JOB_APPLICATION 미정의로 실패 가능, Task 8 과 함께 green.)
- [ ] **Step 6: Commit** `git commit -m "feat(job-application): 디스패처 + 모듈"`

---

## Task 8: 에이전트 등록 9단계

**Files:** `model-router.type.ts`, `model-router.usecase.ts`, `agent-run.type.ts`, `response-code.enum.ts`, `router.module.ts`, `intent-classifier-system.prompt.ts`, `retry-run.handler.ts`, `agent-registry.ts`

- [ ] **Step 1:** AgentType — `CAREER_MATE = 'CAREER_MATE',` 아래 `JOB_APPLICATION = 'JOB_APPLICATION',`
- [ ] **Step 2:** AGENT_TO_PROVIDER — `[AgentType.CAREER_MATE]: ...CLAUDE,` 아래 `[AgentType.JOB_APPLICATION]: ModelProviderName.CHATGPT, // 파라미터 추출 경량 — VACATION 동일`
- [ ] **Step 3:** TriggerType — `SLACK_MENTION_CAREER_MATE = ...,` 아래 `SLACK_MENTION_JOB_APPLICATION = 'SLACK_MENTION_JOB_APPLICATION',`
- [ ] **Step 4:** ResponseCode — career-mate 블록 아래:
```typescript
  // Job Application — JobApplicationErrorCode 와 1:1 동기화
  JOB_APPLICATION_NL_PARSE_FAILED = 'JOB_APPLICATION_NL_PARSE_FAILED',
  JOB_APPLICATION_MISSING_FIELDS = 'JOB_APPLICATION_MISSING_FIELDS',
  JOB_APPLICATION_NOT_FOUND = 'JOB_APPLICATION_NOT_FOUND',
  JOB_APPLICATION_INVALID_STATUS = 'JOB_APPLICATION_INVALID_STATUS',
```
- [ ] **Step 5:** router.module — 상단 import `JobApplicationModule`/`JobApplicationDispatcher`; imports 배열 `CareerMateModule,` 아래 `JobApplicationModule,`; AGENT_DISPATCHER_PORT inject 배열 `CareerMateDispatcher,` 아래 `JobApplicationDispatcher,`
- [ ] **Step 6:** intent-classifier prompt — CAREER_MATE 줄 아래:
```
- JOB_APPLICATION: 지원 추적 (회사/직무 지원 기록·상태변경·조회) ("토스 백엔드 지원했어", "토스 서류 합격", "지원 현황", "어디 지원했더라")
```
- [ ] **Step 7:** retry-run.handler — CAREER_MATE case 아래:
```typescript
        case 'JOB_APPLICATION': {
          await respond({ response_type: 'ephemeral', replace_original: true,
            text: `AgentRun #${id} (JOB_APPLICATION) 은 입력 의존 기록이라 retry 미지원 — 자연어로 다시 말씀해주세요.` });
          return;
        }
```
- [ ] **Step 8:** agent-registry — CAREER_MATE 엔트리 아래:
```typescript
  {
    agentType: AgentType.JOB_APPLICATION,
    displayName: 'Job Application',
    slashCommands: [],
    usecasePath: 'src/agent/job-application/application/add-application.usecase.ts',
    description: '지원 추적 CRM (회사/직무 지원 기록·상태·조회, 자연어 멘션 + 넛지 cron)',
  },
```
- [ ] **Step 9:** `pnpm -C "<wt>" build && pnpm -C "<wt>" test "job-application|agent-registry"` → green (Record exhaustive + registry 망라 통과).
- [ ] **Step 10: Commit** `git commit -m "feat(job-application): 에이전트 등록 9단계"`

---

## Task 9: 넛지 cron (CeoMetaCron 복제) + app.module + env

**Files:** Create `src/job-application-nudge-cron/{domain,application,infrastructure}/*` + module; Modify `app.module.ts`, `app.config.ts`, `.env.example`

> CeoMetaCron(`src/ceo-meta-cron/`) + Phase 4 의 ResumeCalibrationCron 구조를 그대로 복제. import 경로는 **실제 CeoMetaCron consumer 의 import 줄을 그대로** (CronIdempotencyService=`common/queue/`, getTodayKstDate=`common/util/kst-date.util`, SLACK_NOTIFIER_PORT, LONG_RUNNING_WORKER_OPTIONS, NotificationPublisher).

- [ ] **Step 1: 타입** `domain/job-application-nudge-cron.type.ts`
```typescript
export const JOB_APPLICATION_NUDGE_CRON_QUEUE = 'job-application-nudge-cron';
export interface JobApplicationNudgeCronJobData { ownerSlackUserId: string; target: string; }
export const DEFAULT_JOB_APPLICATION_NUDGE_CRON = '0 9 * * *';
export const DEFAULT_JOB_APPLICATION_NUDGE_TIMEZONE = 'Asia/Seoul';
export const NUDGE_DEADLINE_WITHIN_DAYS = 3;
```
- [ ] **Step 2: 스케줄러** — Phase 4 `ResumeCalibrationCronScheduler` 를 복제, env 키 `JOB_APPLICATION_NUDGE_OWNER_SLACK_USER_ID`/`_TARGET`/`_CRON`/`_TIMEZONE`, queue/jobId 이름만 교체. (+spec: owner 미설정 비활성 / 설정 시 등록.)
- [ ] **Step 3: 컨슈머** `infrastructure/job-application-nudge-cron.consumer.ts`
```typescript
@Processor(JOB_APPLICATION_NUDGE_CRON_QUEUE, LONG_RUNNING_WORKER_OPTIONS)
export class JobApplicationNudgeCronConsumer extends WorkerHost {
  constructor(
    @Inject(JOB_APPLICATION_REPOSITORY_PORT) private readonly repository: JobApplicationRepositoryPort,
    @Inject(SLACK_NOTIFIER_PORT) private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
    @Optional() private readonly notificationPublisher?: NotificationPublisher,
  ) { super(); }

  async process(job: Job<JobApplicationNudgeCronJobData>): Promise<void> {
    const { ownerSlackUserId, target } = job.data;
    const todayKst = getTodayKstDate();
    try {
      const due = await this.repository.findDueNudges({
        slackUserId: ownerSlackUserId, today: todayInKst(new Date()), deadlineWithinDays: NUDGE_DEADLINE_WITHIN_DAYS,
      });
      if (due.length === 0) {
        this.logger.log(`Job Application Nudge — due 0건, skip (${ownerSlackUserId})`);
        return;   // 조용히 skip (매일 빈 DM 방지)
      }
      const text = `📌 *지원 넛지 — ${todayKst}*\n\n` + formatNudge(due);
      await this.deliverOnce(target, text);
    } catch (error) {
      this.logger.error(`Job Application Nudge 실패 (${ownerSlackUserId})`, error);
      this.notifyOwnerFailure(ownerSlackUserId, error);
      throw error;
    }
  }
  // deliverOnce / notifyOwnerFailure — CeoMetaCron consumer 와 동일 복제 (queue 이름만 교체)
}
```
(+spec: due 있음→postMessage / due 0건→postMessage 미호출.)
> `todayInKst`(plain-date)와 `getTodayKstDate`(cron util) 둘 다 사용 — 전자는 repository PlainDate 인자용, 후자는 메시지/idempotency 키용. CeoMetaCron 과 동일.
- [ ] **Step 4: 모듈** — ResumeCalibrationCron 모듈 복제: `BullModule.registerQueue({name: JOB_APPLICATION_NUDGE_CRON_QUEUE})`, `JobApplicationModule` import(repository 토큰 주입), `SlackModule`+`{provide:SLACK_NOTIFIER_PORT, useExisting:SlackService}`, `NotificationQueueModule`, scheduler+consumer providers.
  > repository 토큰: JobApplicationModule 이 `JOB_APPLICATION_REPOSITORY_PORT` 를 **export 해야** consumer 가 주입 가능 → Task 7 module 의 exports 에 `{provide: JOB_APPLICATION_REPOSITORY_PORT, ...}` 대신 **토큰 export 추가** 또는 cron 모듈에서 repository 재provide. 구현 시 JobApplicationModule exports 에 `JOB_APPLICATION_REPOSITORY_PORT` 추가(권장).
- [ ] **Step 5: app.module** — `ResumeCalibrationCronModule,` 옆에 `JobApplicationNudgeCronModule,` import+등록.
- [ ] **Step 6: app.config + .env.example** — `RESUME_CALIBRATION_*` 블록 패턴으로 `JOB_APPLICATION_NUDGE_OWNER_SLACK_USER_ID`/`_TARGET`/`_CRON`(기본 `0 9 * * *`)/`_TIMEZONE` 4개 @IsOptional @IsString. .env.example 블록 추가.
- [ ] **Step 7:** `pnpm -C "<wt>" build && pnpm -C "<wt>" test job-application-nudge-cron` → green.
- [ ] **Step 8: Commit** `git commit -m "feat(job-application): 넛지 cron + app.module/env"`

---

## Task 10: 최종 검증 (4중 green)

- [ ] **Step 1:** `pnpm -C "<wt>" lint:check` → 0 errors.
- [ ] **Step 2:** `pnpm -C "<wt>" test "job-application|agent-registry"` → 전부 pass. (code-graph flake 무관.)
- [ ] **Step 3:** `pnpm -C "<wt>" build` → exit 0.
- [ ] **Step 4:** `pnpm -C "<wt>" docs:check` → 신규 에이전트(agent-catalog) + 신규 env(env-catalog) 드리프트 → `pnpm -C "<wt>" docs:sync` 후 커밋, 재확인 OK.
- [ ] **Step 5:** 4개 비-0 이면 해당 Task 복귀.
- [ ] **Step 6 (owner 수동):** `.env` 에 `JOB_APPLICATION_NUDGE_OWNER_SLACK_USER_ID` 등 + 봇 재시작 → `@이대리 토스 백엔드 지원했어` → `토스 서류 합격` → `지원 현황` / 넛지 DM 확인.

---

## 자기 점검 (작성자)

- **스펙 커버리지**: §3 흐름→Task 7/9, §4 모델→Task 1, §5 파싱→Task 3, §6 넛지→Task 9, §7 컴포넌트→Task 1~9, §8 AgentRun 래핑(Add/Update 래핑·List 비래핑)→Task 5, §9 에러→Task 2/3/5, §10 테스트→각 Task+Task 10. ✅
- **placeholder**: 없음. (cron import 경로·repository 토큰 export 는 "CeoMetaCron 동일"·"JobApplicationModule exports 에 토큰 추가" 로 구체 지시.)
- **타입 일관성**: `ApplicationStatus`/`JobApplicationIntent`/`JobApplicationRecord`/`JOB_APPLICATION_REPOSITORY_PORT`/`parseJobApplicationIntent`/`findDueNudges`/`updateStatusByCompany`/`AgentType.JOB_APPLICATION`/`SLACK_MENTION_JOB_APPLICATION`/`formatNudge` — Task 간 일치. ✅
- **docs:check**: 신규 에이전트+env → docs:sync 필요(Task 10 명시).
- **열린 항목**: JobApplicationModule 이 repository 토큰 export(cron 주입용) — Task 9 Step 4 명시. UPDATE 다중매칭은 "최신 1건" 으로 단순화(§12 가정).
