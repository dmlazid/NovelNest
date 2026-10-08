import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../firebase/firestore.rules', import.meta.url), 'utf8');
const webConfig = readFileSync(new URL('../dist/firebase-config.js', import.meta.url), 'utf8');

test('Firestore rules require the matching authenticated user', () => {
  assert.match(rules, /match\s+\/users\/\{userId\}/);
  assert.match(rules, /request\.auth\s*!=\s*null/);
  assert.match(rules, /request\.auth\.uid\s*==\s*userId/);
  assert.doesNotMatch(rules, /allow\s+(?:read|write|create|update|delete|list|get)\s*:\s*if\s+true\b/i);
  assert.doesNotMatch(rules, /match\s+\/\{[^}]+=\*\*\}/);
});

test('browser Firebase config uses the expected project without admin credentials', () => {
  assert.match(webConfig, /window\.NOVELNEST_FIREBASE\s*=/);
  assert.match(webConfig, /projectId\s*:\s*["']novelnest-7d9ca["']/);
  assert.doesNotMatch(webConfig, /private_key|client_email|refresh_token|service_account/i);
});
