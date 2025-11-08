const { ipcRenderer } = require('electron');

const statusIndicator = document.getElementById('statusIndicator');
const statusDot = statusIndicator.querySelector('.status-dot');
const statusText = document.getElementById('statusText');
const messageContainer = document.getElementById('messageContainer');

// IPC listeners
ipcRenderer.on('task-processing', (event, data) => {
    updateStatus('processing', 'Processing task...');
    showMessage('Analyzing screen and creating task...', 'info');
});

ipcRenderer.on('task-created', (event, data) => {
    updateStatus('ready', 'Ready');
    showMessage(`✅ Task created successfully: ${data.title || 'Task'}`, 'success');
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        clearMessages();
    }, 3000);
});

ipcRenderer.on('task-error', (event, data) => {
    updateStatus('error', 'Error');
    showMessage(`❌ Error: ${data.error}`, 'error');
    
    setTimeout(() => {
        updateStatus('ready', 'Ready');
        clearMessages();
    }, 5000);
});

function updateStatus(status, text) {
    statusText.textContent = text;
    statusDot.className = 'status-dot';
    
    if (status === 'processing') {
        statusDot.classList.add('processing');
    } else if (status === 'error') {
        statusDot.classList.add('error');
    }
}

function showMessage(text, type) {
    const message = document.createElement('div');
    message.className = `message ${type}`;
    message.textContent = text;
    messageContainer.appendChild(message);
}

function clearMessages() {
    messageContainer.innerHTML = '';
}

// Settings button
document.getElementById('settingsBtn').addEventListener('click', () => {
    ipcRenderer.invoke('show-window');
});

// Check status on load
ipcRenderer.invoke('get-status').then(status => {
    console.log('App status:', status);
});

