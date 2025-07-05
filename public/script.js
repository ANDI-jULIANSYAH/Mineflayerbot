
const socket = io();

// DOM elements
const activeBotsElement = document.getElementById('active-bots');
const botsGridElement = document.getElementById('bots-grid');
const consoleOutputElement = document.getElementById('console-output');
const chatInputElement = document.getElementById('chat-input');
const chatTargetElement = document.getElementById('chat-target');
const addBotBtn = document.getElementById('add-bot-btn');
const removeAllBtn = document.getElementById('remove-all-btn');
const refreshBtn = document.getElementById('refresh-btn');
const addBotModal = document.getElementById('add-bot-modal');
const closeModal = document.querySelector('.close');
const botForm = document.getElementById('bot-form');

let botsData = new Map();

// Socket event listeners
socket.on('connect', () => {
    console.log('Connected to server');
    addConsoleMessage('Connected to multi-bot dashboard', 'system');
});

socket.on('allStatsUpdate', (statsArray) => {
    updateAllBots(statsArray);
});

socket.on('chatMessage', (data) => {
    addConsoleMessage(`[BOT-${data.botId}] [${new Date(data.timestamp).toLocaleTimeString()}] ${data.message}`, 'chat');
});

socket.on('botCreated', (data) => {
    addConsoleMessage(`Bot ${data.config.username} (ID: ${data.id}) created successfully`, 'system');
    updateChatTargets();
});

socket.on('botRemoved', (botId) => {
    const botCard = document.querySelector(`[data-bot-id="${botId}"]`);
    if (botCard) {
        botCard.remove();
    }
    botsData.delete(botId);
    updateChatTargets();
    addConsoleMessage(`Bot ${botId} removed`, 'system');
});

socket.on('error', (message) => {
    addConsoleMessage(`Error: ${message}`, 'error');
});

// Modal controls
addBotBtn.addEventListener('click', () => {
    addBotModal.style.display = 'block';
});

closeModal.addEventListener('click', () => {
    addBotModal.style.display = 'none';
});

window.addEventListener('click', (event) => {
    if (event.target === addBotModal) {
        addBotModal.style.display = 'none';
    }
});

// Bot form submission
botForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const config = {
        username: document.getElementById('bot-username').value,
        password: document.getElementById('bot-password').value,
        host: document.getElementById('bot-host').value,
        port: parseInt(document.getElementById('bot-port').value),
        version: document.getElementById('bot-version').value,
        autoReconnect: document.getElementById('bot-auto-reconnect').checked
    };
    
    socket.emit('createBot', config);
    addBotModal.style.display = 'none';
    botForm.reset();
});

// Remove all bots
removeAllBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to remove all bots?')) {
        for (const botId of botsData.keys()) {
            socket.emit('removeBot', botId);
        }
    }
});

// Refresh
refreshBtn.addEventListener('click', () => {
    location.reload();
});

// Update all bots display
function updateAllBots(statsArray) {
    botsGridElement.innerHTML = '';
    botsData.clear();
    
    statsArray.forEach(stats => {
        botsData.set(stats.id, stats);
        createBotCard(stats);
    });
    
    activeBotsElement.textContent = statsArray.length;
    updateChatTargets();
}

// Create bot card
function createBotCard(stats) {
    const botCard = document.createElement('div');
    botCard.className = 'bot-card';
    botCard.setAttribute('data-bot-id', stats.id);
    
    const statusClass = getStatusClass(stats.status);
    
    botCard.innerHTML = `
        <div class="bot-header">
            <h3>${stats.username}</h3>
            <span class="bot-status ${statusClass}">${stats.status}</span>
            <button class="remove-bot-btn" data-bot-id="${stats.id}">×</button>
        </div>
        <div class="bot-stats">
            <div class="stat">
                <label>Health:</label>
                <div class="progress-bar">
                    <div class="progress-fill health" style="width: ${(stats.health / 20) * 100}%"></div>
                </div>
                <span>${Math.round(stats.health)}/20</span>
            </div>
            <div class="stat">
                <label>Food:</label>
                <div class="progress-bar">
                    <div class="progress-fill food" style="width: ${(stats.food / 20) * 100}%"></div>
                </div>
                <span>${Math.round(stats.food)}/20</span>
            </div>
            <div class="stat">
                <label>Ping:</label>
                <span>${stats.ping}ms</span>
            </div>
            <div class="stat">
                <label>Proxy:</label>
                <span>${stats.proxy}</span>
            </div>
        </div>
        <div class="bot-actions">
            <button class="btn btn-small" onclick="sendBotCommand('${stats.id}', '/auto')">Auto Shop</button>
            <button class="btn btn-small" onclick="sendBotCommand('${stats.id}', '/dropall')">Drop All</button>
            <button class="btn btn-small" onclick="sendBotCommand('${stats.id}', '/balance')">Balance</button>
        </div>
        <div class="bot-players">
            <label>Online Players (${stats.onlinePlayers.length}):</label>
            <div class="players-list">
                ${stats.onlinePlayers.map(player => 
                    `<span class="player">${player.name} (${player.ping}ms)</span>`
                ).join('')}
            </div>
        </div>
    `;
    
    // Add remove bot functionality
    const removeBtn = botCard.querySelector('.remove-bot-btn');
    removeBtn.addEventListener('click', () => {
        if (confirm(`Remove bot ${stats.username}?`)) {
            socket.emit('removeBot', stats.id);
        }
    });
    
    botsGridElement.appendChild(botCard);
}

// Get status class for styling
function getStatusClass(status) {
    switch (status.toLowerCase()) {
        case 'online': return 'status-online';
        case 'connecting': return 'status-connecting';
        case 'disconnected': return 'status-disconnected';
        case 'error': return 'status-error';
        case 'kicked': return 'status-kicked';
        default: return 'status-unknown';
    }
}

// Send command to specific bot
function sendBotCommand(botId, command) {
    socket.emit('sendChat', { botId: botId, message: command });
    addConsoleMessage(`> [BOT-${botId}] ${command}`, 'system');
}

// Update chat targets dropdown
function updateChatTargets() {
    const currentValue = chatTargetElement.value;
    chatTargetElement.innerHTML = '<option value="all">All Bots</option>';
    
    for (const [botId, stats] of botsData) {
        const option = document.createElement('option');
        option.value = botId;
        option.textContent = `${stats.username} (${botId})`;
        chatTargetElement.appendChild(option);
    }
    
    // Restore selection if it still exists
    if (Array.from(chatTargetElement.options).some(opt => opt.value === currentValue)) {
        chatTargetElement.value = currentValue;
    }
}

// Add message to console
function addConsoleMessage(message, type = 'normal') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `console-message ${type}`;
    messageDiv.textContent = message;
    
    consoleOutputElement.appendChild(messageDiv);
    consoleOutputElement.scrollTop = consoleOutputElement.scrollHeight;
    
    // Keep only last 200 messages
    while (consoleOutputElement.children.length > 200) {
        consoleOutputElement.removeChild(consoleOutputElement.firstChild);
    }
}

// Send chat message
function sendMessage() {
    const message = chatInputElement.value.trim();
    const target = chatTargetElement.value;
    
    if (message) {
        socket.emit('sendChat', { botId: target, message: message });
        addConsoleMessage(`> [${target === 'all' ? 'ALL' : target}] ${message}`, 'system');
        chatInputElement.value = '';
    }
}

// Enter key to send message
chatInputElement.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Send button
document.getElementById('send-btn').addEventListener('click', sendMessage);

// Initial data fetch
fetch('/api/stats')
    .then(response => response.json())
    .then(stats => updateAllBots(stats))
    .catch(err => console.error('Error fetching stats:', err));
