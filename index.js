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
const PORT = process.env.PORT || 5000
const SocksClient = require('socks5-client'); // Tambahkan ini

// Daftar proxy SOCKS5
const socks5ProxyList = [
    { name: 'Proxy 1', host: '127.0.0.1', port: 1080 },
    { name: 'Proxy 2', host: '199.102.104.70', port: 4145 },
    { name: 'Proxy 3', host: '184.181.217.194' , port: 4145 },
];

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
    let proxy = null;

    // Pilih proxy jika ada
    if (config.proxyType === 'socks5' && config.proxyIndex !== undefined) {
        proxy = socks5ProxyList[config.proxyIndex];
    }

    const botOptions = {
        host: config.host || "localmc.club",
        port: config.port || 23028,
        username: config.username,
        version: config.version || "1.18.2",
        viewDistance: 12
    };

    // SOCKS5 Proxy support
    if (proxy) {
        botOptions.connect = (client) => {
            const net = require('net');
            const socks = require('socks5-client');
            const socket = new socks.Socks5ClientSocket(proxy.host, proxy.port);

            // Tangani error pada socket proxy
            socket.on('error', (err) => {
                console.log(`[BOT-${botId}] SOCKS5 Proxy error:`, err.message);
                // Hindari crash, emit 'error' pada bot jika perlu
                if (bot) bot.emit('error', err);
            });

            socket.on('close', () => {
                console.log(`[BOT-${botId}] SOCKS5 Proxy connection closed`);
            });
            return socket;
        };
        console.log(`[BOT-${botId}] Using SOCKS5 proxy: ${proxy.host}:${proxy.port}`);
    }

    // Add proxy if available
    if (proxy) {
        botOptions.connect = (client) => {
            const net = require('net');
            const socket = net.connect(proxy.port, proxy.host);

            socket.on('error', (err) => {
                console.log(`[BOT-${botId}] Proxy TCP error:`, err.message);
                if (bot) bot.emit('error', err);
            });

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

// Configure Express middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Serve static files with proper MIME types
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        } else if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        }
    }
}));

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

app.get('/api/proxies', (req, res) => {
    res.json(socks5ProxyList.map((p, i) => ({ index: i, name: p.name, host: p.host, port: p.port })));
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
            bot.quit();
            bots.delete(botId);
            botConfigs = botConfigs.filter(config => config.id !== botId);
            activeBots--;
            console.log(`Bot ${botId} removed`);
            broadcastStats();
        } else {
            socket.emit('error', 'Bot not found');
        }
    });
});

// Broadcast stats to all connected web clients
function broadcastStats() {
    io.emit('allStatsUpdate', Array.from(allBotStats.values()));
}

// Update bot stats
function updateBotStats(botId) {
    const bot = bots.get(botId);
    if (bot) {
        const stats = allBotStats.get(botId);
        if (stats) {
            stats.health = bot.health;
            stats.food = bot.food;
            stats.ping = bot.ping;
            stats.onlinePlayers = bot.players;
            allBotStats.set(botId, stats);
        }
    }
}

// Auto join survival mode
function autoJoinSurvival(bot) {
    console.log(`[BOT-${bot.botId}] Mencoba untuk bergabung ke survival...`);
    bot.chat("/survival");
}

// Schedule survival mode at 1 AM
function scheduleSurvivalAt1AM(bot) {
    const now = new Date();
    const millisTill1AM = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (now.getHours() >= 1 ? 1 : 0), 1, 0, 0, 0) - now;
    setTimeout(() => {
        console.log(`[BOT-${bot.botId}] Bergabung ke survival mode secara otomatis jam 01:00`);
        autoJoinSurvival(bot);

        // Jadwalkan ulang untuk hari berikutnya
        scheduleSurvivalAt1AM(bot);
    }, millisTill1AM);
}

// Update daftar pemain online
function updateOnlinePlayers(botId) {
    const bot = bots.get(botId);
    if (bot) {
        const message = bot.players;
        const stats = allBotStats.get(botId);
        if (stats) {
            stats.onlinePlayers = message;
            allBotStats.set(botId, stats);
        }
    }
}

// Uji coba koneksi ke server Minecraft
async function testConnection(config) {
    return new Promise((resolve, reject) => {
        const bot = mineflayer.createBot({
            host: config.host,
            port: config.port,
            username: config.username,
            version: config.version || "1.18.2",
            auth: config.auth || 'mojang',
            // Jangan tambahkan proxy di sini
        });

        bot.once('spawn', () => {
            bot.quit();
            resolve(true);
        });

        bot.on('error', (err) => {
            bot.quit();
            reject(err);
        });

        bot.on('kicked', (reason) => {
            bot.quit();
            reject(new Error(`Kicked: ${reason}`));
        });
    });
}

// Endpoint untuk menguji koneksi
app.post('/api/test-connection', express.json(), async (req, res) => {
    const config = req.body;
    try {
        // Uji coba koneksi tanpa menambahkan proxy
        await testConnection(config);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Jalankan server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server berjalan di http://0.0.0.0:${PORT}`);
});
