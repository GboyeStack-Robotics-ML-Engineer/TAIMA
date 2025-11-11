const { app, BrowserWindow, globalShortcut, desktopCapturer, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');



let chatWindow = null;
let overlayWindow = null;
let regionSelectorWindow = null;
let capturedScreenshot = null;
let regionSelectionMode = false;
let previousChatBounds = null;
let isMaximizingWindow = false;
let isRestoringWindow = false;
let googleAuthWindow = null;
const API_URL = process.env.API_URL || 'http://localhost:3001';

function createOverlayWindow() {
  const displays = screen.getPrimaryDisplay();
  const { width, height } = displays.size;

  overlayWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.show();
}

function createChatWindow() {
  const displays = screen.getPrimaryDisplay();
  const { width, height } = displays.size;
  
  // Center the chat window
  const chatWidth = 480;
  const chatHeight = 640;
  const x = Math.floor((width - chatWidth) / 2);
  const y = Math.floor((height - chatHeight) / 2);

  chatWindow = new BrowserWindow({
    width: chatWidth,
    height: chatHeight,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true, // Changed to true for resizing
    minWidth: 400,
    minHeight: 500,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  chatWindow.loadFile(path.join(__dirname, 'renderer', 'chat.html'));

  previousChatBounds = { ...chatWindow.getBounds() };

  chatWindow.on('maximize', () => {
    if (chatWindow && typeof chatWindow.getNormalBounds === 'function') {
      const normalBounds = chatWindow.getNormalBounds();
      if (normalBounds && typeof normalBounds.width === 'number' && typeof normalBounds.height === 'number') {
        previousChatBounds = { ...normalBounds };
      }
    }
    isMaximizingWindow = false;
    if (chatWindow && chatWindow.webContents) {
      chatWindow.webContents.send('window-state-changed', { maximized: true });
    }
  });

  chatWindow.on('unmaximize', () => {
    if (chatWindow && previousChatBounds) {
      chatWindow.setBounds(previousChatBounds);
    }
    if (chatWindow) {
      previousChatBounds = { ...chatWindow.getBounds() };
    }
    isRestoringWindow = false;
    if (chatWindow && chatWindow.webContents) {
      chatWindow.webContents.send('window-state-changed', { maximized: false });
    }
  });

  const cacheBounds = () => {
    if (!chatWindow) return;
    if (isMaximizingWindow || isRestoringWindow) {
      return;
    }
    if (!chatWindow.isMaximized() && !chatWindow.isMinimized()) {
      previousChatBounds = { ...chatWindow.getBounds() };
    }
  };

  chatWindow.on('move', cacheBounds);
  chatWindow.on('resize', cacheBounds);
  
  // Make sure window is transparent and shows properly
  chatWindow.once('ready-to-show', () => {
    chatWindow.show();
    chatWindow.focus();
  });

  // Send captured screenshot to chat window
  if (capturedScreenshot) {
    chatWindow.webContents.once('did-finish-load', () => {
      chatWindow.webContents.send('screenshot-captured', capturedScreenshot);
    });
  }

  // Close both windows when chat window closes
  chatWindow.on('closed', () => {
    chatWindow = null;
    previousChatBounds = null;
    if (overlayWindow) {
      overlayWindow.close();
      overlayWindow = null;
    }
    if (regionSelectorWindow) {
      regionSelectorWindow.close();
      regionSelectorWindow = null;
    }
    if (googleAuthWindow) {
      googleAuthWindow.close();
      googleAuthWindow = null;
    }
    regionSelectionMode = false;
  });
}

function createRegionSelectorWindow() {
  const displays = screen.getPrimaryDisplay();
  const { width, height } = displays.size;

  regionSelectorWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  regionSelectorWindow.loadFile(path.join(__dirname, 'renderer', 'region-selector.html'));
  regionSelectorWindow.setIgnoreMouseEvents(false);
  regionSelectorWindow.show();
  regionSelectorWindow.focus();

  regionSelectorWindow.on('closed', () => {
    regionSelectorWindow = null;
    regionSelectionMode = false;
    if (chatWindow) {
      chatWindow.focus();
    }
  });
}

async function captureRegion(region) {
  const displays = screen.getAllDisplays();
  const primaryDisplay = displays[0];
  const { width, height } = primaryDisplay.size;
  
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  });

  if (sources.length === 0) {
    throw new Error('No screen sources available');
  }

  const primarySource = sources.find(source => {
    return source.display_id === primaryDisplay.id.toString() || 
           source.name.includes('Screen') ||
           source.id.includes('screen');
  }) || sources[0];
  
  // Get the full screen image as PNG buffer
  const fullImageBuffer = primarySource.thumbnail.toPNG();
  const fullImage = nativeImage.createFromBuffer(fullImageBuffer);
  
  // Crop to selected region
  const cropOptions = {
    x: Math.max(0, Math.floor(region.x)),
    y: Math.max(0, Math.floor(region.y)),
    width: Math.min(Math.floor(region.width), width - Math.floor(region.x)),
    height: Math.min(Math.floor(region.height), height - Math.floor(region.y))
  };

  const croppedImage = fullImage.crop(cropOptions);
  const base64Image = croppedImage.toPNG().toString('base64');

  return {
    image: base64Image,
    width: cropOptions.width,
    height: cropOptions.height,
    displayId: primaryDisplay.id,
    region: cropOptions,
    focus: 'custom-area',
    capturedAt: Date.now()
  };
}

function closeChat() {
  if (chatWindow) {
    chatWindow.close();
    chatWindow = null;
  }
  previousChatBounds = null;
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
  if (regionSelectorWindow) {
    regionSelectorWindow.close();
    regionSelectorWindow = null;
  }
  regionSelectionMode = false;
  capturedScreenshot = null;
}

async function captureScreen() {
  const displays = screen.getAllDisplays();
  const primaryDisplay = displays[0];
  const { width, height } = primaryDisplay.size;
  
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  });

  if (sources.length === 0) {
    throw new Error('No screen sources available');
  }

  const primarySource = sources.find(source => {
    return source.display_id === primaryDisplay.id.toString() || 
           source.name.includes('Screen') ||
           source.id.includes('screen');
  }) || sources[0];
  
  const image = primarySource.thumbnail.toPNG();
  const base64Image = image.toString('base64');

  return {
    image: base64Image,
    width,
    height,
    displayId: primaryDisplay.id,
    focus: 'entire-screen',
    capturedAt: Date.now()
  };
}

async function captureActiveWindow() {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 1920, height: 1080 },
    fetchWindowIcons: true
  });

  if (sources.length === 0) {
    throw new Error('No window sources available');
  }

  const filteredSources = sources.filter((source) => {
    const name = (source.name || '').toLowerCase();
    return name && !name.includes('overlay') && !name.includes('electron') && !name.includes('taima');
  });

  const targetSource = filteredSources[0] || sources[0];
  const imageBuffer = targetSource.thumbnail.toPNG();
  const base64Image = imageBuffer.toString('base64');
  const { width, height } = targetSource.thumbnail.getSize();

  return {
    image: base64Image,
    width,
    height,
    windowId: targetSource.id,
    windowName: targetSource.name,
    focus: 'active-window',
    capturedAt: Date.now()
  };
}

function registerGlobalShortcut() {
  const ret = globalShortcut.register('CommandOrControl+M', async () => {
    console.log('Ctrl+M pressed - opening chat');
    
    try {
      // Close existing chat if open
      if (chatWindow) {
        closeChat();
        return;
      }

      // Capture screen first
  capturedScreenshot = await captureScreen();
      
      // Create overlay (blurred background)
      // createOverlayWindow();
      
      // Create chat window
      setTimeout(() => {
        createChatWindow();
      }, 100);
      
    } catch (error) {
      console.error('Error opening chat:', error);
      closeChat();
    }
  });

  if (!ret) {
    console.log('Failed to register global shortcut');
  } else {
    console.log('Global shortcut Ctrl+M registered successfully');
  }
}

app.whenReady().then(() => {
  // Register global shortcut after app is ready
  setTimeout(() => {
    registerGlobalShortcut();
  }, 1000);

  app.on('activate', () => {
    // Handle macOS dock icon click
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers
ipcMain.handle('close-chat', () => {
  closeChat();
});

// New handler for closing the app
ipcMain.on('close-app', () => {
  app.quit();
});

ipcMain.on('minimize-window', () => {
  if (chatWindow) {
    chatWindow.minimize();
  }
});

ipcMain.handle('toggle-maximize', () => {
  if (!chatWindow) {
    return false;
  }

  if (chatWindow.isMaximized()) {
    isRestoringWindow = true;
    chatWindow.unmaximize();
    return false;
  }

  previousChatBounds = { ...chatWindow.getBounds() };
  isMaximizingWindow = true;
  chatWindow.maximize();
  return true;
});

ipcMain.handle('get-window-state', () => {
  return chatWindow ? chatWindow.isMaximized() : false;
});

ipcMain.handle('get-api-url', () => {
  return API_URL;
});

ipcMain.handle('get-screenshot', () => {
  return capturedScreenshot;
});

ipcMain.handle('capture-entire-screen', async () => {
  const screenshot = await captureScreen();
  capturedScreenshot = screenshot;
  if (chatWindow) {
    chatWindow.webContents.send('screenshot-captured', screenshot);
  }
  return screenshot;
});

ipcMain.handle('capture-active-window', async () => {
  const screenshot = await captureActiveWindow();
  capturedScreenshot = screenshot;
  if (chatWindow) {
    chatWindow.webContents.send('screenshot-captured', screenshot);
  }
  return screenshot;
});

ipcMain.handle('start-google-auth', async () => {
  if (googleAuthWindow && !googleAuthWindow.isDestroyed()) {
    googleAuthWindow.focus();
    return true;
  }

  const authUrl = `${API_URL}/auth/google`;

  googleAuthWindow = new BrowserWindow({
    width: 520,
    height: 700,
    resizable: true,
    parent: chatWindow || undefined,
    modal: false,
    title: 'Connect Google Account',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  googleAuthWindow.removeMenu?.();

  try {
    await googleAuthWindow.loadURL(authUrl);
  } catch (error) {
    console.error('Failed to load Google auth URL:', error);
    googleAuthWindow.close();
    googleAuthWindow = null;
    return false;
  }

  googleAuthWindow.on('closed', () => {
    googleAuthWindow = null;
    if (chatWindow) {
      chatWindow.webContents.send('google-auth-closed');
    }
  });

  return true;
});

ipcMain.handle('start-region-selection', () => {
  if (!regionSelectionMode && chatWindow) {
    regionSelectionMode = true;
    createRegionSelectorWindow();
  }
});

ipcMain.handle('cancel-region-selection', () => {
  if (regionSelectorWindow) {
    regionSelectorWindow.close();
    regionSelectorWindow = null;
    regionSelectionMode = false;
    if (chatWindow) {
      chatWindow.focus();
    }
  }
});

// Handle region selection from renderer
ipcMain.on('select-region', async (event, region) => {
  try {
    const screenshot = await captureRegion(region);
    capturedScreenshot = screenshot;
    if (chatWindow) {
      chatWindow.webContents.send('screenshot-captured', screenshot);
    }
    if (regionSelectorWindow) {
      regionSelectorWindow.close();
      regionSelectorWindow = null;
    }
    regionSelectionMode = false;
    if (chatWindow) {
      chatWindow.focus();
    }
  } catch (error) {
    console.error('Error capturing region:', error);
    if (chatWindow) {
      chatWindow.webContents.send('error', 'Failed to capture region');
    }
  }
});