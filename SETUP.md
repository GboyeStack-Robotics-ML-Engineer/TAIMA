# Quick Setup Guide

## Step 1: Install Dependencies

```bash
npm run install:all
```

This installs dependencies for both the main app and the backend.

## Step 2: Get Gemini API Key

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the API key

## Step 3: Configure Google Calendar (Optional but Recommended)

### Option A: Quick Setup (OAuth Flow)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable "Google Calendar API"
4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
5. Choose "Desktop app" as application type
6. Download the credentials or copy Client ID and Client Secret

### Option B: Use Existing Credentials

If you already have OAuth credentials, skip to Step 4.

## Step 4: Create Environment File

1. Copy `backend/env.example` to `backend/.env`
2. Fill in your credentials:

```env
GEMINI_API_KEY=your_actual_api_key_here
GEMINI_MODEL=gemini-1.5-flash

GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/callback
```

## Step 5: Configure Redirect URI in Google Cloud Console

**IMPORTANT:** Before starting the OAuth flow, you must add the redirect URI to your Google Cloud project:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Go to **APIs & Services** → **Credentials**
4. Click on your OAuth 2.0 Client ID
5. Under **Authorized redirect URIs**, click **Add URI**
6. Add: `http://localhost:3001/auth/callback`
7. Click **Save**

## Step 6: Get Google Refresh Token

### Important: Revoke Existing Access First (if already authorized)

If you've already authorized this app before, Google won't provide a refresh token. You need to revoke access first:

1. Go to [Google Account Permissions](https://myaccount.google.com/permissions)
2. Find your app (or "Solid Coder" / your project name)
3. Click **Remove Access** or **Revoke**

### Now Get the Refresh Token:
s
1. Start the backend server:
   ```bash
   cd backend
   npm start
   ```

2. Open your browser and visit:
   ```
   http://localhost:3001/auth/google
   ```

3. **Important:** Make sure you see the consent screen asking for permission. If you're automatically signed in without seeing a consent screen, you won't get a refresh token.

4. Click **Allow** to authorize the application

5. You'll be redirected to a page showing your refresh token in a large, copyable box

6. Click the **📋 Copy Token** button or manually copy the token

7. Add it to `backend/.env`:
   ```env
   GOOGLE_REFRESH_TOKEN=your_refresh_token_here
   ```

8. Restart the backend server

### Troubleshooting: No Refresh Token Shown

If you don't see a refresh token:

1. **Check the redirect URI:** Make sure `http://localhost:3001/auth/callback` is added to authorized redirect URIs in Google Cloud Console
2. **Revoke and retry:** Go to [Google Account Permissions](https://myaccount.google.com/permissions) and revoke access, then try again
3. **Check console logs:** The backend server will log whether a refresh token was received
4. **Use the JSON file method:** You can also use your JSON credentials file by setting `GOOGLE_CREDENTIALS_PATH` in `.env`

## Step 7: Run the Application

### Development Mode (Recommended)
```bash
npm run dev
```

This starts both the backend and frontend automatically.

### Production Mode
Terminal 1:
```bash
cd backend
npm start
```

Terminal 2:
```bash
npm start
```

## Step 8: Test It!

1. The app should be running in the background
2. Open any document or webpage with a task/appointment
3. Press `Ctrl+M` (or `Cmd+M` on Mac)
4. The app will capture your screen, analyze it, and create a calendar event!

## Troubleshooting

### "Hotkey not working"
- Make sure the Electron app is running
- Check if another app is using Ctrl+M
- Try restarting the app

### "Calendar not configured" warning
- This is okay if you only want to test the AI analysis
- Calendar events won't be created, but the AI will still analyze screenshots

### "Failed to parse task information"
- Make sure your screenshot contains clear text
- Try with a screenshot that has obvious dates/times
- Check that your Gemini API key is valid

### Backend won't start
- Make sure port 3001 is not in use
- Check that all dependencies are installed: `cd backend && npm install`
- Verify your `.env` file exists in the `backend/` directory

