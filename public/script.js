
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
    initializeStatsSection();
    loadStats('weekly'); // Load weekly stats by default
    
    // Force refresh all stats every 30 seconds
    setInterval(() => {
        refreshAllStats();
    }, 30000);
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

function refreshAllStats() {
    // Refresh bot stats
    refreshStats();
    
    // Refresh player statistics
    const activePlaytimeTab = document.querySelector('.playtime-stats .tab-btn.active');
    if (activePlaytimeTab) {
        loadStats(activePlaytimeTab.dataset.tab);
    }
    
    // Refresh profanity statistics
    const activeProfanityTab = document.querySelector('.profanity-stats .tab-btn.active');
    if (activeProfanityTab) {
        loadProfanityStats(activeProfanityTab.dataset.tab);
    }
    
    // Refresh chat statistics
    const activeChatTab = document.querySelector('.chat-stats .tab-btn.active');
    if (activeChatTab) {
        loadChatStats(activeChatTab.dataset.tab);
    }
}

function sendChatMessage() {
    const message = chatInput.value.trim();
    const target = chatTarget.value;
    
    if (!message) return;

    if (target === 'all') {
        // Send to all bots
        socket.emit('sendChatToAll', message);
        addToConsole(`[CHAT] To All Bots: ${message}`, 'chat');
    } else {
        // Send to specific bot
        socket.emit('sendChatToBot', { botId: target, message: message });
        addToConsole(`[CHAT] To Bot ${target}: ${message}`, 'chat');
    }
    
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

// Stats section functionality
function initializeStatsSection() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Get parent stats section
            const statsSection = btn.closest('.stats-section');
            const siblingTabs = statsSection.querySelectorAll('.tab-btn');
            
            // Remove active class from sibling tabs only
            siblingTabs.forEach(tab => tab.classList.remove('active'));
            // Add active class to clicked tab
            btn.classList.add('active');
            
            // Load corresponding stats
            const tabType = btn.dataset.tab;
            if (tabType.startsWith('profanity-')) {
                loadProfanityStats(tabType);
            } else if (tabType.startsWith('top-chatters') || tabType.startsWith('player-chat')) {
                loadChatStats(tabType);
            } else {
                loadStats(tabType);
            }
        });
    });
    
    // Initialize stats
    loadProfanityStats('profanity-weekly');
    loadChatStats('top-chatters');
    
    // Initialize player search
    const searchBtn = document.getElementById('search-player-btn');
    const playerInput = document.getElementById('player-name-input');
    
    if (searchBtn && playerInput) {
        searchBtn.addEventListener('click', () => {
            const playerName = playerInput.value.trim();
            if (playerName) {
                loadPlayerChatHistory(playerName);
            }
        });
        
        playerInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const playerName = playerInput.value.trim();
                if (playerName) {
                    loadPlayerChatHistory(playerName);
                }
            }
        });
    }
}

async function loadStats(type) {
    const statsContent = document.getElementById('stats-content');
    statsContent.innerHTML = '<div style="text-align: center; color: #ecf0f1;">Loading...</div>';

    try {
        let endpoint;
        switch (type) {
            case 'weekly':
                endpoint = '/api/stats/weekly';
                break;
            case 'monthly':
                endpoint = '/api/stats/monthly';
                break;
            case 'top':
                endpoint = '/api/stats/top-players';
                break;
        }

        const response = await fetch(endpoint);
        const stats = await response.json();
        displayStats(stats, type);
    } catch (error) {
        console.error('Failed to load stats:', error);
        statsContent.innerHTML = '<div style="text-align: center; color: #e74c3c;">Failed to load statistics</div>';
    }
}

function displayStats(stats, type) {
    const statsContent = document.getElementById('stats-content');
    
    if (!stats || stats.length === 0) {
        statsContent.innerHTML = '<div style="text-align: center; color: #ecf0f1;">No data available</div>';
        return;
    }

    const tableHeaders = type === 'top' ? 
        ['Player', 'Total Playtime', 'Sessions', 'Days Played', 'Last Played'] :
        ['Player', 'Playtime', 'Sessions', 'Days Played'];

    let tableHTML = `
        <table class="stats-table">
            <thead>
                <tr>
                    ${tableHeaders.map(header => `<th>${header}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
    `;

    stats.forEach((player, index) => {
        const playtimeHours = Math.floor(player.total_minutes / 60);
        const playtimeMinutes = player.total_minutes % 60;
        const playtimeDisplay = `${playtimeHours}h ${playtimeMinutes}m`;
        
        const lastPlayedDisplay = player.last_played ? 
            new Date(player.last_played).toLocaleDateString() : '';

        tableHTML += `
            <tr>
                <td>${player.player_name}</td>
                <td><span class="playtime-badge">${playtimeDisplay}</span></td>
                <td>${player.total_sessions}</td>
                <td>${player.days_played}</td>
                ${type === 'top' ? `<td>${lastPlayedDisplay}</td>` : ''}
            </tr>
        `;
    });

    tableHTML += `
            </tbody>
        </table>
    `;

    statsContent.innerHTML = tableHTML;
}

// Load profanity statistics
async function loadProfanityStats(type) {
    const profanityStatsContent = document.getElementById('profanity-stats-content');
    profanityStatsContent.innerHTML = '<div style="text-align: center; color: #ecf0f1;">Loading...</div>';

    try {
        let endpoint;
        switch (type) {
            case 'profanity-weekly':
                endpoint = '/api/stats/profanity/weekly';
                break;
            case 'profanity-monthly':
                endpoint = '/api/stats/profanity/monthly';
                break;
            case 'profanity-users':
                endpoint = '/api/stats/profanity/top-users';
                break;
            case 'profanity-words':
                endpoint = '/api/stats/profanity/top-words';
                break;
        }

        const response = await fetch(endpoint);
        const stats = await response.json();
        displayProfanityStats(stats, type);
    } catch (error) {
        console.error('Failed to load profanity stats:', error);
        profanityStatsContent.innerHTML = '<div style="text-align: center; color: #e74c3c;">Failed to load profanity statistics</div>';
    }
}

function displayProfanityStats(stats, type) {
    const profanityStatsContent = document.getElementById('profanity-stats-content');
    
    if (!stats || stats.length === 0) {
        profanityStatsContent.innerHTML = '<div style="text-align: center; color: #ecf0f1;">No profanity data available</div>';
        return;
    }

    let tableHTML = '';

    if (type === 'profanity-users') {
        tableHTML = `
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>Player</th>
                        <th>Total Usage</th>
                        <th>Unique Words</th>
                        <th>Last Used</th>
                    </tr>
                </thead>
                <tbody>
        `;

        stats.forEach(player => {
            const lastUsed = player.last_used ? 
                new Date(player.last_used).toLocaleDateString() : '';

            tableHTML += `
                <tr>
                    <td>${player.player_name}</td>
                    <td><span class="profanity-badge">${player.total_profanity}</span></td>
                    <td>${player.unique_words}</td>
                    <td>${lastUsed}</td>
                </tr>
            `;
        });
    } else if (type === 'profanity-words') {
        tableHTML = `
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>Word</th>
                        <th>Total Usage</th>
                        <th>Users Count</th>
                    </tr>
                </thead>
                <tbody>
        `;

        stats.forEach(word => {
            tableHTML += `
                <tr>
                    <td><span class="word-badge">${word.word}</span></td>
                    <td><span class="profanity-badge">${word.total_usage}</span></td>
                    <td>${word.users_count}</td>
                </tr>
            `;
        });
    } else {
        // Weekly/Monthly view grouped by player
        const groupedStats = {};
        stats.forEach(stat => {
            if (!groupedStats[stat.player_name]) {
                groupedStats[stat.player_name] = [];
            }
            groupedStats[stat.player_name].push(stat);
        });

        tableHTML = `
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>Player</th>
                        <th>Words Used</th>
                        <th>Total Count</th>
                    </tr>
                </thead>
                <tbody>
        `;

        Object.keys(groupedStats).forEach(playerName => {
            const playerStats = groupedStats[playerName];
            const totalCount = playerStats.reduce((sum, stat) => sum + stat.total_count, 0);
            const wordsUsed = playerStats.map(stat => 
                `<span class="word-badge">${stat.word} (${stat.total_count})</span>`
            ).join(' ');

            tableHTML += `
                <tr>
                    <td>${playerName}</td>
                    <td>${wordsUsed}</td>
                    <td><span class="profanity-badge">${totalCount}</span></td>
                </tr>
            `;
        });
    }

    tableHTML += `
            </tbody>
        </table>
    `;

    profanityStatsContent.innerHTML = tableHTML;
}

// Load chat statistics
async function loadChatStats(type) {
    const chatStatsContent = document.getElementById('chat-stats-content');
    const playerSearch = document.getElementById('player-search');
    
    if (type === 'player-chat') {
        playerSearch.style.display = 'block';
        chatStatsContent.innerHTML = '<div style="text-align: center; color: #ecf0f1;">Enter a player name to search chat history</div>';
        return;
    } else {
        playerSearch.style.display = 'none';
    }
    
    chatStatsContent.innerHTML = '<div style="text-align: center; color: #ecf0f1;">Loading...</div>';

    try {
        let endpoint = '/api/stats/top-chatters';
        const response = await fetch(endpoint);
        const stats = await response.json();
        displayChatStats(stats, type);
    } catch (error) {
        console.error('Failed to load chat stats:', error);
        chatStatsContent.innerHTML = '<div style="text-align: center; color: #e74c3c;">Failed to load chat statistics</div>';
    }
}

function displayChatStats(stats, type) {
    const chatStatsContent = document.getElementById('chat-stats-content');
    
    if (!stats || stats.length === 0) {
        chatStatsContent.innerHTML = '<div style="text-align: center; color: #ecf0f1;">No chat data available</div>';
        return;
    }

    let tableHTML = `
        <table class="stats-table">
            <thead>
                <tr>
                    <th>Player</th>
                    <th>Total Messages</th>
                    <th>Days Active</th>
                    <th>Last Active</th>
                </tr>
            </thead>
            <tbody>
    `;

    stats.forEach(player => {
        const lastActive = player.last_active ? 
            new Date(player.last_active).toLocaleDateString() : '';

        tableHTML += `
            <tr>
                <td>${player.player_name}</td>
                <td><span class="chat-badge">${player.total_messages}</span></td>
                <td>${player.days_active}</td>
                <td>${lastActive}</td>
            </tr>
        `;
    });

    tableHTML += `
            </tbody>
        </table>
    `;

    chatStatsContent.innerHTML = tableHTML;
}

async function loadPlayerChatHistory(playerName) {
    const chatStatsContent = document.getElementById('chat-stats-content');
    chatStatsContent.innerHTML = '<div style="text-align: center; color: #ecf0f1;">Loading...</div>';

    try {
        const response = await fetch(`/api/stats/player-chat/${encodeURIComponent(playerName)}`);
        const stats = await response.json();
        displayPlayerChatHistory(stats, playerName);
    } catch (error) {
        console.error('Failed to load player chat history:', error);
        chatStatsContent.innerHTML = '<div style="text-align: center; color: #e74c3c;">Failed to load player chat history</div>';
    }
}

function displayPlayerChatHistory(stats, playerName) {
    const chatStatsContent = document.getElementById('chat-stats-content');
    
    if (!stats || stats.length === 0) {
        chatStatsContent.innerHTML = `<div style="text-align: center; color: #ecf0f1;">No chat history found for ${playerName}</div>`;
        return;
    }

    let tableHTML = `
        <h4 style="color: #ecf0f1; margin-bottom: 15px;">Chat History for ${playerName}</h4>
        <table class="stats-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Messages Count</th>
                    <th>Last Message</th>
                </tr>
            </thead>
            <tbody>
    `;

    stats.forEach(record => {
        const date = new Date(record.date).toLocaleDateString();
        const lastMessage = record.last_message ? 
            record.last_message.substring(0, 50) + (record.last_message.length > 50 ? '...' : '') : 
            'No message';

        tableHTML += `
            <tr>
                <td>${date}</td>
                <td><span class="chat-badge">${record.message_count}</span></td>
                <td title="${record.last_message || ''}">${lastMessage}</td>
            </tr>
        `;
    });

    tableHTML += `
            </tbody>
        </table>
    `;

    chatStatsContent.innerHTML = tableHTML;
}

// Auto refresh stats every 5 minutes
setInterval(() => {
    refreshAllStats();
}, 300000);
