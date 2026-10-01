export class NaverInvestorFlowHttpError extends Error {
  constructor(status: number) {
    super(`네이버 수급 조회 HTTP 오류: ${status}`);
    this.name = 'NaverInvestorFlowHttpError';
  }
}

export class NaverInvestorFlowParseError extends Error {
  constructor(message: string) {
    super(`네이버 수급 응답 파싱 실패: ${message}`);
    this.name = 'NaverInvestorFlowParseError';
  }
}
