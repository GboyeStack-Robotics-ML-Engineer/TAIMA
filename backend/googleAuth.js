const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const TOKENS_PATH = path.join(__dirname, 'google-tokens.json');
const SCOPES = (process.env.GOOGLE_SCOPES || [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send'
].join(' ')).split(/\s+/).filter(Boolean);

let cachedTokens = null;

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/callback';

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth environment variables are missing. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function readTokenFile() {
  if (cachedTokens) {
    return cachedTokens;
  }

  try {
    const raw = await fs.promises.readFile(TOKENS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cachedTokens = parsed;
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeTokenFile(tokens) {
  cachedTokens = tokens;
  await fs.promises.writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2), 'utf8');
}

async function storeTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') {
    throw new Error('Invalid token payload.');
  }

  const current = await readTokenFile();
  const merged = {
    ...(current || {}),
    ...tokens
  };

  await writeTokenFile(merged);
}

async function clearTokens() {
  cachedTokens = null;
  try {
    await fs.promises.unlink(TOKENS_PATH);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function getAuthorizedClient() {
  const tokens = await readTokenFile();
  if (!tokens) {
    const err = new Error('Google account not connected');
    err.code = 'GOOGLE_AUTH_MISSING';
    throw err;
  }

  const client = getOAuthClient();
  client.setCredentials(tokens);
  client.on('tokens', async (newTokens) => {
    try {
      if (newTokens) {
        await storeTokens({
          ...newTokens,
          refresh_token: newTokens.refresh_token || tokens.refresh_token
        });
      }
    } catch (error) {
      console.error('Failed to persist refreshed Google tokens:', error);
    }
  });
  return client;
}

function isConnected() {
  return Boolean(cachedTokens);
}

async function ensureTokensLoaded() {
  await readTokenFile();
  return isConnected();
}

function getGrantedScopes() {
  if (!cachedTokens) {
    return [];
  }
  const scopeField = cachedTokens.scope;
  if (!scopeField) {
    return [];
  }
  if (Array.isArray(scopeField)) {
    return scopeField;
  }
  return String(scopeField).split(/\s+/).filter(Boolean);
}

module.exports = {
  SCOPES,
  getOAuthClient,
  storeTokens,
  clearTokens,
  getAuthorizedClient,
  isConnected,
  ensureTokensLoaded,
  getGrantedScopes
};
