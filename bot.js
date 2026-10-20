/**
 * Toman Exchange Telegram Bot
 * Highly optimized, production-ready bot for Toman transactions, natural language assistant,
 * voice command processing, advanced search, and high-fidelity reports.
 * 100% Self-contained for easy GitHub upload & Render deployment.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const TelegramBot = require('node-telegram-bot-api');
const renderer = require('./renderer.js');

// 1. Render Health Check HTTP Server
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

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`Port ${PORT} is in use; server proceeding.`);
  } else {
    console.error('Server error:', err.message);
  }
});

server.listen(PORT, () => {
  console.log(`Render health check server listening on port ${PORT}`);
});

// 2. Telegram Bot Client
const token = process.env.BOT_TOKEN;
if (!token || token.trim() === '' || token.includes('123456789:ABCdef')) {
  console.warn('⚠️ BOT_TOKEN is not configured! Set BOT_TOKEN in .env or Render environment.');
}

const bot = new TelegramBot(token || 'dummy_token', {
  polling: Boolean(token && !token.includes('123456789:ABCdef'))
});

// 3. Persistent Data Storage
const DATA_FILE = path.join(__dirname, 'exchange_data.json');
let db = { users: {} };

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
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

// Active interactive sessions: Map<chatId, SessionData>
const userSessions = new Map();

// Helper: Persian Date and Time
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

// User state and active list helpers
function getUserState(chatId) {
  const id = String(chatId);
  if (!db.users[id]) {
    const defaultListId = 'list_' + Date.now();
    db.users[id] = {
      activeListId: defaultListId,
      lists: [
        {
          id: defaultListId,
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

// 4. Robust Persian Text Normalization and Natural Language Parser
const PERSIAN_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
const CHAR_MAP = { 'ي': 'ی', 'ك': 'ک', 'ۀ': 'ه', 'ة': 'ه', 'ؤ': 'و', 'إ': 'ا', 'أ': 'ا', 'ئ': 'ی', '،': ',', '٫': '.', '٬': ',', '؍': ',' };

function normalizeText(text) {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/[\u064B-\u065F\u0670\u0640]/g, '');
  let res = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (PERSIAN_DIGITS[ch] !== undefined) res += PERSIAN_DIGITS[ch];
    else if (CHAR_MAP[ch] !== undefined) res += CHAR_MAP[ch];
    else res += ch;
  }
  return res
    .replace(/[\u200c\u200d\u200e\u200f\u00a0]/g, ' ')
    .replace(/[\s\-_]+/g, ' ')
    .trim()
    .toLowerCase();
}

const W_UNITS = {
  'صفر': 0, 'یک': 1, 'يك': 1, 'دو': 2, 'سه': 3, 'چهار': 4,
  'پنج': 5, 'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9,
  'ده': 10, 'یازده': 11, 'دوازده': 12, 'سیزده': 13, 'چهارده': 14,
  'پانزده': 15, 'پونزده': 15, 'شانزده': 16, 'شونزده': 16, 'هفده': 17,
  'هجده': 18, 'هیجده': 18, 'نوزده': 19, 'بیست': 20, 'سی': 30, 'چهل': 40,
  'پنجاه': 50, 'شصت': 60, 'هفتاد': 70, 'هشتاد': 80, 'نود': 90,
  'صد': 100, 'دویست': 200, 'سیصد': 300, 'چهارصد': 400, 'پانصد': 500,
  'پونصد': 500, 'ششصد': 600, 'شیشصد': 600, 'هفتصد': 700, 'هشتصد': 800, 'نهصد': 900
};
const W_MULTS = { 'هزار': 1e3, 'میلیون': 1e6, 'ملیون': 1e6, 'م': 1e6, 'میلیارد': 1e9, 'ملیارد': 1e9, 'همت': 1e12 };

function parsePersianTrade(rawText, availableLists = []) {
  let t = normalizeText(rawText);

  // 1. Target List extraction: e.g. "در لیست حامد", "به لیست اول", "لیست حامد:"
  let targetListName = null;
  const listMatch = t.match(/(?:در\s+لیست|به\s+لیست|از\s+لیست|لیست)\s+([^\s\d,]+)/);
  if (listMatch) {
    targetListName = listMatch[1];
    t = (t.substring(0, listMatch.index) + ' ' + t.substring(listMatch.index + listMatch[0].length)).trim();
  } else {
    // Check if any existing list name matches directly
    for (const l of availableLists) {
      const normL = normalizeText(l.name);
      if (t.includes(normL)) {
        targetListName = l.name;
        t = t.replace(normL, ' ').trim();
        break;
      }
    }
  }

  // 2. Rate extraction: e.g. "یه نرخ ۲۵۶۰۰۰", "به نرخ ۲۵۶۰۰۰", "نرخ ۲۵۶۰۰۰", "فی ۲۵۶۰۰۰", "قیمت ۲۵۶۰۰۰"
  let rate = null;
  const rateMatch = t.match(/(?:به\s+نرخ|یه\s+نرخ|یک\s+نرخ|به\s+فی|به\s+قیمت|نرخ|فی|قیمت|fee|rate|@)\s*[:=]?\s*(\d[\d,]*(?:\.\d+)?)/);
  if (rateMatch) {
    rate = Number(rateMatch[1].replace(/,/g, ''));
    t = (t.substring(0, rateMatch.index) + ' ' + t.substring(rateMatch.index + rateMatch[0].length)).trim();
  }

  // 3. Side extraction: Buy / Sell
  let side = null;
  const buyMatch = t.match(/(?:^|\s)(خرید|خریدم|خریده|خریداری|خریدات|برداشت|buy)(?=$|\s)/);
  const sellMatch = t.match(/(?:^|\s)(فروش|فروختم|فروخته|فروخت|فروشات|واریز|sell)(?=$|\s)/);
  if (buyMatch) {
    side = 'buy';
    t = (t.substring(0, buyMatch.index) + ' ' + t.substring(buyMatch.index + buyMatch[0].length)).trim();
  } else if (sellMatch) {
    side = 'sell';
    t = (t.substring(0, sellMatch.index) + ' ' + t.substring(sellMatch.index + sellMatch[0].length)).trim();
  }

  // 4. Province / City
  let province = '';
  const provMatch = t.match(/(?:ولایت|شهر)\s+([^\s\d,]+)/);
  if (provMatch) {
    province = provMatch[1];
    t = (t.substring(0, provMatch.index) + ' ' + t.substring(provMatch.index + provMatch[0].length)).trim();
  }

  // 5. Multipliers attached to digits: e.g. "2000م", "۲ میلیارد", "۵۰۰ هزار"
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:میلیارد|ملیارد|b)(?=$|[\s,.:;!?])/g, (m, g) => String(Math.round(Number(g) * 1000000000)));
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:میلیون|ملیون|م|m)(?=$|[\s,.:;!?])/g, (m, g) => String(Math.round(Number(g) * 1000000)));
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:هزار|k)(?=$|[\s,.:;!?])/g, (m, g) => String(Math.round(Number(g) * 1000)));
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:همت)(?=$|[\s,.:;!?])/g, (m, g) => String(Math.round(Number(g) * 1000000000000)));

  // 6. Words to numbers: e.g. "دو میلیارد", "پانصد میلیون", "سیصد هزار"
  const words = t.split(' ');
  let convertedWords = [];
  let curVal = 0;
  let totalVal = 0;
  let inNum = false;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'و' && inNum) continue;
    if (W_UNITS[w] !== undefined) {
      curVal += W_UNITS[w];
      inNum = true;
    } else if (W_MULTS[w] !== undefined) {
      const mul = W_MULTS[w];
      if (curVal === 0) curVal = 1;
      totalVal += curVal * mul;
      curVal = 0;
      inNum = true;
    } else {
      if (inNum) {
        convertedWords.push(String(Math.round(totalVal + curVal)));
        totalVal = 0;
        curVal = 0;
        inNum = false;
      }
      convertedWords.push(w);
    }
  }
  if (inNum) {
    convertedWords.push(String(Math.round(totalVal + curVal)));
  }
  t = convertedWords.join(' ');

  // 7. Extract Numbers (Amount & Rate)
  const nums = [];
  t = t.replace(/\b\d+(?:\.\d+)?\b/g, (m) => {
    nums.push(Number(m));
    return ' ';
  });

  let amount = null;
  if (nums.length >= 2) {
    if (!rate) {
      amount = nums[0];
      rate = nums[1];
    } else {
      amount = nums[0];
    }
  } else if (nums.length === 1) {
    if (!amount) amount = nums[0];
    else if (!rate) rate = nums[0];
  }

  // 8. Contact Name extraction
  let name = t
    .replace(/(?:^|\s)(?:از|به|برای|واسه|طرف|حساب|مشتری|اقای|آقای|حاج|حاجی|تومان|دالر|دلار|افغانی|ولایت|شهر)(?=$|\s)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name) name = 'مشتری';

  const isTrade = Boolean(side && (amount || rate));

  return {
    isTrade,
    side: side || 'buy',
    amount: amount || 0,
    rate: rate || 0,
    name,
    province,
    targetListName
  };
}

// Convert Toman to USD (1:1 with Finance.kt)
function convertTomanToUsd(toman, rate) {
  const t = Number(toman) || 0;
  const r = Number(rate) || 0;
  if (r <= 0) return 0;
  if (r > 1000) {
    return Math.round((t * 1000) / r);
  } else {
    return Math.round(t / r);
  }
}

// 5. Search Engine (Direct port of Search.kt)
function searchAll(chatId, query) {
  const state = getUserState(chatId);
  const qNorm = normalizeText(query);
  const qCompact = qNorm.replace(/\s+/g, '');
  if (!qCompact) return [];

  const results = [];
  for (const list of state.lists) {
    const listHit = normalizeText(list.name).includes(qNorm) ||
                    (list.code && list.code.toLowerCase().includes(qNorm));

    const matchedTrades = [];
    (list.trades || []).forEach((t, idx) => {
      const nameHit = normalizeText(t.name).includes(qNorm);
      const provHit = t.province && normalizeText(t.province).includes(qNorm);
      const tomanStr = String(t.toman);
      const usdStr = String(t.converted);
      const rateStr = String(t.rate);
      const numHit = tomanStr.includes(qCompact) || usdStr.includes(qCompact) || rateStr.includes(qCompact);

      if (nameHit || provHit || numHit) {
        matchedTrades.push({ trade: t, index: idx + 1 });
      }
    });

    if (listHit || matchedTrades.length > 0) {
      results.push({ list, listHit, matchedTrades });
    }
  }
  return results;
}

// 6. Voice Audio Transcriber using Gemini
async function transcribeVoiceAudio(fileUrl) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  return new Promise((resolve) => {
    https.get(fileUrl, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', async () => {
        try {
          const audioBuffer = Buffer.concat(chunks);
          const base64Audio = audioBuffer.toString('base64');

          const postData = JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    inline_data: {
                      mime_type: 'audio/ogg',
                      data: base64Audio
                    }
                  },
                  {
                    text: 'این یک پیام صوتی صرافی به زبان فارسی/دری است. لطفاً متن دقیق گفته شده را دقیقاً بنویس. فقط متن خالص گفته شده را بدون کلمه اضافی خروجی بده.'
                  }
                ]
              }
            ]
          });

          const options = {
            hostname: 'generativelanguage.googleapis.com',
            port: 443,
            path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            }
          };

          const req = https.request(options, (apiRes) => {
            let apiData = '';
            apiRes.on('data', d => apiData += d);
            apiRes.on('end', () => {
              try {
                const json = JSON.parse(apiData);
                const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                resolve(text);
              } catch (_) {
                resolve(null);
              }
            });
          });

          req.on('error', () => resolve(null));
          req.write(postData);
          req.end();
        } catch (_) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

// 7. Interactive Keyboards
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

// 8. Bot Event Listeners: Messages & Voice
bot.on('voice', async (msg) => {
  handleVoiceMessage(msg);
});

bot.on('audio', async (msg) => {
  handleVoiceMessage(msg);
});

async function handleVoiceMessage(msg) {
  const chatId = msg.chat.id;
  const statusMsg = await bot.sendMessage(chatId, '🎙️ در حال گوش دادن و پردازش فایل صوتی شما...');

  try {
    const fileId = msg.voice?.file_id || msg.audio?.file_id;
    const fileLink = await bot.getFileLink(fileId);

    const transcribed = await transcribeVoiceAudio(fileLink);
    if (!transcribed) {
      await bot.editMessageText('🎙️ فایل صوتی دریافت شد، اما برای پردازش هوشمند صدا، لطفاً متغیر محیطی GEMINI_API_KEY را در تنظیمات Render قرار دهید یا متن دستور را تایپ فرمایید.', {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });
      return;
    }

    await bot.editMessageText(`🎙️ **متن پیام صوتی شما:**\n«${transcribed}»\n\n⚙️ در حال اجرای دستور...`, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: 'Markdown'
    });

    // Execute transcribed text as a command
    processIncomingText(chatId, transcribed);
  } catch (err) {
    console.error('Voice processing error:', err);
    await bot.sendMessage(chatId, '❌ خطا در دریافت یا پردازش فایل صوتی.');
  }
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : '';
  if (!text) return;
  processIncomingText(chatId, text);
});

async function processIncomingText(chatId, text) {
  const state = getUserState(chatId);
  const activeList = getActiveList(chatId);

  // Check active interactive session
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
    } else if (session.type === 'ask_amount_for_deal') {
      const parsedAmount = parsePersianTrade(text);
      const amountVal = parsedAmount.amount || Number(normalizeText(text).replace(/[^\d.]/g, ''));
      if (amountVal > 0) {
        userSessions.delete(chatId);
        session.deal.amount = amountVal;
        handleParsedDeal(chatId, session.deal);
        return;
      } else {
        await bot.sendMessage(chatId, '⚠️ مبلغ وارد شده صحیح نیست. لطفاً مجدداً مبلغ را ارسال کنید (مثلاً: ۲ م یا ۵۰۰ هزار):');
        return;
      }
    } else if (session.type === 'ask_rate_for_deal') {
      const parsedRate = parsePersianTrade(text);
      const rateVal = parsedRate.rate || Number(normalizeText(text).replace(/[^\d.]/g, ''));
      if (rateVal > 0) {
        userSessions.delete(chatId);
        session.deal.rate = rateVal;
        handleParsedDeal(chatId, session.deal);
        return;
      } else {
        await bot.sendMessage(chatId, '⚠️ نرخ وارد شده صحیح نیست. لطفاً مجدداً نرخ را بفرستید (مثلاً: ۲۵۶۰۰۰):');
        return;
      }
    }
  }

  // Basic Commands
  if (text === '/start' || text === 'شروع') {
    const welcome = `سلام! به **دستیار هوشمند و ربات معاملات تومان صرافی** خوش آمدید. 🤖

📌 لیست فعال شما: **${activeList.name}**

💡 **نمونه‌های ثبت معامله (متنی یا ارسال ویس 🎙️):**
• \`۲۰۰۰م خرید از احمد نرخ ۲۵۶۰۰۰ در لیست حامد\`
• \`۲ میلیارد خرید از احمد نرخ ۲۵۶۰۰۰\`
• \`دو میلیارد خرید از وحید الله فی ۲۵۶۰۰۰\`
• \`یه نرخ ۲۵۶۰۰۰ خرید از وحید الله در لیست حامد\`

اگر نام لیست را نگویید، ربات دکمه‌های لیست‌ها را برای انتخاب نمایش می‌دهد.`;

    await bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown', ...getMainMenuKeyboard(chatId) });
    return;
  }

  if (text === 'ℹ️ راهنمای دستیار صرافی' || text === '/help') {
    const help = `📖 **راهنمای کامل دستیار و ربات صرافی:**

۱. **ثبت صوتی یا متنی معامله:**
کافیست پیام صوتی یا متنی بفرستید:
- \`۲۰۰۰م خرید از احمد نرخ ۲۵۶۰۰۰ در لیست حامد\`
- \`دو میلیارد خرید از وحید الله فی ۲۵۶۰۰۰\`
- \`فروش رضا ۵۰۰ هزار ۲۵۵۰۰\`

۲. **ویرایش و حذف:**
- ارسال دستور: \`حذف ردیف ۱\` یا \`ویرایش ردیف ۱\`
- یا کپی متن گزارش معامله و نوشتن «حذف» یا «ویرایش» در خط بعد

۳. **جستجوی پیشرفته:**
- \`جستجو احمد\` یا \`جستجو 2560000\`

۴. **خروجی‌ها:**
- 🖼️ خروجی تصویر با فونت وزیرمتن و کات دقیق
- 📄 خروجی PDF استاندارد جهت پرینت
- 📋 خروجی متنی جهت کپی
- 💬 ارسال مستقیم به واتساپ`;

    await bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
    return;
  }

  // Menu navigation
  if (text.startsWith('📁 لیست فعلی:')) {
    sendListDetails(chatId, activeList);
    return;
  }
  if (text === '🔍 جستجوی معاملات') {
    userSessions.set(chatId, { type: 'search_query' });
    await bot.sendMessage(chatId, '🔍 لطفاً عبارت مورد نظر برای جستجو (نام طرف معامله، مبلغ، نرخ یا کد لیست) را ارسال فرمایید:');
    return;
  }
  if (text === '➕ ثبت سریع معامله') {
    await bot.sendMessage(chatId, `📝 لطفاً متن یا ویس معامله را ارسال فرمایید:\n\nمثال:\n\`۲۰۰۰م خرید از احمد نرخ ۲۵۶۰۰۰ در لیست حامد\`\n\`دو میلیارد خرید از وحید الله فی ۲۵۶۰۰۰\``, { parse_mode: 'Markdown' });
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

  // Check search command
  const searchMatch = text.match(/^(?:جستجو|پیدا\s*کن|بگرد|search)\s+(.+)$/i);
  if (searchMatch) {
    handleSearchExecution(chatId, searchMatch[1].trim());
    return;
  }

  // Check delete command
  if (text.includes('حذف') || text.includes('پاک')) {
    const isDeleteHandled = await handleDeleteIntent(chatId, text, activeList);
    if (isDeleteHandled) return;
  }

  // Check edit command
  if (text.includes('ویرایش') || text.includes('اصلاح')) {
    const isEditHandled = await handleEditIntent(chatId, text, activeList);
    if (isEditHandled) return;
  }

  // Parse natural language trade
  const parsed = parsePersianTrade(text, state.lists);
  if (parsed.isTrade) {
    handleParsedDeal(chatId, parsed);
    return;
  }

  // If not recognized
  await bot.sendMessage(chatId, `دستور شما متوجه نشدم. لطفاً جمله معامله را بنویسید (مثلاً: \`۲۰۰۰م خرید از احمد نرخ ۲۵۶۰۰۰\`) یا از منوی پایین استفاده فرمایید.`, { parse_mode: 'Markdown' });
}

// 9. Deal Handling & Prompting for Missing Fields / List Selection
async function handleParsedDeal(chatId, parsed) {
  const state = getUserState(chatId);

  // If amount is missing
  if (!parsed.amount || parsed.amount <= 0) {
    userSessions.set(chatId, { type: 'ask_amount_for_deal', deal: parsed });
    await bot.sendMessage(chatId, `📝 معامله **${parsed.side === 'buy' ? 'خرید' : 'فروش'} از ${parsed.name}**${parsed.rate ? ` با نرخ **${renderer.F2(parsed.rate)}**` : ''} تشخیص داده شد.\n\n👇 لطفاً **مبلغ معامله به تومان** را بفرستید (مثلاً: ۲ م یا ۵۰۰ هزار):`, { parse_mode: 'Markdown' });
    return;
  }

  // If rate is missing
  if (!parsed.rate || parsed.rate <= 0) {
    userSessions.set(chatId, { type: 'ask_rate_for_deal', deal: parsed });
    await bot.sendMessage(chatId, `📝 معامله **${parsed.side === 'buy' ? 'خرید' : 'فروش'} از ${parsed.name}** به مبلغ **${renderer.F(parsed.amount)} تومان** تشخیص داده شد.\n\n👇 لطفاً **نرخ معامله** را بفرستید (مثلاً: ۲۵۶۰۰۰):`, { parse_mode: 'Markdown' });
    return;
  }

  const convertedUsd = convertTomanToUsd(parsed.amount, parsed.rate);

  // If user explicitly named a list in the trade phrase
  if (parsed.targetListName) {
    const normTarget = normalizeText(parsed.targetListName);
    let target = state.lists.find(l => normalizeText(l.name).includes(normTarget));
    if (!target) {
      // Auto create the target list if it doesn't exist
      target = {
        id: 'list_' + Date.now(),
        name: parsed.targetListName,
        code: 'L-' + (state.lists.length + 101),
        createdAt: Date.now(),
        trades: []
      };
      state.lists.push(target);
      saveData();
    }
    saveDealToList(chatId, target.id, parsed, convertedUsd);
    return;
  }

  // If NO list specified, per user requirement:
  // Show list buttons for interactive destination selection!
  userSessions.set(chatId, {
    type: 'select_list_for_deal',
    deal: { ...parsed, converted: convertedUsd }
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

  const dealSummaryText = `📋 **معامله تشخیص داده شد:**
• نوع: **${parsed.side === 'buy' ? '🟢 خرید' : '🔴 فروش'}**
• طرف معامله: **${parsed.name}**
• مبلغ: **${renderer.F(parsed.amount)} تومان**
• نرخ: **${renderer.F2(parsed.rate)}**
• معادل: **${renderer.F(convertedUsd)} دالر**${parsed.province ? `\n• ولایت: **${parsed.province}**` : ''}

👇 **لطفاً لیست مورد نظر برای ثبت را انتخاب کنید:**`;

  await bot.sendMessage(chatId, dealSummaryText, {
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
    toman: parsed.amount,
    rate: parsed.rate,
    converted: convertedUsd,
    province: parsed.province || '',
    createdAt: Date.now()
  };

  target.trades = target.trades || [];
  target.trades.push(newTrade);
  saveData();

  const tradeIndex = target.trades.length;
  const reply = `✅ **معامله با موفقیت در لیست «${target.name}» ثبت شد:**

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
    await bot.sendMessage(chatId, `🔍 نتیجه‌ای برای «**${query}**» یافت نشد.`, { parse_mode: 'Markdown' });
    return;
  }

  let text = `🔍 **نتایج جستجو برای: «${query}»**\n━━━━━━━━━━━━━━━━━━━━\n`;
  const inlineButtons = [];

  results.forEach(res => {
    text += `\n📁 **لیست: ${res.list.name}**\n`;
    if (res.matchedTrades.length > 0) {
      res.matchedTrades.forEach(item => {
        const t = item.trade;
        const sideIcon = t.side === 'buy' ? '🟢 خرید' : '🔴 فروش';
        text += `• #${item.index}: ${sideIcon} **${t.name}** | ${renderer.F(t.toman)} تومان | نرخ: ${renderer.F2(t.rate)} | معادل: ${renderer.F(t.converted)} دالر\n`;
        inlineButtons.push([
          { text: `✏️ ویرایش #${item.index}`, callback_data: `edit_trade:${res.list.id}:${t.id}` },
          { text: `🗑️ حذف #${item.index}`, callback_data: `del_trade:${res.list.id}:${t.id}` }
        ]);
      });
    }
  });

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: inlineButtons.length > 0 ? { inline_keyboard: inlineButtons.slice(0, 8) } : undefined
  });
}

// 11. Delete and Edit Handlers
async function handleDeleteIntent(chatId, text, activeList) {
  const rowMatch = text.match(/(?:حذف|پاک)\s*(?:معامله|ردیف|شماره)?\s*(\d+)/i);
  if (rowMatch) {
    const rowNum = parseInt(rowMatch[1], 10);
    if (activeList && activeList.trades && activeList.trades[rowNum - 1]) {
      const trade = activeList.trades[rowNum - 1];
      activeList.trades.splice(rowNum - 1, 1);
      saveData();
      await bot.sendMessage(chatId, `🗑️ معامله ردیف **#${rowNum}** (${trade.name} - ${renderer.F(trade.toman)} تومان) با موفقیت حذف شد.`, { parse_mode: 'Markdown' });
      return true;
    }
  }

  if (text.endsWith('حذف') || text.startsWith('حذف')) {
    const norm = normalizeText(text);
    for (let i = (activeList.trades || []).length - 1; i >= 0; i--) {
      const t = activeList.trades[i];
      if (norm.includes(normalizeText(t.name))) {
        activeList.trades.splice(i, 1);
        saveData();
        await bot.sendMessage(chatId, `🗑️ معامله متعلق به **${t.name}** با موفقیت حذف گردید.`, { parse_mode: 'Markdown' });
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

کدام فیلد را می‌خواهید ویرایش نمایید؟`;

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

  const parsed = parsePersianTrade(newText);
  if (field === 'name') {
    trade.name = newText.trim();
  } else if (field === 'toman') {
    const amountVal = parsed.amount || Number(normalizeText(newText).replace(/[^\d.]/g, ''));
    if (amountVal > 0) {
      trade.toman = amountVal;
      trade.converted = convertTomanToUsd(trade.toman, trade.rate);
    }
  } else if (field === 'rate') {
    const rateVal = parsed.rate || Number(normalizeText(newText).replace(/[^\d.]/g, ''));
    if (rateVal > 0) {
      trade.rate = rateVal;
      trade.converted = convertTomanToUsd(trade.toman, trade.rate);
    }
  }

  saveData();
  bot.sendMessage(chatId, `✅ فیلد با موفقیت ویرایش گردید.`);
  sendEditTradeMenu(chatId, listId, tradeId);
}

// 12. Inline Keyboard Callbacks
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
      await bot.sendMessage(chatId, '➕ لطفاً نام لیست جدید را ارسال فرمایید:');
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
      const names = { name: 'نام جدید طرف معامله', toman: 'مبلغ جدید به تومان', rate: 'نرخ جدید' };
      userSessions.set(chatId, { type: 'edit_field', listId, tradeId, field });
      await bot.sendMessage(chatId, `لطفاً **${names[field] || field}** را ارسال فرمایید:`, { parse_mode: 'Markdown' });
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
    console.error('Callback error:', err);
    bot.answerCallbackQuery(query.id);
  }
});

// 13. Reports: Image, PDF, Text, WhatsApp
async function sendImageReport(chatId, list) {
  const statusMsg = await bot.sendMessage(chatId, '⏳ در حال ساخت تصویر سند با فونت وزیرمتن و کات دقیق...');
  try {
    const state = getUserState(chatId);
    const dateText = getPersianDateText();
    const pngBuffer = renderer.renderReportImage(list, state.info, dateText);

    await bot.sendPhoto(chatId, pngBuffer, {
      caption: `🖼️ **سند خروجی صرافی:** ${list.name}\n📅 تاریخ: ${dateText.fullDate}`,
      parse_mode: 'Markdown'
    });

    try { await bot.deleteMessage(chatId, statusMsg.message_id); } catch (_) {}
  } catch (err) {
    console.error('Error generating image:', err);
    await bot.sendMessage(chatId, '❌ خطا در تهیه تصویر: ' + err.message);
  }
}

async function sendPdfReport(chatId, list) {
  const statusMsg = await bot.sendMessage(chatId, '⏳ در حال تولید فایل PDF استاندارد A4...');
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

    try { await bot.deleteMessage(chatId, statusMsg.message_id); } catch (_) {}
  } catch (err) {
    console.error('Error generating PDF:', err);
    await bot.sendMessage(chatId, '❌ خطا در تولید PDF: ' + err.message);
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

  await bot.sendMessage(chatId, `💬 **اشتراک‌گذاری در واتساپ:**\n\nبرای ارسال مستقیم به واتساپ روی دکمه زیر کلیک نمایید:\n\n\`\`\`\n${text}\n\`\`\``, {
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
    bot.sendMessage(chatId, `📁 لیست **${list.name}** در حال حاضر خالی است.\n\nبرای ثبت، دستور یا ویس بفرستید، مثلاً:\n\`۲۰۰۰م خرید از احمد نرخ ۲۵۶۰۰۰\``, { parse_mode: 'Markdown' });
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

console.log('🤖 Toman Exchange Telegram Bot with embedded fonts and voice processing loaded!');
