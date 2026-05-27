import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { AgentType } from '../../../../model-router/domain/model-router.type';
import { CtoException } from '../cto.exception';
import {
  Assignment,
  AssignmentOutput,
  BeAssignmentType,
  UnassignedTask,
} from '../cto.type';
import { CtoErrorCode } from '../cto-error-code.enum';

const VALID_BE_ASSIGNMENTS: BeAssignmentType[] = [
  AgentType.BE,
  AgentType.BE_SCHEMA,
  AgentType.BE_TEST,
];

// LLM 응답 텍스트 → AssignmentOutput. schema 위반 시 CtoException(PARSE_FAILED).
// fence 가 LLM output 에 섞이는 케이스 graceful — system prompt 에 "fence 금지" 명시했지만 안전망.
export const parseAssignmentOutput = (raw: string): AssignmentOutput => {
  const cleaned = stripCodeFence(raw.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new CtoException({
      code: CtoErrorCode.PARSE_FAILED,
      message: `CTO 응답 JSON parse 실패: ${cleaned.slice(0, 120)}`,
      status: DomainStatus.INTERNAL,
      cause: error,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CtoException({
      code: CtoErrorCode.PARSE_FAILED,
      message: `CTO 응답이 객체가 아님: ${typeof parsed}`,
      status: DomainStatus.INTERNAL,
    });
  }
  const root = parsed as Record<string, unknown>;
  const assignments = parseAssignments(root.assignments);
  const unassignedTasks = parseUnassignedTasks(root.unassignedTasks);
  const ctoSummary = typeof root.ctoSummary === 'string' ? root.ctoSummary : '';
  return { assignments, unassignedTasks, ctoSummary };
};

const parseAssignments = (raw: unknown): Assignment[] => {
  if (!Array.isArray(raw)) {
    throw new CtoException({
      code: CtoErrorCode.PARSE_FAILED,
      message: 'assignments 필드가 array 가 아님',
      status: DomainStatus.INTERNAL,
    });
  }
  return raw.map((item, idx) => {
    if (typeof item !== 'object' || item === null) {
      throw new CtoException({
        code: CtoErrorCode.PARSE_FAILED,
        message: `assignments[${idx}] 가 객체가 아님`,
        status: DomainStatus.INTERNAL,
      });
    }
    const obj = item as Record<string, unknown>;
    const taskId = readString(obj.taskId, `assignments[${idx}].taskId`);
    const taskTitle = readString(
      obj.taskTitle,
      `assignments[${idx}].taskTitle`,
    );
    const beAssignment = readBeAssignment(
      obj.beAssignment,
      `assignments[${idx}].beAssignment`,
    );
    const priority = readPriority(obj.priority, `assignments[${idx}].priority`);
    const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';
    const confidence = readConfidence(
      obj.confidence,
      `assignments[${idx}].confidence`,
    );
    return { taskId, taskTitle, beAssignment, priority, reasoning, confidence };
  });
};

const parseUnassignedTasks = (raw: unknown): UnassignedTask[] => {
  // 빈 배열 / 미존재 graceful — 모든 task 가 분배된 케이스.
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new CtoException({
      code: CtoErrorCode.PARSE_FAILED,
      message: 'unassignedTasks 필드가 array 가 아님',
      status: DomainStatus.INTERNAL,
    });
  }
  return raw.map((item, idx) => {
    if (typeof item !== 'object' || item === null) {
      throw new CtoException({
        code: CtoErrorCode.PARSE_FAILED,
        message: `unassignedTasks[${idx}] 가 객체가 아님`,
        status: DomainStatus.INTERNAL,
      });
    }
    const obj = item as Record<string, unknown>;
    const taskId = readString(obj.taskId, `unassignedTasks[${idx}].taskId`);
    const taskTitle = readString(
      obj.taskTitle,
      `unassignedTasks[${idx}].taskTitle`,
    );
    const reason = typeof obj.reason === 'string' ? obj.reason : '';
    return { taskId, taskTitle, reason };
  });
};

const readString = (value: unknown, label: string): string => {
  if (typeof value !== 'string') {
    throw new CtoException({
      code: CtoErrorCode.PARSE_FAILED,
      message: `${label} 가 string 이 아님: ${typeof value}`,
      status: DomainStatus.INTERNAL,
    });
  }
  return value;
};

const readBeAssignment = (value: unknown, label: string): BeAssignmentType => {
  if (
    typeof value !== 'string' ||
    !VALID_BE_ASSIGNMENTS.includes(value as BeAssignmentType)
  ) {
    throw new CtoException({
      code: CtoErrorCode.PARSE_FAILED,
      message: `${label} 가 BE / BE_SCHEMA / BE_TEST 중 하나가 아님: ${value}`,
      status: DomainStatus.INTERNAL,
    });
  }
  return value as BeAssignmentType;
};

const readPriority = (value: unknown, label: string): 1 | 2 | 3 => {
  if (value === 1 || value === 2 || value === 3) {
    return value;
  }
  throw new CtoException({
    code: CtoErrorCode.PARSE_FAILED,
    message: `${label} 가 1/2/3 중 하나가 아님: ${value}`,
    status: DomainStatus.INTERNAL,
  });
};

const readConfidence = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CtoException({
      code: CtoErrorCode.PARSE_FAILED,
      message: `${label} 가 number 가 아님: ${typeof value}`,
      status: DomainStatus.INTERNAL,
    });
  }
  return Math.max(0, Math.min(1, value));
};

const stripCodeFence = (text: string): string =>
  text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
