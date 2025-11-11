const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const googleAuth = require('./googleAuth');
const googleServices = require('./googleServices');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Preload Google tokens if they exist
googleAuth.ensureTokensLoaded().catch(() => {});

const pendingAuthStates = new Map();
const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const ACTION_INSTRUCTIONS = `You are TAIMA, an AI agent that can both converse naturally and perform actions with Google Calendar and Gmail on the user's behalf.

When the user asks you to do something that requires calendar or email access (such as scheduling, updating, or cancelling events; sending or replying to emails; checking availability or recent messages), you MUST:
1. Provide a clear natural-language response that explains what you are doing.
2. Append an <actions> block on separate lines after your response. Inside the block, include one JSON object per line describing the action to execute.

Each JSON object must include:
- "type": one of "calendar.create", "calendar.update", "calendar.delete", "calendar.list", "gmail.send", "gmail.reply", "gmail.list".
- "payload": an object with all data needed for the action. Use ISO 8601 timestamps with time zones for calendar fields (e.g., "2025-11-12T15:00:00-05:00").

Example:
<actions>
{"type":"calendar.create","payload":{"summary":"Design sync","start":"2025-11-12T15:00:00-05:00","end":"2025-11-12T15:30:00-05:00","timeZone":"America/New_York","attendees":["teammate@example.com"]}}
</actions>

Only include the <actions> block when an action is required. Otherwise omit it.`;

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/auth/google', (req, res) => {
  try {
    cleanupPendingStates();
    const oauth2Client = googleAuth.getOAuthClient();
    const state = crypto.randomUUID();
    pendingAuthStates.set(state, Date.now());

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: googleAuth.SCOPES,
      include_granted_scopes: true,
      state
    });

    res.redirect(authUrl);
  } catch (error) {
    console.error('Error initiating Google auth:', error);
    res.status(500).send('Failed to start Google authentication flow.');
  }
});

app.get('/auth/callback', (req, res) => {
  const params = new URLSearchParams(req.query).toString();
  const target = `/auth/google/callback${params ? `?${params}` : ''}`;
  res.redirect(target);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state || !pendingAuthStates.has(state)) {
      return res.status(400).send('Invalid or expired authentication attempt.');
    }

    pendingAuthStates.delete(state);

    const oauth2Client = googleAuth.getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    await googleAuth.storeTokens(tokens);

    res.send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Google account connected</title>
    <style>
      body { font-family: Arial, sans-serif; background: #0b1022; color: #e5ecff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
      .card { background: rgba(19, 27, 52, 0.9); padding: 32px 40px; border-radius: 18px; box-shadow: 0 18px 48px rgba(3, 7, 20, 0.45); text-align: center; }
      .card h1 { font-size: 20px; margin-bottom: 12px; }
      .card p { margin: 0; font-size: 14px; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Google account linked</h1>
      <p>You can close this window. TAIMA is now connected to your calendar and Gmail.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 1200);
    </script>
  </body>
</html>`);
  } catch (error) {
    console.error('Error completing Google auth:', error);
    res.status(500).send('Failed to complete Google authentication.');
  }
});

app.get('/api/google/status', async (req, res) => {
  try {
    await googleAuth.ensureTokensLoaded();
    const connected = googleAuth.isConnected();
    let profile = null;

    if (connected) {
      try {
        profile = await googleServices.getGmailProfile();
      } catch (error) {
        console.warn('Unable to fetch Gmail profile:', error.message);
      }
    }

    res.json({
      connected,
      scopes: googleAuth.getGrantedScopes(),
      profile
    });
  } catch (error) {
    console.error('Error fetching Google status:', error);
    res.status(500).json({ error: 'Failed to retrieve Google account status', message: error.message });
  }
});

app.post('/api/google/disconnect', async (req, res) => {
  try {
    await googleAuth.clearTokens();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disconnect Google account', message: error.message });
  }
});

app.get('/api/calendar/events', async (req, res) => {
  if (!(await ensureGoogleConnection(res))) {
    return;
  }

  try {
    const events = await googleServices.listUpcomingEvents({
      calendarId: req.query.calendarId,
      maxResults: Number(req.query.maxResults) || 10,
      timeMin: req.query.timeMin,
      timeMax: req.query.timeMax,
      query: req.query.query
    });

    res.json({ success: true, events });
  } catch (error) {
    console.error('Error listing calendar events:', error);
    res.status(500).json({ error: 'Failed to list calendar events', message: error.message });
  }
});

app.post('/api/calendar/events', async (req, res) => {
  if (!(await ensureGoogleConnection(res))) {
    return;
  }

  try {
    const event = await googleServices.createCalendarEvent(req.body, {
      calendarId: req.body.calendarId
    });
    res.json({ success: true, event });
  } catch (error) {
    console.error('Error creating calendar event:', error);
    res.status(500).json({ error: 'Failed to create calendar event', message: error.message });
  }
});

app.patch('/api/calendar/events/:id', async (req, res) => {
  if (!(await ensureGoogleConnection(res))) {
    return;
  }

  try {
    const event = await googleServices.updateCalendarEvent(req.params.id, req.body, {
      calendarId: req.body.calendarId
    });
    res.json({ success: true, event });
  } catch (error) {
    console.error('Error updating calendar event:', error);
    res.status(500).json({ error: 'Failed to update calendar event', message: error.message });
  }
});

app.delete('/api/calendar/events/:id', async (req, res) => {
  if (!(await ensureGoogleConnection(res))) {
    return;
  }

  try {
    await googleServices.deleteCalendarEvent(req.params.id, {
      calendarId: req.query.calendarId
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    res.status(500).json({ error: 'Failed to delete calendar event', message: error.message });
  }
});

app.get('/api/gmail/messages', async (req, res) => {
  if (!(await ensureGoogleConnection(res))) {
    return;
  }

  try {
    const messages = await googleServices.listGmailMessages({
      labelIds: req.query.labelIds ? req.query.labelIds.split(',') : undefined,
      maxResults: Number(req.query.maxResults) || 10,
      query: req.query.query
    });
    res.json({ success: true, messages });
  } catch (error) {
    console.error('Error listing Gmail messages:', error);
    res.status(500).json({ error: 'Failed to list Gmail messages', message: error.message });
  }
});

app.post('/api/gmail/send', async (req, res) => {
  if (!(await ensureGoogleConnection(res))) {
    return;
  }

  try {
    const message = await googleServices.sendEmail(req.body);
    res.json({ success: true, message });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Failed to send email', message: error.message });
  }
});

app.post('/api/gmail/reply', async (req, res) => {
  if (!(await ensureGoogleConnection(res))) {
    return;
  }

  try {
    const message = await googleServices.replyToEmail(req.body);
    res.json({ success: true, message });
  } catch (error) {
    console.error('Error replying to email:', error);
    res.status(500).json({ error: 'Failed to reply to email', message: error.message });
  }
});

// Chat endpoint with optional image
app.post('/api/chat', async (req, res) => {
  try {
    const { message, image, screenMetadata, conversationHistory = [] } = req.body;

    if (!message && !image) {
      return res.status(400).json({ error: 'No message or image provided' });
    }

    console.log('Processing chat request...');

    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-pro'
    });

    const history = conversationHistory.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const parts = [{ text: ACTION_INSTRUCTIONS }];

    if (message) {
      parts.push({ text: message });
    }

    if (image) {
      const metaDetails = [];

      if (screenMetadata?.focus) {
        metaDetails.push(`Focus: ${screenMetadata.focus}`);
      }

      if (screenMetadata?.windowName) {
        metaDetails.push(`Window: ${screenMetadata.windowName}`);
      }

      if (screenMetadata?.width && screenMetadata?.height) {
        metaDetails.push(`Resolution: ${screenMetadata.width}x${screenMetadata.height}`);
      }

      if (screenMetadata?.capturedAt) {
        const capturedAtIso = new Date(screenMetadata.capturedAt).toISOString();
        metaDetails.push(`Captured at: ${capturedAtIso}`);
      }

      if (screenMetadata?.displayId) {
        metaDetails.push(`Display ID: ${screenMetadata.displayId}`);
      }

      const metaText = metaDetails.join(' | ');

      if (metaText) {
        parts.push({ text: metaText });
      }

      parts.push({
        inlineData: {
          data: image,
          mimeType: 'image/png'
        }
      });
    }

    let chat;
    if (history.length > 0) {
      chat = model.startChat({ history });
    } else {
      chat = model.startChat({});
    }

    const result = await chat.sendMessage(parts);
    const response = await result.response;
    const rawText = response.text();

    console.log('Gemini response received');

    const { cleanedText, actions } = extractActions(rawText);
    const actionOutputs = await executeAssistantActions(actions);

    const finalResponse = [cleanedText.trim(), actionOutputs.join('\n')]
      .filter(Boolean)
      .join('\n\n');

    res.json({
      success: true,
      response: finalResponse,
      timestamp: new Date().toISOString(),
      actionsExecuted: actionOutputs.length
    });
  } catch (error) {
    console.error('Error processing chat:', error);
    res.status(500).json({
      error: 'Failed to process chat request',
      message: error.message
    });
  }
});

function cleanupPendingStates() {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [state, createdAt] of pendingAuthStates.entries()) {
    if (createdAt < cutoff) {
      pendingAuthStates.delete(state);
    }
  }
}

async function ensureGoogleConnection(res) {
  try {
    await googleAuth.ensureTokensLoaded();
    await googleAuth.getAuthorizedClient();
    return true;
  } catch (error) {
    if (error.code === 'GOOGLE_AUTH_MISSING') {
      res.status(401).json({ error: 'Google account not connected' });
      return false;
    }

    console.error('Google API error:', error);
    res.status(500).json({ error: 'Google integration error', message: error.message });
    return false;
  }
}

function extractActions(rawText) {
  if (!rawText) {
    return { cleanedText: '', actions: [] };
  }

  const match = rawText.match(/<actions>([\s\S]*?)<\/actions>/i);
  if (!match) {
    return { cleanedText: rawText, actions: [] };
  }

  const block = match[0];
  const inner = match[1];
  const cleanedText = rawText.replace(block, '').trim();

  const lines = inner
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const actions = lines
    .map((line) => {
      const parsed = attemptJsonParse(line);
      if (parsed && parsed.type) {
        return parsed;
      }
      return null;
    })
    .filter(Boolean);

  return { cleanedText, actions };
}

async function executeAssistantActions(actions = []) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return [];
  }

  const outputs = [];

  for (const action of actions) {
    if (!action || !action.type) {
      continue;
    }

    try {
      const summary = await routeAssistantAction(action.type, action.payload || {});
      if (summary) {
        outputs.push(`✅ ${summary}`);
      }
    } catch (error) {
      if (error.code === 'GOOGLE_AUTH_MISSING') {
        outputs.push('⚠️ Google account is not connected. Please connect your account to complete this action.');
        break;
      }
      console.error('Assistant action failed:', error);
      outputs.push(`⚠️ Failed to complete ${action.type}: ${error.message}`);
    }
  }

  return outputs;
}

async function routeAssistantAction(type, payload = {}) {
  switch (type) {
    case 'calendar.create': {
      const event = await googleServices.createCalendarEvent(payload, { calendarId: payload.calendarId });
      return `Created calendar event “${event.summary || 'Untitled event'}” for ${formatEventRange(event)}.`;
    }
    case 'calendar.update': {
      const eventId = payload.eventId || payload.id;
      if (!eventId) {
        throw new Error('calendar.update requires an eventId.');
      }
      const event = await googleServices.updateCalendarEvent(eventId, payload, { calendarId: payload.calendarId });
      return `Updated calendar event “${event.summary || 'Untitled event'}” (${formatEventRange(event)}).`;
    }
    case 'calendar.delete': {
      const eventId = payload.eventId || payload.id;
      if (!eventId) {
        throw new Error('calendar.delete requires an eventId.');
      }
      await googleServices.deleteCalendarEvent(eventId, { calendarId: payload.calendarId });
      return `Deleted calendar event with id ${eventId}.`;
    }
    case 'calendar.list': {
      const events = await googleServices.listUpcomingEvents(payload);
      if (!events.length) {
        return 'No upcoming events found for the requested range.';
      }
      const preview = events.slice(0, 5).map((event) => `• ${event.summary || 'Untitled event'} — ${formatEventRange(event)}`);
      return `Upcoming events:\n${preview.join('\n')}`;
    }
    case 'gmail.send': {
      await googleServices.sendEmail(payload);
      const recipients = Array.isArray(payload.to) ? payload.to.join(', ') : payload.to;
      return `Sent email${recipients ? ` to ${recipients}` : ''}${payload.subject ? ` with subject “${payload.subject}”` : ''}.`;
    }
    case 'gmail.reply': {
      await googleServices.replyToEmail(payload);
      return 'Sent reply email as requested.';
    }
    case 'gmail.list': {
      const messages = await googleServices.listGmailMessages(payload);
      if (!messages.length) {
        return 'No matching emails found.';
      }
      const preview = messages.slice(0, 5).map((message) => {
        const subject = message.headers?.subject || 'No subject';
        const from = message.headers?.from || 'Unknown sender';
        return `• ${subject} — ${from}`;
      });
      return `Recent emails:\n${preview.join('\n')}`;
    }
    default:
      throw new Error(`Unsupported action type: ${type}`);
  }
}

function formatEventRange(event) {
  if (!event) {
    return 'unspecified time';
  }

  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;

  if (start && end) {
    const sameDay = event.start?.date && event.end?.date && event.start.date === event.end.date;
    if (sameDay) {
      return formatDateTime(start);
    }
    return `${formatDateTime(start)} → ${formatDateTime(end)}`;
  }

  if (start) {
    return formatDateTime(start);
  }

  return 'unspecified time';
}

function formatDateTime(value) {
  if (!value) {
    return 'unspecified time';
  }

  if (typeof value === 'string') {
    const hasTime = value.includes('T');
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      const formatter = new Intl.DateTimeFormat(undefined, hasTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
      return formatter.format(date);
    }
  }

  return value;
}

app.post('/api/suggestions', async (req, res) => {
  try {
    const { image, screenMetadata = {} } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: 'No image provided for suggestions' });
    }

    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-pro'
    });

    const contextPieces = [];
    if (screenMetadata.windowName) {
      contextPieces.push(`Active window: ${screenMetadata.windowName}`);
    }
    if (screenMetadata.focus) {
      contextPieces.push(`Focus: ${screenMetadata.focus}`);
    }
    if (screenMetadata.width && screenMetadata.height) {
      contextPieces.push(`Resolution: ${screenMetadata.width}x${screenMetadata.height}`);
    }

    const metaInfo = contextPieces.length ? `Context: ${contextPieces.join(' | ')}` : '';

    const instructions = `You are a proactive assistant that recommends helpful next steps based on the user's current screen.
Return a JSON array (max 6 items) where each item has:
- "label": short button text (max 60 chars)
- "prompt": full command we should send to the assistant (max 140 chars)

The JSON must contain nothing else—no markdown, explanation, or prose. If you cannot see anything useful, return an empty array [].
Focus on actionable, distinct ideas related to the visible content. Avoid repeating the user's last request.`;

    const promptParts = [{ text: instructions }];
    if (metaInfo) {
      promptParts.push({ text: metaInfo });
    }
    promptParts.push({
      inlineData: {
        data: image,
        mimeType: 'image/png'
      }
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: promptParts }],
      generationConfig: {
        temperature: 0.4,
        topP: 0.95
      }
    });

    const rawText = result?.response?.text?.() || '';
    const suggestions = normaliseSuggestions(rawText);

    res.json({
      success: true,
      suggestions
    });
  } catch (error) {
    console.error('Error generating suggestions:', error);
    res.status(500).json({
      error: 'Failed to generate suggestions',
      message: error.message
    });
  }
});

function normaliseSuggestions(rawText) {
  const maxItems = 6;
  let parsed = [];

  if (typeof rawText === 'string' && rawText.trim()) {
    parsed = attemptJsonParse(rawText.trim());

    if (!Array.isArray(parsed)) {
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsed = attemptJsonParse(jsonMatch[0]);
      }
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((entry, index) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        const value = entry.trim();
        if (!value) return null;
        return {
          id: `suggestion-${index}`,
          label: truncate(value, 60),
          prompt: truncate(value, 140)
        };
      }

      const label = truncate(String(entry.label || entry.title || ''), 60);
      const prompt = truncate(String(entry.prompt || entry.action || entry.text || label), 140);

      if (!label || !prompt) {
        return null;
      }

      return {
        id: entry.id || `suggestion-${index}`,
        label,
        prompt
      };
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function attemptJsonParse(input) {
  try {
    return JSON.parse(input);
  } catch (error) {
    return null;
  }
}

function truncate(value, maxLen) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  if (value.length <= maxLen) {
    return value;
  }
  return value.slice(0, maxLen - 1).trimEnd() + '…';
}

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`🤖 Gemini AI: ${process.env.GEMINI_API_KEY ? 'Ready' : 'Not configured'}`);
});
