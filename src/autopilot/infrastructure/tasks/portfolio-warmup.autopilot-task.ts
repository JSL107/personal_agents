import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 콜드스타트 실측이 18.4초(2026-08-18)라, 이 레포의 다른 외부 호출 관례인 15초
// (`market-data/infrastructure/toss/toss-api.client.ts`)로는 깨우려던 요청을 우리가 먼저 끊는다.
// 60초는 그 실측의 세 배 여유이고, autopilot worker 의 lockDuration(690s+)에는 한참 못 미쳐
// stalled 재처리를 부르지 않는다.
const PROBE_TIMEOUT_MS = 60_000;

// 1회 실패로 알리지 않는 이유 — 깨우는 첫 요청은 원래 느리고, 사이트 재배포 중에는 한 회차가
// 비어 있을 수 있다. 연속 2회(=20분) 실패면 사람이 열어도 안 열리는 상태다.
const FAILURE_ALERT_THRESHOLD = 2;

interface ProbeOutcome {
  ok: boolean;
  // 실패 사유를 함께 싣는다 — boolean 하나만 돌려주면 "왜 실패했는지"가 사라져서
  // 알림을 받고도 원인을 다시 재현해야 한다.
  reason?: string;
  elapsedMs: number;
}

// 포트폴리오 사이트(Portfolio OS) 워밍업 — 잠든 API 를 깨우고, 연속 실패 때만 알린다.
//
// 사이트 API 는 Render 무료 플랜이라 15분 유휴면 잠들고, 깨어나는 첫 요청이 18.4초 걸린다
// (2026-08-18 실측). 그 시간을 방문자가 아니라 이 슬롯이 대신 문다.
// 공개 health 엔드포인트만 부르므로 인증이 필요 없다. 설계는
// `docs/superpowers/plans/2026-08-18-portfolio-site-automation.md` §4-A.
@Injectable()
export class PortfolioWarmupAutopilotTask implements AutopilotTask {
  readonly id = 'portfolio-warmup';
  private readonly logger = new Logger(PortfolioWarmupAutopilotTask.name);
  // 연속 실패 카운터는 프로세스 로컬이다 — 재시작하면 0으로 돌아간다. 그래도 알림이 사라지지는
  // 않는다: 워밍업이 10분 간격이라 장애가 지속되면 20분 뒤 임계값에 다시 도달하고, 늦어질 뿐이다.
  // 분산 유실도 없다 — autopilot-cron 큐는 concurrency=1 이고(`autopilot.playbook-defaults.ts`)
  // 이 provider 는 스코프 없는 싱글톤이라 회차 간 인스턴스가 유지된다. 영속화하려면 상태 저장소가
  // 필요한데 autopilot task 중 선례가 없어, 재시작이 20분보다 짧은 주기로 반복되는 환경이
  // 실제로 생기면 그때 Redis 로 옮긴다.
  private consecutiveFailures = 0;

  constructor(private readonly configService: ConfigService) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    void context;
    const siteUrl = this.configService.get<string>('PORTFOLIO_SITE_URL');
    if (!siteUrl || siteUrl.trim().length === 0) {
      // 미설정 = 이 슬롯을 쓰지 않는 환경(다른 PC 등). 조용히 넘긴다.
      return { skip: true };
    }

    const outcome = await this.probeHealth(siteUrl.trim());
    if (outcome.ok) {
      this.consecutiveFailures = 0;
      this.logger.log(
        `포트폴리오 사이트 워밍업 성공 — ${outcome.elapsedMs}ms (깨어 있음)`,
      );
      return { skip: true };
    }

    this.consecutiveFailures += 1;
    this.logger.warn(
      `포트폴리오 사이트 워밍업 실패 ${this.consecutiveFailures}회 연속 — ${outcome.reason}`,
    );
    if (this.consecutiveFailures < FAILURE_ALERT_THRESHOLD) {
      return { skip: true };
    }
    // 재알림 억제를 여기서 따로 구현하지 않는다 — orchestrator 의 날짜 가드가 그룹당 하루
    // 1회만 발송하므로(`autopilot/application/autopilot.orchestrator.ts` 의 acquireOnce),
    // 같은 날 두 번째 알림은 거기서 끊긴다.
    return {
      skip: false,
      summaryText: [
        `⚠️ *포트폴리오 사이트 응답 없음* — ${this.consecutiveFailures}회 연속 실패`,
        `사유: ${outcome.reason}`,
        `대상: ${siteUrl.trim()}`,
      ].join('\n'),
    };
  }

  private async probeHealth(siteUrl: string): Promise<ProbeOutcome> {
    const startedAt = Date.now();
    const target = `${siteUrl.replace(/\/+$/, '')}/backend/health`;
    try {
      const response = await fetch(target, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const elapsedMs = Date.now() - startedAt;
      if (!response.ok) {
        return { ok: false, reason: `HTTP ${response.status}`, elapsedMs };
      }
      return { ok: true, elapsedMs };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - startedAt,
      };
    }
  }
}
