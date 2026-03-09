const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
require('dotenv').config();

// Database models
const { sequelize, User, Chat, CustomApi, Setting, syncDatabase } = require('./models');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Render deployment (required for secure cookies)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Enable CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.CLIENT_URL || 'http://localhost:3000' 
    : 'http://localhost:3000',
  credentials: true
}));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'crimson-ai-secret-key-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // set to true if using HTTPS
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findByPk(id);
    done(null, user || null);
  } catch (error) {
    done(error, null);
  }
});

// Google OAuth Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // Check if user exists
      let user = await User.findByPk(profile.id);
      
      if (!user) {
        // Create new user
        user = await User.create({
          id: profile.id,
          googleId: profile.id,
          email: profile.emails[0].value,
          name: profile.displayName,
          picture: profile.photos[0].value
        });
        
        // Create default settings for user
        await Setting.create({
          userId: profile.id
        });
      }
      
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }
));

// Configure multer for file uploads
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
const maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 1024 * 1024 * 1024; // 1GB default

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = path.join(__dirname, uploadDir);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      console.error('Error creating uploads directory:', err);
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    cb(null, Date.now() + '-' + safeName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: maxFileSize },
  fileFilter: (req, file, cb) => {
    // Allow common file types - expanded for 1GB support
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'application/pdf', 'text/plain', 'text/markdown',
      'application/json', 'text/javascript', 'text/x-python',
      'text/html', 'text/css', 'text/csv', 'application/xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/msword', // .doc
      'text/x-java', 'text/x-c', 'text/x-c++', 'text/x-php',
      'application/x-sql', 'text/x-sql',
      'application/yaml', 'text/yaml', 'text/x-yaml'
    ];
    
    // Extended file extension check
    const allowedExtensions = /\.(txt|md|markdown|json|js|jsx|ts|tsx|py|java|c|cpp|h|hpp|cs|rb|go|rs|php|html|css|scss|sass|less|csv|xml|yml|yaml|sql|sh|bash|log|conf|config|env|gitignore|dockerfile|toml|ini)$/i;
    
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(allowedExtensions)) {
      cb(null, true);
    } else {
      cb(new Error('File type not supported'), false);
    }
  }
});

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// ============ HTML ROUTES ============

// Root route - serve intro.html
app.get('/', (req, res) => {
  console.log('Serving intro.html for root route');
  res.sendFile(path.join(__dirname, 'intro.html'));
});

// Main app route
app.get('/app', (req, res) => {
  console.log('Serving index.html for /app route');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve static files AFTER route handlers
app.use(express.static(__dirname));

// ============ AUTHENTICATION ROUTES ============

// Google OAuth login route
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google OAuth callback route
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    // Successful authentication - redirect to main app
    console.log('Google auth successful, redirecting to /app');
    res.redirect('/app');
  }
);

// Get current user
app.get('/api/user', (req, res) => {
  if (req.isAuthenticated()) {
    const { id, name, email, picture } = req.user;
    res.json({ 
      authenticated: true, 
      user: { id, name, email, picture } 
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Logout route
app.get('/api/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

// ============ USER DATA ROUTES ============

// Save user chats
app.post('/api/save-chats', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const userId = req.user.id;
  const { chats } = req.body;
  
  try {
    // Convert chats object to array and save each chat
    const chatPromises = Object.values(chats).map(chat => 
      Chat.upsert({
        id: chat.id,
        userId: userId,
        title: chat.title,
        messages: chat.messages,
        timestamp: chat.timestamp
      })
    );
    
    await Promise.all(chatPromises);
    
    // Delete chats that are no longer in the user's list
    const chatIds = Object.keys(chats);
    await Chat.destroy({
      where: {
        userId: userId,
        id: { [Op.notIn]: chatIds }
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving chats:', error);
    res.status(500).json({ error: 'Failed to save chats' });
  }
});

// Load user chats
app.get('/api/load-chats', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const userId = req.user.id;
  
  try {
    const chats = await Chat.findAll({
      where: { userId },
      order: [['timestamp', 'DESC']]
    });
    
    // Convert to object format expected by frontend
    const chatsObj = {};
    chats.forEach(chat => {
      chatsObj[chat.id] = {
        id: chat.id,
        title: chat.title,
        messages: chat.messages,
        timestamp: chat.timestamp
      };
    });
    
    res.json({ chats: chatsObj });
  } catch (error) {
    console.error('Error loading chats:', error);
    res.status(500).json({ error: 'Failed to load chats' });
  }
});

// Save custom APIs
app.post('/api/save-custom-apis', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const userId = req.user.id;
  const { customApis } = req.body;
  
  try {
    // Delete existing custom APIs
    await CustomApi.destroy({ where: { userId } });
    
    // Save new custom APIs
    if (customApis && Object.keys(customApis).length > 0) {
      const apiPromises = Object.entries(customApis).map(([index, api]) => 
        CustomApi.create({
          userId,
          name: api.name,
          url: api.url,
          key: api.key,
          model: api.model,
          format: api.format || 'openai',
          headers: api.headers || {},
          customBody: api.customBody,
          responsePath: api.responsePath,
          index: parseInt(index)
        })
      );
      
      await Promise.all(apiPromises);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving custom APIs:', error);
    res.status(500).json({ error: 'Failed to save custom APIs' });
  }
});

// Load custom APIs
app.get('/api/load-custom-apis', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const userId = req.user.id;
  
  try {
    const customApis = await CustomApi.findAll({
      where: { userId },
      order: [['index', 'ASC']]
    });
    
    // Convert to object format expected by frontend
    const customApisObj = {};
    customApis.forEach(api => {
      customApisObj[api.index] = {
        name: api.name,
        url: api.url,
        key: api.key,
        model: api.model,
        format: api.format,
        headers: api.headers,
        customBody: api.customBody,
        responsePath: api.responsePath
      };
    });
    
    res.json({ customApis: customApisObj });
  } catch (error) {
    console.error('Error loading custom APIs:', error);
    res.status(500).json({ error: 'Failed to load custom APIs' });
  }
});

// Save user settings
app.post('/api/save-settings', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const userId = req.user.id;
  const { settings } = req.body;
  
  try {
    await Setting.upsert({
      userId,
      ...settings
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Load user settings
app.get('/api/load-settings', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const userId = req.user.id;
  
  try {
    let settings = await Setting.findOne({ where: { userId } });
    
    if (!settings) {
      // Create default settings if none exist
      settings = await Setting.create({ userId });
    }
    
    res.json({ settings: settings.toJSON() });
  } catch (error) {
    console.error('Error loading settings:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// ============ HELPER FUNCTIONS ============

// Helper function to get value from nested object using dot notation
function getValueByPath(obj, path) {
  if (!obj || !path) return null;
  
  return path.split('.').reduce((current, key) => {
    if (current === null || current === undefined) return null;
    
    // Handle array indexing (e.g., "choices[0].message.content")
    if (key.includes('[')) {
      const matches = key.match(/(.+?)\[(\d+)\]/);
      if (matches) {
        const [_, arrayKey, index] = matches;
        return current[arrayKey]?.[parseInt(index)];
      }
    }
    
    return current[key];
  }, obj);
}

// Helper function to format messages for different API formats
function formatMessagesForAPI(messages, format, model, systemPrompt, stream = true) {
  // Add system prompt if provided
  let finalMessages = [...messages];
  if (systemPrompt && systemPrompt.trim()) {
    // Check if system message already exists
    const hasSystem = finalMessages.some(m => m.role === 'system');
    if (!hasSystem) {
      finalMessages = [{ role: 'system', content: systemPrompt }, ...finalMessages];
    }
  }
  
  switch (format) {
    case 'openai':
      return {
        model: model,
        messages: finalMessages,
        stream: stream,
        temperature: 0.7,
        max_tokens: 4096  // Maximum for gpt-3.5-turbo and compatible models
      };
      
    case 'anthropic':
      return {
        model: model,
        messages: finalMessages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content
        })),
        system: systemPrompt,
        max_tokens: 4096,  // Maximum for Claude 3 models
        temperature: 0.7,
        stream: stream
      };
    
    case 'gemini': {
      const contents = [];
      let systemMessage = null;
      
      finalMessages.forEach(msg => {
        if (msg.role === 'system') {
          systemMessage = msg.content;
        } else {
          contents.push({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          });
        }
      });
      
      const requestBody = {
        contents: contents,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192  // Increased for long responses
        }
      };
      
      if (systemMessage) {
        requestBody.systemInstruction = {
          parts: [{ text: systemMessage }]
        };
      }
      
      return requestBody;
    }
    
    case 'cohere':
      return {
        model: model,
        message: finalMessages[finalMessages.length - 1].content,
        chat_history: finalMessages.slice(0, -1).filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'user' ? 'USER' : 'CHATBOT',
          message: m.content
        })),
        preamble: systemPrompt,
        temperature: 0.7,
        max_tokens: 4096,  // Increased for long responses
        stream: stream
      };
      
    case 'ollama':
      return {
        model: model,
        messages: finalMessages,
        stream: stream,
        options: {
          temperature: 0.7,
          num_predict: 8192  // Safe limit for most local models
        }
      };
      
    case 'custom':
      return null;
      
    default:
      return {
        model: model,
        messages: finalMessages,
        stream: stream
      };
  }
}

// Helper function to build headers for different API formats
function buildHeadersForAPI(format, apiKey, customHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...customHeaders
  };
  
  switch (format) {
    case 'openai':
    case 'deepseek':
    case 'grok':
    case 'cohere':
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;
    case 'anthropic':
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      break;
    // Gemini uses API key in URL, not headers
    // Ollama typically doesn't need auth
  }
  
  return headers;
}

// Helper function to parse streaming response from different APIs
async function* parseStreamResponse(response, format) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    
    // Parse based on format
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.trim() === '') continue;
      
      if (format === 'gemini') {
        // Gemini format: data: {...}
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
              yield {
                choices: [{
                  delta: {
                    content: data.candidates[0].content.parts[0].text
                  }
                }]
              };
            }
          } catch (e) {
            console.error('Error parsing Gemini stream:', e);
          }
        }
      } else if (format === 'anthropic') {
        // Anthropic format: event: content_block_delta\ndata: {...}
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'content_block_delta' && data.delta?.text) {
              yield {
                choices: [{
                  delta: {
                    content: data.delta.text
                  }
                }]
              };
            } else if (data.type === 'message_stop') {
              yield { done: true };
            }
          } catch (e) {
            // Ignore non-JSON lines
          }
        }
      } else if (format === 'cohere') {
        // Cohere format: {"text": "..."}
        try {
          const data = JSON.parse(line);
          if (data.text) {
            yield {
              choices: [{
                delta: {
                  content: data.text
                }
              }]
            };
          } else if (data.is_finished) {
            yield { done: true };
          }
        } catch (e) {
          // Ignore non-JSON lines
        }
      } else if (format === 'ollama') {
        // Ollama format: {"message": {"content": "..."}}
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            yield {
              choices: [{
                delta: {
                  content: data.message.content
                }
              }]
            };
          } else if (data.done) {
            yield { done: true };
          }
        } catch (e) {
          // Ignore non-JSON lines
        }
      } else {
        // OpenAI-style streaming
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { done: true };
          } else {
            try {
              const parsed = JSON.parse(data);
              yield parsed;
            } catch (e) {
              console.error('Error parsing stream:', e);
            }
          }
        }
      }
    }
  }
}

// ============ API ENDPOINTS ============

// Main streaming endpoint
app.post('/api/stream', upload.single('file'), async (req, res) => {
  let response = null;
  
  try {
    const { messages, provider, apiKey, systemPrompt, customApiIndex, customApis: customApisStr, model } = req.body;
    
    console.log('Received request:', { provider, customApiIndex, hasFile: !!req.file });
    
    if (!messages) {
      throw new Error('Messages are required');
    }
    
    // Parse messages safely - handle both string and object
    let parsedMessages;
    if (typeof messages === 'string') {
      try {
        parsedMessages = JSON.parse(messages);
      } catch (e) {
        console.error('Error parsing messages string:', messages.substring(0, 100));
        throw new Error('Invalid messages format: not valid JSON');
      }
    } else if (Array.isArray(messages)) {
      // If messages is already an array, use it directly
      parsedMessages = messages;
    } else {
      console.error('Unexpected messages type:', typeof messages);
      throw new Error('Invalid messages format: expected string or array');
    }
    
    // Validate parsed messages
    if (!Array.isArray(parsedMessages)) {
      throw new Error('Messages must be an array');
    }
    
    console.log(`Processing ${parsedMessages.length} messages`);
    
    // Process uploaded file
    let fileContext = '';
    if (req.file) {
      const filePath = req.file.path;
      const fileExt = path.extname(req.file.originalname).toLowerCase();
      const fileSize = req.file.size;
      const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
      
      console.log(`Processing file: ${req.file.originalname} (${fileSizeMB} MB)`);
      
      try {
        // Text-based files that can be read and analyzed
        const textFileExtensions = ['.txt', '.md', '.markdown', '.json', '.js', '.jsx', '.ts', '.tsx', 
                                     '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.go', 
                                     '.rs', '.php', '.html', '.css', '.scss', '.sass', '.less', '.csv', 
                                     '.xml', '.yml', '.yaml', '.sql', '.sh', '.bash', '.log', '.conf', 
                                     '.config', '.env', '.gitignore', '.dockerfile', '.toml', '.ini'];
        
        if (textFileExtensions.includes(fileExt)) {
          // For large files (>50MB), read in chunks
          if (fileSize > 50 * 1024 * 1024) {
            console.log('Large file detected, reading in chunks...');
            const stats = await fs.stat(filePath);
            const chunkSize = 10 * 1024 * 1024; // 10MB chunks
            let content = '';
            let position = 0;
            
            // Read first 10MB and last 1MB for large files
            const startChunk = await fs.readFile(filePath, { encoding: 'utf8', flag: 'r' });
            content = startChunk.substring(0, Math.min(startChunk.length, 10 * 1024 * 1024));
            
            if (stats.size > chunkSize) {
              content += `\n\n[... File truncated - showing first ${(chunkSize / (1024 * 1024)).toFixed(0)}MB of ${fileSizeMB}MB total ...]\n`;
            }
            
            fileContext = `\n\n[User uploaded large file: ${req.file.originalname} (${fileSizeMB} MB)]\nFile content (partial):\n${content}`;
          } else {
            // For smaller files, read normally
            const content = await fs.readFile(filePath, 'utf8');
            fileContext = `\n\n[User uploaded file: ${req.file.originalname} (${fileSizeMB} MB)]\nFile content:\n${content}`;
          }
        } else if (['.pdf'].includes(fileExt)) {
          fileContext = `\n\n[User uploaded PDF file: ${req.file.originalname} (${fileSizeMB} MB)]`;
        } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(fileExt)) {
          fileContext = `\n\n[User uploaded image: ${req.file.originalname} (${fileSizeMB} MB)]`;
        }
      } catch (fileError) {
        console.error('Error reading file:', fileError);
        fileContext = `\n\n[User uploaded file: ${req.file.originalname} (${fileSizeMB} MB) - Error reading content: ${fileError.message}]`;
      }
      
      // Clean up file after 5 seconds
      setTimeout(async () => {
        try {
          await fs.unlink(filePath).catch(() => {});
        } catch (err) {
          // Ignore cleanup errors
        }
      }, 5000);
    }
    
    // Add file context to last user message
    if (fileContext) {
      const lastMessage = parsedMessages[parsedMessages.length - 1];
      if (lastMessage && lastMessage.role === 'user') {
        lastMessage.content += fileContext;
      }
    }
    
    // Set headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    
    let apiUrl, apiHeaders, modelName, format, customConfig, requestBody;
    
    // If auto provider selected, pick OpenAI as default (most reliable)
    let actualProvider = provider;
    if (actualProvider === 'auto') {
      console.log('Auto provider selected, defaulting to OpenAI');
      actualProvider = 'openai';
    }
    
    // Handle different providers
    switch (actualProvider) {
      case 'openai':
        apiUrl = 'https://api.openai.com/v1/chat/completions';
        apiHeaders = buildHeadersForAPI('openai', apiKey || process.env.OPENAI_API_KEY);
        modelName = model || 'gpt-3.5-turbo';
        format = 'openai';
        requestBody = formatMessagesForAPI(parsedMessages, format, modelName, systemPrompt, true);
        break;
        
      case 'grok':
        apiUrl = 'https://api.x.ai/v1/chat/completions';
        apiHeaders = buildHeadersForAPI('openai', apiKey || process.env.GROK_API_KEY);
        modelName = 'grok-beta';
        format = 'openai';
        requestBody = formatMessagesForAPI(parsedMessages, format, modelName, systemPrompt, true);
        break;
        
      case 'deepseek':
        apiUrl = 'https://api.deepseek.com/v1/chat/completions';
        apiHeaders = buildHeadersForAPI('openai', apiKey || process.env.DEEPSEEK_API_KEY);
        modelName = 'deepseek-chat';
        format = 'openai';
        requestBody = formatMessagesForAPI(parsedMessages, format, modelName, systemPrompt, true);
        break;
        
      case 'gemini':
        modelName = 'gemini-pro';
        format = 'gemini';
        requestBody = formatMessagesForAPI(parsedMessages, format, modelName, systemPrompt, true);
        apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?key=${apiKey || process.env.GEMINI_API_KEY}`;
        apiHeaders = { 'Content-Type': 'application/json' };
        break;
        
      case 'anthropic':
        apiUrl = 'https://api.anthropic.com/v1/messages';
        apiHeaders = buildHeadersForAPI('anthropic', apiKey || process.env.ANTHROPIC_API_KEY);
        modelName = 'claude-3-sonnet-20240229';
        format = 'anthropic';
        requestBody = formatMessagesForAPI(parsedMessages, format, modelName, systemPrompt, true);
        break;
        
      case 'cohere':
        apiUrl = 'https://api.cohere.ai/v1/chat';
        apiHeaders = buildHeadersForAPI('cohere', apiKey || process.env.COHERE_API_KEY);
        modelName = 'command';
        format = 'cohere';
        requestBody = formatMessagesForAPI(parsedMessages, format, modelName, systemPrompt, true);
        break;
        
      case 'ollama':
        apiUrl = process.env.OLLAMA_URL || 'http://localhost:11434/api/chat';
        apiHeaders = { 'Content-Type': 'application/json' };
        modelName = model || 'llama2';
        format = 'ollama';
        requestBody = formatMessagesForAPI(parsedMessages, format, modelName, systemPrompt, true);
        break;
        
      case 'custom':
        // Handle custom API
        if (!customApisStr) {
          throw new Error('Custom API configuration not provided');
        }
        
        // Parse custom APIs safely
        let customApis;
        try {
          customApis = JSON.parse(customApisStr);
        } catch (e) {
          console.error('Error parsing customApisStr:', customApisStr);
          throw new Error('Invalid custom API configuration format');
        }
        
        if (customApiIndex === undefined || customApiIndex === null) {
          throw new Error('Custom API index not provided');
        }
        
        customConfig = customApis[customApiIndex];
        
        if (!customConfig) {
          throw new Error(`Custom API configuration not found for index ${customApiIndex}`);
        }
        
        apiUrl = customConfig.url;
        format = customConfig.format || 'openai';
        modelName = customConfig.model;
        
        // Build headers
        apiHeaders = buildHeadersForAPI(format, customConfig.key, customConfig.headers || {});
        
        // Handle custom request body template
        if (customConfig.customBody) {
          try {
            let bodyTemplate = customConfig.customBody;
            bodyTemplate = bodyTemplate.replace(/{{messages}}/g, JSON.stringify(parsedMessages));
            bodyTemplate = bodyTemplate.replace(/{{model}}/g, modelName);
            bodyTemplate = bodyTemplate.replace(/{{apiKey}}/g, customConfig.key);
            if (systemPrompt) {
              bodyTemplate = bodyTemplate.replace(/{{systemPrompt}}/g, systemPrompt);
            }
            requestBody = JSON.parse(bodyTemplate);
          } catch (e) {
            console.error('Error parsing custom body template:', e);
            throw new Error('Invalid custom request body template');
          }
        } else {
          requestBody = formatMessagesForAPI(parsedMessages, format, modelName, systemPrompt, true);
        }
        
        // Handle Gemini URL specially
        if (format === 'gemini' && !apiUrl.includes('key=')) {
          const separator = apiUrl.includes('?') ? '&' : '?';
          apiUrl = `${apiUrl}${separator}key=${customConfig.key}`;
        }
        break;
        
      default:
        throw new Error(`Unsupported provider: ${actualProvider}`);
    }
    
    // Make the API request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
    
    console.log(`Making request to ${actualProvider} API...`);
    console.log('Request URL:', apiUrl);
    console.log('Request body preview:', JSON.stringify(requestBody).substring(0, 200) + '...');
    
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    }).catch(error => {
      clearTimeout(timeoutId);
      throw error;
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      
      let errorMessage = `API error: ${response.status}`;
      try {
        const error = JSON.parse(errorText);
        errorMessage = error.error?.message || error.message || error.error || errorMessage;
      } catch {
        // Use status text if JSON parsing fails
        errorMessage = `API error: ${response.status} ${response.statusText}`;
      }
      
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      res.end();
      return;
    }
    
    // Stream the response
    const streamParser = parseStreamResponse(response, format);
    let hasContent = false;
    
    try {
      for await (const chunk of streamParser) {
        if (chunk.done) {
          res.write('data: [DONE]\n\n');
        } else {
          hasContent = true;
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      }
    } catch (streamError) {
      console.error('Stream parsing error:', streamError);
      if (!hasContent) {
        res.write(`data: ${JSON.stringify({ error: 'Error parsing stream' })}\n\n`);
      }
    }
    
    res.end();
    
  } catch (error) {
    console.error('Streaming error:', error);
    
    // Check if headers are already sent
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }
    
    const errorMessage = error.name === 'AbortError' 
      ? 'Request timeout - API took too long to respond'
      : error.message;
    
    res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
    res.end();
  }
});

// Test custom API endpoint (NON-STREAMING)
app.post('/api/test-custom-api', async (req, res) => {
  try {
    const { config } = req.body;
    
    if (!config) {
      return res.status(400).json({ error: 'API configuration required' });
    }
    
    console.log('Testing custom API:', config.name);
    
    // Prepare test message
    const testMessages = [{ role: 'user', content: 'Say "API test successful" if you receive this.' }];
    
    // Format request with stream=false for testing
    let requestBody;
    if (config.customBody) {
      try {
        let bodyTemplate = config.customBody;
        bodyTemplate = bodyTemplate.replace(/{{messages}}/g, JSON.stringify(testMessages));
        bodyTemplate = bodyTemplate.replace(/{{model}}/g, config.model);
        bodyTemplate = bodyTemplate.replace(/{{apiKey}}/g, config.key);
        
        // Ensure stream is set to false for testing
        const parsed = JSON.parse(bodyTemplate);
        parsed.stream = false;
        requestBody = parsed;
      } catch (e) {
        console.error('Error parsing custom body template:', e);
        return res.status(400).json({ error: 'Invalid custom request body template' });
      }
    } else {
      requestBody = formatMessagesForAPI(testMessages, config.format, config.model, '', false);
    }
    
    const headers = buildHeadersForAPI(config.format, config.key, config.headers || {});
    
    // Build URL (handle Gemini specially)
    let url = config.url;
    if (config.format === 'gemini') {
      // For Gemini, we need to use the non-streaming endpoint
      url = url.replace(':streamGenerateContent', ':generateContent');
      if (!url.includes('key=')) {
        const separator = url.includes('?') ? '&' : '?';
        url = `${url}${separator}key=${config.key}`;
      }
    }
    
    console.log('Test request URL:', url);
    console.log('Test request body:', JSON.stringify(requestBody).substring(0, 200) + '...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Test API error response:', errorText);
      return res.status(response.status).json({ 
        error: `HTTP ${response.status}: ${errorText.substring(0, 200)}` 
      });
    }
    
    // Parse response as JSON (non-streaming)
    let data;
    try {
      data = await response.json();
    } catch (e) {
      console.error('Error parsing JSON response:', e);
      return res.status(500).json({ error: 'Invalid JSON response from API' });
    }
    
    // Extract response using path
    let responsePath = config.responsePath;
    if (!responsePath) {
      // Set default based on format
      switch (config.format) {
        case 'openai':
          responsePath = 'choices.0.message.content';
          break;
        case 'anthropic':
          responsePath = 'content.0.text';
          break;
        case 'gemini':
          responsePath = 'candidates.0.content.parts.0.text';
          break;
        case 'cohere':
          responsePath = 'text';
          break;
        case 'ollama':
          responsePath = 'message.content';
          break;
        default:
          responsePath = 'choices.0.message.content';
      }
    }
    
    const extractedResponse = getValueByPath(data, responsePath);
    
    res.json({ 
      success: true, 
      response: extractedResponse || 'No content extracted',
      raw: data 
    });
    
  } catch (error) {
    console.error('Test API error:', error);
    
    if (error.name === 'AbortError') {
      res.status(408).json({ error: 'Request timeout - API took too long to respond' });
    } else if (error instanceof SyntaxError) {
      res.status(500).json({ error: 'Invalid JSON response from API' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Helper function to parse CSV line (handles quoted values)
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let insideQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

// Helper function to convert array to CSV line
function arrayToCSVLine(arr) {
  return arr.map(val => {
    const str = String(val || '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }).join(',');
}

// Helper function to clean API responses - remove JSON, code blocks, metadata
function cleanAPIResponse(content) {
  if (!content || typeof content !== 'string') return '';
  
  let cleaned = content.trim();

  // Unwrap fenced code blocks while keeping inner content.
  const fencedMatch = cleaned.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  if (fencedMatch && fencedMatch[1]) {
    cleaned = fencedMatch[1].trim();
  } else {
    cleaned = cleaned.replace(/```[a-zA-Z0-9_-]*\n?/g, '').replace(/```/g, '').trim();
  }
  
  // Remove JSON objects that look like metadata (e.g., {"response": "...", "metadata": ...})
  // Only if the entire response is a single JSON object
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleaned);
      // If JSON has a "response" or "answer" field, extract it
      if (parsed.response && typeof parsed.response === 'string') {
        cleaned = parsed.response;
      } else if (parsed.answer && typeof parsed.answer === 'string') {
        cleaned = parsed.answer;
      } else if (parsed.text && typeof parsed.text === 'string') {
        cleaned = parsed.text;
      } else {
        // If it's a simple key-value object, keep as is
        // Otherwise extract first string value
        const stringValues = Object.values(parsed).filter(v => typeof v === 'string');
        if (stringValues.length === 1) {
          cleaned = stringValues[0];
        }
      }
    } catch (e) {
      // Not valid JSON, keep as is
    }
  }
  
  // Remove common metadata prefixes
  cleaned = cleaned.replace(/^(Response:|Answer:|Result:|Output:)\s*/i, '');
  
  // Remove leading/trailing quotes if entire response is quoted
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  
  // Remove excessive newlines (more than 2)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  return cleaned.trim();
}

// Extract first meaningful string from nested objects/arrays.
function extractFirstStringValue(value, maxDepth = 4) {
  if (maxDepth < 0 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractFirstStringValue(item, maxDepth - 1);
      if (found) return found;
    }
    return '';
  }

  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const found = extractFirstStringValue(value[key], maxDepth - 1);
      if (found) return found;
    }
  }

  return '';
}

// Prefer likely response keys before generic deep scan.
function extractLikelyResponseText(apiResponse) {
  if (!apiResponse || typeof apiResponse !== 'object') return '';

  const directCandidates = [
    apiResponse.response,
    apiResponse.output,
    apiResponse.result,
    apiResponse.answer,
    apiResponse.text,
    apiResponse.content,
    apiResponse.message
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
    const nested = extractFirstStringValue(candidate);
    if (nested) return nested;
  }

  return extractFirstStringValue(apiResponse);
}

// Final sanitizer for CSV response column: keep only pure response text.
function sanitizeCSVResponse(value, headerColumns = []) {
  if (value === null || value === undefined) return '';

  let text = String(value).trim();
  if (!text) return '';

  // Reuse base cleaner first.
  text = cleanAPIResponse(text);

  // If content is still JSON-looking, extract meaningful text.
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      const parsed = JSON.parse(text);
      const extracted = extractLikelyResponseText(parsed);
      if (extracted) text = extracted;
    } catch (e) {
      // Keep text as-is when not valid JSON.
    }
  }

  // Strip common wrappers/labels that are not part of the answer.
  text = text
    .replace(/^(AI[_\s-]*Response|Response|Answer|Result|Output)\s*[:\-]\s*/i, '')
    .replace(/^Here\s+is\s+the\s+(response|answer)\s*[:\-]\s*/i, '')
    .replace(/^Final\s+(response|answer)\s*[:\-]\s*/i, '');

  // Collapse excessive whitespace but keep readable line breaks.
  text = text.replace(/\r/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  // Remove echoed CSV header lines (e.g., "payload,response").
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 0) {
    const firstLine = lines[0].toLowerCase();
    const normalizedHeaders = headerColumns
      .map(h => String(h || '').trim().toLowerCase())
      .filter(Boolean);

    const expectedHeader = normalizedHeaders.join(',');
    if ((expectedHeader && firstLine === expectedHeader) || firstLine === 'payload,response') {
      lines.shift();
      text = lines.join('\n').trim();
    }
  }

  return text;
}

// Ensure custom API payloads also carry system instructions in common field shapes.
function enforceSystemPromptInCustomBody(requestBody, systemPrompt) {
  if (!requestBody || !systemPrompt || !systemPrompt.trim()) return requestBody;

  const promptText = systemPrompt.trim();

  if (Array.isArray(requestBody.messages) && !requestBody.messages.some(m => m && m.role === 'system')) {
    requestBody.messages = [{ role: 'system', content: promptText }, ...requestBody.messages];
  }

  if (Array.isArray(requestBody.input) && !requestBody.input.some(m => m && m.role === 'system')) {
    requestBody.input = [{ role: 'system', content: promptText }, ...requestBody.input];
  }

  if (typeof requestBody.system === 'undefined' && typeof requestBody.preamble === 'undefined') {
    requestBody.system = promptText;
  }

  // Common single-string prompt shapes for custom APIs.
  const candidateFields = ['prompt', 'query', 'text', 'message', 'instruction'];
  for (const field of candidateFields) {
    if (typeof requestBody[field] === 'string' && requestBody[field].trim().length > 0) {
      const content = requestBody[field];
      if (!content.includes(promptText)) {
        requestBody[field] = `System instructions:\n${promptText}\n\n${content}`;
      }
      break;
    }
  }

  return requestBody;
}

// Helper function to process single line through API with retry logic
async function processLineWithAPI(line, prompt, provider, apiKey, systemPrompt, format, modelName, apiUrl, apiHeaders, lineIndex, rowContext = null, customApiConfig = null) {
  const maxRetries = 2;
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Build minimal message for CSV processing
      let userMessage = '';
      
      if (rowContext) {
        // For CSV files: minimal format for fast processing
        userMessage = `${prompt}\n\nData: ${JSON.stringify(rowContext)}\n\nReturn only the final response text. No JSON, no metadata, no labels.`;
      } else {
        // For non-CSV files
        userMessage = `${prompt}\n\n${line}`;
      }

      const messages = [{
        role: 'user',
        content: userMessage
      }];

      // Ensure system prompt is consistently available for batch processing.
      const messagesWithSystem = (systemPrompt && systemPrompt.trim())
        ? [{ role: 'system', content: systemPrompt.trim() }, ...messages]
        : messages;
      
      // Build request body - handle custom API with template or standard formatMessagesForAPI
      let requestBody;
      if (customApiConfig && customApiConfig.customBody) {
        // Use custom body template
        try {
          let bodyTemplate = customApiConfig.customBody;
          bodyTemplate = bodyTemplate.replace(/{{messages}}/g, JSON.stringify(messagesWithSystem));
          bodyTemplate = bodyTemplate.replace(/{{model}}/g, modelName);
          bodyTemplate = bodyTemplate.replace(/{{apiKey}}/g, customApiConfig.key);
          if (systemPrompt) {
            bodyTemplate = bodyTemplate.replace(/{{systemPrompt}}/g, systemPrompt);
          }
          requestBody = JSON.parse(bodyTemplate);
          requestBody = enforceSystemPromptInCustomBody(requestBody, systemPrompt);
        } catch (e) {
          console.error('Error parsing custom body template:', e);
          requestBody = formatMessagesForAPI(messages, format, modelName, systemPrompt || '', false);
        }
      } else {
        // Use standard format
        requestBody = formatMessagesForAPI(messages, format, modelName, systemPrompt || '', false);

        // Custom APIs with format='custom' may not have a template.
        if (!requestBody && customApiConfig) {
          requestBody = {
            model: modelName,
            messages: messagesWithSystem,
            prompt: userMessage
          };

          if (systemPrompt && systemPrompt.trim()) {
            requestBody.system = systemPrompt.trim();
          }

          requestBody = enforceSystemPromptInCustomBody(requestBody, systemPrompt);
        }
      }
      
      // Optimize for batch processing: fixed settings for consistent speed
      if (format === 'openai') {
        requestBody.max_tokens = 4096;
        requestBody.temperature = 0.3;
      } else if (format === 'anthropic') {
        requestBody.max_tokens = 4096;
        requestBody.temperature = 0.3;
      } else if (format === 'gemini') {
        requestBody.generationConfig.maxOutputTokens = 4096;
        requestBody.generationConfig.temperature = 0.3;
      } else if (format === 'cohere') {
        requestBody.max_tokens = 4096;
        requestBody.temperature = 0.3;
      } else if (format === 'ollama') {
        requestBody.options.num_predict = 4096;
        requestBody.options.temperature = 0.3;
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout per line
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API error (attempt ${attempt + 1}): ${response.status} - ${errorText.substring(0, 100)}`);
        
        if (attempt < maxRetries && (response.status === 429 || response.status >= 500)) {
          // Rate limited or server error, retry with shorter delay
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        
        throw new Error(`API error: ${response.status}`);
      }
      
      const apiResponse = await response.json();
      let extractedContent = '';

      // Custom APIs: respect configured responsePath first.
      if (customApiConfig?.responsePath) {
        const customPathValue = getValueByPath(apiResponse, customApiConfig.responsePath);
        if (typeof customPathValue === 'string') {
          extractedContent = customPathValue;
        } else if (customPathValue !== null && customPathValue !== undefined) {
          extractedContent = extractFirstStringValue(customPathValue);
        }
      }
      
      if (!extractedContent && format === 'openai') {
        extractedContent = apiResponse.choices?.[0]?.message?.content || '';
      } else if (!extractedContent && format === 'anthropic') {
        extractedContent = apiResponse.content?.[0]?.text || '';
      } else if (!extractedContent && format === 'gemini') {
        extractedContent = apiResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else if (!extractedContent && format === 'cohere') {
        extractedContent = apiResponse.text || '';
      } else if (!extractedContent && format === 'ollama') {
        extractedContent = apiResponse.message?.content || '';
      } else if (!extractedContent && format === 'custom') {
        extractedContent = extractLikelyResponseText(apiResponse);
      }
      
      // Clean response: remove JSON blocks, code blocks, and metadata
      const cleanedContent = cleanAPIResponse(extractedContent);
      
      return cleanedContent || '[No response]';
      
    } catch (e) {
      lastError = e;
      console.error(`Error processing line (attempt ${attempt + 1}/${maxRetries + 1}):`, e.message);
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
  
  console.error(`Failed to process line after ${maxRetries + 1} attempts:`, lastError.message);
  return '[Processing failed]';
}

// Global progress tracker for batch processing
let batchProgress = {
  batchId: null,
  isProcessing: false,
  totalLines: 0,
  processedLines: 0,
  successfulLines: 0,
  startTime: 0,
  estimatedTimeRemaining: 0
};

// Progress tracking endpoint
app.get('/api/batch-progress', (req, res) => {
  const total = Math.max(0, Number(batchProgress.totalLines) || 0);
  const processed = Math.max(0, Math.min(Number(batchProgress.processedLines) || 0, total));
  const successful = Math.max(0, Math.min(Number(batchProgress.successfulLines) || 0, processed));
  const eta = Math.max(0, Number(batchProgress.estimatedTimeRemaining) || 0);

  res.json({
    ...batchProgress,
    totalLines: total,
    processedLines: processed,
    successfulLines: successful,
    estimatedTimeRemaining: eta
  });
});

// Batch processing endpoint - Line by line
// Extended timeout middleware for large file processing (10 minutes)
app.post('/api/batch-process', (req, res, next) => {
  req.setTimeout(10 * 60 * 1000);  // 10 minutes for request
  res.setTimeout(10 * 60 * 1000);  // 10 minutes for response
  next();
}, async (req, res) => {
  try {
    console.log('Batch process endpoint called');
    console.log('Request body keys:', req.body ? Object.keys(req.body) : 'req.body is undefined');
    
    if (!req.body) {
      console.error('req.body is undefined');
      return res.status(400).json({ error: 'Request body is empty' });
    }
    
    const { fileContent, fileName, fileType, prompt, provider, apiKey, outputFormat, systemPrompt, customApiConfig, batchRequestId } = req.body;
    
    if (!fileContent) {
      return res.status(400).json({ error: 'File content is required' });
    }
    if (!prompt) {
      return res.status(400).json({ error: 'Processing prompt is required' });
    }
    if (!provider) {
      return res.status(400).json({ error: 'Provider is required' });
    }
    
    console.log(`Batch processing initiated: ${fileName} (${fileType}) with ${provider}`);
    
    // Parse file based on type and split into lines
    let lines = [];
    let headerLine = '';
    let headerColumns = [];
    
    try {
      if (fileType === '.csv' && typeof fileContent === 'string') {
        // Split CSV into lines
        lines = fileContent.split('\n').filter(line => line.trim().length > 0);
        
        // First line is header, preserve it
        if (lines.length > 0) {
          headerLine = lines[0];
          headerColumns = parseCSVLine(headerLine);
          lines = lines.slice(1); // Remove header from processing
        }
        
        console.log(`CSV: ${lines.length} data rows found, ${headerColumns.length} columns`);
        
      } else if (fileType === '.txt' && typeof fileContent === 'string') {
        lines = fileContent.split('\n').filter(line => line.trim().length > 0);
        console.log(`TXT: ${lines.length} lines found`);
        
      } else if (fileType === '.xlsx') {
        // For XLSX, split by lines
        lines = fileContent.split('\n').filter(line => line.trim().length > 0);
        if (lines.length > 0) {
          headerLine = lines[0];
          headerColumns = parseCSVLine(headerLine);
          lines = lines.slice(1);
        }
        console.log(`XLSX: ${lines.length} data rows found`);
        
      } else {
        return res.status(400).json({ error: 'Unsupported file type' });
      }
    } catch (e) {
      console.error('Error parsing file:', e);
      return res.status(400).json({ error: 'Error parsing file content' });
    }
    
    if (lines.length === 0) {
      return res.status(400).json({ error: 'File is empty or has no data rows' });
    }
    
    // Limit processing to max 3000 lines
    const maxLines = Math.min(lines.length, 3000);
    const allLines = lines.slice(0, maxLines);
    console.log(`Total lines to process: ${allLines.length} (will process in batches of 500)`);
    
    // Set up API credentials based on provider
    let format, apiUrl, apiHeaders, modelName;
    
    switch (provider) {
      case 'openai':
        apiUrl = 'https://api.openai.com/v1/chat/completions';
        apiHeaders = buildHeadersForAPI('openai', apiKey);
        modelName = 'gpt-3.5-turbo';
        format = 'openai';
        break;
        
      case 'grok':
        apiUrl = 'https://api.x.ai/v1/chat/completions';
        apiHeaders = buildHeadersForAPI('openai', apiKey);
        modelName = 'grok-beta';
        format = 'openai';
        break;
        
      case 'deepseek':
        apiUrl = 'https://api.deepseek.com/v1/chat/completions';
        apiHeaders = buildHeadersForAPI('openai', apiKey);
        modelName = 'deepseek-chat';
        format = 'openai';
        break;
        
      case 'gemini':
        apiHeaders = { 'Content-Type': 'application/json' };
        modelName = 'gemini-pro';
        format = 'gemini';
        apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        break;
        
      case 'anthropic':
        apiUrl = 'https://api.anthropic.com/v1/messages';
        apiHeaders = buildHeadersForAPI('anthropic', apiKey);
        modelName = 'claude-3-sonnet-20240229';
        format = 'anthropic';
        break;
        
      case 'cohere':
        apiUrl = 'https://api.cohere.ai/v1/chat';
        apiHeaders = buildHeadersForAPI('cohere', apiKey);
        modelName = 'command';
        format = 'cohere';
        break;
        
      case 'ollama':
        apiUrl = process.env.OLLAMA_URL || 'http://localhost:11434/api/chat';
        apiHeaders = { 'Content-Type': 'application/json' };
        modelName = 'llama2';
        format = 'ollama';
        break;
        
      case 'custom':
        if (!customApiConfig) {
          return res.status(400).json({ error: 'Custom API configuration is missing' });
        }
        apiUrl = customApiConfig.url;
        modelName = customApiConfig.model;
        format = customApiConfig.format;
        apiHeaders = buildHeadersForAPI(format, customApiConfig.key, customApiConfig.headers || {});
        console.log(`Using custom API: ${customApiConfig.name}`);
        break;
        
      default:
        return res.status(400).json({ error: 'Unsupported provider' });
    }
    
    // Determine concurrent processing settings for optimal performance
    // Concurrent requests = number of API calls to make simultaneously
    // Batch size = how many lines to process before checking timeout
    const concurrentRequests = 15; // Process 15 lines at a time for maximum speed
    let batchSize = 2000; // With concurrent processing, we can use larger batches
    
    if (allLines.length < 100) {
      batchSize = allLines.length; // Process all at once for tiny files
    } else if (allLines.length < 500) {
      batchSize = 500;  // Small files
    } else if (allLines.length < 1500) {
      batchSize = 1500;  // Medium files  
    } else {
      batchSize = 2000;  // Large files (2000+ rows will use 2000 line batches)
    }
    
    console.log(`Using concurrent processing: ${concurrentRequests} parallel requests, batch size: ${batchSize} lines for ${allLines.length} total lines`);
    
    // Process each line in adaptive batches to prevent timeout
    // Pre-allocate results array for concurrent processing
    const results = new Array(allLines.length).fill(null);
    let successCount = 0;
    let completedCount = 0;
    const startTime = Date.now();
    const currentBatchId = batchRequestId || `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // Initialize global progress tracker
    batchProgress = {
      batchId: currentBatchId,
      isProcessing: true,
      totalLines: allLines.length,
      processedLines: 0,
      successfulLines: 0,
      startTime: startTime,
      estimatedTimeRemaining: 0
    };
    
    for (let batchStart = 0; batchStart < allLines.length; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, allLines.length);
      const batchLines = allLines.slice(batchStart, batchEnd);
      
      console.log(`Processing batch: lines ${batchStart + 1}-${batchEnd} of ${allLines.length} (concurrent: ${concurrentRequests})`);
      
      // Process lines concurrently in chunks for better performance
      for (let chunkStart = 0; chunkStart < batchLines.length; chunkStart += concurrentRequests) {
        const chunkEnd = Math.min(chunkStart + concurrentRequests, batchLines.length);
        const concurrentChunk = batchLines.slice(chunkStart, chunkEnd);
        
        // Create array of promises for concurrent processing
        const promises = concurrentChunk.map(async (line, chunkIndex) => {
          const actualLineIndex = batchStart + chunkStart + chunkIndex;
          
          let rowContext = null;
          if ((fileType === '.csv' || fileType === '.xlsx') && headerColumns.length > 0) {
            const rowValues = parseCSVLine(line);
            rowContext = {};
            for (let colIndex = 0; colIndex < headerColumns.length; colIndex++) {
              const columnName = headerColumns[colIndex] || `column_${colIndex + 1}`;
              rowContext[columnName] = rowValues[colIndex] || '';
            }
          }
          
          // Process line through API (WITH system prompt for proper response generation)
          const result = await processLineWithAPI(
            line,
            prompt,
            provider,
            apiKey,
            systemPrompt,
            format,
            modelName,
            apiUrl,
            apiHeaders,
            actualLineIndex + 1,
            rowContext,
            customApiConfig
          );
          
          return { index: actualLineIndex, result };
        });
        
        // Wait for all concurrent requests to complete
        const chunkResults = await Promise.allSettled(promises);
        
        // Process results and update progress
        for (const promiseResult of chunkResults) {
          if (promiseResult.status === 'fulfilled') {
            const { index, result } = promiseResult.value;
            results[index] = result;
            completedCount++;
            
            if (!result.includes('[') && result.length > 0) {
              successCount++;
            }
            
            // Update global progress tracker
            const elapsedTime = Date.now() - startTime;
            const processedSoFar = completedCount;
            const timePerLine = elapsedTime / processedSoFar;
            const remainingLines = allLines.length - processedSoFar;
            const estimatedTimeRemaining = Math.ceil(timePerLine * remainingLines / 1000);

            if (batchProgress.batchId === currentBatchId) {
              batchProgress.processedLines = Math.min(processedSoFar, allLines.length);
              batchProgress.successfulLines = Math.min(successCount, batchProgress.processedLines);
              batchProgress.estimatedTimeRemaining = Math.max(0, estimatedTimeRemaining);
            }
            
            // Log progress every 25 lines
            if (processedSoFar % 25 === 0) {
              console.log(`Processed ${processedSoFar}/${allLines.length} lines - ETA: ~${estimatedTimeRemaining}s (${Math.round(processedSoFar/allLines.length*100)}%)`);
            }
          } else {
            completedCount++;
            console.error('Promise rejected:', promiseResult.reason);

            if (batchProgress.batchId === currentBatchId) {
              const elapsedTime = Date.now() - startTime;
              const processedSoFar = completedCount;
              const timePerLine = elapsedTime / Math.max(processedSoFar, 1);
              const remainingLines = allLines.length - processedSoFar;
              const estimatedTimeRemaining = Math.ceil(timePerLine * remainingLines / 1000);

              batchProgress.processedLines = Math.min(processedSoFar, allLines.length);
              batchProgress.successfulLines = Math.min(successCount, batchProgress.processedLines);
              batchProgress.estimatedTimeRemaining = Math.max(0, estimatedTimeRemaining);
            }
          }
        }
        
        // Small delay between concurrent chunks to avoid rate limiting
        if (chunkEnd < batchLines.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }
    
    const totalElapsedTime = Date.now() - startTime;
    console.log(`Batch processing completed: ${successCount}/${allLines.length} lines successfully processed in ${totalElapsedTime}ms`);
    
    // Mark processing as complete
    if (batchProgress.batchId === currentBatchId) {
      batchProgress.isProcessing = false;
      batchProgress.processedLines = allLines.length;
      batchProgress.successfulLines = Math.min(successCount, allLines.length);
      batchProgress.estimatedTimeRemaining = 0;
    }
    
    // Format output based on file type
    let formattedOutput = '';
    
    if ((fileType === '.csv' || outputFormat === 'csv') && headerLine) {
      // Build CSV with output column
      const csvLines = [];
      const existingResponseIndex = headerColumns.findIndex(col => {
        const key = String(col || '').trim().toLowerCase();
        return key === 'response' || key === 'ai_response';
      });

      const outputHeader = existingResponseIndex >= 0
        ? arrayToCSVLine(headerColumns)
        : arrayToCSVLine([...headerColumns, 'AI_Response']);
      csvLines.push(outputHeader);
      
      for (let i = 0; i < results.length; i++) {
        const originalLine = allLines[i];
        const rawResult = results[i] || '[Processing failed]'; // Handle null results
        const result = sanitizeCSVResponse(rawResult, headerColumns);
        const columns = parseCSVLine(originalLine);

        while (columns.length < headerColumns.length) {
          columns.push('');
        }

        let outputRow;
        if (existingResponseIndex >= 0) {
          columns[existingResponseIndex] = result;
          outputRow = arrayToCSVLine(columns.slice(0, headerColumns.length));
        } else {
          outputRow = arrayToCSVLine([...columns, result]);
        }

        csvLines.push(outputRow);
      }
      
      formattedOutput = csvLines.join('\n');
      
    } else if (fileType === '.txt' || outputFormat === 'txt') {
      // Build text output with original + result
      const textLines = [];
      for (let i = 0; i < results.length; i++) {
        textLines.push(`Line ${i + 1} Input:\n${allLines[i]}`);
        textLines.push(`Line ${i + 1} Output:\n${results[i]}`);
        textLines.push('---');
      }
      formattedOutput = textLines.join('\n');
      
    } else if (outputFormat === 'json') {
      const jsonData = {
        summary: {
          totalLines: lines.length,
          processedLines: allLines.length,
          successfulLines: successCount,
          provider: provider,
          fileName: fileName,
          timestamp: new Date().toISOString()
        },
        data: results.map((result, idx) => ({
          lineNumber: idx + 1,
          input: allLines[idx],
          output: result
        }))
      };
      formattedOutput = JSON.stringify(jsonData, null, 2);
    }
    
    // Prepare response
    const responseData = {
      success: true, 
      batchId: currentBatchId,
      output: formattedOutput,
      fileName: `batch_result_${Date.now()}`,
      linesProcessed: allLines.length,
      successfulLines: successCount,
      provider: provider,
      fileType: fileType,
      outputFormat: outputFormat,
      timestamp: new Date().toISOString()
    };
    
    console.log('Sending response:', {
      success: responseData.success,
      linesProcessed: responseData.linesProcessed,
      successfulLines: responseData.successfulLines
    });
    
    res.json(responseData);
    
  } catch (error) {
    console.error('Batch processing error:', error);

    if (batchProgress.isProcessing) {
      batchProgress.isProcessing = false;
      batchProgress.estimatedTimeRemaining = 0;
    }
    
    if (error.name === 'AbortError') {
      console.error('Abort error during batch processing:', error.message);
      res.status(408).json({ error: 'Request timeout - Processing took too long' });
    } else if (error.message && error.message.includes('timeout')) {
      console.error('Timeout error during batch processing:', error.message);
      res.status(408).json({ error: 'Request timeout - File processing exceeded time limit' });
    } else {
      console.error('Batch processing error details:', { message: error.message, name: error.name, stack: error.stack });
      res.status(500).json({ error: error.message || 'Batch processing failed' });
    }
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `File too large (max ${maxFileSize / 1024 / 1024}MB)` });
    }
    return res.status(400).json({ error: err.message });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// Clean up old uploads periodically
setInterval(async () => {
  const dir = path.join(__dirname, uploadDir);
  try {
    const files = await fs.readdir(dir);
    const now = Date.now();
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = await fs.stat(filePath);
      
      // Delete files older than 1 hour
      if (now - stats.mtimeMs > 3600000) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
  } catch (err) {
    // Ignore errors
  }
}, 3600000); // Run every hour

// Create uploads directory on startup
(async () => {
  const dir = path.join(__dirname, uploadDir);
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
})();

// Sync database and start server
(async () => {
  await syncDatabase();
  
  const server = app.listen(PORT, () => {
    console.log('\n🚀 CRIMSON AI Server Running!');
    console.log('='.repeat(50));
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`⚡ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`⚡ Database: MySQL (XAMPP)`);
    console.log(`⚡ Started: ${new Date().toLocaleString()}`);
    console.log('\n🔐 Authentication:');
    console.log('   • Google OAuth Login');
    console.log('   • User data stored in MySQL');
    console.log('\n📡 Supported APIs:');
    console.log('   • OpenAI (GPT-4, GPT-3.5)');
    console.log('   • Grok (xAI)');
    console.log('   • DeepSeek');
    console.log('   • Google Gemini');
    console.log('   • Anthropic Claude');
    console.log('   • Cohere');
    console.log('   • Ollama (local)');
    console.log('   • Custom APIs (any format)');
    console.log('\n📁 Features:');
    console.log('   • File uploads (max 1GB)');
    console.log('   • Batch file processing (.csv, .txt, .xlsx)');
    console.log('   • Streaming responses (4K tokens max)');
    console.log('   • Custom API editing & testing');
    console.log('   • Long-form response support');
    console.log('   • Auto file cleanup');
    console.log('   • Persistent MySQL storage');
    console.log('='.repeat(50));
    console.log('\n🌐 Routes:');
    console.log('   • http://localhost:3000/ - Landing page (intro.html)');
    console.log('   • http://localhost:3000/app - Main chat app (index.html)');
    console.log('   • http://localhost:3000/auth/google - Google login');
    console.log('='.repeat(50));
    
    // Set server-level timeout for large file processing
    server.timeout = 10 * 60 * 1000; // 10 minutes for the entire request/response cycle
    server.keepAliveTimeout = 65 * 1000; // Keep-alive timeout
  });
})();