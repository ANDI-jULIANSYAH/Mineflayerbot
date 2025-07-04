// Cek dan install mineflayer otomatis jika belum ada
try {
    require.resolve('mineflayer');
} catch (e) {
    console.log('mineflayer belum terinstall. Menginstall...');
    const { execSync } = require('child_process');
    execSync('npm install mineflayer', { stdio: 'inherit' });
    console.log('Install mineflayer selesai. Silakan jalankan ulang program.');
    process.exit(0);
}

const mineflayer = require("mineflayer");
const fs = require("fs");
const path = require("path");
const express = require('express')
const http = require('http')
const socketIo = require('socket.io')
const app = express()
const server = http.createServer(app)
const io = socketIo(server)
const PORT = process.env.PORT || 3000

// Multi-bot management
let bots = new Map(); // Store all bot instances
let botConfigs = []; // Store bot configurations
let activeBots = 0;
const maxBots = 50;

// Proxy list - tambahkan proxy Anda di sini
const proxyList = [
    null, // No proxy for first bot
    // Tambahkan proxy dalam format:
    // { host: 'proxy-host', port: 'proxy-port', username: 'user', password: 'pass' }
    // atau { host: 'proxy-host', port: 'proxy-port' } untuk proxy tanpa auth
];

// Bot stats for all bots
let allBotStats = new Map();

let startTime = null;
let logBuffer = [];

function ensureChangelogDir() {
    const changelogDir = path.join(__dirname, "Changelog");
    if (!fs.existsSync(changelogDir)) {
        fs.mkdirSync(changelogDir, { recursive: true });
    }
    return changelogDir;
}

function formatDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}(${hours}:${minutes}:${seconds})`;
}

function saveChangelog() {
    if (logBuffer.length === 0 || !startTime) return;
    const changelogDir = ensureChangelogDir();
    const endTime = new Date();
    const filename = `${formatDateTime(startTime)} - ${formatDateTime(endTime)}.txt`;
    const filepath = path.join(changelogDir, filename);
    try {
        fs.writeFileSync(filepath, logBuffer.join('\n'), 'utf8');
        console.log(`Changelog saved: ${filename}`);
        logBuffer = [];
    } catch (err) {
        console.log('Error saving changelog:', err);
    }
}

const originalConsoleLog = console.log;
console.log = function(...args) {
    const message = args.join(' ');
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    originalConsoleLog(logEntry);
    if (startTime) {
        logBuffer.push(logEntry);
    }
};

function getRandomProxy() {
    if (proxyList.length <= 1) return null;
    const randomIndex = Math.floor(Math.random() * (proxyList.length - 1)) + 1;
    return proxyList[randomIndex];
}

function createBot(config) {
    const botId = config.id;
    const proxy = getRandomProxy();
    
    const botOptions = {
        host: config.host || "localmc.club",
        port: config.port || 23028,
        username: config.username,
        version: config.version || "1.18.2",
        viewDistance: 12
    };

    // Add proxy if available
    if (proxy) {
        botOptions.connect = (client) => {
            const net = require('net');
            const socket = net.connect(proxy.port, proxy.host);
            
            if (proxy.username && proxy.password) {
                // Proxy with authentication
                socket.write(`CONNECT ${botOptions.host}:${botOptions.port} HTTP/1.1\r\n`);
                socket.write(`Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}\r\n`);
                socket.write('\r\n');
            } else {
                // Proxy without authentication
                socket.write(`CONNECT ${botOptions.host}:${botOptions.port} HTTP/1.1\r\n\r\n`);
            }
            
            return socket;
        };
        console.log(`[BOT-${botId}] Using proxy: ${proxy.host}:${proxy.port}`);
    }

    const bot = mineflayer.createBot(botOptions);

    // Initialize bot stats
    allBotStats.set(botId, {
        id: botId,
        username: config.username,
        health: 0,
        food: 0,
        ping: 0,
        status: 'Connecting',
        onlinePlayers: [],
        proxy: proxy ? `${proxy.host}:${proxy.port}` : 'Direct'
    });

    bot.botId = botId;
    bot.config = config;

    bot.on("login", () => {
        if (!startTime) {
            startTime = new Date();
            logBuffer = [];
        }
        console.log(`[BOT-${botId}] Berhasil Login`);
        const stats = allBotStats.get(botId);
        stats.status = 'Online';
        allBotStats.set(botId, stats);
        broadcastStats();
    });

    bot.on("spawn", () => {
        console.log(`[BOT-${botId}] spawned in`);
        bot.chat(config.password ? `/login ${config.password}` : "/login MASTER09");
        setTimeout(() => {
            bot.chat("/survival");
            console.log(`[BOT-${botId}] Auto /survival on spawn`);
        }, 2000);
        
        // Start periodic stats update for this bot
        setInterval(() => {
            updateBotStats(botId);
        }, 5000);
    });

    bot.on("message", async (message) => {
        const messageText = message.toString();

        // Filter pesan health/mana agar tidak tampil di console & web
        if (/^\s*\d+\/\d+❤\s+\d+\/\d+\s*Mana\s*$/i.test(messageText)) return;

        console.log(`[BOT-${botId}] [MESSAGE]`, messageText);
        
        // Update online players list for this bot
        if (messageText.includes("memasuki permainan") || messageText.includes("joined the game")) {
            updateOnlinePlayers(botId);
        }
        
        // Broadcast message to web clients
        io.emit('chatMessage', {
            botId: botId,
            username: config.username,
            timestamp: new Date().toISOString(),
            message: messageText
        });
    });

    bot.on("end", (reason) => {
        console.log(`[BOT-${botId}] Disconnected. Reason:`, reason);
        const stats = allBotStats.get(botId);
        stats.status = 'Disconnected';
        allBotStats.set(botId, stats);
        broadcastStats();
        
        // Auto reconnect if enabled
        if (config.autoReconnect) {
            setTimeout(() => {
                console.log(`[BOT-${botId}] Attempting to reconnect...`);
                const newBot = createBot(config);
                bots.set(botId, newBot);
            }, 5000);
        }
    });

    bot.on("kicked", (reason) => {
        console.log(`[BOT-${botId}] Kicked:`, reason);
        const stats = allBotStats.get(botId);
        stats.status = 'Kicked';
        allBotStats.set(botId, stats);
        broadcastStats();
    });

    bot.on("error", (err) => {
        console.log(`[BOT-${botId}] Error:`, err);
        const stats = allBotStats.get(botId);
        stats.status = 'Error';
        allBotStats.set(botId, stats);
        broadcastStats();
    });

    // Tambahkan penjadwalan survival jam 01.00
    bot.once('login', () => {
        scheduleSurvivalAt1AM(bot);
    });

    // Handler untuk kick "Server is Restarting"
    bot.on("kicked", (reason) => {
        console.log(`[BOT-${botId}] Kicked:`, reason);
        const stats = allBotStats.get(botId);
        stats.status = 'Kicked';
        allBotStats.set(botId, stats);
        broadcastStats();

        // Deteksi pesan restart
        if (typeof reason === 'string' && reason.includes('Server is Restarting')) {
            setTimeout(() => {
                autoJoinSurvival(bot);
            }, 5000);
        }
    });

    // Handler jika join survival gagal (deteksi pesan join survival)
    bot.on("message", async (message) => {
        const messageText = message.toString();
        // ...existing code...

        // Deteksi gagal join survival
        if (
            messageText.includes("You are not logged in") ||
            messageText.includes("You must login") ||
            messageText.includes("You are not in survival") ||
            messageText.includes("failed to join survival")
        ) {
            console.log(`[BOT-${bot.botId}] Deteksi gagal join survival, mencoba ulang...`);
            autoJoinSurvival(bot);
        }

        // ...existing code...
    });

    return bot;
}

// Simpan changelog setiap 5 menit
setInterval(saveChangelog, 300000);

process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Saving changelog...');
    saveChangelog();
    process.exit(0);
});
process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM. Saving changelog...');
    saveChangelog();
    process.exit(0);
});

// Fitur chat dari console
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.on('line', async (input) => {
    const args = input.split(' ');
    if (args[0].startsWith('@')) {
        const botId = args[0].substring(1);
        const message = args.slice(1).join(' ');
        const bot = bots.get(botId);
        if (bot) {
            bot.chat(message);
            console.log(`[CONSOLE CHAT to BOT-${botId}] ${message}`);
        } else {
            console.log(`Bot ${botId} tidak ditemukan.`);
        }
    } else {
        for (const [id, bot] of bots) {
            bot.chat(input);
        }
        console.log(`[CONSOLE CHAT to ALL] ${input}`);
    }
});

function waitWindowOpen(bot, timeout = 5000) {
    return new Promise((resolve, reject) => {
        let timer = setTimeout(() => {
            bot.removeListener('windowOpen', onOpen);
            reject(new Error('Timeout menunggu window terbuka'));
        }, timeout);
        function onOpen(window) {
            clearTimeout(timer);
            resolve(window);
        }
        bot.once('windowOpen', onOpen);
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Serve static files
app.use(express.static('public'))

// API endpoints
app.get('/api/stats', (req, res) => {
    const statsArray = Array.from(allBotStats.values());
    res.json(statsArray);
});

app.get('/api/bots', (req, res) => {
    const botsInfo = Array.from(bots.entries()).map(([id, bot]) => ({
        id: id,
        username: bot.config.username,
        status: allBotStats.get(id)?.status || 'Unknown'
    }));
    res.json(botsInfo);
});

// Socket.io connection
io.on('connection', (socket) => {
    console.log('Client connected to web interface');
    
    // Send current stats to new client
    socket.emit('allStatsUpdate', Array.from(allBotStats.values()));
    
    // Handle bot creation from web
    socket.on('createBot', (config) => {
        if (bots.size >= maxBots) {
            socket.emit('error', 'Maximum bot limit reached');
            return;
        }
        
        const botId = Date.now().toString();
        config.id = botId;
        config.autoReconnect = config.autoReconnect || false;
        
        const bot = createBot(config);
        bots.set(botId, bot);
        botConfigs.push(config);
        activeBots++;
        
        socket.emit('botCreated', { id: botId, config: config });
        broadcastStats();
    });
    
    // Handle bot removal
    socket.on('removeBot', (botId) => {
        const bot = bots.get(botId);
        if (bot) {
            bot.end();
            bots.delete(botId);
            allBotStats.delete(botId);
            botConfigs = botConfigs.filter(config => config.id !== botId);
            activeBots--;
            socket.emit('botRemoved', botId);
            broadcastStats();
        }
    });
    
    // Handle chat messages from web interface
    socket.on('sendChat', (data) => {
        const { botId, message } = data;
        if (botId === 'all') {
            for (const [id, bot] of bots) {
                bot.chat(message);
            }
            console.log(`[WEB CHAT to ALL] ${message}`);
        } else {
            const bot = bots.get(botId);
            if (bot && message.trim()) {
                bot.chat(message);
                console.log(`[WEB CHAT to BOT-${botId}] ${message}`);
            }
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected from web interface');
    });
});

// Helper functions
async function executeAutoShop(bot) {
    let loop = 0;
    const maxLoop = 500;
    console.log(`[BOT-${bot.botId}] Memulai auto shop mobdrops sebanyak ${maxLoop} kali...`);
    for (loop = 1; loop <= maxLoop; loop++) {
        try {
            console.log(`[BOT-${bot.botId}] Loop ke-${loop}`);
            bot.chat('/shop mobdrops');
            // Tunggu window terbuka
            const window = await waitWindowOpen(bot, 5000);

            // Klik slot 11
            await bot.clickWindow(11, 0, 0);
            await delay(500);

            // Klik slot 31
            await bot.clickWindow(31, 0, 0);
            await delay(500);

            // Klik slot 8
            await bot.clickWindow(8, 0, 0);
            await delay(500);

            // Tutup window
            bot.closeWindow(window);
            await delay(5000);
        } catch (err) {
            console.log(`[BOT-${bot.botId}] Error pada loop ke-${loop}:`, err.message);
            break;
        }
    }
    console.log(`[BOT-${bot.botId}] Selesai auto shop mobdrops.`);
}

function updateBotStats(botId) {
    const bot = bots.get(botId);
    if (!bot) return;
    
    const stats = allBotStats.get(botId);
    stats.health = bot.health || 0;
    stats.food = bot.food || 0;
    stats.ping = bot._client.latency || 0;
    
    allBotStats.set(botId, stats);
    broadcastStats();
}

function updateOnlinePlayers(botId) {
    const bot = bots.get(botId);
    if (!bot) return;
    
    const stats = allBotStats.get(botId);
    stats.onlinePlayers = Object.keys(bot.players).map(playerName => {
        const player = bot.players[playerName];
        return {
            name: playerName,
            ping: player.ping || 0
        };
    });
    
    allBotStats.set(botId, stats);
    broadcastStats();
}

function broadcastStats() {
    io.emit('allStatsUpdate', Array.from(allBotStats.values()));
}

server.listen(PORT, () => {
    console.log(`Web server running on port ${PORT}`);
    if (process.env.HEROKU_APP_NAME) {
        console.log(`Akses web di: https://${process.env.HEROKU_APP_NAME}.herokuapp.com/`);
    } else {
        console.log('Akses web di: https://localmcbot-2885511c2fdc.herokuapp.com/');
    }
});

// Start with one default bot (configurable via env)
setTimeout(() => {
    const defaultConfig = {
        id: 'default',
        username: process.env.BOT_USERNAME || 'Master1140ID',
        password: process.env.BOT_PASSWORD || 'MASTER09',
        host: process.env.BOT_HOST || 'localmc.club',
        port: process.env.BOT_PORT ? parseInt(process.env.BOT_PORT) : 23028,
        version: process.env.BOT_VERSION || '1.18.2',
        autoReconnect: true
    };
    
    const bot = createBot(defaultConfig);
    bots.set('default', bot);
    botConfigs.push(defaultConfig);
    activeBots++;
}, 1000);

// Tambahkan fungsi auto join survival
async function autoJoinSurvival(bot, maxRetry = 10) {
    let retry = 0;
    while (retry < maxRetry) {
        try {
            bot.chat(`/login ${bot.config.password}`);
            await delay(2000);
            bot.chat('/survival');
            console.log(`[BOT-${bot.botId}] Attempted to rejoin survival (try ${retry + 1}/${maxRetry})`);
            await delay(60000); // 1 menit
            // Cek status, jika sudah masuk survival bisa break
            // (Anda bisa tambahkan pengecekan status di sini jika ada indikator)
        } catch (e) {
            console.log(`[BOT-${bot.botId}] Error auto join survival:`, e.message);
        }
        retry++;
    }
}

// Penjadwalan ulang survival jam 01.00
function scheduleSurvivalAt1AM(bot) {
    const now = new Date();
    const next1AM = new Date(now);
    next1AM.setHours(1, 0, 0, 0);
    if (now > next1AM) next1AM.setDate(now.getDate() + 1);
    const msUntil1AM = next1AM - now;
    setTimeout(() => {
        bot.chat(`/login ${bot.config.password}`);
        setTimeout(() => {
            bot.chat('/survival');
            console.log(`[BOT-${bot.botId}] Scheduled /survival at 01:00`);
        }, 2000);
        scheduleSurvivalAt1AM(bot); // Reschedule for next day
    }, msUntil1AM);
}
