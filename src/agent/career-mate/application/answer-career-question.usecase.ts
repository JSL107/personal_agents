import { Inject, Injectable } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import {
  FactAnswer,
  FactAnswerUsecase,
} from '../../../fact-answer/application/fact-answer.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { ConversationTurn } from '../../../router/domain/conversation-memory.type';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import {
  formatProfileSummary,
  formatUnknownCareerMate,
} from '../infrastructure/career-mate.formatter';

interface AnswerCareerQuestionCommand {
  slackUserId: string;
  text: string;
  priorTurns: readonly ConversationTurn[];
  parsedIntent: Record<string, unknown>;
}

// 사실로 넘기는 성과 수 — 프로필 전체를 실으면 프롬프트가 길어지고 답이 흐려진다.
const ACCOMPLISHMENT_LIMIT = 10;

// 이직 메이트 파서가 메뉴 액션으로 처리하지 못한 질문("이력서 기준으로 몇 년차로 보여?")에 저장된
// 역량 프로필로 답한다. 이런 질문이 이력서 보정(CALIBRATE_RESUME) 같은 무거운 생성 작업으로 빠지던
// 문제(eval t-career-question)를 고친다. (plan: docs/superpowers/plans/2026-10-07-nl-answer-fidelity.md §4 3단계)
@Injectable()
export class AnswerCareerQuestionUsecase {
  constructor(
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly profiles: CareerProfileRepositoryPort,
    private readonly agentRunService: AgentRunService,
    private readonly factAnswer: FactAnswerUsecase,
  ) {}

  async execute({
    slackUserId,
    text,
    priorTurns,
    parsedIntent,
  }: AnswerCareerQuestionCommand): Promise<AgentRunOutcome<FactAnswer>> {
    return this.agentRunService.execute({
      agentType: AgentType.CAREER_MATE,
      triggerType: TriggerType.SLACK_MENTION_CAREER_MATE,
      inputSnapshot: { slackUserId, action: 'UNKNOWN', parsedIntent },
      evidence: [],
      run: async () => {
        const latest = await this.profiles.findLatestBySlackUser(slackUserId);
        const profile = latest?.profileJson;
        const facts =
          profile === undefined
            ? {
                hasProfile: false,
                howToCreate:
                  '"프로필 정리해줘" 라고 말하면 최근 PR 로 역량 프로필을 만든다.',
              }
            : {
                hasProfile: true,
                profileCreatedAt: latest!.createdAt.toISOString().slice(0, 10),
                basedOn: {
                  githubLogin: profile.meta.githubLogin,
                  windowStart: profile.meta.windowStart,
                  prCount: profile.meta.prCount,
                },
                summary: profile.summary,
                skills: profile.skills.map((skill) => ({
                  name: skill.name,
                  category: skill.category,
                  proficiency: skill.proficiency,
                })),
                accomplishments: profile.accomplishments
                  .slice(0, ACCOMPLISHMENT_LIMIT)
                  .map((accomplishment) => ({
                    title: accomplishment.title,
                    bullet: accomplishment.bullet,
                    techTags: accomplishment.techTags,
                  })),
                note: '프로필은 GitHub PR 에서 뽑은 것이라 총 경력 연수·재직 기간 같은 값은 들어 있지 않다.',
              };
        const answer = await this.factAnswer.answer({
          agentType: AgentType.CAREER_MATE,
          text,
          priorTurns,
          facts,
          fallbackText:
            profile === undefined
              ? formatUnknownCareerMate()
              : formatProfileSummary(profile),
        });
        return {
          result: answer,
          modelUsed: answer.modelUsed,
          output: {
            facts,
            reply: answer.text,
            usedFallback: answer.usedFallback,
            ...(answer.numberCheck !== undefined
              ? { numberCheck: answer.numberCheck }
              : {}),
            ...(answer.answerError !== undefined
              ? { answerError: answer.answerError }
              : {}),
          },
        };
      },
    });
  }
}
