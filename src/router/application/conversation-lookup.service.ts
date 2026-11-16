import { readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { wrapUntrustedInput } from '../../common/llm/untrusted-input.util';
import { formatKstDateTime } from '../../common/util/kst-date.util';
import { getRealHomeDir } from '../../model-router/infrastructure/cli-process.util';
import {
  SLACK_DELIVERY_REPOSITORY,
  SlackDeliveryRepositoryPort,
} from '../../slack/domain/port/slack-delivery.repository.port';
import {
  describeDeliveryStatus,
  LatestActivity,
  summarizeLatestDeliveries,
} from '../../slack/domain/slack-delivery-summary';
import { LocalRepoSnapshotService } from '../infrastructure/local-repo-snapshot.service';

export interface ConversationLookups {
  ledgerText?: string;
  deliveryText?: string;
  latestDeliveryText?: string;
  readableRoots: string[];
  rootGuide: string[];
  release: () => void;
}

const RECENT_LIMIT = 10;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const LOOKBACK_MILLISECONDS = DAY_MILLISECONDS;
const LATEST_DELIVERY_LOOKBACK_DAYS = 30;
const LATEST_DELIVERY_RECENT_DAYS = 7;
const FORBIDDEN_HERMES_FILES = new Set([
  'auth.json',
  'config.yaml',
  '.env',
  'jobs.json',
]);

@Injectable()
export class ConversationLookupService {
  private readonly logger = new Logger(ConversationLookupService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly agentRunService: AgentRunService,
    @Inject(SLACK_DELIVERY_REPOSITORY)
    private readonly deliveryRepository: SlackDeliveryRepositoryPort,
    private readonly repoSnapshotService: LocalRepoSnapshotService,
  ) {}

  async collect({
    slackUserId,
  }: {
    slackUserId: string;
  }): Promise<ConversationLookups> {
    const result: ConversationLookups = {
      readableRoots: [],
      rootGuide: [],
      release: () => {},
    };
    // 콘솔은 CONSOLE_OWNER 로 대화하므로 두 owner 값이 다르게 설정돼도 콘솔 조회가 닫히지 않게 둘 다 인정한다.
    const owners = [
      this.configService.get<string>('AUTOPILOT_OWNER_SLACK_USER_ID'),
      this.configService.get<string>('CONSOLE_OWNER_SLACK_USER_ID'),
    ];
    if (!slackUserId || !owners.includes(slackUserId)) {
      return result;
    }

    const since = new Date(Date.now() - LOOKBACK_MILLISECONDS);
    try {
      const [active, finished] = await Promise.all([
        this.agentRunService.findActiveRuns(),
        this.agentRunService.findFinishedRunsSince({
          since,
          limit: RECENT_LIMIT,
        }),
      ]);
      const lines = [
        ...active.map(
          (run) =>
            `${run.agentType} · ${run.status} · ${formatKstDateTime(run.startedAt)} KST`,
        ),
        ...finished.map((run) => {
          const failureReason =
            run.status === 'FAILED' ? ` · ${run.summary ?? '사유 미기록'}` : '';
          return `${run.agentType} · ${run.status}${failureReason} · ${formatKstDateTime(run.endedAt)} KST`;
        }),
      ];
      if (lines.length > 0) {
        result.ledgerText = wrapUntrustedInput(lines.join('\n'));
      }
    } catch (error: unknown) {
      this.logger.warn(`최근 실행 기록 조회 실패: ${String(error)}`);
    }

    try {
      const deliveries = await this.deliveryRepository.findRecent({
        since,
        limit: RECENT_LIMIT,
      });
      if (deliveries.length > 0) {
        result.deliveryText = wrapUntrustedInput(
          deliveries
            .map(
              (delivery) =>
                `${delivery.kind} · ${describeDeliveryStatus(delivery)} · ${delivery.textPreview} · ${formatKstDateTime(delivery.createdAt)} KST`,
            )
            .join('\n'),
        );
      }
    } catch (error: unknown) {
      this.logger.warn(`최근 발송 기록 조회 실패: ${String(error)}`);
    }

    try {
      result.latestDeliveryText = await this.describeLatestDeliveries();
    } catch (error: unknown) {
      this.logger.warn(`종류별 마지막 발송 조회 실패: ${String(error)}`);
    }

    const hermesRoot = await this.getHermesRoot();
    if (hermesRoot) {
      result.readableRoots.push(hermesRoot);
      result.rootGuide.push(
        `${hermesRoot}: Hermes cron 실행 기록 폴더. 작업별 하위 폴더의 날짜별 .md 파일만 참고한다.`,
      );
    }
    try {
      const snapshot = await this.repoSnapshotService.acquire();
      if (snapshot) {
        result.readableRoots.push(snapshot.root);
        result.rootGuide.push(
          `${snapshot.root}: 이대리 레포의 현재 커밋 파일 사본. 읽기 전용이다.`,
        );
        result.release = snapshot.release;
      }
    } catch (error: unknown) {
      this.logger.warn(`레포 사본 조회 실패: ${String(error)}`);
    }
    return result;
  }

  private async describeLatestDeliveries(): Promise<string | undefined> {
    const now = Date.now();
    const rows = await this.deliveryRepository.findActivitySince(
      new Date(now - LATEST_DELIVERY_LOOKBACK_DAYS * DAY_MILLISECONDS),
    );
    const groups = summarizeLatestDeliveries({
      rows,
      recentSince: new Date(
        now - LATEST_DELIVERY_RECENT_DAYS * DAY_MILLISECONDS,
      ),
    });
    if (groups.length === 0) {
      return undefined;
    }
    const lines = groups.map((group) => {
      const sentStat = group[LatestActivity.SENT];
      const consoleRouteStat = group[LatestActivity.CONSOLE_ROUTE];
      const emptyStat = group[LatestActivity.EMPTY];
      const sent = sentStat.lastAt
        ? `마지막 발송 ${formatKstDateTime(sentStat.lastAt)} KST · ${LATEST_DELIVERY_RECENT_DAYS}일 ${sentStat.recent}회`
        : `${LATEST_DELIVERY_LOOKBACK_DAYS}일 안 발송 없음`;
      const consoleRoute = consoleRouteStat.lastAt
        ? ` · 콘솔로 돌림 ${LATEST_DELIVERY_RECENT_DAYS}일 ${consoleRouteStat.recent}회(마지막 ${formatKstDateTime(consoleRouteStat.lastAt)} KST)`
        : '';
      const empty = emptyStat.lastAt
        ? ` · 보낼 것 없이 끝난 마지막 회차 ${formatKstDateTime(emptyStat.lastAt)} KST`
        : '';
      return `${group.key} · ${sent}${consoleRoute}${empty}`;
    });
    const text = lines.join('\n');
    return wrapUntrustedInput(text);
  }

  private async getHermesRoot(): Promise<string | null> {
    const configured = this.configService.get<string>('HERMES_CRON_OUTPUT_DIR');
    if (!configured || !isAbsolute(configured)) {
      return null;
    }
    try {
      const root = await realpath(configured);
      const home = await realpath(getRealHomeDir());
      const hermesHome = resolve(home, '.hermes');
      // HOME 및 그 상위나 ~/.hermes 전체를 열면 인증 파일까지 읽을 수 있다.
      if (
        root === home ||
        root === hermesHome ||
        !relative(root, home).startsWith('..')
      ) {
        return null;
      }
      const rootStat = await stat(root);
      if (!rootStat.isDirectory()) {
        return null;
      }
      const names = await readdir(root);
      if (names.some((name) => FORBIDDEN_HERMES_FILES.has(name))) {
        return null;
      }
      return root;
    } catch (error: unknown) {
      this.logger.warn(`Hermes 기록 폴더 확인 실패: ${String(error)}`);
      return null;
    }
  }
}
