import { Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { PreviewApplier } from '../../../preview-gate/domain/port/preview-applier.port';
import { PreviewActionException } from '../../../preview-gate/domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PreviewAction,
  PreviewKind,
} from '../../../preview-gate/domain/preview-action.type';
import { PreviewActionErrorCode } from '../../../preview-gate/domain/preview-action-error-code.enum';
import { RunSandboxUsecase } from '../../../sandbox/application/run-sandbox.usecase';
import { isBeSandboxApplyPayload } from '../domain/be-sandbox.type';

// stdout/stderr 표시 cap — Slack 응답 메시지 폭주 방지. sandbox 자체 cap (256KB) 와 별도로
// 사용자 응답에 보일 양만 추가 cap.
const RESPONSE_TAIL_LIMIT = 2_000;
// Phase 2a-1 스모크 테스트 — sandbox 의 docker spawn / network=none / tmpfs 마운트 / output cap
// 등 보안 가드가 BE worker apply 경로에서 정상 작동하는지 확인하는 1줄 echo.
// Phase 2a-2 부터 실제 codex patch 합성 + git apply 명령으로 대체.
const SCAFFOLD_COMMAND =
  "echo '[BE_SANDBOX_APPLY scaffold] codex patch + pnpm test 미구현 — Phase 2a-2 진입 전 dry-run smoke test'";
const SCAFFOLD_TIMEOUT_MS = 30_000;

// PreviewKind.BE_SANDBOX_APPLY 의 strategy.
// Phase 2a-1: payload validation + sandbox echo 실행 + 결과 요약 반환. 실제 코드 변경 X.
// Phase 2a-2 부터 호스트 codex 로 unified diff 생성 → sandbox 안 git apply + pnpm test.
@Injectable()
export class BeSandboxApplier implements PreviewApplier {
  readonly kind: PreviewKind = PREVIEW_KIND.BE_SANDBOX_APPLY;
  private readonly logger = new Logger(BeSandboxApplier.name);

  constructor(private readonly runSandboxUsecase: RunSandboxUsecase) {}

  async apply(preview: PreviewAction): Promise<string> {
    if (!isBeSandboxApplyPayload(preview.payload)) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message:
          'BE_SANDBOX_APPLY payload 형식이 BeSandboxApplyPayload 와 맞지 않습니다.',
        status: DomainStatus.INTERNAL,
      });
    }

    const { planText, repoLabel, baseBranch } = preview.payload;

    // sandbox spawn — 호스트 fs 접근 X, network=none, command 만 실행.
    // 호스트 마운트가 없으므로 hostMountPath 는 /tmp 같은 무해한 경로로 (docker 가 마운트 자체를 안 함).
    const result = await this.runSandboxUsecase.execute({
      command: SCAFFOLD_COMMAND,
      hostMountPath: '/tmp',
      mountMode: 'ro',
      timeoutMs: SCAFFOLD_TIMEOUT_MS,
      networkMode: 'none',
    });

    this.logger.log(
      `BE sandbox apply (scaffold) — repo=${repoLabel} base=${baseBranch} exit=${result.exitCode} timedOut=${result.timedOut} duration=${result.durationMs}ms`,
    );

    return [
      `🧪 *BE Sandbox Apply — Phase 2a-1 scaffold*`,
      '',
      `• 대상 repo: ${repoLabel}`,
      `• 베이스 브랜치: ${baseBranch}`,
      `• Plan 길이: ${planText.length} chars`,
      `• Sandbox exit: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`,
      `• 실행 시간: ${result.durationMs}ms`,
      '',
      '```',
      result.stdout.slice(-RESPONSE_TAIL_LIMIT) || '(stdout 비어 있음)',
      '```',
      '',
      '_Phase 2a-1 scaffold — 실제 codex patch 합성 + git apply + pnpm test 는 Phase 2a-2/2a-3 PR 에서 추가._',
    ].join('\n');
  }
}
