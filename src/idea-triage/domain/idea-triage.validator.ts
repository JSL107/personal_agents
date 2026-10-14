import { IdeaTriageException } from './idea-triage.exception';
import { IdeaEffort, IdeaJudgement, IdeaVerdict } from './idea-triage.type';

const VERDICTS: readonly IdeaVerdict[] = ['BUILD', 'REVISE_THEN_BUILD', 'DROP'];
const EFFORTS: readonly IdeaEffort[] = ['S', 'M', 'L'];

export const validateIdeaTriageOutput = (value: unknown): IdeaJudgement => {
  if (!isRecord(value)) {
    throw invalid('최상위가 객체가 아닙니다.');
  }
  const { verdict, reason, counterpoint, scheduleTitle, effort } = value;
  if (
    typeof verdict !== 'string' ||
    !VERDICTS.includes(verdict as IdeaVerdict)
  ) {
    throw invalid('verdict 값이 올바르지 않습니다.');
  }
  if (typeof effort !== 'string' || !EFFORTS.includes(effort as IdeaEffort)) {
    throw invalid('effort 값이 올바르지 않습니다.');
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    throw invalid('reason 이 비어 있습니다.');
  }
  if (typeof counterpoint !== 'string' || !counterpoint.trim()) {
    throw invalid('counterpoint 가 비어 있습니다.');
  }
  if (typeof scheduleTitle !== 'string' || !scheduleTitle.trim()) {
    throw invalid('scheduleTitle 이 비어 있습니다.');
  }
  return {
    verdict: verdict as IdeaVerdict,
    reason: reason.trim(),
    counterpoint: counterpoint.trim(),
    scheduleTitle: scheduleTitle.trim().slice(0, 40),
    effort: effort as IdeaEffort,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalid = (message: string): IdeaTriageException =>
  new IdeaTriageException(`아이디어 판정 출력 거부 — ${message}`);
