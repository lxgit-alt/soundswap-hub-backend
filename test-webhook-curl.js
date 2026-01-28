import { Webhook } from 'standardwebhooks';
import crypto from 'crypto';
import http from 'http';

// Simulate sending a webhook to the server
const testWebhookEndpoint = async () => {
  console.log('[TEST] 🧪 Simulating Dodo Payments webhook delivery\n');

  // Use a test secret - make sure this matches what you'll set in env vars
  const secretKeyRaw = 'test_secret_key_1234567890abcdef';
  const secretKey = Buffer.from(secretKeyRaw).toString('base64');
  const secret = `whsec_${secretKey}`;

  // Sample payment succeeded payload
  const payload = JSON.stringify({
    type: 'payment.succeeded',
    data: {
      transaction_id: 'txn_test_123456',
      customer: { 
        email: 'user@example.com',
        id: 'cust_123'
      },
      amount: 5000,  // $50.00 in cents
      product_cart: [{ 
        variant_id: 'prod_one_time', 
        quantity: 1 
      }],
      metadata: { 
        user_id: 'user_abc123',
        type: 'one_time'
      }
    }
  });

  const webhookId = `msg_${Date.now()}`;
  const webhookTimestamp = Math.floor(Date.now() / 1000).toString();

  const signedContent = `${webhookId}.${webhookTimestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secretKeyRaw)
    .update(signedContent)
    .digest('base64');

  const webhookSignature = `v1,${signature}`;

  console.log('[TEST] Webhook request details:');
  console.log(`  - Event: payment.succeeded`);
  console.log(`  - Transaction ID: txn_test_123456`);
  console.log(`  - Customer Email: user@example.com`);
  console.log(`  - Amount: $50.00`);
  console.log(`  - Headers:`);
  console.log(`    • webhook-id: ${webhookId}`);
  console.log(`    • webhook-timestamp: ${webhookTimestamp}`);
  console.log(`    • webhook-signature: v1,<base64-signature>\n`);

  console.log('[TEST] 📝 Instructions for testing:');
  console.log('  1. Set environment variables:');
  console.log(`     DODO_PAYMENTS_WEBHOOK_SECRET=${secret}`);
  console.log(`     DODO_PAYMENTS_WEBHOOK_KEY=${secret} (or use this name)\n`);
  
  console.log('  2. Start your server:');
  console.log('     node backend/server.js\n');

  console.log('  3. Send this test webhook (using curl or similar):');
  console.log(`     curl -X POST http://localhost:3000/api/lemon-webhook \\`);
  console.log(`       -H "Content-Type: application/json" \\`);
  console.log(`       -H "webhook-id: ${webhookId}" \\`);
  console.log(`       -H "webhook-timestamp: ${webhookTimestamp}" \\`);
  console.log(`       -H "webhook-signature: ${webhookSignature}" \\`);
  console.log(`       -d '${payload}'\n`);

  console.log('[TEST] Expected success response:');
  console.log('  HTTP 200 OK with JSON: { success: true, received: true, ... }');
  console.log('  Log: [INFO] ✅ Signature verified successfully using Standard Webhooks spec\n');
};

testWebhookEndpoint().catch((error) => {
  console.error('[TEST] ❌ Error:', error);
  process.exit(1);
});
