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
import { LocalRepoSnapshotService } from '../infrastructure/local-repo-snapshot.service';

export interface ConversationLookups {
  ledgerText?: string;
  deliveryText?: string;
  readableRoots: string[];
  rootGuide: string[];
  release: () => void;
}

const RECENT_LIMIT = 10;
const LOOKBACK_MILLISECONDS = 24 * 60 * 60 * 1000;
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
    const owner = this.configService.get<string>(
      'AUTOPILOT_OWNER_SLACK_USER_ID',
    );
    if (!owner || owner !== slackUserId) {
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
                `${delivery.kind} · ${delivery.status} · ${delivery.textPreview} · ${formatKstDateTime(delivery.createdAt)} KST`,
            )
            .join('\n'),
        );
      }
    } catch (error: unknown) {
      this.logger.warn(`최근 발송 기록 조회 실패: ${String(error)}`);
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
