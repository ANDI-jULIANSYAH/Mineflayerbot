
const socket = io();

let allBots = new Map();

// DOM Elements
const botsGrid = document.getElementById('bots-grid');
const addBotBtn = document.getElementById('add-bot-btn');
const removeAllBtn = document.getElementById('remove-all-btn');
const refreshBtn = document.getElementById('refresh-btn');
const addBotModal = document.getElementById('add-bot-modal');
const botForm = document.getElementById('bot-form');
const closeModal = document.querySelector('.close');
const activeBotCount = document.getElementById('active-bots');
const consoleOutput = document.getElementById('console-output');
const chatInput = document.getElementById('chat-input');
const chatTarget = document.getElementById('chat-target');
const sendBtn = document.getElementById('send-btn');
const botProxySelect = document.getElementById('bot-proxy');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadProxies();
    initializeEventListeners();
});

function initializeEventListeners() {
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

    botForm.addEventListener('submit', (e) => {
        e.preventDefault();
        createBot();
    });

    removeAllBtn.addEventListener('click', removeAllBots);
    refreshBtn.addEventListener('click', refreshStats);

    sendBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });
}

async function loadProxies() {
    try {
        const response = await fetch('/api/proxies');
        const proxies = await response.json();
        
        botProxySelect.innerHTML = '<option value="">Direct</option>';
        proxies.forEach(proxy => {
            const option = document.createElement('option');
            option.value = proxy.index;
            option.textContent = `${proxy.name} (${proxy.host}:${proxy.port})`;
            botProxySelect.appendChild(option);
        });
    } catch (error) {
        console.error('Failed to load proxies:', error);
    }
}

function createBot() {
    const formData = new FormData(botForm);
    const config = {
        username: formData.get('bot-username') || document.getElementById('bot-username').value,
        password: formData.get('bot-password') || document.getElementById('bot-password').value,
        host: formData.get('bot-host') || document.getElementById('bot-host').value,
        port: parseInt(formData.get('bot-port') || document.getElementById('bot-port').value),
        version: formData.get('bot-version') || document.getElementById('bot-version').value,
        autoReconnect: document.getElementById('bot-auto-reconnect').checked,
        proxyType: 'socks5',
        proxyIndex: botProxySelect.value ? parseInt(botProxySelect.value) : undefined
    };

    socket.emit('createBot', config);
    addBotModal.style.display = 'none';
    botForm.reset();
}

function removeAllBots() {
    if (confirm('Are you sure you want to remove all bots?')) {
        allBots.forEach((bot, botId) => {
            socket.emit('removeBot', botId);
        });
    }
}

function refreshStats() {
    fetch('/api/stats')
        .then(response => response.json())
        .then(stats => {
            socket.emit('allStatsUpdate', stats);
        })
        .catch(error => console.error('Failed to refresh stats:', error));
}

function sendChatMessage() {
    const message = chatInput.value.trim();
    const target = chatTarget.value;
    
    if (!message) return;

    // Send message via socket or handle locally
    addToConsole(`[CHAT] To ${target}: ${message}`, 'chat');
    chatInput.value = '';
}

function addToConsole(message, type = 'system') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `console-message ${type}`;
    messageDiv.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    
    consoleOutput.appendChild(messageDiv);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;

    // Keep only last 1000 messages
    while (consoleOutput.children.length > 1000) {
        consoleOutput.removeChild(consoleOutput.firstChild);
    }
}

function createBotCard(bot) {
    const card = document.createElement('div');
    card.className = 'bot-card';
    card.id = `bot-${bot.id}`;

    card.innerHTML = `
        <div class="bot-header">
            <h3>${bot.username}</h3>
            <div class="bot-status status-${bot.status.toLowerCase()}">${bot.status}</div>
            <button class="remove-bot-btn" onclick="removeBot('${bot.id}')">&times;</button>
        </div>
        
        <div class="bot-stats">
            <div class="stat">
                <label>Health:</label>
                <div class="progress-bar">
                    <div class="progress-fill health" style="width: ${(bot.health / 20) * 100}%"></div>
                </div>
                <span>${bot.health}/20</span>
            </div>
            
            <div class="stat">
                <label>Food:</label>
                <div class="progress-bar">
                    <div class="progress-fill food" style="width: ${(bot.food / 20) * 100}%"></div>
                </div>
                <span>${bot.food}/20</span>
            </div>
            
            <div class="stat">
                <label>Ping:</label>
                <span>${bot.ping}ms</span>
            </div>
            
            <div class="stat">
                <label>Proxy:</label>
                <span>${bot.proxy}</span>
            </div>
        </div>
        
        <div class="bot-actions">
            <button class="btn btn-small btn-secondary" onclick="sendBotCommand('${bot.id}', '/survival')">Survival</button>
            <button class="btn btn-small btn-secondary" onclick="sendBotCommand('${bot.id}', '/spawn')">Spawn</button>
        </div>
        
        <div class="bot-players">
            <label>Online Players (${bot.onlinePlayers ? Object.keys(bot.onlinePlayers).length : 0}):</label>
            <div class="players-list">
                ${bot.onlinePlayers ? Object.keys(bot.onlinePlayers).map(player => 
                    `<span class="player">${player}</span>`
                ).join('') : ''}
            </div>
        </div>
    `;

    return card;
}

function updateBotCard(bot) {
    const existingCard = document.getElementById(`bot-${bot.id}`);
    if (existingCard) {
        const newCard = createBotCard(bot);
        existingCard.replaceWith(newCard);
    } else {
        botsGrid.appendChild(createBotCard(bot));
    }
    
    // Update chat target dropdown
    updateChatTargets();
}

function updateChatTargets() {
    const currentValue = chatTarget.value;
    chatTarget.innerHTML = '<option value="all">All Bots</option>';
    
    allBots.forEach((bot, botId) => {
        const option = document.createElement('option');
        option.value = botId;
        option.textContent = `Bot ${bot.username}`;
        chatTarget.appendChild(option);
    });
    
    if (chatTarget.querySelector(`option[value="${currentValue}"]`)) {
        chatTarget.value = currentValue;
    }
}

function removeBot(botId) {
    if (confirm(`Are you sure you want to remove bot ${botId}?`)) {
        socket.emit('removeBot', botId);
    }
}

function sendBotCommand(botId, command) {
    addToConsole(`Sending command to bot ${botId}: ${command}`, 'chat');
    // You can emit a socket event here to send commands to specific bots
}

// Socket event listeners
socket.on('connect', () => {
    addToConsole('Connected to server', 'system');
});

socket.on('disconnect', () => {
    addToConsole('Disconnected from server', 'error');
});

socket.on('allStatsUpdate', (stats) => {
    allBots.clear();
    botsGrid.innerHTML = '';
    
    stats.forEach(bot => {
        allBots.set(bot.id, bot);
        updateBotCard(bot);
    });
    
    activeBotCount.textContent = stats.length;
});

socket.on('botCreated', (data) => {
    addToConsole(`Bot created: ${data.config.username}`, 'system');
});

socket.on('chatMessage', (data) => {
    addToConsole(`[BOT-${data.botId}] ${data.message}`, 'chat');
});

socket.on('error', (error) => {
    addToConsole(`Error: ${error}`, 'error');
    alert(`Error: ${error}`);
});
