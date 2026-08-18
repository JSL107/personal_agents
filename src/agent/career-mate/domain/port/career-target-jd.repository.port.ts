import { CareerTargetJdData } from '../career-mate.type';

export const CAREER_TARGET_JD_REPOSITORY_PORT = Symbol(
  'CareerTargetJdRepositoryPort',
);

export interface SaveCareerTargetJdInput {
  slackUserId: string;
  company: string;
  role: string;
  jdText: string;
}

export interface CareerTargetJdRepositoryPort {
  save(input: SaveCareerTargetJdInput): Promise<void>;
  findActiveBySlackUser(
    slackUserId: string,
    maxAgeDays: number,
  ): Promise<CareerTargetJdData | null>;
}
