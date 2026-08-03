import { Injectable, Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { GenerateBackendPlanUsecase } from '../../agent/be/application/generate-backend-plan.usecase';
import { GenerateSchemaProposalUsecase } from '../../agent/be-schema/application/generate-schema-proposal.usecase';
import { AnalyzeStackTraceUsecase } from '../../agent/be-sre/application/analyze-stack-trace.usecase';
import { GenerateTestUsecase } from '../../agent/be-test/application/generate-test.usecase';
import { HumanizeService } from '../../humanize/application/humanize.service';
import { humanizeBackendPlan } from '../../humanize/application/humanize-report.adapter';
import { SlackHandler } from '../domain/port/slack-handler.port';
import { formatBackendPlan } from '../format/backend-plan.formatter';
import { formatSchemaProposal } from '../format/be-schema.formatter';
import { formatSreAnalysis } from '../format/be-sre.formatter';
import { formatGeneratedTest } from '../format/be-test.formatter';
import { runAgentCommand } from './slack-handler.helper';

const HELP_TEXT = [
  '사용법: `/be <subcommand> <인자>`',
  '',
  '• `/be plan <PR URL / 작업 설명>` — 구현 계획 생성 (Claude)',
  '• `/be schema <자연어 요청>` — Prisma 스키마 변경 제안 (Claude)',
  '• `/be test <파일경로>` — Tree-sitter AST 기반 Jest spec 생성 (Claude)',
  '• `/be sre <stack trace>` — 스택트레이스 원인 분석',
  '',
  '_BE-FIX (PR 컨벤션) 은 GitHub webhook (`pull_request.opened`) 으로 자동 트리거됩니다. 수동 재실행은 `/retry-run <AgentRun ID>` 를 사용하세요._',
].join('\n');

// /be — 사용자가 손으로 트리거하는 백엔드 에이전트 4종의 단일 진입점.
// BE-SRE 는 /be sre 로 수동 호출한다. CI 실패 자동 대응은 GithubEventBridge 로 일원화했다.
// BE-FIX 는 GitHub webhook 자동 트리거를 유지한다 (수동 재실행은 /retry-run).
// 입력별 의도가 다른 백엔드 usecase 를 하나의 슬래시로 합쳐 자동완성 목록을 줄이는 게 목적.
//
// C-4 Phase 5 — registerBeHandler fn → @Injectable() class.
@Injectable()
export class BeHandler implements SlackHandler {
  private readonly logger = new Logger(BeHandler.name);

  constructor(
    private readonly generateBackendPlanUsecase: GenerateBackendPlanUsecase,
    private readonly generateSchemaProposalUsecase: GenerateSchemaProposalUsecase,
    private readonly analyzeStackTraceUsecase: AnalyzeStackTraceUsecase,
    private readonly generateTestUsecase: GenerateTestUsecase,
    private readonly humanizeService: HumanizeService,
  ) {}

  register(app: App): void {
    app.command('/be', async ({ ack, command, respond }) => {
      const raw = command.text?.trim() ?? '';
      if (raw.length === 0) {
        await ack({ response_type: 'ephemeral', text: HELP_TEXT });
        return;
      }

      // subcommand 와 본문을 한 번에 분리 — 첫 공백을 기준으로.
      // 본문에 추가 공백/줄바꿈이 있어도 subcommand 만 깨끗하게 추출된다.
      const firstSpace = raw.search(/\s/);
      const subcommand = firstSpace === -1 ? raw : raw.slice(0, firstSpace);
      const body = firstSpace === -1 ? '' : raw.slice(firstSpace + 1).trim();
      const slackUserId = command.user_id;

      switch (subcommand) {
        case 'plan': {
          if (body.length === 0) {
            await ack({
              response_type: 'ephemeral',
              text: '사용법: `/be plan <PR URL / 작업 설명>` (예: `/be plan 결제 검증 API 추가`)',
            });
            return;
          }
          await ack({
            response_type: 'ephemeral',
            text: '이대리(BE 모드) 가 구현 계획을 세우는 중입니다 (15~40초 소요)...',
          });
          await runAgentCommand({
            respond,
            logger: this.logger,
            commandLabel: '/be plan',
            execute: () =>
              this.generateBackendPlanUsecase.execute({
                subject: body,
                slackUserId,
              }),
            format: async (result) => {
              const humanized = await humanizeBackendPlan(
                result,
                this.humanizeService,
              );
              return formatBackendPlan(humanized);
            },
          });
          return;
        }
        case 'schema': {
          if (body.length === 0) {
            await ack({
              response_type: 'ephemeral',
              text: '사용법: `/be schema <자연어 요청>` (예: `/be schema 주문 취소 내역 테이블 추가`)',
            });
            return;
          }
          await ack({
            response_type: 'ephemeral',
            text: '이대리(BE Schema 모드) 가 schema.prisma 를 읽고 변경 제안을 작성 중입니다 (10~30초 소요)...',
          });
          await runAgentCommand({
            respond,
            logger: this.logger,
            commandLabel: '/be schema',
            execute: () =>
              this.generateSchemaProposalUsecase.execute({
                request: body,
                slackUserId,
              }),
            format: formatSchemaProposal,
          });
          return;
        }
        case 'test': {
          if (body.length === 0) {
            await ack({
              response_type: 'ephemeral',
              text: '사용법: `/be test <파일경로>` (예: `/be test src/agent/be-schema/application/generate-schema-proposal.usecase.ts`)',
            });
            return;
          }
          await ack({
            response_type: 'ephemeral',
            text: `이대리(BE-Test 모드) 가 ${body} 의 spec 을 생성 중입니다 (30~60초 소요)...`,
          });
          await runAgentCommand({
            respond,
            logger: this.logger,
            commandLabel: '/be test',
            execute: () =>
              this.generateTestUsecase.execute({
                filePath: body,
                slackUserId,
              }),
            format: formatGeneratedTest,
          });
          return;
        }
        case 'sre': {
          if (body.length === 0) {
            await ack({
              response_type: 'ephemeral',
              text: '사용법: `/be sre <stack trace 전체 paste>`',
            });
            return;
          }
          await ack({
            response_type: 'ephemeral',
            text: '이대리(BE-SRE 모드) 가 stack trace 를 분석 중입니다 (30~60초 소요)...',
          });
          await runAgentCommand({
            respond,
            logger: this.logger,
            commandLabel: '/be sre',
            execute: () =>
              this.analyzeStackTraceUsecase.execute({
                stackTrace: body,
                slackUserId,
              }),
            format: formatSreAnalysis,
          });
          return;
        }
        // BE-FIX subcommand 는 의도적으로 노출하지 않음. pull_request.opened webhook 자동
        // 트리거를 유지하며, 기존 FAILED run 의 수동 재실행은 /retry-run <id> 로 처리.
        default:
          await ack({
            response_type: 'ephemeral',
            text: `알 수 없는 subcommand \`${subcommand}\`.\n\n${HELP_TEXT}`,
          });
      }
    });
  }
}
