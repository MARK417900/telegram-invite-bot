const express = require("express");
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;  

/* SERVER */
app.get("/", (req, res) => {
  res.send("✅ Bot Backend Running");
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

/* TELEGRAM BOT */
const token = "8102453698:AAFNCf3eHenMLLk3NHULqTCtSFD_R_Zph5M";
const bot = new TelegramBot(token, { polling: true });
const botUsername = "Refer_SellerBot";

/* ADMIN */
const ADMIN_IDS = [8521844327, 8809115899];

/* CHANNELS */
const channels = [
  "@earnwithmark41",
  "@Marks_community"
];

/* DATABASE */
const DATA_FILE = __dirname + "/users.json";
let users = {};

if (fs.existsSync(DATA_FILE)) {
  users = JSON.parse(fs.readFileSync(DATA_FILE));
} else {
  fs.writeFileSync(DATA_FILE, JSON.stringify({}));
}

function saveUsers() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

/* CHECK MEMBERSHIP */
async function checkMembership(userId) {
  try {
    for (let channel of channels) {
      const member = await bot.getChatMember(channel, userId);
      if (member.status === "left" || member.status === "kicked") return false;
    }
    return true;
  } catch {
    return false;
  }
}

/* CREATE USER */
function createUser(id) {
  if (!users[id]) {
    users[id] = {
      ref: 0,
      refProgress: 0,
      redeems: 0,
      purchases: 0,
      redeemRequest: false,
      buyRequest: false,
      buyRefs: 0,
      buyType: null,
      screenshot: null,
      waitingAdminMsg: false,
      invited: [],
      referredBy: null,
   
      orderStatus: null,
      orderUser: null
    };
    saveUsers();
  }
}

/* START COMMAND */
bot.onText(/\/start(?: (.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const referrerId = match[1];

  createUser(chatId);

  if (referrerId && referrerId != chatId && !users[chatId].referredBy) {
    users[chatId].referredBy = referrerId;
  }

  saveUsers();

  const buttons = channels.map(ch => [{
    text: "📢 Join Channel",
    url: `https://t.me/${ch.replace("@", "")}`
  }]);

  buttons.push([{ text: "✅ I Joined", callback_data: "check_join" }]);

  bot.sendMessage(chatId, "🚨 Please join all channels first.", {
    reply_markup: { inline_keyboard: buttons }
  });
});

/* CALLBACK HANDLER */
bot.on("callback_query", async (query) => {
  bot.answerCallbackQuery(query.id);
  const chatId = query.message.chat.id;
  const data = query.data;
  const adminId = query.from.id;

  // ------------------------------
  // Admin messaging user
  // ------------------------------
  if (data.startsWith("msg_")) {
    const userId = data.split("_")[1];
    users[userId].waitingAdminMsg = true;
    saveUsers();
    bot.sendMessage(adminId, "Send message to the user.");
  }

  // ------------------------------
  // Buy screenshot upload
  // ------------------------------
  if (data === "upload_ss") {
    if (users[chatId].buyRequest) {
      bot.sendMessage(chatId, "✅ Please upload your payment screenshot now.");
    } else {
      bot.sendMessage(chatId, "❌ You have no pending purchase request.");
    }
  }

  // ------------------------------
  // Cancel purchase
  // ------------------------------
  if (data === "cancel_buy") {
    users[chatId].buyRequest = false;
    users[chatId].buyRefs = 0;
    users[chatId].buyType = null;
    users[chatId].screenshot = null;
    saveUsers();
    bot.sendMessage(chatId, "❌ Purchase cancelled.");
  }

  // ------------------------------
  // Admin approve/reject purchase
  // ------------------------------
  if (data.startsWith("buyapprove_")) {
    const userId = data.split("_")[1];
    if (!ADMIN_IDS.includes(adminId) || !users[userId]) return;

    users[userId].purchases += 1;
    users[userId].orderStatus = "Approved";
    users[userId].buyRequest = false;
    users[userId].waitingAdminMsg = true;
    saveUsers();

    bot.sendMessage(userId, "✅ Your purchase has been approved! Admin will send your reward soon..🥳");
    bot.sendMessage(adminId, `Purchase approved ✅\nSend reward to User ID: ${userId}`);
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id
    });
  }

  if (data.startsWith("buyreject_")) {
    const userId = data.split("_")[1];
    users[userId].orderStatus = "Cancelled";
    users[userId].buyRequest = false;
    saveUsers();
    bot.sendMessage(userId, "❌ Your order was cancelled by admin.");
  }

  // ------------------------------
  // Check channel join
  // ------------------------------
  if (data === "check_join") {
    const joined = await checkMembership(chatId);
    if (!joined) {
      bot.sendMessage(chatId, "❌ You must join all channels.");
      return;
    }

    createUser(chatId);
    const user = users[chatId];

    if (user.referredBy && user.referredBy != chatId) {
      if (!users[user.referredBy]) createUser(user.referredBy);
      const referrer = users[user.referredBy];
      if (!referrer.invited.includes(chatId)) {
        referrer.invited.push(chatId);
        referrer.ref += 1;
        referrer.refProgress += 1;
        saveUsers();
        bot.sendMessage(user.referredBy, `🎉 New referral joined!\nUser ID: ${chatId}\nTotal referrals: ${referrer.ref}\nProgress: ${referrer.refProgress}/5`);
      }
    }

    bot.sendMessage(chatId, "✅ Access Granted!", {
      reply_markup: {
        keyboard: [
          ["👤 Profile", "👥 Refer"],
          ["🎁 Redeem", "Help ❓"],
          ["🛒 Buy Code"]
        ],
        resize_keyboard: true
      }
    });
  }

  // ------------------------------
  // Buy code flow
  // ------------------------------
  if (data === "Hotya_CODE" || data === "GOSH_CODE") {
    createUser(chatId);
    users[chatId].buyType = data;
    saveUsers();
    bot.sendMessage(chatId, "How many referrals you want?", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "1", callback_data: "ref_1" }],
          [{ text: "2", callback_data: "ref_2" }],
          [{ text: "5", callback_data: "ref_5" }]
        ]
      }
    });
  }

  if (data.startsWith("ref_")) {
    createUser(chatId);
    const refs = parseInt(data.split("_")[1]);

    users[chatId].buyRefs = refs;
    users[chatId].buyRequest = true;
    users[chatId].orderStatus = "Waiting Payment";
    users[chatId].orderUser = chatId;
    saveUsers();

    bot.sendPhoto(chatId, "paymentQR.jpg", {
      caption: `Pay ₹20 for each referral code.\nYou are buying ${refs} referrals.🔥\n\nAfter payment upload screenshot.`,
      reply_markup: {
        inline_keyboard: [
          [{ text: "📤 Upload Screenshot", callback_data: "upload_ss" }],
          [{ text: "❌ Cancel", callback_data: "cancel_buy" }]
        ]
      }
    });
  }

  // ------------------------------
  // Redeem approve/reject
  // ------------------------------
  if (data.startsWith("approve_") || data.startsWith("reject_")) {
    if (!ADMIN_IDS.includes(adminId)) return;
    const userId = data.split("_")[1];
    if (!users[userId]) return;

    if (data.startsWith("approve_")) {
      users[userId].redeems += 1;
      users[userId].refProgress = users[userId].refProgress % 5;
      users[userId].redeemRequest = false;
      users[userId].waitingAdminMsg = true;
      saveUsers();
      bot.sendMessage(userId, "🎉 Your redeem request has been approved!\n Admin will send your reward soon..🥳");
      bot.sendMessage(adminId, `Redeem approved ✅\nSend  reward to User ID: ${userId}.`);
    } else {
      users[userId].redeemRequest = false;
      saveUsers();
      bot.sendMessage(userId, "❌ Your redeem request was rejected.");
    }
  }
});

/* MESSAGE HANDLER */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  createUser(chatId);
  const user = users[chatId];

  // ------------------------------
  // Admin sending reward/message
  // ------------------------------
  if (ADMIN_IDS.includes(chatId)) {
    const pendingUser = Object.keys(users).find(id => users[id].waitingAdminMsg);
    if (pendingUser) {
      if (msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        bot.sendPhoto(pendingUser, fileId, { caption: msg.caption || "🎁 Reward from admin" });
      } else if (msg.video) {
        bot.sendVideo(pendingUser, msg.video.file_id, { caption: msg.caption || "🎁 Reward from admin" });
      } else if (msg.text) {
        bot.sendMessage(pendingUser, msg.text);
      }
      users[pendingUser].waitingAdminMsg = false;
      saveUsers();
      bot.sendMessage(chatId, "✅ Reward/message sent to user.");
      return;
    }
  }

  // Ignore commands
  if (text.startsWith("/")) return;

  // Handle purchase screenshot upload
  if (msg.photo && user.buyRequest) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    user.screenshot = fileId;
    user.orderStatus = "Submitted";
    saveUsers();

    bot.sendMessage(chatId, "✅ Screenshot received. Your purchase request has been submitted.");

    ADMIN_IDS.forEach(admin => {
      bot.sendPhoto(admin, fileId, {
        caption: `🛒 New Purchase Request\n\n ID: ${chatId}\n Buy Type: ${user.buyType || "None"}\nReferrals Buying: ${user.buyRefs}`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Approve", callback_data: `buyapprove_${chatId}` },
              { text: "❌ Reject", callback_data: `buyreject_${chatId}` }
            ],
            [{ text: "✉ Message User", callback_data: `msg_${chatId}` }]
          ]
        }
      });
    });
    return;
  }

  // Handle Redeem request
  if (text === "🎁 Redeem") {
    const joined = await checkMembership(chatId);
    if (!joined) {
      bot.sendMessage(chatId, "❌ Join channels first.");
      return;
    }
        user.refProgress = 5 // temperory test
    if (user.refProgress < 5) {
      bot.sendMessage(chatId, `❌ Need 5 referrals. Current Progress: ${user.refProgress}/5`);
      return;
    }

    if (user.redeemRequest) {
      bot.sendMessage(chatId, "⏳ Your redeem request is already pending.");
      return;
    }

    user.redeemRequest = true;
    saveUsers();

    bot.sendMessage(chatId, "Your redeem request has been submitted. ✅\n\nAdmin will review it soon. 🎉");

    ADMIN_IDS.forEach(admin => {
      bot.sendMessage(admin,
        `📩 New Redeem Request\n\n🆔 User ID: ${chatId}\n🎁 Codes Redeemed: ${user.redeems}\n\n👥 Total Referrals: ${user.ref}\n📌 Referral Progress: ${user.refProgress}/5\n📩 Invited Users: ${user.invited.length > 0 ? user.invited.join(", ") : "None"}\n`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Approve", callback_data: `approve_${chatId}` },
                { text: "❌ Reject", callback_data: `reject_${chatId}` }
              ]
            ]
          }
        });
    });
    return;
  }

  // PROFILE
  if (text === "👤 Profile") {
    bot.sendMessage(chatId,
      `🆔 User ID: ${chatId}\n\n👥 Total Referrals: ${user.ref}\n🛒 Total Purchases: ${user.purchases}\n\n🎁 Codes Redeemed: ${user.redeems}\n📌 Required Referrals: ${user.refProgress}/5`);
  }

  // REFER
  if (text === "👥 Refer") {
    const refLink = `https://t.me/${botUsername}?start=${chatId}`;
    bot.sendMessage(chatId, `👥 Your referral link\n\n${refLink}\n\nInvite 5 friends to redeem.`);
  }

  // HELP
  if (text === "Help ❓") {
    bot.sendMessage(chatId, `Need help ? ? ?\n\nContact support bot:\n👉 @Mark41_helperBot`);
  }

  // BUY CODE
  if (text === "🛒 Buy Code") {
    bot.sendMessage(chatId, "Select code type:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔥 Hotya", callback_data: "Hotya_CODE" }],
          [{ text: "⚡ GOSH", callback_data: "GOSH_CODE" }]
        ]
      }
    });
  }
});

/* ================= ADMIN SYSTEM ================= */


let adminStates = {
broadcast:false,
userInfo:false,
msgUser:false,
msgTarget:null,
botOffSetup:false
};

/* ADMIN PANEL */

bot.onText(/\/admin/, (msg)=>{

const chatId = msg.chat.id;

if(!ADMIN_IDS.includes(chatId)) return;

bot.sendMessage(chatId,
"👑 ADMIN PANEL",{
reply_markup:{
keyboard:[
["📊 Status","📢 Broadcast"],
["👤 User Info","✉ Msg User"]
],
resize_keyboard:true
}
});

});

/* MESSAGE HANDLER FOR ADMIN PANEL */

bot.on("message",(msg)=>{

const chatId = msg.chat.id;
const text = msg.text || "";

if(!users[chatId]) return;

/* ================= STATUS ================= */

if(text === "📊 Status"){

if(!ADMIN_IDS.includes(chatId)) return;

let totalUsers = Object.keys(users).length;

let totalPurchases = Object.values(users)
.reduce((sum,u)=>sum+u.purchases,0);

let totalRedeems = Object.values(users)
.reduce((sum,u)=>sum+u.redeems,0);

bot.sendMessage(chatId,
`📊 BOT STATUS

👤 Total Users: ${totalUsers}

🛒 Total Purchases: ${totalPurchases}

🎁 Total Redeems: ${totalRedeems}`);

}

/* ================= BROADCAST ================= */

if(text === "📢 Broadcast"){

if(!ADMIN_IDS.includes(chatId)) return;

adminStates.broadcast = true;

bot.sendMessage(chatId,
"📢 Send message to broadcast to all users.\n\nPress ❌ Cancel to stop.",{
reply_markup:{
keyboard:[
["❌ Cancel"]
],
resize_keyboard:true
}
});

return;

}

/* CANCEL BROADCAST */

if(text === "❌ Cancel" && adminStates.broadcast){

adminStates.broadcast = false;

bot.sendMessage(chatId,
"❌ Broadcast cancelled.",{
reply_markup:{
keyboard:[
["📊 Status","📢 Broadcast"],
["👤 User Info","✉ Msg User"]
],
resize_keyboard:true
}
});

return;

}

/* SEND BROADCAST */

if(adminStates.broadcast && ADMIN_IDS.includes(chatId)){

Object.keys(users).forEach(id=>{
bot.sendMessage(id,text).catch(()=>{});
});

bot.sendMessage(chatId,
"✅ Broadcast sent.",{
reply_markup:{
keyboard:[
["📊 Status","📢 Broadcast"],
["👤 User Info","✉ Msg User"]
],
resize_keyboard:true
}
});

adminStates.broadcast=false;

return;

}

/* ================= USER INFO ================= */

if(text === "👤 User Info"){

if(!ADMIN_IDS.includes(chatId)) return;

adminStates.userInfo = true;

bot.sendMessage(chatId,"Send User ID to check full profile.");

return;

}

if(adminStates.userInfo && ADMIN_IDS.includes(chatId)){

const id = text;

if(!users[id]){

bot.sendMessage(chatId,"❌ User not found.");

}else{

const u = users[id];

bot.sendMessage(chatId,
`🆔 User ID: ${id}

👥 Total Referrals: ${u.ref}
👤 Referred By: ${u.referredBy || "None"}
📊 Referral Progress: ${u.refProgress}/5

🛒 Total Purchases: ${u.purchases}
🎁 Codes Redeemed: ${u.redeems}

📦 Purchase Request: ${u.buyRequest ? "Yes":"No"}
🎁 Redeem Request: ${u.redeemRequest ? "Yes":"No"}

👨‍👩‍👧 Invited Users:
${u.invited.length ? u.invited.join(", ") : "None"}`);

}

adminStates.userInfo=false;

return;

}
/* ================= MESSAGE USER ================= */

if(text === "✉ Msg User"){

if(!ADMIN_IDS.includes(chatId)) return;

adminStates.msgUser = true;

bot.sendMessage(chatId,"Send User ID to message.");

return;

}

if(adminStates.msgUser && ADMIN_IDS.includes(chatId)){

if(!users[text]){

bot.sendMessage(chatId,"❌ User not found.");

return;

}

adminStates.msgTarget = text;
adminStates.msgUser = false;

bot.sendMessage(chatId,"Send message to deliver to user.");

return;

}

if(adminStates.msgTarget && ADMIN_IDS.includes(chatId)){

bot.sendMessage(adminStates.msgTarget,text);

bot.sendMessage(chatId,"✅ Message sent to user.");

adminStates.msgTarget = null;

return;

}



});
