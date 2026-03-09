const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

const TelegramBot = require("node-telegram-bot-api");

const token = "8015347446:AAG49JNaGrSNKK4lFkMWXkfRQd-pyLvSMMQ";

const bot = new TelegramBot(token, { polling: true });

const botUsername = "HotyaReferBot";

// ADMIN ID
const ADMIN_ID = 8521844327;

// REQUIRED CHANNELS
const channels = [
  "@earnwithmark41","@Marks_community","@MSofficialTeam"
];

// UNIQUE CODES
let codes = [
"CODE1A","CODE2B","CODE3C","CODE4D","CODE5E",
"CODE6F","CODE7G","CODE8H","CODE9I","CODE10J",
"CODE11K","CODE12L","CODE13M","CODE14N","CODE15O",
"CODE16P","CODE17Q","CODE18R","CODE19S","CODE20T"
];

// USER DATABASE
const users = {};

// CHECK CHANNEL MEMBERSHIP
async function checkMembership(userId) {

  try {

    for (let channel of channels) {

      const member = await bot.getChatMember(channel, userId);

      if (
        member.status === "left" ||
        member.status === "kicked"
      ) {
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
      invited: [],
      referredBy: referrerId || null
    };
  }

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

  const chatId = query.message.chat.id;

  if (query.data === "check_join") {

    const joined = await checkMembership(chatId);

    if (!joined) {

      bot.sendMessage(chatId,"❌ You must join the channel first.");
      return;

    }

    const user = users[chatId];

    // COUNT REFERRAL AFTER JOIN
    if (user.referredBy && user.referredBy != chatId) {

      const referrer = users[user.referredBy];

      if (referrer && !referrer.invited.includes(chatId)) {

        referrer.invited.push(chatId);
        referrer.ref += 1;

        bot.sendMessage(user.referredBy,
`🎉 New referral joined!

Total referrals: ${referrer.ref}`);

      }

    }

    bot.sendMessage(chatId,
"✅ Access Granted!", {

      reply_markup: {
        keyboard: [
          ["👥 Refer"],
          ["💰 Balance"],
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

  if (!users[chatId]) {

    users[chatId] = {
      ref: 0,
      invited: [],
      referredBy: null
    };

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

    bot.sendMessage(chatId,
`📊 Your Stats

Referrals: ${users[chatId].ref}/5`);

  }

  // GET CODE
if (text === "🎁 Get Code") {

  const joined = await checkMembership(chatId);

  if (!joined) {
    bot.sendMessage(chatId,"❌ Please join the channel first.");
    return;
  }

  const user = users[chatId];

  if (user.ref < 5) {

    bot.sendMessage(chatId,
`❌ You need 5 referrals.

Current referrals: ${user.ref}/5`);

    return;

  }

  bot.sendMessage(chatId,
`🎉 Congratulations!

You completed 5 referrals.

📩 Now send a message to the admin bot to receive your code:

👉 https://t.me/Mark41_helperBot

Send this message there:

"Please send my reward code. My Telegram ID: ${chatId}"

Admin will verify and send your code.`);

  // RESET REFERRALS
  user.ref = 0;
  user.invited = [];

}


// ================= ADMIN PANEL =================

// OPEN ADMIN PANEL
bot.onText(/\/admin/, (msg) => {

  const chatId = msg.chat.id;

  if(chatId !== ADMIN_ID) return;

  bot.sendMessage(chatId,
`👑 Admin Panel

Commands:

/broadcast MESSAGE
/stats
/referrals USER_ID
/addcode CODE
/removecode CODE
/listcodes`);

});


// BROADCAST
bot.onText(/\/broadcast (.+)/, (msg, match) => {

  const chatId = msg.chat.id;
  if(chatId !== ADMIN_ID) return;

  const message = match[1];

  Object.keys(users).forEach(id => {
    bot.sendMessage(id, message).catch(()=>{});
  });

  bot.sendMessage(chatId,"✅ Broadcast sent.");

});


// BOT STATS
bot.onText(/\/stats/, (msg)=>{

  const chatId = msg.chat.id;
  if(chatId !== ADMIN_ID) return;

  const totalUsers = Object.keys(users).length;
  const remainingCodes = codes.length;

  bot.sendMessage(chatId,
`📊 Bot Stats

Users: ${totalUsers}
Available Codes: ${remainingCodes}`);

});


// CHECK USER REFERRALS
bot.onText(/\/referrals (.+)/,(msg,match)=>{

  const chatId = msg.chat.id;
  if(chatId !== ADMIN_ID) return;

  const userId = match[1];

  if(!users[userId]){
    bot.sendMessage(chatId,"User not found");
    return;
  }

  bot.sendMessage(chatId,
`👤 User ${userId}

Referrals: ${users[userId].ref}`);

});


// ADD CODE
bot.onText(/\/addcode (.+)/,(msg,match)=>{

  const chatId = msg.chat.id;
  if(chatId !== ADMIN_ID) return;

  const code = match[1];

  codes.push(code);

  bot.sendMessage(chatId,"✅ Code added.");

});


// REMOVE CODE
bot.onText(/\/removecode (.+)/,(msg,match)=>{

  const chatId = msg.chat.id;
  if(chatId !== ADMIN_ID) return;

  const code = match[1];

  const index = codes.indexOf(code);

  if(index === -1){
    bot.sendMessage(chatId,"Code not found");
    return;
  }

  codes.splice(index,1);

  bot.sendMessage(chatId,"❌ Code removed");

});


// LIST CODES
bot.onText(/\/listcodes/, (msg)=>{

  const chatId = msg.chat.id;
  if(chatId !== ADMIN_ID) return;

  bot.sendMessage(chatId,
`🎁 Codes:

${codes.join("\n")}`);

});


