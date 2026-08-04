import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldApplyInventoryUpdate, getInventoryDelta } from '../inventoryFlow.js';

test('applies inventory updates for accepted and executed requests with valid lot inventory', () => {
  assert.equal(shouldApplyInventoryUpdate(41, 2, 46), true);
  assert.equal(shouldApplyInventoryUpdate(42, 2, 46), true);
  assert.equal(shouldApplyInventoryUpdate(41, 12, 46), true);
  assert.equal(shouldApplyInventoryUpdate(42, 12, 46), true);
});

test('uses positive delta for inbound confirmation and negative delta for outbound execution', () => {
  assert.equal(getInventoryDelta(41), 1);
  assert.equal(getInventoryDelta(42), -1);
  assert.equal(getInventoryDelta(40), 0);
});

test('skips inventory updates when the request is still pending or lacks lot inventory', () => {
  assert.equal(shouldApplyInventoryUpdate(40, 2, 46), false);
  assert.equal(shouldApplyInventoryUpdate(42, 2, 0), false);
  assert.equal(shouldApplyInventoryUpdate(41, 2, null), false);
});
