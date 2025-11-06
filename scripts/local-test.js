#!/usr/bin/env node

import fetch from 'node-fetch';
import chalk from 'chalk';

const API_BASE = 'http://localhost:3000';

class APITester {
  constructor() {
    this.results = [];
  }

  async testEndpoint(name, url, method = 'GET') {
    try {
      const startTime = Date.now();
      const response = await fetch(url, { method });
      const endTime = Date.now();
      
      const data = await response.json();
      
      const result = {
        name,
        url,
        status: response.status,
        success: response.ok,
        responseTime: endTime - startTime,
        data: data
      };
      
      this.results.push(result);
      return result;
    } catch (error) {
      const result = {
        name,
        url,
        status: 'ERROR',
        success: false,
        error: error.message
      };
      
      this.results.push(result);
      return result;
    }
  }

  printResults() {
    console.log('\n' + chalk.blue.bold('📊 API Test Results'));
    console.log('=' .repeat(50));
    
    this.results.forEach(result => {
      const status = result.success ? 
        chalk.green('✓ PASS') : 
        chalk.red('✗ FAIL');
      
      console.log(`\n${status} ${chalk.bold(result.name)}`);
      console.log(`   URL: ${result.url}`);
      console.log(`   Status: ${result.status}`);
      
      if (result.responseTime) {
        console.log(`   Response Time: ${result.responseTime}ms`);
      }
      
      if (result.error) {
        console.log(`   Error: ${chalk.red(result.error)}`);
      }
    });
  }
}

async function runTests() {
  const tester = new APITester();
  
  console.log(chalk.yellow.bold('🚀 Starting Local API Tests...'));
  
  // Test basic health
  await tester.testEndpoint('Health Check', `${API_BASE}/health`);
  
  // Test production trends endpoints
  await tester.testEndpoint('Music Trends', `${API_BASE}/api/trends/music`);
  await tester.testEndpoint('Content Ideas', `${API_BASE}/api/trends/content-ideas`);
  await tester.testEndpoint('Trends Health', `${API_BASE}/api/trends/health`);
  
  // Test development endpoints
  await tester.testEndpoint('Dev Trends', `${API_BASE}/api/trends/dev/music`);
  await tester.testEndpoint('Integration Test', `${API_BASE}/api/trends/dev/test-integration`);
  
  // Print results
  tester.printResults();
  
  // Summary
  const passed = tester.results.filter(r => r.success).length;
  const total = tester.results.length;
  
  console.log('\n' + '='.repeat(50));
  console.log(chalk.bold(`📈 Summary: ${passed}/${total} tests passed`));
  
  if (passed === total) {
    console.log(chalk.green.bold('🎉 All tests passed! Your API is ready for production.'));
  } else {
    console.log(chalk.yellow('⚠️  Some tests failed. Check your implementation.'));
  }
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export default APITester;