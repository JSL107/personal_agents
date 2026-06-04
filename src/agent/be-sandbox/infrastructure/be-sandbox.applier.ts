import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
import { GenerateBeDiffUsecase } from '../../be-diff-generator/application/generate-be-diff.usecase';
import { isBeSandboxApplyPayload } from '../domain/be-sandbox.type';

// Slack 응답 안 diff 표시 cap — Slack 메시지 한도 (40k) 와 멀어지지 않게 보수적으로 cap.
const DIFF_TAIL_LIMIT = 12_000;
// sandbox 명령 stdout/stderr 표시 cap — RunSandboxUsecase 자체 cap (256KB) 와 별도로 Slack 응답 폭주 방지.
const SANDBOX_OUTPUT_TAIL_LIMIT = 1_500;
// git apply --check 는 가벼움 (수십 KB diff 도 1~2초). Docker spawn + image pull 여유까지 30초.
const GIT_APPLY_CHECK_TIMEOUT_MS = 30_000;
// git 이 미리 설치된 base 이미지. node:20-alpine 은 git 누락 → bookworm-slim 으로 격상.
// network=none 이라 apk/apt 설치 불가, 미리 들어 있는 게 필수.
const SANDBOX_IMAGE = 'node:20-bookworm-slim';
// 명령 결과를 명시 sentinel 로 분기 — exit code + 본 sentinel 둘 다 통과해야 OK 로 판정.
// shell 명령 안 \`echo\` 가 0 인 비정상 종료도 잡기 위한 안전망.
const APPLY_OK_SENTINEL = 'PATCH_APPLY_CHECK_OK';

// PreviewKind.BE_SANDBOX_APPLY 의 strategy.
// Phase 2a-1: scaffold (sandbox echo).
// Phase 2a-2: Claude 로 unified diff 합성 + 사용자에게 표시 (실제 apply X).
// Phase 2a-3 (현 단계): sandbox 안 `git apply --check` 추가 — diff 가 host repo 의 현재
//   상태에 깨끗하게 적용 가능한지 1차 검증. 실제 변경 / pnpm test 는 Phase 2a-3b 후속.
// Phase 2a-3b: sandbox 안 실제 git apply + pnpm install + pnpm test + pnpm build.
@Injectable()
export class BeSandboxApplier implements PreviewApplier {
  readonly kind: PreviewKind = PREVIEW_KIND.BE_SANDBOX_APPLY;
  private readonly logger = new Logger(BeSandboxApplier.name);

  constructor(
    private readonly generateBeDiffUsecase: GenerateBeDiffUsecase,
    private readonly runSandboxUsecase: RunSandboxUsecase,
    private readonly configService: ConfigService,
  ) {}

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

    // 1) Claude 로 unified diff 합성 (Phase 2a-2 그대로 재사용).
    const diffResult = await this.generateBeDiffUsecase.execute({
      planText,
      repoLabel,
      baseBranch,
    });
    this.logger.log(
      `BE sandbox diff 합성 — repo=${repoLabel} files=${diffResult.changedFiles.length} diffBytes=${diffResult.diff.length}`,
    );

    // 2) sandbox 안 `git apply --check` — host repo (ro) 대비 diff 가 깨끗히 적용 가능한지 검증.
    //    실제 file write 없음. `--check` 가 exit=0 + APPLY_OK_SENTINEL 출력이면 valid.
    const hostRepoPath =
      this.configService.get<string>('BE_SANDBOX_HOST_REPO_PATH')?.trim() ||
      process.cwd();
    const checkResult = await this.runSandboxUsecase.execute({
      command: `git -C /repo apply --check /work/patch.diff && echo ${APPLY_OK_SENTINEL}`,
      hostMountPath: hostRepoPath,
      mountMode: 'ro',
      image: SANDBOX_IMAGE,
      networkMode: 'none',
      timeoutMs: GIT_APPLY_CHECK_TIMEOUT_MS,
      tmpfsFiles: [
        { containerPath: '/work/patch.diff', content: diffResult.diff },
      ],
    });
    const checkPassed =
      checkResult.exitCode === 0 &&
      !checkResult.timedOut &&
      checkResult.stdout.includes(APPLY_OK_SENTINEL);
    this.logger.log(
      `BE sandbox git apply --check — exit=${checkResult.exitCode} timedOut=${checkResult.timedOut} duration=${checkResult.durationMs}ms passed=${checkPassed}`,
    );

    const diffSnippet = truncate(diffResult.diff, DIFF_TAIL_LIMIT);

    const checkSection = checkPassed
      ? [
          '*✅ `git apply --check` 통과*',
          `• 실행 시간: ${checkResult.durationMs}ms`,
          `• base repo (ro mount): \`${hostRepoPath}\``,
        ].join('\n')
      : [
          '*❌ `git apply --check` 실패*',
          `• exit=${checkResult.exitCode}${checkResult.timedOut ? ' (timed out)' : ''}`,
          `• 실행 시간: ${checkResult.durationMs}ms`,
          '',
          '```',
          truncate(
            checkResult.stderr || checkResult.stdout || '(no output)',
            SANDBOX_OUTPUT_TAIL_LIMIT,
          ),
          '```',
        ].join('\n');

    return [
      `🧪 *BE Sandbox Apply — Phase 2a-3 (git apply --check)*`,
      '',
      `• 대상 repo: ${repoLabel}`,
      `• 베이스 브랜치: ${baseBranch}`,
      `• 변경 파일 (${diffResult.changedFiles.length}건): ${diffResult.changedFiles.join(', ')}`,
      '',
      `*Reasoning*`,
      diffResult.reasoning,
      '',
      checkSection,
      '',
      `*Diff*`,
      '```diff',
      diffSnippet,
      '```',
      '',
      '_Phase 2a-3 — `git apply --check` 까지만 (host repo 변경 X). Phase 2a-3b 에서 실제 apply + pnpm test 추가._',
    ].join('\n');
  }
}

const truncate = (text: string, maxBytes: number): string =>
  text.length > maxBytes
    ? `${text.slice(0, maxBytes)}\n... (생략됨 — cap ${maxBytes} bytes)`
    : text;
