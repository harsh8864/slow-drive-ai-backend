// Test script for deployment debugging
import dotenv from 'dotenv';

dotenv.config();

console.log('🔍 Deployment Debug Information:');
console.log('================================');

// Check environment variables
console.log('Environment Variables:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- PORT:', process.env.PORT);
console.log('- GOOGLE_API_KEY:', process.env.GOOGLE_API_KEY ? '✅ Set' : '❌ Missing');

// Check file system
import fs from 'fs';
import path from 'path';

console.log('\nFile System Check:');
console.log('- Current directory:', process.cwd());
console.log('- index.mjs exists:', fs.existsSync('index.mjs'));
console.log('- package.json exists:', fs.existsSync('package.json'));

// Check dependencies
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  console.log('- Dependencies count:', Object.keys(packageJson.dependencies || {}).length);
} catch (e) {
  console.log('- Error reading package.json:', e.message);
}

console.log('\n✅ Debug check completed'); 