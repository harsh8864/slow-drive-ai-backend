import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
app.use(cors({
  origin: [
    'https://slow-drive-ai-frontend-9aax.vercel.app',
    'https://slow-drive-ai-frontend-9aax-nhiu6jzpi-lucks-projects-c713e61b.vercel.app',
    'https://harsh8864.github.io',
    'http://localhost:3000'
  ],
  credentials: true
}));
app.use(bodyParser.json());

const upload = multer({ dest: 'voice_uploads/' });

const JOURNAL_PATH = './journal.json';
const VOICE_MEMORIES_PATH = './voice_memories.json';
const VOICE_UPLOADS_DIR = './voice_uploads/';

const apiKey = process.env.GEMINI_API_KEY;
const ENCRYPTION_KEY = '8766023995'.padEnd(32, '0'); // 32 bytes for AES-256
const IV = Buffer.alloc(16, 0); // Initialization vector

// Ensure upload dir exists on Render
if (!fs.existsSync(VOICE_UPLOADS_DIR)) fs.mkdirSync(VOICE_UPLOADS_DIR);

function encrypt(text) {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), IV);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return encrypted.toString('hex');
}

function decrypt(text) {
  const encryptedText = Buffer.from(text, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), IV);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

function appendJournal(entry) {
  let journal = [];
  if (fs.existsSync(JOURNAL_PATH)) {
    try {
      const data = fs.readFileSync(JOURNAL_PATH, 'utf8');
      if (data) journal = JSON.parse(decrypt(data));
    } catch (e) {}
  }
  journal.push(entry);
  fs.writeFileSync(JOURNAL_PATH, encrypt(JSON.stringify(journal)), 'utf8');
}

function encryptFile(inputPath, outputPath) {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), IV);
  const input = fs.createReadStream(inputPath);
  const output = fs.createWriteStream(outputPath);
  input.pipe(cipher).pipe(output);
}

function decryptFile(inputPath, outputPath, cb) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), IV);
  const input = fs.createReadStream(inputPath);
  const output = fs.createWriteStream(outputPath);
  input.pipe(decipher).pipe(output);
  output.on('finish', cb);
}

const crisisPhrases = [
  "i don't want to be here anymore",
  "i’m done with everything",
  "i want to end it",
  "i want to die",
  "i can't go on",
  "i give up",
  "i wish i wasn't alive"
];

const emergencyHelp = {
  message: "I'm deeply concerned. You're not alone, Slow Drive. Would you like to talk to someone now?",
  numbers: [
    { label: 'India Suicide Prevention', number: '9152987821' },
    { label: 'Call Captain', number: '8766023995' },
    { label: 'International Helpline', number: '+1-800-273-8255' }
  ],
  calmingAudio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
};

function isCrisis(message) {
  const lower = message.toLowerCase();
  return crisisPhrases.some(phrase => lower.includes(phrase));
}

function shouldPromptGratitude(journal) {
  if (!journal.length) return true;
  const last = journal[journal.length - 1];
  const lastDate = new Date(last.date);
  const now = new Date();
  const days = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
  return days >= 7 || ['sad', 'anxious'].includes(last.mood);
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-1.5-flash" }) : null;

app.post('/message', async (req, res) => {
  const { message, context, history } = req.body;
  if (!message || message.trim() === "") {
    return res.status(400).json({ response: "Please enter a message." });
  }

  if (isCrisis(message)) {
    appendJournal({
      date: new Date().toISOString(),
      summary: 'Crisis detected',
      message,
      mood: context?.currentMood || 'unknown',
      type: 'crisis'
    });
    return res.json({
      response: emergencyHelp.message,
      emergency: true,
      numbers: emergencyHelp.numbers,
      calmingAudio: emergencyHelp.calmingAudio
    });
  }

  let aiResponse = "I'm here to listen and support you.";
  let summary = "Session completed.";
  try {
    const prompt = `You are Dr. Sarah, a caring therapist. Respond warmly and briefly to: "${message}"`;
    if (model) {
      try {
        // Try simpler approach first
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const aiText = response.text();
        aiResponse = aiText.trim();
        summary = "Session completed.";
      } catch (chatError) {
        console.error('Simple AI call failed, trying chat:', chatError.message);
        
        // Fallback to chat approach
        const chat = model.startChat({
          generationConfig: { 
            maxOutputTokens: 256, 
            temperature: 0.7, 
            topK: 20, 
            topP: 0.9
          }
        });
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 10000)
        );
        
        const result = await Promise.race([
          chat.sendMessage(prompt),
          timeoutPromise
        ]);
        
        const response = await result.response;
        const aiText = response.text();
        aiResponse = aiText.trim();
        summary = "Session completed.";
      }
    }
  } catch (e) {
    console.error('AI response error:', e.message);
    console.error('Error details:', e);
    // Fallback to faster response
    aiResponse = "I understand how you're feeling. Let's talk more about this together.";
  }

  let journal = [];
  if (fs.existsSync(JOURNAL_PATH)) {
    try {
      const data = fs.readFileSync(JOURNAL_PATH, 'utf8');
      if (data) journal = JSON.parse(decrypt(data));
    } catch (e) {}
  }

  appendJournal({
    date: new Date().toISOString(),
    summary,
    message,
    mood: context?.currentMood || 'unknown',
    type: 'session'
  });

  const gratitudePrompt = shouldPromptGratitude(journal);
  res.json({ response: aiResponse, summary, gratitudePrompt });
});

app.post('/voice-memories', upload.single('voiceNote'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const id = uuidv4();
  const date = new Date().toISOString();
  const label = req.body.label || '';
  const encPath = `${VOICE_UPLOADS_DIR}${id}.enc`;
  encryptFile(req.file.path, encPath);
  fs.unlinkSync(req.file.path);
  let meta = [];
  if (fs.existsSync(VOICE_MEMORIES_PATH)) {
    try {
      const data = fs.readFileSync(VOICE_MEMORIES_PATH, 'utf8');
      if (data) meta = JSON.parse(decrypt(data));
    } catch (e) {}
  }
  meta.push({ id, date, label });
  fs.writeFileSync(VOICE_MEMORIES_PATH, encrypt(JSON.stringify(meta)), 'utf8');
  res.json({ success: true });
});

app.get('/voice-memories', (req, res) => {
  if (!fs.existsSync(VOICE_MEMORIES_PATH)) return res.json([]);
  try {
    const data = fs.readFileSync(VOICE_MEMORIES_PATH, 'utf8');
    if (!data) return res.json([]);
    const meta = JSON.parse(decrypt(data));
    res.json(meta);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read voice memories.' });
  }
});

app.get('/voice-memories/:id', (req, res) => {
  const { id } = req.params;
  const encPath = `${VOICE_UPLOADS_DIR}${id}.enc`;
  if (!fs.existsSync(encPath)) return res.status(404).json({ error: 'Not found' });
  const tmpPath = `${VOICE_UPLOADS_DIR}${id}_tmp.webm`;
  decryptFile(encPath, tmpPath, () => {
    res.sendFile(tmpPath, { root: '.' }, () => fs.unlinkSync(tmpPath));
  });
});

app.get('/journal', (req, res) => {
  if (!fs.existsSync(JOURNAL_PATH)) return res.json([]);
  try {
    const data = fs.readFileSync(JOURNAL_PATH, 'utf8');
    if (!data) return res.json([]);
    const journal = JSON.parse(decrypt(data));
    res.json(journal);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read journal.' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', apiKeyConfigured: !!apiKey });
});

// Root route for basic server info
app.get('/', (req, res) => {
  res.json({
    message: 'Numa AI Therapist Backend Server',
    status: 'running',
    endpoints: [
      'POST /message - Send messages to AI therapist',
      'POST /voice-memories - Upload voice notes',
      'GET /voice-memories - Get list of voice memories',
      'GET /voice-memories/:id - Get specific voice memory',
      'GET /journal - Get journal entries',
      'GET /health - Health check'
    ],
    apiKeyConfigured: !!apiKey
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
