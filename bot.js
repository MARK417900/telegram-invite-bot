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
const token = "YOUR_NEW_BOT_TOKEN";
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
      orderStatus: null
    };
    saveUsers();
  }
}

/* START */
bot.onText(/\/start(?: (.+))?/, (msg, match) => {

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

bot.answerCallbackQuery(query.id);

const chatId = query.message.chat.id;
const data = query.data;
const adminId = query.from.id;

/* ADMIN MESSAGE USER */
if (data.startsWith("msg_")) {

const userId = data.split("_")[1];
users[userId].waitingAdminMsg = true;
saveUsers();

bot.sendMessage(adminId,"Send message to the user.");

}

/* UPLOAD SCREENSHOT */
if (data === "upload_ss") {

if(users[chatId].buyRequest){
bot.sendMessage(chatId,"📤 Upload payment screenshot.");
}else{
bot.sendMessage(chatId,"❌ No pending purchase.");
}

}

/* CANCEL PURCHASE */
if(data==="cancel_buy"){

users[chatId].buyRequest=false;
users[chatId].buyRefs=0;
users[chatId].buyType=null;
users[chatId].screenshot=null;

saveUsers();

bot.sendMessage(chatId,"❌ Purchase cancelled.");

}

/* APPROVE PURCHASE */
if(data.startsWith("buyapprove_")){

const userId=data.split("_")[1];
if(!ADMIN_IDS.includes(adminId)||!users[userId]) return;

users[userId].purchases+=1;
users[userId].orderStatus="Approved";
users[userId].buyRequest=false;
users[userId].waitingAdminMsg=true;

saveUsers();

bot.sendMessage(userId,"✅ Purchase approved! Admin will send reward soon.");
bot.sendMessage(adminId,`Purchase approved\nSend reward to user ${userId}`);

bot.deleteMessage(query.message.chat.id,query.message.message_id).catch(()=>{});

}

/* REJECT PURCHASE */
if(data.startsWith("buyreject_")){

const userId=data.split("_")[1];

users[userId].orderStatus="Cancelled";
users[userId].buyRequest=false;

saveUsers();

bot.sendMessage(userId,"❌ Order cancelled.");

bot.deleteMessage(query.message.chat.id,query.message.message_id).catch(()=>{});

}

/* JOIN CHECK */
if(data==="check_join"){

const joined=await checkMembership(chatId);

if(!joined){
bot.sendMessage(chatId,"❌ Join all channels first.");
return;
}

const user=users[chatId];

if(user.referredBy && user.referredBy!=chatId){

if(!users[user.referredBy]) createUser(user.referredBy);

const ref=users[user.referredBy];

if(!ref.invited.includes(chatId)){

ref.invited.push(chatId);
ref.ref+=1;
ref.refProgress+=1;

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

/* REDEEM APPROVE/REJECT */
if(data.startsWith("approve_") || data.startsWith("reject_")){

if(!ADMIN_IDS.includes(adminId)) return;

const userId=data.split("_")[1];

if(data.startsWith("approve_")){

users[userId].redeems+=1;
users[userId].refProgress = users[userId].refProgress % 5;
users[userId].redeemRequest=false;
users[userId].waitingAdminMsg=true;

saveUsers();

bot.sendMessage(userId,"🎉 Redeem approved. Admin will send reward.");
bot.sendMessage(adminId,`Send reward to user ${userId}`);

}else{

users[userId].redeemRequest=false;
saveUsers();

bot.sendMessage(userId,"❌ Redeem rejected.");

}

bot.deleteMessage(query.message.chat.id,query.message.message_id).catch(()=>{});

}

});

/* MESSAGE HANDLER */
bot.on("message", async (msg)=>{

const chatId=msg.chat.id;
const text=msg.text || "";

createUser(chatId);
const user=users[chatId];

/* ADMIN SEND REWARD */

if(ADMIN_IDS.includes(chatId)){

const pendingUser=Object.keys(users).find(id=>users[id].waitingAdminMsg);

if(pendingUser){

if(msg.photo){

const fileId=msg.photo[msg.photo.length-1].file_id;
bot.sendPhoto(pendingUser,fileId,{caption:msg.caption || "🎁 Reward"});

}else if(msg.text){

bot.sendMessage(pendingUser,msg.text);

}

users[pendingUser].waitingAdminMsg=false;
saveUsers();

bot.sendMessage(chatId,"✅ Reward sent.");

return;

}

}

if(text.startsWith("/")) return;

/* SCREENSHOT RECEIVE */

if(msg.photo && user.buyRequest){

const fileId=msg.photo[msg.photo.length-1].file_id;

user.screenshot=fileId;
user.orderStatus="Submitted";

saveUsers();

bot.sendMessage(chatId,"✅ Screenshot received.");

ADMIN_IDS.forEach(admin=>{

bot.sendPhoto(admin,fileId,{
caption:`🛒 Purchase Request
User: ${chatId}
Refs: ${user.buyRefs}`,
reply_markup:{
inline_keyboard:[
[
{ text:"✅ Approve", callback_data:`buyapprove_${chatId}` },
{ text:"❌ Reject", callback_data:`buyreject_${chatId}` }
],
[{ text:"✉ Message", callback_data:`msg_${chatId}` }]
]
}
});

});

}

/* PROFILE */

if(text==="👤 Profile"){

bot.sendMessage(chatId,
`🆔 ${chatId}

👥 Referrals: ${user.ref}
🛒 Purchases: ${user.purchases}
🎁 Redeems: ${user.redeems}
📊 Progress: ${user.refProgress}/5`);

}

/* REFER */

if(text==="👥 Refer"){

const link=`https://t.me/${botUsername}?start=${chatId}`;

bot.sendMessage(chatId,`Invite friends\n${link}`);

}

/* HELP */

if(text==="Help ❓"){
bot.sendMessage(chatId,"Contact support: @Mark41_helperBot");
}

/* BUY CODE */

if(text==="🛒 Buy Code"){

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
"📢 Send message to broadcast to all users.",{
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

bot.sendMessage(chatId,
"Send User ID to check profile.",{
reply_markup:{
keyboard:[
["❌ Cancel"]
],
resize_keyboard:true
}
});

return;

}

/* CANCEL USER INFO */

if(text === "❌ Cancel" && adminStates.userInfo){

adminStates.userInfo = false;

bot.sendMessage(chatId,
"❌ User info check cancelled.",{
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

/* PROCESS USER INFO */

if(adminStates.userInfo && ADMIN_IDS.includes(chatId)){

const id = text;

if(!users[id]){

bot.sendMessage(chatId,"❌ User not found.");

}else{

const u = users[id];

bot.sendMessage(chatId,
`👤 FULL USER PROFILE

🆔 User ID: ${id}

👥 Total Referrals: ${u.ref}
📊 Referral Progress: ${u.refProgress}/5

🛒 Total Purchases: ${u.purchases}
🎁 Codes Redeemed: ${u.redeems}

📦 Purchase Request: ${u.buyRequest ? "Yes":"No"}
🎁 Redeem Request: ${u.redeemRequest ? "Yes":"No"}

💳 Buy Type: ${u.buyType || "None"}
👤 Referred By: ${u.referredBy || "None"}

🧾 Order ID: ${u.orderId || "None"}
📌 Order Status: ${u.orderStatus || "None"}

📸 Screenshot Uploaded: ${u.screenshot ? "Yes":"No"}

Invited Users:
${u.invited.length ? u.invited.join(", ") : "None"}
`);

}

adminStates.userInfo=false;

return;

}
/* ================= MESSAGE USER ================= */

if(text === "✉ Msg User"){

if(!ADMIN_IDS.includes(chatId)) return;

adminStates.msgUser = true;

bot.sendMessage(chatId,
"Send User ID to send message.",{
reply_markup:{
keyboard:[
["❌ Cancel"]
],
resize_keyboard:true
}
});

return;

}

/* CANCEL MSG USER */

if(text === "❌ Cancel" && (adminStates.msgUser || adminStates.msgTarget)){

adminStates.msgUser = false;
adminStates.msgTarget = null;

bot.sendMessage(chatId,
"❌ Message sending cancelled.",{
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

/* GET USER ID */

if(adminStates.msgUser && ADMIN_IDS.includes(chatId)){

if(!users[text]){

bot.sendMessage(chatId,"❌ User not found.");
return;

}

adminStates.msgTarget = text;
adminStates.msgUser = false;

bot.sendMessage(chatId,
"Send message to deliver to user.");

return;

}

/* SEND MESSAGE */

if(adminStates.msgTarget && ADMIN_IDS.includes(chatId)){

bot.sendMessage(adminStates.msgTarget,text);

bot.sendMessage(chatId,"✅ Message sent to user.");

adminStates.msgTarget = null;

return;

}
  });
