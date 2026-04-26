import logging
from telegram import Update, ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardMarkup, InlineKeyboardButton
from telegram.ext import Application, CommandHandler, MessageHandler, ContextTypes, filters, CallbackQueryHandler

TOKEN = '8605121015:AAFz-OwQB540Lzs7ak8zxSGS_dopDApoetU'
FORCE_CHANNEL = 'https://t.me/EarnWithMark41'
SUPPORT_USERNAME = '@MARKS_CS'

logging.basicConfig(level=logging.INFO)

MENU = ReplyKeyboardMarkup([
    [KeyboardButton('Deposit'), KeyboardButton('Withdraw')],
    [KeyboardButton('Profile')],
    [KeyboardButton('Classic Ludo'), KeyboardButton('Quick Ludo')],
    [KeyboardButton('Popular Ludo')],
    [KeyboardButton('Support')]
], resize_keyboard=True)

async def joined(bot, user_id):
    try:
        member = await bot.get_chat_member(FORCE_CHANNEL, user_id)
        return member.status in ['member','administrator','creator']
    except:
        return False

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    if not await joined(context.bot, user.id):
        kb = InlineKeyboardMarkup([
            [InlineKeyboardButton('Join Community', url=f'https://t.me/{FORCE_CHANNEL.replace("@","")}')],
            [InlineKeyboardButton('Check Join', callback_data='check_join')]
        ])
        await update.message.reply_text('Please join our community first.', reply_markup=kb)
        return
    await update.message.reply_text('Welcome! Choose an option:', reply_markup=MENU)

async def check_join(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    if await joined(context.bot, q.from_user.id):
        await q.message.reply_text('Verified! Main menu opened.', reply_markup=MENU)
    else:
        await q.message.reply_text('You still need to join the channel.')

async def buttons(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    user = update.effective_user
    if text == 'Deposit':
        await update.message.reply_text('Send payment screenshot or UPI TXN ID to admin.')
    elif text == 'Withdraw':
        await update.message.reply_text('Send amount and UPI ID for withdrawal request.')
    elif text == 'Profile':
        await update.message.reply_text(f'Name: {user.first_name}\nID: {user.id}\nBalance: ₹0')
    elif text == 'Classic Ludo':
        await update.message.reply_text('Classic Ludo coming soon.')
    elif text == 'Quick Ludo':
        await update.message.reply_text('Quick Ludo coming soon.')
    elif text == 'Popular Ludo':
        await update.message.reply_text('Popular Ludo coming soon.')
    elif text == 'Support':
        await update.message.reply_text(f'Contact support: {SUPPORT_USERNAME}')
    else:
        await update.message.reply_text('Use menu buttons only.')


def main():
    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler('start', start))
    app.add_handler(CallbackQueryHandler(check_join, pattern='check_join'))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, buttons))
    app.run_polling()

if __name__ == '__main__':
    main()
