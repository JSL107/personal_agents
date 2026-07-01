import { EMPTY_PROFILE } from '../domain/preference-profile.type';
import {
  PreferenceInferenceAdapter,
  parsePreferenceDiff,
} from './preference-inference.adapter';

describe('parsePreferenceDiff', () => {
  it('유효 JSON diff 파싱', () => {
    const diff = parsePreferenceDiff(
      '{"diff":{"tone":{"add":["간결"]}},"rationale":"reject 반복"}',
    );
    expect(diff).toEqual({
      diff: { tone: { add: ['간결'] } },
      rationale: 'reject 반복',
    });
  });

  it('깨진 JSON 은 null (fail-closed)', () => {
    expect(parsePreferenceDiff('not json')).toBeNull();
  });
});

describe('PreferenceInferenceAdapter.infer', () => {
  it('신호 있으면 route 호출 후 diff 반환', async () => {
    const modelRouter = {
      route: jest.fn().mockResolvedValue({
        text: '{"diff":{"doNot":{"add":["이모지 남발 금지"]}},"rationale":"r"}',
      }),
    };
    const adapter = new PreferenceInferenceAdapter(modelRouter as never);
    const out = await adapter.infer(EMPTY_PROFILE, [
      { source: 'reaction', evidenceRef: 'x', observedText: '이모지 빼줘' },
    ]);
    expect(out?.diff.doNot?.add).toEqual(['이모지 남발 금지']);
    expect(modelRouter.route).toHaveBeenCalledTimes(1);
  });

  it('route 가 파싱 불가 응답 → null', async () => {
    const modelRouter = { route: jest.fn().mockResolvedValue({ text: 'noise' }) };
    const adapter = new PreferenceInferenceAdapter(modelRouter as never);
    expect(
      await adapter.infer(EMPTY_PROFILE, [
        { source: 'reaction', evidenceRef: 'x', observedText: 't' },
      ]),
    ).toBeNull();
  });
});
