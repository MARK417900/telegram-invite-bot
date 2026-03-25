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
const ADMIN_IDS = [8521844327];

/* CHANNELS */
const channels = ["@earnwithmark41","@Marks_community"];
/* STOCK STATUS */
let stock = {
    Hotya: "available",
    GOSH: "available"
};
/* ================= ADMIN PANEL COMMAND ================= */
bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
  
    if(!ADMIN_IDS.includes(chatId)){
        bot.sendMessage(chatId, "❌ You are not an admin.");
        return;
    }

    const adminKeyboard = [
    ["📊 Status","📢 Broadcast"],
    ["👤 User Info","✉ Msg User"],
    ["📦 Stock Manager"]
];

    bot.sendMessage(chatId, "🛠 Admin Panel", {
        reply_markup: {
            keyboard: adminKeyboard,
            resize_keyboard: true
        }
    });
});
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
            buyQty:0,
            buyPrice:0,
            transactionCount: 0,
            buyTime: null,
            bonusUnlocked: 0,
            redeemLimit: 1,
            lastActive: Date.now(),
            lastRedeemPurchaseCount: 0,
            redeemType: null,
            redeemStep: null,
            totalQty: 0,
            totalRedeems: 0,
            availableRedeems: 1,
            bonusGiven: 0,
            redeemHistory: [],
            selfPurchases: 0,
            selfRedeems: 0,
            redeemRequest:false,
            buyRequest:false,
            buyRefs:0,
            buyType:null,
            screenshot:null,
            waitingAdminMsg:false,
            invited:[],
            referredBy:null,
            orderStatus:null,
            warnings: 0,
            downlinePurchases: 0,
            downlineList: {}
        };
        saveUsers();
    }
}
// Progress Bar
function getProgressBar(current, total = 10){
    let filled = Math.min(current, total);
    let empty = Math.max(0, total - filled);

    return "🟩".repeat(filled) + "⬜".repeat(empty);
}
function getCombinedProgress(user){
    const downline = user.downlinePurchases || 0;
    const self = user.selfPurchases || 0;

    const progress = (downline * 1) + (self * 2);

    return progress;
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
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {

const chatId = msg.chat.id;
const referrerId = match[1];

createUser(chatId);

/* ===== REFERRAL SYSTEM ===== */
if(referrerId && referrerId != chatId && !users[chatId].referredBy){
    users[chatId].tempRef = referrerId;
}
saveUsers();

    const buttons = [
        [
            { text:"📢 Channel", url:`https://t.me/${channels[0].replace("@","")}` },
            { text:"📢 Community", url:`https://t.me/${channels[1].replace("@","")}` }
        ],
        [{ text:" Joined ✅", callback_data:"check_join"}]
    ];

     bot.sendMessage(chatId,
`👋 Join all channels first to use this bot ✅"`,
{
    reply_markup: {
        inline_keyboard: buttons
    }

});
});

/* CALLBACK HANDLER */
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const adminId = query.from.id;

    /* ================= JOIN CHECK ================= */
    if (data === "check_join") {
        const joined = await checkMembership(chatId);

        if (!joined) {
            bot.answerCallbackQuery(query.id, {
                text: "❌ Please join all sources first.",
                show_alert: true
            });
            return;
        }

        const user = users[chatId];

        if (user.tempRef && !user.referredBy) {
            const referrerId = user.tempRef;

            if (users[referrerId]) {
                user.referredBy = referrerId;

                users[referrerId].ref += 1;
                users[referrerId].refProgress += 1;
                users[referrerId].invited.push(chatId);

                bot.sendMessage(referrerId,
`🎉 New User Joined using your referral Link ! `);
            }

            user.tempRef = null;
            saveUsers();
        }

        bot.sendMessage(chatId, `✅ Access Granted!`, {
            reply_markup: {
                keyboard: [
                    ["👤 Profile","👥 Refer"],
                    ["🎁 Redeem","Help ❓"],
                    ["🛒 Buy Code"]
                ],
                resize_keyboard: true
            }
        });

        bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: query.message.message_id }
        );

        return;
    }

    /* ================= HELP ================= */
    if (data === "help_claim") {
        bot.sendPhoto(chatId, __dirname + "/claim.jpg", {
            caption: "🎁 How to claim reward...",
            parse_mode: "HTML"
        });
        return;
    }
    // Downline Data 
    if(data === "view_downline"){
    const user = users[chatId];

    let downlineText = "❌ No downline User purchases yet.";

    // 📊 DOWNLINE LIST
    if(user.downlineList && Object.keys(user.downlineList).length > 0){
        downlineText = Object.entries(user.downlineList)
        .map(([id, qty]) => {
            return `🆔 <code>${id}</code> → ${qty} CODE`;
        })
        .join("\n");
    }

    bot.sendMessage(chatId, `📊 <b>Your Downline Data</b>

${downlineText}

💡 Each downline purchase gives you +1 progress Point.`,
    { parse_mode: "HTML" });

    return;
}
    /* ================= STOCK ================= */
    if (data === "stock_hotya") {
        bot.sendMessage(adminId, "🔥 Hotya Stock Control", {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text:"✅ Available", callback_data:"hotya_available"},
                        { text:"❌ Over", callback_data:"hotya_over"}
                    ]
                ]
            }
        });
        return;
    }

    if (data === "stock_gosh") {
    bot.sendMessage(adminId, "⚡ GOSH Stock Control", {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "✅ Available", callback_data: "gosh_available" },
                    { text: "❌ Over", callback_data: "gosh_over" }
                ]
            ]
        }
    });
    return;
}
        // stock controler
    if(data === "hotya_available"){
stock.Hotya = "available";
bot.sendMessage(adminId,"✅ Hotya Stock set to AVAILABLE");
        return;
}

if(data === "hotya_over"){
stock.Hotya = "over";
bot.sendMessage(adminId,"❌ Hotya Stock set to OVER");
    return;
}

if(data === "gosh_available"){
stock.GOSH = "available";
bot.sendMessage(adminId,"✅ GOSH Stock set to AVAILABLE");
    return;
}

if(data === "gosh_over"){
stock.GOSH = "over";
bot.sendMessage(adminId,"❌ GOSH Stock set to OVER");
    return;
    }
// redeem request controller
    if(data === "redeem_hotya" || data === "redeem_gosh"){

const user = users[chatId];

if(!user) return;

/* PREVENT MULTIPLE */
if(user.redeemRequest){
    bot.sendMessage(chatId,"⚠️ Already requested.");
    return;
}

/* STOCK */
const type = data === "redeem_hotya" ? "Hotya" : "GOSH";

if(stock[type] === "over"){
    bot.sendMessage(chatId,`❌ ${type} out of stock.`);
    return;
}

/* SAVE */
user.redeemType = type;
user.redeemRequest = true;
saveUsers();

/* ADMIN SEND */
ADMIN_IDS.forEach(admin=>{
    bot.sendMessage(admin,
`🎁 REDEEM REQUEST

👤 User ID: <code>${chatId}</code>
🎯 Code Type: ${type}

👥 Total Referrals: ${user.ref}
📊 Points Progress: ${user.refProgress}/10
🏆 Total Redeemed: ${user.totalRedeems}`,
{
parse_mode:"HTML",
reply_markup:{
inline_keyboard:[
[
{ text:"✅ Approve", callback_data:`approve_${chatId}` },
{ text:"❌ Reject", callback_data:`reject_${chatId}` }
]
]
}
});
});

/* USER MSG */
bot.sendMessage(chatId,
`✅ Redeem request sent!

⏳ Wait for admin approval.`);

}

    /* ================= BUY FLOW ================= */
    const QR_CODES = {
        Hotya: "PaymentQR2.jpg",
        GOSH: "paymentQR.jpg"
    };

    /* SELECT CODE */
if(data === "buy_hotya" || data === "buy_gosh"){
    if(users[chatId].buyRequest){
    bot.sendMessage(chatId,
`⚠️ You already have a pending purchase request.

⏳ Please wait for admin response before creating a new one.`);
    return;
}

const codeType = data === "buy_hotya" ? "Hotya" : "GOSH";

/* STOCK CHECK */
if(stock[codeType] === "over"){
bot.sendMessage(chatId,`❌ ${codeType} Code is currently Out of Stock.`);
return;
}

    users[chatId].buyType = codeType;
    users[chatId].buyStep = "select_qty";
    saveUsers();

    bot.sendMessage(chatId,
`🛒 <b>${codeType} Code Purchase</b>

Select the quantity you want to purchase.`,
{parse_mode: "HTML" ,
    reply_markup:{
 inline_keyboard:[
  [
   {text:"2",callback_data:"qty_2"},
   {text:"3",callback_data:"qty_3"},
    {text:"4",callback_data:"qty_4"}
  ],
  [
   {text:"5",callback_data:"qty_5"},
   {text:"10",callback_data:"qty_10"}
  ]
 ]
}
});
}
/* SELECT QUANTITY */
if(data.startsWith("qty_")){
    const user = users[chatId];
    if(user.buyRequest && user.buyStep === "payment"){
        bot.sendMessage(chatId,
`⚠️ You already submitted this order.

📸 Please send payment screenshot or wait for admin review.`);
        return;
    }

    const qty = parseInt(data.split("_")[1]);

    if(!user.buyType) return;

    let price = 0;

    if(qty === 1) price = 10;
if(qty === 2) price = 20;
if(qty === 3) price = 30;
if(qty === 4) price = 40;
if(qty === 5) price = 50;
if(qty === 10) price = 100;

    user.buyQty = qty;
    user.buyPrice = price;
    user.buyStep = "payment";
    user.buyTime = Date.now(); // ⏱ start timer
    saveUsers();

    const qr = QR_CODES[user.buyType];
    
    bot.sendPhoto(chatId, qr,{
caption:
`🛒 <b>Order Summary</b>

📦 Code Type: ${user.buyType}
🔢 Quantity: ${qty}
💰Price to Pay: ₹${price}

After payment, send the payment screenshot here. & screenshot must contains UTR 

⚠️ Payments are Non-refundable.`,parse_mode: "HTML",
        reply_markup:{
            keyboard:[["❌ Cancel"]],
            resize_keyboard:true
        }
    });
            }
 

 /* ADMIN APPROVE/REJECT PURCHASE */
if (
  data.startsWith("buyapprove_") || 
  data.startsWith("buyreject_") || 
  data.startsWith("buywarn_") ||
  data.startsWith("buydelivered_")
) {
    const userId = Number(data.split("_")[1]);
    
    if (!ADMIN_IDS.includes(adminId)) return;
    if (!users[userId]) return;

    // ✅ APPROVE
   if (data.startsWith("buyapprove_")) {

    const type = users[userId].buyType;
    const qty = users[userId].buyQty;
    users[userId].buyRequest = false;
    users[userId].buyStep = null;
    users[userId].buyTime = null;
    users[userId].screenshot = null;
    users[userId].orderStatus = null;
    users[userId].waitingAdminMsg = true;
    adminState.targetUser = userId; // ✅ ADD THIS
     users[userId].totalQty += users[userId].buyQty;
    users[userId].transactionCount += 1;
    const referrer = users[userId].referredBy;
    if(referrer && users[referrer]){ users[referrer].downlinePurchases += users[userId].buyQty;
    if(!users[referrer].downlineList[userId]){
            users[referrer].downlineList[userId] = 0;
        }

        users[referrer].downlineList[userId] += users[userId].buyQty;
    }
    bot.sendMessage(adminId,
`✅ Payment Approved
🎯 Type: ${type}
Send Purchase CODE to ID: <code>${userId}</code>`,
{parse_mode:"HTML"});

    bot.sendMessage(userId, `✅ Payment Verified!\n\nYour purchase has been approved. 🥳`);

    // downline purchase msg
    if(referrer && users[referrer]){
        bot.sendMessage(referrer,
`🎉 Your referral made a purchase!  ID: ${userId}`);
    }

    // self purchase logic
       users[userId].selfPurchases += users[userId].buyQty;
const selfEligible = Math.floor(users[userId].selfPurchases / 5);

if(selfEligible > users[userId].selfRedeems){

    let newRedeems = (selfEligible - users[userId].selfRedeems);

    users[userId].redeemLimit += newRedeems;
    users[userId].selfRedeems = selfEligible;
        bot.sendMessage(userId,
`🎁 <b>CODE PURCHASED BONUS!</b>
🎉 You earned <b>${newRedeems}</b> FREE redeem(s)!
💡 <i>5 Codes purchases = 1 redeem</i>`,
        { parse_mode:"HTML" });
    }

    saveUsers();
}
    // ❌ REJECT
    else if (data.startsWith("buyreject_")) {

        users[userId].buyRequest = false;
        users[userId].buyStep = null;
        users[userId].buyType = null;
        users[userId].screenshot = null;
        users[userId].orderStatus = null;
        users[userId].buyQty = 0;
        users[userId].buyPrice = 0;

        saveUsers();

        bot.sendMessage(userId,
`❌ Payment Not Verified
Your purchase request was rejected.`);
    }
 
        // 📦 DELIVERED
else if (data.startsWith("buydelivered_")) {

    users[userId].buyRequest = false;
    users[userId].buyStep = null;
    users[userId].screenshot = null;
    users[userId].orderStatus = null;
    users[userId].buyType = null;
    users[userId].buyQty = 0;
    users[userId].buyPrice = 0;
    saveUsers();

    bot.sendMessage(userId,
`Order already delivered.
🚫 Do not submit again.`,
    { parse_mode:"HTML" });
}

    // ⚠️ WARN 
    else if (data.startsWith("buywarn_")) {

        users[userId].buyRequest = false;
        users[userId].warnings += 1;
        users[userId].buyStep = null;
        users[userId].screenshot = null;
        users[userId].orderStatus = null;
        users[userId].buyType = null;
        users[userId].buyQty = 0;
        users[userId].buyPrice = 0;

        saveUsers();

        bot.sendMessage(userId,
` <b>Order Cancelled & Warning Issued</b>
🚫 Reason: Fake / Invalid Payment Screenshot.`,
        { parse_mode: "HTML" });
    }

    bot.deleteMessage(query.message.chat.id, query.message.message_id).catch(()=>{});
}

/* APPROVE/REJECT REDEEM */
if(data.startsWith("approve_") || data.startsWith("reject_")){
    const userId = Number(data.split("_")[1]); // Convert to number
    if(!ADMIN_IDS.includes(adminId) || !users[userId]) return;

    if(data.startsWith("approve_")){
const user = users[userId];
let progress = Math.min(getCombinedProgress(user), 10);
// remove 10 progress smartly
let remainingToRemove = 10;

// first remove from downline
let downlineRemove = Math.min(user.downlinePurchases, remainingToRemove);
user.downlinePurchases -= downlineRemove;
remainingToRemove -= downlineRemove;

// then remove from self (convert 2:1)
if(remainingToRemove > 0){
    let selfRemove = Math.ceil(remainingToRemove / 2);
    user.selfPurchases = Math.max(0, user.selfPurchases - selfRemove);
} 
    users[userId].redeemRequest = false;
    users[userId].redeemHistory.push({type: users[userId].redeemType,date: new Date().toLocaleString() });
    if(users[userId].availableRedeems > 0){  users[userId].availableRedeems -= 1;}
    users[userId].totalRedeems += 1;
    users[userId].lastRedeemPurchaseCount = users[userId].transactionCount;
    users[userId].waitingAdminMsg = true;
    adminState.targetUser = userId; // ✅ FIX

    saveUsers();

        bot.sendMessage(userId,`🎉 Redeem Approved!
Your reward is being sent soon..🥳`);
        bot.sendMessage(adminId,
`✅ Redeem Approved
🎯 Code Type: ${user.redeemType}

Send redeem reward to ID:<code>${userId}</code>`,
{parse_mode:"HTML"});
    } else {
    users[userId].redeemRequest = false;
    saveUsers();

    bot.sendMessage(userId,`❌ Redeem Request Rejected`);

    bot.sendMessage(adminId,
`❌ Redeem Rejected ID: <code>${userId}</code>`,
{ parse_mode:"HTML" });
}

    bot.deleteMessage(query.message.chat.id, query.message.message_id).catch(()=>{});
}
});
/* ================= SINGLE MESSAGE HANDLER ================= */
let adminState = { mode:null, targetUser:null };

bot.on("message", async(msg)=>{
    const chatId = msg.chat.id;
    createUser(chatId);
    users[chatId].lastActive = Date.now();
    saveUsers();
    const text = msg.text || msg.caption || "";
    const user = users[chatId];

    if(text.startsWith("/")) return;
    /* ================= PURCHASE CANCEL ================= */
    if(text === "❌ Cancel" && (user.buyRequest || user.buyStep)){
    user.buyRequest = false;
    user.buyStep = null;
    user.screenshot = null;
    user.orderStatus = null;
    saveUsers();

    bot.sendMessage(chatId,`Order Cancelled 💔`,{
        reply_markup:{
            keyboard:[
                ["👤 Profile","👥 Refer"],
                ["🎁 Redeem","Help ❓"],
                ["🛒 Buy Code"]
            ],
            resize_keyboard:true
        }
    });

    return;
}
    /* ================= ADMIN SEND REWARD ================= */
   /* ================= ADMIN SEND REWARD ================= */
if(adminState.targetUser){

    const target = adminState.targetUser;

    // 📸 If admin sends photo
    if(msg.photo){
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        bot.sendPhoto(target, fileId, { caption: text });
    } 
    
    // 📝 If admin sends text
    else{
        bot.sendMessage(target, text);
    }

    // ✅ Reset state after sending
    users[target].waitingAdminMsg = false;
    adminState.targetUser = null;

    saveUsers();

    // ✅ Confirmation to admin
    bot.sendMessage(chatId,
`✅ CODE sent successfully to ID: <code>${target}</code>`,
{
    parse_mode: "HTML",
    reply_markup: {
        keyboard: [
            ["📊 Status","📢 Broadcast"],
            ["👤 User Info","✉ Msg User"],
            ["📦 Stock Manager"]
        ],
        resize_keyboard: true
    }
});

    return;
}
/* STOCK MANAGER */
if(text === "📦 Stock Manager"){

bot.sendMessage(chatId,
`📦 STOCK MANAGER

Select code to manage stock`,
{
reply_markup:{
inline_keyboard:[
[
{ text:"🔥 Hotya", callback_data:"stock_hotya"}
],
[
{ text:"⚡ GOSH", callback_data:"stock_gosh"}
]
]
}
});

                }
    /* ================= RECEIVE SCREENSHOT ================= */
   if(msg.photo && user.buyStep === "payment"){
        const fileId = msg.photo[msg.photo.length-1].file_id;
        user.screenshot=fileId;
        user.orderStatus="Submitted";
        user.buyRequest = true;
        saveUsers();
        bot.sendMessage(chatId,`✅ Screenshot Received!
        
⏳ Your payment is under verification.`,{
    reply_markup:{
        keyboard:[
            ["👤 Profile","👥 Refer"],
            ["🎁 Redeem","Help ❓"],
            ["🛒 Buy Code"]
        ],
        resize_keyboard:true
    }
});
        ADMIN_IDS.forEach(admin=>{
            bot.sendPhoto(admin,fileId,{
                caption:`🛒 Purchase Request
                User ID: <code>${chatId}</code>
                Code: ${user.buyType}
                Quantity: ${user.buyQty}
                Price: ₹${user.buyPrice}`, parse_mode:"HTML" ,
                reply_markup:{
    inline_keyboard:[
[
{ text:"✅ Approve", callback_data:`buyapprove_${chatId}`},
{ text:"❌ Reject", callback_data:`buyreject_${chatId}`}
],
[
{ text:"⚠️ Warn ", callback_data:`buywarn_${chatId}`},
{ text:"📦 Delivered", callback_data:`buydelivered_${chatId}`}
]
]
}
            });
        });
    }

    /* ================= USER COMMANDS ================= */
    if(text==="👤 Profile"){
const progress = Math.min(getCombinedProgress(user), 10);
bot.sendMessage(chatId,
`👤 <b>Your Profile</b>
🆔 ID: <code>${chatId}</code>

👥 My Referral: ${user.ref}
🎁 Code Redeemed: ${user.totalRedeems}
📦 Quantity Purchased: ${user.totalQty || 0}
<b>Your Progress Points: ${progress}/10:</b>
${getProgressBar(progress,10)}

`,
{parse_mode:"HTML"});

}
    if(text==="👥 Refer"){
        const link=`https://t.me/${botUsername}?start=${chatId}`;
        bot.sendMessage(chatId,`
Invite your friends using your referral link 👇

🔗 Your Link:
${link}

`);
    }

if(text==="🎁 Redeem"){
    const progress = Math.min(getCombinedProgress(user), 10);
    const usedRedeems = user.redeemHistory.length;
   if(progress < 10){
        let remaining = 10 - progress;
        bot.sendMessage(chatId,
`<b>REDEEM LOCKED</b> 🔒

Required <b>${10 - progress} more points</b> to unlock your free redeem code ❗

<b>Your Points Progress: ${progress}</b>
${getProgressBar(progress,10)}
━━━━━━━━━━━━━━━━━━━
<b>Points Kaise Milega?</b>
➊ Jab aapka invite kiya hua user buy karega to +1 point milega  
➋ khud 5 codes buy karoge to +10 points milenge 

<b>Jaldi Unlock Kaise Kare?</b>
➊ Active users ko invite karo jo purchase kare  
➋ Ya khud code buy karke unlock karlo
━━━━━━━━━━━━━━━━━━━
🚀<b>Tip:</b>Top users don’t wait they <b>take action</b> and unlock rewards faster😎`,
{
  parse_mode: "HTML",
  reply_markup: {
    inline_keyboard: [
      [{ text: "📊 Downline Data", callback_data: "view_downline" }]
    ]
  }
});

        return;
    }
    // ❌ CHECK AVAILABLE REDEEM FIRST
if(user.totalRedeems >= user.redeemLimit){
    bot.sendMessage(chatId,
`❌ <b>Redeem Limit Reached</b>
You need to purchase at least <b>5 codes</b> to increase your limits`,
    { parse_mode:"HTML" });
    return;
}

 // ✅ If unlocked
   if(user.redeemRequest){
    bot.sendMessage(chatId,
"⚠️ Redeem request already submitted.\n⏳ Wait for admin approval.");
    return;
}

user.redeemStep = "select_type";
saveUsers();

bot.sendMessage(chatId,
`🎁 <b>Redeem Unlocked!</b>
Select your reward 👇`,
{
    parse_mode:"HTML",
    reply_markup:{
        inline_keyboard:[
            [
                { text:"🔥 Hotya", callback_data:"redeem_hotya"},
                { text:"⚡ GOSH", callback_data:"redeem_gosh"}
            ]
        ]
    }
});
}
    if(text==="Help ❓"){

bot.sendMessage(chatId,
`How may i help you ?`,
{
parse_mode:"Markdown",
reply_markup:{
inline_keyboard:[
[
{ text:"🎁 How to Claim", callback_data:"help_claim"},
{ text:"👥 Community", url:"https://t.me/Marks_community"}
],
[
{ text:"💬 Contact Support", url:"https://t.me/Mark41_helperBot"}
]
]
}
});

}

 if(text === "🛒 Buy Code"){

     const now = Date.now();

if(user.buyStep && user.buyTime){
    const diff = now - user.buyTime;

    // 10 minutes timeout
    if(diff > 10 * 60 * 1000){

        // 🔄 RESET ORDER
        user.buyRequest = false;
        user.buyStep = null;
        user.buyType = null;
        user.buyQty = 0;
        user.buyPrice = 0;
        user.buyTime = null;
        user.screenshot = null;
        user.orderStatus = null;

        saveUsers();

        bot.sendMessage(chatId,
`⌛ Your previous order expired after 10 minutes.

🛒 Please create a new order.`,
{ parse_mode:"HTML" });

    }
}

    // 🔴 Already submitted (real pending)
    if(user.buyRequest){
        bot.sendMessage(chatId,
`⚠️ <b>Pending Order Detected</b>

⏳ Your payment is under verification.

📸 Please wait for admin approval or rejection.`,
        { parse_mode:"HTML" });
        return;
    }

    // 🟡 In progress (not paid yet)
    if(user.buyStep){
        bot.sendMessage(chatId,
`⚠️ <b>Order In Progress</b>

💳 You have not completed payment yet.

📸 Please send payment screenshot or press ❌ Cancel.`,
        { parse_mode:"HTML" });
        return;
    }

    // 🟢 Fresh order
    bot.sendMessage(chatId,"Select which Code you wants to buy.",{
        reply_markup:{
            inline_keyboard:[
                [
                    {text:"🔥 Hotya",callback_data:"buy_hotya"},
                    {text:"⚡ GOSH",callback_data:"buy_gosh"}
                ]
            ]
        }
    });
}

    /* ================= ADMIN PANEL HANDLER ================= */
    if(ADMIN_IDS.includes(chatId)){

        /* CANCEL BUTTON */
        if(text === "❌ Cancel"){
            adminState.mode = null;
            user.buyTime = null;
            adminState.targetUser = null;
            bot.sendMessage(chatId,"Action Cancelled ❌",{
                reply_markup:{
                    keyboard:[
 ["📊 Status","📢 Broadcast"],
 ["👤 User Info","✉ Msg User"],
 ["📦 Stock Manager"]
],
                    resize_keyboard:true
                }
            });
            return;
        }

        /* STATUS */
        if(text === "📊 Status"){

let totalUsers = Object.keys(users).length;

/* ACTIVE USERS (LAST 24 HOURS) */
let now = Date.now();
let activeUsers = Object.values(users).filter(u => 
    u.lastActive && (now - u.lastActive) <= 24 * 60 * 60 * 1000
).length;
let totalTransactions = Object.values(users).reduce((sum,u)=>sum+(u.transactionCount || 0),0);
let totalQuantity = Object.values(users).reduce((sum,u)=>sum+(u.totalQty||0),0);
let totalRedeems = Object.values(users).reduce((sum,u)=>sum+(u.totalRedeems || 0),0);

/* STOCK STATUS */
let hotyaStock = stock.Hotya === "available" ? "✅ Available" : "❌ Over";
let goshStock = stock.GOSH === "available" ? "✅ Available" : "❌ Over";

bot.sendMessage(chatId,
`📊 BOT STATUS
👤 Total Users: ${totalUsers}
⚡ Active Users: ${activeUsers}

🛒 Total Orders: ${totalTransactions}
📦 Total Quantity Sold: ${totalQuantity}
🎁 Total Redeems: ${totalRedeems}

📦 STOCK STATUS
🔥 Hotya: ${hotyaStock}
⚡ GOSH: ${goshStock}
`);

}

        /* BROADCAST */
        if(text === "📢 Broadcast"){
            adminState.mode = "broadcast";
            bot.sendMessage(chatId,"📢 Send message to broadcast to all users.",{
                reply_markup:{keyboard:[["❌ Cancel"]], resize_keyboard:true}
            });
            return;
        }
        if(adminState.mode === "broadcast"){

    Object.keys(users).forEach(id=>{

        /* PHOTO */
        if(msg.photo){
            const fileId = msg.photo[msg.photo.length-1].file_id;
            bot.sendPhoto(id,fileId,{caption:text}).catch(()=>{});
        }

        /* VIDEO */
        else if(msg.video){
            const fileId = msg.video.file_id;
            bot.sendVideo(id,fileId,{caption:text}).catch(()=>{});
        }

        /* DOCUMENT */
        else if(msg.document){
            const fileId = msg.document.file_id;
            bot.sendDocument(id,fileId,{caption:text}).catch(()=>{});
        }

        /* TEXT */
        else{
            bot.sendMessage(id,text).catch(()=>{});
        }

    });

    bot.sendMessage(chatId,"✅ Broadcast sent to all users.",{
    reply_markup:{
        keyboard:[
            ["📊 Status","📢 Broadcast"],
            ["👤 User Info","✉ Msg User"]
        ],
        resize_keyboard:true
    }
});

adminState.mode = null;
return;
}
        /* USER INFO */
        if(text === "👤 User Info"){
            adminState.mode = "userinfo";
            bot.sendMessage(chatId,"Send User ID to check profile.",{
                reply_markup:{keyboard:[["❌ Cancel"]], resize_keyboard:true}
            });
            return;
        }
        if(adminState.mode === "userinfo"){
            const id = text;
            if(!users[id]){
                bot.sendMessage(chatId,"❌ User not found.");
                return;
            }
            const user = users[id];
            const progress = Math.min(getCombinedProgress(user), 10);
            // Fetch Telegram user info
    let username = "Not set";
    try {
        const chat = await bot.getChat(id);
        if(chat.username) username = "@" + chat.username;
    } catch (e) {
        console.log("Could not fetch username for", id);
    }
          bot.sendMessage(chatId,
`👤 <b>USER PROFILE</b>

🆔 User ID: <code>${id}</code>
👤 Username: ${username}

👥 Total Referrals: ${user.ref}
🎁 Redeems: ${user.totalRedeems}/${user.redeemLimit || 0}
🎟 Available Redeems: ${user.availableRedeems}
📈<b>Progress Points: ${progress}/10:</b>
🛒 Total Transactions: ${user.transactionCount || 0}
📦 Quantity Purchased: ${user.totalQty || 0}
👥 <b>Downline Purchases:</b> ${user.downlinePurchases || 0}
⚠️ <b>Warnings:</b> ${user.warnings || 0}
👤 Referred By: <code>${user.referredBy || "None"}</code>
<b>Progress Points: ${progress}/10:</b>`,
{ parse_mode: "HTML",
reply_markup:{
keyboard:[
["📊 Status","📢 Broadcast"],
["👤 User Info","✉ Msg User"]
],
resize_keyboard:true
}
});
            adminState.mode = null;
            return;
        }

        /* MSG USER */
        if(text === "✉ Msg User"){
            adminState.mode = "msg_userid";
            bot.sendMessage(chatId,"Send User ID to message.",{
                reply_markup:{keyboard:[["❌ Cancel"]], resize_keyboard:true}
            });
            return;
        }
        if(adminState.mode === "msg_userid"){
            if(!users[text]){
                bot.sendMessage(chatId,"❌ User not found.");
                return;
            }
            adminState.targetUser = text;
            adminState.mode = "msg_send";
            bot.sendMessage(chatId,"Send message for this user.",{
                reply_markup:{keyboard:[["❌ Cancel"]], resize_keyboard:true}
            });
            return;
        }
        if(adminState.mode === "msg_send"){

    /* PHOTO */
    if(msg.photo){
        const fileId = msg.photo[msg.photo.length-1].file_id;
        bot.sendPhoto(adminState.targetUser,fileId,{caption:text});
    }

    /* VIDEO */
    else if(msg.video){
        const fileId = msg.video.file_id;
        bot.sendVideo(adminState.targetUser,fileId,{caption:text});
    }

    /* DOCUMENT */
    else if(msg.document){
        const fileId = msg.document.file_id;
        bot.sendDocument(adminState.targetUser,fileId,{caption:text});
    }

    /* TEXT */
    else{
        bot.sendMessage(adminState.targetUser,text);
    }

    bot.sendMessage(chatId,"✅ Message sent to user.",{
        reply_markup:{
            keyboard:[
                ["📊 Status","📢 Broadcast"],
                ["👤 User Info","✉ Msg User"]
            ],
            resize_keyboard:true
        }
    });

    adminState.mode = null;
    adminState.targetUser = null;
    return;
}

    }

});
