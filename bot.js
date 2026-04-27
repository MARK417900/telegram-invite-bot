const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

// ─── ADD YOUR DETAILS HERE ────────────────────────────────────────────────────
const BOT_TOKEN = "8605121015:AAFz-OwQB540Lzs7ak8zxSGS_dopDApoetU";           // 👈 Paste your token here
const WEBHOOK_URL = "https://telegram-invite-bot-ihm1.onrender.com"; // 👈 Paste your Render URL here
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

const bot = new TelegramBot(BOT_TOKEN);

// Set webhook
bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);

// Receive updates via webhook
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Keep alive for UptimeRobot
app.get("/", (req, res) => {
  res.send("🎲 Ludo Bot is running!");
});

// ─── MAIN MENU ────────────────────────────────────────────────────────────────
function getMainMenu() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "💰 Deposit" }, { text: "💸 Withdraw" }],
        [{ text: "🎲 Classic Ludo" }, { text: "⚡ Quick Ludo" }],
        [{ text: "🏆 Popular Ludo" }],
        [{ text: "🆘 Support" }, { text: "👤 Profile" }],
      ],
      resize_keyboard: true,
      persistent: true,
    },
  };
}

// ─── /START ───────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || "Player";

  bot.sendMessage(
    chatId,
    `🎲 *Welcome to Ludo Arena, ${firstName}!*\n\nPlay Ludo, win real money and enjoy the game!\n\n👇 *Choose an option below to get started:*`,
    {
      parse_mode: "Markdown",
      ...getMainMenu(),
    }
  );
});

// ─── MESSAGES ─────────────────────────────────────────────────────────────────
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // DEPOSIT
  if (text === "💰 Deposit") {
    bot.sendMessage(chatId, `💰 *Deposit*\n\nChoose a deposit amount:`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "₹50", callback_data: "deposit_50" },
            { text: "₹100", callback_data: "deposit_100" },
            { text: "₹200", callback_data: "deposit_200" },
          ],
          [
            { text: "₹500", callback_data: "deposit_500" },
            { text: "₹1000", callback_data: "deposit_1000" },
          ],
          [{ text: "🔙 Back", callback_data: "back_menu" }],
        ],
      },
    });
  }

  // WITHDRAW
  else if (text === "💸 Withdraw") {
    bot.sendMessage(
      chatId,
      `💸 *Withdraw*\n\nChoose an amount to withdraw:\n\n_Minimum withdrawal: ₹100_`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "₹100", callback_data: "withdraw_100" },
              { text: "₹200", callback_data: "withdraw_200" },
              { text: "₹500", callback_data: "withdraw_500" },
            ],
            [{ text: "🔙 Back", callback_data: "back_menu" }],
          ],
        },
      }
    );
  }

  // CLASSIC LUDO
  else if (text === "🎲 Classic Ludo") {
    bot.sendMessage(chatId, `🎲 *Classic Ludo*\n\nChoose your entry fee:`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "₹50 Entry", callback_data: "classic_50" },
            { text: "₹100 Entry", callback_data: "classic_100" },
          ],
          [
            { text: "₹200 Entry", callback_data: "classic_200" },
            { text: "₹500 Entry", callback_data: "classic_500" },
          ],
          [{ text: "🔙 Back", callback_data: "back_menu" }],
        ],
      },
    });
  }

  // QUICK LUDO
  else if (text === "⚡ Quick Ludo") {
    bot.sendMessage(
      chatId,
      `⚡ *Quick Ludo*\n\nFast-paced games! Choose your entry fee:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "₹25 Entry", callback_data: "quick_25" },
              { text: "₹50 Entry", callback_data: "quick_50" },
            ],
            [
              { text: "₹100 Entry", callback_data: "quick_100" },
              { text: "₹250 Entry", callback_data: "quick_250" },
            ],
            [{ text: "🔙 Back", callback_data: "back_menu" }],
          ],
        },
      }
    );
  }

  // POPULAR LUDO
  else if (text === "🏆 Popular Ludo") {
    bot.sendMessage(
      chatId,
      `🏆 *Popular Ludo*\n\nJoin the most popular tables right now! 🔥`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔥 Hot Table - ₹100", callback_data: "popular_100" }],
            [{ text: "💎 VIP Table - ₹500", callback_data: "popular_500" }],
            [{ text: "👑 Elite Table - ₹1000", callback_data: "popular_1000" }],
            [{ text: "🔙 Back", callback_data: "back_menu" }],
          ],
        },
      }
    );
  }

  // SUPPORT
  else if (text === "🆘 Support") {
    bot.sendMessage(chatId, `🆘 *Support*\n\nNeed help? Choose an option:`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📞 Contact Admin", url: "https://t.me/youradmin" }],
          [{ text: "❓ FAQ", callback_data: "support_faq" }],
          [{ text: "🐛 Report a Bug", callback_data: "support_bug" }],
          [{ text: "🔙 Back", callback_data: "back_menu" }],
        ],
      },
    });
  }

  // PROFILE
  else if (text === "👤 Profile") {
    const user = msg.from;
    bot.sendMessage(
      chatId,
      `👤 *Your Profile*\n\n` +
        `🆔 *ID:* \`${user.id}\`\n` +
        `👋 *Name:* ${user.first_name} ${user.last_name || ""}\n` +
        `📛 *Username:* @${user.username || "N/A"}\n\n` +
        `💰 *Balance:* ₹0.00\n` +
        `🎮 *Games Played:* 0\n` +
        `🏆 *Games Won:* 0`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📊 Game History", callback_data: "profile_history" }],
            [{ text: "🔙 Back", callback_data: "back_menu" }],
          ],
        },
      }
    );
  }
});

// ─── CALLBACK BUTTONS ─────────────────────────────────────────────────────────
bot.on("callback_query", (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  bot.answerCallbackQuery(query.id);

  if (data === "back_menu") {
    bot.sendMessage(chatId, `🏠 *Main Menu*\n\nChoose an option:`, {
      parse_mode: "Markdown",
      ...getMainMenu(),
    });
  }

  else if (data.startsWith("deposit_")) {
    const amount = data.split("_")[1];
    bot.sendMessage(
      chatId,
      `💰 *Deposit ₹${amount}*\n\n` +
        `Send ₹${amount} to the UPI below:\n\n` +
        `📲 *UPI ID:* \`yourupi@bank\`\n\n` +
        `After payment, send the UTR/Transaction ID here.`,
      { parse_mode: "Markdown" }
    );
  }

  else if (data.startsWith("withdraw_")) {
    const amount = data.split("_")[1];
    bot.sendMessage(
      chatId,
      `💸 *Withdraw ₹${amount}*\n\nPlease send your UPI ID to process the withdrawal.`,
      { parse_mode: "Markdown" }
    );
  }

  else if (
    data.startsWith("classic_") ||
    data.startsWith("quick_") ||
    data.startsWith("popular_")
  ) {
    const parts = data.split("_");
    const type = parts[0];
    const amount = parts[1];
    const typeName =
      type === "classic" ? "Classic" : type === "quick" ? "Quick" : "Popular";
    bot.sendMessage(
      chatId,
      `🎲 *${typeName} Ludo - ₹${amount} Entry*\n\n🔍 Finding players...\n\nPlease wait while we match you with other players!`,
      { parse_mode: "Markdown" }
    );
  }

  else if (data === "support_faq") {
    bot.sendMessage(
      chatId,
      `❓ *FAQ*\n\n` +
        `*Q: How do I deposit?*\nA: Click 💰 Deposit and choose an amount.\n\n` +
        `*Q: How do I withdraw?*\nA: Click 💸 Withdraw. Min withdrawal is ₹100.\n\n` +
        `*Q: How to play Ludo?*\nA: Choose any Ludo mode and pay the entry fee to join a room.`,
      { parse_mode: "Markdown" }
    );
  }

  else if (data === "support_bug") {
    bot.sendMessage(
      chatId,
      `🐛 *Report a Bug*\n\nDescribe your issue and send it here. Our team will look into it!`,
      { parse_mode: "Markdown" }
    );
  }

  else if (data === "profile_history") {
    bot.sendMessage(
      chatId,
      `📊 *Game History*\n\nYou haven't played any games yet.\nChoose a Ludo mode to start playing! 🎲`,
      { parse_mode: "Markdown" }
    );
  }
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Bot server running on port ${PORT}`);
});
