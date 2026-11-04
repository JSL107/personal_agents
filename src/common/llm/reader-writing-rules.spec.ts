import {
  EVENING_BLOG_BODY_SYSTEM_PROMPT,
  EVENING_RETRO_SYSTEM_PROMPT,
} from '../../agent/blog/domain/prompt/evening-retro.prompt';
import { CALIBRATION_SYSTEM_PROMPT } from '../../agent/career-mate/domain/prompt/calibration.prompt';
import { CAREER_MATE_INTENT_SYSTEM_PROMPT } from '../../agent/career-mate/domain/prompt/career-mate-intent.prompt';
import { CAREER_PROFILE_SYNTH_SYSTEM_PROMPT } from '../../agent/career-mate/domain/prompt/career-profile-synth.prompt';
import { JD_GAP_SYSTEM_PROMPT } from '../../agent/career-mate/domain/prompt/jd-gap.prompt';
import { PORTFOLIO_COVER_SYSTEM_PROMPT } from '../../agent/career-mate/domain/prompt/portfolio-cover.prompt';
import {
  MULTI_PR_RETRO_SYNTH_SYSTEM_PROMPT,
  PR_RETRO_SYNTH_SYSTEM_PROMPT,
} from '../../agent/career-mate/domain/prompt/pr-retro-synth.prompt';
import { RESUME_AUDIT_SYSTEM_PROMPT } from '../../agent/career-mate/domain/prompt/resume-audit.prompt';
import { CODE_REVIEWER_SYSTEM_PROMPT } from '../../agent/code-reviewer/domain/prompt/code-reviewer-system.prompt';
import { IMPACT_REPORTER_SYSTEM_PROMPT } from '../../agent/impact-reporter/domain/prompt/impact-reporter-system.prompt';
import { buildPaperRecommendSystemPrompt } from '../../agent/paper-recommend/domain/prompt/paper-recommend-system.prompt';
import { PM_SYSTEM_PROMPT } from '../../agent/pm/domain/prompt/pm-system.prompt';
import { PO_EVAL_SYSTEM_PROMPT } from '../../agent/po-eval/domain/prompt/po-eval-system.prompt';
import { WORK_REVIEWER_SYSTEM_PROMPT } from '../../agent/work-reviewer/domain/prompt/work-reviewer-system.prompt';
import { FACT_ANSWER_SYSTEM_PROMPT } from '../../fact-answer/domain/fact-answer.prompt';
import { READER_WRITING_RULES } from './reader-writing-rules';

describe('READER_WRITING_RULES', () => {
  it.each([
    ['work reviewer', WORK_REVIEWER_SYSTEM_PROMPT],
    ['PO evaluation', PO_EVAL_SYSTEM_PROMPT],
    ['impact report', IMPACT_REPORTER_SYSTEM_PROMPT],
    ['evening retro', EVENING_RETRO_SYSTEM_PROMPT],
    ['evening blog', EVENING_BLOG_BODY_SYSTEM_PROMPT],
    ['career intent', CAREER_MATE_INTENT_SYSTEM_PROMPT],
    ['career calibration', CALIBRATION_SYSTEM_PROMPT],
    ['career profile', CAREER_PROFILE_SYNTH_SYSTEM_PROMPT],
    ['career JD gap', JD_GAP_SYSTEM_PROMPT],
    ['career PR retro', PR_RETRO_SYNTH_SYSTEM_PROMPT],
    ['career multi PR retro', MULTI_PR_RETRO_SYNTH_SYSTEM_PROMPT],
    ['career project group', PORTFOLIO_COVER_SYSTEM_PROMPT],
    ['career resume audit', RESUME_AUDIT_SYSTEM_PROMPT],
    [
      'paper recommendation',
      buildPaperRecommendSystemPrompt({ maximumWeightPercent: 20 }),
    ],
    ['code reviewer', CODE_REVIEWER_SYSTEM_PROMPT],
    ['fact answer', FACT_ANSWER_SYSTEM_PROMPT],
    ['PM', PM_SYSTEM_PROMPT],
  ])('%s 프롬프트에 읽는 사람 규칙을 넣는다', (_name, prompt) => {
    expect(prompt).toContain(READER_WRITING_RULES);
  });
});
