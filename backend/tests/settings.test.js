import test from 'node:test';
import assert from 'node:assert/strict';
import { getSettings, updateSettings } from '../config.js';
import { decideTier } from '../guardrails.js';

test('settings can be retrieved and updated dynamically', () => {
  const initial = getSettings();
  assert.equal(initial.AUTO_RECOVER_MAX_AMOUNT_INR, 2000);

  updateSettings({ AUTO_RECOVER_MAX_AMOUNT_INR: 5000 });
  const updated = getSettings();
  assert.equal(updated.AUTO_RECOVER_MAX_AMOUNT_INR, 5000);

  // Verify guardrails use updated setting
  const tier = decideTier('transient_gateway_error', 0.9, 4000, false);
  assert.equal(tier, 'auto');

  // Reset back to 2000
  updateSettings({ AUTO_RECOVER_MAX_AMOUNT_INR: 2000 });
});
