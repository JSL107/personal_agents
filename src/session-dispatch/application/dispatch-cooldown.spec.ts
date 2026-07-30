import { DispatchCooldown } from './dispatch-cooldown';

describe('DispatchCooldown', () => {
  it('mark 후 쿨다운 내 재요청은 skip', () => {
    let clock = 1000;
    const cooldown = new DispatchCooldown(500, () => clock);

    expect(cooldown.shouldSkip('s1')).toBe(false);

    cooldown.mark('s1');
    clock = 1200;
    expect(cooldown.shouldSkip('s1')).toBe(true);

    clock = 1500;
    expect(cooldown.shouldSkip('s1')).toBe(false);

    clock = 1600;
    expect(cooldown.shouldSkip('s1')).toBe(false);
  });

  it('세션별로 독립', () => {
    const cooldown = new DispatchCooldown(500, () => 1000);

    cooldown.mark('s1');

    expect(cooldown.shouldSkip('s2')).toBe(false);
  });
});
