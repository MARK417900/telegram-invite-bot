from telegram import Update, ChatInviteLink
from telegram.ext import MessageHandler, filters
from telegram.ext import (
    ApplicationBuilder, CommandHandler,
    ChatMemberHandler, ContextTypes
)
import os
BOT_TOKEN = os.getenv("BOT_TOKEN")
GROUP_ID =  -1002240484750
ADMIN_ID = 1380090461
REQUIRED_INVITES = 5

users = {}          # user_id -> data
used_joins = set()  # joined user IDs


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user

    if user.id not in users:
        invite: ChatInviteLink = await context.bot.create_chat_invite_link(
            chat_id=GROUP_ID,
            name=f"ref_{user.id}",
            creates_join_request=False
        )

        users[user.id] = {
            "invite_link": invite.invite_link,
            "count": 0,
            "unlocked": False
        }

    data = users[user.id]
    await update.message.reply_text(
        f"🔗 Your personal invite link:\n{data['invite_link']}\n\n"
        f"👥 Invites: {data['count']} / {REQUIRED_INVITES}"
    )


async def track_joins(update: Update, context: ContextTypes.DEFAULT_TYPE):
    member = update.chat_member
    new_user = member.new_chat_member.user

    if member.chat.id != GROUP_ID:
        return

    if new_user.is_bot or new_user.id in used_joins:
        return

    used_joins.add(new_user.id)

    invite = member.invite_link
    if not invite:
        return

    for uid, data in users.items():
        if data["invite_link"] == invite.invite_link:
            data["count"] += 1

            if data["count"] >= REQUIRED_INVITES and not data["unlocked"]:
                data["unlocked"] = True

                # Promote user (pin permission)
                await context.bot.promote_chat_member(
                    chat_id=GROUP_ID,
                    user_id=uid,
                    can_pin_messages=True
                )

                # Notify admin
                await context.bot.send_message(
                    ADMIN_ID,
                    f"✅ User {uid} completed {REQUIRED_INVITES} invites."
                )
            break

async def welcome_new_user(update, context):
    for member in update.message.new_chat_members:
        if member.is_bot:
            continue

        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text=(f"✨ <b>WELCOME TO THE GROUP!</b>\n"
f" <b>DEAR</b>  {member.mention_html()}\n\n"
"━━━━━━━━━━━━━━━━━━\n"
"📌 <b>UNLOCK PIN MESSAGE ACCESS</b>\n"
"━━━━━━━━━━━━━━━━━━\n\n"
"🚀 <b>Invite 5 friends</b> to this group and get "
"<b>PIN MESSAGE permission</b> instantly!\n\n"
"🎯 <b>How to do it?</b>\n"
"1️⃣ Open our promotion bot\n"
"2️⃣ Get your <b>personal invite link</b>\n"
"3️⃣ Share it with <b>5 people</b>\n\n"
"🤖 <b>Promotion Bot:</b>\n"
"👉 @Promoter001Bot\n\n"
"━━━━━━━━━━━━━━━━━━\n"
"⚡ <i>Grow together. Promote smarter.</i> ⚡"
                
#                f"👋 Welcome {member.mention_html()}!\n\n"
 #               "To get **pin message access**:\n"
  #              "➤ Invite **5 people** to this group\n\n"
   #             "👉 Open the bot and get your personal invite link:\n"
    #            "@Promoter001Bot"
            ),
            parse_mode="HTML"
        )

app = ApplicationBuilder().token(BOT_TOKEN).build()

app.add_handler(CommandHandler("start", start))
app.add_handler(ChatMemberHandler(track_joins, ChatMemberHandler.CHAT_MEMBER))

print("Bot running...")
app.add_handler(MessageHandler(filters.StatusUpdate.NEW_CHAT_MEMBERS, welcome_new_user))

app.run_polling()


