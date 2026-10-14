import { isPublicAddress } from './public-url.guard';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'not-an-ip',
  ])('내부·예약 주소 %s 는 거부한다', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['93.184.216.34', '172.32.0.1', '8.8.8.8', '2606:4700::1111'])(
    '공인 주소 %s 는 허용한다',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});
