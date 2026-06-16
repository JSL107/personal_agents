import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  addDays,
  plainDateToUtcDate,
  utcDateToPlainDate,
} from '../../vacation/domain/plain-date';
import {
  ApplicationStatus,
  JobApplicationRecord,
  TERMINAL_STATUSES,
} from '../domain/job-application.type';
import {
  FindDueNudgesInput,
  JobApplicationRepositoryPort,
  SaveApplicationInput,
  UpdateStatusByCompanyInput,
} from '../domain/port/job-application.repository.port';

type Row = {
  id: number;
  slackUserId: string;
  company: string;
  role: string;
  jdUrl: string | null;
  status: string;
  appliedAt: Date;
  deadline: Date | null;
  nextFollowUpAt: Date | null;
  notes: string | null;
  createdAt: Date;
};

const mapRow = (row: Row): JobApplicationRecord => ({
  id: row.id,
  slackUserId: row.slackUserId,
  company: row.company,
  role: row.role,
  jdUrl: row.jdUrl,
  status: row.status as ApplicationStatus,
  appliedAt: utcDateToPlainDate(row.appliedAt),
  deadline: row.deadline ? utcDateToPlainDate(row.deadline) : null,
  nextFollowUpAt: row.nextFollowUpAt
    ? utcDateToPlainDate(row.nextFollowUpAt)
    : null,
  notes: row.notes,
  createdAt: row.createdAt,
});

@Injectable()
export class JobApplicationPrismaRepository implements JobApplicationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(input: SaveApplicationInput): Promise<JobApplicationRecord> {
    const row = await this.prisma.jobApplication.create({
      data: {
        slackUserId: input.slackUserId,
        company: input.company,
        role: input.role,
        jdUrl: input.jdUrl ?? null,
        status: input.status,
        appliedAt: plainDateToUtcDate(input.appliedAt),
        deadline: input.deadline ? plainDateToUtcDate(input.deadline) : null,
        nextFollowUpAt: input.nextFollowUpAt
          ? plainDateToUtcDate(input.nextFollowUpAt)
          : null,
      },
    });
    return mapRow(row);
  }

  // 회사명 부분일치 + 비종료 상태 중 최신 1건의 status + 팔로업 클럭 갱신.
  async updateStatusByCompany({
    slackUserId,
    companyRef,
    status,
    nextFollowUpAt,
  }: UpdateStatusByCompanyInput): Promise<JobApplicationRecord | null> {
    const target = await this.prisma.jobApplication.findFirst({
      where: {
        slackUserId,
        company: { contains: companyRef, mode: Prisma.QueryMode.insensitive },
        status: { notIn: TERMINAL_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!target) {
      return null;
    }
    const row = await this.prisma.jobApplication.update({
      where: { id: target.id },
      data: {
        status,
        nextFollowUpAt: nextFollowUpAt
          ? plainDateToUtcDate(nextFollowUpAt)
          : null,
      },
    });
    return mapRow(row);
  }

  async listByUser(slackUserId: string): Promise<JobApplicationRecord[]> {
    const rows = await this.prisma.jobApplication.findMany({
      where: { slackUserId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapRow);
  }

  // (마감 ≤ +N일 & 비종료) OR (nextFollowUpAt ≤ today & 비종료)
  // 마감 하한(gte today)을 두지 않는다 — 이미 지난(overdue) 마감도 비종료면 넛지 대상.
  async findDueNudges({
    slackUserId,
    today,
    deadlineWithinDays,
  }: FindDueNudgesInput): Promise<JobApplicationRecord[]> {
    const todayUtc = plainDateToUtcDate(today);
    const horizonUtc = plainDateToUtcDate(addDays(today, deadlineWithinDays));
    const rows = await this.prisma.jobApplication.findMany({
      where: {
        slackUserId,
        status: { notIn: TERMINAL_STATUSES },
        OR: [
          { deadline: { lte: horizonUtc } },
          { nextFollowUpAt: { lte: todayUtc } },
        ],
      },
      orderBy: { deadline: 'asc' },
    });
    return rows.map(mapRow);
  }
}
