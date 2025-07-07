
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mineflayer = require('mineflayer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Store active bots
const activeBots = new Map();
let botCounter = 0;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes
app.post('/api/create-bot', (req, res) => {
    const { username, host, port, password, loginType, version } = req.body;
    
    try {
        const botId = `bot_${++botCounter}`;
        createBot(botId, { username, host, port, password, loginType, version });
        res.json({ success: true, botId, message: 'Bot created successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/disconnect-bot/:botId', (req, res) => {
    const { botId } = req.params;
    
    if (activeBots.has(botId)) {
        const botData = activeBots.get(botId);
        botData.bot.quit();
        activeBots.delete(botId);
        
        io.emit('bot-disconnected', { botId });
        res.json({ success: true, message: 'Bot disconnected' });
    } else {
        res.status(404).json({ success: false, message: 'Bot not found' });
    }
});

app.post('/api/send-chat/:botId', (req, res) => {
    const { botId } = req.params;
    const { message } = req.body;
    
    if (activeBots.has(botId)) {
        const botData = activeBots.get(botId);
        if (botData.bot.player) {
            botData.bot.chat(message);
            res.json({ success: true, message: 'Message sent' });
        } else {
            res.status(400).json({ success: false, message: 'Bot not connected' });
        }
    } else {
        res.status(404).json({ success: false, message: 'Bot not found' });
    }
});

app.get('/api/bots', (req, res) => {
    const botList = Array.from(activeBots.entries()).map(([id, data]) => ({
        id,
        username: data.config.username,
        host: data.config.host,
        port: data.config.port,
        status: data.bot.player ? 'connected' : 'disconnected',
        health: data.bot.health || 0,
        food: data.bot.food || 0,
        autoFarm: data.autoFarm || false
    }));
    
    res.json(botList);
});

app.post('/api/toggle-auto-farm/:botId', (req, res) => {
    const { botId } = req.params;
    
    if (activeBots.has(botId)) {
        const botData = activeBots.get(botId);
        botData.autoFarm = !botData.autoFarm;
        
        if (botData.autoFarm) {
            startAutoFarm(botId);
            res.json({ success: true, message: 'Auto farm started', autoFarm: true });
        } else {
            stopAutoFarm(botId);
            res.json({ success: true, message: 'Auto farm stopped', autoFarm: false });
        }
    } else {
        res.status(404).json({ success: false, message: 'Bot not found' });
    }
});

function createBot(botId, config) {
    const botOptions = {
        host: config.host,
        port: parseInt(config.port) || 25565,
        username: config.username,
        version: config.version || false,
        auth: config.loginType === 'microsoft' ? 'microsoft' : 'offline'
    };

    if (config.loginType === 'microsoft' && config.password) {
        botOptions.password = config.password;
    }

    const bot = mineflayer.createBot(botOptions);
    
    activeBots.set(botId, {
        bot,
        config,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        autoFarm: false,
        farmInterval: null
    });

    // Bot event handlers
    bot.on('login', () => {
        console.log(`Bot ${config.username} logged in`);
        io.emit('bot-login', { botId, username: config.username });
        
        // Auto-login sequence
        setTimeout(() => {
            if (config.password) {
                bot.chat(`/login ${config.password}`);
                console.log(`Bot ${config.username} attempted login with password`);
                
                // Wait 1 second then switch to survival
                setTimeout(() => {
                    bot.chat('/survival');
                    console.log(`Bot ${config.username} switched to survival mode`);
                }, 1000);
            }
        }, 500);
    });

    bot.on('spawn', () => {
        console.log(`Bot ${config.username} spawned`);
        io.emit('bot-spawn', { 
            botId, 
            username: config.username,
            position: bot.entity.position
        });
    });

    bot.on('chat', (username, message) => {
        const chatData = {
            botId,
            username,
            message,
            timestamp: new Date().toISOString()
        };
        
        io.emit('bot-chat', chatData);
        console.log(`[${config.username}] <${username}> ${message}`);
    });

    bot.on('health', () => {
        io.emit('bot-health', {
            botId,
            health: bot.health,
            food: bot.food
        });
    });

    bot.on('death', () => {
        console.log(`Bot ${config.username} died`);
        io.emit('bot-death', { botId, username: config.username });
        
        // Auto respawn
        setTimeout(() => {
            bot.respawn();
        }, 2000);
    });

    bot.on('kicked', (reason) => {
        console.log(`Bot ${config.username} was kicked: ${reason}`);
        io.emit('bot-kicked', { botId, username: config.username, reason });
        handleReconnect(botId);
    });

    bot.on('end', () => {
        console.log(`Bot ${config.username} disconnected`);
        io.emit('bot-end', { botId, username: config.username });
        handleReconnect(botId);
    });

    bot.on('error', (err) => {
        console.log(`Bot ${config.username} error:`, err.message);
        io.emit('bot-error', { botId, username: config.username, error: err.message });
        handleReconnect(botId);
    });

    return bot;
}

function handleReconnect(botId) {
    const botData = activeBots.get(botId);
    if (!botData) return;

    botData.reconnectAttempts++;
    
    if (botData.reconnectAttempts <= botData.maxReconnectAttempts) {
        console.log(`Attempting to reconnect bot ${botData.config.username} (attempt ${botData.reconnectAttempts}/${botData.maxReconnectAttempts})`);
        
        setTimeout(() => {
            try {
                // Remove old bot
                botData.bot.removeAllListeners();
                
                // Create new bot with same config
                createBot(botId, botData.config);
            } catch (error) {
                console.log(`Reconnection failed for ${botData.config.username}:`, error.message);
                io.emit('bot-reconnect-failed', { botId, username: botData.config.username });
            }
        }, 5000 * botData.reconnectAttempts); // Exponential backoff
    } else {
        console.log(`Max reconnection attempts reached for bot ${botData.config.username}`);
        activeBots.delete(botId);
        io.emit('bot-max-reconnect-reached', { botId, username: botData.config.username });
    }
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Client connected to web interface');
    
    socket.on('disconnect', () => {
        console.log('Client disconnected from web interface');
    });
    
    socket.on('get-bots', () => {
        const botList = Array.from(activeBots.entries()).map(([id, data]) => ({
            id,
            username: data.config.username,
            host: data.config.host,
            port: data.config.port,
            status: data.bot.player ? 'connected' : 'disconnected',
            health: data.bot.health || 0,
            food: data.bot.food || 0
        }));
        
        socket.emit('bots-list', botList);
    });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Mineflayer Bot Manager running on port ${PORT}`);
    console.log(`Access the web interface at http://localhost:${PORT}`);
});

function startAutoFarm(botId) {
    const botData = activeBots.get(botId);
    if (!botData || !botData.bot) return;
    
    const bot = botData.bot;
    console.log(`Starting auto farm for bot ${botData.config.username}`);
    
    // Clear any existing interval
    if (botData.farmInterval) {
        clearInterval(botData.farmInterval);
    }
    
    botData.farmInterval = setInterval(() => {
        if (!botData.autoFarm || !bot.player) return;
        
        try {
            // Find hostile mobs within range
            const hostileMobs = Object.values(bot.entities).filter(entity => {
                if (!entity || !entity.position) return false;
                
                // Check if entity is hostile type
                const isHostile = entity.type === 'hostile' || 
                                entity.name === 'warden' ||
                                entity.name === 'zombie' ||
                                entity.name === 'skeleton' ||
                                entity.name === 'creeper' ||
                                entity.name === 'spider' ||
                                entity.name === 'enderman' ||
                                entity.name === 'witch' ||
                                entity.name === 'pillager' ||
                                entity.name === 'vindicator' ||
                                entity.name === 'evoker';
                
                if (!isHostile) return false;
                
                // Calculate distance
                const distance = bot.entity.position.distanceTo(entity.position);
                return distance <= 6; // Attack range
            });
            
            // Prioritize warden first
            let targetMob = hostileMobs.find(mob => mob.name === 'warden');
            if (!targetMob && hostileMobs.length > 0) {
                targetMob = hostileMobs[0]; // Get closest hostile mob
            }
            
            if (targetMob) {
                console.log(`Bot ${botData.config.username} attacking ${targetMob.name || 'hostile mob'}`);
                bot.attack(targetMob);
                
                io.emit('bot-attack', {
                    botId,
                    username: botData.config.username,
                    target: targetMob.name || 'hostile mob',
                    targetId: targetMob.id
                });
            }
        } catch (error) {
            console.log(`Auto farm error for bot ${botData.config.username}:`, error.message);
        }
    }, 500); // Attack every 500ms
}

function stopAutoFarm(botId) {
    const botData = activeBots.get(botId);
    if (!botData) return;
    
    console.log(`Stopping auto farm for bot ${botData.config.username}`);
    botData.autoFarm = false;
    
    if (botData.farmInterval) {
        clearInterval(botData.farmInterval);
        botData.farmInterval = null;
    }
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    
    // Disconnect all bots
    for (const [botId, botData] of activeBots) {
        stopAutoFarm(botId);
        botData.bot.quit();
    }
    
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
