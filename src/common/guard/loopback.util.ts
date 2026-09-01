import { timingSafeEqual } from 'node:crypto';

// 네트워크 접근 가드 공용 헬퍼.
//
// 이대리 백엔드는 `app.listen(port)` 로 전체 인터페이스에 바인딩한다 (윈도우 PC 의 오피스
// 화면이 같은 공유기 / Tailscale 주소로 붙기 때문). 따라서 "같은 머신인가" 는 바인딩이
// 아니라 요청마다 판정해야 하고, 그 판정을 여기 한 곳에 둔다.

// Express 의 `request.ip` 는 IPv4-mapped IPv6 (`::ffff:127.0.0.1`) 형태로도 loopback 을 준다.
//
// ⚠️ 이 판정은 `trust proxy` 가 꺼져 있다는 전제 위에 있다 (NestJS 기본값). 켜면 `request.ip`
// 가 X-Forwarded-For 를 따르게 되어 원격에서 loopback 으로 위장할 수 있다 — 리버스 프록시를
// 앞에 두게 되면 이 판정을 소켓 주소(`request.socket.remoteAddress`) 기준으로 바꿔야 한다.
export const isLoopbackAddress = (ip: string | undefined): boolean => {
  if (!ip) {
    return false;
  }
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
};

// 브라우저가 다른 사이트에서 우리 loopback 주소로 보낸 요청인가.
//
// source IP 만 보는 가드는 CSRF 를 놓친다 — 사용자가 악성 페이지를 열면 그 페이지가
// `http://127.0.0.1:3099/...` 로 form 을 제출할 수 있고, 요청은 사용자 머신에서 나가므로
// 출발지는 loopback 이다. 브라우저는 이런 요청에 `Sec-Fetch-Site` 를 붙이므로 그것으로 가른다.
//
// 헤더가 없으면 브라우저가 아니다(맥 앱·Electron 프록시·curl) — 통과시킨다. 헤더를 붙이는
// 브라우저만 same-origin/none 으로 제한된다.
export const isCrossSiteBrowserRequest = (
  fetchSite: string | undefined,
): boolean => {
  if (!fetchSite) {
    return false;
  }
  return fetchSite !== 'same-origin' && fetchSite !== 'none';
};

// 토큰 비교는 타이밍 공격을 피해 상수 시간으로 한다.
// 길이가 다르면 timingSafeEqual 이 throw 하므로 먼저 걸러낸다 — 길이 노출은 토큰 자체를
// 복원하는 데 쓸모가 없어 감수한다.
export const timingSafeStringEqual = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
};
