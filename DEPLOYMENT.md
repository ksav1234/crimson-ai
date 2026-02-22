# AI Chatbot Baseline - Deployment Guide

## 🚀 Deploy to Render

This application is configured for easy deployment to Render using the included `render.yaml` blueprint file.

### Prerequisites

1. **GitHub Repository**: Push your code to a GitHub repository
2. **Google OAuth Credentials**: Create OAuth 2.0 credentials in Google Cloud Console
3. **Render Account**: Sign up at [render.com](https://render.com)

### Step 1: Set Up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
5. Configure the OAuth consent screen if prompted
6. Set Application type to "Web application"
7. Add authorized redirect URIs:
   - `https://your-app-name.onrender.com/auth/google/callback`
   - `http://localhost:3000/auth/google/callback` (for local development)
8. Save your Client ID and Client Secret

### Step 2: Deploy on Render

#### Option A: Using Blueprint (Recommended)

1. Log in to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Blueprint"**
3. Connect your GitHub repository
4. Render will automatically detect the `render.yaml` file
5. Review the services:
   - **ai-chatbot-baseline** (Web Service)
   - **ai-chatbot-db** (PostgreSQL Database)
6. Click **"Apply"**

#### Option B: Manual Setup

1. **Create PostgreSQL Database**:
   - Click "New +" → "PostgreSQL"
   - Name: `ai-chatbot-db`
   - Plan: Free (256 MB)
   - Click "Create Database"

2. **Create Web Service**:
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Configure:
     - Name: `ai-chatbot-baseline`
     - Environment: `Node`
     - Build Command: `npm install`
     - Start Command: `npm start`
   - Click "Create Web Service"

### Step 3: Configure Environment Variables

In your Render Web Service dashboard, add these environment variables:

#### Required Environment Variables

| Variable | Value | Description |
|----------|-------|-------------|
| `NODE_ENV` | `production` | Environment mode |
| `GOOGLE_CLIENT_ID` | Your Google Client ID | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Your Google Client Secret | From Google Cloud Console |
| `GOOGLE_CALLBACK_URL` | `https://your-app.onrender.com/auth/google/callback` | OAuth callback URL |
| `CLIENT_URL` | `https://your-app.onrender.com` | Your app URL |
| `SESSION_SECRET` | Generate a random string | Session encryption key |

#### Database Variables (Auto-Generated if using Blueprint)

If using manual setup, connect to your PostgreSQL database:

| Variable | Value | Description |
|----------|-------|-------------|
| `DATABASE_URL` | From database info | Full PostgreSQL connection string |

#### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `10000` | Server port (auto-set by Render) |
| `SESSION_MAX_AGE` | `86400000` | Session duration (24 hours) |
| `UPLOAD_DIR` | `uploads` | File upload directory |
| `MAX_FILE_SIZE` | `10485760` | Max file size (10MB) |

### Step 4: Update Google OAuth Callback URL

After deployment, update your Google OAuth credentials:

1. Go to Google Cloud Console → Credentials
2. Edit your OAuth 2.0 Client ID
3. Add the authorized redirect URI:
   - `https://your-app-name.onrender.com/auth/google/callback`
4. Save changes

### Step 5: Access Your Application

Your application will be available at:
- **Landing Page**: `https://your-app-name.onrender.com/`
- **Chat Interface**: `https://your-app-name.onrender.com/app`

---

## 🛠️ Local Development

### Setup

1. Clone the repository:
   ```bash
   git clone <your-repo-url>
   cd AI-CHATBOT-BASELINE
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env` file (copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```

4. Configure local database (MySQL):
   - Install XAMPP or MySQL server
   - Create database: `crimson_ai`
   - Import schema: `sql_20260221_38050f.sql`

5. Update `.env` with your values:
   ```env
   NODE_ENV=development
   PORT=3000
   
   # Local MySQL
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=crimson_ai
   
   # Google OAuth
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
   
   CLIENT_URL=http://localhost:3000
   SESSION_SECRET=your-local-secret
   ```

6. Start the server:
   ```bash
   npm start
   ```

7. Open browser: `http://localhost:3000`

---

## 📦 Features

- ✅ Multi-AI Provider Support (OpenAI, Grok, Gemini, Claude, etc.)
- ✅ Google OAuth Authentication
- ✅ Persistent Chat History
- ✅ File Upload Support
- ✅ Custom API Configuration
- ✅ Streaming Responses
- ✅ PostgreSQL Database (Production)
- ✅ MySQL Database (Local Development)

---

## 🔧 Tech Stack

- **Backend**: Node.js + Express
- **Database**: PostgreSQL (Render) / MySQL (Local)
- **ORM**: Sequelize
- **Authentication**: Passport.js + Google OAuth
- **File Uploads**: Multer
- **Session Management**: Express Session

---

## 📝 Important Notes

### Database Compatibility

- **Production (Render)**: Uses PostgreSQL
- **Local Development**: Uses MySQL (via XAMPP)
- The application automatically detects the database type via `DATABASE_URL` environment variable

### File Uploads

- On Render's free tier, uploaded files are stored in ephemeral storage
- Files will be deleted when the service restarts
- For persistent file storage, consider using:
  - Render Disks (Paid plans)
  - AWS S3
  - Cloudinary
  - Other cloud storage services

### Session Management

- Sessions are stored in memory by default
- For production with multiple instances, consider using:
  - Redis session store
  - Database session store
  - Render's Redis service

---

## 🐛 Troubleshooting

### Database Connection Issues

1. Check environment variables in Render dashboard
2. Verify `DATABASE_URL` is properly set
3. Check database service is running

### Google OAuth Errors

1. Verify callback URL matches exactly in Google Console
2. Check `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
3. Ensure OAuth consent screen is configured

### Application Not Starting

1. Check build logs in Render dashboard
2. Verify all required dependencies are in `package.json`
3. Check Node.js version compatibility (requires ≥18.0.0)

---

## 📄 License

ISC

---

## 🤝 Support

For issues or questions:
1. Check Render logs: Dashboard → Your Service → Logs
2. Review environment variables configuration
3. Verify database connection string

---

**Deployed with ❤️ on Render**
