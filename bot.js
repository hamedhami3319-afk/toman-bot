/**
 * Toman Exchange Telegram Bot
 * Highly optimized, production-ready bot for Toman transactions, natural language assistant,
 * voice command processing via Gemini AI, advanced search, and high-fidelity reports.
 * 100% Self-contained for easy GitHub upload & Render deployment.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const TelegramBot = require('node-telegram-bot-api');
const renderer = require('./renderer.js');
let GoogleGenAI;
try {
  GoogleGenAI = require('@google/genai').GoogleGenAI;
} catch (_) {
  GoogleGenAI = null;
}

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
      time,
      fullDate: `${w} ${y}/${m}/${d}`
    };
  } catch (_) {
    return { date: '1403/05/22', time: '14:30', fullDate: 'امروز' };
  }
}

function getUserState(chatId) {
  const idStr = String(chatId);
  if (!db.users[idStr]) {
    db.users[idStr] = {
      activeListId: 'default',
      lists: [
        {
          id: 'default',
          name: 'لیست اول صرافی',
          code: 'L-101',
          createdAt: Date.now(),
          trades: []
        }
      ]
    };
    saveData();
  }
  return db.users[idStr];
}

function getActiveList(chatId) {
  const state = getUserState(chatId);
  let active = state.lists.find(l => l.id === state.activeListId);
  if (!active && state.lists.length > 0) {
    active = state.lists[0];
    state.activeListId = active.id;
    saveData();
  }
  return active;
}

// 4. Natural Language Normalization & Parsing
function normalizeText(text) {
  if (!text) return '';
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/[\u064A\u0649]/g, 'ی')
    .replace(/[\u0643]/g, 'ک')
    .replace(/[\u06C0-\u06C3]/g, 'ه')
    .replace(/[\u06F0-\u06F9]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString())
    .replace(/[\u0660-\u0669]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString())
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    .replace(/\s+/g, ' ')
    .trim();
}

const W_UNITS = {
  'صفر': 0, 'یک': 1, 'يك': 1, 'دو': 2, 'سه': 3, 'چهار': 4,
  'پنج': 5, 'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9,
  'ده': 10, 'یازده': 11, 'دوازده': 12, 'سیزده': 13, 'چهارده': 14,
  'پانزده': 15, 'پونزده': 15, 'شانزده': 16, 'شونزده': 16, 'هفده': 17,
  'هجده': 18, 'هیجده': 18, 'نوزده': 19,
  'بیست': 20, 'سی': 30, 'چهل': 40, 'پنجاه': 50, 'شصت': 60,
  'هفتاد': 70, 'هشتاد': 80, 'نود': 90,
  'صد': 100, 'یکصد': 100, 'دویست': 200, 'سیصد': 300, 'چهارصد': 400,
  'پانصد': 500, 'پونصد': 500, 'ششصد': 600, 'شیشصد': 600, 'هفتصد': 700,
  'هشتصد': 800, 'نهصد': 900
};
const W_MULTS = { 'هزار': 1e3, 'میلیون': 1e6, 'ملیون': 1e6, 'م': 1e6, 'میلیارد': 1e9, 'ملیارد': 1e9, 'همت': 1e12 };

/**
 * Pre-converts words and multipliers into standard digits
 */
function preNormalizeTradeNumbers(str) {
  let s = normalizeText(str);
  const B = '(?=$|[\\s,.:;!؟?؛\\-()«»])';

  s = s.replace(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:میلیارد|ملیارد|b)${B}`, 'gi'), (_, n) =>
    String(Math.round(parseFloat(n) * 1e9))
  );
  s = s.replace(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:میلیون|ملیون|م|m)${B}`, 'gi'), (_, n) =>
    String(Math.round(parseFloat(n) * 1e6))
  );
  s = s.replace(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:هزار|k)${B}`, 'gi'), (_, n) =>
    String(Math.round(parseFloat(n) * 1e3))
  );
  s = s.replace(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:همت)${B}`, 'gi'), (_, n) =>
    String(Math.round(parseFloat(n) * 1e12))
  );

  // Convert Persian word numbers
  const words = s.split(' ');
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
  return convertedWords.join(' ');
}

/**
 * Parse single trade line
 */
function parsePersianTrade(rawText, availableLists = [], defaultSide = null, defaultList = null) {
  let t = preNormalizeTradeNumbers(rawText);

  // 1. Target List extraction
  let targetListName = defaultList;
  const listMatch = t.match(/(?:در\s+لیست|به\s+لیست|از\s+لیست|لیست)\s+([^:؛,\n]+?)(?:\s+(?:ثبت|بزن|انجام|اضافه)\s*(?:کن|بکن|شود)?|[:؛,\n]|$)/i);
  if (listMatch) {
    const ext = listMatch[1].trim();
    if (ext && !['خرید', 'فروش', 'معامله'].includes(ext)) {
      targetListName = ext;
      t = (t.substring(0, listMatch.index) + ' ' + t.substring(listMatch.index + listMatch[0].length)).trim();
    }
  }

  if (!targetListName && availableLists.length > 0) {
    for (const l of availableLists) {
      const normL = normalizeText(l.name);
      if (t.includes(normL)) {
        targetListName = l.name;
        t = t.replace(normL, ' ').trim();
        break;
      }
    }
  }

  // 2. Rate extraction
  let rate = null;
  const rateMatch = t.match(/(?:به\s+نرخ|یه\s+نرخ|یک\s+نرخ|به\s+فی|به\s+قیمت|نرخ|فی|قیمت|fee|rate|@)\s*[:=]?\s*(\d[\d,]*(?:\.\d+)?)/i);
  if (rateMatch) {
    rate = Number(rateMatch[1].replace(/,/g, ''));
    t = (t.substring(0, rateMatch.index) + ' ' + t.substring(rateMatch.index + rateMatch[0].length)).trim();
  }

  // 3. Side extraction
  let side = defaultSide;
  const buyMatch = t.match(/(?<=^|[\s,.:;!؟?؛\-])(?:خرید|خریدم|خریده|خریداری|خریدات|buy)(?=$|[\s,.:;!؟?؛\-])/iu);
  const sellMatch = t.match(/(?<=^|[\s,.:;!؟?؛\-])(?:فروش|فروختم|فروخته|فروخت|فروشات|sell)(?=$|[\s,.:;!؟?؛\-])/iu);
  if (buyMatch && !sellMatch) {
    side = 'buy';
    t = (t.substring(0, buyMatch.index) + ' ' + t.substring(buyMatch.index + buyMatch[0].length)).trim();
  } else if (sellMatch && !buyMatch) {
    side = 'sell';
    t = (t.substring(0, sellMatch.index) + ' ' + t.substring(sellMatch.index + sellMatch[0].length)).trim();
  }

  // 4. Province / City
  let province = '';
  const provMatch = t.match(/(?:ولایت|شهر)\s+([^\s\d,.:;؛]+)/i);
  if (provMatch) {
    province = provMatch[1];
    t = (t.substring(0, provMatch.index) + ' ' + t.substring(provMatch.index + provMatch[0].length)).trim();
  }

  // 5. Extract Numbers
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

  // 6. Contact Name extraction
  let name = t
    .replace(/(?<=^|[\s,.:;!؟?؛\-])(?:خرید|خریدم|خریده|خریدات|فروش|فروختم|فروخته|فروشات|buy|sell)(?=$|[\s,.:;!؟?؛\-])/giu, ' ')
    .replace(/(?:^|\s)(?:از|به|برای|واسه|طرف|حساب|مشتری|اقای|آقای|حاج|حاجی|تومان|دالر|دلار|افغانی|ولایت|شهر|نرخ|فی)(?=$|\s)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name || name.length < 2) name = 'مشتری';

  const isTrade = Boolean((side || amount || rate) && (amount || rate));

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

/**
 * Multi-trade batch parser
 * Handles prompts like:
 * "خریدهای زیر رو در لیست حامد ارجمند ثبت کن: دو میلیارد خرید از احمد، نرخ ۲۵۶ هزار؛ هفت میلیارد خرید از فرید، نرخ ۲۵۰ هزار؛ هشت میلیارد خرید از مقصود، نرخ ۱۷۱ هزار."
 */
function parseBatchTrades(rawText, availableLists = [], currentListName = null) {
  const norm = normalizeText(rawText);

  // Check header
  const headerRegex = /^(?:(?:دستور|ثبت|لطفاً|لطفا)?\s*(خرید|فروش|معاملات)(?:های|ها)?\s*زیر(?:\s*رو|\s*را)?\s*(?:در\s+لیست|به\s+لیست)?\s*([^:؛,\n]+?)(?:\s*(?:ثبت|بزن|اضافه)\s*(?:کن|بکن|شود)?)\s*[:=]\s*(.*))$/isu;
  const headerMatch = headerRegex.exec(norm);

  let defaultSide = null;
  let targetList = currentListName;
  let tradeContent = norm;

  if (headerMatch) {
    const sideWord = headerMatch[1];
    if (sideWord.includes('خرید')) defaultSide = 'buy';
    else if (sideWord.includes('فروش')) defaultSide = 'sell';

    const rawListName = headerMatch[2].trim();
    if (rawListName) {
      targetList = rawListName;
    }
    tradeContent = headerMatch[3].trim();
  } else {
    // Check if target list is explicitly in text
    const listInTextMatch = /(?:در\s+لیست|به\s+لیست|از\s+لیست|لیست)\s+([^:؛,\n]+?)(?:\s+(?:ثبت|بزن|انجام|اضافه)\s*(?:کن|بکن|شود)?|[:؛,\n]|$)/i.exec(norm);
    if (listInTextMatch) {
      const extracted = listInTextMatch[1].trim();
      if (extracted && !['خرید', 'فروش', 'معامله'].includes(extracted)) {
        targetList = extracted;
      }
    }
  }

  // Split into trade segments
  let items = tradeContent.split(/[؛;\n]+/).map(s => s.trim()).filter(Boolean);
  if (items.length === 1 && (items[0].includes('خرید') || items[0].includes('فروش') || items[0].includes('نرخ') || items[0].includes('فی'))) {
    const subClauses = items[0].split(/(?:\s*،\s*|\s*,\s*)(?=(?:دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده|\d+|خرید|فروش))/i);
    if (subClauses.length > 1) {
      items = subClauses.map(s => s.trim()).filter(Boolean);
    }
  }

  if (items.length <= 1 && !headerMatch) {
    return null;
  }

  const trades = [];
  for (const item of items) {
    const p = parsePersianTrade(item, availableLists, defaultSide, targetList);
    if (p.isTrade && p.amount > 0 && p.rate > 0) {
      trades.push(p);
    }
  }

  if (trades.length > 0) {
    return {
      trades,
      targetList
    };
  }
  return null;
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

// 5. Search Engine
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
      results.push({ list, matchedTrades });
    }
  }
  return results;
}

// 6. Voice Audio Transcription using Gemini 3.5 Transcribe
async function transcribeVoiceAudio(fileUrl) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY is not configured for voice processing.');
    return null;
  }

  try {
    const resp = await fetch(fileUrl);
    const arrayBuffer = await resp.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');

    if (GoogleGenAI) {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const aiResp = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            { inlineData: { mimeType: 'audio/ogg', data: base64Audio } },
            {
              text: 'این صوت مربوط به ثبت معاملات صرافی یا دستور به ربات صرافی است. کلمات فارسی، نام مشتری، نوع معامله، مبالغ به میلیارد و میلیون، نرخ‌ها و نام لیست را بسیار دقیق پیاده‌سازی کن. فقط متن خالص گفته شده را بدون توضیحات اضافه ارسال کن.'
            }
          ]
        }
      });
      return aiResp.text ? aiResp.text.trim() : null;
    }
  } catch (err) {
    console.error('Gemini voice transcription error:', err.message);
  }
  return null;
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
        [{ text: '🖼️ خروجی تصویر' }, { text: '📄 خروجی PDF' }, { text: '📋 خروجی متنی' }],
        [{ text: '💬 خروجی واتس‌اپ' }, { text: '🗑️ حذف یا ویرایش معامله' }],
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
  const statusMsg = await bot.sendMessage(chatId, '🎙️ در حال گوش دادن و پردازش صوت شما با هوش مصنوعی...');

  try {
    const fileId = msg.voice?.file_id || msg.audio?.file_id;
    const fileLink = await bot.getFileLink(fileId);

    const transcribed = await transcribeVoiceAudio(fileLink);
    if (!transcribed) {
      await bot.editMessageText('🎙️ فایل صوتی دریافت شد، اما برای پردازش خودکار صدا لطفاً متغیر محیطی GEMINI_API_KEY را فعال فرمایید یا متن دستور را تایپ نمایید.', {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });
      return;
    }

    await bot.editMessageText(`🎙️ **متن صدای شما:**\n«${transcribed}»\n\n⚙️ در حال اجرای دستور در صرافی...`, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: 'Markdown'
    });

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
        await bot.sendMessage(chatId, '⚠️ مبلغ نامعتبر است. لطفاً مجدداً مبلغ را ارسال کنید (مثلاً: ۲ م یا ۵۰۰ هزار):');
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
        await bot.sendMessage(chatId, '⚠️ نرخ نامعتبر است. لطفاً مجدداً نرخ را بفرستید (مثلاً: ۲۵۶۰۰۰):');
        return;
      }
    }
  }

  // Basic Commands
  if (text === '/start' || text === 'شروع') {
    const welcome = `سلام! به **دستیار هوشمند و ربات معاملات تومان صرافی** خوش آمدید. 🤖

📌 لیست فعال شما: **${activeList.name}**

💡 **نمونه‌های ثبت معامله (متنی یا ارسال ویس 🎙️):**
• \`خریدهای زیر رو در لیست حامد ارجمند ثبت کن: دو میلیارد خرید از احمد، نرخ ۲۵۶ هزار؛ هفت میلیارد خرید از فرید، نرخ ۲۵۰ هزار؛ هشت میلیارد خرید از مقصود، نرخ ۱۷۱ هزار\`
• \`۲۰۰۰م خرید از احمد نرخ ۲۵۶۰۰۰ در لیست حامد\`
• \`۲ میلیارد خرید از احمد نرخ ۲۵۶۰۰۰\`
• \`دو میلیارد خرید از وحید الله فی ۲۵۶۰۰۰\`

اگر نام لیست را در دستور نگویید، ربات لیست‌ها را برای انتخاب نمایش می‌دهد.`;

    await bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown', ...getMainMenuKeyboard(chatId) });
    return;
  }

  if (text === 'ℹ️ راهنمای دستیار صرافی' || text === '/help') {
    const help = `📖 **راهنمای کامل دستیار و ربات صرافی:**

۱. **ثبت صوتی یا متنی معامله (تکی یا دسته‌ای):**
- \`خریدهای زیر رو در لیست حامد ارجمند ثبت کن: دو میلیارد خرید از احمد، نرخ ۲۵۶ هزار؛ هفت میلیارد خرید از فرید، نرخ ۲۵۰ هزار؛ هشت میلیارد خرید از مقصود، نرخ ۱۷۱ هزار\`
- \`۲۰۰۰م خرید از احمد نرخ ۲۵۶۰۰۰\`
- \`دو میلیارد خرید از وحید الله فی ۲۵۶۰۰۰\`

۲. **حذف و ویرایش:**
- ارسال دستور: \`حذف یا ویرایش معامله\` یا \`حذف معامله احمد\`
- ارسال دستور: \`حذف یا ویرایش لیست\` یا \`حذف لیست حامد\`
- یا کپی متن گزارش معامله و نوشتن «حذف» یا «ویرایش» در خط بعد

۳. **خروجی‌ها:**
- 🖼️ خروجی تصویر دقیق بدون فضای خالی
- 📄 خروجی رسمی PDF چاپی تمیز بدون سربرگ و فوتر اضافه
- 💬 ارسال مستقیم فاکتور به واتساپ همراه با عکس ضمیمه`;

    await bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
    return;
  }

  // Menu navigation
  if (text.startsWith('📁 لیست فعلی:')) {
    sendListDetails(chatId, activeList);
    return;
  }
  if (text === '🔍 جستجوی معاملات' || text === 'جستجو') {
    userSessions.set(chatId, { type: 'search_query' });
    await bot.sendMessage(chatId, '🔍 لطفاً عبارت مورد نظر برای جستجو (نام طرف معامله، مبلغ، نرخ یا کد لیست) را ارسال فرمایید:');
    return;
  }
  if (text === '➕ ثبت سریع معامله') {
    await bot.sendMessage(chatId, `📝 لطفاً متن یا ویس معامله را ارسال فرمایید:\n\nمثال:\n\`خریدهای زیر رو در لیست حامد ارجمند ثبت کن: دو میلیارد خرید از احمد، نرخ ۲۵۶ هزار؛ هفت میلیارد خرید از فرید، نرخ ۲۵۰ هزار\`\n\`۲۰۰۰م خرید از احمد نرخ ۲۵۶۰۰۰\``, { parse_mode: 'Markdown' });
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
  if (text === '💬 خروجی واتس‌اپ' || text === '💬 ارسال به واتساپ' || text === 'واتساپ') {
    await sendWhatsAppShare(chatId, activeList);
    return;
  }
  if (text === '📊 خلاصه و سر به سر' || text === 'خلاصه') {
    await sendSummaryReport(chatId, activeList);
    return;
  }
  if (text === '⚙️ مدیریت لیست‌ها' || text === 'لیست‌ها' || text === 'لیستها') {
    await sendListManagement(chatId);
    return;
  }

  // Handle Multi-line trade report with "حذف" or "ویرایش" on last line
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const lastLine = normalizeText(lines[lines.length - 1]);
    const firstLines = lines.slice(0, lines.length - 1).join(' ');
    if (lastLine === 'حذف' || lastLine === 'delete') {
      const parsed = parsePersianTrade(firstLines, state.lists);
      await deleteTradeByCustomerOrDetail(chatId, activeList, parsed.name || firstLines);
      return;
    }
    if (lastLine === 'ویرایش' || lastLine === 'edit') {
      const parsed = parsePersianTrade(firstLines, state.lists);
      await openEditForTrade(chatId, activeList, parsed.name);
      return;
    }
  }

  // Handle "حذف یا ویرایش معامله" / "حذف معامله" / "ویرایش معامله"
  if (/^(?:حذف|ویرایش|حذف\s+یا\s+ویرایش)\s+معامله/i.test(text) || /^(?:حذف|ویرایش)\s+معاملات/i.test(text) || text === '🗑️ حذف یا ویرایش معامله') {
    const targetMatch = /(?:حذف|ویرایش)\s+معامله\s+(?:شماره\s*)?([^\s]+)/i.exec(text);
    if (targetMatch && !['یا', 'ها', 'جدید'].includes(targetMatch[1])) {
      const targetVal = targetMatch[1];
      const isEdit = text.includes('ویرایش');
      if (isEdit) {
        await openEditForTrade(chatId, activeList, targetVal);
      } else {
        await deleteTradeByCustomerOrDetail(chatId, activeList, targetVal);
      }
      return;
    }
    await showTradesForManage(chatId, activeList);
    return;
  }

  // Handle "حذف یا ویرایش لیست" / "حذف لیست" / "ویرایش لیست"
  if (/^(?:حذف|ویرایش|حذف\s+یا\s+ویرایش)\s+لیست/i.test(text)) {
    const listDelMatch = /حذف\s+لیست\s+(.+)$/i.exec(text);
    if (listDelMatch) {
      const lName = listDelMatch[1].trim();
      await handleDeleteListByName(chatId, lName);
      return;
    }
    await showListsForManage(chatId);
    return;
  }

  // Search command
  const searchMatch = text.match(/^(?:جستجو|پیدا\s*کن|بگرد|search)\s+(.+)$/i);
  if (searchMatch) {
    handleSearchExecution(chatId, searchMatch[1].trim());
    return;
  }

  // Check Batch Multi-Trade parsing
  const batchRes = parseBatchTrades(text, state.lists, activeList ? activeList.name : null);
  if (batchRes && batchRes.trades.length > 0) {
    await handleBatchTrades(chatId, batchRes);
    return;
  }

  // Single natural language trade
  const parsed = parsePersianTrade(text, state.lists);
  if (parsed.isTrade) {
    handleParsedDeal(chatId, parsed);
    return;
  }

  // Fallback
  await bot.sendMessage(chatId, `دستور شما متوجه نشدم. لطفاً جمله معامله را بنویسید (مثلاً: \`۲۰۰۰م خرید از احمد نرخ ۲۵۶۰۰۰\`) یا از منوی پایین استفاده فرمایید.`, { parse_mode: 'Markdown' });
}

// 9. Batch Multi-Trade Registration
async function handleBatchTrades(chatId, batch) {
  const state = getUserState(chatId);
  const targetListName = batch.targetList || 'لیست معاملات';
  let target = state.lists.find(l => normalizeText(l.name).includes(normalizeText(targetListName)));

  if (!target) {
    target = {
      id: 'list_' + Date.now(),
      name: targetListName,
      code: 'L-' + (state.lists.length + 101),
      createdAt: Date.now(),
      trades: []
    };
    state.lists.push(target);
    state.activeListId = target.id;
    saveData();
  }

  target.trades = target.trades || [];
  const addedTrades = [];

  for (const t of batch.trades) {
    const converted = convertTomanToUsd(t.amount, t.rate);
    const newTrade = {
      id: 'tr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      side: t.side,
      name: t.name,
      toman: t.amount,
      rate: t.rate,
      converted,
      province: t.province || '',
      createdAt: Date.now()
    };
    target.trades.push(newTrade);
    addedTrades.push(newTrade);
  }
  saveData();

  const fin = renderer.calculateList(target.trades);
  let reply = `✅ **${addedTrades.length} معامله با موفقیت در لیست «${target.name}» ثبت شد:**\n━━━━━━━━━━━━━━━━━━━━\n`;

  addedTrades.forEach((tr, i) => {
    const icon = tr.side === 'buy' ? '🟢 خرید' : '🔴 فروش';
    reply += `**${i + 1}.** ${icon} از **${tr.name}** | **${renderer.F(tr.toman)} تومان** | نرخ: **${renderer.F2(tr.rate)}** | **${renderer.F(tr.converted)} دالر**\n`;
  });

  reply += `━━━━━━━━━━━━━━━━━━━━\n`;
  reply += `📊 **مجموع خرید:** ${renderer.F(fin.buy.toman)} تومان (${renderer.F(fin.buy.total)} دالر) | نرخ اوسط: ${renderer.F(fin.buy.avg)}\n`;
  reply += `📊 **مجموع فروش:** ${renderer.F(fin.sell.toman)} تومان (${renderer.F(fin.sell.total)} دالر) | نرخ اوسط: ${renderer.F(fin.sell.avg)}\n`;
  if (fin.profit > 0) reply += `🎉 **مفاد خالص:** +${renderer.F(fin.profit)} دالر\n`;
  else if (fin.profit < 0) reply += `⚠️ **ضرر:** ${renderer.F(Math.abs(fin.profit))} دالر\n`;

  await bot.sendMessage(chatId, reply, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🖼️ خروجی تصویر (برش دقیق)', callback_data: `get_image:${target.id}` },
          { text: '📄 خروجی PDF', callback_data: `get_pdf:${target.id}` }
        ],
        [
          { text: '💬 ارسال به واتساپ با عکس', callback_data: `send_wa:${target.id}` },
          { text: '📋 کپی گزارش', callback_data: `copy_text:${target.id}` }
        ]
      ]
    }
  });
}

// 10. Deal Handling & Prompting for Missing Fields / List Selection
async function handleParsedDeal(chatId, parsed) {
  const state = getUserState(chatId);

  if (!parsed.amount || parsed.amount <= 0) {
    userSessions.set(chatId, { type: 'ask_amount_for_deal', deal: parsed });
    await bot.sendMessage(chatId, `📝 معامله **${parsed.side === 'buy' ? 'خرید' : 'فروش'} از ${parsed.name}**${parsed.rate ? ` با نرخ **${renderer.F2(parsed.rate)}**` : ''} تشخیص داده شد.\n\n👇 لطفاً **مبلغ معامله به تومان** را بفرستید (مثلاً: ۲ م یا ۵۰۰ هزار):`, { parse_mode: 'Markdown' });
    return;
  }

  if (!parsed.rate || parsed.rate <= 0) {
    userSessions.set(chatId, { type: 'ask_rate_for_deal', deal: parsed });
    await bot.sendMessage(chatId, `📝 معامله **${parsed.side === 'buy' ? 'خرید' : 'فروش'} از ${parsed.name}** به مبلغ **${renderer.F(parsed.amount)} تومان** تشخیص داده شد.\n\n👇 لطفاً **نرخ معامله** را بفرستید (مثلاً: ۲۵۶۰۰۰):`, { parse_mode: 'Markdown' });
    return;
  }

  const convertedUsd = convertTomanToUsd(parsed.amount, parsed.rate);

  if (parsed.targetListName) {
    const normTarget = normalizeText(parsed.targetListName);
    let target = state.lists.find(l => normalizeText(l.name).includes(normTarget));
    if (!target) {
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

  // Show list buttons for interactive destination selection
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
          { text: '🖼️ خروجی تصویر (برش دقیق)', callback_data: `get_image:${target.id}` },
          { text: '📄 دریافت PDF', callback_data: `get_pdf:${target.id}` }
        ],
        [
          { text: '💬 ارسال به واتساپ با عکس', callback_data: `send_wa:${target.id}` }
        ]
      ]
    }
  });
}

// 11. Search Execution
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

// 12. Transaction & List Management UI
async function showTradesForManage(chatId, list) {
  if (!list || !list.trades || list.trades.length === 0) {
    await bot.sendMessage(chatId, `❌ در لیست **${list?.name || 'فعلی'}** هیچ معامله‌ای برای ویرایش یا حذف ثبت نشده است.`);
    return;
  }

  let msg = `⚙️ **معاملات لیست «${list.name}» جهت ویرایش یا حذف:**\n━━━━━━━━━━━━━━━━━━━━\n`;
  const buttons = [];

  list.trades.forEach((t, i) => {
    const idx = i + 1;
    const icon = t.side === 'buy' ? '🟢 خرید' : '🔴 فروش';
    msg += `**#${idx}.** ${icon} ${t.name} | ${renderer.F(t.toman)} تومان (نرخ ${renderer.F2(t.rate)})\n`;
    buttons.push([
      { text: `✏️ ویرایش #${idx} (${t.name})`, callback_data: `edit_trade:${list.id}:${t.id}` },
      { text: `🗑️ حذف #${idx}`, callback_data: `del_trade:${list.id}:${t.id}` }
    ]);
  });

  await bot.sendMessage(chatId, msg, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons.slice(0, 10) }
  });
}

async function showListsForManage(chatId) {
  const state = getUserState(chatId);
  let msg = `📁 **مدیریت لیست‌های صرافی:**\nبرای ویرایش یا حذف لیست، دکمه مربوطه را لمس فرمایید:\n━━━━━━━━━━━━━━━━━━━━\n`;
  const buttons = [];

  state.lists.forEach((l) => {
    const count = l.trades ? l.trades.length : 0;
    const isAct = l.id === state.activeListId;
    msg += `• **${l.name}** (${count} معامله) ${isAct ? '⭐ فعال' : ''}\n`;
    buttons.push([
      { text: `✏️ تغییر نام: ${l.name}`, callback_data: `rename_list:${l.id}` },
      { text: `🗑️ حذف لیست`, callback_data: `delete_list:${l.id}` }
    ]);
  });

  buttons.push([{ text: '➕ ایجاد لیست جدید', callback_data: 'create_new_list' }]);

  await bot.sendMessage(chatId, msg, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

async function deleteTradeByCustomerOrDetail(chatId, list, target) {
  if (!list || !list.trades) return;
  const normTarget = normalizeText(target);
  const rowNum = parseInt(target, 10);

  let foundIndex = -1;
  if (!isNaN(rowNum) && rowNum > 0 && rowNum <= list.trades.length) {
    foundIndex = rowNum - 1;
  } else {
    foundIndex = list.trades.findIndex(t => normalizeText(t.name).includes(normTarget));
  }

  if (foundIndex >= 0) {
    const deleted = list.trades.splice(foundIndex, 1)[0];
    saveData();
    await bot.sendMessage(chatId, `🗑️ معامله متعلق به **${deleted.name}** (مبلغ: ${renderer.F(deleted.toman)} تومان) با موفقیت حذف گردید.`, { parse_mode: 'Markdown' });
  } else {
    await bot.sendMessage(chatId, `❌ معامله‌ای با مشخصات «${target}» یافت نشد.`);
  }
}

async function openEditForTrade(chatId, list, target) {
  if (!list || !list.trades) return;
  const normTarget = normalizeText(target);
  const rowNum = parseInt(target, 10);

  let trade = null;
  let idx = 0;
  if (!isNaN(rowNum) && rowNum > 0 && rowNum <= list.trades.length) {
    trade = list.trades[rowNum - 1];
    idx = rowNum;
  } else {
    const fIdx = list.trades.findIndex(t => normalizeText(t.name).includes(normTarget));
    if (fIdx >= 0) {
      trade = list.trades[fIdx];
      idx = fIdx + 1;
    }
  }

  if (trade) {
    sendEditTradeMenu(chatId, list.id, trade.id, idx);
  } else {
    await bot.sendMessage(chatId, `❌ معامله‌ای برای ویرایش با نام «${target}» پیدا نشد.`);
  }
}

function sendEditTradeMenu(chatId, listId, tradeId, rowNum) {
  const state = getUserState(chatId);
  const targetList = state.lists.find(l => l.id === listId);
  const trade = targetList?.trades.find(t => t.id === tradeId);
  if (!trade) return;

  const msg = `✏️ **ویرایش معامله ردیف #${rowNum}:**
• نام طرف معامله: **${trade.name}**
• نوع: **${trade.side === 'buy' ? 'خرید' : 'فروش'}**
• مبلغ: **${renderer.F(trade.toman)} تومان**
• نرخ: **${renderer.F2(trade.rate)}**
• معادل: **${renderer.F(trade.converted)} دالر**

👇 چه بخشی را می‌خواهید تغییر دهید؟`;

  bot.sendMessage(chatId, msg, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✏️ تغییر نام', callback_data: `edit_f:name:${listId}:${tradeId}` },
          { text: '✏️ تغییر مبلغ', callback_data: `edit_f:amount:${listId}:${tradeId}` }
        ],
        [
          { text: '✏️ تغییر نرخ', callback_data: `edit_f:rate:${listId}:${tradeId}` },
          { text: '🔄 تغییر به خرید/فروش', callback_data: `toggle_side:${listId}:${tradeId}` }
        ],
        [
          { text: '❌ انصراف', callback_data: 'cancel_edit' }
        ]
      ]
    }
  });
}

async function handleDeleteListByName(chatId, listName) {
  const state = getUserState(chatId);
  const norm = normalizeText(listName);
  const idx = state.lists.findIndex(l => normalizeText(l.name).includes(norm));

  if (idx < 0) {
    await bot.sendMessage(chatId, `❌ لیست «${listName}» پیدا نشد.`);
    return;
  }
  if (state.lists.length <= 1) {
    await bot.sendMessage(chatId, `⚠️ حداقل یک لیست باید در سیستم وجود داشته باشد و حذف آن مجاز نیست.`);
    return;
  }

  const deleted = state.lists.splice(idx, 1)[0];
  if (state.activeListId === deleted.id) {
    state.activeListId = state.lists[0].id;
  }
  saveData();
  await bot.sendMessage(chatId, `🗑️ لیست «**${deleted.name}**» با موفقیت حذف شد.`, { parse_mode: 'Markdown' });
}

// 13. Callback Query Handlers
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data || '';
  await bot.answerCallbackQuery(query.id);

  const state = getUserState(chatId);

  if (data.startsWith('save_to_list:')) {
    const listId = data.replace('save_to_list:', '');
    const session = userSessions.get(chatId);
    if (session && session.type === 'select_list_for_deal') {
      userSessions.delete(chatId);
      saveDealToList(chatId, listId, session.deal, session.deal.converted);
    }
    return;
  }

  if (data === 'deal_create_new_list') {
    userSessions.set(chatId, { type: 'create_list_name' });
    await bot.sendMessage(chatId, '📝 لطفاً نام لیست جدید را بنویسید (مثلاً: هرات جدید یا لیست همکاران):');
    return;
  }

  if (data === 'cancel_pending_deal') {
    userSessions.delete(chatId);
    await bot.sendMessage(chatId, '❌ ثبت معامله لغو شد.');
    return;
  }

  if (data.startsWith('get_image:')) {
    const listId = data.replace('get_image:', '');
    const list = state.lists.find(l => l.id === listId) || getActiveList(chatId);
    await sendImageReport(chatId, list);
    return;
  }

  if (data.startsWith('get_pdf:')) {
    const listId = data.replace('get_pdf:', '');
    const list = state.lists.find(l => l.id === listId) || getActiveList(chatId);
    await sendPdfReport(chatId, list);
    return;
  }

  if (data.startsWith('send_wa:')) {
    const listId = data.replace('send_wa:', '');
    const list = state.lists.find(l => l.id === listId) || getActiveList(chatId);
    await sendWhatsAppShare(chatId, list);
    return;
  }

  if (data.startsWith('copy_text:')) {
    const listId = data.replace('copy_text:', '');
    const list = state.lists.find(l => l.id === listId) || getActiveList(chatId);
    await sendTextReport(chatId, list);
    return;
  }

  if (data.startsWith('del_trade:')) {
    const parts = data.split(':');
    const listId = parts[1];
    const tradeId = parts[2];
    const targetList = state.lists.find(l => l.id === listId);
    if (targetList && targetList.trades) {
      const idx = targetList.trades.findIndex(t => t.id === tradeId);
      if (idx >= 0) {
        const deleted = targetList.trades.splice(idx, 1)[0];
        saveData();
        await bot.sendMessage(chatId, `🗑️ معامله متعلق به **${deleted.name}** (${renderer.F(deleted.toman)} تومان) با موفقیت حذف گردید.`, { parse_mode: 'Markdown' });
      }
    }
    return;
  }

  if (data.startsWith('edit_trade:')) {
    const parts = data.split(':');
    const listId = parts[1];
    const tradeId = parts[2];
    const targetList = state.lists.find(l => l.id === listId);
    if (targetList && targetList.trades) {
      const idx = targetList.trades.findIndex(t => t.id === tradeId);
      if (idx >= 0) {
        sendEditTradeMenu(chatId, listId, tradeId, idx + 1);
      }
    }
    return;
  }

  if (data.startsWith('edit_f:')) {
    const parts = data.split(':');
    const field = parts[1];
    const listId = parts[2];
    const tradeId = parts[3];

    userSessions.set(chatId, { type: 'edit_field', field, listId, tradeId });
    const fieldLabels = { name: 'نام جدید طرف معامله', amount: 'مبلغ جدید به تومان', rate: 'نرخ جدید' };
    await bot.sendMessage(chatId, `✏️ لطفاً **${fieldLabels[field] || 'مقدار جدید'}** را ارسال فرمایید:`);
    return;
  }

  if (data.startsWith('toggle_side:')) {
    const parts = data.split(':');
    const listId = parts[1];
    const tradeId = parts[2];
    const targetList = state.lists.find(l => l.id === listId);
    const trade = targetList?.trades.find(t => t.id === tradeId);
    if (trade) {
      trade.side = trade.side === 'buy' ? 'sell' : 'buy';
      saveData();
      await bot.sendMessage(chatId, `🔄 نوع معامله به **${trade.side === 'buy' ? '🟢 خرید' : '🔴 فروش'}** تغییر یافت.`, { parse_mode: 'Markdown' });
    }
    return;
  }

  if (data.startsWith('delete_list:')) {
    const listId = data.replace('delete_list:', '');
    if (state.lists.length <= 1) {
      await bot.sendMessage(chatId, '⚠️ امکان حذف تنها لیست موجود وجود ندارد.');
      return;
    }
    const idx = state.lists.findIndex(l => l.id === listId);
    if (idx >= 0) {
      const deleted = state.lists.splice(idx, 1)[0];
      if (state.activeListId === listId) {
        state.activeListId = state.lists[0].id;
      }
      saveData();
      await bot.sendMessage(chatId, `🗑️ لیست «**${deleted.name}**» حذف شد.`, { parse_mode: 'Markdown' });
    }
    return;
  }

  if (data.startsWith('rename_list:')) {
    const listId = data.replace('rename_list:', '');
    userSessions.set(chatId, { type: 'rename_list', listId });
    await bot.sendMessage(chatId, '✏️ لطفاً نام جدید لیست را ارسال فرمایید:');
    return;
  }

  if (data === 'create_new_list') {
    userSessions.set(chatId, { type: 'create_list_name' });
    await bot.sendMessage(chatId, '📝 لطفاً نام لیست جدید را ارسال فرمایید:');
    return;
  }

  if (data === 'cancel_edit') {
    userSessions.delete(chatId);
    await bot.sendMessage(chatId, '❌ ویرایش لغو شد.');
    return;
  }
});

async function handleEditFieldExecution(chatId, session, text) {
  const state = getUserState(chatId);
  const targetList = state.lists.find(l => l.id === session.listId);
  const trade = targetList?.trades.find(t => t.id === session.tradeId);
  if (!trade) {
    await bot.sendMessage(chatId, '❌ معامله پیدا نشد.');
    return;
  }

  if (session.field === 'name') {
    trade.name = text.trim();
    saveData();
    await bot.sendMessage(chatId, `✅ نام مشتری به **${trade.name}** تغییر یافت.`, { parse_mode: 'Markdown' });
  } else if (session.field === 'amount') {
    const p = parsePersianTrade(text);
    const amt = p.amount || Number(normalizeText(text).replace(/[^\d.]/g, ''));
    if (amt > 0) {
      trade.toman = amt;
      trade.converted = convertTomanToUsd(trade.toman, trade.rate);
      saveData();
      await bot.sendMessage(chatId, `✅ مبلغ معامله به **${renderer.F(trade.toman)} تومان** (${renderer.F(trade.converted)} دالر) ویرایش شد.`, { parse_mode: 'Markdown' });
    }
  } else if (session.field === 'rate') {
    const p = parsePersianTrade(text);
    const r = p.rate || Number(normalizeText(text).replace(/[^\d.]/g, ''));
    if (r > 0) {
      trade.rate = r;
      trade.converted = convertTomanToUsd(trade.toman, trade.rate);
      saveData();
      await bot.sendMessage(chatId, `✅ نرخ معامله به **${renderer.F2(trade.rate)}** (${renderer.F(trade.converted)} دالر) ویرایش شد.`, { parse_mode: 'Markdown' });
    }
  }
}

// 14. Report Generators & WhatsApp Sharing with BOTH Image and Text
async function sendImageReport(chatId, list) {
  try {
    const dateText = getPersianDateText();
    const statusMsg = await bot.sendMessage(chatId, '⏳ در حال رندر و تولید تصویر فاکتور با کیفیت بالا (Vazirmatn)...');

    const imageBuffer = renderer.renderReportImage(list, null, dateText);

    await bot.sendPhoto(chatId, imageBuffer, {
      caption: `🖼️ **تصویر رسمی صورت معاملات: ${list.name}**\n• برش دقیق به اندازه جدول‌ها\n• فونت رسمی Vazirmatn\n• ارقام تفکیک‌شده`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💬 اشتراک مستقیم در واتساپ', callback_data: `send_wa:${list.id}` }],
          [{ text: '📄 دریافت PDF چاپی', callback_data: `get_pdf:${list.id}` }]
        ]
      }
    });

    try { await bot.deleteMessage(chatId, statusMsg.message_id); } catch (_) {}
  } catch (err) {
    console.error('sendImageReport error:', err);
    await bot.sendMessage(chatId, '❌ خطا در تولید تصویر فاکتور.');
  }
}

async function sendPdfReport(chatId, list) {
  try {
    const dateText = getPersianDateText();
    const statusMsg = await bot.sendMessage(chatId, '⏳ در حال ساخت سند PDF تمیز و رسمی...');

    const pdfBuffer = await renderer.renderReportPdf(list, null, dateText);

    await bot.sendDocument(chatId, pdfBuffer, {
      caption: `📄 **فایل PDF رسمی: صورت معاملات ${list.name}**\nبدون متن‌های اضافه سربرگ یا پاورقی. مناسب برای چاپ و بایگانی.`,
      parse_mode: 'Markdown'
    }, {
      filename: `صورتحساب_معاملات_${list.name.replace(/\s+/g, '_')}.pdf`,
      contentType: 'application/pdf'
    });

    try { await bot.deleteMessage(chatId, statusMsg.message_id); } catch (_) {}
  } catch (err) {
    console.error('sendPdfReport error:', err);
    await bot.sendMessage(chatId, '❌ خطا در ساخت فایل PDF.');
  }
}

async function sendTextReport(chatId, list) {
  const dateText = getPersianDateText();
  const text = renderer.generateTextReport(list, dateText);
  await bot.sendMessage(chatId, `📋 **گزارش متنی معاملات صرافی:**\n\n\`\`\`\n${text}\n\`\`\``, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '💬 ارسال به واتساپ با عکس', callback_data: `send_wa:${list.id}` }],
        [{ text: '🖼️ دریافت عکس', callback_data: `get_image:${list.id}` }, { text: '📄 دریافت PDF', callback_data: `get_pdf:${list.id}` }]
      ]
    }
  });
}

/**
 * Send WhatsApp report WITH BOTH Image and Formatted Text
 */
async function sendWhatsAppShare(chatId, list) {
  try {
    const dateText = getPersianDateText();
    const text = renderer.generateTextReport(list, dateText);
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;

    const imgBuffer = renderer.renderReportImage(list, null, dateText);

    await bot.sendPhoto(chatId, imgBuffer, {
      caption: `📊 *صورتحساب معاملات ${list.name}*\n\nتصویر فاکتور به همراه متن اختصاصی برای ارسال به واتس‌اپ آماده شد. می‌توانید این تصویر را مستقیماً فوروارد کنید یا دکمه زیر را برای باز کردن واتس‌اپ لمس نمایید.`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💬 باز کردن و ارسال در واتساپ', url: waUrl }],
          [{ text: '📄 دریافت PDF', callback_data: `get_pdf:${list.id}` }, { text: '📋 کپی متن کامل', callback_data: `copy_text:${list.id}` }]
        ]
      }
    });

    await bot.sendMessage(chatId, `📋 *متن گزارش برای ارسال به واتس‌اپ:*\n\`\`\`\n${text}\n\`\`\``, {
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('sendWhatsAppShare error:', err);
    await bot.sendMessage(chatId, '❌ خطا در آماده‌سازی خروجی واتساپ.');
  }
}

async function sendSummaryReport(chatId, list) {
  const fin = renderer.calculateList(list.trades);
  let statusText = '🔹 وضعیت: یر به یر (۰ دالر)';
  if (fin.profit > 0) statusText = `🎉 مفاد خالص: **+${renderer.F(fin.profit)} دالر**`;
  else if (fin.profit < 0) statusText = `⚠️ ضرر: **${renderer.F(Math.abs(fin.profit))} دالر**`;

  const summary = `📊 **خلاصه وضعیت مالی: ${list.name}**
━━━━━━━━━━━━━━━━━━━━
🟢 **مجموع خرید:** ${renderer.F(fin.buy.toman)} تومان (${renderer.F(fin.buy.total)} دالر)
• نرخ اوسط خرید: **${renderer.F(fin.buy.avg)}**
• تعداد معاملات خرید: **${fin.buy.count}**

🔴 **مجموع فروش:** ${renderer.F(fin.sell.toman)} تومان (${renderer.F(fin.sell.total)} دالر)
• نرخ اوسط فروش: **${renderer.F(fin.sell.avg)}**
• تعداد معاملات فروش: **${fin.sell.count}**
━━━━━━━━━━━━━━━━━━━━
${statusText}
تعداد کل معاملات لیست: **${list.trades ? list.trades.length : 0} فقره**`;

  await bot.sendMessage(chatId, summary, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🖼️ خروجی عکس', callback_data: `get_image:${list.id}` },
          { text: '📄 خروجی PDF', callback_data: `get_pdf:${list.id}` }
        ],
        [
          { text: '💬 خروجی واتس‌اپ با عکس', callback_data: `send_wa:${list.id}` },
          { text: '🗑️ حذف یا ویرایش', callback_data: `manage_tr:${list.id}` }
        ]
      ]
    }
  });
}

async function sendListDetails(chatId, list) {
  const fin = renderer.calculateList(list.trades);
  const text = `📁 **اطلاعات لیست جاری:**
نام لیست: **${list.name}**
کد لیست: \`${list.code || 'بدون کد'}\`
تعداد کل معاملات: **${list.trades ? list.trades.length : 0}**
مجموع خرید: **${renderer.F(fin.buy.toman)} تومان** (${renderer.F(fin.buy.total)} دالر)
مجموع فروش: **${renderer.F(fin.sell.toman)} تومان** (${renderer.F(fin.sell.total)} دالر)`;

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🖼️ خروجی تصویر', callback_data: `get_image:${list.id}` },
          { text: '📄 خروجی PDF', callback_data: `get_pdf:${list.id}` }
        ],
        [
          { text: '💬 ارسال به واتساپ با عکس', callback_data: `send_wa:${list.id}` },
          { text: '⚙️ مدیریت معاملات این لیست', callback_data: `manage_tr:${list.id}` }
        ]
      ]
    }
  });
}

async function sendListManagement(chatId) {
  await showListsForManage(chatId);
}

function handleCreateList(chatId, name) {
  const state = getUserState(chatId);
  const clean = name.trim();
  if (!clean) return;

  const newList = {
    id: 'list_' + Date.now(),
    name: clean,
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
