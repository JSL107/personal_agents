import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { wrapUntrustedInput } from '../../../common/llm/untrusted-input.util';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  WATCH_RUNNER_PORT,
  WatchRunnerPort,
} from '../domain/port/watch-runner.port';
import { VIDEO_WATCH_SYSTEM_PROMPT } from '../domain/prompt/video-watch-system.prompt';
import { VideoWatchException } from '../domain/video-watch.exception';
import { VideoWatchResult, WatchReport } from '../domain/video-watch.type';
import { VideoWatchErrorCode } from '../domain/video-watch-error-code.enum';
import { parseVideoWatchOutput } from '../domain/video-watch-output.parser';
import { VIDEO_WATCH_OUTPUT_SCHEMA } from '../domain/video-watch-output.schema';
import { parseWatchReport } from '../domain/watch-report.parser';
import {
  extractYoutubeQuestion,
  extractYoutubeVideo,
} from '../domain/youtube-url.parser';

export interface WatchVideoInput {
  slackUserId: string;
  text: string;
  // /retry-run 은 FAILURE_REPLAY 로 부른다. 생략하면 자연어 멘션.
  triggerType?: TriggerType;
}

export interface WatchVideoOutcome extends AgentRunOutcome<VideoWatchResult> {
  report: {
    title: string | null;
    videoId: string;
    frameCount: number;
    transcriptSource: string | null;
  };
}

const TRANSCRIPT_LIMIT = 30_000;

@Injectable()
export class WatchVideoUsecase {
  private readonly logger = new Logger(WatchVideoUsecase.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly agentRunService: AgentRunService,
    private readonly modelRouter: ModelRouterUsecase,
    @Inject(WATCH_RUNNER_PORT) private readonly watchRunner: WatchRunnerPort,
  ) {}

  async execute({
    slackUserId,
    text,
    triggerType = TriggerType.SLACK_MENTION_VIDEO_WATCH,
  }: WatchVideoInput): Promise<WatchVideoOutcome> {
    const extracted = extractYoutubeVideo(text);
    if (!extracted) {
      throw new VideoWatchException({
        code: VideoWatchErrorCode.NO_YOUTUBE_URL,
        message: '유튜브 링크를 함께 보내 주세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    const question = extractYoutubeQuestion(text);
    const scriptPath = this.configService.get<string>('WATCH_SCRIPT_PATH');
    if (!scriptPath) {
      throw this.notConfigured();
    }
    try {
      await access(scriptPath);
    } catch {
      throw this.notConfigured();
    }

    let reportSummary: WatchVideoOutcome['report'] | null = null;
    const outcome = await this.agentRunService.execute<VideoWatchResult>({
      agentType: AgentType.VIDEO_WATCH,
      triggerType,
      // slackUserId 는 /retry-run 이 "본인 실행인가" 를 가리는 데 쓴다.
      inputSnapshot: {
        slackUserId,
        videoId: extracted.videoId,
        question,
      },
      evidence: [
        {
          sourceType: 'SLACK_MENTION_VIDEO_WATCH',
          sourceId: slackUserId,
          payload: { videoId: extracted.videoId, question },
        },
      ],
      run: async () => {
        let outDir: string | null = null;
        let homeDir: string | null = null;
        try {
          // watch.py 가 --out-dir 을 심볼릭 링크까지 풀어(resolve) 프레임 경로를 출력하므로
          // 같은 기준으로 맞춘다. macOS tmpdir(/var → /private/var) 에서 안 풀면 프레임이 전부 버려진다.
          outDir = await realpath(
            await mkdtemp(join(tmpdir(), 'idaeri-watch-output-')),
          );
          homeDir = await mkdtemp(join(tmpdir(), 'idaeri-watch-home-'));
          const markdown = await this.watchRunner.run({
            url: extracted.url,
            outDir,
            homeDir,
          });
          const report = parseWatchReport(markdown, outDir);
          const completion = await this.modelRouter.route({
            agentType: AgentType.VIDEO_WATCH,
            request: {
              systemPrompt: VIDEO_WATCH_SYSTEM_PROMPT,
              prompt: this.buildPrompt(question, report),
              outputSchema: VIDEO_WATCH_OUTPUT_SCHEMA,
              imagePaths: report.frames.map((frame) => frame.path),
            },
          });
          const result = parseVideoWatchOutput(
            completion.text,
            report.durationSec,
          );
          reportSummary = {
            title: report.title,
            videoId: extracted.videoId,
            frameCount: report.frames.length,
            transcriptSource: report.transcript
              ? report.transcriptSource
              : null,
          };
          return { result, modelUsed: completion.modelUsed, output: result };
        } finally {
          if (outDir) {
            await this.removeTemporaryDirectory(outDir);
          }
          if (homeDir) {
            await this.removeTemporaryDirectory(homeDir);
          }
        }
      },
    });

    return {
      ...outcome,
      report: reportSummary ?? {
        title: null,
        videoId: extracted.videoId,
        frameCount: 0,
        transcriptSource: null,
      },
    };
  }

  private buildPrompt(question: string, report: WatchReport): string {
    const transcript = report.transcript;
    const transcriptWasTruncated =
      transcript !== null && transcript.length > TRANSCRIPT_LIMIT;
    const clippedTranscript = transcript?.slice(0, TRANSCRIPT_LIMIT) ?? null;
    const transcriptContent = clippedTranscript
      ? wrapUntrustedInput(clippedTranscript)
      : '자막 없음';
    const title = report.title ? wrapUntrustedInput(report.title) : '제목 없음';
    const frameLines = report.frames.map(
      (frame, index) =>
        `F${index + 1} t=${this.formatTimestamp(frame.timestampSec)}`,
    );
    const truncationNotice = transcriptWasTruncated
      ? '\n[자막은 30,000자에서 잘렸습니다.]'
      : '';

    return [
      `질문: ${question}`,
      `영상 제목: ${title}`,
      `재생 시간(초): ${report.durationSec ?? '알 수 없음'}`,
      `프레임 목록(첨부 순서와 일치):\n${frameLines.join('\n') || '프레임 없음'}`,
      `자막:\n${transcriptContent}${truncationNotice}`,
    ].join('\n\n');
  }

  private formatTimestamp(timestampSec: number): string {
    const minutes = Math.floor(timestampSec / 60);
    const seconds = timestampSec % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  private async removeTemporaryDirectory(directory: string): Promise<void> {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`영상 분석 임시 디렉터리 정리 실패: ${message}`);
    }
  }

  private notConfigured(): VideoWatchException {
    return new VideoWatchException({
      code: VideoWatchErrorCode.WATCH_NOT_CONFIGURED,
      message:
        '영상 분석 도구가 설정되지 않았습니다. 관리자에게 WATCH_SCRIPT_PATH 설정을 요청해주세요.',
      status: DomainStatus.INTERNAL,
    });
  }
}
