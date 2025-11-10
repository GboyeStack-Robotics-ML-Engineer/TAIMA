const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Chat endpoint with optional image
app.post('/api/chat', async (req, res) => {
  try {
    const { message, image, screenMetadata, conversationHistory = [] } = req.body;

    if (!message && !image) {
      return res.status(400).json({ error: 'No message or image provided' });
    }

    console.log('Processing chat request...');

    // Get Gemini model
    const model = genAI.getGenerativeModel({ 
      model: process.env.GEMINI_MODEL || 'gemini-2.5-pro' 
    });

    // Build conversation history
    const history = conversationHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    // Prepare content parts
    const parts = [];
    
    // Add text message if provided
    if (message) {
      parts.push({ text: message });
    }
    
    // Add image if provided
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

      parts.push({
        text: `Attached screenshot for context.${metaText ? ` ${metaText}.` : ''}`
      });

      parts.push({
        inlineData: {
          data: image,
          mimeType: 'image/png'
        }
      });
    }

    // Start chat session if we have history, otherwise start new conversation
    let chat;
    if (history.length > 0) {
      chat = model.startChat({ history });
    } else {
      chat = model.startChat({});
    }

    // Send message
    const result = await chat.sendMessage(parts);
    const response = await result.response;
    const text = response.text();

    console.log('Gemini response received');

    res.json({
      success: true,
      response: text,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error processing chat:', error);
    res.status(500).json({ 
      error: 'Failed to process chat request',
      message: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`🤖 Gemini AI: ${process.env.GEMINI_API_KEY ? 'Ready' : 'Not configured'}`);
});
