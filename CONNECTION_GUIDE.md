# CRIMSON AI - File Connection Guide

## Overview
This document explains how the three main files (intro.html, index.html, and server.js) are connected in the CRIMSON AI application.

## File Connections

### 1. **intro.html** → Navigation Entry Point
- **Purpose**: Landing/intro page with uncensored AI messaging showcasing features
- **Connected To**: Redirects to the main application
- **Navigation Flow**:
  - User lands on `http://localhost:3000/intro`
  - Clicks "TEST NOW" button → Shows activation message
  - Automatically redirects to `/` after 1.2 seconds
  - The `/` route is served by Express server (see server.js routing)

**Key Changes Made**:
- Updated redirect from `index.html` to `/` (server route)
- This allows the server to properly serve the application using Express routing

### 2. **index.html** → Main Application Interface
- **Purpose**: Main chatbot interface with multi-model support
- **Connected To**: Serves as the primary UI for CRIMSON AI
- **Features**:
  - Chat interface with sidebar
  - Settings modal for API key configuration
  - File upload support
  - Multi-provider AI selection
  - Custom API management

**API Endpoints Used by index.html**:
```javascript
// Authentication
/api/user              - GET    Check if user is authenticated
/auth/google           - GET    Google OAuth login redirect
/api/logout            - GET    User logout

// Data Persistence
/api/save-chats        - POST   Save chat history
/api/load-chats        - GET    Load user's chat history
/api/save-custom-apis  - POST   Save custom API configurations
/api/load-custom-apis  - GET    Load custom API configurations
/api/save-settings     - POST   Save user settings (API keys, preferences)
/api/load-settings     - GET    Load user settings

// AI Interaction
/api/stream            - POST   Stream AI responses (main API endpoint)

// Health Check
/api/health            - GET    Server health status
```

**Data Flow**:
1. User opens index.html (`/`)
2. JavaScript runs `app.init()` which calls `checkAuth()`
3. If authenticated, loads user data via `/api/load-*` endpoints
4. User can input messages, which are sent to `/api/stream` endpoint
5. Responses are streamed back and displayed
6. User data is saved via `/api/save-*` endpoints

### 3. **server.js** → Backend Server & Router
- **Purpose**: Express server handling all routing, authentication, and API endpoints
- **Connected To**: Serves both HTML files and handles all API logic

**Key Routing Changes Made**:
```javascript
// Serve intro page
app.get('/intro', (req, res) => {
  res.sendFile(path.join(__dirname, 'intro.html'));
});

// Catch-all for SPA (Single Page Application)
app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  // Serve index.html for all other routes
  res.sendFile(path.join(__dirname, 'index.html'));
});
```

**Server Configuration**:
- Port: 3000
- Static files served from `__dirname`
- Session management with Passport.js
- Google OAuth authentication
- CORS enabled for localhost:3000
- File upload handling with multer (max 10MB)

## Complete User Journey

```
1. USER STARTS APP
   ↓
   http://localhost:3000/intro (intro.html)
   
2. INTRO PAGE DISPLAYS
   ↓
   Shows features, uncensored messaging info
   Displays "TEST NOW" button
   
3. USER CLICKS "TEST NOW"
   ↓
   Shows activation message
   Redirects to '/'
   
4. EXPRESS SERVER ROUTES '/' REQUEST
   ↓
   Serves index.html (main app)
   
5. INDEX.HTML LOADS & INITIALIZES
   ↓
   app.init() runs
   checkAuth() validates user
   
6. AUTHENTICATION CHECK
   ├─ If NOT authenticated
   │  ↓
   │  Show login section with Google OAuth button
   │  User clicks "Sign in with Google"
   │  Redirected to /auth/google
   │  Passport handles OAuth flow
   │  User data stored on server
   │
   └─ If authenticated
      ↓
      Show user profile with name/email/avatar
      Load user data via /api/load-*
      Load chats, custom APIs, settings
      Initialize chat interface
      
7. USER INTERACTS WITH CHAT
   ↓
   Types message + selects AI provider
   Clicks send or presses Enter
   
8. MESSAGE SENT TO SERVER
   ↓
   POST /api/stream
   Message formatted for selected provider
   API credentials from localStorage/server
   Response streamed back to client
   
9. RESPONSE DISPLAYED
   ↓
   Markdown parsed and rendered
   Message added to chat history
   Data saved via /api/save-chats
   
10. USER CONFIGURES SETTINGS
    ↓
    Opens Settings modal
    Enters/updates API keys
    Clicks Save Configuration
    ↓
    Settings saved to localStorage
    If authenticated: sent to /api/save-settings on server
    Custom APIs managed via /api/save-custom-apis
    
11. USER LOGS OUT
    ↓
    Clicks logout button
    GET /api/logout
    Session cleared
    Local data cleared
    Back to login state
```

## API Integration Details

### Authentication Flow
- **Google OAuth**: Handled by Passport.js
- **Session Management**: Express-session with cookies
- **User Storage**: In-memory (in-memory in this version, can be replaced with database)
- **Credentials**: Stored in browser localStorage for seamless UX

### Streaming Architecture
- Client sends messages to `/api/stream`
- Server routes to selected provider (OpenAI, Grok, Gemini, etc.)
- Response streamed back as Server-Sent Events (SSE)
- Client parses stream in real-time

### Custom API Support
- Users can add custom LLM endpoints
- Each API stored with configuration (URL, key, model, format)
- Server can test custom APIs via `/api/test-custom-api`
- Supports multiple request/response formats

## Files Modified

### intro.html
- **Change**: Updated redirect from `'index.html'` to `'/'`
- **Line**: ~718
- **Reason**: Allow Express server to handle routing

### server.js  
- **Changes**: Added two new routes
- **Added Routes**:
  1. `/intro` - Serves intro.html explicitly
  2. Catch-all middleware - Serves index.html for SPA navigation
- **Location**: Before error handling middleware
- **Reason**: Enable proper SPA routing and intro page serving

### index.html
- **No changes needed** - Already integrated with all API endpoints
- **Summary**: All API calls use `/api/` endpoints which are properly handled by server.js

## Testing the Connections

To verify everything works:

1. **Start the server**:
   ```bash
   npm start
   ```

2. **Test intro page**:
   ```
   http://localhost:3000/intro
   ```
   - Verify it loads
   - Click "TEST NOW"
   - Should redirect to `/` and load main app

3. **Test main app**:
   ```
   http://localhost:3000/
   ```
   - Should serve index.html
   - Attempt Google OAuth login
   - Verify authentication flow

4. **Test API endpoints**:
   ```bash
   curl http://localhost:3000/api/health
   # Should return: {"status":"ok","timestamp":"...","uptime":...}
   ```

5. **Test routing**:
   ```
   http://localhost:3000/any-path
   # Should serve index.html (SPA routing)
   ```

## Configuration Required

Before running in production, update:

1. **Google OAuth Credentials** in `server.js` (lines ~46-47):
   - `clientID`: Get from Google Cloud Console
   - `clientSecret`: Get from Google Cloud Console
   - `callbackURL`: Update if not localhost:3000

2. **Session Secret** in `server.js` (line ~21):
   - Change `'crimson-ai-secret-key-change-this-in-production'` to a secure random string

3. **CORS Settings** in `server.js` (line ~14):
   - Update origin from `'http://localhost:3000'` for production

4. **Database** (recommended):
   - Replace in-memory user storage with a database (MongoDB, PostgreSQL, etc.)

## Summary

✅ **All three files are now properly connected**:
- intro.html → navigates to `/`
- `/` → serves index.html via Express
- index.html → communicates with server.js via REST API endpoints
- Server.js → handles all routing, authentication, and API integration

The application is ready to use once the Google OAuth credentials are configured.
