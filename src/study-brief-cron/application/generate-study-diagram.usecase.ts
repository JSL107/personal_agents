import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  HERMES_RUNNER_PORT,
  HermesRunnerPort,
} from '../../agent/blog/domain/port/hermes-runner.port';
import {
  STUDY_DIAGRAM_RENDERER_PORT,
  StudyDiagramRendererPort,
} from '../domain/port/study-diagram-renderer.port';
import {
  DiagramLimits,
  DiagramViolation,
} from '../domain/study-diagram.checker';
import { parseStudyDiagram } from '../domain/study-diagram.parser';
import {
  buildStudyDiagramPrompt,
  buildStudyDiagramRetryPrompt,
} from '../domain/study-diagram.prompt';
import { StudyResearchKind } from '../domain/study-research.parser';

const DEFAULT_WIDTH_PX = 700;
const DEFAULT_MIN_FONT_PX = 14;
const DEFAULT_MAX_HEIGHT_PX = 1600;

export interface GenerateStudyDiagramInput {
  topic: string;
  kind: StudyResearchKind;
  reportMd: string;
}

export interface GenerateStudyDiagramOptions {
  // 기준 미달로 거부된 그림도 돌려준다. 수동 확인(scripts/study-diagram.ts) 전용이며
  // cron 경로는 쓰지 않는다 — 기본값이 꺼짐이라 자동 동작은 달라지지 않는다.
  keepRejected?: boolean;
}

export interface GeneratedStudyDiagram {
  png: Buffer;
  html: string;
  // 통과한 그림은 빈 배열이다. keepRejected 로 받은 그림에만 값이 있다.
  violations: DiagramViolation[];
}

// 그림은 페이지를 막을 이유가 아니다. 어느 단계에서 실패하든 예외를 밖으로 던지지 않고
// null 을 돌려주며, 왜 포기했는지는 로그에 남긴다. 조용한 0건은 에러보다 오래 산다.
@Injectable()
export class GenerateStudyDiagramUsecase {
  private readonly logger = new Logger(GenerateStudyDiagramUsecase.name);

  constructor(
    @Inject(HERMES_RUNNER_PORT)
    private readonly hermesRunner: HermesRunnerPort,
    @Inject(STUDY_DIAGRAM_RENDERER_PORT)
    private readonly renderer: StudyDiagramRendererPort,
    private readonly configService: ConfigService,
  ) {}

  async execute(
    input: GenerateStudyDiagramInput,
    options: GenerateStudyDiagramOptions = {},
  ): Promise<GeneratedStudyDiagram | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const limits = this.resolveLimits();
    const first = await this.attempt(
      buildStudyDiagramPrompt({ ...input, limits }),
      limits,
    );
    if (first === null) {
      return null;
    }
    if (first.violations.length === 0) {
      return toGenerated(first);
    }

    this.logger.log(
      `Study 그림 1차 거부 — 재작업 1회 시도: ${describeViolations(first.violations)}`,
    );
    const second = await this.attempt(
      buildStudyDiagramRetryPrompt({
        ...input,
        limits,
        violations: first.violations,
      }),
      limits,
    );
    if (second === null) {
      return options.keepRejected === true ? toGenerated(first) : null;
    }
    if (second.violations.length > 0) {
      this.logger.warn(
        `Study 그림 재작업도 거부 — 그림 없이 발행: ${describeViolations(second.violations)}`,
      );
      return options.keepRejected === true ? toGenerated(second) : null;
    }
    return toGenerated(second);
  }

  private isEnabled(): boolean {
    return (
      this.configService.get<string>('STUDY_DIAGRAM_ENABLED')?.trim() === 'true'
    );
  }

  private resolveLimits(): DiagramLimits {
    return {
      widthPx: this.readNumber('STUDY_DIAGRAM_WIDTH_PX', DEFAULT_WIDTH_PX),
      minFontPx: this.readNumber(
        'STUDY_DIAGRAM_MIN_FONT_PX',
        DEFAULT_MIN_FONT_PX,
      ),
      maxHeightPx: this.readNumber(
        'STUDY_DIAGRAM_MAX_HEIGHT_PX',
        DEFAULT_MAX_HEIGHT_PX,
      ),
    };
  }

  private readNumber(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key)?.trim();
    if (!raw) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.logger.warn(
        `${key} 값이 올바르지 않아 기본값 ${fallback} 을 씁니다: ${raw}`,
      );
      return fallback;
    }
    return parsed;
  }

  private async attempt(
    prompt: string,
    limits: DiagramLimits,
  ): Promise<AttemptResult | null> {
    let stdout: string;
    try {
      // codex 호출 실패는 재시도하지 않는다 — 쿼터 소진 한 건이 뒤 일정까지 무너뜨린 전례가 있다.
      const result = await this.hermesRunner.run(prompt);
      stdout = result.stdout;
    } catch (error: unknown) {
      this.logger.warn(
        `Study 그림 생성 호출 실패 — 그림 생략: ${formatError(error)}`,
      );
      return null;
    }

    const parsed = parseStudyDiagram(stdout);
    if ('rejectedReason' in parsed) {
      this.logger.warn(
        `Study 그림 출력 거부 — 그림 생략: ${parsed.rejectedReason}`,
      );
      return null;
    }

    try {
      const rendered = await this.renderer.render({
        html: parsed.html,
        limits,
      });
      return {
        png: rendered.png,
        html: parsed.html,
        violations: rendered.violations,
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Study 그림 렌더 실패 — 그림 생략: ${formatError(error)}`,
      );
      return null;
    }
  }
}

interface AttemptResult {
  png: Buffer;
  html: string;
  violations: DiagramViolation[];
}

const toGenerated = ({
  png,
  html,
  violations,
}: AttemptResult): GeneratedStudyDiagram => ({ png, html, violations });

const describeViolations = (violations: DiagramViolation[]): string =>
  violations.map((violation) => violation.detail).join(' / ');

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
