#!/usr/bin/env node

import fetch from 'node-fetch';

class ProductionTester {
  constructor(baseURL) {
    this.baseURL = baseURL;
    this.results = [];
  }

  async testEndpoint(name, endpoint, expectedStatus = 200) {
    const url = `${this.baseURL}${endpoint}`;
    const startTime = Date.now();
    
    try {
      const response = await fetch(url);
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      const data = await response.json();
      
      const result = {
        name,
        endpoint,
        url,
        status: response.status,
        success: response.status === expectedStatus && data.success !== false,
        responseTime,
        data: data
      };
      
      this.results.push(result);
      return result;
    } catch (error) {
      const result = {
        name,
        endpoint,
        url,
        status: 'ERROR',
        success: false,
        error: error.message,
        responseTime: null
      };
      
      this.results.push(result);
      return result;
    }
  }

  printResults() {
    console.log('\n🚀 PRODUCTION READINESS TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Base URL: ${this.baseURL}`);
    console.log(`Test Time: ${new Date().toISOString()}`);
    console.log('='.repeat(60));
    
    let passed = 0;
    let failed = 0;
    
    this.results.forEach((result, index) => {
      const status = result.success ? 
        '✅ PASS' : 
        '❌ FAIL';
      
      console.log(`\n${index + 1}. ${status} ${result.name}`);
      console.log(`   Endpoint: ${result.endpoint}`);
      console.log(`   Status: ${result.status}`);
      
      if (result.responseTime) {
        const speed = result.responseTime < 300 ? '🚀 Fast' : 
                     result.responseTime < 1000 ? '⚡ Good' : 
                     '🐢 Slow';
        console.log(`   Response Time: ${result.responseTime}ms ${speed}`);
      }
      
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
      
      if (result.success) {
        passed++;
      } else {
        failed++;
      }
    });
    
    console.log('\n' + '='.repeat(60));
    console.log(`📊 SUMMARY: ${passed} passed, ${failed} failed`);
    
    if (failed === 0) {
      console.log('🎉 ALL TESTS PASSED - READY FOR PRODUCTION!');
    } else {
      console.log('⚠️  Some tests failed. Review before deployment.');
    }
    
    return failed === 0;
  }
}

async function runProductionTests() {
  const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3000';
  const tester = new ProductionTester(baseURL);
  
  console.log('🏭 Running Production Readiness Tests...');
  console.log(`Target: ${baseURL}`);
  
  // Test core endpoints
  await tester.testEndpoint('Health Check', '/health', 200);
  await tester.testEndpoint('API Status', '/api/status', 200);
  await tester.testEndpoint('Email Config Test', '/api/send-welcome-email/test', 200);
  
  // Test trends endpoints
  await tester.testEndpoint('Music Trends', '/api/trends/music', 200);
  await tester.testEndpoint('Content Ideas', '/api/trends/content-ideas', 200);
  await tester.testEndpoint('Trends Health', '/api/trends/health', 200);
  
  // Test development endpoints (should work in production too)
  await tester.testEndpoint('Dev Trends', '/api/trends/dev/music', 200);
  await tester.testEndpoint('Integration Test', '/api/trends/dev/test-integration', 200);
  await tester.testEndpoint('Performance Test', '/api/trends/dev/performance', 200);
  
  // Test 404 handling
  await tester.testEndpoint('404 Handling', '/api/nonexistent', 404);
  
  const allPassed = tester.printResults();
  process.exit(allPassed ? 0 : 1);
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runProductionTests().catch(console.error);
}

export default ProductionTester;