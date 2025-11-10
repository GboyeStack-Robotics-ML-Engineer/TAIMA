const { ipcRenderer } = require('electron');

// DOM Elements
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const screenSelectBtn = document.getElementById('screenSelectBtn');
const closeBtn = document.getElementById('closeBtn');
const chatContainer = document.getElementById('chatContainer');
const minimizeBtn = document.getElementById('minimizeBtn');
const maximizeBtn = document.getElementById('maximizeBtn');
const maximizeGlyph = maximizeBtn ? maximizeBtn.querySelector('.traffic-glyph') : null;
const textModeContent = document.getElementById('textModeContent');
const audioModeContent = document.getElementById('audioModeContent');
const textInputContainer = document.getElementById('textInputContainer');
const liveWaveformContainer = document.getElementById('liveWaveformContainer');
const audioWaveform = document.getElementById('audioWaveform');
const listeningIndicator = document.getElementById('listeningIndicator');
const processingIndicator = document.getElementById('processingIndicator');
const speakingIndicator = document.getElementById('speakingIndicator');
const statusMessage = document.getElementById('statusMessage');
const sensitivitySlider = document.getElementById('sensitivitySlider');
const screenSelectionOverlay = document.getElementById('screenSelectionOverlay');
const cancelSelection = document.getElementById('cancelSelection');
const confirmSelection = document.getElementById('confirmSelection');
const backToTextBtn = document.getElementById('backToTextBtn');


// State
let isProcessing = false;
let isAudioMode = false;
let isWindowMaximized = false;
let isListening = false;
let isSpeaking = false;
let silenceTimeout = null;
let windowPosition = { x: 0, y: 0 };
let isMinimizing = false;

// Audio Context and Analyser
let audioContext = null;
let analyser = null;
let microphone = null;
let mediaRecorder = null;
let audioChunks = [];
let animationId = null;
let dataArray = null;
let bufferLength = null;
let voiceActivityDetector = null;
let sensitivity = 0.5;
let aiProcessingTimeout = null;
let aiSpeakingTimeout = null;
let conversationHistory = [];
let apiBaseUrl = null;

function updateSendButtonState() {
    const hasText = messageInput.value.trim().length > 0;
    if (hasText) {
        sendBtn.classList.add('mic-mode');
        sendBtn.querySelector('.send-icon').textContent = '🎤';
        sendBtn.title = 'Switch to Voice Mode';
    } else {
        sendBtn.classList.remove('mic-mode');
        sendBtn.querySelector('.send-icon').textContent = '↑';
        sendBtn.title = 'Send Message';
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupWindowMovement();
    loadWindowPosition();
    setupScreenSelection();
    setupInputBehavior();
    setupCloseButton();
    setupMinimizeButton();
    setupWindowResizing();
    initializeWindowStateSync();
    initializeApiConfig();

    // Add back to text button event listener
    if (backToTextBtn) {
        backToTextBtn.addEventListener('click', () => {
            if (isAudioMode) {
                toggleAudioMode();
            }
        });
    }
    
    
    // Add welcome message
    setTimeout(() => {
        addMessage('assistant', 'Hello! I\'m TAIMA, ready to assist you. Speak naturally or type your requests.');
    }, 1000);
    
    // Focus input
    messageInput.focus();
    updateSendButtonState();
});

// Close Button Functionality
function setupCloseButton() {
    closeBtn.addEventListener('click', () => {
        ipcRenderer.send('close-app');
    });
}

// Input Behavior
function setupInputBehavior() {
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 80) + 'px';
        
        updateSendButtonState();
    });
    
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendBtn.addEventListener('click', () => {
        const hasText = messageInput.value.trim().length > 0;
        if (hasText) {
            toggleAudioMode();
        } else {
            sendMessage();
        }
    });

    // Sensitivity slider
    sensitivitySlider.addEventListener('input', (e) => {
        sensitivity = parseFloat(e.target.value);
        statusMessage.textContent = `Voice sensitivity: ${Math.round(sensitivity * 100)}%`;
        setTimeout(() => {
            statusMessage.textContent = 'Voice mode active - Start speaking naturally';
        }, 2000);
    });
}

// Window Controls
function setupWindowResizing() {
    if (!maximizeBtn) return;
    maximizeBtn.addEventListener('click', toggleWindowSize);
}

async function toggleWindowSize() {
    if (!ipcRenderer) return;
    try {
        const maximized = await ipcRenderer.invoke('toggle-maximize');
        updateMaximizeVisualState(Boolean(maximized));
    } catch (error) {
        console.error('Error toggling maximize state:', error);
    }
}

function setupMinimizeButton() {
    if (!minimizeBtn) return;
    minimizeBtn.addEventListener('click', () => {
        ipcRenderer.send('minimize-window');
    });
}

function initializeWindowStateSync() {
    if (!ipcRenderer) return;

    ipcRenderer.invoke('get-window-state')
        .then((state) => updateMaximizeVisualState(Boolean(state)))
        .catch((error) => console.error('Error fetching window state:', error));

    ipcRenderer.on('window-state-changed', (_, state) => {
        updateMaximizeVisualState(Boolean(state && state.maximized));
    });
}

async function initializeApiConfig() {
    if (apiBaseUrl) {
        return apiBaseUrl;
    }

    try {
        if (ipcRenderer) {
            const resolvedUrl = await ipcRenderer.invoke('get-api-url');
            if (resolvedUrl && typeof resolvedUrl === 'string') {
                apiBaseUrl = resolvedUrl.replace(/\/$/, '');
                return apiBaseUrl;
            }
        }
    } catch (error) {
        console.error('Error resolving API URL:', error);
    }

    apiBaseUrl = 'http://localhost:3001';
    return apiBaseUrl;
}

function updateMaximizeVisualState(maximized) {
    isWindowMaximized = maximized;
    if (!maximizeBtn) return;
    maximizeBtn.classList.toggle('is-maximized', maximized);
    if (maximizeGlyph) {
        maximizeGlyph.textContent = maximized ? '↘' : '+';
    }
    maximizeBtn.title = maximized ? 'Restore' : 'Maximize';
}

// Enhanced Audio Mode with Automatic Voice Detection
function toggleAudioMode() {

    isAudioMode = !isAudioMode;

    if (isAudioMode) {
        // Switch to audio mode
        textModeContent.classList.add('hidden');
        audioModeContent.classList.remove('hidden');
        textInputContainer.classList.add('hidden');
        messageInput.value = '';
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 80) + 'px';
        clearAudioSimulationTimeouts();
        updateSendButtonState();
        
        initializeAudioVisualization();
        initializeAudioContext();
        startAutomaticVoiceDetection();
        
    } else {
        // Switch to text mode
        textModeContent.classList.remove('hidden');
        audioModeContent.classList.add('hidden');
        textInputContainer.classList.remove('hidden');
        
        stopAutomaticVoiceDetection();
        cleanupAudio();
        
        // Reset send button
        updateSendButtonState();

        // Focus back on text input
        messageInput.focus();
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 80) + 'px';
        
    }
}

function initializeAudioContext() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
    } catch (error) {
        console.error('Error initializing audio context:', error);
        addMessage('assistant', '❌ Error initializing audio. Please check microphone permissions.');
    }
}

function initializeAudioVisualization() {
    const canvas = audioWaveform;
    const ctx = canvas.getContext('2d');
    
    const resizeCanvas = () => {
        canvas.width = liveWaveformContainer.clientWidth * 2;
        canvas.height = liveWaveformContainer.clientHeight * 2;
        canvas.style.width = liveWaveformContainer.clientWidth + 'px';
        canvas.style.height = liveWaveformContainer.clientHeight + 'px';
    };
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

async function startAutomaticVoiceDetection() {
    if (!audioContext) {
        initializeAudioContext();
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 44100
            } 
        });
        
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);
        
        // Setup media recorder for voice detection
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = processDetectedSpeech;
        
        // Start continuous recording for VAD
        mediaRecorder.start(1000); // Collect data every second
        
        isListening = true;
        updateAudioUI();
        startAudioVisualization();
        startVoiceActivityDetection();
        
    } catch (error) {
        console.error('Error starting voice detection:', error);
        addMessage('assistant', '❌ Could not access microphone. Please check permissions.');
    }
}

function startVoiceActivityDetection() {
    voiceActivityDetector = setInterval(() => {
        if (!analyser || !isListening) return;
        
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const normalizedVolume = average / 256;
        
        // Voice activity detection based on sensitivity
        if (normalizedVolume > sensitivity * 0.3) {
            // Voice detected
            if (!isProcessing && !isSpeaking) {
                onVoiceDetected();
            }
            clearTimeout(silenceTimeout);
        } else {
            // Silence detected
            if (isListening && !silenceTimeout) {
                silenceTimeout = setTimeout(() => {
                    if (isListening && !isProcessing && !isSpeaking) {
                        onSilenceDetected();
                    }
                    silenceTimeout = null;
                }, 1500);
            }
        }
    }, 100);
}

function onVoiceDetected() {
    statusMessage.textContent = 'Voice detected... Listening';
    // You could change visual feedback here
}

function onSilenceDetected() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
}

function processDetectedSpeech() {
    if (!isAudioMode) {
        audioChunks = [];
        return;
    }
    const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
    
    // Show processing state
    isProcessing = true;
    isListening = false;
    updateAudioUI();
    
    // Simulate AI processing
    clearTimeout(aiProcessingTimeout);
    aiProcessingTimeout = setTimeout(() => {
        simulateAIResponse();
    }, 2000);
    
    // Reset for next recording
    audioChunks = [];
    if (mediaRecorder && isAudioMode) {
        mediaRecorder.start(1000);
    }
}

function simulateAIResponse() {
    if (!isAudioMode) {
        clearAudioSimulationTimeouts();
        return;
    }
    isProcessing = false;
    isSpeaking = true;
    updateAudioUI();
    
    // Simulate AI thinking and responding
    clearTimeout(aiProcessingTimeout);
    aiProcessingTimeout = setTimeout(() => {
        aiProcessingTimeout = null;
        if (!isAudioMode) {
            clearAudioSimulationTimeouts();
            return;
        }
        addMessage('assistant', 'I heard your voice! This is a simulated response. In a real implementation, this would be actual AI-generated speech.');
        
        // Simulate TTS speaking time
        clearTimeout(aiSpeakingTimeout);
        aiSpeakingTimeout = setTimeout(() => {
            aiSpeakingTimeout = null;
            if (!isAudioMode) {
                clearAudioSimulationTimeouts();
                return;
            }
            isSpeaking = false;
            isListening = true;
            updateAudioUI();
            statusMessage.textContent = 'Ready for next command';
        }, 3000);
    }, 1000);
}

function updateAudioUI() {
    // Update status indicators
    listeningIndicator.classList.toggle('hidden', !isListening);
    processingIndicator.classList.toggle('hidden', !isProcessing);
    speakingIndicator.classList.toggle('hidden', !isSpeaking);
    
    // Update status message
    if (isListening) {
        statusMessage.textContent = 'Listening for voice...';
    } else if (isProcessing) {
        statusMessage.textContent = 'Processing your speech...';
    } else if (isSpeaking) {
        statusMessage.textContent = 'Generating response...';
    }
}

function stopAutomaticVoiceDetection() {
    isListening = false;
    isProcessing = false;
    isSpeaking = false;
    clearAudioSimulationTimeouts();
    
    if (voiceActivityDetector) {
        clearInterval(voiceActivityDetector);
        voiceActivityDetector = null;
    }
    
    if (silenceTimeout) {
        clearTimeout(silenceTimeout);
        silenceTimeout = null;
    }
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    
    stopAudioVisualization();
    updateAudioUI();
}

function startAudioVisualization() {
    const canvas = audioWaveform;
    const ctx = canvas.getContext('2d');
    
    function draw() {
        if (!isAudioMode) return;
        
        animationId = requestAnimationFrame(draw);
        
        if (analyser) {
            analyser.getByteTimeDomainData(dataArray);
        } else {
            // Simulate data for demo
            for (let i = 0; i < bufferLength; i++) {
                dataArray[i] = Math.random() * 128 + 128;
            }
        }
        
        // Clear with gradient based on state
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        if (isListening) {
            gradient.addColorStop(0, 'rgba(59, 130, 246, 0.08)');
            gradient.addColorStop(1, 'rgba(59, 130, 246, 0.02)');
        } else if (isProcessing) {
            gradient.addColorStop(0, 'rgba(16, 185, 129, 0.08)');
            gradient.addColorStop(1, 'rgba(16, 185, 129, 0.02)');
        } else if (isSpeaking) {
            gradient.addColorStop(0, 'rgba(139, 92, 246, 0.08)');
            gradient.addColorStop(1, 'rgba(139, 92, 246, 0.02)');
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw waveform
        ctx.lineWidth = 3;
        if (isListening) {
            ctx.strokeStyle = '#3b82f6';
            ctx.shadowColor = '#3b82f6';
        } else if (isProcessing) {
            ctx.strokeStyle = '#10b981';
            ctx.shadowColor = '#10b981';
        } else if (isSpeaking) {
            ctx.strokeStyle = '#8b5cf6';
            ctx.shadowColor = '#8b5cf6';
        }
        ctx.shadowBlur = 12;
        ctx.beginPath();
        
        const sliceWidth = canvas.width * 1.0 / bufferLength;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = v * canvas.height / 2;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            
            x += sliceWidth;
        }
        
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
    
    draw();
}

function stopAudioVisualization() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    
    // Clear canvas
    const canvas = audioWaveform;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function cleanupAudio() {
    stopAutomaticVoiceDetection();
    stopAudioVisualization();
    
    if (microphone) {
        microphone.disconnect();
        microphone = null;
    }
    
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    analyser = null;
}

function clearAudioSimulationTimeouts() {
    if (aiProcessingTimeout) {
        clearTimeout(aiProcessingTimeout);
        aiProcessingTimeout = null;
    }
    if (aiSpeakingTimeout) {
        clearTimeout(aiSpeakingTimeout);
        aiSpeakingTimeout = null;
    }
}
// Screen Selection Functionality
function setupScreenSelection() {
    screenSelectBtn.addEventListener('click', showScreenSelection);
    cancelSelection.addEventListener('click', hideScreenSelection);
    confirmSelection.addEventListener('click', confirmScreenSelection);
    
    document.querySelectorAll('.selection-option').forEach(option => {
        option.addEventListener('click', (e) => {
            document.querySelectorAll('.selection-option').forEach(opt => {
                opt.classList.remove('active');
            });
            e.currentTarget.classList.add('active');
        });
    });
}

function showScreenSelection() {
    screenSelectionOverlay.classList.remove('hidden');
}

function hideScreenSelection() {
    screenSelectionOverlay.classList.add('hidden');
}

function confirmScreenSelection() {
    const selectedOption = document.querySelector('.selection-option.active');
    const selectionType = selectedOption?.dataset.type || 'entire-screen';
    
    hideScreenSelection();
    
    switch (selectionType) {
        case 'entire-screen':
            addMessage('assistant', '🖥️ Focusing on the entire screen');
            break;
        case 'active-window':
            addMessage('assistant', '🪟 Focusing on the active window');
            break;
        case 'custom-area':
            addMessage('assistant', '✏️ Please select a custom area on your screen');
            if (ipcRenderer) {
                ipcRenderer.invoke('start-region-selection');
            }
            break;
    }
}

// Window Movement (existing implementation)
function setupWindowMovement() {
    // ... (keep existing implementation)
}

function moveWindow(deltaX, deltaY) {
    // ... (keep existing implementation)
}

function centerWindow() {
    // ... (keep existing implementation)
}

function saveWindowPosition() {
    // ... (keep existing implementation)
}

function loadWindowPosition() {
    // ... (keep existing implementation)
}

// Message Handling
function addMessage(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.textContent = content;
    
    messageDiv.appendChild(messageContent);
    chatMessages.appendChild(messageDiv);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant';
    typingDiv.id = 'typing-indicator';
    
    const typingContent = document.createElement('div');
    typingContent.className = 'message-content typing-indicator';

    const spinner = document.createElement('div');
    spinner.className = 'typing-spinner';
    typingContent.appendChild(spinner);
    
    typingDiv.appendChild(typingContent);
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return 'typing-indicator';
}

function removeTypingIndicator(id) {
    const typingElement = document.getElementById(id);
    if (typingElement) {
        typingElement.remove();
    }
}

function setInputState(enabled) {
    messageInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
    isProcessing = !enabled;
}

async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || isProcessing) return;

    const historyPayload = conversationHistory.map(entry => ({ ...entry }));

    addMessage('user', message);
    messageInput.value = '';
    messageInput.style.height = 'auto';
    updateSendButtonState();
    setInputState(false);
    conversationHistory.push({ role: 'user', content: message });
    
    const typingId = showTypingIndicator();
    
    try {
        const baseUrl = await initializeApiConfig();

        const response = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message,
                conversationHistory: historyPayload
            })
        });

        if (!response.ok) {
            throw new Error(`Server error (${response.status})`);
        }

        const data = await response.json();

        removeTypingIndicator(typingId);

        if (!data || data.success !== true) {
            throw new Error(data?.message || 'Unexpected response from server');
        }

        const assistantReply = (data.response || '').trim();

        if (assistantReply) {
            addMessage('assistant', assistantReply);
            conversationHistory.push({ role: 'assistant', content: assistantReply });
        } else {
            addMessage('assistant', 'I received an empty response from the AI.');
        }
    } catch (error) {
        removeTypingIndicator(typingId);
        addMessage('assistant', `❌ Error: ${error.message}`);
    } finally {
        setInputState(true);
        updateSendButtonState();
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    cleanupAudio();
    if (ipcRenderer) {
        ipcRenderer.removeAllListeners('window-state-changed');
    }
});