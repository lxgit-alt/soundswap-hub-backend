import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

console.log('🚀 Starting test runner...\n');

// Start the server
console.log('📡 Starting backend server...');
const server = spawn('node', ['dev-server.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: false,
  env: { ...process.env, NODE_ENV: 'test' }
});

let serverReady = false;
let serverOutput = '';

// Listen for server output
server.stdout.on('data', (data) => {
  const output = data.toString();
  serverOutput += output;
  
  // Only log important messages during startup
  if (output.includes('Backend server running') || 
      output.includes('Error') || 
      output.includes('Failed')) {
    console.log(output.trim());
  }
  
  if (output.includes('Backend server running')) {
    serverReady = true;
  }
});

server.stderr.on('data', (data) => {
  const error = data.toString();
  if (!error.includes('ExperimentalWarning')) {
    console.error('Server error:', error);
  }
});

// Wait for server to start with better feedback
console.log('⏳ Waiting for server to start...');
await setTimeout(3000);

if (!serverReady) {
  console.log('⚠️  Server startup may have issues, checking logs...');
  if (serverOutput.includes('Error') || serverOutput.includes('Failed')) {
    console.log('🔍 Server errors detected:');
    console.log(serverOutput);
  }
  console.log('🔄 Proceeding with tests anyway...\n');
}

// Run tests
console.log('🧪 Running tests...\n');
const testProcess = spawn('node', ['test-endpoints.js'], {
  stdio: 'inherit'
});

testProcess.on('close', (code) => {
  console.log(`\n🏁 Tests completed with code ${code}`);
  
  // Kill the server
  console.log('🛑 Stopping server...');
  server.kill('SIGTERM');
  
  process.exit(code);
});

// Handle cleanup on exit
process.on('SIGINT', () => {
  console.log('\n🛑 Cleaning up...');
  server.kill('SIGTERM');
  process.exit(0);
});
