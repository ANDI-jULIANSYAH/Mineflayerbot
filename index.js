// Cek dan install socket.io otomatis jika belum ada
try {
    require.resolve("socket.io");
} catch (e) {
    console.log("socket.io belum terinstall. Menginstall...");
    const { execSync } = require("child_process");
    execSync("npm install socket.io", { stdio: "inherit" });
    console.log("Install socket.io selesai. Silakan jalankan ulang program.");
    process.exit(0);
}

// Cek dan install mineflayer-pathfinder otomatis jika belum ada
try {
    require.resolve("mineflayer-pathfinder");
} catch (e) {
    console.log("mineflayer-pathfinder belum terinstall. Menginstall...");
    const { execSync } = require("child_process");
    execSync("npm install mineflayer-pathfinder", { stdio: "inherit" });
    console.log("Install mineflayer-pathfinder selesai. Silakan jalankan ulang program.");
    process.exit(0);
}

// Cek dan install mineflayer otomatis jika belum ada
try {
    require.resolve("mineflayer");
} catch (e) {
    console.log("mineflayer belum terinstall. Menginstall...");
    const { execSync } = require("child_process");
    execSync("npm install mineflayer", { stdio: "inherit" });
    console.log("Install mineflayer selesai. Silakan jalankan ulang program.");
    process.exit(0);
}

const mineflayer = require("mineflayer");
const { pathfinder, Movements } = require("mineflayer-pathfinder");
const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// Multi-bot management
let bots = new Map(); // Store all bot instances
let botConfigs = []; // Store bot configurations
let activeBots = 0;
const maxBots = 50;

// Mining management
let miningAreas = new Map(); // Store mining areas for each bot
let miningStates = new Map(); // Store mining states for each bot
const targetPlayer = "ItzAndyka09"; // Target player for TPA and messages

// Default mining areas with coordinates
const defaultMiningAreas = [
    {
        id: "area1",
        name: "Mining Area 1",
        x1: 100,
        y1: 64,
        z1: 100,
        x2: 200,
        y2: 100,
        z2: 200,
    },
    {
        id: "area2",
        name: "Mining Area 2",
        x1: -100,
        y1: 60,
        z1: -100,
        x2: 0,
        y2: 90,
        z2: 0,
    },
    {
        id: "area3",
        name: "Mining Area 3",
        x1: 300,
        y1: 50,
        z1: 300,
        x2: 400,
        y2: 80,
        z2: 400,
    },
];

// Proxy list - tambahkan proxy Anda di sini
const proxyList = [
    null, // No proxy for first bot
    // Contoh proxy - ganti dengan proxy Anda yang sebenarnya
    { host: "103.152.118.13", port: 8080 },
    { host: "113.160.132.195", port: 8080 },
    { host: "51.158.105.94", port: 31826 },
    { host: "51.81.245.3", port: 17981 },
    { host: "103.152.118.17", port: 31005 },
    { host: "43.198.151.41", port: 31005 },
    { host: "43.217.134.23", port: 3128 },
    { host: "3.10.207.94", port: 8000 },
    // Tambahkan lebih banyak proxy sesuai kebutuhan
    // Format dengan auth: { host: 'proxy-host', port: 'proxy-port', username: 'user', password: 'pass' }
    // Format tanpa auth: { host: 'proxy-host', port: 'proxy-port' }
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
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day}(${hours}:${minutes}:${seconds})`;
}

function saveChangelog() {
    if (logBuffer.length === 0 || !startTime) return;
    const changelogDir = ensureChangelogDir();
    const endTime = new Date();
    const filename = `${formatDateTime(startTime)} - ${formatDateTime(endTime)}.txt`;
    const filepath = path.join(changelogDir, filename);
    try {
        fs.writeFileSync(filepath, logBuffer.join("\n"), "utf8");
        console.log(`Changelog saved: ${filename}`);
        logBuffer = [];
    } catch (err) {
        console.log("Error saving changelog:", err);
    }
}

const originalConsoleLog = console.log;
console.log = function (...args) {
    const message = args.join(" ");
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    originalConsoleLog(logEntry);
    if (startTime) {
        logBuffer.push(logEntry);
    }
};

let proxyIndex = 0;

function getNextProxy() {
    if (proxyList.length <= 1) return null;

    // Rotate through available proxies (skip index 0 which is null)
    if (proxyIndex >= proxyList.length - 1) {
        proxyIndex = 1; // Reset to first proxy (skip null)
    } else {
        proxyIndex++;
    }

    return proxyList[proxyIndex];
}

function getRandomProxy() {
    if (proxyList.length <= 1) return null;
    const randomIndex = Math.floor(Math.random() * (proxyList.length - 1)) + 1;
    return proxyList[randomIndex];
}

// Mining helper functions
function checkToolDurability(bot) {
    const heldItem = bot.heldItem;
    if (!heldItem) return { hasTool: false, durability: 0, maxDurability: 0 };

    // Check if it's a pickaxe or shovel
    const isPickaxe = heldItem.name.includes("pickaxe");
    const isShovel = heldItem.name.includes("shovel");

    if (!isPickaxe && !isShovel)
        return { hasTool: false, durability: 0, maxDurability: 0 };

    const maxDurability = heldItem.maxDurability || 1;
    const currentDurability = maxDurability - (heldItem.durabilityUsed || 0);

    return {
        hasTool: true,
        durability: currentDurability,
        maxDurability: maxDurability,
        toolName: heldItem.name,
        isLowDurability: currentDurability <= 10, // Critical when 10 or less
    };
}

function findNearestBlockInArea(bot, area) {
    const playerPos = bot.entity.position;
    let nearestBlock = null;
    let nearestDistance = Infinity;

    // Define area boundaries
    const minX = Math.min(area.x1, area.x2);
    const maxX = Math.max(area.x1, area.x2);
    const minY = Math.min(area.y1, area.y2);
    const maxY = Math.max(area.y1, area.y2);
    const minZ = Math.min(area.z1, area.z2);
    const maxZ = Math.max(area.z1, area.z2);

    // Check if player is within the mining area
    const playerInArea =
        playerPos.x >= minX &&
        playerPos.x <= maxX &&
        playerPos.y >= minY &&
        playerPos.y <= maxY &&
        playerPos.z >= minZ &&
        playerPos.z <= maxZ;

    // Search within a reasonable range near the player
    const searchRadius = playerInArea ? 10 : 3;
    const centerX = Math.floor(playerPos.x);
    const centerY = Math.floor(playerPos.y);
    const centerZ = Math.floor(playerPos.z);

    // Define minable blocks - semua block yang bisa ditambang
    const minableBlocks = [
        "dirt",
        "grass_block",
        "stone",
        "cobblestone",
        "andesite",
        "granite",
        "diorite",
        "gravel",
        "sand",
        "sandstone",
        "coal_ore",
        "iron_ore",
        "gold_ore",
        "diamond_ore",
        "emerald_ore",
        "lapis_ore",
        "redstone_ore",
        "copper_ore",
        "deepslate",
        "deepslate_coal_ore",
        "deepslate_iron_ore",
        "deepslate_gold_ore",
        "deepslate_diamond_ore",
        "deepslate_emerald_ore",
        "deepslate_lapis_ore",
        "deepslate_redstone_ore",
        "deepslate_copper_ore",
        "oak_log",
        "birch_log",
        "spruce_log",
        "jungle_log",
        "acacia_log",
        "dark_oak_log",
        "oak_wood",
        "birch_wood",
        "spruce_wood",
        "jungle_wood",
        "acacia_wood",
        "dark_oak_wood",
        "netherrack",
        "blackstone",
        "basalt",
        "obsidian",
        "calcite",
        "tuff",
        "smooth_basalt",
        "clay",
        "terracotta",
        "white_terracotta",
        "orange_terracotta",
        "magenta_terracotta",
        "light_blue_terracotta",
        "yellow_terracotta",
        "lime_terracotta",
        "pink_terracotta",
        "gray_terracotta",
        "light_gray_terracotta",
        "cyan_terracotta",
        "purple_terracotta",
        "blue_terracotta",
        "brown_terracotta",
        "green_terracotta",
        "red_terracotta",
        "black_terracotta",
    ];

    // Blocks yang tidak boleh ditambang
    const unminableBlocks = [
        "air",
        "void_air",
        "water",
        "lava",
        "flowing_water",
        "flowing_lava",
        "bedrock",
        "barrier",
        "end_portal",
        "end_portal_frame",
        "nether_portal",
        "spawner",
        "chest",
        "trapped_chest",
        "ender_chest",
        "shulker_box",
        "furnace",
        "blast_furnace",
        "smoker",
        "crafting_table",
        "enchanting_table",
        "anvil",
        "beacon",
        "conduit",
    ];

    // If player is not in area, search within the area boundaries
    let searchMinX, searchMaxX, searchMinY, searchMaxY, searchMinZ, searchMaxZ;

    if (playerInArea) {
        searchMinX = Math.max(minX, centerX - searchRadius);
        searchMaxX = Math.min(maxX, centerX + searchRadius);
        searchMinY = Math.max(minY, centerY - 3);
        searchMaxY = Math.min(maxY, centerY + 3);
        searchMinZ = Math.max(minZ, centerZ - searchRadius);
        searchMaxZ = Math.min(maxZ, centerZ + searchRadius);
    } else {
        // Search near the edge of the area closest to the player
        searchMinX = Math.max(minX, Math.min(maxX, centerX - 3));
        searchMaxX = Math.min(maxX, Math.max(minX, centerX + 3));
        searchMinY = Math.max(minY, Math.min(maxY, centerY - 3));
        searchMaxY = Math.min(maxY, Math.max(minY, centerY + 3));
        searchMinZ = Math.max(minZ, Math.min(maxZ, centerZ - 3));
        searchMaxZ = Math.min(maxZ, Math.max(minZ, centerZ + 3));
    }

    // Search for blocks
    for (let y = searchMinY; y <= searchMaxY; y++) {
        for (let x = searchMinX; x <= searchMaxX; x++) {
            for (let z = searchMinZ; z <= searchMaxZ; z++) {
                try {
                    const pos = { x, y, z };
                    const block = bot.blockAt(pos);

                    // Check if block is minable
                    if (block && block.name) {
                        // Either block is in minable list OR not in unminable list (to catch new blocks)
                        const isMinable =
                            minableBlocks.includes(block.name) ||
                            (!unminableBlocks.includes(block.name) &&
                                block.name !== "air" &&
                                !block.name.includes("water") &&
                                !block.name.includes("lava") &&
                                !block.name.includes("portal") &&
                                block.hardness !== null &&
                                block.hardness > 0);

                        if (isMinable) {
                            const distance = Math.sqrt(
                                Math.pow(playerPos.x - x, 2) +
                                    Math.pow(playerPos.y - y, 2) +
                                    Math.pow(playerPos.z - z, 2),
                            );

                            if (distance < nearestDistance) {
                                nearestDistance = distance;
                                nearestBlock = block;
                            }
                        }
                    }
                } catch (err) {
                    // Skip this block if there's an error accessing it
                    continue;
                }
            }
        }
    }

    return nearestBlock;
}

async function startMining(bot, area) {
    const botId = bot.botId;
    console.log(
        `[BOT-${botId}] Starting mining in area: ${area.name} (${area.x1},${area.y1},${area.z1}) to (${area.x2},${area.y2},${area.z2})`,
    );

    miningStates.set(botId, {
        isActive: true,
        area: area,
        blocksMinedCount: 0,
    });

    let noBlocksCount = 0;
    const maxNoBlocksAttempts = 15;

    const miningLoop = async () => {
        const state = miningStates.get(botId);
        if (!state || !state.isActive) return;

        // Check tool durability
        const toolCheck = checkToolDurability(bot);
        if (toolCheck.hasTool && toolCheck.isLowDurability) {
            console.log(
                `[BOT-${botId}] Tool ${toolCheck.toolName} is low on durability (${toolCheck.durability}/${toolCheck.maxDurability})`,
            );

            // Stop mining and notify
            stopMining(bot);
            bot.chat(
                `/msg ${targetPlayer} ${toolCheck.toolName} nak hancur! Durability: ${toolCheck.durability}/${toolCheck.maxDurability}`,
            );
            bot.chat(`/tpa ${targetPlayer}`);

            // Broadcast to web
            io.emit("miningAlert", {
                botId: botId,
                username: bot.config.username,
                message: `Tool ${toolCheck.toolName} hampir hancur!`,
                durability: toolCheck.durability,
                maxDurability: toolCheck.maxDurability,
            });
            return;
        }

        try {
            // Find any minable block in the specified area
            const targetBlock = findNearestBlockInArea(bot, area);

            if (targetBlock) {
                noBlocksCount = 0; // Reset counter when blocks are found
                try {
                    console.log(
                        `[BOT-${botId}] Mining ${targetBlock.name} at (${targetBlock.position.x}, ${targetBlock.position.y}, ${targetBlock.position.z})`,
                    );

                    // Navigate to block if far away - with safe pathfinding
                    const distance = bot.entity.position.distanceTo(
                        targetBlock.position,
                    );
                    if (distance > 4.5) {
                        try {
                            // Stop any current pathfinding before starting new one
                            bot.pathfinder.stop();
                            await new Promise((resolve) =>
                                setTimeout(resolve, 100),
                            );

                            // Use goal-based movement to prevent pathfinder errors
                            const { goals } = require("mineflayer-pathfinder");
                            const goal = new goals.GoalNear(
                                targetBlock.position.x,
                                targetBlock.position.y,
                                targetBlock.position.z,
                                3,
                            );
                            await bot.pathfinder.goto(goal);
                        } catch (pathError) {
                            console.log(
                                `[BOT-${botId}] Pathfinding error, trying direct approach:`,
                                pathError.message,
                            );
                            // If pathfinding fails, try to walk directly
                            await bot.lookAt(targetBlock.position);
                        }
                    }

                    // Look at block before mining
                    await bot.lookAt(targetBlock.position);
                    await bot.dig(targetBlock);

                    state.blocksMinedCount++;
                    miningStates.set(botId, state);

                    // Update mining stats
                    const stats = allBotStats.get(botId);
                    if (stats) {
                        stats.blocksMinedCount = state.blocksMinedCount;
                        allBotStats.set(botId, stats);
                        broadcastStats();
                    }

                    // Small delay between mining
                    setTimeout(() => {
                        if (miningStates.get(botId)?.isActive) {
                            miningLoop();
                        }
                    }, 800);
                } catch (err) {
                    console.log(`[BOT-${botId}] Mining error:`, err.message);
                    // Continue mining after error
                    setTimeout(() => {
                        if (miningStates.get(botId)?.isActive) {
                            miningLoop();
                        }
                    }, 2000);
                }
            } else {
                noBlocksCount++;

                // Only log every 5th attempt to reduce spam
                if (noBlocksCount % 5 === 1) {
                    console.log(
                        `[BOT-${botId}] No blocks found in mining area (attempt ${noBlocksCount}/${maxNoBlocksAttempts})`,
                    );
                }

                // If no blocks found after many attempts, try moving to different positions in area
                if (noBlocksCount >= maxNoBlocksAttempts) {
                    console.log(
                        `[BOT-${botId}] Moving to explore different part of mining area...`,
                    );
                    try {
                        // Stop current pathfinding
                        bot.pathfinder.stop();
                        await new Promise((resolve) =>
                            setTimeout(resolve, 200),
                        );

                        // Move to random position within area
                        const randomX =
                            area.x1 + Math.random() * (area.x2 - area.x1);
                        const randomY =
                            area.y1 + Math.random() * (area.y2 - area.y1);
                        const randomZ =
                            area.z1 + Math.random() * (area.z2 - area.z1);

                        const { goals } = require("mineflayer-pathfinder");
                        const goal = new goals.GoalNear(
                            Math.floor(randomX),
                            Math.floor(randomY),
                            Math.floor(randomZ),
                            2,
                        );
                        await bot.pathfinder.goto(goal);

                        noBlocksCount = 0; // Reset counter after moving
                        console.log(
                            `[BOT-${botId}] Moved to new position, continuing mining...`,
                        );
                    } catch (moveErr) {
                        console.log(
                            `[BOT-${botId}] Error moving within area:`,
                            moveErr.message,
                        );
                        noBlocksCount = Math.max(0, noBlocksCount - 5); // Reduce counter but don't reset completely
                    }
                }

                // Wait and try again
                setTimeout(() => {
                    if (miningStates.get(botId)?.isActive) {
                        miningLoop();
                    }
                }, 2000);
            }
        } catch (err) {
            console.log(`[BOT-${botId}] Fatal mining error:`, err.message);
            // Try to continue mining instead of stopping completely
            setTimeout(() => {
                if (miningStates.get(botId)?.isActive) {
                    console.log(
                        `[BOT-${botId}] Attempting to resume mining after error...`,
                    );
                    miningLoop();
                }
            }, 5000);
        }
    };

    miningLoop();
}

function stopMining(bot) {
    const botId = bot.botId;
    const state = miningStates.get(botId);
    if (state) {
        state.isActive = false;
        miningStates.set(botId, state);
        console.log(`[BOT-${botId}] Mining stopped`);

        // Update stats
        const stats = allBotStats.get(botId);
        stats.miningStatus = "Stopped";
        allBotStats.set(botId, stats);
        broadcastStats();
    }
}

function createBot(config) {
    const botId = config.id;
    // Use sequential proxy assignment for better distribution
    const proxy = config.useProxy !== false ? getNextProxy() : null;

    const botOptions = {
        host: config.host || "localmc.club",
        port: config.port || 23028,
        username: config.username,
        version: config.version || "1.18.2",
        viewDistance: 12,
    };

    // Add proxy if available
    if (proxy) {
        try {
            const HttpsProxyAgent = require("https-proxy-agent");
            const SocksProxyAgent = require("socks-proxy-agent");

            // Determine proxy type and create appropriate agent
            if (proxy.type === "socks" || proxy.type === "socks5") {
                // SOCKS proxy
                const proxyUrl =
                    proxy.username && proxy.password
                        ? `socks5://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
                        : `socks5://${proxy.host}:${proxy.port}`;
                botOptions.agent = new SocksProxyAgent(proxyUrl);
            } else {
                // HTTP/HTTPS proxy
                const proxyUrl =
                    proxy.username && proxy.password
                        ? `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
                        : `http://${proxy.host}:${proxy.port}`;
                botOptions.agent = new HttpsProxyAgent(proxyUrl);
            }

            console.log(
                `[BOT-${botId}] Using proxy: ${proxy.host}:${proxy.port} (${proxy.type || "http"})`,
            );
        } catch (err) {
            console.log(
                `[BOT-${botId}] Proxy setup failed, using direct connection:`,
                err.message,
            );
        }
    } else {
        console.log(`[BOT-${botId}] Using direct connection (no proxy)`);
    }

    const bot = mineflayer.createBot(botOptions);

    // Initialize bot stats
    allBotStats.set(botId, {
        id: botId,
        username: config.username,
        health: 0,
        food: 0,
        ping: 0,
        status: "Connecting",
        onlinePlayers: [],
        proxy: proxy
            ? `${proxy.host}:${proxy.port} (${proxy.type || "http"})`
            : "Direct",
        miningStatus: "Idle",
        blocksMinedCount: 0,
        toolDurability: { durability: 0, maxDurability: 0, toolName: "None" },
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
        stats.status = "Online";
        allBotStats.set(botId, stats);
        broadcastStats();
    });

    bot.on("spawn", () => {
        console.log(`[BOT-${botId}] spawned in`);

        // Load pathfinder
        bot.loadPlugin(pathfinder);
        const movements = new Movements(bot);
        bot.pathfinder.setMovements(movements);

        bot.chat(
            config.password ? `/login ${config.password}` : "/login MASTER09",
        );
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

        // Filter spam messages (health/mana status)
        const isSpamMessage = messageText.match(
            /^\d+\/\d+❤\s+\d+\/\d+\s+Mana$/,
        );

        if (!isSpamMessage) {
            console.log(`[BOT-${botId}] [MESSAGE]`, messageText);
        }

        // Chat trigger actions
        if (messageText.includes("bone_reload")) {
            console.log(`[BOT-${botId}] Detected bone_reload command`);
            bot.chat(
                "/r baik bot akan segera melakukan home bonemeal dan auto",
            );
            setTimeout(async () => {
                bot.chat("/home bonemeal");
                console.log(`[BOT-${botId}] Executed /home bonemeal`);
                setTimeout(async () => {
                    await executeAutoShop(bot);
                }, 2000);
            }, 1000);
        }

        // Deteksi pesan pembelian shop dan tutup chest jika terbuka
        if (messageText.includes("Shop > You bought") && bot.currentWindow) {
            bot.closeWindow(bot.currentWindow);
            console.log(
                `[BOT-${botId}] Chest otomatis ditutup setelah pembelian.`,
            );
        }

        // Deteksi inventory penuh dari pesan server
        if (
            messageText.includes(
                "Shop > You don't have enough free space in your inventory.",
            )
        ) {
            console.log(
                `[BOT-${botId}] Deteksi inventory penuh dari pesan server, drop semua item...`,
            );
            await autoDropAll(bot);
        }

        // Handle drop command from ItzAndyka09
        if (
            messageText.includes(`${targetPlayer} whispers to you: drop`) ||
            messageText.includes(`[${targetPlayer} -> me] drop`)
        ) {
            console.log(
                `[BOT-${botId}] Received drop command from ${targetPlayer}`,
            );
            await autoDropAll(bot);
            bot.chat(`/msg ${targetPlayer} Tools dan items sudah di-drop!`);
        }

        // Update online players list for this bot
        if (
            messageText.includes("memasuki permainan") ||
            messageText.includes("joined the game")
        ) {
            updateOnlinePlayers(botId);
        }

        // Broadcast message to web clients
        io.emit("chatMessage", {
            botId: botId,
            username: config.username,
            timestamp: new Date().toISOString(),
            message: messageText,
        });
    });

    bot.on("end", (reason) => {
        console.log(`[BOT-${botId}] Disconnected. Reason:`, reason);
        const stats = allBotStats.get(botId);
        stats.status = "Disconnected";
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
        stats.status = "Kicked";
        allBotStats.set(botId, stats);
        broadcastStats();
    });

    bot.on("error", (err) => {
        console.log(`[BOT-${botId}] Error:`, err);
        const stats = allBotStats.get(botId);
        stats.status = "Error";
        allBotStats.set(botId, stats);
        broadcastStats();
    });

    return bot;
}

// Simpan changelog setiap 5 menit
setInterval(saveChangelog, 300000);

process.on("SIGINT", () => {
    console.log("\nReceived SIGINT. Saving changelog...");
    saveChangelog();
    process.exit(0);
});
process.on("SIGTERM", () => {
    console.log("\nReceived SIGTERM. Saving changelog...");
    saveChangelog();
    process.exit(0);
});

// Fitur chat dari console
const readline = require("readline");
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

rl.on("line", async (input) => {
    if (input.startsWith("/dropall")) {
        const args = input.split(" ");
        const botId = args[1] || "all";

        if (botId === "all") {
            for (const [id, bot] of bots) {
                await autoDropAll(bot);
            }
        } else {
            const bot = bots.get(botId);
            if (bot) {
                await autoDropAll(bot);
            } else {
                console.log(`Bot ${botId} tidak ditemukan.`);
            }
        }
        return;
    }

    if (input.startsWith("/auto")) {
        const args = input.split(" ");
        const botId = args[1] || "all";

        if (botId === "all") {
            for (const [id, bot] of bots) {
                executeAutoShop(bot);
            }
        } else {
            const bot = bots.get(botId);
            if (bot) {
                await executeAutoShop(bot);
            } else {
                console.log(`Bot ${botId} tidak ditemukan.`);
            }
        }
        return;
    }

    if (input.startsWith("/list")) {
        console.log("Active bots:");
        for (const [id, bot] of bots) {
            const stats = allBotStats.get(id);
            console.log(`- Bot ${id}: ${stats.username} (${stats.status})`);
        }
        return;
    }

    if (input.startsWith("/mine")) {
        const args = input.split(" ");
        const botId = args[1];
        const areaId = args[2] || "area1";

        // Find area by ID or use default
        let area = defaultMiningAreas.find((a) => a.id === areaId);
        if (!area) {
            area = defaultMiningAreas[0]; // Use first area as default
            console.log(
                `Area ${areaId} tidak ditemukan, menggunakan ${area.name}`,
            );
        }

        if (botId === "all") {
            for (const [id, bot] of bots) {
                await startMining(bot, area);
            }
        } else {
            const bot = bots.get(botId);
            if (bot) {
                await startMining(bot, area);
            } else {
                console.log(`Bot ${botId} tidak ditemukan.`);
            }
        }
        console.log(
            `Available areas: ${defaultMiningAreas.map((a) => `${a.id}(${a.name})`).join(", ")}`,
        );
        return;
    }

    if (input.startsWith("/addarea")) {
        const args = input.split(" ");
        if (args.length < 8) {
            console.log(
                "Usage: /addarea <id> <name> <x1> <y1> <z1> <x2> <y2> <z2>",
            );
            console.log(
                'Example: /addarea area4 "Custom Area" 500 64 500 600 100 600',
            );
            return;
        }

        const newArea = {
            id: args[1],
            name: args[2].replace(/"/g, ""),
            x1: parseInt(args[3]),
            y1: parseInt(args[4]),
            z1: parseInt(args[5]),
            x2: parseInt(args[6]),
            y2: parseInt(args[7]),
            z2: parseInt(args[8]),
        };

        defaultMiningAreas.push(newArea);
        console.log(
            `Area ${newArea.name} ditambahkan: (${newArea.x1},${newArea.y1},${newArea.z1}) to (${newArea.x2},${newArea.y2},${newArea.z2})`,
        );
        return;
    }

    if (input.startsWith("/areas")) {
        console.log("Available mining areas:");
        defaultMiningAreas.forEach((area) => {
            console.log(
                `- ${area.id}: ${area.name} (${area.x1},${area.y1},${area.z1}) to (${area.x2},${area.y2},${area.z2})`,
            );
        });
        return;
    }

    if (input.startsWith("/stopmining")) {
        const args = input.split(" ");
        const botId = args[1] || "all";

        if (botId === "all") {
            for (const [id, bot] of bots) {
                stopMining(bot);
            }
        } else {
            const bot = bots.get(botId);
            if (bot) {
                stopMining(bot);
            } else {
                console.log(`Bot ${botId} tidak ditemukan.`);
            }
        }
        return;
    }

    // Default: chat ke semua bot atau bot spesifik
    const args = input.split(" ");
    if (args[0].startsWith("@")) {
        const botId = args[0].substring(1);
        const message = args.slice(1).join(" ");
        const bot = bots.get(botId);
        if (bot) {
            bot.chat(message);
            console.log(`[CONSOLE CHAT to BOT-${botId}] ${message}`);
        } else {
            console.log(`Bot ${botId} tidak ditemukan.`);
        }
    } else {
        // Chat ke semua bot
        for (const [id, bot] of bots) {
            bot.chat(input);
        }
        console.log(`[CONSOLE CHAT to ALL] ${input}`);
    }
});

function waitWindowOpen(bot, timeout = 5000) {
    return new Promise((resolve, reject) => {
        let timer = setTimeout(() => {
            bot.removeListener("windowOpen", onOpen);
            reject(new Error("Timeout menunggu window terbuka"));
        }, timeout);
        function onOpen(window) {
            clearTimeout(timer);
            resolve(window);
        }
        bot.once("windowOpen", onOpen);
    });
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function autoDropAll(bot) {
    const items = bot.inventory.items();
    if (items.length === 0) {
        console.log(`[BOT-${bot.botId}] Inventory kosong.`);
        return;
    }
    for (const item of items) {
        await bot.tossStack(item);
        console.log(`[BOT-${bot.botId}] Drop ${item.name} x${item.count}`);
    }
    console.log(`[BOT-${bot.botId}] Semua item sudah di-drop.`);
}

// Serve static files
app.use(express.static("public"));

// API endpoints
app.get("/api/stats", (req, res) => {
    const statsArray = Array.from(allBotStats.values());
    res.json(statsArray);
});

app.get("/api/bots", (req, res) => {
    const botsInfo = Array.from(bots.entries()).map(([id, bot]) => ({
        id: id,
        username: bot.config.username,
        status: allBotStats.get(id)?.status || "Unknown",
    }));
    res.json(botsInfo);
});

// Socket.io connection
io.on("connection", (socket) => {
    console.log("Client connected to web interface");

    // Send current stats to new client
    socket.emit("allStatsUpdate", Array.from(allBotStats.values()));

    // Handle bot creation from web
    socket.on("createBot", (config) => {
        if (bots.size >= maxBots) {
            socket.emit("error", "Maximum bot limit reached");
            return;
        }

        const botId = Date.now().toString();
        config.id = botId;
        config.autoReconnect = config.autoReconnect || false;
        config.useProxy = config.useProxy !== false; // Default to true unless explicitly disabled

        const bot = createBot(config);
        bots.set(botId, bot);
        botConfigs.push(config);
        activeBots++;

        socket.emit("botCreated", { id: botId, config: config });
        broadcastStats();
    });

    // Handle bot removal
    socket.on("removeBot", (botId) => {
        const bot = bots.get(botId);
        if (bot) {
            bot.end();
            bots.delete(botId);
            allBotStats.delete(botId);
            botConfigs = botConfigs.filter((config) => config.id !== botId);
            activeBots--;
            socket.emit("botRemoved", botId);
            broadcastStats();
        }
    });

    // Handle chat messages from web interface
    socket.on("sendChat", (data) => {
        const { botId, message } = data;
        if (botId === "all") {
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

    // Handle TPA to ItzAndyka09
    socket.on("sendTPA", (data) => {
        const { botId } = data;
        if (botId === "all") {
            for (const [id, bot] of bots) {
                bot.chat(`/tpa ${targetPlayer}`);
            }
            console.log(`[WEB TPA to ALL] /tpa ${targetPlayer}`);
        } else {
            const bot = bots.get(botId);
            if (bot) {
                bot.chat(`/tpa ${targetPlayer}`);
                console.log(`[WEB TPA to BOT-${botId}] /tpa ${targetPlayer}`);
            }
        }
    });

    // Handle mining commands from web
    socket.on("startMining", async (data) => {
        const { botId, areaId, customArea } = data;

        // Use custom area if provided, otherwise find from defaults
        let area;
        if (customArea) {
            area = customArea;
        } else {
            area =
                defaultMiningAreas.find((a) => a.id === areaId) ||
                defaultMiningAreas[0];
        }

        if (botId === "all") {
            for (const [id, bot] of bots) {
                await startMining(bot, area);
            }
        } else {
            const bot = bots.get(botId);
            if (bot) {
                await startMining(bot, area);
            }
        }
    });

    // Get available mining areas
    socket.on("getMiningAreas", () => {
        socket.emit("miningAreas", defaultMiningAreas);
    });

    // Add new mining area
    socket.on("addMiningArea", (areaData) => {
        const newArea = {
            id: areaData.id || `area${defaultMiningAreas.length + 1}`,
            name: areaData.name,
            x1: parseInt(areaData.x1),
            y1: parseInt(areaData.y1),
            z1: parseInt(areaData.z1),
            x2: parseInt(areaData.x2),
            y2: parseInt(areaData.y2),
            z2: parseInt(areaData.z2),
        };

        defaultMiningAreas.push(newArea);
        io.emit("miningAreas", defaultMiningAreas);
        socket.emit("areaAdded", newArea);
    });

    socket.on("stopMining", (data) => {
        const { botId } = data;
        if (botId === "all") {
            for (const [id, bot] of bots) {
                stopMining(bot);
            }
        } else {
            const bot = bots.get(botId);
            if (bot) {
                stopMining(bot);
            }
        }
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected from web interface");
    });
});

// Helper functions
async function executeAutoShop(bot) {
    let loop = 0;
    const maxLoop = 500;
    console.log(
        `[BOT-${bot.botId}] Memulai auto shop mobdrops sebanyak ${maxLoop} kali...`,
    );
    for (loop = 1; loop <= maxLoop; loop++) {
        try {
            console.log(`[BOT-${bot.botId}] Loop ke-${loop}`);
            bot.chat("/shop mobdrops");
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
            console.log(
                `[BOT-${bot.botId}] Error pada loop ke-${loop}:`,
                err.message,
            );
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

    // Update tool durability
    const toolCheck = checkToolDurability(bot);
    stats.toolDurability = {
        durability: toolCheck.durability,
        maxDurability: toolCheck.maxDurability,
        toolName: toolCheck.toolName || "None",
    };

    // Update mining status
    const miningState = miningStates.get(botId);
    stats.miningStatus = miningState?.isActive ? "Mining" : "Idle";

    allBotStats.set(botId, stats);
    broadcastStats();
}

function updateOnlinePlayers(botId) {
    const bot = bots.get(botId);
    if (!bot) return;

    const stats = allBotStats.get(botId);
    stats.onlinePlayers = Object.keys(bot.players).map((playerName) => {
        const player = bot.players[playerName];
        return {
            name: playerName,
            ping: player.ping || 0,
        };
    });

    allBotStats.set(botId, stats);
    broadcastStats();
}

function broadcastStats() {
    io.emit("allStatsUpdate", Array.from(allBotStats.values()));
}

server.listen(PORT, "0.0.0.0", () =>
    console.log(`Web server running on port ${PORT}`),
);

// Start with one default bot
setTimeout(() => {
    const defaultConfig = {
        id: "default",
        username: "Master1140ID",
        password: "MASTER09",
        host: "localmc.club",
        port: 23028,
        version: "1.18.2",
        autoReconnect: true,
    };

    const bot = createBot(defaultConfig);
    bots.set("default", bot);
    botConfigs.push(defaultConfig);
    activeBots++;
}, 1000);
