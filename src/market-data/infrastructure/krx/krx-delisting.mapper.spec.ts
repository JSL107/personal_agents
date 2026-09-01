import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseKrxDelistingHtml } from './krx-delisting.mapper';

const row = ({
  no = '1',
  name = '회사',
  code,
  delistedAt = '2026-08-18',
  reason = '피흡수합병',
}: {
  no?: string;
  name?: string;
  code: string;
  delistedAt?: string;
  reason?: string;
}): string => {
  return `<tr>
    <td style="text-align:center;">${no}</td>
    <td>${name}</td>
    <td style="mso-number-format:'@';text-align:center;">${code}</td>
    <td style="text-align:center;">${delistedAt}</td>
    <td>${reason}</td>
    <td></td>
  </tr>`;
};

describe('parseKrxDelistingHtml', () => {
  it('실제 KIND 응답에서 종목코드·폐지일자·폐지사유를 뽑는다', () => {
    const html = readFileSync(
      join(__dirname, '__fixtures__', 'krx-delisting-kospi-sample.html'),
      'utf-8',
    );

    const parsed = parseKrxDelistingHtml(html, 'KOSPI');

    expect(parsed).toHaveLength(5);
    expect(parsed[0]).toEqual({
      code: '008640',
      name: '우성건설',
      market: 'KOSPI',
      delistedAt: new Date('2001-01-20T00:00:00.000Z'),
      reason: '회사정리절차 폐지 결정',
    });
    // 사유가 회수율을 가르는 축이므로 원문이 잘리지 않아야 한다.
    expect(parsed[4].reason).toBe(
      '기업의 계속성, 경영의 투명성 및 기타 공익과 투자자 보호 등을 종합적으로 고려하여 상장폐지 기준에 해당한다고 결정',
    );
  });

  it('헤더 행과 종목코드가 아닌 행을 버린다', () => {
    const html = `<table>
      <tr><th>번호</th><th>회사명</th><th>종목코드</th><th>폐지일자</th><th>폐지사유</th><th>비고</th></tr>
      ${row({ code: '00864A' })}
      ${row({ code: '008640' })}
    </table>`;

    const parsed = parseKrxDelistingHtml(html, 'KOSPI');

    expect(parsed.map((item) => item.code)).toEqual(['008640']);
  });

  it('없는 날짜가 다른 달로 굴러가지 않게 버린다', () => {
    const html = `<table>
      ${row({ code: '000001', delistedAt: '2026-02-30' })}
      ${row({ code: '000002', delistedAt: '2026-02-28' })}
    </table>`;

    const parsed = parseKrxDelistingHtml(html, 'KOSDAQ');

    expect(parsed.map((item) => item.code)).toEqual(['000002']);
  });

  it('같은 종목코드가 두 번 나오면 폐지일이 늦은 쪽을 남긴다', () => {
    // KTF 실례 — 2004 코스닥에서 이전상장으로 한 번, 2009 코스피에서 해산으로 한 번.
    // 응답 순서는 폐지일 순이 아니라서(앞이 2001년, 끝이 2025년) 옛 행이 먼저 올 수 있다.
    const html = `<table>
      ${row({ code: '032390', delistedAt: '2004-04-29', reason: '증권거래소 상장' })}
      ${row({ code: '032390', delistedAt: '2009-06-23', reason: '해산 사유 발생' })}
    </table>`;

    const parsed = parseKrxDelistingHtml(html, 'KOSPI');

    expect(parsed).toHaveLength(1);
    expect(parsed[0].delistedAt).toEqual(new Date('2009-06-23T00:00:00.000Z'));
    expect(parsed[0].reason).toBe('해산 사유 발생');
  });

  it('최신 행이 먼저 와도 옛 행이 덮어쓰지 않는다', () => {
    const html = `<table>
      ${row({ code: '032390', delistedAt: '2009-06-23', reason: '해산 사유 발생' })}
      ${row({ code: '032390', delistedAt: '2004-04-29', reason: '증권거래소 상장' })}
    </table>`;

    const parsed = parseKrxDelistingHtml(html, 'KOSPI');

    expect(parsed[0].reason).toBe('해산 사유 발생');
  });

  it('유효한 행이 하나도 없으면 조용히 빈 배열을 주지 않고 실패한다', () => {
    expect(() => parseKrxDelistingHtml('<table></table>', 'KOSPI')).toThrow(
      'KRX 상장폐지 목록에 유효한 행이 없습니다',
    );
  });
});
