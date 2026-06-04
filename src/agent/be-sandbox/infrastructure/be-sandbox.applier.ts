import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
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
import { BeSandboxPushPrPayload } from '../domain/be-sandbox-push-pr.type';
import { isBeSandboxApplyPayload } from '../domain/be-sandbox.type';

// Slack 응답 안 diff 표시 cap — Slack 메시지 한도 (40k) 와 멀어지지 않게 보수적으로 cap.
const DIFF_TAIL_LIMIT = 8_000;
// sandbox 명령 stdout/stderr 표시 cap — RunSandboxUsecase 자체 cap (256KB) 와 별도로 Slack 응답 폭주 방지.
const SANDBOX_OUTPUT_TAIL_LIMIT = 2_500;
// Phase 2a-3b — tar copy + git apply + jest 까지 포함이라 시간 여유 필요. tmpfs 안 jest 가
// 평균 10~30s, 큰 변경의 경우 60s+. 도커 spawn / image 캐시 첫 호출 여유까지 180s.
const APPLY_AND_TEST_TIMEOUT_MS = 180_000;
// tmpfs 안 repo 복사 시 큰 디렉터리 (node_modules / .git / dist) 는 제외하고 ro 마운트의 host
// node_modules 를 심볼릭 링크로 재사용 — 복사 시간 5~10s 수준 유지.
const TMPFS_SIZE = '512m';
// git 이 미리 설치된 base 이미지. node:20-alpine 은 git 누락 → bookworm-slim 으로 격상.
// network=none 이라 apk/apt 설치 불가, 미리 들어 있는 게 필수.
const SANDBOX_IMAGE = 'node:20-bookworm-slim';
// Phase 별 종료 sentinel — set -e + 본 sentinel 조합으로 사용자에게 어느 단계까지 성공했는지 노출.
const PHASE_A_SENTINEL = 'PHASE_A_CHECK_OK';
const PHASE_B_SENTINEL = 'PHASE_B_APPLY_OK';
const PHASE_C_SENTINEL = 'PHASE_C_TEST_OK';

// PreviewKind.BE_SANDBOX_APPLY 의 strategy.
// Phase 2a-1: scaffold (sandbox echo).
// Phase 2a-2: Claude 로 unified diff 합성 + 사용자에게 표시 (실제 apply X).
// Phase 2a-3: sandbox 안 `git apply --check` (host repo 변경 X, file write 0).
// Phase 2a-3b (현 단계): sandbox 안 tmpfs 에 repo 스테이지 + 실제 git apply + jest 실행.
//   - host repo 는 여전히 read-only 마운트. 변경은 sandbox tmpfs 안에만.
//   - 종료 시 docker --rm 으로 tmpfs 휘발 → 어떤 변경도 host 에 남지 않음.
// Phase 2b: 테스트 통과 시 octokit 로 branch + commit + PR open.
// Phase 2c: 테스트 실패 시 LLM self-correction retry.
@Injectable()
export class BeSandboxApplier implements PreviewApplier {
  readonly kind: PreviewKind = PREVIEW_KIND.BE_SANDBOX_APPLY;
  private readonly logger = new Logger(BeSandboxApplier.name);

  constructor(
    private readonly generateBeDiffUsecase: GenerateBeDiffUsecase,
    private readonly runSandboxUsecase: RunSandboxUsecase,
    private readonly configService: ConfigService,
    private readonly createPreviewUsecase: CreatePreviewUsecase,
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

    // 2) sandbox 안 apply + test — host repo 는 ro, 변경은 tmpfs 안에만.
    const hostRepoPath =
      this.configService.get<string>('BE_SANDBOX_HOST_REPO_PATH')?.trim() ||
      process.cwd();
    const sandboxResult = await this.runSandboxUsecase.execute({
      command: buildSandboxScript(),
      hostMountPath: hostRepoPath,
      mountMode: 'ro',
      image: SANDBOX_IMAGE,
      networkMode: 'none',
      timeoutMs: APPLY_AND_TEST_TIMEOUT_MS,
      tmpfsSize: TMPFS_SIZE,
      tmpfsFiles: [
        { containerPath: '/work/patch.diff', content: diffResult.diff },
      ],
    });

    const phase = classifyPhase(sandboxResult.stdout);
    const succeeded = sandboxResult.exitCode === 0 && phase === 'C';
    this.logger.log(
      `BE sandbox apply+test — exit=${sandboxResult.exitCode} timedOut=${sandboxResult.timedOut} duration=${sandboxResult.durationMs}ms phase=${phase} succeeded=${succeeded}`,
    );

    // succeeded → Phase 2b chain. 새 PreviewAction (BE_SANDBOX_PUSH_PR) 생성 → 사용자의 다음 "응" 응답이
    // BeSandboxPushPrApplier 로 라우팅 → octokit branch + commit + PR open.
    // 생성 실패는 graceful — 본 흐름 사용자 응답은 그대로 노출.
    let nextPreviewNotice: string | null = null;
    if (succeeded) {
      try {
        const pushPrPayload: BeSandboxPushPrPayload = {
          diff: diffResult.diff,
          reasoning: diffResult.reasoning,
          changedFiles: diffResult.changedFiles,
          repoLabel,
          baseBranch,
        };
        const next = await this.createPreviewUsecase.execute({
          slackUserId: preview.slackUserId,
          kind: PREVIEW_KIND.BE_SANDBOX_PUSH_PR,
          payload: pushPrPayload,
          previewText: `GitHub PR 자동 생성 (${repoLabel}, ${diffResult.changedFiles.length}건 파일).`,
          responseUrl: null,
          ttlMs: 30 * 60 * 1000,
        });
        this.logger.log(
          `BE sandbox Phase 2b chain preview 생성 — previewId=${next.id} repo=${repoLabel} files=${diffResult.changedFiles.length}`,
        );
        nextPreviewNotice = `다음 단계 — GitHub PR auto-open 진행할까요? **"응"** 입력하면 새 branch + commit + PR open. ("아니" 면 종료.)`;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `BE sandbox Phase 2b chain preview 생성 실패: ${message}`,
        );
        nextPreviewNotice = `_⚠️ Phase 2b chain preview 생성 실패 — PR auto-open 흐름 비활성. 사유: ${message.slice(0, 200)}_`;
      }
    }

    return formatResult({
      repoLabel,
      baseBranch,
      hostRepoPath,
      diffResult,
      sandboxResult,
      phase,
      succeeded,
      nextPreviewNotice,
    });
  }
}

// sandbox 안에서 실행될 bash 스크립트. set -e + sentinel 조합으로 단계별 진행 노출.
// host /repo 는 ro 마운트. tmpfs /work (512m) 에 repo 스테이지 후 git apply + jest.
//
// 보안 / 격리 정리:
// - /repo: read-only → host 파일 어떤 명령으로도 변경 불가
// - /work: tmpfs → 컨테이너 종료 (docker --rm) 시 메모리 해제, 흔적 0
// - network=none → 외부 호출 차단 (악성 diff 가 데이터 exfil 불가)
// - node_modules: /repo (ro) 의 것을 symlink 로 재사용 → host write 없이 실행 가능
const buildSandboxScript = (): string =>
  [
    'set -e',
    // Phase A: diff 가 host repo 의 현재 상태에 적용 가능한지 1차 검증 (--check 는 file write 0).
    'git -C /repo apply --check /work/patch.diff',
    `echo ${PHASE_A_SENTINEL}`,
    // Phase B: repo 를 tmpfs 에 스테이지. node_modules / .git / dist 는 제외 (tmpfs 512m 한도 + 속도).
    //   - node_modules 는 /repo (ro) 의 것을 symlink — host write 0.
    'mkdir -p /work/checkout',
    'cd /repo',
    "tar --exclude='./node_modules' --exclude='./.git' --exclude='./dist' -cf - . | (cd /work/checkout && tar xf -)",
    'ln -s /repo/node_modules /work/checkout/node_modules',
    'cd /work/checkout',
    'git apply /work/patch.diff',
    `echo ${PHASE_B_SENTINEL}`,
    // Phase C: jest --bail. node_modules/.bin/jest 는 /repo 의 host bin 을 symlink 통해 호출.
    //   --bail 로 첫 실패에서 stop, --testPathIgnorePatterns 로 node_modules 안 spec 무시.
    "./node_modules/.bin/jest --bail --testPathIgnorePatterns='/node_modules/' 2>&1",
    `echo ${PHASE_C_SENTINEL}`,
  ].join('\n');

// sandbox stdout 의 sentinel 들을 검사해 어느 phase 까지 통과했는지 분류.
// 'A' = check 까지만 OK, 'B' = apply 까지 OK, 'C' = test 까지 OK, 'NONE' = check 도 실패.
const classifyPhase = (stdout: string): 'NONE' | 'A' | 'B' | 'C' => {
  if (stdout.includes(PHASE_C_SENTINEL)) {
    return 'C';
  }
  if (stdout.includes(PHASE_B_SENTINEL)) {
    return 'B';
  }
  if (stdout.includes(PHASE_A_SENTINEL)) {
    return 'A';
  }
  return 'NONE';
};

interface FormatInput {
  repoLabel: string;
  baseBranch: string;
  hostRepoPath: string;
  diffResult: {
    diff: string;
    reasoning: string;
    changedFiles: string[];
  };
  sandboxResult: {
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
  };
  phase: 'NONE' | 'A' | 'B' | 'C';
  succeeded: boolean;
  nextPreviewNotice: string | null;
}

const formatResult = ({
  repoLabel,
  baseBranch,
  hostRepoPath,
  diffResult,
  sandboxResult,
  phase,
  succeeded,
  nextPreviewNotice,
}: FormatInput): string => {
  const diffSnippet = truncate(diffResult.diff, DIFF_TAIL_LIMIT);
  const outputTail = truncate(
    sandboxResult.stdout || sandboxResult.stderr || '(no output)',
    SANDBOX_OUTPUT_TAIL_LIMIT,
  );
  const statusSection = succeeded
    ? [
        '*✅ Sandbox apply + test 통과*',
        `• 실행 시간: ${sandboxResult.durationMs}ms`,
        `• base repo (ro mount): \`${hostRepoPath}\``,
      ].join('\n')
    : [
        `*❌ Phase ${phase === 'NONE' ? 'A' : phase} 에서 실패*`,
        `• exit=${sandboxResult.exitCode}${sandboxResult.timedOut ? ' (timed out)' : ''}`,
        `• 실행 시간: ${sandboxResult.durationMs}ms`,
        `• phase 별 진행 — A(check) ${phase === 'NONE' ? '❌' : '✅'} / B(apply) ${['B', 'C'].includes(phase) ? '✅' : '❌'} / C(jest) ${phase === 'C' ? '✅' : '❌'}`,
        '',
        '```',
        outputTail,
        '```',
      ].join('\n');

  const sections: string[] = [
    `🧪 *BE Sandbox Apply — Phase 2a-3b (실제 git apply + jest)*`,
    '',
    `• 대상 repo: ${repoLabel}`,
    `• 베이스 브랜치: ${baseBranch}`,
    `• 변경 파일 (${diffResult.changedFiles.length}건): ${diffResult.changedFiles.join(', ')}`,
    '',
    `*Reasoning*`,
    diffResult.reasoning,
    '',
    statusSection,
    '',
    `*Diff*`,
    '```diff',
    diffSnippet,
    '```',
  ];
  if (nextPreviewNotice) {
    sections.push('', nextPreviewNotice);
  } else if (!succeeded) {
    sections.push(
      '',
      '_Phase 2a-3b — sandbox tmpfs 안에서만 적용 + test. host repo 변경 0. 통과 시 Phase 2b PR auto-open chain._',
    );
  }
  return sections.join('\n');
};

const truncate = (text: string, maxBytes: number): string =>
  text.length > maxBytes
    ? `${text.slice(0, maxBytes)}\n... (생략됨 — cap ${maxBytes} bytes)`
    : text;
