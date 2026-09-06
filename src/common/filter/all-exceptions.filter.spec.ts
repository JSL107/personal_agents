import {
  ArgumentsHost,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';

import { CodeReviewerException } from '../../agent/code-reviewer/domain/code-reviewer.exception';
import { CodeReviewerErrorCode } from '../../agent/code-reviewer/domain/code-reviewer-error-code.enum';
import { DomainStatus } from '../exception/domain-status.enum';
import { AllExceptionsFilter } from './all-exceptions.filter';

type HostStub = {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
};

function createHostStub(url: string, userAgent?: string): HostStub {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status } as unknown as Response;
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        method: 'GET',
        url,
        headers: { 'user-agent': userAgent },
      }),
    }),
  } as ArgumentsHost;

  return { host, status, json };
}

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
  ])(
    '%s의 NO_OPEN_PR_FOUND를 HTTP 404와 동일 response code로 변환한다',
    (_, exception) => {
      const { host, status, json } = createHostStub('/v1/review-pr');

      new AllExceptionsFilter().catch(exception, host);

      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(json).toHaveBeenCalledWith({
        code: 'NO_OPEN_PR_FOUND',
        message: '열린 PR을 찾을 수 없습니다.',
        data: null,
      });
    },
  );

  describe('로그 레벨', () => {
    let warn: jest.SpyInstance;
    let error: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('4xx는 스택 없이 warn 으로만 남기고 요청자(UA)를 함께 적는다', () => {
      const { host } = createHostStub('/', 'IdaeriConsole/1.0');

      new AllExceptionsFilter().catch(
        new NotFoundException('Cannot GET /'),
        host,
      );

      expect(error).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[GET] / 404 Cannot GET / ua=IdaeriConsole/1.0',
      );
    });

    it('UA 가 없으면 - 로, 개행이 섞이면 한 줄로 눌러 로그 위조를 막는다', () => {
      const { host } = createHostStub('/', 'evil\nWARN [fake] 침입 성공');

      new AllExceptionsFilter().catch(new NotFoundException(), host);
      const injected = warn.mock.calls[0][0] as string;

      expect(injected).not.toContain('\n');
      expect(injected).toContain('ua=evil WARN [fake] 침입 성공');

      warn.mockClear();
      const { host: bareHost } = createHostStub('/');
      new AllExceptionsFilter().catch(new NotFoundException(), bareHost);

      expect(warn.mock.calls[0][0]).toContain('ua=-');
    });

    it('5xx는 스택과 함께 error 로 남긴다', () => {
      const { host } = createHostStub('/v1/console/state');

      new AllExceptionsFilter().catch(new InternalServerErrorException(), host);

      expect(warn).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        '[GET] /v1/console/state',
        expect.any(String),
      );
    });
  });
});
