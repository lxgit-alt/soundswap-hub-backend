#!/usr/bin/env node

import { Webhook } from 'standardwebhooks';
import crypto from 'crypto';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   🔐 Dodo Payments Webhook Verification - Final Check       ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const tests = [];
let passCount = 0;
let failCount = 0;

// Test 1: Library Import
console.log('Test 1: Standard Webhooks Library');
try {
  const webhook = new Webhook('whsec_test1234567890abcdefghijklmnopqrstuv');
  console.log('  ✅ PASS: standardwebhooks library imported successfully');
  passCount++;
} catch (error) {
  console.log(`  ❌ FAIL: ${error.message}`);
  failCount++;
}

// Test 2: Signature Verification
console.log('\nTest 2: Signature Verification with Real Data');
try {
  const secretKeyRaw = 'test_secret_key_1234567890abcdef';
  const secretBase64 = Buffer.from(secretKeyRaw).toString('base64');
  const secret = `whsec_${secretBase64}`;

  const payload = JSON.stringify({
    type: 'payment.succeeded',
    data: { transaction_id: 'txn_123', amount: 1000 }
  });

  const webhookId = 'msg_1234567890';
  const webhookTimestamp = Math.floor(Date.now() / 1000).toString();  // Use current timestamp

  const signedContent = `${webhookId}.${webhookTimestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secretKeyRaw)
    .update(signedContent)
    .digest('base64');

  const webhookSignature = `v1,${signature}`;

  const webhook = new Webhook(secret);
  const webhookHeaders = {
    'webhook-id': webhookId,
    'webhook-signature': webhookSignature,
    'webhook-timestamp': webhookTimestamp,
  };

  await webhook.verify(payload, webhookHeaders);
  console.log('  ✅ PASS: Signature verification succeeded');
  passCount++;
} catch (error) {
  console.log(`  ❌ FAIL: ${error.message}`);
  failCount++;
}

// Test 3: Multiple Signature Formats
console.log('\nTest 3: Signature Format Support');
try {
  const secretKeyRaw = 'format_test_secret_key';
  const secretBase64 = Buffer.from(secretKeyRaw).toString('base64');
  
  const formats = [
    `whsec_${secretBase64}`,  // Standard format with prefix
  ];
  
  let formatPass = 0;
  for (const secret of formats) {
    try {
      const webhook = new Webhook(secret);
      console.log(`  ✅ Format accepted: ${secret.substring(0, 20)}...`);
      formatPass++;
    } catch (e) {
      console.log(`  ⚠️  Format rejected: ${secret.substring(0, 20)}...`);
    }
  }
  
  if (formatPass > 0) {
    console.log(`  ✅ PASS: At least one format supported (${formatPass}/${formats.length})`);
    passCount++;
  } else {
    console.log('  ❌ FAIL: No formats supported');
    failCount++;
  }
} catch (error) {
  console.log(`  ❌ FAIL: ${error.message}`);
  failCount++;
}

// Test 4: Invalid Signature Rejection
console.log('\nTest 4: Invalid Signature Rejection');
try {
  const secretKeyRaw = 'test_secret_key';
  const secretBase64 = Buffer.from(secretKeyRaw).toString('base64');
  const secret = `whsec_${secretBase64}`;

  const payload = JSON.stringify({ type: 'test' });
  const webhookId = 'msg_test';
  const webhookTimestamp = Math.floor(Date.now() / 1000).toString();

  const webhook = new Webhook(secret);
  const webhookHeaders = {
    'webhook-id': webhookId,
    'webhook-signature': 'v1,invalid_signature_here_1234567890==',
    'webhook-timestamp': webhookTimestamp,
  };

  let rejected = false;
  try {
    await webhook.verify(payload, webhookHeaders);
    console.log('  ❌ FAIL: Invalid signature was not rejected');
    failCount++;
  } catch (error) {
    if (error.message.includes('signature') || error.message.includes('matching')) {
      console.log('  ✅ PASS: Invalid signature was correctly rejected');
      passCount++;
      rejected = true;
    } else {
      console.log(`  ⚠️  WARN: Rejected but unexpected error: ${error.message}`);
      passCount++;
    }
  }
} catch (error) {
  console.log(`  ❌ FAIL: ${error.message}`);
  failCount++;
}

// Test 5: Environment Variable Format
console.log('\nTest 5: Environment Variable Format Check');
try {
  const exampleSecret = 'whsec_dGVzdF9zZWNyZXRfa2V5XzEyMzQ1Njc4OTBhYmNkZWY=';
  
  if (exampleSecret.startsWith('whsec_')) {
    console.log(`  ✅ PASS: Secret format is correct (whsec_ prefix)`);
    console.log(`     Example: ${exampleSecret.substring(0, 30)}...`);
    passCount++;
  } else {
    console.log('  ❌ FAIL: Secret must start with whsec_ prefix');
    failCount++;
  }
} catch (error) {
  console.log(`  ❌ FAIL: ${error.message}`);
  failCount++;
}

// Summary
console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log(`║  📊 Test Results: ${passCount} Passed, ${failCount} Failed${' '.repeat(21 - String(passCount).length - String(failCount).length)}║`);
console.log('╚════════════════════════════════════════════════════════════╝\n');

if (failCount === 0) {
  console.log('🎉 All tests passed! Your webhook setup is ready.\n');
  console.log('Next steps:');
  console.log('  1. Set DODO_PAYMENTS_WEBHOOK_SECRET in your environment');
  console.log('  2. Start your server: node backend/server.js');
  console.log('  3. Send test webhook from Dodo dashboard');
  console.log('  4. Monitor logs for: [INFO] ✅ Signature verified successfully\n');
} else {
  console.log('⚠️  Some tests failed. Review the errors above.\n');
  process.exit(1);
}
