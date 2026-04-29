const TelegramBot = require("node-telegram-bot-api");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const BOT_TOKEN           = "8605121015:AAGyhOqPIbewK8JQ4PK_ASF-iPn6t5g3Oek";
const ADMIN_ID            = 8521844327;
const GROUP_ID            = -1003890515710;
const PLATFORM_CUT_PERCENT = 5;
// ─────────────────────────────────────────────────────────────────────────────

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("🚀 LudoAdda Bot is running...");

// ─── IN-MEMORY STORE ──────────────────────────────────────────────────────────
let users              = {};
let tables             = {};
let pendingDeposits    = {};
let pendingWithdrawals = {};
let pendingWinClaims   = {};
let botOnline          = true;
let adminState         = {};
let userState          = {};
let tableCounter       = 1;
let txnCounter         = 1;
let claimCounter       = 1;

// ─── GLOBAL STATS TRACKER ─────────────────────────────────────────────────────
// Tracks lifetime + per-match stats for bot status panel
let stats = {
  totalMatches      : 0,   // all completed matches ever
  totalPot          : 0,   // total pot amount across all completed matches
  totalCommission   : 0,   // total platform cut collected
  completedMatches  : [],  // array of { completedAt, pot, commission } for 24h filtering
  activeUsers24h    : {},  // { userId: lastActiveTimestamp } — updated on any game action
};

function recordMatchCompletion(pot, commission) {
  stats.totalMatches++;
  stats.totalPot        += pot;
  stats.totalCommission += commission;
  stats.completedMatches.push({ completedAt: Date.now(), pot, commission });
}

function markUserActive(userId) {
  stats.activeUsers24h[userId] = Date.now();
}

function get24hStats() {
  const since = Date.now() - 24 * 60 * 60 * 1000;

  const recent = stats.completedMatches.filter(m => m.completedAt >= since);
  const matches24h    = recent.length;
  const pot24h        = recent.reduce((s, m) => s + m.pot, 0);
  const commission24h = recent.reduce((s, m) => s + m.commission, 0);
  const activeUsers   = Object.values(stats.activeUsers24h).filter(t => t >= since).length;

  return { matches24h, pot24h, commission24h, activeUsers };
}


// ─── HELPERS ──────────────────────────────────────────────────────────────────
const isAdmin = (id) => id === ADMIN_ID;

function registerUser(msg) {
  const id = msg.chat.id;
  if (!users[id]) {
    users[id] = {
      name          : `${msg.from.first_name} ${msg.from.last_name || ""}`.trim(),
      username      : msg.from.username || "N/A",
      balance       : 1000,
      gamesPlayed   : 0,
      gamesWon      : 0,
      status        : "idle",
      tableId       : null,
      hasDeposited  : false,   // FIX #3: track if user ever deposited
    };
  }
}

function ensureUser(from) {
  if (!users[from.id]) {
    users[from.id] = {
      name          : `${from.first_name} ${from.last_name || ""}`.trim(),
      username      : from.username || "N/A",
      balance       : 1000,
      gamesPlayed   : 0,
      gamesWon      : 0,
      status        : "idle",
      tableId       : null,
      hasDeposited  : false,
    };
  }
  return users[from.id];
}

const genTableId = () => `T-${String(tableCounter++).padStart(4, "0")}`;
const genTxnId   = () => `TXN-${String(txnCounter++).padStart(5, "0")}`;
const genClaimId = () => `CLM-${String(claimCounter++).padStart(4, "0")}`;

// FIX #4: gameLabel — clarify Goti labels as game modes, not player count
function gameLabel(t) {
  const map = {
    quick   : "Quick Ludo",
    classic : "Classic Ludo",
    popular : "Popular Ludo",
    // Goti mode labels (game modes, always 2 players)
    classic_1goti : "Classic Ludo — 1 Goti Mode",
    classic_2goti : "Classic Ludo — 2 Goti Mode",
    classic_3goti : "Classic Ludo — 3 Goti Mode",
    classic_4goti : "Classic Ludo — 4 Goti Mode",
  };
  return map[t] || t;
}

// Safe display name — no special chars that break Markdown
function dname(chatId) {
  const u = users[chatId];
  if (!u) return String(chatId);
  return u.username !== "N/A" ? `@${u.username}` : u.name;
}

// ─── MENUS ────────────────────────────────────────────────────────────────────
function mainMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "👤 Profile" }, { text: "💰 Deposit" }],
        [{ text: "⚡ Quick Ludo" }, { text: "🎲 Classic Ludo" }, { text: "🏆 Popular Ludo" }],
        [{ text: "🤝 Refer & Earn" }, { text: "💸 Withdraw" }],
        [{ text: "🆘 Support" }],
      ],
      resize_keyboard : true,
      persistent      : true,
    },
  };
}

function adminMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "📢 Broadcast" }, { text: "📊 Bot Status" }],
        [{ text: "💰 Balance Update" }, { text: "⚙️ Control Panel" }],
        [{ text: "🏠 Exit Admin Panel" }],
      ],
      resize_keyboard: true,
    },
  };
}

function controlMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "👤 MSG User" }, { text: botOnline ? "🔴 Turn Bot OFF" : "🟢 Turn Bot ON" }, { text: "👥 All Users" }],
        [{ text: "📋 Open Tables" }, { text: "🏧 Pending Withdrawals" }],
        [{ text: "💳 Pending Deposits" }, { text: "🏆 Win Claims" }],
        [{ text: "🔙 Back to Admin" }],
      ],
      resize_keyboard: true,
    },
  };
}

const cancelKb = (label = "❌ Cancel") => ({
  reply_markup: {
    keyboard         : [[{ text: label }]],
    resize_keyboard  : true,
    one_time_keyboard: true,
  },
});

function send(chatId, text, extra = {}) {
  return bot.sendMessage(chatId, text, extra).catch(err =>
    console.error(`sendMessage to ${chatId} failed:`, err.message)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  MATCHMAKING
// ─────────────────────────────────────────────────────────────────────────────

function handleJoin(chatId, gameType, entryFee) {
  const user = users[chatId];
  if (!user) return;

  if (user.status !== "idle") {
    send(chatId, `⚠️ You already have an active session (${user.status}).\n\nFinish or cancel it first.`);
    return;
  }
  if (user.balance < entryFee) {
    send(chatId,
      `❌ Insufficient Balance!\n\nEntry Fee: ₹${entryFee}\nYour Balance: ₹${user.balance}\n\nPlease deposit first.`,
      mainMenu());
    return;
  }

  const pot         = entryFee * 2;
  const platformCut = Math.floor(pot * PLATFORM_CUT_PERCENT / 100);
  const winnerGets  = pot - platformCut;

  // Look for an open table with same game + fee
  const match = Object.values(tables).find(
    t => t.gameType === gameType &&
         t.entryFee === entryFee &&
         t.status   === "open"   &&
         t.creatorId !== chatId
  );

  if (match) {
    // ── MATCH FOUND ──────────────────────────────────────────────────────────
    user.balance   -= entryFee;
    user.status     = "waiting";
    user.tableId    = match.tableId;

    markUserActive(chatId);
    markUserActive(match.creatorId);

    if (match.expireTimer) { clearTimeout(match.expireTimer); match.expireTimer = null; }

    match.opponentId = chatId;
    match.status     = "pending_accept";

    // Edit group post
    if (match.groupMsgId) {
      bot.editMessageText(
        `Table ${match.tableId} — Match Found!\n\n${gameLabel(gameType)} | Entry ₹${entryFee}\n${dname(match.creatorId)} vs ${dname(chatId)}`,
        { chat_id: GROUP_ID, message_id: match.groupMsgId }
      ).catch(() => {});
      bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: GROUP_ID, message_id: match.groupMsgId }
      ).catch(() => {});
    }

    // Notify creator
    send(match.creatorId,
      `🎯 Opponent Found!\n\n` +
      `Game: ${gameLabel(gameType)}\n` +
      `Opponent: ${dname(chatId)}\n` +
      `Entry: ₹${entryFee} | Pot: ₹${pot}\n` +
      `Winner Gets: ₹${winnerGets}\n\n` +
      `Waiting for opponent to accept...`);

    // Send Accept/Decline to opponent
    send(chatId,
      `🎯 Match Found!\n\n` +
      `Game: ${gameLabel(gameType)}\n` +
      `Creator: ${dname(match.creatorId)}\n` +
      `Entry: ₹${entryFee} (deducted) | Pot: ₹${pot}\n` +
      `Winner Gets: ₹${winnerGets}\n\n` +
      `Accept within 2 minutes!`,
      {
        reply_markup: { inline_keyboard: [[
          { text: "✅ Accept", callback_data: `accept_${match.tableId}` },
          { text: "❌ Decline", callback_data: `decline_${match.tableId}` },
        ]]},
      });

    match.acceptTimer = setTimeout(() => timeoutPendingAccept(match.tableId), 120_000);

  } else {
    // ── NO MATCH: create open table ──────────────────────────────────────────
    const tableId = genTableId();

    user.balance -= entryFee;
    user.status   = "waiting";
    user.tableId  = tableId;

    markUserActive(chatId);

    tables[tableId] = {
      tableId, gameType, entryFee, pot, platformCut, winnerGets,
      creatorId   : chatId,
      opponentId  : null,
      status      : "open",
      roomCode    : null,
      groupMsgId  : null,
      expireTimer : null,
      acceptTimer : null,
      lossReports : [],
      createdAt   : new Date(),
    };

    send(chatId,
      `✅ Table Created!\n\n` +
      `Table ID: ${tableId}\n` +
      `Game: ${gameLabel(gameType)}\n` +
      `Entry Fee: ₹${entryFee} (deducted)\n` +
      `Winner Gets: ₹${winnerGets}\n\n` +
      `Searching for opponent in group...`,
      {
        reply_markup: { inline_keyboard: [[
          { text: "❌ Cancel Table", callback_data: `creator_cancel_${tableId}` },
        ]]},
      });

    // Post in group
    bot.sendMessage(GROUP_ID,
      `🎮 New Table — Opponent Needed!\n\n` +
      `Table: ${tableId}\n` +
      `Game: ${gameLabel(gameType)}\n` +
      `Creator: ${dname(chatId)}\n` +
      `Entry: ₹${entryFee} | Pot: ₹${pot}\n` +
      `Winner Gets: ₹${winnerGets}\n\n` +
      `Tap below to join!`,
      {
        reply_markup: { inline_keyboard: [[
          { text: `✅ Join Table (₹${entryFee})`, callback_data: `group_join_${tableId}` },
        ]]},
      }
    ).then(sent => {
      const t = tables[tableId];
      if (!t) return;
      t.groupMsgId  = sent.message_id;
      t.expireTimer = setTimeout(() => expireOpenTable(tableId), 600_000);
    }).catch(() => {});
  }
}

// ─── EXPIRE open table after 10 min ──────────────────────────────────────────
function expireOpenTable(tableId) {
  const t = tables[tableId];
  if (!t || t.status !== "open") return;
  t.status = "cancelled";
  const u = users[t.creatorId];
  if (u) { u.balance += t.entryFee; u.status = "idle"; u.tableId = null; }

  send(t.creatorId,
    `⏰ Table Expired!\n\nNo one joined ${tableId} within 10 minutes.\nRefund: ₹${t.entryFee} | Balance: ₹${users[t.creatorId]?.balance}`,
    mainMenu());

  if (t.groupMsgId) {
    bot.editMessageText(`❌ Table ${tableId} expired — no opponent found.`,
      { chat_id: GROUP_ID, message_id: t.groupMsgId }).catch(() => {});
    bot.editMessageReplyMarkup({ inline_keyboard: [] },
      { chat_id: GROUP_ID, message_id: t.groupMsgId }).catch(() => {});
  }
}

// ─── TIMEOUT pending_accept ───────────────────────────────────────────────────
function timeoutPendingAccept(tableId) {
  const t = tables[tableId];
  if (!t || t.status !== "pending_accept") return;
  t.status = "cancelled";
  [t.creatorId, t.opponentId].forEach(pid => {
    if (!pid || !users[pid]) return;
    users[pid].balance += t.entryFee;
    users[pid].status   = "idle";
    users[pid].tableId  = null;
    send(pid,
      `⏰ Match timed out!\n\nOpponent did not respond in time.\nRefund: ₹${t.entryFee} | Balance: ₹${users[pid].balance}`,
      mainMenu());
  });
}

// ─── STEP 2: Opponent accepted → ask creator for room code ───────────────────
function askCreatorForRoomCode(tableId) {
  const t = tables[tableId];
  if (!t) return;
  t.status = "room_pending";
  userState[t.creatorId] = { action: "send_room_code", tableId };
  send(t.creatorId,
    `✅ Opponent Accepted!\n\n` +
    `Opponent: ${dname(t.opponentId)}\n` +
    `Table: ${tableId}\n\n` +
    `Please type and send your Room Code from the Ludo app:`,
    cancelKb("❌ Cancel Game"));
}

// ─── STEP 3: Creator sends room code → forward to opponent with Start button ──
function sendRoomCodeToOpponent(tableId, code) {
  const t = tables[tableId];
  if (!t) return;
  t.status   = "room_shared";
  t.roomCode = code;

  send(t.creatorId,
    `📤 Room code sent to opponent!\n\nCode: ${code}\n\nWaiting for opponent to join and press Start...`,
    mainMenu());

  send(t.opponentId,
    `🔑 Room Code Received!\n\n` +
    `Table: ${tableId}\n` +
    `Creator: ${dname(t.creatorId)}\n` +
    `Room Code: ${code}\n\n` +
    `Enter this code in your Ludo app, then tap Start!`,
    {
      reply_markup: { inline_keyboard: [[
        { text: "▶️ Start Game", callback_data: `start_game_${tableId}` },
      ]]},
    });
}

// ─── STEP 4: Opponent presses Start → activate game ──────────────────────────
function activateGame(tableId) {
  const t = tables[tableId];
  if (!t) return;
  t.status = "active";
  [t.creatorId, t.opponentId].forEach(pid => {
    if (!users[pid]) return;
    users[pid].status  = "in-game";
    users[pid].tableId = tableId;
    markUserActive(pid);
  });

  const names = `${dname(t.creatorId)} vs ${dname(t.opponentId)}`;
  const resultButtons = {
    reply_markup: { inline_keyboard: [[
      { text: "🏆 I Won",  callback_data: `claim_win_${tableId}` },
      { text: "😔 I Lost", callback_data: `claim_loss_${tableId}` },
    ]]},
  };

  send(t.creatorId,
    `🎮 Match Started!\n\n` +
    `Table: ${tableId}\n` +
    `Players: ${names}\n` +
    `Pot: ₹${t.pot} | Prize: ₹${t.winnerGets}\n` +
    `Room Code: ${t.roomCode}\n\n` +
    `Good luck! Tap your result after the game:`,
    resultButtons);

  send(t.opponentId,
    `🎮 Game is ON!\n\n` +
    `Table: ${tableId}\n` +
    `Players: ${names}\n` +
    `Pot: ₹${t.pot} | Prize: ₹${t.winnerGets}\n\n` +
    `Good luck! Tap your result after the game:`,
    resultButtons);

  if (GROUP_ID) {
    bot.sendMessage(GROUP_ID,
      `🎮 Game Started!\nTable: ${tableId} | ${gameLabel(t.gameType)}\nPlayers: ${names}\nPrize: ₹${t.winnerGets}`
    ).catch(() => {});
  }

  bot.sendMessage(ADMIN_ID,
    `New Active Table: ${tableId}\nPlayers: ${names}\nPot: ₹${t.pot}\nRoom: ${t.roomCode}`,
    {
      reply_markup: { inline_keyboard: [[
        { text: "🏆 Declare Winner", callback_data: `declare_winner_${tableId}` },
        { text: "🚫 Cancel Table",   callback_data: `cancel_table_${tableId}` },
      ]]},
    }
  ).catch(() => {});
}

// ─── DECLARE WINNER ───────────────────────────────────────────────────────────
function declareWinner(tableId, winnerId) {
  const t = tables[tableId];
  if (!t) return;
  clearTimeout(t.acceptTimer);
  t.status = "completed";
  t.winner = winnerId;

  users[winnerId].balance  += t.winnerGets;
  users[winnerId].gamesWon += 1;

  [t.creatorId, t.opponentId].forEach(pid => {
    if (!pid || !users[pid]) return;
    users[pid].gamesPlayed += 1;
    users[pid].status       = "idle";
    users[pid].tableId      = null;
  });

  // Record global stats
  recordMatchCompletion(t.pot, t.platformCut);

  const winnerName = users[winnerId]?.name || "Unknown";
  const names      = `${users[t.creatorId]?.name || t.creatorId} vs ${users[t.opponentId]?.name || t.opponentId}`;

  [t.creatorId, t.opponentId].forEach(pid => {
    if (!pid) return;
    send(pid,
      pid === winnerId
        ? `🏆 You Won!\n\nTable: ${tableId}\nPrize: ₹${t.winnerGets}\nNew Balance: ₹${users[pid].balance}`
        : `😔 You Lost!\n\nTable: ${tableId}\nWinner: ${winnerName}\n\nBetter luck next time!`,
      mainMenu());
  });

  if (GROUP_ID) {
    bot.sendMessage(GROUP_ID,
      `🏆 Game Result!\nTable: ${tableId} | ${names}\nWinner: ${winnerName} | Prize: ₹${t.winnerGets}`
    ).catch(() => {});
  }

  bot.sendMessage(ADMIN_ID,
    `Table ${tableId} completed.\nWinner: ${winnerName} | ₹${t.winnerGets} paid.`
  ).catch(() => {});
}

// ─── CANCEL TABLE ─────────────────────────────────────────────────────────────
function cancelTable(tableId, reason) {
  const t = tables[tableId];
  if (!t || ["completed", "cancelled"].includes(t.status)) return;
  clearTimeout(t.acceptTimer);
  clearTimeout(t.expireTimer);
  t.status = "cancelled";

  [t.creatorId, t.opponentId].forEach(pid => {
    if (!pid || !users[pid]) return;
    users[pid].balance += t.entryFee;
    users[pid].status   = "idle";
    users[pid].tableId  = null;
    send(pid,
      `Table ${tableId} was ${reason}.\nRefund: ₹${t.entryFee} | Balance: ₹${users[pid].balance}`,
      mainMenu());
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  /start  /admin
// ─────────────────────────────────────────────────────────────────────────────
bot.onText(/\/start/, msg => {
  const chatId = msg.chat.id;
  registerUser(msg);
  if (isAdmin(chatId)) {
    send(chatId, "👑 Welcome Admin!", adminMenu());
    return;
  }
  if (!botOnline) { send(chatId, "🔴 Bot is offline for maintenance. Try again later."); return; }
  send(chatId,
    `🎲 Welcome to Ludo Adda, ${msg.from.first_name}!\n\nPlay Ludo, win real money!\n\nChoose an option:`,
    mainMenu());
});

bot.onText(/\/admin/, msg => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) { send(chatId, "❌ Not authorized."); return; }
  send(chatId, "👑 Admin Panel", adminMenu());
});

// ─────────────────────────────────────────────────────────────────────────────
//  MESSAGE HANDLER
// ─────────────────────────────────────────────────────────────────────────────
bot.on("message", msg => {
  const chatId = msg.chat.id;
  const text   = msg.text;
  if (!text || text.startsWith("/")) return;
  registerUser(msg);

  // ══════════════════════ ADMIN ══════════════════════════════════════════════
  if (isAdmin(chatId)) {
    const st = adminState[chatId];

    if (st) {
      if (text === "❌ Cancel") {
        delete adminState[chatId];
        send(chatId, "❌ Cancelled.", adminMenu());
        return;
      }

      if (st.action === "broadcast") {
        let n = 0;
        Object.keys(users).forEach(uid => {
          if (+uid !== ADMIN_ID) { bot.sendMessage(uid, `📢 Message from Admin:\n\n${text}`).catch(() => {}); n++; }
        });
        delete adminState[chatId];
        send(chatId, `✅ Broadcast sent to ${n} users.`, adminMenu());
        return;
      }

      if (st.action === "msg_user_id") {
        const tid = +text;
        if (!users[tid]) { send(chatId, `❌ User ${text} not found.`); delete adminState[chatId]; return; }
        adminState[chatId] = { action: "msg_user_text", targetId: tid };
        send(chatId, `User: ${users[tid].name}\n\nNow send the message:`, cancelKb());
        return;
      }

      if (st.action === "msg_user_text") {
        bot.sendMessage(st.targetId, `📢 Message from Admin:\n\n${text}`)
          .then(() => send(chatId, "✅ Message sent.", adminMenu()))
          .catch(() => send(chatId, "❌ Failed to send.", adminMenu()));
        delete adminState[chatId];
        return;
      }

      if (st.action === "bal_id") {
        const tid = +text;
        if (!users[tid]) { send(chatId, `❌ User ${text} not found.`); delete adminState[chatId]; return; }
        adminState[chatId] = { action: "bal_type", targetId: tid };
        send(chatId,
          `User: ${users[tid].name}\nBalance: ₹${users[tid].balance}\n\nChoose action:`,
          {
            reply_markup: { inline_keyboard: [[
              { text: "➕ Add",    callback_data: `bal_add_${tid}` },
              { text: "➖ Deduct", callback_data: `bal_ded_${tid}` },
              { text: "❌ Cancel", callback_data: "bal_cancel"     },
            ]]},
          });
        return;
      }

      if (st.action === "bal_add" || st.action === "bal_ded") {
        const amt   = parseFloat(text);
        if (isNaN(amt) || amt <= 0) { send(chatId, "❌ Invalid amount."); return; }
        const tid   = st.targetId;
        const isAdd = st.action === "bal_add";
        if (!isAdd && users[tid].balance < amt) {
          send(chatId, `❌ Balance too low (₹${users[tid].balance}).`);
          delete adminState[chatId];
          return;
        }
        users[tid].balance += isAdd ? amt : -amt;
        send(chatId,
          `✅ ₹${amt} ${isAdd ? "added to" : "deducted from"} ${users[tid].name}\nNew balance: ₹${users[tid].balance}`,
          adminMenu());
        send(tid, `💰 Balance Update!\n\n${isAdd ? "+" : "-"}₹${amt}\nNew Balance: ₹${users[tid].balance}`);
        delete adminState[chatId];
        return;
      }

      if (st.action === "declare_winner") {
        const tid = +text;
        const t   = tables[st.tableId];
        if (!t || ![t.creatorId, t.opponentId].includes(tid)) {
          send(chatId, `❌ Not a valid player ID for table ${st.tableId}.`);
          return;
        }
        declareWinner(st.tableId, tid);
        delete adminState[chatId];
        return;
      }
    }

    // ── Admin menu buttons ──────────────────────────────────────────────────
    if (text === "📢 Broadcast") {
      adminState[chatId] = { action: "broadcast" };
      const n = Object.keys(users).filter(id => +id !== ADMIN_ID).length;
      send(chatId, `Send broadcast to ${n} users:`, cancelKb());
      return;
    }
    if (text === "👤 MSG User") {
      adminState[chatId] = { action: "msg_user_id" };
      send(chatId, "Enter User ID:", cancelKb());
      return;
    }
    if (text === "💰 Balance Update") {
      adminState[chatId] = { action: "bal_id" };
      send(chatId, "Enter User ID:", cancelKb());
      return;
    }
    if (text === "⚙️ Control Panel") {
      send(chatId, "⚙️ Control Panel", controlMenu());
      return;
    }
    if (text === "🔙 Back to Admin") {
      send(chatId, "👑 Admin Panel", adminMenu());
      return;
    }

    // ── FIX #1: Enhanced Bot Status ─────────────────────────────────────────
    if (text === "📊 Bot Status") {
      const active     = Object.values(tables).filter(t => t.status === "active").length;
      const open       = Object.values(tables).filter(t => t.status === "open").length;
      const pDep       = Object.values(pendingDeposits).filter(d => d.status === "pending").length;
      const pWdl       = Object.values(pendingWithdrawals).filter(w => w.status === "pending").length;
      const pClaim     = Object.values(pendingWinClaims).filter(c => c.status === "pending").length;
      const totalUsers = Object.keys(users).filter(id => +id !== ADMIN_ID).length;
      const s24        = get24hStats();

      send(chatId,
        `📊 Bot Status\n\n` +
        `Status: ${botOnline ? "🟢 Online" : "🔴 Offline"}\n` +
        `Total Users: ${totalUsers}\n` +
        `Total Matches: ${stats.totalMatches}\n` +
        `Total Pot Amount: ₹${stats.totalPot}\n` +
        `Total Commission: ₹${stats.totalCommission}\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `⏰ Last 24 Hours\n` +
        `Active Users: ${s24.activeUsers}\n` +
        `Matches Played: ${s24.matches24h}\n` +
        `Total Pot: ₹${s24.pot24h}\n` +
        `Commission Earned: ₹${s24.commission24h}\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Active Tables (live): ${active}\n` +
        `Open Tables (waiting): ${open}\n\n` +
        `Pending Deposits: ${pDep}\n` +
        `Pending Withdrawals: ${pWdl}\n` +
        `Win Claims: ${pClaim}`);
      return;
    }

    if (text === "🔴 Turn Bot OFF" || text === "🟢 Turn Bot ON") {
      botOnline = !botOnline;
      send(chatId, botOnline ? "🟢 Bot is now ONLINE!" : "🔴 Bot is now OFFLINE!", controlMenu());
      return;
    }
    if (text === "👥 All Users") {
      const all = Object.keys(users).filter(id => +id !== ADMIN_ID);
      if (!all.length) { send(chatId, "No users yet."); return; }
      const chunks = [];
      for (let i = 0; i < all.length; i += 50) chunks.push(all.slice(i, i + 50));
      chunks.forEach((ch, idx) => {
        let m = idx === 0 ? `All Users (${all.length}):\n\n` : `Continued...\n\n`;
        ch.forEach(id => {
          const u = users[id];
          m += `ID: ${id} | ${u.name} | Balance: ₹${u.balance} | ${u.status}\n`;
        });
        send(chatId, m);
      });
      return;
    }
    if (text === "📋 Open Tables") {
      const open = Object.values(tables).filter(t => t.status === "open");
      if (!open.length) { send(chatId, "No open tables."); return; }
      let m = `Open Tables (${open.length}):\n\n`;
      open.forEach(t => {
        m += `${t.tableId} | ${gameLabel(t.gameType)} | ₹${t.entryFee} | Creator: ${users[t.creatorId]?.name || t.creatorId}\n`;
      });
      send(chatId, m);
      return;
    }
    if (text === "💳 Pending Deposits") {
      const pd = Object.values(pendingDeposits).filter(d => d.status === "pending");
      if (!pd.length) { send(chatId, "No pending deposits."); return; }
      pd.forEach(dep => {
        const u   = users[dep.chatId];
        const cap = `Deposit Request\n\nTXN: ${dep.txnId}\nUser: ${u?.name || "Unknown"} (${dep.chatId})\nUsername: @${u?.username || "N/A"}\nAmount: ₹${dep.amount}\nTime: ${new Date(dep.timestamp).toLocaleString("en-IN")}`;
        const btns = {
          reply_markup: { inline_keyboard: [[
            { text: "✅ Approve", callback_data: `dep_approve_${dep.txnId}` },
            { text: "❌ Reject",  callback_data: `dep_reject_${dep.txnId}` },
          ]]},
        };
        if (dep.screenshotFileId) {
          bot.sendPhoto(chatId, dep.screenshotFileId, { caption: cap, ...btns }).catch(() =>
            send(chatId, cap, btns));
        } else {
          send(chatId, cap, btns);
        }
      });
      return;
    }
    if (text === "🏧 Pending Withdrawals") {
      const pw = Object.values(pendingWithdrawals).filter(w => w.status === "pending");
      if (!pw.length) { send(chatId, "No pending withdrawals."); return; }
      pw.forEach(w => {
        send(chatId,
          `Withdrawal Request\n\nTXN: ${w.txnId}\nUser: ${users[w.chatId]?.name || "Unknown"} (${w.chatId})\nAmount: ₹${w.amount}\nUPI: ${w.upiId}`,
          {
            reply_markup: { inline_keyboard: [[
              { text: "✅ Mark Paid", callback_data: `wdl_done_${w.txnId}` },
              { text: "❌ Reject",    callback_data: `wdl_rej_${w.txnId}` },
            ]]},
          });
      });
      return;
    }
    if (text === "🏆 Win Claims") {
      const pc = Object.values(pendingWinClaims).filter(c => c.status === "pending");
      if (!pc.length) { send(chatId, "No pending win claims."); return; }
      pc.forEach(claim => {
        const t   = tables[claim.tableId];
        const opp = t
          ? [t.creatorId, t.opponentId].filter(p => p && p !== claim.claimerId).map(p => users[p]?.name || p).join(", ")
          : "N/A";
        const cap = `Win Claim\n\nClaim: ${claim.claimId}\nTable: ${claim.tableId}\nClaimer: ${users[claim.claimerId]?.name || "Unknown"} (${claim.claimerId})\nvs: ${opp}\nPrize: ₹${t?.winnerGets || "?"}`;
        const btns = {
          reply_markup: { inline_keyboard: [[
            { text: "✅ Approve Win", callback_data: `win_approve_${claim.claimId}` },
            { text: "❌ Reject",      callback_data: `win_reject_${claim.claimId}` },
          ]]},
        };
        if (claim.screenshotFileId) {
          bot.sendPhoto(chatId, claim.screenshotFileId, { caption: cap, ...btns }).catch(() =>
            send(chatId, cap, btns));
        } else {
          send(chatId, cap, btns);
        }
      });
      return;
    }
    if (text === "🏠 Exit Admin Panel") {
      send(chatId, "Switched to user view.", mainMenu());
      return;
    }

    send(chatId, "Use the admin panel buttons.", adminMenu());
    return;
  }

  // ══════════════════════ USER ═══════════════════════════════════════════════
  if (!botOnline) { send(chatId, "🔴 Bot is offline for maintenance."); return; }

  if (text === "❌ Cancel Deposit") {
    if (userState[chatId]?.action === "deposit_screenshot") {
      delete userState[chatId];
      send(chatId, "❌ Deposit cancelled.", mainMenu());
    }
    return;
  }

  if (text === "❌ Cancel Game") {
    const st = userState[chatId];
    if (st?.action === "send_room_code") {
      const tableId = st.tableId;
      delete userState[chatId];
      cancelTable(tableId, "cancelled by creator");
    }
    return;
  }

  if (text === "❌ Cancel") {
    delete userState[chatId];
    send(chatId, "❌ Cancelled.", mainMenu());
    return;
  }

  const st = userState[chatId];
  if (st) {
    if (st.action === "send_room_code") {
      const t = tables[st.tableId];
      if (!t || t.status !== "room_pending") {
        delete userState[chatId];
        send(chatId, "⚠️ Table no longer available.", mainMenu());
        return;
      }
      delete userState[chatId];
      sendRoomCodeToOpponent(st.tableId, text.trim());
      return;
    }

    if (st.action === "deposit_screenshot") {
      send(chatId, "📸 Please send a screenshot IMAGE, not text.\n\nTap Cancel Deposit to cancel.");
      return;
    }

    if (st.action === "win_proof_screenshot") {
      send(chatId, "📸 Please send a screenshot IMAGE as proof, not text.");
      return;
    }

    if (st.action === "withdraw_upi") {
      const { amount } = st;
      if ((users[chatId]?.balance || 0) < amount) {
        send(chatId, `❌ Insufficient balance! You have ₹${users[chatId]?.balance || 0}`, mainMenu());
        delete userState[chatId];
        return;
      }
      const txnId = genTxnId();
      users[chatId].balance -= amount;
      pendingWithdrawals[txnId] = { txnId, chatId, amount, upiId: text.trim(), status: "pending", timestamp: new Date() };
      delete userState[chatId];

      send(chatId,
        `✅ Withdrawal Submitted!\n\nTXN: ${txnId}\nAmount: ₹${amount}\nUPI: ${text.trim()}\n\nBalance: ₹${users[chatId].balance}\n\nAdmin will process within 24 hours.`,
        mainMenu());

      bot.sendMessage(ADMIN_ID,
        `New Withdrawal Request!\n\nTXN: ${txnId}\nUser: ${users[chatId]?.name} (${chatId})\nAmount: ₹${amount}\nUPI: ${text.trim()}`,
        {
          reply_markup: { inline_keyboard: [[
            { text: "✅ Mark Paid", callback_data: `wdl_done_${txnId}` },
            { text: "❌ Reject",    callback_data: `wdl_rej_${txnId}` },
          ]]},
        }
      ).catch(() => {});
      return;
    }
  }

  // ── Main menu buttons ──────────────────────────────────────────────────────
  if (text === "💰 Deposit") {
    send(chatId, "💰 Deposit\n\nChoose amount:", {
      reply_markup: { inline_keyboard: [
        [{ text: "₹50",   callback_data: "deposit_50" },   { text: "₹100", callback_data: "deposit_100" }, { text: "₹200", callback_data: "deposit_200" }],
        [{ text: "₹500",  callback_data: "deposit_500" },  { text: "₹1000", callback_data: "deposit_1000" }],
        [{ text: "❌ Cancel", callback_data: "back_menu" }],
      ]},
    });
    return;
  }

  // ── FIX #3: Withdrawal eligibility check ──────────────────────────────────
  if (text === "💸 Withdraw") {
    const u = users[chatId];
    const gamesPlayed = u?.gamesPlayed || 0;
    const hasDeposited = u?.hasDeposited || false;

    if (gamesPlayed < 2 && !hasDeposited) {
      send(chatId,
        `❌ Withdrawal Not Available Yet!\n\n` +
        `To unlock withdrawals, you need to:\n` +
        `• Play at least 2 matches, OR\n` +
        `• Make at least 1 deposit\n\n` +
        `Your Progress:\n` +
        `Matches Played: ${gamesPlayed}/2\n` +
        `Deposits Made: ${hasDeposited ? "Yes ✅" : "No ❌"}`,
        mainMenu());
      return;
    }

    send(chatId, `💸 Withdraw\n\nYour Balance: ₹${u?.balance || 0}\nMinimum: ₹100`, {
      reply_markup: { inline_keyboard: [
        [{ text: "₹100", callback_data: "withdraw_100" }, { text: "₹200", callback_data: "withdraw_200" }, { text: "₹500", callback_data: "withdraw_500" }],
        [{ text: "₹1000", callback_data: "withdraw_1000" }],
        [{ text: "❌ Cancel", callback_data: "back_menu" }],
      ]},
    });
    return;
  }

  if (text === "⚡ Quick Ludo") {
    send(chatId, "⚡ Quick Ludo\n\nFast-paced 2-player games!\n\nChoose entry fee:", {
      reply_markup: { inline_keyboard: [
        [{ text: "₹50", callback_data: "join_quick_50" },   { text: "₹100", callback_data: "join_quick_100" }, { text: "₹200", callback_data: "join_quick_200" }],
        [{ text: "₹250", callback_data: "join_quick_250" }, { text: "₹500", callback_data: "join_quick_500" }],
        [{ text: "❌ Cancel", callback_data: "back_menu" }],
      ]},
    });
    return;
  }

  // ── FIX #4: Classic Ludo — Goti = game mode, always 2 players ─────────────
  if (text === "🎲 Classic Ludo") {
    send(chatId,
      `🎲 Classic Ludo — Choose Goti Mode\n\n` +
      `ℹ️ Goti = number of tokens per player (game mode)\n` +
      `All matches are 2 players.\n\n` +
      `Select your Goti mode:`,
      {
        reply_markup: { inline_keyboard: [
          [
            { text: "1 Goti", callback_data: "classic_1goti" },
            { text: "2 Goti", callback_data: "classic_2goti" },
            { text: "3 Goti", callback_data: "classic_3goti" },
            { text: "4 Goti", callback_data: "classic_4goti" },
          ],
          [{ text: "❌ Cancel", callback_data: "back_menu" }],
        ]},
      });
    return;
  }

  if (text === "🏆 Popular Ludo") {
    send(chatId, "🏆 Popular Ludo\n\nHigh-stakes 2-player games!\n\nChoose entry fee:", {
      reply_markup: { inline_keyboard: [
        [{ text: "₹50",   callback_data: "join_popular_50" },   { text: "₹100",  callback_data: "join_popular_100" },  { text: "₹200",  callback_data: "join_popular_200" }],
        [{ text: "₹500",  callback_data: "join_popular_500" },  { text: "₹1000", callback_data: "join_popular_1000" }],
        [{ text: "❌ Cancel", callback_data: "back_menu" }],
      ]},
    });
    return;
  }

  if (text === "👤 Profile") {
    const u  = users[chatId] || {};
    const pd = Object.values(pendingDeposits).find(d => d.chatId === chatId && d.status === "pending");
    const em = { idle: "😴", waiting: "⏳", "in-game": "🎮" }[u.status] || "😴";
    send(chatId,
      `Your Profile\n\n` +
      `ID: ${chatId}\n` +
      `Name: ${u.name || "N/A"}\n` +
      `Username: @${u.username || "N/A"}\n\n` +
      `Balance: ₹${u.balance || 0}\n` +
      `Games Played: ${u.gamesPlayed || 0}\n` +
      `Games Won: ${u.gamesWon || 0}\n` +
      `Status: ${em} ${u.status || "idle"}` +
      (pd ? `\n\nPending Deposit: ₹${pd.amount} (TXN: ${pd.txnId})` : ""),
      mainMenu());
    return;
  }

  if (text === "🤝 Refer & Earn") {
    send(chatId,
      `🤝 Refer and Earn\n\nEarn ₹20 for each friend who joins!\n\nYour link: https://t.me/LudoAddaBot?start=${chatId}`);
    return;
  }

  if (text === "🆘 Support") {
    send(chatId, "🆘 Support\n\nChoose an option:", {
      reply_markup: { inline_keyboard: [
        [{ text: "📞 Contact Admin", url: "https://t.me/MARKS_CS" }],
        [{ text: "❓ FAQ", callback_data: "faq" }],
        [{ text: "🐛 Report a Bug", callback_data: "bug" }],
        [{ text: "🔙 Back", callback_data: "back_menu" }],
      ]},
    });
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  CALLBACK QUERY HANDLER
// ─────────────────────────────────────────────────────────────────────────────
bot.on("callback_query", query => {
  // ── FIX #2: group_join_ comes from GROUP chat — get user id from query.from,
  //   not query.message.chat.id (which is the GROUP id in group messages).
  //   For all other callbacks the message is in a private chat so chat.id == user id.
  //   We resolve the correct userId here once and use it throughout.
  const data   = query.data;
  const msgId  = query.message.message_id;

  // For group_join, the real user is query.from.id; the chat is the group.
  // For all private-chat callbacks, query.message.chat.id is also the user.
  const isGroupCallback = query.message.chat.type !== "private";
  const chatId = isGroupCallback ? query.from.id : query.message.chat.id;
  const groupChatId = query.message.chat.id; // used only for group message edits

  bot.answerCallbackQuery(query.id).catch(() => {});

  // ── join_<gameType>_<fee> ─────────────────────────────────────────────────
  if (data.startsWith("join_")) {
    const parts    = data.split("_");      // ["join", gameType, fee]
    const gameType = parts[1];
    const fee      = parseInt(parts[2]);
    if (!isGroupCallback) bot.deleteMessage(chatId, msgId).catch(() => {});
    handleJoin(chatId, gameType, fee);
    return;
  }

  // ── FIX #4: classic_<n>goti → fee menu (Goti = game mode) ────────────────
  if (data.startsWith("classic_") && data.endsWith("goti")) {
    const gotiMode = data; // e.g. "classic_1goti"
    if (!isGroupCallback) bot.deleteMessage(chatId, msgId).catch(() => {});
    const gotiLabel = data.replace("classic_", "").replace("goti", "") + " Goti";
    send(chatId,
      `🎲 Classic Ludo — ${gotiLabel} Mode\n(2 players | choose entry fee):`,
      {
        reply_markup: { inline_keyboard: [
          [
            { text: "₹50",  callback_data: `join_classic_50`  },
            { text: "₹100", callback_data: `join_classic_100` },
            { text: "₹200", callback_data: `join_classic_200` },
          ],
          [
            { text: "₹250", callback_data: `join_classic_250` },
            { text: "₹500", callback_data: `join_classic_500` },
          ],
          [{ text: "🔙 Back", callback_data: "back_menu" }],
        ]},
      });
    return;
  }

  // ── FIX #2: GROUP JOIN — properly handled with correct userId ─────────────
  if (data.startsWith("group_join_")) {
    const tableId = data.replace("group_join_", "");
    const t       = tables[tableId];

    if (!t || t.status !== "open") {
      bot.answerCallbackQuery(query.id, { text: "This table is no longer available.", show_alert: true }).catch(() => {});
      return;
    }

    // chatId here is query.from.id (the user who tapped in the group)
    ensureUser(query.from);
    const user = users[chatId];

    if (chatId === t.creatorId) {
      bot.answerCallbackQuery(query.id, { text: "You can't join your own table!", show_alert: true }).catch(() => {});
      return;
    }
    if (user.status !== "idle") {
      bot.answerCallbackQuery(query.id, { text: `You are already in a session (${user.status}). Finish it first.`, show_alert: true }).catch(() => {});
      return;
    }
    if (user.balance < t.entryFee) {
      bot.answerCallbackQuery(query.id, { text: `Insufficient balance! You need ₹${t.entryFee}. Please deposit first.`, show_alert: true }).catch(() => {});
      return;
    }

    user.balance  -= t.entryFee;
    user.status    = "waiting";
    user.tableId   = tableId;
    t.opponentId   = chatId;
    t.status       = "pending_accept";

    clearTimeout(t.expireTimer);

    // Edit the GROUP message (use groupChatId for the edit)
    if (t.groupMsgId) {
      bot.editMessageText(
        `Table ${tableId} — Match Found!\n\n${gameLabel(t.gameType)} | ₹${t.entryFee}\n${dname(t.creatorId)} vs ${dname(chatId)}`,
        { chat_id: groupChatId, message_id: t.groupMsgId }
      ).catch(() => {});
      bot.editMessageReplyMarkup({ inline_keyboard: [] },
        { chat_id: groupChatId, message_id: t.groupMsgId }
      ).catch(() => {});
    }

    // Notify creator in their private chat
    send(t.creatorId,
      `🎯 Opponent found via group!\n\n` +
      `Opponent: ${dname(chatId)}\n` +
      `Table: ${tableId}\n\n` +
      `Waiting for opponent to accept...`);

    // Send Accept/Decline to opponent's PRIVATE chat (chatId = query.from.id)
    send(chatId,
      `🎯 Match Request!\n\n` +
      `Game: ${gameLabel(t.gameType)}\n` +
      `Creator: ${dname(t.creatorId)}\n` +
      `Entry: ₹${t.entryFee} (deducted) | Pot: ₹${t.pot}\n` +
      `Winner Gets: ₹${t.winnerGets}\n\n` +
      `Accept within 2 minutes!`,
      {
        reply_markup: { inline_keyboard: [[
          { text: "✅ Accept", callback_data: `accept_${tableId}` },
          { text: "❌ Decline", callback_data: `decline_${tableId}` },
        ]]},
      });

    t.acceptTimer = setTimeout(() => timeoutPendingAccept(tableId), 120_000);
    return;
  }

  // All remaining callbacks are from private chats — chatId is already correct.

  // ── ACCEPT ────────────────────────────────────────────────────────────────
  if (data.startsWith("accept_")) {
    const tableId = data.replace("accept_", "");
    const t       = tables[tableId];

    if (!t || t.status !== "pending_accept") {
      send(chatId, "This match is no longer available.", mainMenu());
      return;
    }
    if (chatId !== t.opponentId) {
      send(chatId, "This request is not for you.");
      return;
    }

    clearTimeout(t.acceptTimer);
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    send(chatId, `✅ Accepted!\n\nTable: ${tableId}\n\nWaiting for the creator to share the room code...`);
    askCreatorForRoomCode(tableId);
    return;
  }

  // ── DECLINE ───────────────────────────────────────────────────────────────
  if (data.startsWith("decline_")) {
    const tableId = data.replace("decline_", "");
    const t       = tables[tableId];
    if (!t) return;
    clearTimeout(t.acceptTimer);
    cancelTable(tableId, "declined by opponent");
    return;
  }

  // ── CREATOR CANCELS OPEN TABLE ────────────────────────────────────────────
  if (data.startsWith("creator_cancel_")) {
    const tableId = data.replace("creator_cancel_", "");
    const t       = tables[tableId];
    if (!t) { send(chatId, "Table not found."); return; }
    if (chatId !== t.creatorId) { send(chatId, "Only the creator can cancel."); return; }
    if (t.status !== "open") { send(chatId, "Table is no longer open."); return; }

    clearTimeout(t.expireTimer);
    cancelTable(tableId, "cancelled by creator");
    bot.deleteMessage(chatId, msgId).catch(() => {});
    if (t.groupMsgId) {
      bot.editMessageText(`Table ${tableId} was cancelled by creator.`,
        { chat_id: GROUP_ID, message_id: t.groupMsgId }).catch(() => {});
      bot.editMessageReplyMarkup({ inline_keyboard: [] },
        { chat_id: GROUP_ID, message_id: t.groupMsgId }).catch(() => {});
    }
    return;
  }

  // ── START GAME ────────────────────────────────────────────────────────────
  if (data.startsWith("start_game_")) {
    const tableId = data.replace("start_game_", "");
    const t       = tables[tableId];

    if (!t || t.status !== "room_shared") {
      send(chatId, "Game session not found or already started.");
      return;
    }
    if (chatId !== t.opponentId) {
      send(chatId, "Only the opponent can press Start.");
      return;
    }

    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    activateGame(tableId);
    return;
  }

  // ── CLAIM WIN ─────────────────────────────────────────────────────────────
  if (data.startsWith("claim_win_")) {
    const tableId = data.replace("claim_win_", "");
    const t       = tables[tableId];

    if (!t || t.status !== "active") { send(chatId, "Table is not active.", mainMenu()); return; }
    if (chatId !== t.creatorId && chatId !== t.opponentId) { send(chatId, "You are not in this table."); return; }

    const already = Object.values(pendingWinClaims).find(
      c => c.tableId === tableId && c.claimerId === chatId && c.status === "pending"
    );
    if (already) { send(chatId, `Claim already submitted: ${already.claimId}\nWait for admin verification.`); return; }

    userState[chatId] = { action: "win_proof_screenshot", tableId };
    send(chatId,
      `Win Claim — Table ${tableId}\n\nSend a screenshot of your winning game as proof.\n\nFalse claims = permanent ban.`,
      { reply_markup: { inline_keyboard: [[{ text: "❌ Cancel Claim", callback_data: `cancel_claim_${tableId}` }]] } });
    return;
  }

  // ── CLAIM LOSS ────────────────────────────────────────────────────────────
  if (data.startsWith("claim_loss_")) {
    const tableId = data.replace("claim_loss_", "");
    const t       = tables[tableId];

    if (!t || t.status !== "active") { send(chatId, "Table is not active.", mainMenu()); return; }
    if (chatId !== t.creatorId && chatId !== t.opponentId) { send(chatId, "You are not in this table."); return; }
    if (t.lossReports.includes(chatId)) { send(chatId, "You already reported a loss for this table."); return; }

    t.lossReports.push(chatId);
    users[chatId].gamesPlayed += 1;
    users[chatId].status       = "idle";
    users[chatId].tableId      = null;

    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }).catch(() => {});
    send(chatId, `😔 Loss recorded for table ${tableId}.\n\nBetter luck next time!`, mainMenu());
    bot.sendMessage(ADMIN_ID,
      `${users[chatId]?.name} (${chatId}) reported a loss on table ${tableId}.`
    ).catch(() => {});
    return;
  }

  // ── CANCEL WIN CLAIM ──────────────────────────────────────────────────────
  if (data.startsWith("cancel_claim_")) {
    delete userState[chatId];
    send(chatId, "❌ Claim cancelled.", mainMenu());
    return;
  }

  // ── DEPOSIT APPROVE / REJECT ──────────────────────────────────────────────
  if (data.startsWith("dep_approve_")) {
    const txnId = data.replace("dep_approve_", "");
    const dep   = pendingDeposits[txnId];
    if (!dep || dep.status !== "pending") { bot.answerCallbackQuery(query.id, { text: "Already processed." }); return; }
    dep.status = "approved";
    users[dep.chatId].balance     += dep.amount;
    users[dep.chatId].hasDeposited = true;   // FIX #3: mark deposit made
    bot.deleteMessage(chatId, msgId).catch(() => {});
    send(chatId, `✅ Deposit ${txnId} approved! ₹${dep.amount} added to ${users[dep.chatId]?.name}.`);
    send(dep.chatId, `✅ Deposit Approved!\n\n₹${dep.amount} added to your wallet!\nNew Balance: ₹${users[dep.chatId].balance}`, mainMenu());
    return;
  }
  if (data.startsWith("dep_reject_")) {
    const txnId = data.replace("dep_reject_", "");
    const dep   = pendingDeposits[txnId];
    if (!dep || dep.status !== "pending") { bot.answerCallbackQuery(query.id, { text: "Already processed." }); return; }
    dep.status = "rejected";
    bot.deleteMessage(chatId, msgId).catch(() => {});
    send(chatId, `❌ Deposit ${txnId} rejected.`);
    send(dep.chatId, `❌ Deposit Rejected!\n\nYour deposit of ₹${dep.amount} was rejected.\nContact support if this is a mistake.`, mainMenu());
    return;
  }

  // ── WITHDRAWAL DONE / REJECT ──────────────────────────────────────────────
  if (data.startsWith("wdl_done_")) {
    const txnId = data.replace("wdl_done_", "");
    const w     = pendingWithdrawals[txnId];
    if (!w || w.status !== "pending") { bot.answerCallbackQuery(query.id, { text: "Already processed." }); return; }
    w.status = "done";
    bot.deleteMessage(chatId, msgId).catch(() => {});
    send(chatId, `✅ Withdrawal ${txnId} marked as paid!`);
    send(w.chatId, `✅ Withdrawal Processed!\n\n₹${w.amount} sent to your UPI!\nTXN: ${txnId}`, mainMenu());
    return;
  }
  if (data.startsWith("wdl_rej_")) {
    const txnId = data.replace("wdl_rej_", "");
    const w     = pendingWithdrawals[txnId];
    if (!w || w.status !== "pending") { bot.answerCallbackQuery(query.id, { text: "Already processed." }); return; }
    w.status = "rejected";
    users[w.chatId].balance += w.amount;
    bot.deleteMessage(chatId, msgId).catch(() => {});
    send(chatId, `❌ Withdrawal ${txnId} rejected. Amount refunded.`);
    send(w.chatId, `❌ Withdrawal Rejected!\n\n₹${w.amount} refunded.\nBalance: ₹${users[w.chatId].balance}\n\nContact support for help.`, mainMenu());
    return;
  }

  // ── WIN CLAIM APPROVE / REJECT ────────────────────────────────────────────
  if (data.startsWith("win_approve_")) {
    const cid   = data.replace("win_approve_", "");
    const claim = pendingWinClaims[cid];
    if (!claim || claim.status !== "pending") { bot.answerCallbackQuery(query.id, { text: "Already processed." }); return; }
    const t = tables[claim.tableId];
    if (!t) { send(chatId, "Table not found."); return; }
    claim.status = "approved";
    declareWinner(claim.tableId, claim.claimerId);
    bot.deleteMessage(chatId, msgId).catch(() => {});
    send(chatId, `✅ Claim ${cid} approved. Winner: ${users[claim.claimerId]?.name} | ₹${t.winnerGets} paid.`);
    return;
  }
  if (data.startsWith("win_reject_")) {
    const cid   = data.replace("win_reject_", "");
    const claim = pendingWinClaims[cid];
    if (!claim || claim.status !== "pending") { bot.answerCallbackQuery(query.id, { text: "Already processed." }); return; }
    claim.status = "rejected";
    bot.deleteMessage(chatId, msgId).catch(() => {});
    send(chatId, `❌ Claim ${cid} rejected.`);
    send(claim.claimerId, `❌ Win Claim Rejected!\n\nTable: ${claim.tableId}\nContact support if this is a mistake.`, mainMenu());
    return;
  }

  // ── ADMIN BALANCE ─────────────────────────────────────────────────────────
  if (data.startsWith("bal_add_") || data.startsWith("bal_ded_")) {
    const isAdd = data.startsWith("bal_add_");
    const tid   = parseInt(data.split("_").pop());
    if (!users[tid]) { send(chatId, "❌ User not found."); return; }
    adminState[chatId] = { action: isAdd ? "bal_add" : "bal_ded", targetId: tid };
    send(chatId, `${isAdd ? "Add" : "Deduct"} balance for ${users[tid].name}\n\nEnter amount (₹):`, cancelKb());
    return;
  }
  if (data === "bal_cancel") {
    delete adminState[chatId];
    send(chatId, "❌ Cancelled.", adminMenu());
    return;
  }

  // ── ADMIN DECLARE WINNER ──────────────────────────────────────────────────
  if (data.startsWith("declare_winner_")) {
    const tableId = data.replace("declare_winner_", "");
    const t       = tables[tableId];
    if (!t) { send(chatId, "Table not found."); return; }
    if (["completed", "cancelled"].includes(t.status)) {
      send(chatId, `Table ${tableId} is already ${t.status}.`);
      return;
    }
    const list = [t.creatorId, t.opponentId].filter(Boolean)
      .map(pid => `${pid} — ${users[pid]?.name || "Unknown"}`).join("\n");
    adminState[chatId] = { action: "declare_winner", tableId };
    send(chatId, `Declare Winner — ${tableId}\n\nPlayers:\n${list}\n\nSend the winner's User ID:`);
    return;
  }

  // ── ADMIN CANCEL TABLE ────────────────────────────────────────────────────
  if (data.startsWith("cancel_table_")) {
    const tableId = data.replace("cancel_table_", "");
    const t       = tables[tableId];
    if (!t) { send(chatId, "Table not found."); return; }
    if (["completed", "cancelled"].includes(t.status)) {
      send(chatId, `Table ${tableId} is already ${t.status}.`);
      return;
    }
    cancelTable(tableId, "cancelled by admin");
    send(chatId, `✅ Table ${tableId} cancelled. All players refunded.`, adminMenu());
    return;
  }

  // ── DEPOSIT AMOUNT ────────────────────────────────────────────────────────
  if (data.startsWith("deposit_")) {
    const amount = parseInt(data.split("_")[1]);
    if (!amount) return;
    const ep = Object.values(pendingDeposits).find(d => d.chatId === chatId && d.status === "pending");
    if (ep) {
      send(chatId,
        `Pending deposit exists!\n\nTXN: ${ep.txnId} | ₹${ep.amount}\n\nWait for admin to process it first.`,
        mainMenu());
      return;
    }
    userState[chatId] = { action: "deposit_screenshot", amount };
    const QR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=upi://pay?pa=7891624054@mbk%26pn=LudoAdda%26am=${amount}%26cu=INR`;
    bot.sendPhoto(chatId, QR, {
      caption:
        `Deposit ₹${amount}\n\n` +
        `UPI ID: 7891624054@mbk\n` +
        `Amount: ₹${amount}\n\n` +
        `Scan QR above OR pay to the UPI ID manually.\n\n` +
        `After payment, send the SCREENSHOT of your transaction.\n` +
        `Screenshot must contain the UTR number.`,
      reply_markup: {
        keyboard         : [[{ text: "❌ Cancel Deposit" }]],
        resize_keyboard  : true,
        one_time_keyboard: true,
      },
    }).catch(() => {});
    return;
  }

  // ── WITHDRAW AMOUNT ───────────────────────────────────────────────────────
  if (data.startsWith("withdraw_")) {
    const amount = parseInt(data.split("_")[1]);
    if (!amount) return;
    if ((users[chatId]?.balance || 0) < amount) {
      send(chatId, `❌ Insufficient balance! You have ₹${users[chatId]?.balance || 0}`);
      return;
    }
    userState[chatId] = { action: "withdraw_upi", amount };
    send(chatId, `Withdraw ₹${amount}\n\nPlease enter your UPI ID:`, cancelKb());
    return;
  }

  // ── MISC ──────────────────────────────────────────────────────────────────
  if (data === "back_menu") {
    bot.deleteMessage(chatId, msgId).catch(() => {});
    send(chatId, "Main Menu:", mainMenu());
    return;
  }
  if (data === "faq") {
    send(chatId,
      `FAQ\n\n` +
      `How to deposit?\nTap Deposit, choose amount, pay via UPI, send screenshot.\n\n` +
      `How to withdraw?\nTap Withdraw, choose amount, enter your UPI ID.\n\nNote: You need to play 2 matches OR make a deposit first.\n\n` +
      `How is winner decided?\nTap I Won after game, submit screenshot. Admin verifies.\n\n` +
      `What is Goti mode in Classic Ludo?\nGoti = number of tokens per player. All matches are 2 players.\n\n` +
      `Platform cut?\n${PLATFORM_CUT_PERCENT}% is deducted from the pot as platform fee.`);
    return;
  }
  if (data === "bug") {
    send(chatId, "Report a Bug\n\nDescribe the issue and send it here. We will fix it ASAP!");
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  PHOTO HANDLER
// ─────────────────────────────────────────────────────────────────────────────
bot.on("photo", msg => {
  const chatId = msg.chat.id;
  const st     = userState[chatId];
  if (!st) return;

  if (st.action === "deposit_screenshot") {
    const ep = Object.values(pendingDeposits).find(d => d.chatId === chatId && d.status === "pending");
    if (ep) {
      send(chatId, `Deposit already pending: ${ep.txnId} | ₹${ep.amount}\nWait for admin.`, mainMenu());
      delete userState[chatId];
      return;
    }
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const txnId  = genTxnId();
    pendingDeposits[txnId] = {
      txnId, chatId, amount: st.amount, screenshotFileId: fileId, status: "pending", timestamp: new Date(),
    };
    delete userState[chatId];

    send(chatId,
      `Screenshot Received!\n\nTXN ID: ${txnId}\nAmount: ₹${st.amount}\n\nAdmin is verifying. You will be notified.`,
      mainMenu());

    bot.sendPhoto(ADMIN_ID, fileId, {
      caption:
        `New Deposit Request!\n\n` +
        `TXN: ${txnId}\n` +
        `User: ${users[chatId]?.name || "Unknown"} (${chatId})\n` +
        `Username: @${users[chatId]?.username || "N/A"}\n` +
        `Amount: ₹${st.amount}\n` +
        `Time: ${new Date().toLocaleString("en-IN")}`,
      reply_markup: { inline_keyboard: [[
        { text: "✅ Approve", callback_data: `dep_approve_${txnId}` },
        { text: "❌ Reject",  callback_data: `dep_reject_${txnId}` },
      ]]},
    }).catch(() => {
      bot.sendMessage(ADMIN_ID,
        `New Deposit!\nTXN: ${txnId}\nUser: ${users[chatId]?.name} (${chatId})\nAmount: ₹${st.amount}\n\nScreenshot forward failed.`,
        {
          reply_markup: { inline_keyboard: [[
            { text: "✅ Approve", callback_data: `dep_approve_${txnId}` },
            { text: "❌ Reject",  callback_data: `dep_reject_${txnId}` },
          ]]},
        }
      ).catch(() => {});
    });
    return;
  }

  if (st.action === "win_proof_screenshot") {
    const { tableId } = st;
    const t           = tables[tableId];
    if (!t || t.status !== "active") {
      send(chatId, "Table is no longer active.", mainMenu());
      delete userState[chatId];
      return;
    }
    const fileId  = msg.photo[msg.photo.length - 1].file_id;
    const claimId = genClaimId();
    pendingWinClaims[claimId] = {
      claimId, tableId, claimerId: chatId, screenshotFileId: fileId, status: "pending", timestamp: new Date(),
    };
    delete userState[chatId];

    send(chatId,
      `Win Claim Submitted!\n\nClaim ID: ${claimId}\nTable: ${tableId}\n\nAdmin will verify your screenshot. You will be notified.`,
      mainMenu());

    const opp = [t.creatorId, t.opponentId]
      .filter(p => p && p !== chatId)
      .map(p => users[p]?.name || p)
      .join(", ");

    bot.sendPhoto(ADMIN_ID, fileId, {
      caption:
        `New Win Claim!\n\n` +
        `Claim: ${claimId}\n` +
        `Table: ${tableId}\n` +
        `Claimer: ${users[chatId]?.name || "Unknown"} (${chatId})\n` +
        `vs: ${opp}\n` +
        `Prize: ₹${t.winnerGets}\n` +
        `Time: ${new Date().toLocaleString("en-IN")}`,
      reply_markup: { inline_keyboard: [[
        { text: "✅ Approve Win", callback_data: `win_approve_${claimId}` },
        { text: "❌ Reject",      callback_data: `win_reject_${claimId}` },
      ]]},
    }).catch(() => {
      bot.sendMessage(ADMIN_ID,
        `New Win Claim!\nClaim: ${claimId}\nTable: ${tableId}\nClaimer: ${users[chatId]?.name} (${chatId})\nPrize: ₹${t.winnerGets}\n\nScreenshot forward failed.`,
        {
          reply_markup: { inline_keyboard: [[
            { text: "✅ Approve Win", callback_data: `win_approve_${claimId}` },
            { text: "❌ Reject",      callback_data: `win_reject_${claimId}` },
          ]]},
        }
      ).catch(() => {});
    });
    return;
  }
});

// ─── ERROR HANDLING ───────────────────────────────────────────────────────────
bot.on("polling_error", err => console.error("Polling error:", err.message));
process.on("unhandledRejection", r => console.error("Unhandled rejection:", r));
