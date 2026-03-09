const TelegramBot = require("node-telegram-bot-api");

const token = "8015347446:AAG49JNaGrSNKK4lFkMWXkfRQd-pyLvSMMQ";

const bot = new TelegramBot(token, { polling: true });

// REQUIRED CHANNELS
const channels = [
  "@earnwithmark41"
];

// CODES
const codes = [
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
      balance: 0,
      ref: 0,
      invited: [],
      claimedCode: false
    };

  }

  // REFERRAL SYSTEM
  if (referrerId && referrerId != chatId) {

    if (!users[referrerId]) {

      users[referrerId] = {
        balance: 0,
        ref: 0,
        invited: [],
        claimedCode: false
      };

    }

    if (!users[referrerId].invited.includes(chatId)) {

      users[referrerId].invited.push(chatId);
      users[referrerId].ref += 1;

      bot.sendMessage(referrerId,
`🎉 New referral joined!

Total referrals: ${users[referrerId].ref}`);

    }

  }

  let joinText = "🚨 Please join our channel first:\n\n";

  channels.forEach((ch) => {
    joinText += `👉 ${ch}\n`;
  });

  bot.sendMessage(chatId, joinText, {

    reply_markup: {
      inline_keyboard: [
        [{ text: "Join Channel", url: "https://t.me/earnwithmark41" }],
        [{ text: "✅ I Joined", callback_data: "check_join" }]
      ]
    }

  });

});


// JOIN BUTTON HANDLER
bot.on("callback_query", async (query) => {

  const chatId = query.message.chat.id;

  if (query.data === "check_join") {

    const joined = await checkMembership(chatId);

    if (!joined) {

      bot.sendMessage(chatId,
"❌ You must join the channel first.");

      return;

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
  const text = msg.text;

  if (!users[chatId]) {

    users[chatId] = {
      balance: 0,
      ref: 0,
      invited: [],
      claimedCode: false
    };

  }

  // REFER BUTTON
  if (text === "👥 Refer") {

    const refLink = `https://t.me/HotyaReferBot?start=${chatId}`;

    bot.sendMessage(chatId,
`👥 Your referral link:

${refLink}

Invite 5 friends to unlock your reward code!`);

  }

  // BALANCE BUTTON
  if (text === "💰 Balance") {

    bot.sendMessage(chatId,
`📊 Your Stats

Referrals: ${users[chatId].ref}/5
Code Claimed: ${users[chatId].claimedCode ? "Yes" : "No"}`);

  }

  // GET CODE BUTTON
  if (text === "🎁 Get Code") {

    const joined = await checkMembership(chatId);

    if (!joined) {

      bot.sendMessage(chatId,
"❌ Please join the channel first.");

      return;

    }

    const user = users[chatId];

    if (user.ref < 5) {

      bot.sendMessage(chatId,
`❌ You need 5 referrals.

Current referrals: ${user.ref}/5`);

      return;

    }

    if (user.claimedCode) {

      bot.sendMessage(chatId,
"⚠️ You already claimed your reward code.");

      return;

    }

    if (codes.length === 0) {

      bot.sendMessage(chatId,
"❌ All reward codes have been claimed.");

      return;

    }

    const code = codes.shift();

    user.claimedCode = true;

    bot.sendMessage(chatId,
`🎉 Congratulations!

Your reward code:

${code}`);

  }

});
