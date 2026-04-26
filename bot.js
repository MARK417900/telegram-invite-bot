const { Telegraf, Markup } = require('telegraf');
require('dotenv').config();

const bot = new Telegraf(process.env.8605121015:AAFz-OwQB540Lzs7ak8zxSGS_dopDApoetU);
const FORCE_CHANNEL = process.env.FORCE_CHANNEL || '@EarnWithMark41';
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || '@MARKS_CS';

const menu = Markup.keyboard([
  ['Deposit', 'Withdraw'],
  ['Profile'],
  ['Classic Ludo', 'Quick Ludo'],
  ['Popular Ludo'],
  ['Support']
]).resize();

async function joined(userId) {
  try {
    const member = await bot.telegram.getChatMember(FORCE_CHANNEL, userId);
    return ['member','administrator','creator','owner'].includes(member.status);
  } catch (e) { return false; }
}

bot.start(async (ctx) => {
  if (!(await joined(ctx.from.id))) {
    const username = FORCE_CHANNEL.replace('@','');
    return ctx.reply('Please join our community first.', Markup.inlineKeyboard([
      [Markup.button.url('Join Community', `https://t.me/${username}`)],
      [Markup.button.callback('Check Join', 'check_join')]
    ]));
  }
  ctx.reply('Welcome! Choose an option:', menu);
});

bot.action('check_join', async (ctx) => {
  await ctx.answerCbQuery();
  if (await joined(ctx.from.id)) return ctx.reply('Verified! Main menu opened.', menu);
  ctx.reply('You still need to join the channel.');
});

bot.hears('Deposit', (ctx) => ctx.reply('Send payment screenshot or UPI TXN ID to admin.'));
bot.hears('Withdraw', (ctx) => ctx.reply('Send amount and UPI ID for withdrawal request.'));
bot.hears('Profile', (ctx) => ctx.reply(`Name: ${ctx.from.first_name}\nID: ${ctx.from.id}\nBalance: ₹0`));
bot.hears('Classic Ludo', (ctx) => ctx.reply('Classic Ludo coming soon.'));
bot.hears('Quick Ludo', (ctx) => ctx.reply('Quick Ludo coming soon.'));
bot.hears('Popular Ludo', (ctx) => ctx.reply('Popular Ludo coming soon.'));
bot.hears('Support', (ctx) => ctx.reply(`Contact support: ${SUPPORT_USERNAME}`));

bot.launch();
console.log('Bot running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
