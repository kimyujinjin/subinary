import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { housingBrandSyncErrorSchema } from '../dist/index.mjs';

describe('housingBrandSyncErrorSchema', () => {
  it('accepts unit_not_registered for accounts without a registered unit', () => {
    assert.equal(housingBrandSyncErrorSchema.safeParse('unit_not_registered').success, true);
    assert.equal(housingBrandSyncErrorSchema.safeParse('unsupported_layout').success, true);
    assert.equal(housingBrandSyncErrorSchema.safeParse('unit_missing').success, false);
  });
});
