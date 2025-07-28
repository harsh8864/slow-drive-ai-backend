import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
const upload = multer({ dest: 'voice_uploads/' });
const VOICE_MEMORIES_PATH = './voice_memories.json';
const VOICE_UPLOADS_DIR = './voice_uploads/';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const apiKey = process.env.GEMINI_API_KEY;
const ENCRYPTION_KEY = '8766023995'.padEnd(32, '0'); // 32 bytes for AES-256
const IV = Buffer.alloc(16, 0); // Initialization vector
const JOURNAL_PATH = './journal.json';

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
    } catch (e) { journal = []; }
  }
  journal.push(entry);
  fs.writeFileSync(JOURNAL_PATH, encrypt(JSON.stringify(journal)), 'utf8');
}

// Helper: Encrypt/decrypt audio files
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

// Helper: Check for crisis
function isCrisis(message) {
  const lower = message.toLowerCase();
  return crisisPhrases.some(phrase => lower.includes(phrase));
}

// Helper: Should prompt gratitude (once a week or after tough session)
function shouldPromptGratitude(journal) {
  if (!journal.length) return true;
  const last = journal[journal.length - 1];
  const lastDate = new Date(last.date);
  const now = new Date();
  const days = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
  if (days >= 7) return true;
  // Or after a tough session (detected by negative mood)
  return last.mood === 'sad' || last.mood === 'anxious';
}

// Gemini API Setup
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-1.5-flash" }) : null;

app.post('/message', async (req, res) => {
  const { message, context, history } = req.body;
  if (!message || message.trim() === "") {
    return res.status(400).json({ response: "Please enter a message." });
  }

  // Crisis detection
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

  // Normal AI response
  let aiResponse = '';
  let summary = '';
  let gratitudePrompt = false;
  try {
    let prompt = `You are Dr. Sarah, a caring therapist. Respond to Slow Drive's message, then write a gentle 1-2 sentence summary of the main issue and emotional progress. Example: 'Today, we talked about your fear of failure. You showed a lot of courage opening up. Remember, you are making progress.'\n\nMessage: "${message}"`;
    const chat = model ? model.startChat({
      history: history ? history.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] })) : [],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.8, topK: 40, topP: 0.95 },
    }) : null;
    let aiText = '';
    let aiSummary = '';
    if (chat) {
      const result = await chat.sendMessage(prompt);
      const response = await result.response;
      aiText = response.text();
      // Try to split summary from main response
      const parts = aiText.split('Summary:');
      aiResponse = parts[0].trim();
      aiSummary = (parts[1] || '').trim();
      summary = aiSummary || 'Session completed.';
    } else {
      aiResponse = "I'm here to listen and support you.";
      summary = "Session completed.";
    }
  } catch (e) {
    aiResponse = "I'm here to listen and support you.";
    summary = "Session completed.";
  }

  // Append to journal
  let journal = [];
  if (fs.existsSync(JOURNAL_PATH)) {
    try {
      const data = fs.readFileSync(JOURNAL_PATH, 'utf8');
      if (data) journal = JSON.parse(decrypt(data));
    } catch (e) { journal = []; }
  }
  appendJournal({
    date: new Date().toISOString(),
    summary,
    message,
    mood: context?.currentMood || 'unknown',
    type: 'session'
  });

  // Gratitude prompt logic
  gratitudePrompt = shouldPromptGratitude(journal);

  res.json({
    response: aiResponse,
    summary,
    gratitudePrompt
  });
});

// POST /voice-memories (upload)
app.post('/voice-memories', upload.single('voiceNote'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const id = uuidv4();
  const date = new Date().toISOString();
  const label = req.body.label || '';
  const encPath = `${VOICE_UPLOADS_DIR}${id}.enc`;
  encryptFile(req.file.path, encPath);
  fs.unlinkSync(req.file.path); // Remove original
  // Save metadata
  let meta = [];
  if (fs.existsSync(VOICE_MEMORIES_PATH)) {
    try {
      const data = fs.readFileSync(VOICE_MEMORIES_PATH, 'utf8');
      if (data) meta = JSON.parse(decrypt(data));
    } catch (e) { meta = []; }
  }
  meta.push({ id, date, label });
  fs.writeFileSync(VOICE_MEMORIES_PATH, encrypt(JSON.stringify(meta)), 'utf8');
  res.json({ success: true });
});

// GET /voice-memories (list)
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

// GET /voice-memories/:id (download/decrypt)
app.get('/voice-memories/:id', (req, res) => {
  const { id } = req.params;
  const encPath = `${VOICE_UPLOADS_DIR}${id}.enc`;
  if (!fs.existsSync(encPath)) return res.status(404).json({ error: 'Not found' });
  const tmpPath = `${VOICE_UPLOADS_DIR}${id}_tmp.webm`;
  decryptFile(encPath, tmpPath, () => {
    res.sendFile(tmpPath, { root: '.' }, (err) => {
      fs.unlinkSync(tmpPath);
    });
  });
});

// Endpoint to get decrypted journal
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', apiKeyConfigured: !!apiKey });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    console.log('⚠️  Running in demo mode - create .env file with GEMINI_API_KEY for full functionality');
  }
});
