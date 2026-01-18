#!/usr/bin/env node

import { sendAIFeaturesToAllUsers } from '../emailService.js';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Initialize Firebase Admin SDK
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

if (!serviceAccount.project_id) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT environment variable is not set');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/**
 * Fetch all users from Firestore
 */
async function fetchAllUsers() {
  try {
    console.log('📋 Fetching users from Firestore...');
    
    const usersSnapshot = await db.collection('users').get();
    const users = [];
    
    usersSnapshot.forEach(doc => {
      const userData = doc.data();
      if (userData.email && !userData.deleted) {
        users.push({
          id: doc.id,
          email: userData.email,
          name: userData.displayName || userData.name || 'Artist',
          isPremium: userData.subscription?.status === 'active' && 
                     userData.subscription?.tier === 'premium'
        });
      }
    });
    
    console.log(`✅ Found ${users.length} active users`);
    return users;
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    throw error;
  }
}

/**
 * Command-line interface for sending AI features email
 */
async function main() {
  console.log('🚀 SoundSwap AI Features Email Sender');
  console.log('='.repeat(50));
  
  try {
    // Test email configuration
    console.log('🔧 Testing email configuration...');
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
      console.error('❌ GMAIL_USER and GMAIL_PASS environment variables must be set');
      process.exit(1);
    }
    
    // Fetch users
    const users = await fetchAllUsers();
    
    if (users.length === 0) {
      console.log('❌ No users found to send emails to');
      process.exit(0);
    }
    
    // Confirm with user
    console.log(`\n📧 You are about to send AI features email to ${users.length} users.`);
    console.log(`📧 Emails will be sent from: ${process.env.GMAIL_USER}`);
    console.log(`\n⚠️  This action cannot be undone!\n`);
    
    // Ask for confirmation
    const readline = (await import('readline')).createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const question = (query) => new Promise(resolve => readline.question(query, resolve));
    
    const answer = await question('Type "YES" to continue, or anything else to cancel: ');
    
    if (answer !== 'YES') {
      console.log('❌ Cancelled by user');
      readline.close();
      process.exit(0);
    }
    
    readline.close();
    
    // Get batch configuration
    const batchSize = parseInt(await question('Enter batch size (default: 10): ') || '10');
    const delayMs = parseInt(await question('Enter delay between batches in seconds (default: 5): ') || '5') * 1000;
    
    // Send emails
    console.log('\n📤 Starting email send...');
    
    const startTime = Date.now();
    const results = await sendAIFeaturesToAllUsers(users, batchSize, delayMs);
    
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    
    // Display results
    console.log('\n' + '='.repeat(50));
    console.log('📊 EMAIL SEND RESULTS');
    console.log('='.repeat(50));
    console.log(`✅ Total users: ${results.total}`);
    console.log(`✅ Emails sent: ${results.sent}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`⏱️  Duration: ${duration} seconds`);
    
    if (results.failed > 0) {
      console.log('\n❌ Failed emails:');
      results.errors.forEach(error => {
        console.log(`  - ${error.email}: ${error.error}`);
      });
      
      // Option to save failed emails to file
      const saveFailed = await question('\nSave failed emails to file? (y/N): ');
      if (saveFailed.toLowerCase() === 'y') {
        const fs = await import('fs');
        const failedEmails = results.errors.map(e => e.email);
        fs.writeFileSync('failed-emails.txt', failedEmails.join('\n'));
        console.log('💾 Failed emails saved to failed-emails.txt');
      }
    }
    
    console.log('\n🎉 AI features email campaign completed!');
    
  } catch (error) {
    console.error('❌ Error in AI features email campaign:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the script
main().catch(console.error);