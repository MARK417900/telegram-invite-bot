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
const token = "8102453698:AAGZMJbProlxixjP-9Tk-kX2sNAsXQnXncc";
const bot = new TelegramBot(token, { polling: true });
const botUsername = "Refer_SellerBot";

/* ADMIN */
const ADMIN_IDS = [8521844327,8809115899];

/* CHANNELS */
const channels = ["@earnwithmark41","@Marks_community"];

/* DATABASE */
const DATA_FILE = __dirname + "/users.json";
let users = {};

if (fs.existsSync(DATA_FILE)) {
users = JSON.parse(fs.readFileSync(DATA_FILE));
} else {
fs.writeFileSync(DATA_FILE, JSON.stringify({}));
}

function saveUsers(){
fs.writeFileSync(DATA_FILE, JSON.stringify(users,null,2));
}

/* CREATE USER */
function createUser(id){
if(!users[id]){
users[id]={
ref:0,
refProgress:0,
redeems:0,
purchases:0,
redeemRequest:false,
buyRequest:false,
buyRefs:0,
buyType:null,
screenshot:null,
waitingAdminMsg:false,
invited:[],
referredBy:null,
orderStatus:null
};
saveUsers();
}
}

/* CHECK CHANNEL */
async function checkMembership(userId){
try{
for(let channel of channels){
const member = await bot.getChatMember(channel,userId);
if(member.status==="left"||member.status==="kicked") return false;
}
return true;
}catch{
return false;
}
}

/* START */
bot.onText(/\/start(?: (.+))?/, async(msg,match)=>{

const chatId = msg.chat.id;
const referrerId = match[1];

createUser(chatId);

if(referrerId && referrerId!=chatId && !users[chatId].referredBy){
users[chatId].referredBy = referrerId;
}

saveUsers();

const buttons = [
[
{ text:"📢 Join Channel 1", url:`https://t.me/${channels[0].replace("@","")}` },
{ text:"📢 Join Channel 2", url:`https://t.me/${channels[1].replace("@","")}` }
],
[{ text:"✅ I Joined", callback_data:"check_join"}]
];

bot.sendMessage(chatId,"🚨 Please join all channels first.",{
reply_markup:{inline_keyboard:buttons}
});

});

/* CALLBACK HANDLER */
bot.on("callback_query", async(query)=>{

const chatId = query.message.chat.id;
const data = query.data;
const adminId = query.from.id;

bot.answerCallbackQuery(query.id);

/* JOIN CHECK */
if(data==="check_join"){

const joined = await checkMembership(chatId);

if(!joined){
bot.sendMessage(chatId,"❌ Join all channels first.");
return;
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

/* BUY HOTYA */
if(data==="Hotya_CODE"){
users[chatId].buyRequest=true;
users[chatId].buyType="Hotya";
saveUsers();

bot.sendMessage(chatId,
"🔥 Hotya Code\nSend payment screenshot after payment.");
}

/* BUY GOSH */
if(data==="GOSH_CODE"){
users[chatId].buyRequest=true;
users[chatId].buyType="GOSH";
saveUsers();

bot.sendMessage(chatId,
"⚡ GOSH Code\nSend payment screenshot after payment.");
}

/* APPROVE PURCHASE */
if(data.startsWith("buyapprove_")){

const userId=data.split("_")[1];

if(!ADMIN_IDS.includes(adminId)) return;

users[userId].purchases++;
users[userId].orderStatus="Approved";
users[userId].buyRequest=false;
users[userId].waitingAdminMsg=true;

saveUsers();

bot.sendMessage(userId,"✅ Purchase approved.\nAdmin sending reward.");
bot.sendMessage(adminId,"Send reward now.");

bot.deleteMessage(query.message.chat.id,query.message.message_id).catch(()=>{});

}

/* REJECT PURCHASE */
if(data.startsWith("buyreject_")){

const userId=data.split("_")[1];

if(!ADMIN_IDS.includes(adminId)) return;

users[userId].buyRequest=false;
users[userId].orderStatus="Rejected";

saveUsers();

bot.sendMessage(userId,"❌ Purchase rejected.");

bot.deleteMessage(query.message.chat.id,query.message.message_id).catch(()=>{});
}

});

/* MESSAGE HANDLER */
bot.on("message", async(msg)=>{

const chatId = msg.chat.id;
const text = msg.text || "";

createUser(chatId);
const user = users[chatId];

/* ADMIN SEND REWARD */
if(ADMIN_IDS.includes(chatId)){

const pendingUser = Object.keys(users).find(id=>users[id].waitingAdminMsg);

if(pendingUser){

if(msg.photo){
const fileId = msg.photo[msg.photo.length-1].file_id;
bot.sendPhoto(pendingUser,fileId,{caption:"🎁 Your reward"});
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

/* RECEIVE SCREENSHOT */
if(msg.photo && user.buyRequest){

const fileId = msg.photo[msg.photo.length-1].file_id;

user.screenshot=fileId;
user.orderStatus="Submitted";

saveUsers();

bot.sendMessage(chatId,"✅ Screenshot received.");

ADMIN_IDS.forEach(admin=>{
bot.sendPhoto(admin,fileId,{
caption:`🛒 Purchase Request
User: ${chatId}
Type: ${user.buyType}`,
reply_markup:{
inline_keyboard:[
[
{ text:"✅ Approve", callback_data:`buyapprove_${chatId}`},
{ text:"❌ Reject", callback_data:`buyreject_${chatId}`}
]
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

/* REDEEM */
if(text==="🎁 Redeem"){
user.refProgress=5;//temperory for test
if(user.refProgress<5){
bot.sendMessage(chatId,"❌ Need 5 referrals.");
return;
}

user.redeemRequest=true;
saveUsers();

ADMIN_IDS.forEach(admin=>{
bot.sendMessage(admin,
`🎁 Redeem Request
User: ${chatId}`,
{
reply_markup:{
inline_keyboard:[
[
{ text:"✅ Approve", callback_data:`approve_${chatId}`},
{ text:"❌ Reject", callback_data:`reject_${chatId}`}
]
]
}
});
});

bot.sendMessage(chatId,"✅ Redeem request sent.");

}

/* HELP */
if(text==="Help ❓"){
bot.sendMessage(chatId,"Contact support: @Mark41_helperBot");
}

/* BUY MENU */
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

/* ================= ADMIN PANEL SYSTEM ================= */

let adminState = {
mode: null,
targetUser: null
};

/* ADMIN MENU FUNCTION */

function showAdminMenu(chatId){

bot.sendMessage(chatId,"👑 ADMIN PANEL",{
reply_markup:{
keyboard:[
["📊 Status","📢 Broadcast"],
["👤 User Info","✉ Msg User"]
],
resize_keyboard:true
}
});

}

/* OPEN ADMIN PANEL */

bot.onText(/\/admin/, (msg)=>{

const chatId = msg.chat.id;

if(!ADMIN_IDS.includes(chatId)) return;

showAdminMenu(chatId);

});

/* ADMIN MESSAGE HANDLER */

bot.on("message",(msg)=>{

const chatId = msg.chat.id;
const text = msg.text || "";

if(!ADMIN_IDS.includes(chatId)) return;

/* CANCEL BUTTON */

if(text === "❌ Cancel"){

adminState.mode = null;
adminState.targetUser = null;

bot.sendMessage(chatId,"❌ Action cancelled.");

showAdminMenu(chatId);

return;

}

/* STATUS */

if(text === "📊 Status"){

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

/* BROADCAST */

if(text === "📢 Broadcast"){

adminState.mode = "broadcast";

bot.sendMessage(chatId,
"📢 Send message to broadcast to all users.",{
reply_markup:{
keyboard:[["❌ Cancel"]],
resize_keyboard:true
}
});

return;

}

/* PROCESS BROADCAST */

if(adminState.mode === "broadcast"){

Object.keys(users).forEach(id=>{
bot.sendMessage(id,text).catch(()=>{});
});

bot.sendMessage(chatId,"✅ Broadcast sent.");

adminState.mode = null;

showAdminMenu(chatId);

return;

}

/* USER INFO */

if(text === "👤 User Info"){

adminState.mode = "userinfo";

bot.sendMessage(chatId,
"Send User ID to check profile.",{
reply_markup:{
keyboard:[["❌ Cancel"]],
resize_keyboard:true
}
});

return;

}

/* PROCESS USER INFO */

if(adminState.mode === "userinfo"){

const id = text;

if(!users[id]){
bot.sendMessage(chatId,"❌ User not found.");
return;
}

const u = users[id];

bot.sendMessage(chatId,
`👤 USER PROFILE

🆔 User ID: ${id}

👥 Total Referrals: ${u.ref}
📊 Progress: ${u.refProgress}/5

🛒 Purchases: ${u.purchases}
🎁 Redeems: ${u.redeems}

📦 Buy Request: ${u.buyRequest ? "Yes":"No"}
🎁 Redeem Request: ${u.redeemRequest ? "Yes":"No"}

📸 Screenshot Uploaded: ${u.screenshot ? "Yes":"No"}

👤 Referred By: ${u.referredBy || "None"}

Invited Users:
${u.invited.length ? u.invited.join(", ") : "None"}
`);

adminState.mode = null;

showAdminMenu(chatId);

return;

}

/* MSG USER STEP 1 */

if(text === "✉ Msg User"){

adminState.mode = "msg_userid";

bot.sendMessage(chatId,
"Send User ID to message.",{
reply_markup:{
keyboard:[["❌ Cancel"]],
resize_keyboard:true
}
});

return;

}

/* GET USER ID */

if(adminState.mode === "msg_userid"){

if(!users[text]){
bot.sendMessage(chatId,"❌ User not found.");
return;
}

adminState.targetUser = text;
adminState.mode = "msg_send";

bot.sendMessage(chatId,
"Send message for this user.",{
reply_markup:{
keyboard:[["❌ Cancel"]],
resize_keyboard:true
}
});

return;

}

/* SEND MESSAGE */

if(adminState.mode === "msg_send"){

bot.sendMessage(adminState.targetUser,text);

bot.sendMessage(chatId,"✅ Message sent to user.");

adminState.mode = null;
adminState.targetUser = null;

showAdminMenu(chatId);

return;

}

});
