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
            redeems:0,
            purchases:0,
            buyQty:0,
            buyPrice:0,
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

    bot.sendMessage(chatId,"To use this bot, please join our official channels first 🥳.",{
        reply_markup:{inline_keyboard:buttons}
    });
});

/* CALLBACK HANDLER */
bot.on("callback_query", async(query)=>{
    const chatId = query.message.chat.id;
    const data = query.data;
    const adminId = query.from.id;
    /* JOIN CHECK */
    if(data==="check_join"){

const joined = await checkMembership(chatId);

if(!joined){

bot.sendMessage(chatId,"❌ Please join all channels first.");
return;
}


    const user = users[chatId];

    if(user.tempRef && !user.referredBy){

        const referrerId = user.tempRef;

        if(users[referrerId]){

            user.referredBy = referrerId;

            users[referrerId].ref += 1;
            users[referrerId].refProgress += 1;
            users[referrerId].invited.push(chatId);

            bot.sendMessage(referrerId,
                `🎉 New Referral Joined using your link!

📊 Your Referral Progress:${users[referrerId].refProgress}/4

Invite more friends to unlock rewards faster.🎁`
            );

        }

        user.tempRef = null;

        saveUsers();
    }

    bot.sendMessage(chatId,`✅ Access Granted!`,{
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
if(data === "help_claim"){

bot.sendPhoto(chatId,"claim.jpg",{
caption:
`🎁 <b>How to Claim Reward</b>

1️⃣ Invite 4 friends using your referral link and get id and code

2️⃣ You if you dont want to referal you can purchase it
`,
parse_mode:"HTML"
});

            }
    /* STOCK HOTYA MENU */
if(data === "stock_hotya"){
bot.sendMessage(adminId,
`🔥 Hotya Stock Control`,
{
reply_markup:{
inline_keyboard:[
[
{ text:"✅ Available", callback_data:"hotya_available"},
{ text:"❌ Over", callback_data:"hotya_over"}
]
]
}
});
}

/* STOCK GOSH MENU */
if(data === "stock_gosh"){
bot.sendMessage(adminId,
`⚡ GOSH Stock Control`,
{
reply_markup:{
inline_keyboard:[
[
{ text:"✅ Available", callback_data:"gosh_available"},
{ text:"❌ Over", callback_data:"gosh_over"}
]
]
}
});
}
// user profile on purchase request 
    if(data.startsWith("checkuser_")){

const userId = data.split("_")[1];

if(!users[userId]){
bot.sendMessage(adminId,"❌ User not found.");
return;
}

const u = users[userId];

bot.sendMessage(adminId,
`👤 USER PROFILE

🆔 User ID: <code>${userId}</code>
👥 Total Referrals: ${u.ref}
📊 Referral Progress: ${u.refProgress}/4
🛒 Purchases: ${u.purchases}
🎁 Redeems: ${u.redeems}
👤 Referred By: ${u.referredBy ? `<code>${u.referredBy}</code>` : "None"}`,
{ parse_mode:"HTML" });

        }
    // stock controler
    if(data === "hotya_available"){
stock.Hotya = "available";
bot.sendMessage(adminId,"✅ Hotya Stock set to AVAILABLE");
}

if(data === "hotya_over"){
stock.Hotya = "over";
bot.sendMessage(adminId,"❌ Hotya Stock set to OVER");
}

if(data === "gosh_available"){
stock.GOSH = "available";
bot.sendMessage(adminId,"✅ GOSH Stock set to AVAILABLE");
}

if(data === "gosh_over"){
stock.GOSH = "over";
bot.sendMessage(adminId,"❌ GOSH Stock set to OVER");
    }
    /* ================= BUY FLOW ================= */
    const QR_CODES = {
        Hotya: "paymentQR.jpg",
        GOSH: "paymentQR.jpg"
    };

    /* SELECT CODE */
if(data === "buy_hotya" || data === "buy_gosh"){

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

Select Quantity that you wants  to purchase.`,
{parse_mode: "HTML" ,
    reply_markup:{
 inline_keyboard:[
  [
   {text:"1",callback_data:"qty_1"},
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

    const qty = parseInt(data.split("_")[1]);
    const user = users[chatId];

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
    user.buyRequest = true;
    user.buyStep = "payment";

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
    if(data.startsWith("buyapprove_") || data.startsWith("buyreject_")){
        const userId = data.split("_")[1];
        if(!ADMIN_IDS.includes(adminId)) return;

        if(data.startsWith("buyapprove_")){
            users[userId].buyRequest = false;
            users[userId].waitingAdminMsg = true;
            users[userId].purchases += 1; 
              // +1 referral bonus
    users[userId].refProgress += 1;
            saveUsers();
            bot.sendMessage(userId,`✅ Payment Verified!

Your purchase has been approved.🥳

🎁 Admin will send your code soon..`);
            bot.sendMessage(adminId,`Send the purchased code to ID: <code>${userId}</code>`,{parse_mode:"HTML"});
        } else {
    users[userId].buyRequest = false;
    saveUsers();

    bot.sendMessage(userId,`❌ Payment Not Verified

Your purchase request was rejected.💔

If you believe this is a mistake, contact support.`);

    bot.sendMessage(adminId,
`❌ Purchase Rejected ID: <code>${userId}</code>`,
{ parse_mode:"HTML" });
}
        bot.deleteMessage(query.message.chat.id,query.message.message_id).catch(()=>{});
    }

/* APPROVE/REJECT REDEEM */
if(data.startsWith("approve_") || data.startsWith("reject_")){
    const userId = Number(data.split("_")[1]); // Convert to number
    if(!ADMIN_IDS.includes(adminId) || !users[userId]) return;

    if(data.startsWith("approve_")){
        users[userId].redeems += 1;
        users[userId].redeemRequest = false;
        users[userId].refProgress = Math.max(0, users[userId].refProgress - 4);
        users[userId].waitingAdminMsg = true;
        saveUsers();

        bot.sendMessage(userId,`🎉 Redeem Approved!

Your reward is being sent by the admin.`);
        bot.sendMessage(adminId,`✅ Redeem approved. Send reward to ID: <code>${userId}</code>`,
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
    const text = msg.text || msg.caption || "";
    createUser(chatId);
    const user = users[chatId];

    if(text.startsWith("/")) return;
    /* ================= PURCHASE CANCEL ================= */
    if(text === "❌ Cancel" && user.buyRequest){
    user.buyRequest = false;
    user.buyType = null;
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
    if(ADMIN_IDS.includes(chatId)){
    const pendingUser = Object.keys(users).find(id=>users[id].waitingAdminMsg);

    if(pendingUser){

        /* PHOTO */
        if(msg.photo){
            const fileId = msg.photo[msg.photo.length-1].file_id;
            bot.sendPhoto(pendingUser,fileId,{caption:text});
        }

        /* VIDEO */
        else if(msg.video){
            const fileId = msg.video.file_id;
            bot.sendVideo(pendingUser,fileId,{caption:text});
        }

        /* DOCUMENT */
        else if(msg.document){
            const fileId = msg.document.file_id;
            bot.sendDocument(pendingUser,fileId,{caption:text});
        }

        /* TEXT */
        else{
            bot.sendMessage(pendingUser,text);
        }

        users[pendingUser].waitingAdminMsg=false;
        saveUsers();

        bot.sendMessage(chatId,
`✅ Reward sent successfully to ID: <code>${pendingUser}</code>`,
{parse_mode:"HTML",
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
    if(msg.photo && user.buyRequest){
        const fileId = msg.photo[msg.photo.length-1].file_id;
        user.screenshot=fileId;
        user.orderStatus="Submitted";
        saveUsers();
        bot.sendMessage(chatId,`✅ Payment Screenshot Received!

Your order has been submitted for review.🥳

⏳ Please wait while the admin verifies your payment.`,{
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
{ text:"👤 Check Profile", callback_data:`checkuser_${chatId}`}
]
]
                }
            });
        });
    }

    /* ================= USER COMMANDS ================= */
    if(text==="👤 Profile"){

const progress = user.refProgress;

let bar = "░░░░░░░░░░";

if(progress==1) bar="██░░░░░░░░";
if(progress==2) bar="████░░░░░░";
if(progress==3) bar="██████░░░░";
if(progress>=4) bar="██████████";

bot.sendMessage(chatId,
`      👤 <b>Your Profile</b>
 <b>User ID:</b> <code>${chatId}</code>

🛒 <b>Purchases :</b> ${user.purchases}
🎁 <b>Redeems :</b> ${user.redeems}
👥 <b>Total Referrals :</b> ${user.ref}

📊 <b>Referral Progress</b>
${bar} ${progress}/4
`,
{parse_mode:"HTML"});

}
    if(text==="👥 Refer"){
        const link=`https://t.me/${botUsername}?start=${chatId}`;
        bot.sendMessage(chatId,`Invite Friends & Earn Rewards 🥳!

🎁 Your referral Link 
${link}

`);
    }

    if(text==="🎁 Redeem"){

const REQUIRED_REFERRALS = 4;
const refLeft = REQUIRED_REFERRALS - user.refProgress;

/* PROGRESS BAR */
let progress = user.refProgress;
let bar = "░░░░░░░░░░";

if(progress==1) bar="██░░░░░░░░";
if(progress==2) bar="████░░░░░░";
if(progress==3) bar="██████░░░░";
if(progress>=4) bar="██████████";

/* LOCKED REDEEM MESSAGE */
if(user.refProgress < REQUIRED_REFERRALS){

bot.sendMessage(chatId,
`🎁 <b>REDEEM LOCKED</b> 🔒

You need <b>${refLeft} more referrals</b> to unlock your reward.

━━━━━━━━━━━━━━━━━━━━
📊 <b>Referral Progress</b>

${bar} ${user.refProgress}/4

👥 <b>Option 1 (Free)</b>
Invite friends using your referral link.

⚡ <b>Option 2 (Faster)</b>
Buy any code and get <b>+1 referral bonus</b> instantly.

🚀 Unlock redeem faster without waiting for friends.

━━━━━━━━━━━━━━━━━━━━━
💡 <i>Tip: Share your link in groups to get referrals quickly.</i>`,
{ parse_mode:"HTML" }
);

return;
}

    /* PREVENT MULTIPLE REQUESTS */
    if(user.redeemRequest){
        bot.sendMessage(chatId,"⚠️ Redeem request already submitted.\n⏳ Please wait for admin approval.");
        return;
    }

    user.redeemRequest = true;
    saveUsers();

    ADMIN_IDS.forEach(admin=>{
        bot.sendMessage(admin,
            `🎁 REDEEM REQUEST\n👤 User ID: <code>${chatId}</code>\n\n👥 Total Referrals: ${user.ref}\n📊 Progress: ${user.refProgress}/4\n\n🛒 Purchases: ${user.purchases}\n🎁 Previous Redeems: ${user.redeems}`,
            { parse_mode:"HTML",
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

    bot.sendMessage(chatId,`✅ Your redeem request has been sent to the admin.

⏳ Please wait for approval.`);
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
            adminState.targetUser = null;
            bot.sendMessage(chatId,"Action Cancelled ❌",{
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

        /* STATUS */
        if(text === "📊 Status"){

let totalUsers = Object.keys(users).length;
let totalPurchases = Object.values(users).reduce((sum,u)=>sum+u.purchases,0);
let totalRedeems = Object.values(users).reduce((sum,u)=>sum+u.redeems,0);

/* STOCK STATUS */
let hotyaStock = stock.Hotya === "available" ? "✅ Available" : "❌ Over";
let goshStock = stock.GOSH === "available" ? "✅ Available" : "❌ Over";

bot.sendMessage(chatId,
`📊 BOT STATUS
👤 Total Users: ${totalUsers}
🛒 Total Purchases: ${totalPurchases}
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
            const u = users[id];
            bot.sendMessage(chatId,
`👤 USER PROFILE

🆔 User ID: ${id}
👥 Total Referrals: ${u.ref}
📊 Referal Progress: ${u.refProgress}/4
🛒 Purchases: ${u.purchases}
🎁 Redeems: ${u.redeems}
👤 Referred By: <code>${u.referredBy || "None"}</code>`,
{
parse_mode:"HTML",
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
