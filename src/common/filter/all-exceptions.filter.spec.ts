import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

import { BeFixException } from '../../agent/be-fix/domain/be-fix.exception';
import { BeFixErrorCode } from '../../agent/be-fix/domain/be-fix-error-code.enum';
import { CodeReviewerException } from '../../agent/code-reviewer/domain/code-reviewer.exception';
import { CodeReviewerErrorCode } from '../../agent/code-reviewer/domain/code-reviewer-error-code.enum';
import { DomainStatus } from '../exception/domain-status.enum';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  it.each([
    [
      'CodeReviewerException',
      new CodeReviewerException({
        message: '열린 PR을 찾을 수 없습니다.',
        code: 'NO_OPEN_PR_FOUND' as CodeReviewerErrorCode,
        status: DomainStatus.NOT_FOUND,
      }),
    ],
    [
      'BeFixException',
      new BeFixException({
        message: '열린 PR을 찾을 수 없습니다.',
        code: 'NO_OPEN_PR_FOUND' as BeFixErrorCode,
        status: DomainStatus.NOT_FOUND,
      }),
    ],
  ])(
    '%s의 NO_OPEN_PR_FOUND를 HTTP 404와 동일 response code로 변환한다',
    (_, exception) => {
      const json = jest.fn();
      const status = jest.fn().mockReturnValue({ json });
      const response = { status } as unknown as Response;
      const host = {
        switchToHttp: () => ({
          getResponse: () => response,
          getRequest: () => ({ method: 'GET', url: '/v1/review-pr' }),
        }),
      } as ArgumentsHost;

      new AllExceptionsFilter().catch(exception, host);

      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(json).toHaveBeenCalledWith({
        code: 'NO_OPEN_PR_FOUND',
        message: '열린 PR을 찾을 수 없습니다.',
        data: null,
      });
    },
  );
});
