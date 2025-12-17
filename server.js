import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import multer from 'multer';
import { analyzeWorkflowLogs } from './src/analysisService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads
const uploadDir = join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Main route - serve the README.html
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'README.html'));
});

// Analyze page route
app.get('/analyze', (req, res) => {
  res.sendFile(join(__dirname, 'analyze.html'));
});

// Presentation route
app.get('/presentation', (req, res) => {
  res.sendFile(join(__dirname, 'presentation.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Trace IQ Server' });
});

// API endpoint for log analysis with Server-Sent Events for real-time progress
app.post('/api/analyze', upload.fields([
  { name: 'blueFile', maxCount: 1 },
  { name: 'greenFile', maxCount: 1 }
]), async (req, res) => {
  const startTime = Date.now();

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendProgress = (stage, message, data = null) => {
    const event = { stage, message, timestamp: Date.now(), data };
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    // Validate files
    if (!req.files?.blueFile?.[0] || !req.files?.greenFile?.[0]) {
      sendProgress('error', 'Both blue and green CSV files are required');
      res.end();
      return;
    }

    const blueFile = req.files.blueFile[0];
    const greenFile = req.files.greenFile[0];
    const useRag = req.body.useRag === 'true';
    const noCache = req.body.noCache === 'true';
    const reposDir = req.body.reposDir || '/Users/dipankar/Repos';

    console.log(`\n📊 Starting analysis...`);
    sendProgress('start', 'Starting analysis...');
    sendProgress('info', `📘 Blue file: ${blueFile.originalname}`);
    sendProgress('info', `📗 Green file: ${greenFile.originalname}`);
    sendProgress('info', `🤖 RAG analysis: ${useRag ? 'enabled' : 'disabled'}${noCache ? ' (no cache)' : ''}`);

    // Perform analysis with progress callbacks
    const result = await analyzeWorkflowLogs({
      blueFilePath: blueFile.path,
      greenFilePath: greenFile.path,
      blueCsvName: blueFile.originalname,
      greenCsvName: greenFile.originalname,
      useRag,
      noCache,
      reposDir,
      onProgress: (progress) => {
        console.log(`   ${progress.message}`);
        sendProgress(progress.stage, progress.message);
      },
    });

    // Clean up uploaded files
    fs.unlinkSync(blueFile.path);
    fs.unlinkSync(greenFile.path);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Analysis completed in ${duration}s\n`);

    sendProgress('complete', `Analysis completed in ${duration}s`, result);
    res.end();
  } catch (error) {
    console.error('❌ Analysis error:', error.message);

    // Clean up files on error
    if (req.files?.blueFile?.[0]?.path) {
      try { fs.unlinkSync(req.files.blueFile[0].path); } catch (e) {}
    }
    if (req.files?.greenFile?.[0]?.path) {
      try { fs.unlinkSync(req.files.greenFile[0].path); } catch (e) {}
    }

    sendProgress('error', error.message);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Trace IQ Server running at http://localhost:${PORT}`);
  console.log(`📄 View README at http://localhost:${PORT}/`);
  console.log(`🔍 Analyze Logs at http://localhost:${PORT}/analyze`);
  console.log(`🎬 View Presentation at http://localhost:${PORT}/presentation`);
  console.log(`\nPress Ctrl+C to stop\n`);
});

