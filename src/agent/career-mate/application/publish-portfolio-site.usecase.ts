import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { CronIdempotencyService } from '../../../common/queue/cron-idempotency.service';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { CareerMateException } from '../domain/career-mate.exception';
import { CareerMateErrorCode } from '../domain/career-mate-error-code.enum';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import {
  PORTFOLIO_SITE_CLIENT_PORT,
  PortfolioSiteClientPort,
  PortfolioSiteProject,
} from '../domain/port/portfolio-site.client.port';
import {
  PORTFOLIO_SYNC_CARD_REPOSITORY_PORT,
  PortfolioSyncCardRepositoryPort,
  PortfolioSyncCardRow,
} from '../domain/port/portfolio-sync-card.repository.port';
import {
  hasUngroundedNumbers,
  shouldKeepPreviousTitle,
  validateCover,
} from '../domain/portfolio-cover.validate';
import {
  buildPortfolioSitePayload,
  groupAccomplishments,
  maskRepoTokens,
} from '../domain/portfolio-site-payload';
import {
  PortfolioSyncPlan,
  PortfolioSyncPlanCard,
} from '../domain/portfolio-sync-card.type';
import {
  baseFingerprint,
  buildMemberPrs,
  buildProcessLines,
  computeCoverHash,
  decideSortOrder,
  mergeGithubLink,
  planAdoption,
  shouldRegenerateCover,
} from '../domain/portfolio-sync-plan';
import { postCheckPortfolioSync } from '../domain/portfolio-sync-postcheck';
import { ProjectGroup, ProjectGroupNaming } from '../domain/project-group';
import {
  buildPortfolioCoverPrompt,
  CoverPromptCard,
  parsePortfolioCoverOutput,
  PORTFOLIO_COVER_SYSTEM_PROMPT,
} from '../domain/prompt/portfolio-cover.prompt';
import { normalizeTechStack } from '../domain/tech-stack.normalize';

export interface PublishPortfolioSiteInput {
  slackUserId: string;
  triggerType?: TriggerType;
}
export interface PublishPortfolioSiteFailure {
  target: string;
  reason: string;
}
export interface PublishPortfolioSiteResult {
  createdProjects: string[];
  updatedProjects: string[];
  createdSkillGroups: string[];
  updatedSkillGroups: string[];
  skippedTitles: string[];
  failures: PublishPortfolioSiteFailure[];
  missingAfterPublish: string[];
  unnamedKeys: string[];
  agentRunId: number;
  regenerated: string[];
  overwrittenPublic: string[];
  coverFailed: string[];
  blankedFields: { slug: string; fields: string[] }[];
  postCheckViolations: { slug: string; rule: number; detail: string }[];
  notInPlan: string[];
  unknownTechTerms: string[];
  planViolations: string[];
  adoptionRequired: boolean;
  aborted: string | null;
}
const LOCK = 'portfolio-publish:lock';
const LOCK_TTL_SECONDS = 900;
const LOCK_GUARD_MS = 12 * 60_000;
const isNearLockExpiry = (startedAt: number): boolean =>
  Date.now() - startedAt > LOCK_GUARD_MS;

interface PlannedCardResult {
  card: PortfolioSyncPlanCard;
  prompt: CoverPromptCard | null;
  unknownTerms: string[];
  keptByHuman: boolean;
}
interface ApplyOptions {
  snapshot?: (projects: PortfolioSiteProject[]) => Promise<void>;
}
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const stringValue = (value: unknown): string =>
  typeof value === 'string' ? value : '';
const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
const linksOf = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...value };
};
const emptyResult = (agentRunId = 0): PublishPortfolioSiteResult => ({
  createdProjects: [],
  updatedProjects: [],
  createdSkillGroups: [],
  updatedSkillGroups: [],
  skippedTitles: [],
  failures: [],
  missingAfterPublish: [],
  unnamedKeys: [],
  agentRunId,
  regenerated: [],
  overwrittenPublic: [],
  coverFailed: [],
  blankedFields: [],
  postCheckViolations: [],
  notInPlan: [],
  unknownTechTerms: [],
  planViolations: [],
  adoptionRequired: false,
  aborted: null,
});
const ALLOWED_BODY_KEYS = new Set([
  'slug',
  'process',
  'techStack',
  'period',
  'links',
  'sortOrder',
  'title',
  'summary',
  'problem',
  'result',
  'keyContributions',
  'published',
  'featured',
]);

@Injectable()
export class PublishPortfolioSiteUsecase {
  private readonly logger = new Logger(PublishPortfolioSiteUsecase.name);

  constructor(
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    @Inject(PORTFOLIO_SITE_CLIENT_PORT)
    private readonly siteClient: PortfolioSiteClientPort,
    private readonly configService: ConfigService,
    private readonly modelRouter: ModelRouterUsecase,
    @Inject(PORTFOLIO_SYNC_CARD_REPOSITORY_PORT)
    private readonly cards: PortfolioSyncCardRepositoryPort,
    @Inject(GITHUB_CLIENT_PORT) private readonly github: GithubClientPort,
    private readonly lock: CronIdempotencyService,
  ) {}

  async plan(input: PublishPortfolioSiteInput): Promise<PortfolioSyncPlan> {
    return this.withLock(() => this.planInternal(input));
  }
  async apply({
    plan,
    options = {},
  }: {
    plan: PortfolioSyncPlan;
    options?: ApplyOptions;
  }): Promise<PublishPortfolioSiteResult> {
    return this.withLock((startedAt) =>
      this.applyInternal({ plan, options, startedAt }),
    );
  }
  async execute(
    input: PublishPortfolioSiteInput,
  ): Promise<PublishPortfolioSiteResult> {
    return this.withLock(async (startedAt) => {
      const cards = await this.cards.findAll();
      if (cards.length === 0) {
        return { ...emptyResult(), adoptionRequired: true };
      }
      const plan = await this.planInternal(input);
      return this.applyInternal({ plan, options: {}, startedAt });
    });
  }
  private async withLock<T>(
    operation: (startedAt: number) => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    const acquired = await this.lock.acquireOnce(LOCK, LOCK_TTL_SECONDS);
    if (!acquired) {
      throw new CareerMateException({
        code: CareerMateErrorCode.INVALID_MODEL_OUTPUT,
        message: '포트폴리오 발행이 이미 실행 중입니다',
      });
    }
    try {
      return await operation(startedAt);
    } finally {
      // TTL이 만료됐을 수 있으면 다른 실행이 잡은 잠금을 지우지 않는다.
      const elapsed = Date.now() - startedAt;
      const canReleaseLock = elapsed < LOCK_GUARD_MS;
      if (canReleaseLock) {
        await this.lock.release(LOCK);
      }
    }
  }
  private async planInternal(
    input: PublishPortfolioSiteInput,
  ): Promise<PortfolioSyncPlan> {
    const latest = await this.repository.findLatestBySlackUser(
      input.slackUserId,
    );
    // 계획은 저장을 하지 않는다. 프로필이 없으면 별도 프로필 생성이 필요하다.
    if (!latest) {
      throw new CareerMateException({
        code: CareerMateErrorCode.NO_EVIDENCE,
        message:
          '저장된 경력 프로필이 없습니다 — 먼저 프로필을 만들어야 발행할 수 있습니다',
      });
    }
    const profile = latest.profileJson;
    const rows = await this.cards.findAll();
    const sites = await this.siteClient.listProjects();
    const owners = (
      this.configService.get<string>('PORTFOLIO_ANONYMIZED_OWNERS') ?? ''
    )
      .split(',')
      .map((owner) => owner.trim().toLowerCase())
      .filter(Boolean);
    const { groups, skippedTitles } = groupAccomplishments(profile, {
      anonymizedOwners: owners,
    });
    groups.sort(
      (left, right) =>
        right.accomplishments.length - left.accomplishments.length ||
        left.key.localeCompare(right.key),
    );
    const siteBySlug = new Map(sites.map((site) => [site.slug, site]));
    const rowBySlug = new Map(rows.map((row) => [row.slug, row]));
    const report: PortfolioSyncPlan['report'] = {
      skippedTitles,
      unnamedKeys: [],
      planViolations: [],
      notInPlan: [],
      unknownTechTerms: [],
      ambiguousAssignments: [],
      coverRetry: [],
      sortOrderKeptByHuman: [],
    };
    const cardResults = await Promise.all(
      groups.map((group, index) => {
        const order = index + 1;
        const site = siteBySlug.get(group.key);
        const row = rowBySlug.get(group.key) ?? null;
        return this.planCard({ group, order, site, row });
      }),
    );
    const planned = cardResults.map((item) => item.card);
    const prompts = cardResults
      .map((item) => item.prompt)
      .filter((prompt): prompt is CoverPromptCard => prompt !== null);
    report.unknownTechTerms = cardResults.flatMap((item) => item.unknownTerms);
    report.sortOrderKeptByHuman = cardResults
      .filter((item) => item.keptByHuman)
      .map((item) => item.card.slug);
    const membership = new Map<string, number>();
    for (const card of planned) {
      for (const pr of card.memberPrs) {
        membership.set(pr, (membership.get(pr) ?? 0) + 1);
      }
    }
    for (const [pr, count] of membership) {
      if (count !== 1) {
        report.planViolations.push(pr);
      }
    }
    report.notInPlan = rows
      .filter(
        (row) =>
          row.status === 'ACTIVE' &&
          !planned.some((card) => card.slug === row.slug),
      )
      .map((row) => row.slug);
    if (prompts.length) {
      const namings = await this.generateCovers(prompts);
      const retries: CoverPromptCard[] = [];
      const retryNotes: string[] = [];
      const cardsToRegenerate = planned.filter((item) => item.regenerate);
      for (const card of cardsToRegenerate) {
        const site = siteBySlug.get(card.slug);
        const naming = namings.find((item) => item.key === card.slug);
        const validated = naming
          ? validateCover({
              cover: naming,
              processLines: stringArray(card.body.process),
              previousResult: stringValue(site?.data.result),
            })
          : null;
        if (validated) {
          const row = rowBySlug.get(card.slug) ?? null;
          const previousTitle = stringValue(site?.data.title);
          const keepPreviousTitle =
            shouldKeepPreviousTitle({ row, memberPrs: card.memberPrs }) &&
            previousTitle.length > 0;
          const title = keepPreviousTitle ? previousTitle : validated.title;
          Object.assign(card.body, {
            title,
            summary: validated.summary,
            problem: validated.problem,
            result: validated.result,
            keyContributions: validated.highlights,
          });
          card.coverPassed = true;
          if (validated.retryHighlights) {
            const prompt = prompts.find((item) => item.key === card.slug);
            if (prompt) {
              retries.push(prompt);
              report.coverRetry.push(card.slug);
              retryNotes.push(
                ...validated.removedHighlights.map(
                  ({ highlight, reason }) =>
                    `- ${card.slug}: "${highlight}" — ${reason}`,
                ),
              );
            }
          }
        } else if (site) {
          // 표지를 새로 못 지었어도 기존 표지의 숫자가 지금 과정에 없으면 그 필드만 비운다(A1).
          const process = stringArray(card.body.process);
          const highlightsUngrounded = hasUngroundedNumbers({
            text: stringArray(site.data.keyContributions).join('\n'),
            processLines: process,
          });
          const resultUngrounded = hasUngroundedNumbers({
            text: stringValue(site.data.result),
            processLines: process,
          });
          if (highlightsUngrounded) {
            card.body.keyContributions = [];
          }
          if (resultUngrounded) {
            card.body.result = '';
          }
        } else {
          report.unnamedKeys.push(card.slug);
        }
      }
      if (retries.length) {
        try {
          // 줄마다 실제 제외 사유를 실어 같은 이유로 다시 버려지지 않게 한다(설계 §3.5).
          const retryPrompt = [
            buildPortfolioCoverPrompt(retries),
            '',
            '아래 highlights 는 검증에서 제외됐다. 같은 이유로 다시 제외되지 않게 써라.',
            ...retryNotes,
          ].join('\n');
          const completion = await this.modelRouter.route({
            agentType: AgentType.CAREER_MATE,
            request: {
              prompt: retryPrompt,
              systemPrompt: PORTFOLIO_COVER_SYSTEM_PROMPT,
            },
          });
          const keys = retries.map((item) => item.key);
          const retried = parsePortfolioCoverOutput({
            text: completion.text,
            allowedKeys: keys,
          });
          const cardsToRetry = planned.filter((item) =>
            report.coverRetry.includes(item.slug),
          );
          for (const card of cardsToRetry) {
            const naming = retried.find((item) => item.key === card.slug);
            if (naming) {
              const validated = validateCover({
                cover: naming,
                processLines: stringArray(card.body.process),
                previousResult: '',
              });
              if (validated) {
                card.body.keyContributions = validated.highlights;
              }
            }
          }
        } catch (error) {
          // 재요청 실패 시 빈 배열을 유지한다.
          this.logger.warn(
            `포트폴리오 성과 줄 재요청 실패 — ${message(error)}`,
          );
        }
      }
    }
    const adoption =
      rows.length === 0
        ? planAdoption({
            cards: planned,
            siteProjects: sites.map((site) => ({
              id: site.id,
              slug: site.slug,
              title: stringValue(site.data.title),
            })),
          })
        : null;
    const skillGroups = buildPortfolioSitePayload({
      profile,
      groups: [],
      namings: [],
      skippedTitles: [],
    }).skillGroups;
    const createdAt = new Date().toISOString();
    const fingerprint = baseFingerprint(rows);
    const unknownTechTerms = [...new Set(report.unknownTechTerms)].sort();
    return {
      version: 1,
      createdAt,
      baseFingerprint: fingerprint,
      agentRunId: latest.agentRunId ?? 0,
      adoption,
      cards: planned,
      skillGroups,
      report: {
        ...report,
        unknownTechTerms,
      },
    };
  }
  private async generateCovers(
    prompts: CoverPromptCard[],
  ): Promise<ProjectGroupNaming[]> {
    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.CAREER_MATE,
        request: {
          prompt: buildPortfolioCoverPrompt(prompts),
          systemPrompt: PORTFOLIO_COVER_SYSTEM_PROMPT,
        },
      });
      const keys = prompts.map((prompt) => prompt.key);
      return parsePortfolioCoverOutput({
        text: completion.text,
        allowedKeys: keys,
      });
    } catch (error) {
      // 표지 호출이 실패해도 과정·기술·링크 갱신은 계속한다.
      this.logger.warn(`포트폴리오 표지 생성 실패 — ${message(error)}`);
      return [];
    }
  }
  private async planCard({
    group,
    order,
    site,
    row,
  }: {
    group: ProjectGroup;
    order: number;
    site: PortfolioSiteProject | undefined;
    row: PortfolioSyncCardRow | null;
  }): Promise<PlannedCardResult> {
    const memberPrs = buildMemberPrs(group.accomplishments);
    const coverHash = computeCoverHash(memberPrs);
    // 사이트에서 카드가 사라졌으면 구성이 같아도 표지를 다시 짓는다 — create 는 표지가 있어야 하고,
    // 없으면 apply 가 그 카드를 매 회차 조용히 건너뛰어 영영 복구되지 않는다.
    const regenerate = !site || shouldRegenerateCover({ row, coverHash });
    const processLines = buildProcessLines(group);
    const normalized = normalizeTechStack(
      group.accomplishments.map((item) => item.techTags),
    );
    const isPublic = group.anonymized
      ? false
      : await this.isPublicRepository(group.repo);
    const links = linksOf(site?.data.links);
    const mergedLinks = mergeGithubLink({
      links,
      repo: group.repo,
      anonymized: group.anonymized,
      isPublic,
    });
    const action = site ? 'update' : 'create';
    const target = order;
    const current = site?.sortOrder ?? 0;
    const lastSent = row?.lastSentSortOrder ?? null;
    const sortOrder = decideSortOrder({
      action,
      target,
      current,
      lastSent,
    });
    const body: Record<string, unknown> = {
      slug: group.key,
      process: processLines,
      techStack: normalized.techStack,
      period: group.period,
    };
    const linksChanged = JSON.stringify(links) !== JSON.stringify(mergedLinks);
    if (!site || linksChanged) {
      body.links = mergedLinks;
    }
    if (sortOrder.sortOrderSent !== null) {
      body.sortOrder = sortOrder.sortOrderSent;
    }
    if (!site) {
      body.published = false;
      body.featured = false;
    }
    const card: PortfolioSyncPlanCard = {
      slug: group.key,
      repo: group.repo.trim().toLowerCase(),
      topicIndex: 1,
      anonymized: group.anonymized,
      siteProjectId: site?.id ?? null,
      siteBaseline: site
        ? {
            id: site.id,
            sortOrder: site.sortOrder,
            links: site.data.links ?? null,
          }
        : null,
      action,
      memberPrs,
      coverHash,
      regenerate,
      coverPassed: false,
      coverWasPublic: site?.published ?? false,
      sortOrderSent: sortOrder.sortOrderSent,
      sortOrderOwned: sortOrder.sortOrderOwned,
      body,
    };
    const prompt: CoverPromptCard | null = regenerate
      ? {
          key: group.key,
          repo: group.repo,
          anonymized: group.anonymized,
          period: group.period,
          techStack: normalized.techStack,
          processLines,
          previousTitle: group.anonymized
            ? maskRepoTokens(stringValue(site?.data.title), group.repo)
            : stringValue(site?.data.title),
          previousSummary: group.anonymized
            ? maskRepoTokens(stringValue(site?.data.summary), group.repo)
            : stringValue(site?.data.summary),
        }
      : null;
    return {
      card,
      prompt,
      unknownTerms: normalized.unknownTerms,
      keptByHuman: sortOrder.keptByHuman,
    };
  }
  private async isPublicRepository(repo: string): Promise<boolean> {
    try {
      return await this.github.isRepositoryPublic(repo);
    } catch (error) {
      // 모르면 비공개로 본다 — 비공개 저장소 주소를 공개 카드에 싣는 쪽이 더 나쁘다.
      this.logger.warn(
        `저장소 공개 여부 확인 실패 ${repo} — ${message(error)}`,
      );
      return false;
    }
  }
  private hasSiteDrifted({
    card,
    site,
  }: {
    card: PortfolioSyncPlanCard;
    site: PortfolioSiteProject | undefined;
  }): boolean {
    const baseline = card.siteBaseline;
    if (!baseline) {
      return Boolean(site);
    }
    if (!site || site.id !== baseline.id) {
      return true;
    }
    if ('sortOrder' in card.body && site.sortOrder !== baseline.sortOrder) {
      return true;
    }
    if ('links' in card.body) {
      const currentLinks = JSON.stringify(site.data.links ?? null);
      const baselineLinks = JSON.stringify(baseline.links);
      return currentLinks !== baselineLinks;
    }
    return false;
  }
  private hasAdoptionDrifted({
    plan,
    before,
    currentSites,
  }: {
    plan: PortfolioSyncPlan;
    before: PortfolioSiteProject[];
    currentSites: Map<string, PortfolioSiteProject>;
  }): boolean {
    if (!plan.adoption) {
      return false;
    }
    if (before.length !== plan.adoption.table.length) {
      return true;
    }
    return plan.adoption.table.some(
      (entry) => currentSites.get(entry.slug)?.id !== entry.siteProjectId,
    );
  }
  private async applyInternal({
    plan,
    options,
    startedAt,
  }: {
    plan: PortfolioSyncPlan;
    options: ApplyOptions;
    startedAt: number;
  }): Promise<PublishPortfolioSiteResult> {
    const result = emptyResult(plan.agentRunId);
    result.skippedTitles = plan.report.skippedTitles;
    result.unnamedKeys = plan.report.unnamedKeys;
    result.notInPlan = plan.report.notInPlan;
    result.unknownTechTerms = plan.report.unknownTechTerms;
    result.planViolations = plan.report.planViolations;
    result.coverFailed = plan.cards
      .filter((card) => card.regenerate && !card.coverPassed)
      .map((card) => card.slug);
    const rows = await this.cards.findAll();
    const isStalePlan =
      plan.version !== 1 || plan.baseFingerprint !== baseFingerprint(rows);
    if (isStalePlan) {
      result.aborted = '계획 이후 싱크 상태가 바뀌었습니다';
      return result;
    }
    if (plan.adoption?.mismatch) {
      result.aborted = '채택 대상이 사이트 목록과 일치하지 않습니다';
      return result;
    }
    const before = await this.siteClient.listProjects();
    const currentSites = new Map(before.map((site) => [site.slug, site]));
    const changed = plan.cards.some((card) => {
      const site = currentSites.get(card.slug);
      return this.hasSiteDrifted({ card, site });
    });
    const adoptionChanged = this.hasAdoptionDrifted({
      plan,
      before,
      currentSites,
    });
    if (changed || adoptionChanged) {
      result.aborted = '계획 이후 사이트 카드가 바뀌었습니다';
      return result;
    }
    if (options.snapshot) {
      await options.snapshot(before);
    }
    if (isNearLockExpiry(startedAt)) {
      result.aborted = '잠금 만료 전에 남은 쓰기를 중단했습니다';
      return result;
    }
    if (plan.adoption) {
      const currentRows = await this.cards.findAll();
      if (currentRows.length !== 0) {
        result.aborted = '채택 전 싱크 상태가 생겼습니다';
        return result;
      }
      await this.cards.createMany(plan.adoption.rows);
    }
    const rowBySlug = new Map(rows.map((row) => [row.slug, row]));
    const orderedCards = [...plan.cards].sort(
      (left, right) =>
        Number(left.action === 'update') - Number(right.action === 'update'),
    );
    for (const card of orderedCards) {
      if (isNearLockExpiry(startedAt)) {
        result.aborted = '잠금 만료 전에 남은 쓰기를 중단했습니다';
        break;
      }
      if (card.action === 'create' && !card.coverPassed) {
        continue;
      }
      const body = Object.fromEntries(
        Object.entries(card.body).filter(
          ([key]) =>
            ALLOWED_BODY_KEYS.has(key) &&
            (card.action === 'create' ||
              (key !== 'published' && key !== 'featured')),
        ),
      );
      body.slug = card.slug;
      if (card.action === 'create') {
        body.published = false;
        body.featured = false;
      }
      try {
        const written =
          card.action === 'create'
            ? await this.siteClient.createProject(body)
            : await this.siteClient.updateProject(
                card.siteProjectId as string,
                body,
              );
        await this.cards.upsertActive({
          slug: card.slug,
          siteProjectId: written.id,
          repo: card.repo,
          topicIndex: card.topicIndex,
          memberPrs: card.memberPrs,
          coverOf: card.coverPassed
            ? card.coverHash
            : (rowBySlug.get(card.slug)?.coverOf ?? null),
          ...(card.sortOrderOwned !== null
            ? { lastSentSortOrder: card.sortOrderOwned }
            : {}),
        });
        (card.action === 'create'
          ? result.createdProjects
          : result.updatedProjects
        ).push(card.slug);
        if (card.coverPassed) {
          result.regenerated.push(card.slug);
          if (card.coverWasPublic) {
            result.overwrittenPublic.push(card.slug);
          }
        }
        const fields = ['keyContributions', 'result'].filter(
          (key) => !card.coverPassed && key in body,
        );
        if (fields.length) {
          result.blankedFields.push({ slug: card.slug, fields });
        }
      } catch (error) {
        result.failures.push({
          target: `project:${card.slug}`,
          reason: message(error),
        });
      }
    }
    try {
      const skillGroups = await this.siteClient.listSkillGroups();
      for (const group of plan.skillGroups) {
        if (isNearLockExpiry(startedAt)) {
          result.aborted = '잠금 만료 전에 남은 쓰기를 중단했습니다';
          break;
        }
        try {
          const found = skillGroups.find(
            (item) => item.data.title === group.title,
          );
          if (found) {
            await this.siteClient.updateSkillGroup(found.id, { ...group });
            result.updatedSkillGroups.push(group.title);
          } else {
            await this.siteClient.createSkillGroup({ ...group });
            result.createdSkillGroups.push(group.title);
          }
        } catch (error) {
          result.failures.push({
            target: `skill-group:${group.title}`,
            reason: message(error),
          });
        }
      }
    } catch (error) {
      result.failures.push({ target: 'skill-groups', reason: message(error) });
    }
    try {
      const after = await this.siteClient.listProjects();
      const afterSlugs = new Set(after.map((item) => item.slug));
      result.missingAfterPublish = [
        ...result.createdProjects,
        ...result.updatedProjects,
      ].filter((slug) => !afterSlugs.has(slug));
      result.postCheckViolations = postCheckPortfolioSync({
        projects: after,
        before,
        cards: plan.cards,
        rows: await this.cards.findAll(),
        planViolations: plan.report.planViolations,
      });
      const invalid = result.postCheckViolations
        .filter((item) => item.rule === 1)
        .map((item) => item.slug);
      if (invalid.length && !isNearLockExpiry(startedAt)) {
        await this.cards.clearCoverOf(invalid);
      } else if (invalid.length) {
        result.aborted = '잠금 만료 전에 남은 쓰기를 중단했습니다';
      }
    } catch (error) {
      result.failures.push({ target: 'verify', reason: message(error) });
    }
    return result;
  }
}
