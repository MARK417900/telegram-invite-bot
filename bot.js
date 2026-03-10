
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");


const token = "8015347446:AAG49JNaGrSNKK4lFkMWXkfRQd-pyLvSMMQ";
const bot = new TelegramBot(token, { polling: true });

const botUsername = "HotyaReferBot";

// ADMIN ID
const ADMIN_IDS = [8521844327, 8809115899];

// REQUIRED CHANNELS
const channels = [
  "@earnwithmark41",
  "@Marks_community",
  "@MSofficialTeam"
];

// USER DATABASE
let users = {};

if (fs.existsSync("users.json")) {
  users = JSON.parse(fs.readFileSync("users.json"));
}
function saveUsers() {
  fs.writeFile("users.json", JSON.stringify(users, null, 2), err => {
    if(err) console.log("Error saving users:", err);
    else console.log("✅ users.json updated successfully");
  });
}
// CHECK CHANNEL MEMBERSHIP
async function checkMembership(userId) {

  try {

    for (let channel of channels) {

      const member = await bot.getChatMember(channel, userId);

      if (member.status === "left" || member.status === "kicked") {
        return false;
      }

    }

    return true;

  } catch (err) {
    return false;
  }

}


// START COMMAND
bot.onText(/\/start(?: (.+))?/, (msg, match) => {

  const chatId = msg.chat.id;
  const referrerId = match[1];

 if (!users[chatId]) {

 users[chatId] = {
  ref: 0,
  redeems: 0,
  invited: [],
  referredBy: null
};

}

// Save referral only first time
if (referrerId && referrerId != chatId && !users[chatId].referredBy) {
  users[chatId].referredBy = referrerId;
}
saveUsers();
  let joinText = "🚨 Please join all channels first to use the bot.";

  let buttons = [];

  channels.forEach((ch) => {

    buttons.push([
      {
        text: "📢 Join Channel",
        url: `https://t.me/${ch.replace("@","")}`
      }
    ]);

  });

  buttons.push([
    { text: "✅ I Joined", callback_data: "check_join" }
  ]);

  bot.sendMessage(chatId, joinText, {
    reply_markup: {
      inline_keyboard: buttons
    }
  });

});


// JOIN BUTTON HANDLER
bot.on("callback_query", async (query) => {

  bot.answerCallbackQuery(query.id);

  const chatId = query.message.chat.id;

  if (query.data === "check_join") {

    const joined = await checkMembership(chatId);

    if (!joined) {
      bot.sendMessage(chatId,"❌ You must join all channels first.");
      return;
    }

    // FIX: ensure user exists
 if (!users[chatId]) {
  users[chatId] = {
    ref: 0,
    invited: [],
    redeems: 0,
    referredBy: null
  };
      saveUsers();
    }

    const user = users[chatId];

    if (user.referredBy && user.referredBy != chatId) {

      if (!users[user.referredBy]) {
        users[user.referredBy] = {
          ref: 0,
          invited: [],
          referredBy: null
        };
      }

      const referrer = users[user.referredBy];

      if (!referrer.invited.includes(chatId)) {

        referrer.invited.push(chatId);
        referrer.ref += 1;
        saveUsers();

        bot.sendMessage(user.referredBy,
`🎉 New referral joined all channels!

👤 User ID: ${chatId}

📊 Total referrals: ${referrer.ref}`);

      }
    }

    bot.sendMessage(chatId,
"✅ Access Granted!", {
      reply_markup: {
        keyboard: [
          ["👥 Refer", "💰 Balance"],
          ["🎁 Get Code"]
        ],
        resize_keyboard: true
      }
    });

  }

});

// MESSAGE HANDLER
bot.on("message", async (msg) => {

  const chatId = msg.chat.id;
const text = msg.text || "";
if (text.startsWith("/")) return;

  if (!users[chatId]) {

    users[chatId] = {
  ref: 0,
  redeems: 0,
  invited: [],
  referredBy: null
};
        saveUsers();

  }

  // REFER BUTTON
  if (text === "👥 Refer") {

    const refLink = `https://t.me/${botUsername}?start=${chatId}`;

    bot.sendMessage(chatId,
`👥 Your referral link:

${refLink}

Invite 5 friends to unlock your reward code!`);

  }

  // BALANCE BUTTON
 if (text === "💰 Balance") {

  const user = users[chatId];

const progress = user.ref % 5; // shows 1/5, 2/5
  const safeProgress = progress < 0 ? 0 : progress;

  bot.sendMessage(chatId,
`📊 Your Stats

👥 Total Referrals: ${user.ref}

🎁 Codes Redeemed: ${user.redeems}

🏆 Current Progress: ${safeProgress}/5`);

}
  // GET CODE
  if (text === "🎁 Get Code") {

    const joined = await checkMembership(chatId);

    if (!joined) {
      bot.sendMessage(chatId,"❌ Please join all channels first.");
      return;
    }

   const progress = user.ref % 5; // progress toward next reward

if (progress < 5) {
    bot.sendMessage(chatId,
`❌ You need 5 referrals.

Current progress: ${progress}/5`);
    return;
  }
}

    bot.sendMessage(chatId,
`🎉 Congratulations!

You completed 5 referrals.

📩 Now message the admin bot to receive your code:

👉 https://t.me/Mark41_helperBot

Send this message there:

"Please send my reward code. My Telegram ID: ${chatId}"

Admin will verify and send your code.`);

  }

});


// ================= ADMIN PANEL =================


// OPEN ADMIN PANEL
bot.onText(/\/admin/, (msg) => {

  const chatId = msg.chat.id;

  if (!ADMIN_IDS.includes(chatId)) return;

  bot.sendMessage(chatId,
`👑 Admin Panel

Commands:

/broadcast MESSAGE
/stats
/user USER_ID
/redeem USER_ID`);

});


// BROADCAST
bot.onText(/\/broadcast (.+)/, (msg, match) => {

  const chatId = msg.chat.id;
  if (!ADMIN_IDS.includes(chatId)) return;

  const message = match[1];

  Object.keys(users).forEach(id => {
    bot.sendMessage(id, message).catch(()=>{});
  });

  bot.sendMessage(chatId,"✅ Broadcast sent.");

});

// redeem count
bot.onText(/\/redeem (.+)/,(msg,match)=>{

  const chatId = msg.chat.id;

  if (!ADMIN_IDS.includes(chatId)) return;

  const userId = match[1];

  if(!users[userId]){
    bot.sendMessage(chatId,"User not found");
    return;
  }

  users[userId].redeems += 1;

  saveUsers();

  bot.sendMessage(chatId,"✅ Redeem approved.");

});

// BOT STATS
bot.onText(/\/stats/, (msg)=>{

  const chatId = msg.chat.id;
  if (!ADMIN_IDS.includes(chatId)) return;

  const totalUsers = Object.keys(users).length;

  bot.sendMessage(chatId,
`📊 Bot Stats

Users: ${totalUsers}`);

});


// ================= ADMIN FULL USER INFO =================
bot.onText(/\/user (.+)/, (msg, match) => {
    const chatId = msg.chat.id;

    // Only admins can use this command
    if (!ADMIN_IDS.includes(chatId)) return;

    const userId = match[1];

    if (!users[userId]) {
        bot.sendMessage(chatId, "❌ User not found");
        return;
    }

    const user = users[userId];
    const progress = user.ref % 5; // Progress toward next reward

    bot.sendMessage(chatId,
`👤 User ${userId}

Total Referrals: ${user.ref}
Redeems: ${user.redeems}
Current Progress: ${progress}/5
Invited Users: ${user.invited.join(", ") || "None"}
Referred By: ${user.referredBy || "None"}`);
});






