
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
        
        // Clean up intervals
        if (botData.farmInterval) {
            clearInterval(botData.farmInterval);
        }
        if (botData.survivalInterval) {
            clearInterval(botData.survivalInterval);
        }
        
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

app.post('/api/broadcast-chat', (req, res) => {
    const { target, message } = req.body;
    
    try {
        let sentCount = 0;
        
        if (target === 'all') {
            // Send to all bots
            for (const [botId, botData] of activeBots) {
                if (botData.bot.player) {
                    botData.bot.chat(message);
                    sentCount++;
                }
            }
            res.json({ success: true, message: `Message sent to ${sentCount} bot(s)` });
        } else {
            // Send to specific bot
            if (activeBots.has(target)) {
                const botData = activeBots.get(target);
                if (botData.bot.player) {
                    botData.bot.chat(message);
                    res.json({ success: true, message: 'Message sent to bot' });
                } else {
                    res.status(400).json({ success: false, message: 'Bot not connected' });
                }
            } else {
                res.status(404).json({ success: false, message: 'Bot not found' });
            }
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

function createBot(botId, config) {
    // Check if bot already exists to prevent duplicates
    if (activeBots.has(botId)) {
        const existingBot = activeBots.get(botId);
        if (existingBot.bot && existingBot.bot.player) {
            console.log(`Bot ${config.username} already exists and is connected`);
            return existingBot.bot;
        }
        // Clean up existing bot if not connected
        if (existingBot.bot) {
            existingBot.bot.removeAllListeners();
            existingBot.bot.quit();
        }
    }

    const botOptions = {
        host: config.host,
        port: parseInt(config.port) || 25565,
        username: config.username,
        version: config.version || false,
        auth: config.loginType === 'microsoft' ? 'microsoft' : 'offline'
    };

    const bot = mineflayer.createBot(botOptions);
    
    const botData = {
        bot,
        config,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        autoFarm: false,
        farmInterval: null,
        survivalInterval: null,
        hasJoined: false,
        isAFK: false,
        inSurvival: false
    };
    
    activeBots.set(botId, botData);

    // Bot event handlers
    bot.on('login', () => {
        console.log(`Bot ${config.username} logged in`);
        io.emit('bot-login', { botId, username: config.username });
        botData.reconnectAttempts = 0; // Reset reconnect attempts on successful login
        botData.isAFK = false; // Reset AFK status
        botData.inSurvival = false; // Reset survival status
        
        // Auto-login sequence
        setTimeout(() => {
            if (config.password) {
                bot.chat(`/login ${config.password}`);
                console.log(`Bot ${config.username} attempted login with password`);
                
                // Wait 3 seconds then switch to survival
                setTimeout(() => {
                    bot.chat('/survival');
                    console.log(`Bot ${config.username} switched to survival mode`);
                }, 3000);
            } else {
                // If no password, just go to survival
                setTimeout(() => {
                    bot.chat('/survival');
                    console.log(`Bot ${config.username} switched to survival mode`);
                }, 1000);
            }
        }, 1000);
    });

    bot.on('spawn', () => {
        console.log(`Bot ${config.username} spawned`);
        io.emit('bot-spawn', { 
            botId, 
            username: config.username,
            position: bot.entity.position
        });
        
        // AFK after 10 seconds if in survival
        setTimeout(() => {
            if (botData.inSurvival && !botData.isAFK && bot.player) {
                bot.chat('/afk');
                console.log(`Bot ${config.username} attempting to go AFK after 10 seconds in survival`);
            }
        }, 10000);
        
        // Set up auto-survival every 10 minutes
        if (botData.survivalInterval) {
            clearInterval(botData.survivalInterval);
        }
        
        botData.survivalInterval = setInterval(() => {
            if (bot.player) {
                bot.chat('/survival');
                console.log(`Bot ${config.username} auto-switched to survival mode`);
                
                // Also try to go AFK after survival command
                setTimeout(() => {
                    if (!botData.isAFK && botData.inSurvival) {
                        bot.chat('/afk');
                        console.log(`Bot ${config.username} attempting to go AFK after auto-survival`);
                    }
                }, 2000);
            }
        }, 10 * 60 * 1000); // 10 minutes
        
        botData.hasJoined = true;
    });

    bot.on('chat', (username, message) => {
        const chatData = {
            botId,
            username,
            message,
            timestamp: new Date().toISOString()
        };
        
        // Filter out system messages and only show important chat
        const isSystemMessage = username === 'Server' || username === 'Sistem' || username === 'System';
        const isImportantMessage = message.includes('joined') || message.includes('left') || 
                                 message.includes('death') || message.includes('achievement');
        
        // Only emit chat if it's not the bot itself and is either player chat or important system messages
        if (username !== config.username && (!isSystemMessage || isImportantMessage)) {
            io.emit('bot-chat', chatData);
            console.log(`[${config.username}] <${username}> ${message}`);
        }
        
        // Check for survival confirmation
        if (message.includes('survival') && (message.includes('berada di') || message.includes('switched to') || message.includes('teleportasi ke'))) {
            botData.inSurvival = true;
            console.log(`Bot ${config.username} confirmed in survival mode`);
            
            // Try to go AFK after confirming survival
            setTimeout(() => {
                if (!botData.isAFK && botData.inSurvival) {
                    bot.chat('/afk');
                    console.log(`Bot ${config.username} attempting to go AFK after survival confirmation`);
                }
            }, 2000);
        }
        
        // Check for AFK confirmation message
        if (message.includes('You are now AFK') || message.includes('Anda sekarang AFK')) {
            botData.isAFK = true;
            console.log(`Bot ${config.username} is now AFK`);
        }
        
        // Check for AFK removal messages
        if (message.includes('You are no longer AFK') || message.includes('Anda tidak lagi AFK')) {
            botData.isAFK = false;
            console.log(`Bot ${config.username} is no longer AFK`);
            
            // Try to go AFK again after 5 seconds
            setTimeout(() => {
                if (!botData.isAFK && botData.inSurvival) {
                    bot.chat('/afk');
                    console.log(`Bot ${config.username} attempting to go AFK again after being unAFK`);
                }
            }, 5000);
        }
        
        // Check if moved to lobby or kicked messages
        if (message.includes('lobby') || message.includes('Lobby') || 
            message.includes('hub') || message.includes('Hub') ||
            message.includes('spawn') || message.includes('Spawn')) {
            botData.inSurvival = false;
            botData.isAFK = false;
            setTimeout(() => {
                bot.chat('/survival');
                console.log(`Bot ${config.username} auto-switched to survival after lobby detection`);
            }, 1000);
        }
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
        
        // Clear intervals before reconnecting
        if (botData.survivalInterval) {
            clearInterval(botData.survivalInterval);
            botData.survivalInterval = null;
        }
        
        // Auto /survival when kicked (likely moved to lobby)
        setTimeout(() => {
            if (bot.player) {
                bot.chat('/survival');
                console.log(`Bot ${config.username} auto-switched to survival after kick`);
            }
        }, 2000);
        
        handleReconnect(botId);
    });

    bot.on('end', () => {
        console.log(`Bot ${config.username} disconnected`);
        io.emit('bot-end', { botId, username: config.username });
        
        // Clear intervals
        if (botData.survivalInterval) {
            clearInterval(botData.survivalInterval);
            botData.survivalInterval = null;
        }
        
        handleReconnect(botId);
    });

    bot.on('error', (err) => {
        console.log(`Bot ${config.username} error:`, err.message);
        io.emit('bot-error', { botId, username: config.username, error: err.message });
        
        // Clear intervals
        if (botData.survivalInterval) {
            clearInterval(botData.survivalInterval);
            botData.survivalInterval = null;
        }
        
        handleReconnect(botId);
    });

    return bot;
}

function handleReconnect(botId) {
    const botData = activeBots.get(botId);
    if (!botData) return;

    // Prevent multiple reconnection attempts
    if (botData.reconnecting) {
        console.log(`Bot ${botData.config.username} already reconnecting, skipping...`);
        return;
    }

    botData.reconnectAttempts++;
    botData.reconnecting = true;
    
    if (botData.reconnectAttempts <= botData.maxReconnectAttempts) {
        console.log(`Attempting to reconnect bot ${botData.config.username} (attempt ${botData.reconnectAttempts}/${botData.maxReconnectAttempts})`);
        
        setTimeout(() => {
            try {
                // Only reconnect if bot is not already connected
                if (!botData.bot || !botData.bot.player) {
                    // Remove old bot completely
                    if (botData.bot) {
                        botData.bot.removeAllListeners();
                        botData.bot.quit();
                    }
                    
                    // Clear intervals
                    if (botData.farmInterval) {
                        clearInterval(botData.farmInterval);
                        botData.farmInterval = null;
                    }
                    if (botData.survivalInterval) {
                        clearInterval(botData.survivalInterval);
                        botData.survivalInterval = null;
                    }
                    
                    // Create new bot with same config
                    createBot(botId, botData.config);
                } else {
                    console.log(`Bot ${botData.config.username} is already connected, skipping reconnection`);
                }
                
                botData.reconnecting = false;
            } catch (error) {
                console.log(`Reconnection failed for ${botData.config.username}:`, error.message);
                io.emit('bot-reconnect-failed', { botId, username: botData.config.username });
                botData.reconnecting = false;
            }
        }, 3000 + (2000 * botData.reconnectAttempts)); // Progressive backoff
    } else {
        console.log(`Max reconnection attempts reached for bot ${botData.config.username}`);
        
        // Clean up before removing
        if (botData.farmInterval) {
            clearInterval(botData.farmInterval);
        }
        if (botData.survivalInterval) {
            clearInterval(botData.survivalInterval);
        }
        
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
