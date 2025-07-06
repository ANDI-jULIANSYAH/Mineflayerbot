
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create database connection
const dbPath = path.join(__dirname, 'playtime.db');
const db = new sqlite3.Database(dbPath);

// Add sample data for testing
function addSampleData() {
    const samplePlayers = ['NayraVxy_', 'NaylaVxy_', 'Master1140ID', 'ayamgoyengenak', 'arapiw'];
    const today = new Date();
    
    samplePlayers.forEach(player => {
        // Add sample daily stats for the last 7 days
        for (let i = 0; i < 7; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            const minutes = Math.floor(Math.random() * 120) + 30; // 30-150 minutes
            const sessions = Math.floor(Math.random() * 5) + 1; // 1-5 sessions
            
            db.run(`INSERT OR IGNORE INTO daily_stats (player_name, date, total_minutes, sessions_count)
                    VALUES (?, ?, ?, ?)`, 
                [player, dateStr, minutes, sessions], 
                (err) => {
                    if (err) console.error('Error adding sample daily stats:', err);
                }
            );
        }
        
        // Add sample chat stats
        for (let i = 0; i < 5; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            const messageCount = Math.floor(Math.random() * 50) + 10; // 10-60 messages
            const sampleMessages = [
                'halo semua!', 'gimana kabarnya?', 'ada yang main bareng?', 
                'server lag nih', 'mantap gamenya', 'ayo pvp!'
            ];
            const lastMessage = sampleMessages[Math.floor(Math.random() * sampleMessages.length)];
            
            db.run(`INSERT OR IGNORE INTO chat_stats (player_name, message_count, last_message, date)
                    VALUES (?, ?, ?, ?)`, 
                [player, messageCount, lastMessage, dateStr], 
                (err) => {
                    if (err) console.error('Error adding sample chat stats:', err);
                }
            );
        }
    });
}

// Initialize database tables
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Table untuk melacak session player
            db.run(`CREATE TABLE IF NOT EXISTS player_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_name TEXT NOT NULL,
                join_time DATETIME NOT NULL,
                leave_time DATETIME,
                duration_minutes INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) {
                    console.error('Error creating player_sessions table:', err);
                    reject(err);
                } else {
                    console.log('Database initialized successfully');
                    // Add sample data for testing
                    setTimeout(() => {
                        addSampleData();
                    }, 1000);
                    resolve();
                }
            });

            // Table untuk statistik harian
            db.run(`CREATE TABLE IF NOT EXISTS daily_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_name TEXT NOT NULL,
                date DATE NOT NULL,
                total_minutes INTEGER DEFAULT 0,
                sessions_count INTEGER DEFAULT 0,
                UNIQUE(player_name, date)
            )`);

            // Table untuk tracking kata kasar
            db.run(`CREATE TABLE IF NOT EXISTS profanity_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_name TEXT NOT NULL,
                word TEXT NOT NULL,
                original_word TEXT NOT NULL,
                count INTEGER DEFAULT 1,
                date DATE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(player_name, word, date)
            )`);

            // Table untuk tracking chat messages
            db.run(`CREATE TABLE IF NOT EXISTS chat_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_name TEXT NOT NULL,
                message_count INTEGER DEFAULT 1,
                last_message TEXT,
                date DATE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(player_name, date)
            )`);

            // Index untuk performa
            db.run(`CREATE INDEX IF NOT EXISTS idx_player_sessions_name ON player_sessions(player_name)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_player_sessions_join_time ON player_sessions(join_time)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_daily_stats_name_date ON daily_stats(player_name, date)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_profanity_stats_player_word ON profanity_stats(player_name, word)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_profanity_stats_date ON profanity_stats(date)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_chat_stats_player_date ON chat_stats(player_name, date)`);
        });
    });
}

// Track player join
function trackPlayerJoin(playerName) {
    return new Promise((resolve, reject) => {
        const joinTime = new Date().toISOString();
        
        db.run(`INSERT INTO player_sessions (player_name, join_time) VALUES (?, ?)`, 
            [playerName, joinTime], 
            function(err) {
                if (err) {
                    console.error('Error tracking player join:', err);
                    reject(err);
                } else {
                    console.log(`[DB] Player ${playerName} joined at ${joinTime}`);
                    resolve(this.lastID);
                }
            }
        );
    });
}

// Track player leave
function trackPlayerLeave(playerName) {
    return new Promise((resolve, reject) => {
        const leaveTime = new Date().toISOString();
        
        // Find the latest unclosed session for this player
        db.get(`SELECT id, join_time FROM player_sessions 
                WHERE player_name = ? AND leave_time IS NULL 
                ORDER BY join_time DESC LIMIT 1`, 
            [playerName], 
            (err, row) => {
                if (err) {
                    console.error('Error finding player session:', err);
                    reject(err);
                    return;
                }

                if (row) {
                    const joinTime = new Date(row.join_time);
                    const leaveTimeDate = new Date(leaveTime);
                    const durationMinutes = Math.floor((leaveTimeDate - joinTime) / (1000 * 60));

                    // Update session with leave time and duration
                    db.run(`UPDATE player_sessions 
                            SET leave_time = ?, duration_minutes = ? 
                            WHERE id = ?`, 
                        [leaveTime, durationMinutes, row.id], 
                        (err) => {
                            if (err) {
                                console.error('Error updating player session:', err);
                                reject(err);
                            } else {
                                console.log(`[DB] Player ${playerName} left. Duration: ${durationMinutes} minutes`);
                                updateDailyStats(playerName, joinTime, durationMinutes);
                                resolve();
                            }
                        }
                    );
                } else {
                    console.log(`[DB] No active session found for player ${playerName}`);
                    resolve();
                }
            }
        );
    });
}

// Update daily statistics
function updateDailyStats(playerName, joinTime, durationMinutes) {
    const date = joinTime.toISOString().split('T')[0]; // Get YYYY-MM-DD format
    
    db.run(`INSERT OR REPLACE INTO daily_stats (player_name, date, total_minutes, sessions_count)
            VALUES (?, ?, 
                COALESCE((SELECT total_minutes FROM daily_stats WHERE player_name = ? AND date = ?), 0) + ?,
                COALESCE((SELECT sessions_count FROM daily_stats WHERE player_name = ? AND date = ?), 0) + 1
            )`, 
        [playerName, date, playerName, date, durationMinutes, playerName, date], 
        (err) => {
            if (err) {
                console.error('Error updating daily stats:', err);
            }
        }
    );
}

// Get weekly playtime statistics
function getWeeklyStats() {
    return new Promise((resolve, reject) => {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const weekAgoStr = oneWeekAgo.toISOString().split('T')[0];

        db.all(`SELECT 
                    player_name,
                    SUM(total_minutes) as total_minutes,
                    SUM(sessions_count) as total_sessions,
                    COUNT(DISTINCT date) as days_played
                FROM daily_stats 
                WHERE date >= ? 
                GROUP BY player_name 
                ORDER BY total_minutes DESC`, 
            [weekAgoStr], 
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        );
    });
}

// Get monthly playtime statistics
function getMonthlyStats() {
    return new Promise((resolve, reject) => {
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        const monthAgoStr = oneMonthAgo.toISOString().split('T')[0];

        db.all(`SELECT 
                    player_name,
                    SUM(total_minutes) as total_minutes,
                    SUM(sessions_count) as total_sessions,
                    COUNT(DISTINCT date) as days_played
                FROM daily_stats 
                WHERE date >= ? 
                GROUP BY player_name 
                ORDER BY total_minutes DESC`, 
            [monthAgoStr], 
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        );
    });
}

// Get top players by playtime
function getTopPlayers(limit = 10) {
    return new Promise((resolve, reject) => {
        db.all(`SELECT 
                    player_name,
                    SUM(total_minutes) as total_minutes,
                    SUM(sessions_count) as total_sessions,
                    COUNT(DISTINCT date) as days_played,
                    MAX(date) as last_played
                FROM daily_stats 
                GROUP BY player_name 
                ORDER BY total_minutes DESC 
                LIMIT ?`, 
            [limit], 
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        );
    });
}

// Daftar kata kasar dan variasinya
const profanityWords = {
    'kontol': ['kontol', 'kntl', 'kontl', 'k0nt0l', 'kont0l'],
    'anjing': ['anjing', 'anjg', 'anj', 'anjeng', 'a5u', 'anying', 'anjir', 'ajg'],
    'babi': ['babi', 'baby', 'b4b1', 'bab1'],
    'puki': ['puki', 'pukimak', 'pukima', 'pki'],
    'goblok': ['goblok', 'goblog', 'gblk', 'gblg', 'tolol', 'tolo', 'tlol', 'idiot', 'idi0t'],
    'fuck': ['fuck', 'fck', 'fuk', 'f*ck', 'fvck'],
    'bitch': ['bitch', 'btch', 'b1tch', 'biatch'],
    'memek': ['memek', 'mmk', 'memk', 'meme', 'mm3k'],
    'ngentol': ['ngentol', 'ngentot', 'ngntl', 'ngnt', 'entot'],
    'bajingan': ['bajingan', 'bjngan', 'bajigan', 'bjgn', 'bejat'],
    'kampret': ['kampret', 'kmprt', 'kampr3t'],
    'kimak': ['kimak', 'kima', 'kim4k'],
    'jancok': ['jancok', 'jancuk', 'janc0k', 'jnck'],
    'bangsat': ['bangsat', 'bngst', 'bangst'],
    'jir': ['jir', 'j1r', 'jiir', 'jiiir']
};

// Track penggunaan kata kasar
function trackProfanity(playerName, message) {
    return new Promise((resolve) => {
        const date = new Date().toISOString().split('T')[0];
        const messageWords = message.toLowerCase().split(/\s+/);
        
        for (const [baseWord, variants] of Object.entries(profanityWords)) {
            for (const word of messageWords) {
                // Cek exact match
                for (const variant of variants) {
                    if (word === variant || word.includes(variant)) {
                        db.run(`INSERT OR REPLACE INTO profanity_stats (player_name, word, original_word, count, date)
                                VALUES (?, ?, ?, 
                                    COALESCE((SELECT count FROM profanity_stats WHERE player_name = ? AND word = ? AND date = ?), 0) + 1,
                                    ?)`, 
                            [playerName, baseWord, word, playerName, baseWord, date, date], 
                            (err) => {
                                if (err) {
                                    console.error('Error tracking profanity:', err);
                                }
                            }
                        );
                        break;
                    }
                }
            }
        }
        resolve();
    });
}

// Get weekly profanity stats
function getWeeklyProfanityStats() {
    return new Promise((resolve, reject) => {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const weekAgoStr = oneWeekAgo.toISOString().split('T')[0];

        db.all(`SELECT 
                    player_name,
                    word,
                    SUM(count) as total_count
                FROM profanity_stats 
                WHERE date >= ? 
                GROUP BY player_name, word 
                ORDER BY total_count DESC`, 
            [weekAgoStr], 
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        );
    });
}

// Get monthly profanity stats
function getMonthlyProfanityStats() {
    return new Promise((resolve, reject) => {
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        const monthAgoStr = oneMonthAgo.toISOString().split('T')[0];

        db.all(`SELECT 
                    player_name,
                    word,
                    SUM(count) as total_count
                FROM profanity_stats 
                WHERE date >= ? 
                GROUP BY player_name, word 
                ORDER BY total_count DESC`, 
            [monthAgoStr], 
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        );
    });
}

// Get top profanity users
function getTopProfanityUsers(limit = 10) {
    return new Promise((resolve, reject) => {
        db.all(`SELECT 
                    player_name,
                    SUM(count) as total_profanity,
                    COUNT(DISTINCT word) as unique_words,
                    MAX(date) as last_used
                FROM profanity_stats 
                GROUP BY player_name 
                ORDER BY total_profanity DESC 
                LIMIT ?`, 
            [limit], 
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        );
    });
}

// Get most used profanity words
function getMostUsedProfanity(limit = 10) {
    return new Promise((resolve, reject) => {
        db.all(`SELECT 
                    word,
                    SUM(count) as total_usage,
                    COUNT(DISTINCT player_name) as users_count
                FROM profanity_stats 
                GROUP BY word 
                ORDER BY total_usage DESC 
                LIMIT ?`, 
            [limit], 
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        );
    });
}

// Track chat messages
function trackChatMessage(playerName, message) {
    return new Promise((resolve, reject) => {
        const date = new Date().toISOString().split('T')[0];
        
        db.run(`INSERT OR REPLACE INTO chat_stats (player_name, message_count, last_message, date)
                VALUES (?, 
                    COALESCE((SELECT message_count FROM chat_stats WHERE player_name = ? AND date = ?), 0) + 1,
                    ?, ?)`, 
            [playerName, playerName, date, message, date], 
            (err) => {
                if (err) {
                    console.error('Error tracking chat message:', err);
                    reject(err);
                } else {
                    resolve();
                }
            }
        );
    });
}

// Get top chatters
function getTopChatters(limit = 10) {
    return new Promise((resolve, reject) => {
        db.all(`SELECT 
                    player_name,
                    SUM(message_count) as total_messages,
                    MAX(date) as last_active,
                    COUNT(DISTINCT date) as days_active
                FROM chat_stats 
                GROUP BY player_name 
                ORDER BY total_messages DESC 
                LIMIT ?`, 
            [limit], 
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        );
    });
}

// Get specific player chat history
function getPlayerChatHistory(playerName, limit = 50) {
    return new Promise((resolve, reject) => {
        db.all(`SELECT 
                    last_message,
                    date,
                    message_count
                FROM chat_stats 
                WHERE player_name = ? 
                ORDER BY date DESC 
                LIMIT ?`, 
            [playerName, limit], 
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        );
    });
}

// Update real-time playtime untuk player yang sedang online
function updateRealTimePlaytime(playerName, currentMinutes) {
    return new Promise((resolve, reject) => {
        const date = new Date().toISOString().split('T')[0];
        
        db.run(`INSERT OR REPLACE INTO daily_stats (player_name, date, total_minutes, sessions_count)
                VALUES (?, ?, ?, 
                    COALESCE((SELECT sessions_count FROM daily_stats WHERE player_name = ? AND date = ?), 0)
                )`, 
            [playerName, date, currentMinutes, playerName, date], 
            (err) => {
                if (err) {
                    console.error('Error updating real-time playtime:', err);
                    reject(err);
                } else {
                    resolve();
                }
            }
        );
    });
}

// Get real-time stats including currently online players
function getRealTimeStats() {
    return new Promise((resolve, reject) => {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const weekAgoStr = oneWeekAgo.toISOString().split('T')[0];

        db.all(`SELECT 
                    player_name,
                    SUM(total_minutes) as total_minutes,
                    SUM(sessions_count) as total_sessions,
                    COUNT(DISTINCT date) as days_played,
                    MAX(date) as last_played
                FROM daily_stats 
                WHERE date >= ? 
                GROUP BY player_name 
                ORDER BY total_minutes DESC`, 
            [weekAgoStr], 
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        );
    });
}

// Close database connection
function closeDatabase() {
    return new Promise((resolve) => {
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
            } else {
                console.log('Database connection closed');
            }
            resolve();
        });
    });
}

module.exports = {
    initializeDatabase,
    trackPlayerJoin,
    trackPlayerLeave,
    updateRealTimePlaytime,
    getRealTimeStats,
    getWeeklyStats,
    getMonthlyStats,
    getTopPlayers,
    trackProfanity,
    getWeeklyProfanityStats,
    getMonthlyProfanityStats,
    getTopProfanityUsers,
    getMostUsedProfanity,
    trackChatMessage,
    getTopChatters,
    getPlayerChatHistory,
    closeDatabase
};
