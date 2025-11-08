# AI-Powered Task Management App

An intelligent desktop application that uses AI vision to automatically create calendar tasks from screenshots. Simply press `Ctrl+M` (or `Cmd+M` on Mac) to capture your screen, and the app will analyze it using Google's Gemini AI and automatically create a task in your Google Calendar.

## Features

- 🎯 **Global Hotkey**: Press `Ctrl+M` from anywhere to trigger task creation
- 📸 **Screen Capture**: Automatically captures your screen when triggered
- 🤖 **AI Analysis**: Uses Gemini Vision API to extract task information
- 📅 **Calendar Integration**: Automatically creates events in Google Calendar
- 🎨 **Modern UI**: Clean, minimal interface

## Architecture

- **Frontend**: Electron desktop app with screen capture and global hotkey support
- **Backend**: Node.js/Express API server with Gemini AI and Google Calendar integration

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Google Gemini API key
- Google Cloud Project with Calendar API enabled

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
npm run install:all
```

### 2. Configure Gemini API

1. Get your Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Add it to `backend/.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Configure Google Calendar API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Google Calendar API
4. Create OAuth 2.0 credentials (Desktop app)
5. Download the credentials and add to `backend/.env`:

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/callback
```

6. Get refresh token:
   - Start the backend: `cd backend && npm start`
   - Visit: `http://localhost:3001/auth/google`
   - Authorize and copy the refresh token
   - Add to `.env`: `GOOGLE_REFRESH_TOKEN=your_refresh_token`

### 4. Run the Application

**Development mode:**
```bash
npm run dev
```

**Production mode:**
```bash
# Terminal 1: Start backend
cd backend
npm start

# Terminal 2: Start frontend
npm start
```

## Usage

1. Start the application (it runs in the background)
2. When you see a task or appointment on your screen that you want to schedule:
3. Press `Ctrl+M` (or `Cmd+M` on Mac)
4. The app will:
   - Capture your screen
   - Send it to Gemini AI for analysis
   - Extract task details (title, date, time, description)
   - Create a calendar event automatically

## How It Works

1. **Screen Capture**: When `Ctrl+M` is pressed, the app captures the current screen
2. **AI Analysis**: The screenshot is sent to Gemini Vision API with a prompt to extract task information
3. **Data Extraction**: Gemini analyzes the image and returns structured task data (title, date, time, description)
4. **Calendar Creation**: The backend creates a calendar event using Google Calendar API
5. **Confirmation**: The app shows a success message

## Project Structure

```
ai-task-manager/
├── electron/
│   ├── main.js              # Main Electron process
│   └── renderer/
│       ├── index.html       # UI
│       ├── styles.css       # Styles
│       └── renderer.js      # Renderer process
├── backend/
│   ├── server.js            # Express API server
│   ├── package.json
│   └── .env                 # Backend configuration
├── package.json
└── README.md
```

## Configuration

### Environment Variables

Create `backend/.env` file with:

- `GEMINI_API_KEY`: Your Google Gemini API key
- `GOOGLE_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret
- `GOOGLE_REFRESH_TOKEN`: OAuth refresh token
- `PORT`: Backend server port (default: 3001)
- `TIMEZONE`: Your timezone (default: America/New_York)

## Troubleshooting

### Hotkey not working
- Make sure the app is running
- Check if another application is using `Ctrl+M`
- Try restarting the app

### Calendar events not created
- Verify Google Calendar API credentials
- Check that refresh token is valid
- Ensure Calendar API is enabled in Google Cloud Console

### AI not extracting tasks correctly
- The prompt can be customized in `backend/server.js`
- Make sure screenshots contain clear text and dates
- Check Gemini API key is valid

## Future Enhancements

- [ ] Support for multiple calendar providers
- [ ] Customizable hotkey
- [ ] Task editing before calendar creation
- [ ] History of created tasks
- [ ] Support for recurring events
- [ ] Multi-screen support
- [ ] Task categories and tags

## License

MIT

