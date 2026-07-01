import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { CareerMateException } from './career-mate.exception';
import { ParsedPrRef } from './career-mate.type';
import { CareerMateErrorCode } from './career-mate-error-code.enum';

// 자연어 문장 안에서 첫 PR 참조를 추출한다 (앵커 없음 — 멘션에 URL 이 섞여 옴).
// URL 을 shorthand 보다 우선한다.
const URL_PATTERN = /https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/;
const SHORTHAND_PATTERN = /(?:^|\s)([\w.-]+\/[\w.-]+)#(\d+)(?=\s|$)/;

export const extractPrReference = (text: string): ParsedPrRef => {
  const urlMatch = text.match(URL_PATTERN);
  if (urlMatch) {
    return { repo: urlMatch[1], number: Number.parseInt(urlMatch[2], 10) };
  }
  const shortMatch = text.match(SHORTHAND_PATTERN);
  if (shortMatch) {
    return { repo: shortMatch[1], number: Number.parseInt(shortMatch[2], 10) };
  }
  throw new CareerMateException({
    code: CareerMateErrorCode.INVALID_PR_REFERENCE,
    message:
      'PR 링크를 찾지 못했습니다. 예: "이 PR 회고해줘 https://github.com/owner/repo/pull/123" 처럼 PR URL 을 함께 보내주세요.',
    status: DomainStatus.BAD_REQUEST,
  });
};
