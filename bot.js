/**
 * Toman Exchange Telegram Bot
 * Production-ready, lightweight, high-performance bot for Toman transactions and Exchange Assistant.
 * Fully compatible with GitHub & Render.com deployment.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const renderer = require('./renderer.js');

// 1. Health check HTTP server for Render.com
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), bot: 'Toman Exchange Bot' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Web health server listening on port ${PORT} for Render deployment`);
});

// 2. Bot Token Initialization
const token = process.env.BOT_TOKEN;
if (!token || token.trim() === '' || token.includes('123456789:ABCdef')) {
  console.warn('⚠️ BOT_TOKEN is not configured! Please set BOT_TOKEN in your .env or Render environment variables.');
}

const bot = new TelegramBot(token || 'dummy_token', {
  polling: Boolean(token && !token.includes('123456789:ABCdef'))
});

// 3. Persistent Data Storage
const DATA_FILE = path.join(__dirname, 'exchange_data.json');
let db = {
  users: {}, // { [chatId]: { lists: [...], activeListId: string, info: { name, phone, address } } }
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      db = JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error reading storage:', err.message);
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving storage:', err.message);
  }
}

loadData();

// 4. State & Session Management
// Pending actions for interactive dialogs: { type: 'ask_list' | 'ask_edit_field' | 'ask_search', data: ... }
const userSessions = new Map();

// Date helpers
function getPersianDateText() {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long'
    });
    const parts = formatter.formatToParts(now);
    const y = parts.find(p => p.type === 'year')?.value || '1403';
    const m = parts.find(p => p.type === 'month')?.value || '01';
    const d = parts.find(p => p.type === 'day')?.value || '01';
    const w = parts.find(p => p.type === 'weekday')?.value || 'شنبه';

    const timeFormatter = new Intl.DateTimeFormat('fa-IR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const time = timeFormatter.format(now);

    return {
      date: `${y}/${m}/${d}`,
      time: time,
      weekday: w,
      fullDate: `${y}/${m}/${d} ${w}`
    };
  } catch (e) {
    return { date: '۱۴۰۳/۰۷/۲۸', time: '۱۲:۰۰', weekday: 'شنبه', fullDate: '۱۴۰۳/۰۷/۲۸ شنبه' };
  }
}

// User Profile & List Helpers
function getUserState(chatId) {
  const id = String(chatId);
  if (!db.users[id]) {
    const listId = 'list_' + Date.now();
    db.users[id] = {
      activeListId: listId,
      lists: [
        {
          id: listId,
          name: 'لیست معاملات اصلی',
          code: 'L-101',
          createdAt: Date.now(),
          trades: []
        }
      ],
      info: {
        name: 'صرافی برادران',
        phone: '',
        address: ''
      }
    };
    saveData();
  }
  return db.users[id];
}

function getActiveList(chatId) {
  const state = getUserState(chatId);
  let list = state.lists.find(l => l.id === state.activeListId);
  if (!list && state.lists.length > 0) {
    list = state.lists[0];
    state.activeListId = list.id;
    saveData();
  }
  return list;
}

// 5. Persian Words to Numbers & Natural Language Parsing
const PERSIAN_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const CHAR_MAP = { 'ي': 'ی', 'ك': 'ک', 'ۀ': 'ه', 'ة': 'ه', 'ؤ': 'و', 'إ': 'ا', 'أ': 'ا', 'ئ': 'ی', '،': ',', '٫': '.', '٬': ',', '؍': ',' };

function normalizeText(text) {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/[\u064B-\u065F\u0670\u0640\u06D6-\u06ED]/g, '');
  let res = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (PERSIAN_DIGITS[ch] !== undefined) res += PERSIAN_DIGITS[ch];
    else if (CHAR_MAP[ch] !== undefined) res += CHAR_MAP[ch];
    else res += ch;
  }
  return res.replace(/[\s\u200B-\u200F\u202A-\u202E\u2060\uFEFF]+/g, ' ').trim();
}

function wordsToNumber(text) {
  const W_UNITS = {
    'صفر': 0, 'یک': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9,
    'ده': 10, 'یازده': 11, 'دوازده': 12, 'سیزده': 13, 'چهارده': 14, 'پانزده': 15, 'شانزده': 16, 'هفده': 17, 'هجده': 18, 'نوزده': 19,
    'بیست': 20, 'سی': 30, 'چهل': 40, 'پنجاه': 50, 'شصت': 60, 'هفتاد': 70, 'هشتاد': 80, 'نود': 90,
    'صد': 100, 'دویست': 200, 'سیصد': 300, 'چهارصد': 400, 'پانصد': 500, 'ششصد': 600, 'هفتصد': 700, 'هشتصد': 800, 'نهصد': 900
  };
  const W_MULT = { 'هزار': 1000, 'ملیون': 1000000, 'میلیون': 1000000, 'م': 1000000, 'میلیارد': 1000000000, 'همت': 1000000000000 };

  let s = normalizeText(text);
  const words = s.split(' ');
  let converted = [];
  let tempSum = 0;
  let acc = 0;
  let inNumber = false;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'و' && inNumber) continue;

    if (W_UNITS[w] !== undefined) {
      tempSum += W_UNITS[w];
      inNumber = true;
    } else if (W_MULT[w] !== undefined) {
      const mult = W_MULT[w];
      if (tempSum === 0) tempSum = 1;
      acc += tempSum * mult;
      tempSum = 0;
      inNumber = true;
    } else {
      if (inNumber) {
        converted.push(String(acc + tempSum));
        acc = 0;
        tempSum = 0;
        inNumber = false;
      }
      converted.push(w);
    }
  }

  if (inNumber) {
    converted.push(String(acc + tempSum));
  }
  return converted.join(' ');
}

// Convert Toman to USD calculation (1:1 with Finance.kt)
function convertTomanToUsd(toman, rate) {
  if (!rate || rate <= 0) return 0;
  // If rate is entered like 25600000 (Toman per $1000) or 25600:
  // Android logic: convert("usd", toman, rate)
  // When rate > 1000: (toman * 1000) / rate
  // When rate <= 1000: toman / rate
  const t = Number(toman) || 0;
  const r = Number(rate) || 0;
  if (r <= 0) return 0;

  if (r > 1000) {
    return Math.round((t * 1000) / r);
  } else {
    return Math.round(t / r);
  }
}

// Trade Parser
function parseTrade(rawText, availableLists = []) {
  let text = wordsToNumber(normalizeText(rawText));

  // 1. Check for target list name
  let targetListName = null;
  for (const L of availableLists) {
    const normL = normalizeText(L.name);
    const regex1 = new RegExp(`(?:در\\s+لیست|به\\s+لیست|از\\s+لیست|لیست)\\s+${normL}\\b`, 'i');
    const regex2 = new RegExp(`^لیست\\s*[:=]?\\s*${normL}\\s*[:,-]`, 'i');
    if (regex1.test(text)) {
      targetListName = L.name;
      text = text.replace(regex1, ' ').trim();
      break;
    } else if (regex2.test(text)) {
      targetListName = L.name;
      text = text.replace(regex2, ' ').trim();
      break;
    }
  }

  // 2. Province / City
  let province = '';
  const provMatch = text.match(/(?:ولایت|شهر)\s+([^\s\d]+)/);
  if (provMatch) {
    province = provMatch[1];
    text = text.replace(provMatch[0], ' ').trim();
  }

  // 3. Side (Buy / Sell)
  let side = null;
  const buyWords = ['خرید', 'خریدم', 'خریده', 'خریداری', 'خریدات', 'برداشت', 'buy'];
  const sellWords = ['فروش', 'فروختم', 'فروخته', 'فروخت', 'فروشات', 'واریز', 'sell'];

  for (const bw of buyWords) {
    const r = new RegExp(`\\b${bw}\\b`, 'i');
    if (r.test(text)) {
      side = 'buy';
      text = text.replace(r, ' ').trim();
      break;
    }
  }
  if (!side) {
    for (const sw of sellWords) {
      const r = new RegExp(`\\b${sw}\\b`, 'i');
      if (r.test(text)) {
        side = 'sell';
        text = text.replace(r, ' ').trim();
        break;
      }
    }
  }

  // 4. Multipliers in amounts (e.g., "2 م" or "2m" or "500 هزار")
  text = text.replace(/(\d+)\s*(?:م|میلیون|m)\b/gi, (m, g) => String(Number(g) * 1000000));
  text = text.replace(/(\d+)\s*(?:هزار|k)\b/gi, (m, g) => String(Number(g) * 1000));
  text = text.replace(/(\d+)\s*(?:میلیارد|b)\b/gi, (m, g) => String(Number(g) * 1000000000));

  // 5. Extract Numbers (Amount and Rate)
  const numbers = [];
  const numRegex = /\b\d+(?:\.\d+)?\b/g;
  let match;
  while ((match = numRegex.exec(text)) !== null) {
    numbers.push(Number(match[0]));
  }

  let toman = null;
  let rate = null;

  if (numbers.length >= 2) {
    // If rate keyword preceded a number
    const rateMatch = text.match(/(?:نرخ|فی|قیمت|fee|rate)\s*[:=]?\s*(\d+(?:\.\d+)?)/);
    if (rateMatch) {
      rate = Number(rateMatch[1]);
      const remainingNums = numbers.filter(n => n !== rate);
      if (remainingNums.length > 0) toman = remainingNums[0];
    } else {
      // General heuristic: rate in Iranian exchange is typically > 10,000,000 or ~25,000,000 for Toman/USD
      // If one number looks like 25600000 or 25500, it can be rate
      if (numbers[1] >= 10000 && numbers[0] < numbers[1]) {
        toman = numbers[0];
        rate = numbers[1];
      } else {
        toman = numbers[0];
        rate = numbers[1];
      }
    }
  } else if (numbers.length === 1) {
    toman = numbers[0];
  }

  // 6. Customer Name
  // Remove numbers, stop words, extra spaces to extract the contact name
  let name = text
    .replace(/\b\d+(?:\.\d+)?\b/g, '')
    .replace(/(?:تومان|دالر|دلار|افغانی|نرخ|فی|قیمت|مبلغ|حساب|به|از|برای|در|با|آقای|اقای|حاجی|حاج)\b/g, '')
    .replace(/[\s\-_:,]+/g, ' ')
    .trim();

  if (!name && rawText.includes(':')) {
    const parts = rawText.split(':');
    name = parts[0].trim();
  }

  if (!name) name = 'مشتری';

  return {
    isTrade: Boolean(side && toman),
    side: side || 'buy',
    name,
    toman: toman || 0,
    rate: rate || 0,
    province,
    targetListName
  };
}

// 6. Search Engine (Direct port of Search.kt)
function searchAll(chatId, query) {
  const state = getUserState(chatId);
  const qNorm = normalizeText(query).toLowerCase();
  const qCompact = qNorm.replace(/\s+/g, '');
  if (!qCompact) return [];

  const results = [];

  for (const list of state.lists) {
    const listHit = normalizeText(list.name).toLowerCase().includes(qNorm) ||
                    (list.code && list.code.toLowerCase().includes(qNorm));

    const matchedTrades = [];
    (list.trades || []).forEach((t, idx) => {
      const nameHit = normalizeText(t.name).toLowerCase().includes(qNorm);
      const provHit = t.province && normalizeText(t.province).toLowerCase().includes(qNorm);
      const tomanStr = String(t.toman);
      const usdStr = String(t.converted);
      const rateStr = String(t.rate);
      const numHit = tomanStr.includes(qCompact) || usdStr.includes(qCompact) || rateStr.includes(qCompact);

      if (nameHit || provHit || numHit) {
        matchedTrades.push({ trade: t, index: idx + 1 });
      }
    });

    if (listHit || matchedTrades.length > 0) {
      results.push({
        list,
        listHit,
        matchedTrades
      });
    }
  }

  return results;
}

// 7. Interactive Keyboards & UI
function getMainMenuKeyboard(chatId) {
  const activeList = getActiveList(chatId);
  const listName = activeList ? activeList.name : 'انتخاب نشده';

  return {
    reply_markup: {
      keyboard: [
        [{ text: `📁 لیست فعلی: ${listName}` }],
        [{ text: '➕ ثبت سریع معامله' }, { text: '🔍 جستجوی معاملات' }],
        [{ text: '🖼️ خروجی تصویر' }, { text: '📄 خروجی PDF' }],
        [{ text: '📋 خروجی متنی' }, { text: '💬 ارسال به واتساپ' }],
        [{ text: '📊 خلاصه و سر به سر' }, { text: '⚙️ مدیریت لیست‌ها' }],
        [{ text: 'ℹ️ راهنمای دستیار صرافی' }]
      ],
      resize_keyboard: true,
      persistent: true
    }
  };
}

// 8. Bot Handlers & Command Router
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : '';
  if (!text) return;

  const state = getUserState(chatId);
  const activeList = getActiveList(chatId);

  // Check if user is in an active session (e.g. editing a field or searching)
  const session = userSessions.get(chatId);
  if (session) {
    if (session.type === 'search_query') {
      userSessions.delete(chatId);
      handleSearchExecution(chatId, text);
      return;
    } else if (session.type === 'edit_field') {
      userSessions.delete(chatId);
      handleEditFieldExecution(chatId, session, text);
      return;
    } else if (session.type === 'create_list_name') {
      userSessions.delete(chatId);
      handleCreateList(chatId, text);
      return;
    }
  }

  // Basic Commands
  if (text === '/start' || text === 'شروع') {
    const welcome = `سلام! به **دستیار هوشمند و ربات معاملات تومان صرافی** خوش آمدید. 🤖

📌 لیست فعال شما: **${activeList.name}** (${activeList.code || 'بدون کد'})

💡 **نحوه ثبت معامله:**
می‌توانید جمله معامله را تایپ کنید:
مثال: \`خرید احمد ۲ م ۲۵۶۰۰۰۰\`
یا: \`فروش رضا ۵۰۰ هزار ۲۵۵۰۰ در لیست حامد\`

اگر نام لیست را ذکر نکنید، دکمه‌های انتخاب لیست به شما نمایش داده می‌شود.

🔍 همچنین می‌توانید جستجو کنید، خروجی عکس یا PDF بگیرید، یا معاملات را حذف و ویرایش نمایید.`;

    await bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown', ...getMainMenuKeyboard(chatId) });
    return;
  }

  if (text === 'ℹ️ راهنمای دستیار صرافی' || text === '/help') {
    const help = `📖 **راهنمای کامل دستیار و ربات صرافی:**

۱. **ثبت معامله صوتی یا متنی:**
- \`خرید احمد ۲ م ۲۵۶۰۰۰۰\` (ثبت در لیست فعال یا انتخاب از لیست‌ها)
- \`فروش محمود ۱۰۰ م ۲۵۵۰۰ در لیست دوم\` (ثبت مستقیم در لیست مشخص شده)
- \`خرید صفی‌الله ۵ م ۲۵۴۵۰ ولایت هرات\`

۲. **ویرایش و حذف معامله:**
- ارسال دستور: \`حذف ردیف ۱\` یا \`ویرایش ردیف ۱\`
- یا کپی کردن سطر معامله و نوشتن «حذف» یا «ویرایش» در خط بعد
- یا استفاده از دکمه‌های شیشه‌ای زیر هر معامله

۳. **جستجوی پیشرفته:**
- ارسال دستور: \`جستجو احمد\` یا \`جستجو 2560000\`
- جستجوی آنی در تمامی لیست‌ها بر اساس نام، مبلغ، نرخ و ولایت

۴. **خروجی‌ها:**
- 🖼️ **خروجی تصویر:** سند استاندارد با فونت وزیرمتن و کات دقیق (بدون حاشیه خالی سفید)
- 📄 **خروجی PDF:** فایل با کیفیت بالا آماده پرینت A4
- 📋 **خروجی متنی:** مطابق فرمت رسمی صرافی برای کپی
- 💬 **واتساپ:** لینک ارسال مستقیم پیام صورتحساب`;

    await bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
    return;
  }

  // Quick Action Buttons
  if (text.startsWith('📁 لیست فعلی:')) {
    sendListDetails(chatId, activeList);
    return;
  }

  if (text === '🔍 جستجوی معاملات') {
    userSessions.set(chatId, { type: 'search_query' });
    await bot.sendMessage(chatId, '🔍 لطفاً عبارت مورد نظر برای جستجو (نام طرف معامله، مبلغ، نرخ یا کد لیست) را وارد کنید:\n\n(برای لغو، کلمه «لغو» را بفرستید)');
    return;
  }

  if (text === '➕ ثبت سریع معامله') {
    await bot.sendMessage(chatId, `📝 لطفاً جزئیات معامله را ارسال کنید:\n\nنمونه:\n\`خرید احمد ۲ م ۲۵۶۰۰۰۰\`\n\`فروش محمود ۵۰۰ هزار ۲۵۵۰۰ در لیست اول\``, { parse_mode: 'Markdown' });
    return;
  }

  if (text === '🖼️ خروجی تصویر') {
    await sendImageReport(chatId, activeList);
    return;
  }

  if (text === '📄 خروجی PDF') {
    await sendPdfReport(chatId, activeList);
    return;
  }

  if (text === '📋 خروجی متنی') {
    await sendTextReport(chatId, activeList);
    return;
  }

  if (text === '💬 ارسال به واتساپ') {
    await sendWhatsAppShare(chatId, activeList);
    return;
  }

  if (text === '📊 خلاصه و سر به سر') {
    await sendSummaryReport(chatId, activeList);
    return;
  }

  if (text === '⚙️ مدیریت لیست‌ها') {
    await sendListManagement(chatId);
    return;
  }

  // Check for search intent in text: e.g. "جستجو احمد" or "پیدا کن رضا"
  const searchMatch = text.match(/^(?:جستجو|پیدا\s*کن|بگرد|search)\s+(.+)$/i);
  if (searchMatch) {
    handleSearchExecution(chatId, searchMatch[1].trim());
    return;
  }

  // Check for delete intent: e.g. "حذف معامله ۱" or "حذف ردیف ۲" or pasting a deal line and writing "حذف"
  if (text.includes('حذف') || text.includes('پاک')) {
    const isDeleteHandled = await handleDeleteIntent(chatId, text, activeList);
    if (isDeleteHandled) return;
  }

  // Check for edit intent: e.g. "ویرایش معامله ۱" or "اصلاح ردیف ۱"
  if (text.includes('ویرایش') || text.includes('اصلاح')) {
    const isEditHandled = await handleEditIntent(chatId, text, activeList);
    if (isEditHandled) return;
  }

  // Parse as natural language deal
  const parsed = parseTrade(text, state.lists);
  if (parsed.isTrade) {
    handleParsedDeal(chatId, parsed);
    return;
  }

  // If unclear, provide friendly guide
  await bot.sendMessage(chatId, `دستور شما دریافت شد اما مشخصات معامله نامفهوم بود. 

می‌توانید به سادگی بنویسید:
\`خرید احمد ۲ م ۲۵۶۰۰۰۰\`
یا از منوی پایین گزینه مورد نظر را لمس فرمایید.`, { parse_mode: 'Markdown' });
});

// 9. Deal Processing & List Prompting
async function handleParsedDeal(chatId, parsed) {
  const state = getUserState(chatId);
  const convertedUsd = convertTomanToUsd(parsed.toman, parsed.rate);

  // If rate was not provided, prompt for rate
  if (!parsed.rate || parsed.rate <= 0) {
    await bot.sendMessage(chatId, `⚠️ نرخ معامله برای «${parsed.name}» مشخص نشده است.\nلطفاً دستور را همراه با نرخ بفرستید، مثلاً:\n\`${parsed.side === 'buy' ? 'خرید' : 'فروش'} ${parsed.name} ${parsed.toman} ۲۵۶۰۰۰۰\``, { parse_mode: 'Markdown' });
    return;
  }

  const dealSummaryText = `📋 **معامله تشخیص داده شد:**
• نوع معامله: **${parsed.side === 'buy' ? '🟢 خرید' : '🔴 فروش'}**
• طرف معامله: **${parsed.name}**
• مبلغ: **${renderer.F(parsed.toman)} تومان**
• نرخ: **${renderer.F2(parsed.rate)}**
• معادل: **${renderer.F(convertedUsd)} دالر**${parsed.province ? `\n• ولایت/شهر: **${parsed.province}**` : ''}`;

  // If user explicitly named a list in the message
  if (parsed.targetListName) {
    const target = state.lists.find(l => normalizeText(l.name).toLowerCase() === normalizeText(parsed.targetListName).toLowerCase());
    if (target) {
      saveDealToList(chatId, target.id, parsed, convertedUsd);
      return;
    }
  }

  // If NO list specified, per user request:
  // "وقتی که معامله رو براش میگم و اگه اسم لیست رو تو معامله گفتم که تو همون لیست ثبت کنه و اکه نگفتم لیست هارو نمایش بده و با انتخاب من تو لیست دلخواه ثبت بکنه"
  // Save pending deal in session and show list buttons
  const pendingId = 'deal_' + Date.now();
  userSessions.set(chatId, {
    type: 'select_list_for_deal',
    deal: { ...parsed, converted: convertedUsd, id: pendingId }
  });

  const buttons = state.lists.map(l => {
    const isAct = l.id === state.activeListId;
    return [{
      text: `${isAct ? '⭐ ' : '📁 '}لیست: ${l.name} (${l.trades ? l.trades.length : 0} معامله)`,
      callback_data: `save_to_list:${l.id}`
    }];
  });

  buttons.push([
    { text: '➕ ثبت در لیست جدید', callback_data: 'deal_create_new_list' },
    { text: '❌ انصراف', callback_data: 'cancel_pending_deal' }
  ]);

  await bot.sendMessage(chatId, `${dealSummaryText}\n\n👇 **لطفاً لیست مورد نظر برای ثبت را انتخاب کنید:**`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

function saveDealToList(chatId, listId, parsed, convertedUsd) {
  const state = getUserState(chatId);
  const target = state.lists.find(l => l.id === listId);
  if (!target) return;

  const newTrade = {
    id: 'tr_' + Date.now(),
    side: parsed.side,
    name: parsed.name,
    toman: parsed.toman,
    rate: parsed.rate,
    converted: convertedUsd,
    province: parsed.province || '',
    createdAt: Date.now()
  };

  target.trades = target.trades || [];
  target.trades.push(newTrade);
  saveData();

  const tradeIndex = target.trades.length;
  const reply = `✅ **معامله با موفقیت در «${target.name}» ثبت شد:**

ردیف: **#${tradeIndex}**
طرف معامله: **${newTrade.name}**
نوع: **${newTrade.side === 'buy' ? '🟢 خرید' : '🔴 فروش'}**
مبلغ: **${renderer.F(newTrade.toman)} تومان**
نرخ: **${renderer.F2(newTrade.rate)}**
معادل: **${renderer.F(newTrade.converted)} دالر**`;

  bot.sendMessage(chatId, reply, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✏️ ویرایش این معامله', callback_data: `edit_trade:${target.id}:${newTrade.id}` },
          { text: '🗑️ حذف این معامله', callback_data: `del_trade:${target.id}:${newTrade.id}` }
        ],
        [
          { text: '🖼️ دریافت عکس سند', callback_data: `get_image:${target.id}` },
          { text: '📄 دریافت PDF', callback_data: `get_pdf:${target.id}` }
        ]
      ]
    }
  });
}

// 10. Search Execution
async function handleSearchExecution(chatId, query) {
  const results = searchAll(chatId, query);
  if (results.length === 0) {
    await bot.sendMessage(chatId, `🔍 نتیجه‌ای برای جستجوی «**${query}**» یافت نشد.`, { parse_mode: 'Markdown' });
    return;
  }

  let text = `🔍 **نتایج جستجو برای: «${query}»**\n━━━━━━━━━━━━━━━━━━━━\n`;
  const inlineButtons = [];

  results.forEach(res => {
    text += `\n📁 **لیست: ${res.list.name}** (${res.list.code || ''})\n`;
    if (res.matchedTrades.length > 0) {
      res.matchedTrades.forEach(item => {
        const t = item.trade;
        const sideIcon = t.side === 'buy' ? '🟢 خرید' : '🔴 فروش';
        text += `• ردیف ${item.index}: ${sideIcon} **${t.name}** | ${renderer.F(t.toman)} تومان | نرخ: ${renderer.F2(t.rate)} | معادل: ${renderer.F(t.converted)} دالر\n`;
        inlineButtons.push([
          { text: `✏️ ویرایش #${item.index}`, callback_data: `edit_trade:${res.list.id}:${t.id}` },
          { text: `🗑️ حذف #${item.index}`, callback_data: `del_trade:${res.list.id}:${t.id}` }
        ]);
      });
    } else if (res.listHit) {
      text += `(نام یا کد این لیست مطابق عبارت بود)\n`;
    }
  });

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: inlineButtons.length > 0 ? { inline_keyboard: inlineButtons.slice(0, 8) } : undefined
  });
}

// 11. Delete and Edit Intent Parsers
async function handleDeleteIntent(chatId, text, activeList) {
  // Support: "حذف ردیف ۱" or "حذف معامله ۱" or pasting deal line + "حذف"
  const rowMatch = text.match(/(?:حذف|پاک)\s*(?:معامله|ردیف|شماره)?\s*(\d+)/i);
  if (rowMatch) {
    const rowNum = parseInt(rowMatch[1], 10);
    if (activeList && activeList.trades && activeList.trades[rowNum - 1]) {
      const trade = activeList.trades[rowNum - 1];
      activeList.trades.splice(rowNum - 1, 1);
      saveData();
      await bot.sendMessage(chatId, `🗑️ معامله ردیف **#${rowNum}** (${trade.name} - ${renderer.F(trade.toman)} تومان) با موفقیت حذف گردید.`, { parse_mode: 'Markdown' });
      return true;
    }
  }

  // If user pasted full trade info and appended "حذف"
  if (text.endsWith('حذف') || text.startsWith('حذف')) {
    const words = normalizeText(text).split(' ');
    // Search by name in active list
    for (let i = (activeList.trades || []).length - 1; i >= 0; i--) {
      const t = activeList.trades[i];
      if (words.includes(normalizeText(t.name))) {
        activeList.trades.splice(i, 1);
        saveData();
        await bot.sendMessage(chatId, `🗑️ معامله متعلق به **${t.name}** با موفقیت حذف شد.`, { parse_mode: 'Markdown' });
        return true;
      }
    }
  }
  return false;
}

async function handleEditIntent(chatId, text, activeList) {
  const rowMatch = text.match(/(?:ویرایش|اصلاح)\s*(?:معامله|ردیف|شماره)?\s*(\d+)/i);
  if (rowMatch) {
    const rowNum = parseInt(rowMatch[1], 10);
    if (activeList && activeList.trades && activeList.trades[rowNum - 1]) {
      const trade = activeList.trades[rowNum - 1];
      sendEditTradeMenu(chatId, activeList.id, trade.id, rowNum);
      return true;
    }
  }
  return false;
}

function sendEditTradeMenu(chatId, listId, tradeId, rowNum) {
  const state = getUserState(chatId);
  const list = state.lists.find(l => l.id === listId);
  if (!list) return;
  const trade = (list.trades || []).find(t => t.id === tradeId);
  if (!trade) return;

  const idx = rowNum || (list.trades.indexOf(trade) + 1);
  const msgText = `✏️ **فرم ویرایش معامله (ردیف #${idx}):**

• طرف معامله: **${trade.name}**
• نوع: **${trade.side === 'buy' ? '🟢 خرید' : '🔴 فروش'}**
• مبلغ: **${renderer.F(trade.toman)} تومان**
• نرخ: **${renderer.F2(trade.rate)}**
• معادل: **${renderer.F(trade.converted)} دالر**${trade.province ? `\n• ولایت: **${trade.province}**` : ''}

کدام فیلد را می‌خواهید ویرایش کنید؟`;

  bot.sendMessage(chatId, msgText, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '👤 تغییر نام', callback_data: `edit_field:${listId}:${tradeId}:name` },
          { text: '💰 تغییر مبلغ تومان', callback_data: `edit_field:${listId}:${tradeId}:toman` }
        ],
        [
          { text: '📈 تغییر نرخ', callback_data: `edit_field:${listId}:${tradeId}:rate` },
          { text: '🔄 تغییر جهت (خرید/فروش)', callback_data: `toggle_side:${listId}:${tradeId}` }
        ],
        [
          { text: '🗑️ حذف معامله', callback_data: `del_trade:${listId}:${tradeId}` },
          { text: '🔙 بازگشت به لیست', callback_data: `view_list:${listId}` }
        ]
      ]
    }
  });
}

function handleEditFieldExecution(chatId, session, newText) {
  const { listId, tradeId, field } = session;
  const state = getUserState(chatId);
  const list = state.lists.find(l => l.id === listId);
  if (!list) return;
  const trade = (list.trades || []).find(t => t.id === tradeId);
  if (!trade) return;

  const val = normalizeText(newText);
  if (field === 'name') {
    trade.name = val;
  } else if (field === 'toman') {
    const num = wordsToNumber(val).replace(/[^\d.]/g, '');
    const amount = Number(num);
    if (amount > 0) {
      trade.toman = amount;
      trade.converted = convertTomanToUsd(trade.toman, trade.rate);
    }
  } else if (field === 'rate') {
    const num = wordsToNumber(val).replace(/[^\d.]/g, '');
    const rateVal = Number(num);
    if (rateVal > 0) {
      trade.rate = rateVal;
      trade.converted = convertTomanToUsd(trade.toman, trade.rate);
    }
  }

  saveData();
  bot.sendMessage(chatId, `✅ فیلد با موفقیت به‌روزرسانی شد.`);
  sendEditTradeMenu(chatId, listId, tradeId);
}

// 12. Callback Query Handler (Inline Keyboards)
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  try {
    if (data.startsWith('save_to_list:')) {
      const listId = data.split(':')[1];
      const session = userSessions.get(chatId);
      if (session && session.deal) {
        saveDealToList(chatId, listId, session.deal, session.deal.converted);
        userSessions.delete(chatId);
      }
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'deal_create_new_list') {
      userSessions.set(chatId, { type: 'create_list_name' });
      await bot.sendMessage(chatId, '➕ لطفاً نام لیست جدید را بنویسید:');
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'cancel_pending_deal') {
      userSessions.delete(chatId);
      await bot.sendMessage(chatId, '❌ ثبت معامله لغو شد.');
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('edit_trade:')) {
      const [, listId, tradeId] = data.split(':');
      sendEditTradeMenu(chatId, listId, tradeId);
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('del_trade:')) {
      const [, listId, tradeId] = data.split(':');
      const state = getUserState(chatId);
      const list = state.lists.find(l => l.id === listId);
      if (list) {
        list.trades = (list.trades || []).filter(t => t.id !== tradeId);
        saveData();
        await bot.sendMessage(chatId, '🗑️ معامله با موفقیت حذف گردید.');
      }
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('edit_field:')) {
      const [, listId, tradeId, field] = data.split(':');
      const fieldNames = { name: 'نام جدید طرف معامله', toman: 'مبلغ جدید به تومان', rate: 'نرخ جدید' };
      userSessions.set(chatId, { type: 'edit_field', listId, tradeId, field });
      await bot.sendMessage(chatId, `لطفاً **${fieldNames[field] || field}** را ارسال فرمایید:`, { parse_mode: 'Markdown' });
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('toggle_side:')) {
      const [, listId, tradeId] = data.split(':');
      const state = getUserState(chatId);
      const list = state.lists.find(l => l.id === listId);
      const trade = list ? (list.trades || []).find(t => t.id === tradeId) : null;
      if (trade) {
        trade.side = trade.side === 'buy' ? 'sell' : 'buy';
        saveData();
        sendEditTradeMenu(chatId, listId, tradeId);
      }
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('get_image:')) {
      const listId = data.split(':')[1];
      const state = getUserState(chatId);
      const list = state.lists.find(l => l.id === listId) || getActiveList(chatId);
      await sendImageReport(chatId, list);
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('get_pdf:')) {
      const listId = data.split(':')[1];
      const state = getUserState(chatId);
      const list = state.lists.find(l => l.id === listId) || getActiveList(chatId);
      await sendPdfReport(chatId, list);
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('view_list:')) {
      const listId = data.split(':')[1];
      const state = getUserState(chatId);
      const list = state.lists.find(l => l.id === listId) || getActiveList(chatId);
      sendListDetails(chatId, list);
      bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('set_active_list:')) {
      const listId = data.split(':')[1];
      const state = getUserState(chatId);
      const target = state.lists.find(l => l.id === listId);
      if (target) {
        state.activeListId = target.id;
        saveData();
        await bot.sendMessage(chatId, `✅ لیست فعال به «**${target.name}**» تغییر یافت.`, {
          parse_mode: 'Markdown',
          ...getMainMenuKeyboard(chatId)
        });
      }
      bot.answerCallbackQuery(query.id);
      return;
    }

    bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error('Callback query error:', err);
    bot.answerCallbackQuery(query.id);
  }
});

// 13. Reports Generators (Image, PDF, Text, WhatsApp)
async function sendImageReport(chatId, list) {
  const statusMsg = await bot.sendMessage(chatId, '⏳ در حال ساخت تصویر سند استاندارد با کات دقیق...');
  try {
    const state = getUserState(chatId);
    const dateText = getPersianDateText();
    const pngBuffer = renderer.renderReportImage(list, state.info, dateText);

    await bot.sendPhoto(chatId, pngBuffer, {
      caption: `🖼️ **سند خروجی معاملات:** ${list.name}\n📅 تاریخ: ${dateText.fullDate}`,
      parse_mode: 'Markdown'
    });

    try {
      await bot.deleteMessage(chatId, statusMsg.message_id);
    } catch (_) {}
  } catch (err) {
    console.error('Error generating image:', err);
    await bot.sendMessage(chatId, '❌ خطا در تولید تصویر گزارش: ' + err.message);
  }
}

async function sendPdfReport(chatId, list) {
  const statusMsg = await bot.sendMessage(chatId, '⏳ در حال آماده‌سازی فایل PDF استاندارد A4...');
  try {
    const state = getUserState(chatId);
    const dateText = getPersianDateText();
    const pdfBuffer = await renderer.renderReportPdf(list, state.info, dateText);

    const filename = `Report_${(list.name || 'Exchange').replace(/[\s/\\:*?"<>|]+/g, '_')}.pdf`;
    await bot.sendDocument(chatId, pdfBuffer, {
      caption: `📄 **گزارش PDF رسمی:** ${list.name}\n📅 تاریخ: ${dateText.fullDate}`,
      parse_mode: 'Markdown'
    }, {
      filename,
      contentType: 'application/pdf'
    });

    try {
      await bot.deleteMessage(chatId, statusMsg.message_id);
    } catch (_) {}
  } catch (err) {
    console.error('Error generating PDF:', err);
    await bot.sendMessage(chatId, '❌ خطا در تهیه PDF گزارش: ' + err.message);
  }
}

async function sendTextReport(chatId, list) {
  const dateText = getPersianDateText();
  const text = renderer.generateTextReport(list, dateText);
  await bot.sendMessage(chatId, `📋 **گزارش متنی معاملات صرافی:**\n\n\`\`\`\n${text}\n\`\`\``, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '💬 اشتراک در واتساپ', url: `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}` }],
        [{ text: '🖼️ دریافت عکس', callback_data: `get_image:${list.id}` }, { text: '📄 دریافت PDF', callback_data: `get_pdf:${list.id}` }]
      ]
    }
  });
}

async function sendWhatsAppShare(chatId, list) {
  const dateText = getPersianDateText();
  const text = renderer.generateTextReport(list, dateText);
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;

  await bot.sendMessage(chatId, `💬 **اشتراک‌گذاری در واتساپ:**\n\nبرای ارسال مستقیم متن گزارش به واتساپ، دکمه زیر را لمس نمایید یا متن را کپی کنید:\n\n\`\`\`\n${text}\n\`\`\``, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🟢 باز کردن واتساپ و ارسال متن', url: waUrl }]
      ]
    }
  });
}

async function sendSummaryReport(chatId, list) {
  const fin = renderer.calculateList(list.trades);
  let statusText = 'یر به یر (بدون سود و زیان)';
  if (fin.profit > 0) statusText = `🟢 **مفاد:** ${renderer.F(fin.profit)} دالر`;
  else if (fin.profit < 0) statusText = `🔴 **ضرر:** ${renderer.F(Math.abs(fin.profit))} دالر`;

  const msg = `📊 **خلاصه وضعیت مالی لیست:** ${list.name}

🔵 **خریدات (${fin.buy.count} معامله):**
• مجموع تومان: **${renderer.F(fin.buy.toman)}**
• فی اوسط خرید: **${renderer.F(fin.buy.avg)}**
• مجموع دالر: **${renderer.F(fin.buy.total)} دالر**

🟠 **فروشات (${fin.sell.count} معامله):**
• مجموع تومان: **${renderer.F(fin.sell.toman)}**
• فی اوسط فروش: **${renderer.F(fin.sell.avg)}**
• مجموع دالر: **${renderer.F(fin.sell.total)} دالر**

━━━━━━━━━━━━━━━━━━━━
⚖️ **وضعیت نهایی:** ${statusText}`;

  await bot.sendMessage(chatId, msg, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🖼️ دریافت عکس سند', callback_data: `get_image:${list.id}` }, { text: '📄 دریافت PDF', callback_data: `get_pdf:${list.id}` }]
      ]
    }
  });
}

function sendListDetails(chatId, list) {
  const trades = list.trades || [];
  if (trades.length === 0) {
    bot.sendMessage(chatId, `📁 لیست **${list.name}** در حال حاضر خالی است.\n\nبرای ثبت معامله دستور ارسال کنید، مثلاً:\n\`خرید احمد ۲ م ۲۵۶۰۰۰۰\``, { parse_mode: 'Markdown' });
    return;
  }

  let text = `📁 **معاملات لیست: ${list.name}** (تعداد: ${trades.length})\n━━━━━━━━━━━━━━━━━━━━\n`;
  const inlineButtons = [];

  trades.forEach((t, i) => {
    const idx = i + 1;
    const sideIcon = t.side === 'buy' ? '🟢 خرید' : '🔴 فروش';
    text += `**#${idx}** ${sideIcon} **${t.name}**\n• ${renderer.F(t.toman)} تومان | نرخ: ${renderer.F2(t.rate)} | معادل: ${renderer.F(t.converted)} دالر\n\n`;

    if (inlineButtons.length < 6) {
      inlineButtons.push([
        { text: `✏️ ویرایش #${idx}`, callback_data: `edit_trade:${list.id}:${t.id}` },
        { text: `🗑️ حذف #${idx}`, callback_data: `del_trade:${list.id}:${t.id}` }
      ]);
    }
  });

  bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: inlineButtons }
  });
}

async function sendListManagement(chatId) {
  const state = getUserState(chatId);
  const buttons = state.lists.map(l => {
    const isAct = l.id === state.activeListId;
    return [{
      text: `${isAct ? '⭐ (فعال) ' : ''}${l.name} (${l.trades ? l.trades.length : 0} معامله)`,
      callback_data: `set_active_list:${l.id}`
    }];
  });

  buttons.push([{ text: '➕ ایجاد لیست جدید', callback_data: 'deal_create_new_list' }]);

  await bot.sendMessage(chatId, `⚙️ **مدیریت لیست‌های معاملات:**\nبرای تغییر لیست فعال، روی نام لیست مورد نظر ضربه بزنید:`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

function handleCreateList(chatId, name) {
  const state = getUserState(chatId);
  const trimmed = name.trim() || 'لیست جدید';
  const newList = {
    id: 'list_' + Date.now(),
    name: trimmed,
    code: 'L-' + (state.lists.length + 101),
    createdAt: Date.now(),
    trades: []
  };

  state.lists.push(newList);
  state.activeListId = newList.id;
  saveData();

  bot.sendMessage(chatId, `✅ لیست جدید «**${newList.name}**» ایجاد گردید و به عنوان لیست فعال تنظیم شد.`, {
    parse_mode: 'Markdown',
    ...getMainMenuKeyboard(chatId)
  });
}

console.log('🤖 Toman Exchange Telegram Bot engine loaded successfully!');
