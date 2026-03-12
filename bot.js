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
/* ================= ADMIN PANEL COMMAND ================= */
bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;

    if(!ADMIN_IDS.includes(chatId)){
        bot.sendMessage(chatId, "❌ You are not an admin.");
        return;
    }

    const adminKeyboard = [
        ["📊 Status","📢 Broadcast"],
        ["👤 User Info","✉ Msg User"]
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

    /* ================= BUY FLOW ================= */
    const QR_CODES = {
        Hotya: "paymentQR.jpg",
        GOSH: "paymentQR.jpg"
    };

    /* SELECT CODE */
    if(data === "buy_hotya" || data === "buy_gosh"){
        const codeType = data === "buy_hotya" ? "Hotya" : "GOSH";
        users[chatId].buyType = codeType;
        users[chatId].buyStep = "payment";
        users[chatId].buyRequest = true;
        saveUsers();

        const qr = QR_CODES[codeType];

        bot.sendPhoto(chatId, qr, {
            caption: `Price ₹20/Referal.\n\nAfter payment, Upload Screenshot for payment proof.`,
            reply_markup:{keyboard:[["❌ Cancel"]], resize_keyboard:true}
        });
    }

    /* ADMIN APPROVE/REJECT PURCHASE */
    if(data.startsWith("buyapprove_") || data.startsWith("buyreject_")){
        const userId = data.split("_")[1];
        if(!ADMIN_IDS.includes(adminId)) return;

        if(data.startsWith("buyapprove_")){
            users[userId].buyRequest = false;
            users[userId].waitingAdminMsg = true;
            saveUsers();
            bot.sendMessage(userId,"✅ Purchase approved.\nAdmin will send reward soon..🥳");
            bot.sendMessage(adminId,"Send reward ID ${chatId}");
        } else {
            users[userId].buyRequest = false;
            saveUsers();
            bot.sendMessage(userId,"❌ Purchase rejected.");
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
        users[userId].refProgress = Math.max(0, users[userId].refProgress - 5);
        users[userId].waitingAdminMsg = true;
        saveUsers();

        bot.sendMessage(userId,"🎉 Redeem approved.\nAdmin sending reward.");
        bot.sendMessage(adminId,"✅ Redeem approved. Send reward now.");
    } else {
        users[userId].redeemRequest = false;
        saveUsers();
        bot.sendMessage(userId,"❌ Redeem request rejected.");
        bot.sendMessage(adminId,"✅ Redeem rejected.");
    }

    bot.deleteMessage(query.message.chat.id, query.message.message_id).catch(()=>{});
}

/* ================= SINGLE MESSAGE HANDLER ================= */
let adminState = { mode:null, targetUser:null };

bot.on("message", async(msg)=>{
    const chatId = msg.chat.id;
    const text = msg.text || "";

    createUser(chatId);
    const user = users[chatId];

    if(text.startsWith("/")) return;

    /* ================= ADMIN SEND REWARD ================= */
    if(ADMIN_IDS.includes(chatId)){
        const pendingUser = Object.keys(users).find(id=>users[id].waitingAdminMsg);
        if(pendingUser){
            if(msg.photo){
                const fileId = msg.photo[msg.photo.length-1].file_id;
                bot.sendPhoto(pendingUser,fileId,{caption:"🎁 Your reward"});
            } else if(msg.text){
                bot.sendMessage(pendingUser,msg.text);
            }
            users[pendingUser].waitingAdminMsg=false;
            saveUsers();
            bot.sendMessage(chatId,"✅ Reward sent.");
            return;
        }
    }

    /* ================= RECEIVE SCREENSHOT ================= */
    if(msg.photo && user.buyRequest){
        const fileId = msg.photo[msg.photo.length-1].file_id;
        user.screenshot=fileId;
        user.orderStatus="Submitted";
        saveUsers();
        bot.sendMessage(chatId,"✅ Screenshot received.");

        ADMIN_IDS.forEach(admin=>{
            bot.sendPhoto(admin,fileId,{
                caption:`🛒 Purchase Request\nUser: ${chatId}\nType: ${user.buyType}`,
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

    /* ================= USER COMMANDS ================= */
    if(text==="👤 Profile"){
        bot.sendMessage(chatId,
        `🆔 ${chatId}\n\n👥 Total Referrals: ${user.ref}\n🛒Code Purchased: ${user.purchases}\n\n🎁 My Redeems: ${user.redeems}\n\n📊 Progress: ${user.refProgress}/5`);
    }

    if(text==="👥 Refer"){
        const link=`https://t.me/${botUsername}?start=${chatId}`;
        bot.sendMessage(chatId,`Invite friends\n${link}`);
    }

    if(text==="🎁 Redeem"){
        user.refProgress = 5; // temporary for test
        if(user.refProgress < 5){
            bot.sendMessage(chatId,"❌ Need 5 referrals to redeem.");
            return;
        }
        user.redeemRequest = true;
        saveUsers();
        ADMIN_IDS.forEach(admin=>{
            bot.sendMessage(admin,
                `🎁 REDEEM REQUEST\n👤 User ID: ${chatId}\n\n👥 Total Referrals: ${user.ref}\n📊 Progress: ${user.refProgress}/5\n\n🛒 Purchases: ${user.purchases}\n🎁 Previous Redeems: ${user.redeems}\n\nInvited:\n${user.invited.length ? user.invited.join(", ") : "None"}`,
                {
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
        bot.sendMessage(chatId,"✅ Redeem request sent to admin.");
    }

    if(text==="Help ❓"){
        bot.sendMessage(chatId,"Contact support: @Mark41_helperBot");
    }

    if(text === "🛒 Buy Code"){
        bot.sendMessage(chatId,"Select Code:",{
            reply_markup:{
                inline_keyboard:[
                    [{text:"🔥 Hotya",callback_data:"buy_hotya"}],
                    [{text:"⚡ GOSH",callback_data:"buy_gosh"}]
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
            bot.sendMessage(chatId,"❌ Action cancelled.",{
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
            bot.sendMessage(chatId,
                `📊 BOT STATUS\n\n👤 Total Users: ${totalUsers}\n🛒 Total Purchases: ${totalPurchases}\n🎁 Total Redeems: ${totalRedeems}`);
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
                bot.sendMessage(id,text).catch(()=>{});
            });
            bot.sendMessage(chatId,"✅ Broadcast sent.");
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
                `👤 USER PROFILE\n\n🆔 User ID: ${id}\n👥 Total Referrals: ${u.ref}\n📊 Progress: ${u.refProgress}/5\n🛒 Purchases: ${u.purchases}\n🎁 Redeems: ${u.redeems}\n📦 Buy Request: ${u.buyRequest ? "Yes":"No"}\n🎁 Redeem Request: ${u.redeemRequest ? "Yes":"No"}\n📸 Screenshot Uploaded: ${u.screenshot ? "Yes":"No"}\n👤 Referred By: ${u.referredBy || "None"}\nInvited Users:\n${u.invited.length ? u.invited.join(", ") : "None"}`
            );
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
            bot.sendMessage(adminState.targetUser,text);
            bot.sendMessage(chatId,"✅ Message sent to user.");
            adminState.mode = null;
            adminState.targetUser = null;
            return;
        }

    }

});
