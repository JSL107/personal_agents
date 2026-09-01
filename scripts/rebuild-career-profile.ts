import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { CareerMateModule } from '../src/agent/career-mate/career-mate.module';
import {
  CareerProfileData,
  ProfileAccomplishment,
} from '../src/agent/career-mate/domain/career-mate.type';
import { extractPrReferences } from '../src/agent/career-mate/domain/extract-pr-reference';
import { groupPrRefsByRepo } from '../src/agent/career-mate/domain/group-pr-refs';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../src/agent/career-mate/domain/port/career-profile.repository.port';
import {
  buildMultiPrRetroPrompt,
  buildPrRetroPrompt,
  MULTI_PR_RETRO_SYNTH_SYSTEM_PROMPT,
  parsePrRetroOutput,
  PR_RETRO_SYNTH_SYSTEM_PROMPT,
} from '../src/agent/career-mate/domain/prompt/pr-retro-synth.prompt';
import {
  reconcileAccomplishmentEvidence,
  toPrNumber,
} from '../src/agent/career-mate/domain/reconcile-accomplishment-evidence';
import { AgentRunModule } from '../src/agent-run/agent-run.module';
import { AgentRunService } from '../src/agent-run/application/agent-run.service';
import { TriggerType } from '../src/agent-run/domain/agent-run.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../src/github/domain/port/github-client.port';
import { GithubModule } from '../src/github/github.module';
import { HumanizeService } from '../src/humanize/application/humanize.service';
import { humanizeCareerProfile } from '../src/humanize/application/humanize-career-profile.adapter';
import { HumanizeModule } from '../src/humanize/humanize.module';
import { ModelRouterUsecase } from '../src/model-router/application/model-router.usecase';
import { AgentType } from '../src/model-router/domain/model-router.type';
import { ModelRouterModule } from '../src/model-router/model-router.module';
import { PreviewGateModule } from '../src/preview-gate/preview-gate.module';
import { PrismaModule } from '../src/prisma/prisma.module';

// 사용법:
//   pnpm exec ts-node scripts/rebuild-career-profile.ts --owner <SLACK_USER_ID>          (미리보기)
//   pnpm exec ts-node scripts/rebuild-career-profile.ts --owner <SLACK_USER_ID> --apply  (실제 저장)
//
// #427 이전에 쌓인 성과는 하루치 PR 을 저장소 구분 없이 한 덩어리로 회고한 결과라, 회사·개인
// 저장소가 한 문장에 섞여 있다. #427 은 앞으로 생길 성과만 고치므로 이미 저장된 것은 풀리지
// 않는다 — 프로필은 한 번 저장되면 매 회차 그대로 재사용되기 때문이다
// (publish-portfolio-site.usecase 의 resolveProfile).
//
// 이 CLI 는 저장된 성과의 근거 PR 을 저장소별로 다시 나눠 회고를 새로 돌리고, 결과를
// career_profile 새 행 **하나**로 저장한다. 1회성 도구다.
//
// ⚠️ ReflectPrUsecase 를 그룹마다 부르지 않는 이유 — 그 경로는 "최신 프로필 조회 → 병합 →
//    저장" 이라 기존 34건 위에 새 성과를 얹는다. dedup 키가 evidence[0] 하나뿐이라
//    (merge-accomplishment.ts) 쪼갠 성과의 첫 PR 이 원본과 다르면 원본 혼합 성과가 그대로
//    남아 목표(혼합 0건)를 달성할 수 없다. 게다가 회고 1회마다 노션 포트폴리오를 통째로
//    다시 쓴다(RenderPortfolioUsecase). 그래서 모델 호출 부분만 같은 프롬프트로 재현한다.
//
// ⚠️ AppModule 전체를 부팅하지 않는다. 전체 부팅은 실행 중인 서버의 BullMQ repeatable job 을
//    재등록해 남의 cron 을 지운다. 필요한 모듈만 올린다.
const USAGE = [
  '사용법:',
  '  pnpm exec ts-node scripts/rebuild-career-profile.ts --owner <SLACK_USER_ID> [--apply]',
  '',
  '  --apply       실제로 저장한다. 없으면 계획만 출력하고 모델을 부르지 않는다.',
  '  --backup-dir  백업 파일을 둘 디렉터리 (기본: 현재 디렉터리)',
  '  --limit       앞에서 N 개 성과만 처리 (실증용)',
].join('\n');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AgentRunModule,
    // CareerMateModule 의 형제 usecase(AnalyzeJdGapUsecase)가 CreatePreviewUsecase 를 물고 있어
    // 게이트가 없으면 모듈 자체가 뜨지 않는다. 이 CLI 는 승인 카드를 만들지 않으므로 빈 게이트.
    PreviewGateModule.forRoot({ appliers: [] }),
    CareerMateModule,
    // CareerMateModule 은 아래 셋을 export 하지 않아 따로 올린다.
    GithubModule,
    ModelRouterModule,
    HumanizeModule,
  ],
})
class RebuildCareerProfileCliModule {}

// ReflectPrUsecase 와 같은 값이어야 프롬프트에 담기는 diff 양이 회고 경로와 같아진다.
const TOTAL_DIFF_BUDGET = 80_000;
const MIN_PER_PR_DIFF_BYTES = 8_000;

// 윤문은 필드를 JSON 한 덩어리로 모델에 보낸다(humanize.service). 성과 하나가 6필드라
// 전량을 한 번에 보내면 프롬프트가 커져 모델이 키를 빠뜨릴 위험이 커진다 — 나눠 부른다.
const HUMANIZE_CHUNK_SIZE = 10;

interface RetroDeps {
  githubClient: GithubClientPort;
  modelRouter: ModelRouterUsecase;
}

interface PlannedGroup {
  // 이 그룹을 만들어낸 원본 성과의 위치. 실패 시 원본을 되살리는 데 쓴다.
  sourceIndex: number;
  repo: string;
  refs: string[];
}

interface RebuildPlan {
  groups: PlannedGroup[];
  droppedRefCount: number;
  // 사람이 적은 맥락이 실려 있어 재구축하지 않고 원본을 그대로 두는 성과의 위치.
  preservedIndexes: number[];
}

interface GroupFailure {
  sourceIndex: number;
  repo: string;
  refs: string[];
  reason: string;
}

interface RetroResult {
  accomplishment: ProfileAccomplishment;
  modelUsed: string;
}

interface RebuildOutcome {
  accomplishments: ProfileAccomplishment[];
  failures: GroupFailure[];
  restoredIndexes: number[];
  // 원장에 남길 대표 모델. 그룹마다 같은 라우팅을 타므로 마지막 성공 회차 값을 쓴다.
  modelUsed: string;
}

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
};

const hasFlag = (name: string): boolean => {
  return process.argv.includes(`--${name}`);
};

const ownerOf = (repo: string): string => {
  return repo.split('/')[0] ?? '';
};

// 소유자가 둘 이상 섞인 성과. 이 값이 0 이 되는 것이 재구축의 목표다.
const countMixedOwner = (accomplishments: ProfileAccomplishment[]): number => {
  return accomplishments.filter((item) => {
    const owners = new Set(item.evidence.map((each) => ownerOf(each.repo)));
    return owners.size > 1;
  }).length;
};

// 근거 PR 총 건수. career_profile.pr_count 컬럼은 성과당 evidence[0] 만 세므로
// (merge-accomplishment.ts) 실제 PR 수가 아니다 — 유실 대조는 반드시 이 값으로 한다.
const countEvidence = (accomplishments: ProfileAccomplishment[]): number => {
  return accomplishments.reduce((sum, item) => sum + item.evidence.length, 0);
};

// 같은 PR 이 두 성과의 근거로 겹칠 수 있다. 유실 대조는 겹침을 걷어낸 값으로도 함께 본다.
const countDistinctEvidence = (
  accomplishments: ProfileAccomplishment[],
): number => {
  const keys = new Set<string>();
  accomplishments.forEach((item) => {
    item.evidence.forEach((each) => {
      keys.add(`${each.repo}#${toPrNumber(each.pr)}`);
    });
  });
  return keys.size;
};

// career_profile.pr_count 에 넣을 값. mergeAccomplishment 와 같은 규칙(성과당 evidence[0] 의
// distinct 수)을 쓴다 — 저장 경로가 달라졌다고 컬럼 의미까지 달라지면 기존 행과 대조가 깨진다.
const countProfilePrCount = (
  accomplishments: ProfileAccomplishment[],
): number => {
  const keys = new Set<string>();
  accomplishments.forEach((item) => {
    const first = item.evidence[0];
    if (first) {
      keys.add(`${first.repo}#${toPrNumber(first.pr)}`);
    }
  });
  return keys.size;
};

const buildPlan = (accomplishments: ProfileAccomplishment[]): RebuildPlan => {
  const groups: PlannedGroup[] = [];
  const preservedIndexes: number[] = [];
  let droppedRefCount = 0;
  accomplishments.forEach((accomplishment, sourceIndex) => {
    // 사람이 승인 카드에 적은 맥락(impactContext)이 실린 성과는 손대지 않는다.
    // PR·diff 에 없고 사람 기억에만 있던 문장이라 회고를 다시 돌려도 모델이 만들어 내지
    // 못한다(preserve-impact-context.ts). 게다가 성과를 저장소별로 쪼개면 그 한 줄을 어느
    // 조각에 붙일지 정할 수 없고, 아무 데나 붙이면 회사 저장소의 수치가 개인 성과에 실린다
    // — #427 이 막으려던 바로 그 문제다.
    // 잃는 것도 없다: 맥락이 붙은 성과는 #427 이후에 생겨 이미 저장소 단일이다.
    if (accomplishment.impactContext?.trim()) {
      preservedIndexes.push(sourceIndex);
      return;
    }
    // 성과 하나씩 넘긴다. groupPrRefsByRepo 의 상한(그룹 5개·그룹당 PR 8건)은 하루치 회고를
    // 전제한 값이라, 전체 PR 을 한꺼번에 넘기면 대부분이 droppedRefCount 로 버려진다.
    const grouped = groupPrRefsByRepo(
      accomplishment.evidence.map((each) => ({
        repo: each.repo,
        number: toPrNumber(each.pr),
      })),
    );
    droppedRefCount += grouped.droppedRefCount;
    grouped.groups.forEach((group) => {
      groups.push({ sourceIndex, repo: group.repo, refs: group.refs });
    });
  });
  return { groups, droppedRefCount, preservedIndexes };
};

// ReflectPrUsecase.execute 의 모델 호출 구간만 같은 프롬프트로 재현한다.
// 저장·노션 발행·윤문은 부르지 않는다 — 이 스크립트가 직접 제어한다.
const runRetro = async (
  { githubClient, modelRouter }: RetroDeps,
  refs: string[],
): Promise<RetroResult> => {
  const parsedRefs = extractPrReferences(refs.join('\n'));
  if (parsedRefs.length === 0) {
    throw new Error(`PR 참조를 읽지 못했습니다: ${refs.join(' ')}`);
  }
  const perPrDiffBytes = Math.max(
    MIN_PER_PR_DIFF_BYTES,
    Math.floor(TOTAL_DIFF_BUDGET / parsedRefs.length),
  );
  const items = await Promise.all(
    parsedRefs.map(async (ref) => {
      const diffOptions =
        parsedRefs.length > 1 ? { ...ref, maxBytes: perPrDiffBytes } : ref;
      const [detail, diff] = await Promise.all([
        githubClient.getPullRequest(ref),
        githubClient.getPullRequestDiff(diffOptions),
      ]);
      return { detail, diff };
    }),
  );

  const isMulti = items.length > 1;
  const completion = await modelRouter.route({
    agentType: AgentType.CAREER_MATE,
    request: {
      prompt: isMulti
        ? buildMultiPrRetroPrompt({ items })
        : buildPrRetroPrompt(items[0]),
      systemPrompt: isMulti
        ? MULTI_PR_RETRO_SYNTH_SYSTEM_PROMPT
        : PR_RETRO_SYNTH_SYSTEM_PROMPT,
    },
  });
  const parsed = parsePrRetroOutput(completion.text);
  const [accomplishment] = reconcileAccomplishmentEvidence({
    accomplishments: [parsed.accomplishment],
    pullRequests: items.map(({ detail }) => ({
      repo: detail.repo,
      number: detail.number,
      mergedAt: detail.mergedAt,
    })),
  });
  return { accomplishment, modelUsed: completion.modelUsed };
};

const humanizeInChunks = async (
  profile: CareerProfileData,
  humanizer: HumanizeService,
): Promise<CareerProfileData> => {
  const accomplishments: ProfileAccomplishment[] = [];
  let summary = profile.summary;
  for (
    let offset = 0;
    offset < profile.accomplishments.length;
    offset += HUMANIZE_CHUNK_SIZE
  ) {
    const chunk: CareerProfileData = {
      ...profile,
      accomplishments: profile.accomplishments.slice(
        offset,
        offset + HUMANIZE_CHUNK_SIZE,
      ),
    };
    const humanized = await humanizeCareerProfile(chunk, humanizer);
    accomplishments.push(...humanized.accomplishments);
    // summary 는 청크마다 같은 문장이 다시 들어오므로 첫 회차 결과만 취한다.
    if (offset === 0) {
      summary = humanized.summary;
    }
  }
  return { ...profile, summary, accomplishments };
};

// 그룹 하나가 실패해도 나머지는 살린다. 한 성과의 그룹이 **모두** 실패하면 원본 성과를
// 그대로 되살린다 — 그러지 않으면 그 근거 PR 이 프로필에서 영구히 사라진다.
const rebuildAccomplishments = async (
  deps: RetroDeps,
  original: ProfileAccomplishment[],
  plan: RebuildPlan,
): Promise<RebuildOutcome> => {
  const rebuiltBySource = new Map<number, ProfileAccomplishment[]>();
  const failures: GroupFailure[] = [];
  let modelUsed = '';

  // 순차 실행 — 모델 쿼터를 한꺼번에 태우지 않고, 실패 지점을 로그 순서로 짚을 수 있게 한다.
  for (const [index, group] of plan.groups.entries()) {
    const label = `[${index + 1}/${plan.groups.length}] ${group.repo} ${group.refs.length}건`;
    try {
      const retro = await runRetro(deps, group.refs);
      modelUsed = retro.modelUsed;
      const bucket = rebuiltBySource.get(group.sourceIndex) ?? [];
      bucket.push(retro.accomplishment);
      rebuiltBySource.set(group.sourceIndex, bucket);
      console.log(`  ${label} → ${retro.accomplishment.title}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ ...group, reason });
      console.log(`  ${label} → ⚠️ 실패: ${reason}`);
    }
  }

  const accomplishments: ProfileAccomplishment[] = [];
  const restoredIndexes: number[] = [];
  const failedSources = new Set(failures.map((failure) => failure.sourceIndex));
  original.forEach((item, sourceIndex) => {
    const rebuilt = rebuiltBySource.get(sourceIndex) ?? [];
    // 한 성과에서 그룹이 **하나라도** 실패하면 그 성과는 원본을 그대로 둔다.
    // 성공한 그룹만 넣으면 실패한 그룹의 근거 PR 이 프로필에서 조용히 사라진다
    // (예: repo1 4건 + repo2 4건으로 쪼갠 성과에서 repo2 가 실패하면 PR 4건 유실).
    // 성공분을 버리는 대신 유실을 막는다 — 그 성과는 리포트에 남으니 다시 돌릴 수 있다.
    if (rebuilt.length === 0 || failedSources.has(sourceIndex)) {
      accomplishments.push(item);
      restoredIndexes.push(sourceIndex);
      return;
    }
    accomplishments.push(...rebuilt);
  });
  return { accomplishments, failures, restoredIndexes, modelUsed };
};

const formatSummaryLines = (
  label: string,
  accomplishments: ProfileAccomplishment[],
): string => {
  return [
    `${label}: 성과 ${accomplishments.length}건`,
    `근거 PR ${countEvidence(accomplishments)}건(고유 ${countDistinctEvidence(accomplishments)})`,
    `소유자 혼합 ${countMixedOwner(accomplishments)}건`,
  ].join(' · ');
};

const main = async (): Promise<void> => {
  const owner =
    readOption('owner') ?? process.env.AUTOPILOT_OWNER_SLACK_USER_ID;
  if (!owner) {
    throw new Error(
      `owner 를 알 수 없습니다. --owner 로 넘기거나 AUTOPILOT_OWNER_SLACK_USER_ID 를 설정하세요.\n${USAGE}`,
    );
  }
  const apply = hasFlag('apply');
  const backupDir = readOption('backup-dir') ?? process.cwd();
  const limitOption = readOption('limit');
  const limit = limitOption ? Number(limitOption) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error(`--limit 은 양의 정수여야 합니다: ${limitOption}`);
  }

  const app = await NestFactory.createApplicationContext(
    RebuildCareerProfileCliModule,
    { logger: ['error', 'warn'] },
  );
  try {
    const repository = app.get<CareerProfileRepositoryPort>(
      CAREER_PROFILE_REPOSITORY_PORT,
    );
    const latest = await repository.findLatestBySlackUser(owner);
    if (!latest) {
      throw new Error(`career_profile 에 ${owner} 의 프로필이 없습니다.`);
    }

    // 백업은 --apply 여부와 무관하게 먼저 쓴다. 되돌릴 수 없는 작업의 유일한 사본이다.
    const backupPath = resolve(
      backupDir,
      `career-profile-backup-${latest.id}-${latest.createdAt.toISOString().slice(0, 10)}.json`,
    );
    writeFileSync(
      backupPath,
      JSON.stringify(
        {
          id: latest.id,
          agentRunId: latest.agentRunId,
          createdAt: latest.createdAt,
          profileJson: latest.profileJson,
        },
        null,
        2,
      ),
      'utf8',
    );

    const originalProfile = latest.profileJson;
    const original =
      limit === undefined
        ? originalProfile.accomplishments
        : originalProfile.accomplishments.slice(0, limit);
    const plan = buildPlan(original);

    console.log(
      [
        `대상 프로필: career_profile#${latest.id} (${latest.createdAt.toISOString()})`,
        `백업: ${backupPath}`,
        formatSummaryLines('재구축 전', original),
        `계획: 그룹 ${plan.groups.length}개 — 모델 호출 약 ${
          plan.groups.length +
          Math.ceil(plan.groups.length / HUMANIZE_CHUNK_SIZE)
        }회 (회고 ${plan.groups.length} + 윤문 ${Math.ceil(plan.groups.length / HUMANIZE_CHUNK_SIZE)})`,
        // 상한으로 잘려나간 PR 이 있으면 재구축이 근거를 잃는다. 0 이어야 한다.
        `상한으로 제외된 PR: ${plan.droppedRefCount}건`,
        // 조용히 건너뛰면 "왜 저 성과는 그대로지" 를 되짚을 방법이 없다.
        `맥락이 적혀 있어 손대지 않는 성과: ${plan.preservedIndexes.length}건`,
      ].join('\n'),
    );
    if (plan.droppedRefCount > 0) {
      throw new Error(
        `groupPrRefsByRepo 상한으로 PR ${plan.droppedRefCount}건이 제외됩니다. 유실 없이 재구축할 수 없습니다.`,
      );
    }
    if (!apply) {
      console.log('\n미리보기입니다. 실제로 저장하려면 --apply 를 붙이세요.');
      return;
    }

    const deps: RetroDeps = {
      githubClient: app.get<GithubClientPort>(GITHUB_CLIENT_PORT),
      modelRouter: app.get(ModelRouterUsecase),
    };
    const humanizer = app.get(HumanizeService);
    const config = app.get(ConfigService);
    const githubLogin = config.get<string>('IMPACT_REPORT_GITHUB_AUTHOR');
    if (!githubLogin) {
      throw new Error('IMPACT_REPORT_GITHUB_AUTHOR 가 설정되지 않았습니다.');
    }

    const outcome = await app
      .get(AgentRunService)
      .execute<{ savedProfileId: number }>({
        agentType: AgentType.CAREER_MATE,
        triggerType: TriggerType.MANUAL,
        inputSnapshot: {
          sourceProfileId: latest.id,
          groupCount: plan.groups.length,
          backupPath,
        },
        run: async (context) => {
          console.log('\n회고 재실행:');
          const rebuilt = await rebuildAccomplishments(deps, original, plan);
          // limit 을 쓰면 처리 대상 밖 성과는 손대지 않고 뒤에 그대로 잇는다.
          const untouched =
            limit === undefined
              ? []
              : originalProfile.accomplishments.slice(limit);
          const accomplishments = [...rebuilt.accomplishments, ...untouched];

          console.log('\n윤문:');
          const humanized = await humanizeInChunks(
            { ...originalProfile, accomplishments },
            humanizer,
          );

          const profileJson: CareerProfileData = {
            ...humanized,
            meta: {
              ...humanized.meta,
              githubLogin,
              prCount: countProfilePrCount(humanized.accomplishments),
            },
          };
          const saved = await repository.save({
            agentRunId: context.agentRunId,
            slackUserId: owner,
            githubLogin,
            windowStart: profileJson.meta.windowStart,
            prCount: profileJson.meta.prCount,
            summary: profileJson.summary,
            profileJson,
          });

          console.log(
            [
              '',
              formatSummaryLines('재구축 후', profileJson.accomplishments),
              `저장: career_profile#${saved.id} (run #${context.agentRunId})`,
            ].join('\n'),
          );
          if (rebuilt.failures.length > 0) {
            console.log(
              [
                '',
                `⚠️ 실패 ${rebuilt.failures.length}묶음 — 근거 PR 을 잃지 않도록 원본 성과 ${rebuilt.restoredIndexes.length}건을 그대로 두었습니다.`,
                ...rebuilt.failures.map(
                  (failure) =>
                    `  • ${failure.repo} ${failure.refs.join(' ')} — ${failure.reason}`,
                ),
              ].join('\n'),
            );
          }
          const result = { savedProfileId: saved.id };
          return {
            result,
            // 그룹이 전부 실패해 성공 회차가 없으면 라우팅된 모델을 알 수 없다.
            modelUsed: rebuilt.modelUsed || 'unknown',
            output: { ...result, failures: rebuilt.failures },
          };
        },
      });

    // 원본과 결과의 PR 총량이 어긋나면 어딘가에서 근거가 샜다는 뜻이다.
    console.log(`\n완료 — career_profile#${outcome.result.savedProfileId}`);
    console.log(
      `되돌리려면: delete from career_profile where id = ${outcome.result.savedProfileId};  (직전 행이 다시 정본이 됩니다)`,
    );
  } finally {
    await app.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
