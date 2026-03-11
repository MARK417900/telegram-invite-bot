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
const token = "YOUR_BOT_TOKEN";
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
      orderStatus: null
    };
    saveUsers();
  }
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

/* START */
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {

const chatId = msg.chat.id;
const referrerId = match[1];

createUser(chatId);

if (referrerId && referrerId != chatId && !users[chatId].referredBy) {
  users[chatId].referredBy = referrerId;
}

saveUsers();

const buttons = [
[
{ text:"📢 Join Channel 1", url:`https://t.me/${channels[0].replace("@","")}` },
{ text:"📢 Join Channel 2", url:`https://t.me/${channels[1].replace("@","")}` }
],
[{ text:"✅ I Joined", callback_data:"check_join" }]
];

bot.sendMessage(chatId,"🚨 Please join all channels first.",{
reply_markup:{ inline_keyboard:buttons }
});

});

/* CALLBACK HANDLER */
bot.on("callback_query", async (query) => {

const chatId = query.message.chat.id;
const data = query.data;
const adminId = query.from.id;

bot.answerCallbackQuery(query.id);

/* JOIN CHECK */
if(data === "check_join"){

const joined = await checkMembership(chatId);

if(!joined){
bot.sendMessage(chatId,"❌ Join all channels first.");
return;
}

const user = users[chatId];

if(user.referredBy && user.referredBy != chatId){

if(!users[user.referredBy]) createUser(user.referredBy);

const ref = users[user.referredBy];

if(!ref.invited.includes(chatId)){

ref.invited.push(chatId);
ref.ref++;
ref.refProgress++;

saveUsers();

bot.sendMessage(user.referredBy,
`🎉 New referral joined
User: ${chatId}
Total: ${ref.ref}`);
}
}

bot.sendMessage(chatId,"✅ Access Granted!",{
reply_markup:{
keyboard:[
["👤 Profile","👥 Refer"],
["🎁 Redeem","Help ❓"],
["🛒 Buy Code"]
],
resize_keyboard:true
}
});

}

/* APPROVE PURCHASE */
if(data.startsWith("buyapprove_")){

const userId = data.split("_")[1];

if(!ADMIN_IDS.includes(adminId) || !users[userId]) return;

users[userId].purchases++;
users[userId].orderStatus = "Approved";
users[userId].buyRequest = false;
users[userId].waitingAdminMsg = true;

saveUsers();

bot.sendMessage(userId,"✅ Purchase approved! Admin will send reward.");
bot.sendMessage(adminId,"Send reward to user.");

bot.deleteMessage(query.message.chat.id,query.message.message_id).catch(()=>{});

}

/* REJECT PURCHASE */
if(data.startsWith("buyreject_")){

const userId = data.split("_")[1];

if(!ADMIN_IDS.includes(adminId) || !users[userId]) return;

users[userId].orderStatus = "Cancelled";
users[userId].buyRequest = false;

saveUsers();

bot.sendMessage(userId,"❌ Purchase rejected.");

bot.deleteMessage(query.message.chat.id,query.message.message_id).catch(()=>{});

}

/* ADMIN MESSAGE USER */
if(data.startsWith("msg_")){

const userId = data.split("_")[1];

users[userId].waitingAdminMsg = true;

saveUsers();

bot.sendMessage(adminId,"Send message to the user.");

}

});

/* MESSAGE HANDLER */
bot.on("message", async (msg)=>{

const chatId = msg.chat.id;
const text = msg.text || "";

createUser(chatId);

const user = users[chatId];

if(text.startsWith("/")) return;

/* PROFILE */
if(text === "👤 Profile"){

bot.sendMessage(chatId,
`🆔 ${chatId}

👥 Referrals: ${user.ref}
🛒 Purchases: ${user.purchases}
🎁 Redeems: ${user.redeems}
📊 Progress: ${user.refProgress}/5`);

}

/* REFER */
if(text === "👥 Refer"){

const link = `https://t.me/${botUsername}?start=${chatId}`;

bot.sendMessage(chatId,`Invite friends\n${link}`);

}

/* HELP */
if(text === "Help ❓"){
bot.sendMessage(chatId,"Contact support: @Mark41_helperBot");
}

/* BUY CODE */
if(text === "🛒 Buy Code"){

bot.sendMessage(chatId,"Select code:",{
reply_markup:{
inline_keyboard:[
[{text:"🔥 Hotya",callback_data:"Hotya_CODE"}],
[{text:"⚡ GOSH",callback_data:"GOSH_CODE"}]
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
msgTarget:null
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

/* ADMIN MESSAGE HANDLER */
bot.on("message",(msg)=>{

const chatId = msg.chat.id;
const text = msg.text || "";

if(!ADMIN_IDS.includes(chatId)) return;

/* STATUS */
if(text === "📊 Status"){

let totalUsers = Object.keys(users).length;

let totalPurchases = Object.values(users)
.reduce((sum,u)=>sum+u.purchases,0);

let totalRedeems = Object.values(users)
.reduce((sum,u)=>sum+u.redeems,0);

bot.sendMessage(chatId,
`📊 BOT STATUS

👤 Users: ${totalUsers}
🛒 Purchases: ${totalPurchases}
🎁 Redeems: ${totalRedeems}`);

}

/* BROADCAST */
if(text === "📢 Broadcast"){

adminStates.broadcast = true;

bot.sendMessage(chatId,"Send message to broadcast");

return;

}

if(adminStates.broadcast){

Object.keys(users).forEach(id=>{
bot.sendMessage(id,text).catch(()=>{});
});

bot.sendMessage(chatId,"✅ Broadcast sent");

adminStates.broadcast = false;

}

});
