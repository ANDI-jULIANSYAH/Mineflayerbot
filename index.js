
const mineflayer = require("mineflayer");
const fs = require("fs");
const path = require("path");

let startTime = null;
let logBuffer = [];
let reconnectAttempts = 0;
const maxReconnectAttempts = 50;
const reconnectCooldown = 5000; // 5 detik

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

let globalBot = null; // Untuk akses bot dari stdin

function createBot() {
    const bot = mineflayer.createBot({
        host: "localmc.club",
        port: 23028, // ganti sesuai port server kamu
        username: "Master1140ID",
        version: "1.18.2",
        viewDistance: 12
    });

    globalBot = bot; // Simpan bot ke variabel global

    bot.on("login", () => {
        if (!startTime) {
            startTime = new Date();
            logBuffer = [];
        }
        console.log("Berhasil Login");
        reconnectAttempts = 0;
    });

    bot.on("spawn", () => {
        console.log("spawned in");
        bot.chat("/login MASTER09");
        setTimeout(() => {
            bot.chat("/survival");
            console.log("[AUTOMATED] Auto /survival on spawn");
        }, 2000);
    });

    bot.on("message", async (message) => {
        console.log("[MESSAGE]", message.toString());
        // Deteksi pesan pembelian shop dan tutup chest jika terbuka
        if (
            message.toString().includes("Shop > You bought") &&
            globalBot.currentWindow
        ) {
            globalBot.closeWindow(globalBot.currentWindow);
            console.log("[AUTO] Chest otomatis ditutup setelah pembelian.");
        }

        // Deteksi inventory penuh dari pesan server
        if (message.toString().includes("Shop > You don't have enough free space in your inventory.")) {
            console.log("[AUTO] Deteksi inventory penuh dari pesan server, drop semua item...");
            await autoDropAll();
        }
    });

    bot.on("end", (reason) => {
        console.log("Disconnected. Reason:", reason);
        saveChangelog();
        if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            console.log(`Attempting to reconnect... (${reconnectAttempts}/${maxReconnectAttempts})`);
            setTimeout(() => {
                createBot();
            }, reconnectCooldown);
        } else {
            console.log("Max reconnection attempts reached. Bot will not reconnect automatically.");
        }
    });

    bot.on("kicked", (reason) => {
        console.log("Kicked:", reason);
        saveChangelog();
    });

    bot.on("error", (err) => {
        console.log("Error:", err);
        if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
            console.log("Network error detected, will attempt to reconnect...");
        }
    });

    bot._client.on("packet_sent", (data, meta) => {
        if (meta.name === "chat_message") {
            console.log("Mengirim chat:", data);
        }
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
    if (!globalBot) {
        console.log('Bot belum siap.');
        return;
    }

    if (input.startsWith('/dropall')) {
        // Drop semua item di inventory
        const items = globalBot.inventory.items();
        if (items.length === 0) {
            console.log('Inventory kosong.');
            return;
        }
        (async () => {
            for (const item of items) {
                await globalBot.tossStack(item);
                console.log(`Drop ${item.name} x${item.count}`);
            }
            console.log('Semua item sudah di-drop.');
        })();
        return;
    }

    // Cek jika inventory penuh (otomatis drop)
    if (globalBot.inventory.items().length >= globalBot.inventory.slots.length - 9) {
        console.log('[AUTO] Inventory penuh, drop semua item...');
        await autoDropAll();
    }

    // CEK MODE
    if (input.startsWith('/cek')) {
        if (globalBot.currentWindow) {
            console.log('[CEK] Bot sedang membuka inventory/chest. Berikut isinya:');
            // printInventory(globalBot.currentWindow); // Hapus jika printInventory dihapus
        } else {
            console.log('[CEK] Bot TIDAK sedang membuka inventory/chest.');
        }
        return;
    }

    // Fitur auto shop mobdrops
    if (input.startsWith('/auto')) {
        let loop = 0;
        const maxLoop = 5000;
        console.log(`[AUTO] Memulai auto shop mobdrops sebanyak ${maxLoop} kali...`);
        for (loop = 1; loop <= maxLoop; loop++) {
            try {
                console.log(`[AUTO] Loop ke-${loop}`);
                globalBot.chat('/shop mobdrops');
                // Tunggu window terbuka
                const window = await waitWindowOpen(4500);
                printChest(window, '[AUTO] Data chest awal:');

                // Klik slot 20
                await globalBot.clickWindow(11, 0, 0);
                await delay(800);
                printChest(window, '[AUTO] Setelah klik slot 11:');

                await globalBot.clickWindow(31, 0, 0);
                await delay(500);
                printChest(window, '[AUTO] Setelah klik slot 31:');

                // Klik slot 8
                await globalBot.clickWindow(8, 0, 0);
                await delay(500);
                printChest(window, '[AUTO] Setelah klik slot 8:');

                // Tutup window
                globalBot.closeWindow(window);
                await delay(1000);
            } catch (err) {
                console.log(`[AUTO] Error pada loop ke-${loop}:`, err.message);
                break;
            }
        }
        console.log('[AUTO] Selesai auto shop mobdrops.');
        return;
    }

    // Default: chat ke server
    globalBot.chat(input);
    console.log(`[CONSOLE CHAT] ${input}`);
});

function waitWindowOpen(timeout = 5000) {
    return new Promise((resolve, reject) => {
        let timer = setTimeout(() => {
            globalBot.removeListener('windowOpen', onOpen);
            reject(new Error('Timeout menunggu window terbuka'));
        }, timeout);
        function onOpen(window) {
            clearTimeout(timer);
            resolve(window);
        }
        globalBot.once('windowOpen', onOpen);
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function printChest(window, prefix = '') {
    if (!window) {
        console.log(prefix, '[CHEST] Tidak ada window terbuka.');
        return;
    }
    const items = window.slots.map((item, i) => item ? `[${i}] ${item.name} x${item.count}` : `[${i}] kosong`);
    console.log(prefix, '[CHEST]', items.join(' | '));
}

async function autoDropAll() {
    const items = globalBot.inventory.items();
    if (items.length === 0) {
        console.log('[AUTO] Inventory kosong.');
        return;
    }
    for (const item of items) {
        await globalBot.tossStack(item);
        console.log(`[AUTO] Drop ${item.name} x${item.count}`);
    }
    console.log('[AUTO] Semua item sudah di-drop.');
}

createBot();

client.login(process.env.Dtoken)
catch(error => {
    console.log('cant login');
})