import { isNonEmptyString } from '../../../common/util/type-guard.util';
import {
  APPLICATION_STATUSES,
  ApplicationStatus,
} from './job-application.type';

export const isApplicationStatus = (
  value: unknown,
): value is ApplicationStatus => {
  return APPLICATION_STATUSES.some((status) => status === value);
};

export const isWebUrl = (value: unknown): value is string => {
  if (!isNonEmptyString(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    const webUrl = url.protocol === 'http:' || url.protocol === 'https:';
    return webUrl;
  } catch {
    return false;
  }
};
