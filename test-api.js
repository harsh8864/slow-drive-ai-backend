// Test script to verify Google AI API key
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

console.log('🔍 Testing Google AI API Key...');
console.log('================================');

if (!apiKey) {
  console.log('❌ No API key found');
  console.log('Environment variable GEMINI_API_KEY is not set');
  process.exit(1);
}

console.log('✅ API key found:', apiKey.substring(0, 10) + '...');

try {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  
  console.log('✅ GoogleGenerativeAI initialized');
  
  // Test simple prompt
  const prompt = "Say hello in one sentence";
  
  console.log('🔄 Testing API call...');
  const result = await model.generateContent(prompt);
  const response = await result.response;
  const text = response.text();
  
  console.log('✅ API call successful!');
  console.log('Response:', text);
  
} catch (error) {
  console.error('❌ API test failed:', error.message);
  console.error('Full error:', error);
  
  if (error.message.includes('API_KEY')) {
    console.log('💡 This looks like an API key issue');
  } else if (error.message.includes('quota')) {
    console.log('💡 This looks like a quota issue');
  } else if (error.message.includes('timeout')) {
    console.log('💡 This looks like a timeout issue');
  }
} 