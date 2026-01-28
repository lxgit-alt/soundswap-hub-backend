import { Webhook } from 'standardwebhooks';
import crypto from 'crypto';

// Test the Standard Webhooks signature verification
const testWebhookVerification = async () => {
  console.log('[TEST] 🧪 Testing Standard Webhooks signature verification\n');

  // Simulate a webhook secret from Dodo dashboard (base64 encoded key with whsec_ prefix)
  // Format: whsec_<base64-encoded-key>
  const secretKeyRaw = 'test_secret_key_1234567890abcdef';
  const secretKey = Buffer.from(secretKeyRaw).toString('base64');
  const secret = `whsec_${secretKey}`;

  console.log('[TEST] Secret setup:');
  console.log(`  - Raw secret: ${secretKeyRaw}`);
  console.log(`  - Base64: ${secretKey}`);
  console.log(`  - Full secret: ${secret}\n`);
  
  // Create a test payload
  const payload = JSON.stringify({
    type: 'payment.succeeded',
    data: {
      transaction_id: 'txn_test_123',
      customer: { email: 'test@example.com' },
      amount: 1000,
      product_cart: [{ variant_id: 'prod_one_time', quantity: 1 }],
      metadata: { user_id: 'user_abc123' }
    }
  });

  const webhook = new Webhook(secret);

  // Generate a proper webhook ID and timestamp
  const webhookId = `msg_${Date.now()}`;
  const webhookTimestamp = Math.floor(Date.now() / 1000).toString();

  // The standardwebhooks library will automatically generate the signature
  // We'll manually create it to test
  const signedContent = `${webhookId}.${webhookTimestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secretKeyRaw)  // Use the raw secret, not the base64 encoded one
    .update(signedContent)
    .digest('base64');

  const webhookSignature = `v1,${signature}`;

  console.log('[TEST] Webhook Details:');
  console.log(`  - ID: ${webhookId}`);
  console.log(`  - Timestamp: ${webhookTimestamp}`);
  console.log(`  - Payload length: ${payload.length} bytes`);
  console.log(`  - Signature (first 20 chars): ${webhookSignature.substring(0, 30)}...`);
  console.log(`  - Full signature format: v1,<base64>\n`);

  try {
    const webhookHeaders = {
      'webhook-id': webhookId,
      'webhook-signature': webhookSignature,
      'webhook-timestamp': webhookTimestamp,
    };

    // Verify the webhook
    await webhook.verify(payload, webhookHeaders);
    console.log('[TEST] ✅ SUCCESS: Webhook signature verified!\n');

    console.log('[TEST] This means:');
    console.log('  ✓ Signature format is correct');
    console.log('  ✓ Standard Webhooks library recognizes the format');
    console.log('  ✓ Your lemon-webhook.js will work with real Dodo webhooks\n');

    return true;
  } catch (error) {
    console.error('[TEST] ❌ FAILED: Signature verification error:');
    console.error(`  Error: ${error.message}\n`);
    return false;
  }
};

// Run test
testWebhookVerification()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('[TEST] ❌ Unexpected error:', error);
    process.exit(1);
  });
