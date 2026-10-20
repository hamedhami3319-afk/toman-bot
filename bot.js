/**
 * Toman Exchange Telegram Bot
 * Highly optimized, lightweight, production-ready bot for Toman transactions
 * Designed for free deployment on Render.com & GitHub
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ==========================================
// 1. CONFIGURATION & ENVIRONMENT
// ==========================================
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('❌ ERROR: BOT_TOKEN is not set in environment variables!');
  console.error('Please add BOT_TOKEN in Render Environment variables or in .env file.');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'exchange_data.json');

// Initialize Telegram Bot with polling
const bot = new TelegramBot(token, { polling: true });

// ==========================================
// 2. DATA STORAGE & PERSISTENCE
// ==========================================
let db = {
  lists: [
    {
      id: 'list-1',
      name: 'لیست اصلی',
      code: 'T-1405-0001',
      createdAt: Date.now(),
      trades: []
    }
  ],
  activeListId: 'list-1',
  userStates: {} // for slot-filling conversations
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      db = JSON.parse(raw);
      if (!db.lists || db.lists.length === 0) {
        db.lists = [{ id: 'list-1', name: 'لیست اصلی', code: 'T-1405-0001', createdAt: Date.now(), trades: [] }];
        db.activeListId = 'list-1';
      }
      console.log('✅ Data loaded successfully. Total lists:', db.lists.length);
    }
  } catch (err) {
    console.error('⚠️ Could not load data file, starting with default:', err.message);
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('⚠️ Could not save data file:', err.message);
  }
}

loadData();

function getActiveList() {
  return db.lists.find(l => l.id === db.activeListId) || db.lists[0];
}

// ==========================================
// 3. PERSIAN TEXT, DATE & NUMBER UTILS
// ==========================================
const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const ARABIC_PERSIAN_MAP = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

function toFaDigits(str) {
  return String(str).replace(/\d/g, d => PERSIAN_DIGITS[parseInt(d, 10)] || d);
}

function fmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '۰';
  const rounded = Math.round(Number(n));
  const s = new Intl.NumberFormat('en-US').format(rounded);
  return toFaDigits(s);
}

function fmtDec(n) {
  if (n === null || n === undefined || isNaN(n)) return '۰';
  const s = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(n));
  return toFaDigits(s);
}

function normalize(s) {
  if (!s) return '';
  let str = String(s).normalize('NFKC');
  let clean = '';
  for (const ch of str) {
    clean += ARABIC_PERSIAN_MAP[ch] || ch;
  }
  return clean
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/٫/g, '.')
    .replace(/،/g, ',')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u200c\u200d\u200e\u200f\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Jalali date converter
function gregorianToJalali(gy, gm, gd) {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + g_d_m[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let jm, jd;
  if (days < 186) {
    jm = 1 + Math.floor(days / 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + Math.floor((days - 186) / 30);
    jd = 1 + ((days - 186) % 30);
  }
  return [jy, jm, jd];
}

const FA_WEEKDAYS = ['یک‌شنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'];
const FA_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

function getPersianDateStr(timestamp = Date.now()) {
  const d = new Date(timestamp);
  const [jy, jm, jd] = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const monthName = FA_MONTHS[Math.min(11, Math.max(0, jm - 1))];
  const dow = FA_WEEKDAYS[d.getDay()] || '';
  return `${dow} ـ ${toFaDigits(jd)} ${monthName} ${toFaDigits(jy)}`;
}

// Words to numbers
const W_UNITS = {
  'صفر': 0, 'یک': 1, 'يك': 1, 'دو': 2, 'سه': 3, 'چهار': 4,
  'پنج': 5, 'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9,
  'ده': 10, 'یازده': 11, 'دوازده': 12, 'سیزده': 13, 'چهارده': 14,
  'پانزده': 15, 'پونزده': 15, 'شانزده': 16, 'شونزده': 16, 'هفده': 17,
  'هجده': 18, 'هیجده': 18, 'نوزده': 19,
  'بیست': 20, 'سی': 30, 'چهل': 40, 'پنجاه': 50, 'شصت': 60,
  'هفتاد': 70, 'هشتاد': 80, 'نود': 90,
  'صد': 100, 'یکصد': 100, 'دویست': 200, 'سیصد': 300, 'چهارصد': 400,
  'پانصد': 500, 'ششصد': 600, 'هفتصد': 700, 'هشتصد': 800, 'نهصد': 900
};

const W_MULTIS = {
  'هزار': 1e3,
  'میلیون': 1e6,
  'ملیون': 1e6,
  'میلیارد': 1e9,
  'ملیارد': 1e9,
  'بلیون': 1e9,
  'همت': 1e12
};

function convertWords(text) {
  if (!text) return '';
  const toks = text.split(/\s+/).filter(Boolean);
  const out = [];

  for (let i = 0; i < toks.length; ) {
    const w = toks[i];
    const isNumToken = (W_UNITS[w] !== undefined || W_MULTIS[w] !== undefined || /^\d+([.,]\d+)?$/.test(w)) && w !== 'و';
    if (!isNumToken) {
      out.push(w);
      i++;
      continue;
    }

    let j = i;
    let last = i;
    while (j < toks.length) {
      const x = toks[j];
      const isWord = W_UNITS[x] !== undefined || W_MULTIS[x] !== undefined || /^\d+([.,]\d+)?$/.test(x);
      if (x === 'و') {
        const nx = toks[j + 1];
        if (nx && (W_UNITS[nx] !== undefined || W_MULTIS[nx] !== undefined)) {
          j++;
          continue;
        }
        break;
      }
      if (isWord) {
        last = j;
        j++;
        continue;
      }
      break;
    }

    const sub = toks.slice(i, last + 1);
    let total = 0, cur = 0, valid = true;
    for (const t of sub) {
      if (t === 'و') continue;
      if (W_MULTIS[t]) {
        const m = W_MULTIS[t];
        if (m === 1e3) cur = (cur !== 0 ? cur : 1) * 1e3;
        else { total += (cur !== 0 ? cur : 1) * m; cur = 0; }
      } else {
        const val = /^\d+([.,]\d+)?$/.test(t) ? parseFloat(t.replace(/,/g, '')) : W_UNITS[t];
        if (val === undefined || isNaN(val)) { valid = false; break; }
        cur += val;
      }
    }

    const calculated = total + cur;
    if (valid && calculated >= 1000) {
      out.push(String(calculated));
      i = last + 1;
    } else {
      out.push(w);
      i++;
    }
  }

  return out.join(' ');
}

// ==========================================
// 4. NATURAL LANGUAGE TRADE PARSER
// ==========================================
const MULTIPLIERS = {
  'میلیون': 1_000_000,
  'ملیون': 1_000_000,
  'م': 1_000_000,
  'm': 1_000_000,
  'میلیارد': 1_000_000_000,
  'ملیارد': 1_000_000_000,
  'ب': 1_000_000_000,
  'b': 1_000_000_000,
  'همت': 1_000_000_000_000,
  'هزار': 1_000,
  'k': 1_000
};

const BUY_WORDS = ['خرید', 'خریدم', 'خر', 'خ', 'buy', 'bought'];
const SELL_WORDS = ['فروش', 'فروختم', 'فر', 'ف', 'sell', 'sold'];
const STOP_WORDS = new Set([
  'به', 'از', 'با', 'در', 'برای', 'تومان', 'تومن', 'دلار', 'نرخ', 'فی', 'قیمت', 'rate', 'fee', '@',
  'ثبت', 'کن', 'بزن', 'انجام', 'بده', 'معامله', 'آقا', 'اقای', 'حاج', 'حاجی', 'سید', 'برادر', 'محترم'
]);

function parseSingleTrade(text, defaultSide = null) {
  let t = convertWords(normalize(text));
  let side = defaultSide;
  let province = '';
  let description = '';

  // Description
  const descM = /(?:توضیح|بابت|یادداشت)\s*[:=]\s*(.+)$/i.exec(t);
  if (descM) {
    description = descM[1].trim();
    t = t.substring(0, descM.index).trim();
  }

  // Province
  const provM = /(?:ولایت|شهر)\s+([^\s\d]+)/i.exec(t);
  if (provM) {
    province = provM[1].trim();
    t = (t.substring(0, provM.index) + ' ' + t.substring(provM.index + provM[0].length)).trim();
  }

  // Side
  const toks = t.split(/\s+/);
  if (toks.some(w => BUY_WORDS.includes(w))) side = 'buy';
  else if (toks.some(w => SELL_WORDS.includes(w))) side = 'sell';

  // Amount with units
  let amountToman = null;
  const amtRegex = /(\d[\d,]*(?:\.\d+)?)\s*(میلیارد|ملیارد|میلیون|ملیون|همت|هزار|م|ب|k|b)(?![\p{L}])/giu;
  const amtMatches = Array.from(t.matchAll(amtRegex));
  let bestAmtText = '';
  for (const m of amtMatches) {
    const num = parseFloat(m[1].replace(/,/g, ''));
    if (num > 0) {
      const mul = MULTIPLIERS[m[2].toLowerCase()] || 1;
      const v = Math.round(num * mul);
      if (!amountToman || v > amountToman) {
        amountToman = v;
        bestAmtText = m[0];
      }
    }
  }

  // Rate
  let rate = null;
  const rateKeywordMatch = /(?:نرخ|فی|قیمت|fee|rate|@)\s*[:=]?\s*(\d[\d,]*(?:\.\d+)?)/i.exec(t);
  if (rateKeywordMatch) {
    const num = parseFloat(rateKeywordMatch[1].replace(/,/g, ''));
    if (num > 0) rate = num;
  }

  if (!rate) {
    const restForRate = bestAmtText ? t.replace(bestAmtText, ' ') : t;
    const candRegex = /(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d{4,7})(?![\d,])/g;
    const allCandidates = [];
    let cm;
    while ((cm = candRegex.exec(restForRate)) !== null) {
      const n = parseFloat(cm[1].replace(/,/g, ''));
      if (n >= 10000 && n <= 10000000) allCandidates.push(n);
    }
    if (allCandidates.length === 1) rate = allCandidates[0];
  }

  // Fallback numbers for amount
  if (!amountToman || !rate) {
    const plainNums = [];
    const numRe = /(?<![\d.,])(\d[\d,]*)(?![\d,])/g;
    let pm;
    while ((pm = numRe.exec(t)) !== null) {
      const val = parseFloat(pm[1].replace(/,/g, ''));
      if (!isNaN(val)) plainNums.push(val);
    }
    if (plainNums.length === 2) {
      const n1 = plainNums[0], n2 = plainNums[1];
      if (n2 >= 10000 && n2 <= 10000000) {
        amountToman = amountToman || n1;
        rate = rate || n2;
      } else {
        amountToman = amountToman || n1;
        rate = rate || n2;
      }
    } else if (plainNums.length === 1 && !amountToman) {
      if (plainNums[0] < 10000 || plainNums[0] > 10000000) {
        amountToman = plainNums[0];
      }
    }
  }

  // Customer Name
  let rest = t
    .replace(/(\d[\d,]*(?:\.\d+)?)\s*(میلیارد|ملیارد|میلیون|ملیون|همت|هزار|م|ب|k|b)(?![\p{L}])/giu, ' ')
    .replace(/(?:نرخ|فی|قیمت|rate|fee|@)\s*[:=]?\s*\d[\d,]*(?:\.\d+)?/gi, ' ')
    .replace(/(?:خرید|فروش|خریدم|فروختم|خر|فر|buy|sell)/gi, ' ')
    .replace(/[\d,. "'\-_/\\@#*+=<>؛:!؟?]/g, ' ')
    .replace(/\s+/g, ' ');

  const nameWords = rest.split(' ').filter(w => w && !STOP_WORDS.has(w) && !BUY_WORDS.includes(w) && !SELL_WORDS.includes(w));
  const name = nameWords.join(' ').trim() || null;

  const missing = [];
  if (!side) missing.push('side');
  if (!name) missing.push('name');
  if (!amountToman) missing.push('amountToman');
  if (!rate) missing.push('rate');

  const converted = (amountToman && rate) ? Math.round(amountToman / rate) : null;

  return {
    side,
    name,
    amountToman,
    rate,
    converted,
    province,
    description,
    missing,
    originalText: text.trim()
  };
}

// ==========================================
// 5. REPORT & SUMMARY GENERATION
// ==========================================
function calculateList(trades) {
  const buys = trades.filter(t => t.side === 'buy');
  const sells = trades.filter(t => t.side === 'sell');

  function sideCalc(items) {
    const tomanSum = items.reduce((acc, t) => acc + Math.round(t.toman), 0);
    const totalUsd = items.reduce((acc, t) => acc + t.converted, 0);
    const count = items.length;
    const avg = totalUsd > 0 && tomanSum > 0 ? Math.round(tomanSum / totalUsd) : 0;
    return { tomanSum, totalUsd, count, avg };
  }

  const buy = sideCalc(buys);
  const sell = sideCalc(sells);
  const profit = sell.totalUsd - buy.totalUsd;
  const diffToman = buy.tomanSum - sell.tomanSum;

  return { buy, sell, profit, diffToman };
}

function getReportText(list) {
  const calc = calculateList(list.trades);
  const dateStr = getPersianDateStr(list.createdAt || Date.now());
  const buys = list.trades.filter(t => t.side === 'buy');
  const sells = list.trades.filter(t => t.side === 'sell');

  let text = `📊 **گزارش صورت معاملات: ${list.name}**`;
  if (list.code) text += ` (کد: \`${list.code}\`)`;
  text += `\n📅 تاریخ: ${dateStr}\n`;
  text += '━━━━━━━━━━━━━━━━━━━━━━\n';

  // Purchases
  text += `🟢 **خریدها (${toFaDigits(buys.length)} معامله):**\n`;
  if (buys.length === 0) {
    text += '  معامله‌ای ثبت نشده است.\n';
  } else {
    buys.forEach((t, i) => {
      text += `  ${toFaDigits(i + 1)}. **${t.name}**: ${fmtNum(t.toman)} تومان | نرخ ${fmtDec(t.rate)} = **${fmtNum(t.converted)} $**`;
      if (t.province) text += ` (${t.province})`;
      if (t.description) text += ` [${t.description}]`;
      text += '\n';
    });
    text += `  جمع خرید: **${fmtNum(calc.buy.totalUsd)} دلار**\n`;
    text += `  مجموع تومان: ${fmtNum(calc.buy.tomanSum)} تومان\n`;
    text += `  میانگین نرخ خرید: **${fmtNum(calc.buy.avg)}**\n`;
  }

  text += '──────────────────────\n';

  // Sales
  text += `🔴 **فروش‌ها (${toFaDigits(sells.length)} معامله):**\n`;
  if (sells.length === 0) {
    text += '  معامله‌ای ثبت نشده است.\n';
  } else {
    sells.forEach((t, i) => {
      text += `  ${toFaDigits(i + 1)}. **${t.name}**: ${fmtNum(t.toman)} تومان | نرخ ${fmtDec(t.rate)} = **${fmtNum(t.converted)} $**`;
      if (t.province) text += ` (${t.province})`;
      if (t.description) text += ` [${t.description}]`;
      text += '\n';
    });
    text += `  جمع فروش: **${fmtNum(calc.sell.totalUsd)} دلار**\n`;
    text += `  مجموع تومان: ${fmtNum(calc.sell.tomanSum)} تومان\n`;
    text += `  میانگین نرخ فروش: **${fmtNum(calc.sell.avg)}**\n`;
  }

  text += '━━━━━━━━━━━━━━━━━━━━━━\n';

  // Balance & Profit/Loss
  if (calc.diffToman > 0) {
    text += `⚖️ موازنه تومانی: **${fmtNum(calc.diffToman)} تومان بیشتر باید فروخته شود**\n`;
  } else if (calc.diffToman < 0) {
    text += `⚖️ موازنه تومانی: **${fmtNum(Math.abs(calc.diffToman))} تومان بیشتر باید خریده شود**\n`;
  } else if (buys.length > 0 || sells.length > 0) {
    text += '⚖️ موازنه تومانی: تراز کامل\n';
  }

  if (calc.profit > 0) {
    text += `🎉 **نتیجه مالی: سود +${fmtNum(calc.profit)} دلار**\n`;
  } else if (calc.profit < 0) {
    text += `⚠️ **نتیجه مالی: زیان ${fmtNum(calc.profit)} دلار**\n`;
  } else {
    text += '🔹 **نتیجه مالی: ۰ دلار (سربه‌سر)**\n';
  }

  text += '━━━━━━━━━━━━━━━━━━━━━━\n';
  text += '🤖 ربات صرافی هوشمند';
  return text;
}

function getSummaryText(list) {
  const calc = calculateList(list.trades);
  return `📊 **خلاصه وضعیت: ${list.name}**
━━━━━━━━━━━━━━━━━━━━━━
🟢 **خرید:** ${fmtNum(calc.buy.totalUsd)} دلار | میانگین نرخ: ${fmtNum(calc.buy.avg)}
🔴 **فروش:** ${fmtNum(calc.sell.totalUsd)} دلار | میانگین نرخ: ${fmtNum(calc.sell.avg)}
━━━━━━━━━━━━━━━━━━━━━━
${calc.diffToman > 0 ? `⚖️ تراز: ${fmtNum(calc.diffToman)} تومان باید فروخته شود` : calc.diffToman < 0 ? `⚖️ تراز: ${fmtNum(Math.abs(calc.diffToman))} تومان باید خریده شود` : '⚖️ تراز: کامل'}
${calc.profit > 0 ? `🎉 سود خالص: **+${fmtNum(calc.profit)} دلار**` : calc.profit < 0 ? `⚠️ زیان: **${fmtNum(calc.profit)} دلار**` : '🔹 وضعیت: سربه‌سر'}
تعداد کل معاملات: ${toFaDigits(list.trades.length)} فقره`;
}

function getCustomerAccountText(customerName) {
  const cleanTarget = normalize(customerName);
  const allTrades = db.lists.flatMap(l => l.trades);
  const matched = allTrades.filter(t => normalize(t.name).includes(cleanTarget));

  if (matched.length === 0) {
    return `❌ هیچ معامله‌ای برای مشتری **${customerName}** پیدا نشد.`;
  }

  const buys = matched.filter(t => t.side === 'buy');
  const sells = matched.filter(t => t.side === 'sell');

  const buyToman = buys.reduce((acc, t) => acc + t.toman, 0);
  const buyUsd = buys.reduce((acc, t) => acc + t.converted, 0);
  const sellToman = sells.reduce((acc, t) => acc + t.toman, 0);
  const sellUsd = sells.reduce((acc, t) => acc + t.converted, 0);

  const netToman = buyToman - sellToman;
  const netUsd = buyUsd - sellUsd;

  let out = `👤 **صورتحساب مشتری: ${customerName}**\n`;
  out += `کل معاملات: ${toFaDigits(matched.length)} فقره\n`;
  out += '──────────────────────\n';
  out += `🟢 کل خرید: **${fmtNum(buyUsd)} دلار** (${fmtNum(buyToman)} تومان)\n`;
  out += `🔴 کل فروش: **${fmtNum(sellUsd)} دلار** (${fmtNum(sellToman)} تومان)\n`;
  out += '──────────────────────\n';

  if (netToman > 0) {
    out += `📌 **وضعیت: ${fmtNum(netToman)} تومان طلبکار** (${fmtNum(netUsd)} دلار)\n`;
  } else if (netToman < 0) {
    out += `📌 **وضعیت: ${fmtNum(Math.abs(netToman))} تومان بدهکار** (${fmtNum(Math.abs(netUsd))} دلار)\n`;
  } else {
    out += '📌 **وضعیت: کاملاً تسویه (صفر)**\n';
  }

  out += '──────────────────────\n';
  out += '📋 **معاملات اخیر:**\n';
  matched.slice(-6).forEach((t, i) => {
    const sideText = t.side === 'buy' ? '🟢 خرید' : '🔴 فروش';
    out += `  ${toFaDigits(i + 1)}. ${sideText}: ${fmtNum(t.toman)} ت | نرخ ${fmtDec(t.rate)} = **${fmtNum(t.converted)} $**\n`;
  });

  return out;
}

// ==========================================
// 6. MAIN KEYBOARD & MENUS
// ==========================================
const MAIN_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: '📊 خلاصه وضعیت' }, { text: '📋 گزارش کامل' }],
      [{ text: '📁 لیست‌ها' }, { text: '➕ لیست جدید' }],
      [{ text: '🗑 حذف آخرین معامله' }, { text: '❓ راهنما' }]
    ],
    resize_keyboard: true
  }
};

// ==========================================
// 7. BOT MESSAGE HANDLERS
// ==========================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const rawText = msg.text ? msg.text.trim() : '';

  if (!rawText) return;

  const currentList = getActiveList();
  const textNorm = normalize(rawText);

  // 1. Check for Pending Slot-Filling States
  const userState = db.userStates[chatId];
  if (userState && userState.step) {
    if (textNorm === 'لغو' || textNorm === '/cancel' || textNorm === 'انصراف') {
      delete db.userStates[chatId];
      bot.sendMessage(chatId, '❌ عملیات لغو شد.', MAIN_KEYBOARD);
      return;
    }

    if (userState.step === 'ask_new_list_name') {
      const name = rawText.trim();
      const codeSeq = String(db.lists.length + 1).padStart(4, '0');
      const newList = {
        id: 'list-' + Date.now(),
        name: name,
        code: 'T-1405-' + codeSeq,
        createdAt: Date.now(),
        trades: []
      };
      db.lists.push(newList);
      db.activeListId = newList.id;
      saveData();
      delete db.userStates[chatId];
      bot.sendMessage(chatId, `✅ لیست جدید **${name}** (کد: \`${newList.code}\`) ایجاد و فعال شد.`, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
      return;
    }

    if (userState.step === 'ask_missing_rate') {
      const rateNum = parseFloat(rawText.replace(/,/g, ''));
      if (rateNum > 0) {
        userState.trade.rate = rateNum;
        userState.trade.converted = Math.round(userState.trade.toman / rateNum);
        currentList.trades.push(userState.trade);
        saveData();
        delete db.userStates[chatId];

        const sideText = userState.trade.side === 'buy' ? '🟢 خرید' : '🔴 فروش';
        bot.sendMessage(chatId, `✅ معامله با موفقیت ثبت شد:\n${sideText}: **${userState.trade.name}**\nمبلغ: ${fmtNum(userState.trade.toman)} تومان\nنرخ: ${fmtDec(rateNum)}\nمعادل دلار: **${fmtNum(userState.trade.converted)} $**\nلیست: ${currentList.name}`, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
        return;
      } else {
        bot.sendMessage(chatId, '⚠️ لطفاً نرخ معامله را به صورت عدد صحیح وارد کنید (مثال: ۲۵۶۰۰۰۰):');
        return;
      }
    }

    if (userState.step === 'ask_missing_amount') {
      const parsedSingle = parseSingleTrade(rawText);
      const amt = parsedSingle.amountToman || parseFloat(rawText.replace(/,/g, ''));
      if (amt > 0) {
        userState.trade.toman = amt;
        if (userState.trade.rate) {
          userState.trade.converted = Math.round(amt / userState.trade.rate);
          currentList.trades.push(userState.trade);
          saveData();
          delete db.userStates[chatId];

          const sideText = userState.trade.side === 'buy' ? '🟢 خرید' : '🔴 فروش';
          bot.sendMessage(chatId, `✅ معامله ثبت شد:\n${sideText}: **${userState.trade.name}**\nمبلغ: ${fmtNum(amt)} تومان\nنرخ: ${fmtDec(userState.trade.rate)}\nمعادل: **${fmtNum(userState.trade.converted)} $**`, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
          return;
        } else {
          userState.step = 'ask_missing_rate';
          bot.sendMessage(chatId, 'لطفاً نرخ معامله را وارد کنید:');
          return;
        }
      } else {
        bot.sendMessage(chatId, '⚠️ لطفاً مبلغ را صحیح وارد کنید (مثال: ۲ میلیارد یا ۲۰۰۰ م):');
        return;
      }
    }
  }

  // 2. Commands & Keyboards
  if (textNorm === '/start' || textNorm === '❓ راهنما' || textNorm === '/help') {
    const welcome = `👋 **سلام صراف محترم! به ربات معاملات تومان خوش آمدید.**

📌 **لیست فعال کنونی:** ${currentList.name} ${currentList.code ? `(\`${currentList.code}\`)` : ''}

💡 **روش‌های ثبت معامله (متنی یا صوتی):**
۱. ثبت تکی سریع:
`خرید احمد ۲ م ۲۵۶۰۰۰۰`
`فروش صرافی امید ۴۰۰۰ نرخ ۲۶۵۰۰۰`

۲. ثبت دسته‌ای (چندخطی با هدر):
`خرید لیست هرات:
احمد ۲ م ۲۵۶۰۰۰۰
محمد ۴۰۰۰ ۲۶۵۰۰۰
علی ۵۰۰۰ ۲۷۰۰۰۰`

۳. دستورات ربات:
• 📊 خلاصه وضعیت (`/summary`)
• 📋 گزارش کامل (`/report`)
• 👤 استعلام صورتحساب مشتری: `حساب احمد`
• 🗑 حذف آخرین معامله (`/dellast`)
• 📁 مشاهده و تغییر لیست (`/lists`)
• ➕ ایجاد لیست جدید (`/newlist هرات`)
`;
    bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
    return;
  }

  if (textNorm === '📊 خلاصه وضعیت' || textNorm === '/summary') {
    bot.sendMessage(chatId, getSummaryText(currentList), { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
    return;
  }

  if (textNorm === '📋 گزارش کامل' || textNorm === '/report' || textNorm === 'گزارش') {
    bot.sendMessage(chatId, getReportText(currentList), { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
    return;
  }

  if (textNorm === '🗑 حذف آخرین معامله' || textNorm === '/dellast') {
    if (currentList.trades.length === 0) {
      bot.sendMessage(chatId, '❌ هیچ معامله‌ای در این لیست وجود ندارد.', MAIN_KEYBOARD);
      return;
    }
    const removed = currentList.trades.pop();
    saveData();
    const sideText = removed.side === 'buy' ? 'خرید' : 'فروش';
    bot.sendMessage(chatId, `🗑 آخرین معامله حذف شد:\n${sideText}: **${removed.name}** (${fmtNum(removed.toman)} ت | ${fmtNum(removed.converted)} $)`, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
    return;
  }

  if (textNorm === '📁 لیست‌ها' || textNorm === '/lists') {
    let out = '📁 **فهرست لیست‌های فعال شما:**\n\n';
    const inlineButtons = [];

    db.lists.forEach((l, i) => {
      const isActive = l.id === db.activeListId;
      const calc = calculateList(l.trades);
      out += `${toFaDigits(i + 1)}. ${isActive ? '👉 **' : ''}${l.name}${isActive ? ' (فعال)**' : ''} [\`${l.code}\`]\n   تعداد معاملات: ${toFaDigits(l.trades.length)} | سود/زیان: ${fmtNum(calc.profit)} $\n\n`;
      inlineButtons.push([{ text: `${isActive ? '✅ ' : ''}انتخاب ${l.name}`, callback_data: `select_list:${l.id}` }]);
    });

    bot.sendMessage(chatId, out, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineButtons }
    });
    return;
  }

  if (textNorm === '➕ لیست جدید' || textNorm.startsWith('/newlist')) {
    const explicitName = rawText.replace('/newlist', '').replace('➕ لیست جدید', '').trim();
    if (explicitName) {
      const codeSeq = String(db.lists.length + 1).padStart(4, '0');
      const newList = {
        id: 'list-' + Date.now(),
        name: explicitName,
        code: 'T-1405-' + codeSeq,
        createdAt: Date.now(),
        trades: []
      };
      db.lists.push(newList);
      db.activeListId = newList.id;
      saveData();
      bot.sendMessage(chatId, `✅ لیست جدید **${explicitName}** (کد: \`${newList.code}\`) ایجاد و فعال شد.`, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
    } else {
      db.userStates[chatId] = { step: 'ask_new_list_name' };
      bot.sendMessage(chatId, '📝 لطفاً نام لیست جدید را بنویسید (مثال: لیست کابل، هرات، تهران):', {
        reply_markup: { keyboard: [[{ text: 'لغو' }]], resize_keyboard: true }
      });
    }
    return;
  }

  // 3. Customer Account Query (e.g. "حساب احمد", "معاملات صرافی امید")
  const custMatch = /(?:حساب|معاملات|صورتحساب)\s+([^\s\d]+(?:\s+[^\s\d]+)?)/iu.exec(textNorm);
  if (custMatch) {
    const custName = custMatch[1].trim();
    bot.sendMessage(chatId, getCustomerAccountText(custName), { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
    return;
  }

  // 4. Multi-Line Batch Trades (e.g. "خرید هرات:
احمد ۲ م ۲۵۶۰۰۰۰
محمد ۴۰۰۰ ۲۶۵۰۰۰")
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const firstLineNorm = normalize(lines[0]);
    const headerMatch = /^(خرید|فروش)(?:\s+(?:لیست)?\s*)?[:=\-.]*\s*(.*)/iu.exec(firstLineNorm);

    let defaultSide = null;
    let targetList = currentList;

    let tradeLines = lines;
    if (headerMatch) {
      defaultSide = headerMatch[1].startsWith('فر') ? 'sell' : 'buy';
      const rawListName = headerMatch[2].trim();
      if (rawListName) {
        const found = db.lists.find(l => normalize(l.name).includes(normalize(rawListName)));
        if (found) targetList = found;
      }
      tradeLines = lines.slice(1);
    }

    let addedCount = 0;
    const addedSummaries = [];

    for (const line of tradeLines) {
      const parsed = parseSingleTrade(line, defaultSide);
      if (parsed.name && parsed.amountToman && parsed.rate && parsed.side) {
        const newTrade = {
          id: 'tr-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          listId: targetList.id,
          side: parsed.side,
          name: parsed.name,
          toman: parsed.amountToman,
          rate: parsed.rate,
          converted: parsed.converted,
          province: parsed.province || '',
          description: parsed.description || '',
          createdAt: Date.now()
        };
        targetList.trades.push(newTrade);
        addedCount++;
        addedSummaries.push(`  • ${parsed.side === 'buy' ? '🟢 خرید' : '🔴 فروش'}: ${parsed.name} | ${fmtNum(parsed.amountToman)} ت | نرخ ${fmtDec(parsed.rate)} = **${fmtNum(parsed.converted)} $**`);
      }
    }

    if (addedCount > 0) {
      saveData();
      let resMsg = `✅ تعداد ${toFaDigits(addedCount)} معامله در **${targetList.name}** ثبت شد:\n\n` + addedSummaries.join('\n');
      bot.sendMessage(chatId, resMsg, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
      return;
    }
  }

  // 5. Single Trade Natural Language Parsing (e.g. "خرید احمد ۲ م ۲۵۶۰۰۰۰")
  const singleParsed = parseSingleTrade(rawText);
  if (singleParsed.name && singleParsed.amountToman && singleParsed.rate && singleParsed.side) {
    const newTrade = {
      id: 'tr-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      listId: currentList.id,
      side: singleParsed.side,
      name: singleParsed.name,
      toman: singleParsed.amountToman,
      rate: singleParsed.rate,
      converted: singleParsed.converted,
      province: singleParsed.province || '',
      description: singleParsed.description || '',
      createdAt: Date.now()
    };
    currentList.trades.push(newTrade);
    saveData();

    const sideText = singleParsed.side === 'buy' ? '🟢 خرید' : '🔴 فروش';
    const repMsg = `✅ معامله با موفقیت ثبت شد:\n${sideText}: **${singleParsed.name}**\nمبلغ: ${fmtNum(singleParsed.amountToman)} تومان\nنرخ: ${fmtDec(singleParsed.rate)}\nمعادل دلار: **${fmtNum(singleParsed.converted)} $**\nلیست: ${currentList.name}`;
    bot.sendMessage(chatId, repMsg, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
    return;
  }

  // 6. Slot-Filling Assistant (If partial trade detected)
  if (singleParsed.name && (singleParsed.amountToman || singleParsed.side)) {
    if (!singleParsed.rate && singleParsed.amountToman) {
      db.userStates[chatId] = {
        step: 'ask_missing_rate',
        trade: {
          id: 'tr-' + Date.now(),
          listId: currentList.id,
          side: singleParsed.side || 'buy',
          name: singleParsed.name,
          toman: singleParsed.amountToman,
          province: singleParsed.province || '',
          description: singleParsed.description || '',
          createdAt: Date.now()
        }
      };
      bot.sendMessage(chatId, `مبلغ ${fmtNum(singleParsed.amountToman)} تومان برای ${singleParsed.name} مشخص شد. لطفاً **نرخ معامله** را ارسال کنید:`, {
        parse_mode: 'Markdown',
        reply_markup: { keyboard: [[{ text: 'لغو' }]], resize_keyboard: true }
      });
      return;
    }
  }

  // Default fallback
  bot.sendMessage(chatId, 'متوجه این پیام نشدم. برای ثبت معامله، مبلغ و نام و نرخ را وارد کنید (مثال: `خرید احمد ۲ میلیارد نرخ ۲۵۶۰۰۰۰`) یا از منوی زیر استفاده فرمایید.', {
    parse_mode: 'Markdown',
    ...MAIN_KEYBOARD
  });
});

// ==========================================
// 8. INLINE BUTTON CALLBACKS
// ==========================================
bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;

  if (data.startsWith('select_list:')) {
    const listId = data.replace('select_list:', '');
    const found = db.lists.find(l => l.id === listId);
    if (found) {
      db.activeListId = found.id;
      saveData();
      bot.answerCallbackQuery(query.id, { text: `لیست ${found.name} فعال شد.` });
      bot.sendMessage(chatId, `📌 لیست فعال تغییر یافت به: **${found.name}**`, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
    }
  }
});

// ==========================================
// 9. EXPRESS HTTP SERVER (REQUIRED FOR RENDER)
// ==========================================
const app = express();
app.get('/', (req, res) => {
  res.send({
    status: 'online',
    bot: 'Toman Exchange Telegram Bot',
    uptime: process.uptime(),
    listsCount: db.lists.length,
    activeList: getActiveList().name
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`🚀 Health server running on port ${PORT} for Render deployment.`);
  console.log('🤖 Telegram Bot is polling and ready to receive messages...');
});
