import { ConfigService } from '@nestjs/config';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { parsePlainDate, PlainDate } from '../domain/plain-date';
import { VacationException } from '../domain/vacation.exception';
import { VacationErrorCode } from '../domain/vacation-error-code.enum';

export const resolveHireDate = (config: ConfigService): PlainDate => {
  const raw = config.get<string>('VACATION_HIRE_DATE');
  const parsed = raw ? parsePlainDate(raw) : null;
  if (!parsed) {
    throw new VacationException({
      code: VacationErrorCode.HIRE_DATE_NOT_CONFIGURED,
      message:
        '입사일(VACATION_HIRE_DATE)이 설정되지 않았거나 형식이 잘못됐습니다. `.env` 에 `VACATION_HIRE_DATE=YYYY-MM-DD` 를 설정해주세요.',
      status: DomainStatus.PRECONDITION_FAILED,
    });
  }
  return parsed;
};
