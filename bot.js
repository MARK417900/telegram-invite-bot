const TelegramBot = require("node-telegram-bot-api");
const http        = require("http");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const BOT_TOKEN            = process.env.BOT_TOKEN            || "8605121015:AAGyhOqPIbewK8JQ4PK_ASF-iPn6t5g3Oek";
const ADMIN_ID             = parseInt(process.env.ADMIN_ID)   || 8521844327;
const GROUP_ID             = parseInt(process.env.GROUP_ID)   || -1003890515710;
const GROUP_INVITE_LINK    = process.env.GROUP_INVITE_LINK    || "https://t.me/+YOUR_GROUP_INVITE_LINK";
const PLATFORM_CUT_PERCENT = 5;
const REFER_REWARD         = 20;
const PORT                 = process.env.PORT                 || 3000;
// ─────────────────────────────────────────────────────────────────────────────

// ─── KEEP-ALIVE HTTP SERVER (Required by Render — also pinged by UptimeRobot) ─
// Render spins down free instances after inactivity. This server:
//   1. Satisfies Render's health-check requirement (needs an open port)
//   2. Gives UptimeRobot a URL to ping every 5 minutes to prevent spin-down
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("LudoAdda Bot is alive!");
});
server.listen(PORT, () => console.log(`✅ Keep-alive server running on port ${PORT}`));

// ─── RESILIENT POLLING ────────────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    interval  : 300,
    autoStart : true,
    params    : { timeout: 10 },
  },
  request: {
    timeout   : 30000,
    retryLimit: 5,
  },
});

console.log("🚀 LudoAdda Bot is running...");

// ─── AUTO-RESTART POLLING on network errors ───────────────────────────────────
// Render's free tier and UptimeRobot pings can cause brief network drops.
// This handler catches ECONNRESET / ENOTFOUND and restarts polling automatically.
let isRestarting = false;
bot.on("polling_error", (err) => {
  const msg = err.message || "";
  console.error("Polling error:", msg);

  const isNetworkError =
    msg.includes("ECONNRESET")   ||
    msg.includes("ENOTFOUND")    ||
    msg.includes("ETIMEDOUT")    ||
    msg.includes("EFATAL")       ||
    msg.includes("socket hang up");

  if (isNetworkError && !isRestarting) {
    isRestarting = true;
    console.log("🔄 Network error — restarting polling in 5s...");
    bot.stopPolling()
      .catch(() => {})
      .finally(() => {
        setTimeout(() => {
          bot.startPolling()
            .then(() => { isRestarting = false; console.log("✅ Polling restarted."); })
            .catch((e) => { isRestarting = false; console.error("Failed to restart polling:", e.message); });
        }, 5000);
      });
  }
});

// ─── MARKDOWN ESCAPE ──────────────────────────────────────────────────────────
function escMD(text) {
  if (!text) return "";
  return String(text).replace(/[_*`\[]/g, "\\$&");
}

// ─── IN-MEMORY STORE ──────────────────────────────────────────────────────────
// NOTE: Render free tier resets memory on spin-down/redeploy.
// For production persistence, replace with a database (MongoDB Atlas free tier recommended).
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

// ─── GLOBAL STATS ─────────────────────────────────────────────────────────────
let stats = {
  totalMatches    : 0,
  totalPot        : 0,
  totalCommission : 0,
  completedMatches: [],
  activeUsers24h  : {},
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
  const since         = Date.now() - 24 * 60 * 60 * 1000;
  const recent        = stats.completedMatches.filter(m => m.completedAt >= since);
  const matches24h    = recent.length;
  const pot24h        = recent.reduce((s, m) => s + m.pot, 0);
  const commission24h = recent.reduce((s, m) => s + m.commission, 0);
  const activeUsers   = Object.values(stats.activeUsers24h).filter(t => t >= since).length;
  return { matches24h, pot24h, commission24h, activeUsers };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const isAdmin = (id) => id === ADMIN_ID;

function registerUser(msg, referredBy = null) {
  const id = msg.chat.id;
  if (!users[id]) {
    users[id] = {
      name           : `${msg.from.first_name} ${msg.from.last_name || ""}`.trim(),
      username       : msg.from.username || "N/A",
      balance        : 1000,
      gamesPlayed    : 0,
      gamesWon       : 0,
      status         : "idle",
      tableId        : null,
      hasDeposited   : false,
      referredBy,
      referRewardPaid: false,
      referCount     : 0,
    };
  }
}

function ensureUser(from) {
  if (!users[from.id]) {
    users[from.id] = {
      name           : `${from.first_name} ${from.last_name || ""}`.trim(),
      username       : from.username || "N/A",
      balance        : 1000,
      gamesPlayed    : 0,
      gamesWon       : 0,
      status         : "idle",
      tableId        : null,
      hasDeposited   : false,
      referredBy     : null,
      referRewardPaid: false,
      referCount     : 0,
    };
  }
  return users[from.id];
}

const genTableId = () => `T-${String(tableCounter++).padStart(4, "0")}`;
const genTxnId   = () => `TXN-${String(txnCounter++).padStart(5, "0")}`;
const genClaimId = () => `CLM-${String(claimCounter++).padStart(4, "0")}`;

function gameLabel(t) {
  const map = {
    quick         : "Quick Ludo",
    classic       : "Classic Ludo",
    popular       : "Popular Ludo",
    classic_1goti : "Classic Ludo — 1 Goti Mode",
    classic_2goti : "Classic Ludo — 2 Goti Mode",
    classic_3goti : "Classic Ludo — 3 Goti Mode",
    classic_4goti : "Classic Ludo — 4 Goti Mode",
  };
  return map[t] || t;
}

function dname(chatId) {
  const u = users[chatId];
  if (!u) return String(chatId);
  return u.username !== "N/A" ? `@${escMD(u.username)}` : escMD(u.name);
}

function tapCopy(value) {
  return `\`${String(value).replace(/`/g, "'")}\``;
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
      resize_keyboard: true,
      persistent     : true,
    },
  };
}

function waitingMenu(tableId) {
  return {
    reply_markup: {
      keyboard         : [[{ text: `❌ Cancel Table ${tableId}` }]],
      resize_keyboard  : true,
      one_time_keyboard: false,
    },
  };
}

function acceptDeclineMenu(tableId) {
  return {
    reply_markup: {
      keyboard         : [[{ text: `✅ Accept ${tableId}` }, { text: `❌ Decline ${tableId}` }]],
      resize_keyboard  : true,
      one_time_keyboard: true,
    },
  };
}

function startGameMenu(tableId) {
  return {
    reply_markup: {
      keyboard: [
        [{ text: `▶️ Start Game ${tableId}` }],
        [{ text: `❌ Cancel Game` }],
      ],
      resize_keyboard  : true,
      one_time_keyboard: true,
    },
  };
}

function gameResultMenu(tableId) {
  return {
    reply_markup: {
      keyboard         : [[{ text: `🏆 I Won ${tableId}` }, { text: `😔 I Lost ${tableId}` }]],
      resize_keyboard  : true,
      one_time_keyboard: true,
    },
  };
}

function adminMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "📢 Broadcast" }, { text: "👤 User Info" }, { text: "📊 Bot Status" }],
        [{ text: "👤 MSG User" }, { text: botOnline ? "🔴 Turn Bot OFF" : "🟢 Turn Bot ON" }, { text: "👥 All Users" }],
        [{ text: "💰 Balance Update" }, { text: "📋 Open Tables" }, { text: "🏆 Win Claims" }],
        [{ text: "🔙 User Menu" }],
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
  return bot.sendMessage(chatId, text, extra)
    .catch(err => console.error(`sendMessage to ${chatId} failed:`, err.message));
}

function sendMD(chatId, text, extra = {}) {
  return bot.sendMessage(chatId, text, { parse_mode: "Markdown", ...extra }).catch(err => {
    console.error(`sendMessage(MD) to ${chatId} failed:`, err.message);
    const plain = text.replace(/[`*_\[\]]/g, "");
    return bot.sendMessage(chatId, plain, extra)
      .catch(e => console.error(`sendMessage(plain fallback) to ${chatId} failed:`, e.message));
  });
}

// ─── GROUP MEMBERSHIP ─────────────────────────────────────────────────────────
async function isGroupMember(userId) {
  try {
    const member = await bot.getChatMember(GROUP_ID, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch {
    return false;
  }
}

async function requireGroupMembership(chatId, onSuccess) {
  const isMember = await isGroupMember(chatId);
  if (isMember) { onSuccess(); return; }
  send(chatId,
    `🚫 Join Required!\n\nYou must join our group to play Ludo Adda.\n\nJoin the group and then try again!`,
    {
      reply_markup: { inline_keyboard: [
        [{ text: "✅ Join Group", url: GROUP_INVITE_LINK }],
        [{ text: "▶️ I've Joined — Continue", callback_data: "check_membership" }],
      ]},
    });
}

// ─── MATCHMAKING ──────────────────────────────────────────────────────────────
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

  const match = Object.values(tables).find(
    t => t.gameType === gameType && t.entryFee === entryFee &&
         t.status === "open" && t.creatorId !== chatId
  );

  if (match) {
    user.balance -= entryFee;
    user.status   = "waiting";
    user.tableId  = match.tableId;

    markUserActive(chatId);
    markUserActive(match.creatorId);

    if (match.expireTimer) { clearTimeout(match.expireTimer); match.expireTimer = null; }

    match.opponentId = chatId;
    match.status     = "pending_accept";

    if (match.groupMsgId) {
      bot.editMessageText(
        `Table ${match.tableId} — Match Found!\n\n${gameLabel(gameType)} | Entry ₹${entryFee}\n${dname(match.creatorId)} vs ${dname(chatId)}`,
        { chat_id: GROUP_ID, message_id: match.groupMsgId }
      ).catch(() => {});
      bot.editMessageReplyMarkup({ inline_keyboard: [] },
        { chat_id: GROUP_ID, message_id: match.groupMsgId }
      ).catch(() => {});
    }

    send(match.creatorId,
      `🎯 Opponent Found!\n\nGame: ${gameLabel(gameType)}\nOpponent: ${dname(chatId)}\n` +
      `Entry: ₹${entryFee} | Winner Gets: ₹${winnerGets}\n\nWaiting for opponent to accept...`);

    send(chatId,
      `🎯 Match Found!\n\nGame: ${gameLabel(gameType)}\nTable Creator: ${dname(match.creatorId)}\n` +
      `Entry: ₹${entryFee} | Winner Gets: ₹${winnerGets}\n\nAccept or Decline within 5 minutes!`,
      acceptDeclineMenu(match.tableId));

    match.acceptTimer = setTimeout(() => timeoutPendingAccept(match.tableId), 300_000);

  } else {
    const tableId = genTableId();

    user.balance -= entryFee;
    user.status   = "waiting";
    user.tableId  = tableId;

    markUserActive(chatId);

    tables[tableId] = {
      tableId, gameType, entryFee, pot, platformCut, winnerGets,
      creatorId  : chatId,
      opponentId : null,
      status     : "open",
      roomCode   : null,
      groupMsgId : null,
      expireTimer: null,
      acceptTimer: null,
      lossReports: [],
      createdAt  : new Date(),
    };

    sendMD(chatId,
      `✅ Table Created!\n\n` +
      `Table ID: ${tapCopy(tableId)}\nGame: ${gameLabel(gameType)}\n` +
      `Entry Fee: ₹${entryFee} (deducted)\nWinner Gets: ₹${winnerGets}\n\n` +
      `Searching for opponent in group...`,
      waitingMenu(tableId));

    bot.sendMessage(GROUP_ID,
      `🎮 New Table Created!\n\nGame Type: ${gameLabel(gameType)}\n` +
      `Table Creator: ${dname(chatId)}\nEntry: ₹${entryFee}\nWinner Gets: ₹${winnerGets}`,
      { reply_markup: { inline_keyboard: [[
        { text: `✅ Join Table (₹${entryFee})`, callback_data: `group_join_${tableId}` },
      ]]}}
    ).then(sent => {
      const t = tables[tableId];
      if (!t) return;
      t.groupMsgId  = sent.message_id;
      t.expireTimer = setTimeout(() => expireOpenTable(tableId), 600_000);
    }).catch(() => {});
  }
}

// ─── TABLE LIFECYCLE ──────────────────────────────────────────────────────────
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

function askCreatorForRoomCode(tableId) {
  const t = tables[tableId];
  if (!t) return;
  t.status = "room_pending";
  userState[t.creatorId] = { action: "send_room_code", tableId };
  send(t.creatorId,
    `✅ Opponent Accepted!\n\nOpponent: ${dname(t.opponentId)}\nTable: ${tableId}\n\n` +
    `Please type and send your Room Code from the Ludo app:`,
    cancelKb("❌ Cancel Game"));
}

function sendRoomCodeToOpponent(tableId, code) {
  const t = tables[tableId];
  if (!t) return;
  t.status   = "room_shared";
  t.roomCode = String(code).replace(/`/g, "'");

  sendMD(t.creatorId,
    `📤 Room code sent to opponent!\n\nCode: ${tapCopy(t.roomCode)}\n\nWaiting for opponent to tap ▶️ Start Game...`);

  sendMD(t.opponentId,
    `🔑 Room Code Received!\n\nTable: ${tableId}\nRoom Code: ${tapCopy(t.roomCode)}\n\n` +
    `Tap the code above to copy it, enter it in your Ludo app, then tap ▶️ Start Game!`,
    startGameMenu(tableId));
}

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

  sendMD(t.creatorId,
    `🎮 Match Started!\n\nTable: ${tableId}\nPlayers: ${names}\nPrize: ₹${t.winnerGets}\n` +
    `Room Code: ${tapCopy(t.roomCode)}\n\nGood luck! Tap your result after the game:`,
    gameResultMenu(tableId));

  send(t.opponentId,
    `🎮 Game is ON!\n\nTable: ${tableId}\nPlayers: ${names}\nPrize: ₹${t.winnerGets}\n\n` +
    `Good luck! Tap your result after the game:`,
    gameResultMenu(tableId));

  if (GROUP_ID) {
    bot.sendMessage(GROUP_ID,
      `🎮 Game Started!\nTable: ${tableId} | ${gameLabel(t.gameType)}\nPlayers: ${names}\nPrize: ₹${t.winnerGets}`
    ).catch(() => {});
  }

  bot.sendMessage(ADMIN_ID,
    `New Active Table: ${tableId}\nPlayers: ${names}\nPot: ₹${t.pot}\nRoom: ${t.roomCode}`,
    { reply_markup: { inline_keyboard: [[
      { text: "🏆 Declare Winner", callback_data: `declare_winner_${tableId}` },
      { text: "🚫 Cancel Table",   callback_data: `cancel_table_${tableId}` },
    ]]}}
  ).catch(() => {});
}

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

  recordMatchCompletion(t.pot, t.platformCut);

  [t.creatorId, t.opponentId].forEach(pid => {
    if (!pid || !users[pid]) return;
    const u = users[pid];
    if (u.gamesPlayed === 1 && u.referredBy && !u.referRewardPaid) {
      const referrer = users[u.referredBy];
      if (referrer) {
        referrer.balance    += REFER_REWARD;
        referrer.referCount += 1;
        u.referRewardPaid    = true;
        send(u.referredBy,
          `🎉 Refer Reward!\n\nYour referred user ${u.name} just completed their first match!\n` +
          `₹${REFER_REWARD} added to your wallet.\nNew Balance: ₹${referrer.balance}`);
      }
    }
  });

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

// ─── ADMIN USER INFO ──────────────────────────────────────────────────────────
function sendUserInfoPanel(adminChatId, targetId) {
  const u = users[targetId];
  if (!u) { send(adminChatId, `❌ User ${targetId} not found.`); return; }
  const pendingDep = Object.values(pendingDeposits).find(d => d.chatId === targetId && d.status === "pending");
  const pendingWdl = Object.values(pendingWithdrawals).find(w => w.chatId === targetId && w.status === "pending");

  const text =
    `👤 User Info\n\nID: \`${targetId}\`\n` +
    `Name: ${escMD(u.name)}\nUsername: @${escMD(u.username)}\n\n` +
    `Balance: ₹${u.balance}\nGames Played: ${u.gamesPlayed}\nGames Won: ${u.gamesWon}\n` +
    `Status: ${u.status}\nTable: ${u.tableId || "None"}\n\n` +
    `Deposited: ${u.hasDeposited ? "Yes ✅" : "No ❌"}\n` +
    `Referred By: ${u.referredBy ? `\`${u.referredBy}\`` : "None"}\n` +
    `Refer Count: ${u.referCount || 0}\n` +
    (pendingDep ? `\nPending Deposit: ₹${pendingDep.amount} (${pendingDep.txnId})\n` : "") +
    (pendingWdl ? `\nPending Withdrawal: ₹${pendingWdl.amount} (${pendingWdl.txnId})\n` : "");

  bot.sendMessage(adminChatId, text, {
    parse_mode  : "Markdown",
    reply_markup: { inline_keyboard: [
      [{ text: "🔄 Reset User State", callback_data: `reset_state_${targetId}` }],
      [{ text: "💰 Update Balance",   callback_data: `bal_add_${targetId}` }],
    ]},
  }).catch(() => {
    send(adminChatId, text.replace(/[`*_\[\]]/g, ""), {
      reply_markup: { inline_keyboard: [
        [{ text: "🔄 Reset User State", callback_data: `reset_state_${targetId}` }],
        [{ text: "💰 Update Balance",   callback_data: `bal_add_${targetId}` }],
      ]},
    });
  });
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId     = msg.chat.id;
  const param      = match[1]?.trim() || "";
  const referredBy = param && !isNaN(+param) && +param !== chatId ? +param : null;
  registerUser(msg, referredBy);

  if (isAdmin(chatId)) { send(chatId, "👑 Welcome Admin!", adminMenu()); return; }
  if (!botOnline)      { send(chatId, "🔴 Bot is offline for maintenance. Try again later."); return; }

  const isMember = await isGroupMember(chatId);
  if (!isMember) {
    send(chatId,
      `🎲 Welcome to Ludo Adda, ${msg.from.first_name}!\n\n⚠️ To use the bot you must join our official group first.`,
      { reply_markup: { inline_keyboard: [
        [{ text: "✅ Join Our Group", url: GROUP_INVITE_LINK }],
        [{ text: "▶️ I've Joined — Start Playing", callback_data: "check_membership" }],
      ]}});
    return;
  }

  send(chatId,
    `🎲 Welcome to Ludo Adda, ${msg.from.first_name}!\nLet's Play and Win real money!!!`,
    mainMenu());
});

// ─── MESSAGE HANDLER ──────────────────────────────────────────────────────────
bot.on("message", msg => {
  const chatId = msg.chat.id;
  const text   = msg.text;
  const photo  = msg.photo;

  if (!text && !photo) return;
  if (text && text.startsWith("/")) return;

  registerUser(msg);

  // ══════════ ADMIN ══════════════════════════════════════════════════════════
  if (isAdmin(chatId)) {
    const st = adminState[chatId];

    if (st) {
      if (photo) {
        const fileId  = photo[photo.length - 1].file_id;
        const caption = msg.caption || "";
        if (st.action === "broadcast") {
          let n = 0;
          Object.keys(users).forEach(uid => {
            if (+uid !== ADMIN_ID) {
              bot.sendPhoto(uid, fileId, { caption: caption ? `📢 From Admin:\n\n${caption}` : "📢 Message from Admin:" })
                .catch(() => { if (caption) bot.sendMessage(uid, `📢 From Admin:\n\n${caption}`).catch(() => {}); });
              n++;
            }
          });
          delete adminState[chatId];
          send(chatId, `✅ Photo broadcast sent to ${n} users.`, adminMenu());
          return;
        }
        if (st.action === "msg_user_photo") {
          bot.sendPhoto(st.targetId, fileId, { caption: caption ? `📢 Message from Admin:\n\n${caption}` : "📢 Message from Admin:" })
            .then(() => send(chatId, "✅ Photo sent.", adminMenu()))
            .catch(() => send(chatId, "❌ Failed to send photo.", adminMenu()));
          delete adminState[chatId];
          return;
        }
      }

      if (text === "❌ Cancel") { delete adminState[chatId]; send(chatId, "❌ Cancelled.", adminMenu()); return; }

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
        send(chatId, `User: ${users[tid].name}\n\nSend your message (text or photo):`, cancelKb());
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
        send(chatId, `User: ${users[tid].name}\nBalance: ₹${users[tid].balance}\n\nChoose action:`, {
          reply_markup: { inline_keyboard: [
            [{ text: "➕ Add", callback_data: `bal_add_${tid}` }, { text: "➖ Deduct", callback_data: `bal_ded_${tid}` }],
            [{ text: "❌ Cancel", callback_data: "bal_cancel" }],
          ]},
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
          delete adminState[chatId]; return;
        }
        users[tid].balance += isAdd ? amt : -amt;
        send(chatId, `✅ ₹${amt} ${isAdd ? "added to" : "deducted from"} ${users[tid].name}\nNew balance: ₹${users[tid].balance}`, adminMenu());
        send(tid, `💰 Balance Update!\n\n${isAdd ? "+" : "-"}₹${amt}\nNew Balance: ₹${users[tid].balance}`);
        delete adminState[chatId]; return;
      }
      if (st.action === "declare_winner") {
        const tid = +text;
        const t   = tables[st.tableId];
        if (!t || ![t.creatorId, t.opponentId].includes(tid)) {
          send(chatId, `❌ Not a valid player ID for table ${st.tableId}.`); return;
        }
        declareWinner(st.tableId, tid);
        delete adminState[chatId]; return;
      }
      if (st.action === "user_info_id") {
        const tid = +text;
        delete adminState[chatId];
        sendUserInfoPanel(chatId, tid); return;
      }
    }

    // Admin menu buttons
    if (text === "📢 Broadcast") {
      adminState[chatId] = { action: "broadcast" };
      const n = Object.keys(users).filter(id => +id !== ADMIN_ID).length;
      send(chatId, `Send broadcast to ${n} users.\n\nSend TEXT or a PHOTO with optional caption:`, cancelKb()); return;
    }
    if (text === "👤 MSG User")      { adminState[chatId] = { action: "msg_user_id" }; send(chatId, "Enter User ID:", cancelKb()); return; }
    if (text === "💰 Balance Update") { adminState[chatId] = { action: "bal_id" };     send(chatId, "Enter User ID:", cancelKb()); return; }
    if (text === "👤 User Info")      { adminState[chatId] = { action: "user_info_id" }; send(chatId, "Enter the User ID to view:", cancelKb()); return; }
    if (text === "🔙 User Menu")      { send(chatId, "Switched to User Menu.", mainMenu()); return; }

    if (text === "📊 Bot Status") {
      const active     = Object.values(tables).filter(t => t.status === "active").length;
      const open       = Object.values(tables).filter(t => t.status === "open").length;
      const pDep       = Object.values(pendingDeposits).filter(d => d.status === "pending").length;
      const pWdl       = Object.values(pendingWithdrawals).filter(w => w.status === "pending").length;
      const pClaim     = Object.values(pendingWinClaims).filter(c => c.status === "pending").length;
      const totalUsers = Object.keys(users).filter(id => +id !== ADMIN_ID).length;
      const s24        = get24hStats();
      send(chatId,
        `📊 Bot Status\n\nStatus: ${botOnline ? "🟢 Online" : "🔴 Offline"}\n` +
        `Total Users: ${totalUsers}\nTotal Matches: ${stats.totalMatches}\n` +
        `Total Pot: ₹${stats.totalPot}\nTotal Commission: ₹${stats.totalCommission}\n\n` +
        `Active Tables: ${active}\nOpen Tables: ${open}\n` +
        `Pending Deposits: ${pDep}\nPending Withdrawals: ${pWdl}\nWin Claims: ${pClaim}\n` +
        `━━━━━━━━━━━━━━━━\n⏰ Last 24 Hours\n` +
        `Active Users: ${s24.activeUsers}\nMatches: ${s24.matches24h}\n` +
        `Pot: ₹${s24.pot24h}\nCommission: ₹${s24.commission24h}`);
      return;
    }
    if (text === "🔴 Turn Bot OFF" || text === "🟢 Turn Bot ON") {
      botOnline = !botOnline;
      send(chatId, botOnline ? "🟢 Bot is now ONLINE!" : "🔴 Bot is now OFFLINE!", adminMenu()); return;
    }
    if (text === "👥 All Users") {
      const all = Object.keys(users).filter(id => +id !== ADMIN_ID);
      if (!all.length) { send(chatId, "No users yet."); return; }
      const chunks = [];
      for (let i = 0; i < all.length; i += 50) chunks.push(all.slice(i, i + 50));
      chunks.forEach((ch, idx) => {
        let m = idx === 0 ? `All Users (${all.length}):\n\n` : `Continued...\n\n`;
        ch.forEach(id => { const u = users[id]; m += `ID: ${id} | ${u.name} | ₹${u.balance} | ${u.status}\n`; });
        send(chatId, m);
      });
      return;
    }
    if (text === "📋 Open Tables") {
      const open = Object.values(tables).filter(t => t.status === "open");
      if (!open.length) { send(chatId, "No open tables."); return; }
      let m = `Open Tables (${open.length}):\n\n`;
      open.forEach(t => { m += `${t.tableId} | ${gameLabel(t.gameType)} | ₹${t.entryFee} | Creator: ${users[t.creatorId]?.name || t.creatorId}\n`; });
      send(chatId, m); return;
    }
    if (text === "🏆 Win Claims") {
      const pc = Object.values(pendingWinClaims).filter(c => c.status === "pending");
      if (!pc.length) { send(chatId, "No pending win claims."); return; }
      pc.forEach(claim => {
        const t   = tables[claim.tableId];
        const opp = t ? [t.creatorId, t.opponentId].filter(p => p && p !== claim.claimerId).map(p => users[p]?.name || p).join(", ") : "N/A";
        const cap = `Win Claim\n\nClaim: ${claim.claimId}\nTable: ${claim.tableId}\nClaimer: ${users[claim.claimerId]?.name || "Unknown"} (${claim.claimerId})\nvs: ${opp}\nPrize: ₹${t?.winnerGets || "?"}`;
        const btns = { reply_markup: { inline_keyboard: [[{ text: "✅ Approve Win", callback_data: `win_approve_${claim.claimId}` }, { text: "❌ Reject", callback_data: `win_reject_${claim.claimId}` }]] }};
        if (claim.screenshotFileId) {
          bot.sendPhoto(chatId, claim.screenshotFileId, { caption: cap, ...btns }).catch(() => send(chatId, cap, btns));
        } else { send(chatId, cap, btns); }
      });
      return;
    }
  }

  // ══════════ USER ═══════════════════════════════════════════════════════════
  if (!botOnline) { send(chatId, "🔴 Bot is offline for maintenance."); return; }

  if (text?.startsWith("❌ Cancel Table ")) {
    const tableId = text.replace("❌ Cancel Table ", "").trim();
    const t = tables[tableId];
    if (!t) { send(chatId, "Table not found.", mainMenu()); return; }
    if (chatId !== t.creatorId) { send(chatId, "Only the creator can cancel."); return; }
    if (t.status !== "open") { send(chatId, "Table is no longer open.", mainMenu()); return; }
    clearTimeout(t.expireTimer);
    cancelTable(tableId, "cancelled by creator");
    if (t.groupMsgId) {
      bot.editMessageText(`Table ${tableId} was cancelled by creator.`,
        { chat_id: GROUP_ID, message_id: t.groupMsgId }).catch(() => {});
      bot.editMessageReplyMarkup({ inline_keyboard: [] },
        { chat_id: GROUP_ID, message_id: t.groupMsgId }).catch(() => {});
    }
    return;
  }

  if (text?.startsWith("✅ Accept ")) {
    const tableId = text.replace("✅ Accept ", "").trim();
    const t = tables[tableId];
    if (!t || t.status !== "pending_accept") { send(chatId, "This match is no longer available.", mainMenu()); return; }
    if (chatId !== t.opponentId) { send(chatId, "This request is not for you."); return; }
    clearTimeout(t.acceptTimer);
    send(chatId, `✅ Accepted!\n\nTable: ${tableId}\n\nWaiting for the creator to share the room code...`);
    askCreatorForRoomCode(tableId); return;
  }

  if (text?.startsWith("❌ Decline ")) {
    const tableId = text.replace("❌ Decline ", "").trim();
    const t = tables[tableId];
    if (!t) { send(chatId, "Table not found.", mainMenu()); return; }
    clearTimeout(t.acceptTimer);
    cancelTable(tableId, "declined by opponent"); return;
  }

  if (text?.startsWith("▶️ Start Game ")) {
    const tableId = text.replace("▶️ Start Game ", "").trim();
    const t = tables[tableId];
    if (!t || t.status !== "room_shared") { send(chatId, "Game session not found or already started.", mainMenu()); return; }
    if (chatId !== t.opponentId) { send(chatId, "Only the opponent can press Start."); return; }
    activateGame(tableId); return;
  }

  if (text?.startsWith("🏆 I Won ")) {
    const tableId = text.replace("🏆 I Won ", "").trim();
    const t = tables[tableId];
    if (!t || t.status !== "active") { send(chatId, "Table is not active.", mainMenu()); return; }
    if (chatId !== t.creatorId && chatId !== t.opponentId) { send(chatId, "You are not in this table."); return; }
    const already = Object.values(pendingWinClaims).find(c => c.tableId === tableId && c.claimerId === chatId && c.status === "pending");
    if (already) { send(chatId, `Claim already submitted: ${already.claimId}\nWait for admin verification.`); return; }
    userState[chatId] = { action: "win_proof_screenshot", tableId };
    send(chatId,
      `Win Claim — Table ${tableId}\n\nSend a screenshot of your winning game as proof.\n\nFalse claims = permanent ban.`,
      cancelKb("❌ Cancel Claim")); return;
  }

  if (text?.startsWith("😔 I Lost ")) {
    const tableId = text.replace("😔 I Lost ", "").trim();
    const t = tables[tableId];
    if (!t || t.status !== "active") { send(chatId, "Table is not active.", mainMenu()); return; }
    if (chatId !== t.creatorId && chatId !== t.opponentId) { send(chatId, "You are not in this table."); return; }
    if (t.lossReports.includes(chatId)) { send(chatId, "You already reported a loss for this table."); return; }
    t.lossReports.push(chatId);
    users[chatId].gamesPlayed += 1;
    users[chatId].status       = "idle";
    users[chatId].tableId      = null;
    send(chatId, `😔 Loss recorded for table ${tableId}.\n\nBetter luck next time!`, mainMenu());
    bot.sendMessage(ADMIN_ID, `${users[chatId]?.name} (${chatId}) reported a loss on table ${tableId}.`).catch(() => {});
    return;
  }

  if (text === "❌ Cancel Game") {
    const st = userState[chatId];
    if (st?.action === "send_room_code") { const tid = st.tableId; delete userState[chatId]; cancelTable(tid, "cancelled by creator"); return; }
    const activeTable = Object.values(tables).find(t => (t.creatorId === chatId || t.opponentId === chatId) && t.status === "room_shared");
    if (activeTable) { cancelTable(activeTable.tableId, "cancelled by opponent before start"); return; }
    send(chatId, "No active game to cancel.", mainMenu()); return;
  }
  if (text === "❌ Cancel Claim")   { delete userState[chatId]; send(chatId, "❌ Claim cancelled.", mainMenu()); return; }
  if (text === "❌ Cancel Deposit") { if (userState[chatId]?.action === "deposit_screenshot") { delete userState[chatId]; send(chatId, "❌ Deposit cancelled.", mainMenu()); } return; }
  if (text === "❌ Cancel")         { delete userState[chatId]; send(chatId, "❌ Cancelled.", mainMenu()); return; }

  // User state machine
  const st = userState[chatId];
  if (st) {
    if (st.action === "send_room_code") {
      const t = tables[st.tableId];
      if (!t || t.status !== "room_pending") { delete userState[chatId]; send(chatId, "⚠️ Table no longer available.", mainMenu()); return; }
      delete userState[chatId];
      sendRoomCodeToOpponent(st.tableId, text.trim()); return;
    }
    if (st.action === "deposit_screenshot")   { send(chatId, "📸 Please send a screenshot IMAGE, not text.\n\nTap Cancel Deposit to cancel."); return; }
    if (st.action === "win_proof_screenshot") { send(chatId, "📸 Please send a screenshot IMAGE as proof, not text."); return; }
    if (st.action === "withdraw_upi") {
      const { amount } = st;
      if ((users[chatId]?.balance || 0) < amount) {
        send(chatId, `❌ Insufficient balance! You have ₹${users[chatId]?.balance || 0}`, mainMenu());
        delete userState[chatId]; return;
      }
      const txnId = genTxnId();
      const upiId = text.trim().replace(/[`*_\[\]]/g, "");
      users[chatId].balance -= amount;
      pendingWithdrawals[txnId] = { txnId, chatId, amount, upiId, status: "pending", timestamp: new Date() };
      delete userState[chatId];
      sendMD(chatId,
        `✅ Withdrawal Submitted!\n\nTXN: ${tapCopy(txnId)}\nAmount: ₹${amount}\nUPI: ${tapCopy(upiId)}\n\n` +
        `Balance: ₹${users[chatId].balance}\n\nAdmin will process within 24 hours.`,
        mainMenu());
      bot.sendMessage(ADMIN_ID,
        `New Withdrawal Request!\n\nTXN: ${txnId}\nUser: ${users[chatId]?.name} (${chatId})\nAmount: ₹${amount}\nUPI: ${upiId}`,
        { reply_markup: { inline_keyboard: [[{ text: "✅ Mark Paid", callback_data: `wdl_done_${txnId}` }, { text: "❌ Reject", callback_data: `wdl_rej_${txnId}` }]] }}
      ).catch(() => {}); return;
    }
  }

  // Main menu
  if (text === "💰 Deposit") {
    send(chatId, "💰 Deposit\n\nChoose amount:", {
      reply_markup: { inline_keyboard: [
        [{ text: "₹50", callback_data: "deposit_50" }, { text: "₹100", callback_data: "deposit_100" }, { text: "₹200", callback_data: "deposit_200" }],
        [{ text: "₹500", callback_data: "deposit_500" }, { text: "₹1000", callback_data: "deposit_1000" }],
        [{ text: "❌ Cancel", callback_data: "back_menu" }],
      ]},
    }); return;
  }

  if (text === "💸 Withdraw") {
    const u           = users[chatId];
    const gamesPlayed = u?.gamesPlayed || 0;
    const hasDeposited = u?.hasDeposited || false;
    if (gamesPlayed < 2 && !hasDeposited) {
      send(chatId,
        `❌ Withdrawal Not Available Yet!\n\nTo unlock withdrawals:\n• Play at least 2 matches, OR\n• Make at least 1 deposit\n\n` +
        `Your Progress:\nMatches Played: ${gamesPlayed}/2\nDeposits Made: ${hasDeposited ? "Yes ✅" : "No ❌"}`,
        mainMenu()); return;
    }
    send(chatId, `💸 Withdraw\n\nYour Balance: ₹${u?.balance || 0}\nMinimum: ₹100`, {
      reply_markup: { inline_keyboard: [
        [{ text: "₹100", callback_data: "withdraw_100" }, { text: "₹200", callback_data: "withdraw_200" }, { text: "₹500", callback_data: "withdraw_500" }],
        [{ text: "₹1000", callback_data: "withdraw_1000" }],
        [{ text: "❌ Cancel", callback_data: "back_menu" }],
      ]},
    }); return;
  }

  if (text === "⚡ Quick Ludo") {
    requireGroupMembership(chatId, () => {
      send(chatId, "⚡ Quick Ludo\n\nFast-paced 2-player games!\n\nChoose entry fee:", {
        reply_markup: { inline_keyboard: [
          [{ text: "₹50", callback_data: "join_quick_50" }, { text: "₹100", callback_data: "join_quick_100" }, { text: "₹200", callback_data: "join_quick_200" }],
          [{ text: "₹250", callback_data: "join_quick_250" }, { text: "₹500", callback_data: "join_quick_500" }],
          [{ text: "❌ Cancel", callback_data: "back_menu" }],
        ]},
      });
    }); return;
  }

  if (text === "🎲 Classic Ludo") {
    requireGroupMembership(chatId, () => {
      send(chatId,
        `🎲 Classic Ludo — Choose Goti Mode\n\nℹ️ Goti = number of tokens per player\nAll matches are 2 players.\n\nSelect your Goti mode:`,
        { reply_markup: { inline_keyboard: [
          [{ text: "1 Goti", callback_data: "classic_1goti" }, { text: "2 Goti", callback_data: "classic_2goti" },
           { text: "3 Goti", callback_data: "classic_3goti" }, { text: "4 Goti", callback_data: "classic_4goti" }],
          [{ text: "❌ Cancel", callback_data: "back_menu" }],
        ]}});
    }); return;
  }

  if (text === "🏆 Popular Ludo") {
    requireGroupMembership(chatId, () => {
      send(chatId, "🏆 Popular Ludo\n\nHigh-stakes 2-player games!\n\nChoose entry fee:", {
        reply_markup: { inline_keyboard: [
          [{ text: "₹50", callback_data: "join_popular_50" }, { text: "₹100", callback_data: "join_popular_100" }, { text: "₹200", callback_data: "join_popular_200" }],
          [{ text: "₹500", callback_data: "join_popular_500" }, { text: "₹1000", callback_data: "join_popular_1000" }],
          [{ text: "❌ Cancel", callback_data: "back_menu" }],
        ]},
      });
    }); return;
  }

  if (text === "👤 Profile") {
    const u  = users[chatId] || {};
    const pd = Object.values(pendingDeposits).find(d => d.chatId === chatId && d.status === "pending");
    const em = { idle: "😴", waiting: "⏳", "in-game": "🎮" }[u.status] || "😴";
    sendMD(chatId,
      `👤 Your Profile\n\nID: ${tapCopy(chatId)}\nName: ${escMD(u.name || "N/A")}\nUsername: @${escMD(u.username || "N/A")}\n\n` +
      `Balance: ₹${u.balance || 0}\nGames Played: ${u.gamesPlayed || 0}\nGames Won: ${u.gamesWon || 0}\n` +
      `Status: ${em} ${u.status || "idle"}` +
      (pd ? `\n\nPending Deposit: ₹${pd.amount} (TXN: ${tapCopy(pd.txnId)})` : ""),
      mainMenu()); return;
  }

  if (text === "🤝 Refer & Earn") {
    const u = users[chatId] || {};
    sendMD(chatId,
      `🤝 Refer and Earn\n\nTotal Referrals: ${u.referCount || 0}\n\n` +
      `Your Referral Link:\n${tapCopy(`https://t.me/Ludo_AddaBot?start=${chatId}`)}\n\n` +
      `Earn ₹${REFER_REWARD} for each friend who joins AND plays their first match\\!`);
    return;
  }

  if (text === "🆘 Support") {
    send(chatId, "🆘 Support\nChoose an option:", {
      reply_markup: { inline_keyboard: [
        [{ text: "📞 Contact", url: "https://t.me/MARK41_helperBot" }],
        [{ text: "❓ FAQ", callback_data: "faq" }],
        [{ text: "🔙 Back", callback_data: "back_menu" }],
      ]},
    }); return;
  }
});

// ─── CALLBACK QUERY HANDLER ───────────────────────────────────────────────────
bot.on("callback_query", query => {
  const data            = query.data;
  const msgId           = query.message.message_id;
  const isGroupCallback = query.message.chat.type !== "private";
  const chatId          = isGroupCallback ? query.from.id : query.message.chat.id;
  const groupChatId     = query.message.chat.id;

  bot.answerCallbackQuery(query.id).catch(() => {});

  if (data === "check_membership") {
    isGroupMember(chatId).then(isMember => {
      if (isMember) {
        bot.deleteMessage(chatId, msgId).catch(() => {});
        send(chatId, `✅ Welcome to Ludo Adda!\n\nYou've joined the group. Let's play!`, mainMenu());
      } else {
        send(chatId, `❌ You haven't joined yet!\n\nPlease join the group first, then tap "I've Joined" again.`, {
          reply_markup: { inline_keyboard: [
            [{ text: "✅ Join Our Group", url: GROUP_INVITE_LINK }],
            [{ text: "▶️ I've Joined — Start Playing", callback_data: "check_membership" }],
          ]},
        });
      }
    }); return;
  }

  if (data.startsWith("join_")) {
    const parts    = data.split("_");
    const gameType = parts[1];
    const fee      = parseInt(parts[2]);
    if (!isGroupCallback) bot.deleteMessage(chatId, msgId).catch(() => {});
    handleJoin(chatId, gameType, fee); return;
  }

  if (data.startsWith("classic_") && data.endsWith("goti")) {
    const gotiMode  = data;
    if (!isGroupCallback) bot.deleteMessage(chatId, msgId).catch(() => {});
    const gotiLabel = data.replace("classic_", "").replace("goti", "") + " Goti";
    send(chatId, `🎲 Classic Ludo — ${gotiLabel} Mode\n(2 players | choose entry fee):`, {
      reply_markup: { inline_keyboard: [
        [{ text: "₹50", callback_data: `join_${gotiMode}_50` }, { text: "₹100", callback_data: `join_${gotiMode}_100` }, { text: "₹200", callback_data: `join_${gotiMode}_200` }],
        [{ text: "₹250", callback_data: `join_${gotiMode}_250` }, { text: "₹500", callback_data: `join_${gotiMode}_500` }],
        [{ text: "🔙 Back", callback_data: "back_menu" }],
      ]},
    }); return;
  }

  if (data.startsWith("group_join_")) {
    const tableId = data.replace("group_join_", "");
    const t       = tables[tableId];
    if (!t || t.status !== "open") {
      bot.answerCallbackQuery(query.id, { text: "This table is no longer available.", show_alert: true }).catch(() => {}); return;
    }
    ensureUser(query.from);
    const user = users[chatId];
    if (chatId === t.creatorId) { bot.answerCallbackQuery(query.id, { text: "You can't join your own table!", show_alert: true }).catch(() => {}); return; }
    if (user.status !== "idle") { bot.answerCallbackQuery(query.id, { text: `You are already in a session (${user.status}). Finish it first.`, show_alert: true }).catch(() => {}); return; }
    if (user.balance < t.entryFee) { bot.answerCallbackQuery(query.id, { text: `Insufficient balance! You need ₹${t.entryFee}. Please deposit first.`, show_alert: true }).catch(() => {}); return; }

    user.balance -= t.entryFee;
    user.status   = "waiting";
    user.tableId  = tableId;
    t.opponentId  = chatId;
    t.status      = "pending_accept";
    clearTimeout(t.expireTimer);

    if (t.groupMsgId) {
      bot.editMessageText(
        `Table ${tableId} — Match Found!\n\n${gameLabel(t.gameType)} | ₹${t.entryFee}\n${dname(t.creatorId)} vs ${dname(chatId)}`,
        { chat_id: groupChatId, message_id: t.groupMsgId }
      ).catch(() => {});
      bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: groupChatId, message_id: t.groupMsgId }).catch(() => {});
    }

    send(t.creatorId, `🎯 Opponent found via group!\n\nOpponent: ${dname(chatId)}\nTable: ${tableId}\n\nWaiting for opponent to accept...`);
    send(chatId,
      `🎯 Match Request!\n\nGame: ${gameLabel(t.gameType)}\nTable Creator: ${dname(t.creatorId)}\n` +
      `Entry: ₹${t.entryFee} (deducted) | Pot: ₹${t.pot}\nWinner Gets: ₹${t.winnerGets}\n\nAccept or Decline within 5 minutes!`,
      acceptDeclineMenu(tableId));
    t.acceptTimer = setTimeout(() => timeoutPendingAccept(tableId), 300_000); return;
  }

  if (data.startsWith("dep_approve_")) {
    const txnId = data.replace("dep_approve_", ""); const dep = pendingDeposits[txnId];
    if (!dep || dep.status !== "pending") { bot.answerCallbackQuery(query.id, { text: "Already processed." }); return; }
    dep.status = "approved"; users[dep.chatId].balance += dep.amount; users[dep.chatId].hasDeposited = true;
    bot.deleteMessage(chatId, msgId).catch(() => {});
    send(chatId, `✅ Deposit ${txnId} approved! ₹${dep.amount} added to ${users[dep.chatId]?.name}.`);
    send(dep.chatId, `✅ Deposit Approved!\n\n₹${dep.amount} added to your wallet!\nNew Balance: ₹${users[dep.chatId].balance}`, mainMenu()); return;
  }
  if (data.startsWith("dep_reject_")) {
    const txnId = data.replace("dep_reject_", ""); const dep = pendingDeposits[txnId];
    if (!dep || dep.status !== "pending") { bot.answerCallbackQuery(query.id, { text: "Already processed." }); return; }
    dep.status = "rejected"; bot.deleteMessage(chatId, msgId).catch(() => {});
    send(chatId, `❌ Deposit ${txnId} rejected.`);
    send(dep.chatId, `❌ Deposit Rejected!\n\nYour deposit of ₹${dep.amount} was rejected.\nContact support if this is a mistake.`, mainMenu()); return;
  }

  if (data.startsWith("wdl_done_")) {
    const txnId = data.replace("wdl_done_", ""); const w = pendingWithdrawals[txnId];
    if (!w || w.status !== "pending") { bot.answerCallbackQuery(query.id, { text: "Already processed." }); return; }
    w.status = "done"; bot.deleteMessage(chatId, msgId).catch(() => {});
    send(chatId, `✅ Withdrawal ${txnId} marked as paid!`);
    send(w.chatId, `✅ Withdrawal Processed!\n\n₹${w.amount} sent to your UPI!\nTXN: ${txnId}`, mainMenu()); return;
  }
  if (data.startsWith("wdl_rej_")) {
    const txnId = data.replace("wdl_rej_", ""); const w = pendingWithdrawals[txnId];
    if (!w || w.status !== "pending") { bot.answerCallbackQuery(query.id, { text: "Already processed." }); return; }
    w.status = "rejected"; users[w.chatId].balance += w.amount; bot.deleteMessage(chatId, msgId).catch(() => {});
    send(chatId, `❌ Withdrawal ${txnId} rejected. Amount refunded.`);
    send(w.chatId, `❌ Withdrawal Rejected!\n\n₹${w.amount} refunded.\nBalance: ₹${users[w.chatId].balance}\n\nContact support for help.`, mainMenu()); return;
  }

  if (data.startsWith("win_approve_")) {
    const cid = data.replace("win_approve_", ""); const claim = pendingWinClaims[cid];
    if (!claim || claim.status !== "pending") { bot.answerCallbackQuery(query.id, { text: "Already processed." }); return; }
    const t = tables[claim.tableId]; if (!t) { send(chatId, "Table not found."); return; }
    claim.status = "approved"; declareWinner(claim.tableId, claim.claimerId);
    bot.deleteMessage(chatId, msgId).catch(() => {});
    send(chatId, `✅ Claim ${cid} approved. Winner: ${users[claim.claimerId]?.name} | ₹${t.winnerGets} paid.`); return;
  }
  if (data.startsWith("win_reject_")) {
    const cid = data.replace("win_reject_", ""); const claim = pendingWinClaims[cid];
    if (!claim || claim.status !== "pending") { bot.answerCallbackQuery(query.id, { text: "Already processed." }); return; }
    claim.status = "rejected"; bot.deleteMessage(chatId, msgId).catch(() => {});
    send(chatId, `❌ Claim ${cid} rejected.`);
    send(claim.claimerId, `❌ Win Claim Rejected!\n\nTable: ${claim.tableId}\nContact support if this is a mistake.`, mainMenu()); return;
  }

  if (data.startsWith("bal_add_") || data.startsWith("bal_ded_")) {
    const isAdd = data.startsWith("bal_add_"); const tid = parseInt(data.split("_").pop());
    if (!users[tid]) { send(chatId, "❌ User not found."); return; }
    adminState[chatId] = { action: isAdd ? "bal_add" : "bal_ded", targetId: tid };
    send(chatId, `${isAdd ? "Add" : "Deduct"} balance for ${users[tid].name}\n\nEnter amount (₹):`, cancelKb()); return;
  }
  if (data === "bal_cancel") { delete adminState[chatId]; send(chatId, "❌ Cancelled.", adminMenu()); return; }

  if (data.startsWith("reset_state_")) {
    const tid = parseInt(data.replace("reset_state_", ""));
    if (!users[tid]) { send(chatId, "❌ User not found."); return; }
    const u = users[tid];
    if (u.tableId && tables[u.tableId]) {
      const t = tables[u.tableId];
      if (!["completed", "cancelled"].includes(t.status)) cancelTable(u.tableId, "reset by admin");
    }
    u.status = "idle"; u.tableId = null; delete userState[tid];
    send(chatId, `✅ User ${u.name} (${tid}) state has been reset to idle.`);
    send(tid, `🔄 Your account state was reset by admin.\n\nIf you had a pending game it has been cancelled and your entry fee refunded.`, mainMenu()); return;
  }

  if (data.startsWith("declare_winner_")) {
    const tableId = data.replace("declare_winner_", ""); const t = tables[tableId];
    if (!t) { send(chatId, "Table not found."); return; }
    if (["completed", "cancelled"].includes(t.status)) { send(chatId, `Table ${tableId} is already ${t.status}.`); return; }
    const list = [t.creatorId, t.opponentId].filter(Boolean).map(pid => `${pid} — ${users[pid]?.name || "Unknown"}`).join("\n");
    adminState[chatId] = { action: "declare_winner", tableId };
    send(chatId, `Declare Winner — ${tableId}\n\nPlayers:\n${list}\n\nSend the winner's User ID:`); return;
  }

  if (data.startsWith("cancel_table_")) {
    const tableId = data.replace("cancel_table_", ""); const t = tables[tableId];
    if (!t) { send(chatId, "Table not found."); return; }
    if (["completed", "cancelled"].includes(t.status)) { send(chatId, `Table ${tableId} is already ${t.status}.`); return; }
    cancelTable(tableId, "cancelled by admin");
    send(chatId, `✅ Table ${tableId} cancelled. All players refunded.`, adminMenu()); return;
  }

  if (data.startsWith("deposit_")) {
    const amount = parseInt(data.split("_")[1]); if (!amount) return;
    const ep = Object.values(pendingDeposits).find(d => d.chatId === chatId && d.status === "pending");
    if (ep) { send(chatId, `Pending deposit exists!\n\nTXN: ${ep.txnId} | ₹${ep.amount}\n\nWait for admin to process it first.`, mainMenu()); return; }
    userState[chatId] = { action: "deposit_screenshot", amount };
    const QR = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=upi://pay?pa=7891624054@mbk%26pn=LudoAdda%26am=${amount}%26cu=INR`;
    bot.sendPhoto(chatId, QR, {
      caption:
        `Deposit ₹${amount}\n\nUPI ID: 7891624054@mbk\nAmount: ₹${amount}\n\n` +
        `Scan QR above OR pay to the UPI ID manually.\n\n` +
        `After payment, send the SCREENSHOT of your transaction.\nScreenshot must contain the UTR number.`,
      reply_markup: { keyboard: [[{ text: "❌ Cancel Deposit" }]], resize_keyboard: true, one_time_keyboard: true },
    }).catch(() => {}); return;
  }

  if (data.startsWith("withdraw_")) {
    const amount = parseInt(data.split("_")[1]); if (!amount) return;
    if ((users[chatId]?.balance || 0) < amount) { send(chatId, `❌ Insufficient balance! You have ₹${users[chatId]?.balance || 0}`); return; }
    userState[chatId] = { action: "withdraw_upi", amount };
    send(chatId, `Withdraw ₹${amount}\n\nPlease enter your UPI ID:`, cancelKb()); return;
  }

  if (data === "back_menu") { bot.deleteMessage(chatId, msgId).catch(() => {}); send(chatId, "Main Menu:", mainMenu()); return; }
  if (data === "faq") {
    send(chatId,
      `❓ FAQ\n\nHow to deposit?\nTap Deposit → choose amount → pay via UPI → send screenshot.\n\n` +
      `How to withdraw?\nTap Withdraw → choose amount → enter UPI ID.\nRequires 2 matches played OR 1 deposit.\n\n` +
      `How is the winner decided?\nTap "I Won" after game → submit screenshot → Admin verifies.\n\n` +
      `Refer & Earn?\nEarn ₹${REFER_REWARD} when your referred friend plays their first match.\n\n` +
      `Platform fee?\n${PLATFORM_CUT_PERCENT}% is deducted from the pot as platform fee.`); return;
  }
});

// ─── PHOTO HANDLER ────────────────────────────────────────────────────────────
bot.on("photo", msg => {
  const chatId = msg.chat.id;
  if (isAdmin(chatId)) return;
  const st = userState[chatId];
  if (!st) return;

  if (st.action === "deposit_screenshot") {
    const ep = Object.values(pendingDeposits).find(d => d.chatId === chatId && d.status === "pending");
    if (ep) { send(chatId, `Deposit already pending: ${ep.txnId} | ₹${ep.amount}\nWait for admin.`, mainMenu()); delete userState[chatId]; return; }
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const txnId  = genTxnId();
    pendingDeposits[txnId] = { txnId, chatId, amount: st.amount, screenshotFileId: fileId, status: "pending", timestamp: new Date() };
    delete userState[chatId];
    send(chatId, `📸 Screenshot Received!\n\nTXN ID: ${txnId}\nAmount: ₹${st.amount}\n\nAdmin is verifying. You will be notified.`, mainMenu());
    bot.sendPhoto(ADMIN_ID, fileId, {
      caption: `New Deposit Request!\n\nTXN: ${txnId}\nUser: ${users[chatId]?.name || "Unknown"} (${chatId})\nUsername: @${users[chatId]?.username || "N/A"}\nAmount: ₹${st.amount}\nTime: ${new Date().toLocaleString("en-IN")}`,
      reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: `dep_approve_${txnId}` }, { text: "❌ Reject", callback_data: `dep_reject_${txnId}` }]] },
    }).catch(() => {
      bot.sendMessage(ADMIN_ID, `New Deposit!\nTXN: ${txnId}\nUser: ${users[chatId]?.name} (${chatId})\nAmount: ₹${st.amount}\nScreenshot forward failed.`,
        { reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: `dep_approve_${txnId}` }, { text: "❌ Reject", callback_data: `dep_reject_${txnId}` }]] }}
      ).catch(() => {});
    }); return;
  }

  if (st.action === "win_proof_screenshot") {
    const { tableId } = st; const t = tables[tableId];
    if (!t || t.status !== "active") { send(chatId, "Table is no longer active.", mainMenu()); delete userState[chatId]; return; }
    const fileId  = msg.photo[msg.photo.length - 1].file_id;
    const claimId = genClaimId();
    pendingWinClaims[claimId] = { claimId, tableId, claimerId: chatId, screenshotFileId: fileId, status: "pending", timestamp: new Date() };
    delete userState[chatId];
    send(chatId, `✅ Win Claim Submitted!\n\nClaim ID: ${claimId}\nTable: ${tableId}\n\nAdmin will verify your screenshot. You will be notified.`, mainMenu());
    const opp = [t.creatorId, t.opponentId].filter(p => p && p !== chatId).map(p => users[p]?.name || p).join(", ");
    bot.sendPhoto(ADMIN_ID, fileId, {
      caption: `New Win Claim!\n\nClaim: ${claimId}\nTable: ${tableId}\nClaimer: ${users[chatId]?.name || "Unknown"} (${chatId})\nvs: ${opp}\nPrize: ₹${t.winnerGets}\nTime: ${new Date().toLocaleString("en-IN")}`,
      reply_markup: { inline_keyboard: [[{ text: "✅ Approve Win", callback_data: `win_approve_${claimId}` }, { text: "❌ Reject", callback_data: `win_reject_${claimId}` }]] },
    }).catch(() => {
      bot.sendMessage(ADMIN_ID, `New Win Claim!\nClaim: ${claimId}\nTable: ${tableId}\nClaimer: ${users[chatId]?.name} (${chatId})\nPrize: ₹${t.winnerGets}\nScreenshot forward failed.`,
        { reply_markup: { inline_keyboard: [[{ text: "✅ Approve Win", callback_data: `win_approve_${claimId}` }, { text: "❌ Reject", callback_data: `win_reject_${claimId}` }]] }}
      ).catch(() => {});
    }); return;
  }
});

// ─── PROCESS SAFETY ───────────────────────────────────────────────────────────
process.on("unhandledRejection", r => console.error("Unhandled rejection:", r));
process.on("uncaughtException",  e => console.error("Uncaught exception:",  e.message));
