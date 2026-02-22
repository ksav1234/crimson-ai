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
const maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024; // 10MB default

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
    // Allow common file types
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'text/plain', 'text/markdown',
      'application/json', 'text/javascript', 'text/x-python',
      'text/html', 'text/css', 'text/csv', 'application/xml'
    ];
    
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(txt|md|json|js|py|html|css|csv|xml)$/)) {
      cb(null, true);
    } else {
      cb(new Error('File type not supported'), false);
    }
  }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
        max_tokens: 2048
      };
      
    case 'anthropic':
      return {
        model: model,
        messages: finalMessages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content
        })),
        system: systemPrompt,
        max_tokens: 1024,
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
          maxOutputTokens: 2048
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
        max_tokens: 1024,
        stream: stream
      };
      
    case 'ollama':
      return {
        model: model,
        messages: finalMessages,
        stream: stream,
        options: {
          temperature: 0.7,
          num_predict: 2048
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
      
      try {
        if (['.txt', '.md', '.json', '.js', '.py', '.html', '.css', '.csv', '.xml'].includes(fileExt)) {
          const content = await fs.readFile(filePath, 'utf8');
          fileContext = `\n\n[User uploaded file: ${req.file.originalname}]\nFile content:\n${content}`;
        } else if (['.pdf'].includes(fileExt)) {
          fileContext = `\n\n[User uploaded PDF file: ${req.file.originalname}]`;
        } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(fileExt)) {
          fileContext = `\n\n[User uploaded image: ${req.file.originalname}]`;
        }
      } catch (fileError) {
        console.error('Error reading file:', fileError);
        fileContext = `\n\n[User uploaded file: ${req.file.originalname} (could not read content)]`;
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
  
  app.listen(PORT, () => {
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
    console.log('   • File uploads (max 10MB)');
    console.log('   • Streaming responses');
    console.log('   • Custom API editing');
    console.log('   • API testing endpoint');
    console.log('   • Auto file cleanup');
    console.log('   • Persistent MySQL storage');
    console.log('='.repeat(50));
    console.log('\n🌐 Routes:');
    console.log('   • http://localhost:3000/ - Landing page (intro.html)');
    console.log('   • http://localhost:3000/app - Main chat app (index.html)');
    console.log('   • http://localhost:3000/auth/google - Google login');
    console.log('='.repeat(50));
  });
})();