/**
 * Toman Exchange Telegram Bot
 * Highly optimized, lightweight, production-ready bot for Toman transactions
 * Includes: PDF Export, Image Export, Full Search, NLP Parser, Customer Accounts & Reports
 * Designed for free deployment on Render.com & GitHub
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');

// Optional dynamic import for PDF and Image rendering
let sharp = null;
let PDFDocument = null;
try {
  sharp = require('sharp');
  const pdfLib = require('pdf-lib');
  PDFDocument = pdfLib.PDFDocument;
} catch (e) {
  console.log('ℹ️ Note: sharp/pdf-lib loaded dynamically or will initialize when needed.');
}

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
  userStates: {}
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
      console.log('✅ Data loaded successfully. Total lists: ' + db.lists.length);
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

function getPersianDateStr(timestamp) {
  const d = new Date(timestamp || Date.now());
  const [jy, jm, jd] = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const monthName = FA_MONTHS[Math.min(11, Math.max(0, jm - 1))];
  const dow = FA_WEEKDAYS[d.getDay()] || '';
  return dow + ' ـ ' + toFaDigits(jd) + ' ' + monthName + ' ' + toFaDigits(jy);
}

function getPersianTimeStr(timestamp) {
  const d = new Date(timestamp || Date.now());
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return toFaDigits(h + ':' + m);
}

// Words to numbers (W2N)
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

function parseSingleTrade(text, defaultSide) {
  let t = convertWords(normalize(text));
  let side = defaultSide || null;
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
    const numRe = /(?<![\d.,])(\d[\\d,]*)(?![\d,])/g;
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
// 5. REPORT & SUMMARY CALCULATIONS
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

  const lines = [];
  lines.push('📊 *گزارش صورت معاملات: ' + list.name + '*');
  if (list.code) lines.push('کد لیست: ' + list.code);
  lines.push('📅 تاریخ: ' + dateStr);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━');

  // Purchases
  lines.push('🟢 *خریدها (' + toFaDigits(buys.length) + ' معامله):*');
  if (buys.length === 0) {
    lines.push('  معامله‌ای ثبت نشده است.');
  } else {
    buys.forEach((t, i) => {
      let l = '  ' + toFaDigits(i + 1) + '. *' + t.name + '*: ' + fmtNum(t.toman) + ' تومان | نرخ ' + fmtDec(t.rate) + ' = *' + fmtNum(t.converted) + ' $*';
      if (t.province) l += ' (' + t.province + ')';
      if (t.description) l += ' [' + t.description + ']';
      lines.push(l);
    });
    lines.push('  جمع خرید: *' + fmtNum(calc.buy.totalUsd) + ' دلار*');
    lines.push('  مجموع تومان: ' + fmtNum(calc.buy.tomanSum) + ' تومان');
    lines.push('  میانگین نرخ خرید: *' + fmtNum(calc.buy.avg) + '*');
  }

  lines.push('──────────────────────');

  // Sales
  lines.push('🔴 *فروش‌ها (' + toFaDigits(sells.length) + ' معامله):*');
  if (sells.length === 0) {
    lines.push('  معامله‌ای ثبت نشده است.');
  } else {
    sells.forEach((t, i) => {
      let l = '  ' + toFaDigits(i + 1) + '. *' + t.name + '*: ' + fmtNum(t.toman) + ' تومان | نرخ ' + fmtDec(t.rate) + ' = *' + fmtNum(t.converted) + ' $*';
      if (t.province) l += ' (' + t.province + ')';
      if (t.description) l += ' [' + t.description + ']';
      lines.push(l);
    });
    lines.push('  جمع فروش: *' + fmtNum(calc.sell.totalUsd) + ' دلار*');
    lines.push('  مجموع تومان: ' + fmtNum(calc.sell.tomanSum) + ' تومان');
    lines.push('  میانگین نرخ فروش: *' + fmtNum(calc.sell.avg) + '*');
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━');

  // Balance & Profit/Loss
  if (calc.diffToman > 0) {
    lines.push('⚖️ موازنه تومانی: *' + fmtNum(calc.diffToman) + ' تومان بیشتر باید فروخته شود*');
  } else if (calc.diffToman < 0) {
    lines.push('⚖️ موازنه تومانی: *' + fmtNum(Math.abs(calc.diffToman)) + ' تومان بیشتر باید خریده شود*');
  } else if (buys.length > 0 || sells.length > 0) {
    lines.push('⚖️ موازنه تومانی: تراز کامل');
  }

  if (calc.profit > 0) {
    lines.push('🎉 *نتیجه مالی: سود +' + fmtNum(calc.profit) + ' دلار*');
  } else if (calc.profit < 0) {
    lines.push('⚠️ *نتیجه مالی: زیان ' + fmtNum(calc.profit) + ' دلار*');
  } else {
    lines.push('🔹 *نتیجه مالی: ۰ دلار (سربه‌سر)*');
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('🤖 ربات صرافی هوشمند');
  return lines.join('\n');
}

function getSummaryText(list) {
  const calc = calculateList(list.trades);
  const diffLabel = calc.diffToman > 0
    ? '⚖️ تراز: ' + fmtNum(calc.diffToman) + ' تومان باید فروخته شود'
    : calc.diffToman < 0
    ? '⚖️ تراز: ' + fmtNum(Math.abs(calc.diffToman)) + ' تومان باید خریده شود'
    : '⚖️ تراز: کامل';

  const profitLabel = calc.profit > 0
    ? '🎉 سود خالص: *+' + fmtNum(calc.profit) + ' دلار*'
    : calc.profit < 0
    ? '⚠️ زیان: *' + fmtNum(calc.profit) + ' دلار*'
    : '🔹 وضعیت: سربه‌سر';

  const lines = [
    '📊 *خلاصه وضعیت: ' + list.name + '*',
    '━━━━━━━━━━━━━━━━━━━━━━',
    '🟢 *خرید:* ' + fmtNum(calc.buy.totalUsd) + ' دلار | میانگین نرخ: ' + fmtNum(calc.buy.avg),
    '🔴 *فروش:* ' + fmtNum(calc.sell.totalUsd) + ' دلار | میانگین نرخ: ' + fmtNum(calc.sell.avg),
    '━━━━━━━━━━━━━━━━━━━━━━',
    diffLabel,
    profitLabel,
    'تعداد کل معاملات: ' + toFaDigits(list.trades.length) + ' فقره'
  ];
  return lines.join('\n');
}

function getCustomerAccountText(customerName) {
  const cleanTarget = normalize(customerName);
  const allTrades = db.lists.flatMap(l => l.trades);
  const matched = allTrades.filter(t => normalize(t.name).includes(cleanTarget));

  if (matched.length === 0) {
    return '❌ هیچ معامله‌ای برای مشتری *' + customerName + '* پیدا نشد.';
  }

  const buys = matched.filter(t => t.side === 'buy');
  const sells = matched.filter(t => t.side === 'sell');

  const buyToman = buys.reduce((acc, t) => acc + t.toman, 0);
  const buyUsd = buys.reduce((acc, t) => acc + t.converted, 0);
  const sellToman = sells.reduce((acc, t) => acc + t.toman, 0);
  const sellUsd = sells.reduce((acc, t) => acc + t.converted, 0);

  const netToman = buyToman - sellToman;
  const netUsd = buyUsd - sellUsd;

  const lines = [
    '👤 *صورتحساب مشتری: ' + customerName + '*',
    'کل معاملات: ' + toFaDigits(matched.length) + ' فقره',
    '──────────────────────',
    '🟢 کل خرید: *' + fmtNum(buyUsd) + ' دلار* (' + fmtNum(buyToman) + ' تومان)',
    '🔴 کل فروش: *' + fmtNum(sellUsd) + ' دلار* (' + fmtNum(sellToman) + ' تومان)',
    '──────────────────────'
  ];

  if (netToman > 0) {
    lines.push('📌 *وضعیت: ' + fmtNum(netToman) + ' تومان طلبکار* (' + fmtNum(netUsd) + ' دلار)');
  } else if (netToman < 0) {
    lines.push('📌 *وضعیت: ' + fmtNum(Math.abs(netToman)) + ' تومان بدهکار* (' + fmtNum(Math.abs(netUsd)) + ' دلار)');
  } else {
    lines.push('📌 *وضعیت: کاملاً تسویه (صفر)*');
  }

  lines.push('──────────────────────');
  lines.push('📋 *معاملات اخیر:*');
  matched.slice(-8).forEach((t, i) => {
    const sideText = t.side === 'buy' ? '🟢 خرید' : '🔴 فروش';
    lines.push('  ' + toFaDigits(i + 1) + '. ' + sideText + ': ' + fmtNum(t.toman) + ' ت | نرخ ' + fmtDec(t.rate) + ' = *' + fmtNum(t.converted) + ' $*');
  });

  return lines.join('\n');
}

// ==========================================
// 6. GLOBAL SEARCH ENGINE (All trades, rates, names)
// ==========================================
function performGlobalSearch(query) {
  const qClean = normalize(query);
  if (!qClean) return 'لطفاً عبارت مورد نظر برای جستجو را بنویسید (مثال: `جستجو احمد` یا `جستجو ۲۵۶۰۰۰۰`)';

  const qNum = parseFloat(qClean.replace(/,/g, ''));
  const hits = [];

  db.lists.forEach((list) => {
    const listMatches = normalize(list.name).includes(qClean) || (list.code && list.code.toLowerCase().includes(qClean));
    const matchedTrades = list.trades.filter((t) => {
      const nameMatch = normalize(t.name).includes(qClean);
      const provMatch = t.province && normalize(t.province).includes(qClean);
      const descMatch = t.description && normalize(t.description).includes(qClean);
      const rateMatch = !isNaN(qNum) && Math.abs(t.rate - qNum) < 0.01;
      const amtMatch = !isNaN(qNum) && (t.toman === qNum || t.converted === qNum);
      return nameMatch || provMatch || descMatch || rateMatch || amtMatch;
    });

    if (matchedTrades.length > 0 || listMatches) {
      hits.push({ list, trades: matchedTrades });
    }
  });

  if (hits.length === 0) {
    return '🔍 هیچ موردی برای «*' + query + '*» یافت نشد.';
  }

  let totalBuyToman = 0;
  let totalSellToman = 0;
  let totalBuyUsd = 0;
  let totalSellUsd = 0;
  let totalCount = 0;

  const lines = [];
  lines.push('🔍 *نتایج جستجو برای: ' + query + '*');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━');

  hits.forEach((h) => {
    lines.push('📁 *' + h.list.name + '* (' + toFaDigits(h.trades.length) + ' مورد):');
    h.trades.forEach((t, idx) => {
      totalCount++;
      const isBuy = t.side === 'buy';
      if (isBuy) {
        totalBuyToman += t.toman;
        totalBuyUsd += t.converted;
      } else {
        totalSellToman += t.toman;
        totalSellUsd += t.converted;
      }
      const sideText = isBuy ? '🟢 خرید' : '🔴 فروش';
      lines.push('  ' + toFaDigits(idx + 1) + '. ' + sideText + ': *' + t.name + '* | ' + fmtNum(t.toman) + ' ت | نرخ ' + fmtDec(t.rate) + ' = *' + fmtNum(t.converted) + ' $*');
    });
    lines.push('');
  });

  lines.push('━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('📊 *جمع کل نتایج:*');
  lines.push('🟢 مجموع خرید: *' + fmtNum(totalBuyUsd) + ' دلار* (' + fmtNum(totalBuyToman) + ' تومان)');
  lines.push('🔴 مجموع فروش: *' + fmtNum(totalSellUsd) + ' دلار* (' + fmtNum(totalSellToman) + ' تومان)');

  const netToman = totalBuyToman - totalSellToman;
  if (netToman > 0) {
    lines.push('📌 مانده: *' + fmtNum(netToman) + ' تومان بستانکار*');
  } else if (netToman < 0) {
    lines.push('📌 مانده: *' + fmtNum(Math.abs(netToman)) + ' تومان بدهکار*');
  } else {
    lines.push('📌 مانده: تراز (صفر)');
  }

  return lines.join('\n');
}

// ==========================================
// 7. VISUAL REPORT GENERATOR (SVG, PNG & PDF)
// ==========================================
function escapeXml(unsafe) {
  return String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateReportSvg(list) {
  const calc = calculateList(list.trades);
  const dateStr = getPersianDateStr(list.createdAt || Date.now());
  const timeStr = getPersianTimeStr(list.createdAt || Date.now());
  const buys = list.trades.filter((t) => t.side === 'buy');
  const sells = list.trades.filter((t) => t.side === 'sell');

  const width = 800;
  const rowsHeight = (buys.length + sells.length) * 32;
  const height = Math.max(900, 560 + rowsHeight);

  let currentY = 160;

  // Buys table SVG
  let buysSvg = '<text x="760" y="' + currentY + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="bold" fill="#065f46" text-anchor="end">خریدها (' + toFaDigits(buys.length) + ' معامله)</text>' +
    '<line x1="40" y1="' + (currentY + 8) + '" x2="760" y2="' + (currentY + 8) + '" stroke="#10b981" stroke-width="2"/>';
  currentY += 28;

  if (buys.length === 0) {
    buysSvg += '<text x="740" y="' + (currentY + 14) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" fill="#94a3b8" text-anchor="end">معامله‌ای ثبت نشده است.</text>';
    currentY += 32;
  } else {
    buysSvg += '<rect x="40" y="' + currentY + '" width="720" height="26" fill="#f8fafc" stroke="#e2e8f0"/>' +
      '<text x="60" y="' + (currentY + 18) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" font-weight="bold" fill="#475569">#</text>' +
      '<text x="740" y="' + (currentY + 18) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" font-weight="bold" fill="#475569" text-anchor="end">نام مشتری</text>' +
      '<text x="500" y="' + (currentY + 18) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" font-weight="bold" fill="#475569" text-anchor="end">مبلغ تومان</text>' +
      '<text x="350" y="' + (currentY + 18) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" font-weight="bold" fill="#475569" text-anchor="end">نرخ</text>' +
      '<text x="210" y="' + (currentY + 18) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" font-weight="bold" fill="#475569" text-anchor="end">معادل ($)</text>';
    currentY += 26;

    buys.forEach((t, i) => {
      buysSvg += '<rect x="40" y="' + currentY + '" width="720" height="28" fill="' + (i % 2 === 0 ? '#ffffff' : '#fcfdfe') + '" stroke="#f1f5f9"/>' +
        '<text x="60" y="' + (currentY + 19) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" fill="#64748b">' + toFaDigits(i + 1) + '</text>' +
        '<text x="740" y="' + (currentY + 19) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" font-weight="bold" fill="#1e293b" text-anchor="end">' + escapeXml(t.name) + '</text>' +
        '<text x="500" y="' + (currentY + 19) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" fill="#0f172a" text-anchor="end">' + fmtNum(t.toman) + '</text>' +
        '<text x="350" y="' + (currentY + 19) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" fill="#0f172a" text-anchor="end">' + fmtDec(t.rate) + '</text>' +
        '<text x="210" y="' + (currentY + 19) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" font-weight="bold" fill="#065f46" text-anchor="end">' + fmtNum(t.converted) + ' $</text>';
      currentY += 28;
    });
  }

  currentY += 16;

  // Sells table SVG
  let sellsSvg = '<text x="760" y="' + currentY + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="bold" fill="#991b1b" text-anchor="end">فروش‌ها (' + toFaDigits(sells.length) + ' معامله)</text>' +
    '<line x1="40" y1="' + (currentY + 8) + '" x2="760" y2="' + (currentY + 8) + '" stroke="#ef4444" stroke-width="2"/>';
  currentY += 28;

  if (sells.length === 0) {
    sellsSvg += '<text x="740" y="' + (currentY + 14) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" fill="#94a3b8" text-anchor="end">معامله‌ای ثبت نشده است.</text>';
    currentY += 32;
  } else {
    sellsSvg += '<rect x="40" y="' + currentY + '" width="720" height="26" fill="#f8fafc" stroke="#e2e8f0"/>' +
      '<text x="60" y="' + (currentY + 18) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" font-weight="bold" fill="#475569">#</text>' +
      '<text x="740" y="' + (currentY + 18) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" font-weight="bold" fill="#475569" text-anchor="end">نام مشتری</text>' +
      '<text x="500" y="' + (currentY + 18) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" font-weight="bold" fill="#475569" text-anchor="end">مبلغ تومان</text>' +
      '<text x="350" y="' + (currentY + 18) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" font-weight="bold" fill="#475569" text-anchor="end">نرخ</text>' +
      '<text x="210" y="' + (currentY + 18) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" font-weight="bold" fill="#475569" text-anchor="end">معادل ($)</text>';
    currentY += 26;

    sells.forEach((t, i) => {
      sellsSvg += '<rect x="40" y="' + currentY + '" width="720" height="28" fill="' + (i % 2 === 0 ? '#ffffff' : '#fcfdfe') + '" stroke="#f1f5f9"/>' +
        '<text x="60" y="' + (currentY + 19) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" fill="#64748b">' + toFaDigits(i + 1) + '</text>' +
        '<text x="740" y="' + (currentY + 19) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" font-weight="bold" fill="#1e293b" text-anchor="end">' + escapeXml(t.name) + '</text>' +
        '<text x="500" y="' + (currentY + 19) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" fill="#0f172a" text-anchor="end">' + fmtNum(t.toman) + '</text>' +
        '<text x="350" y="' + (currentY + 19) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" fill="#0f172a" text-anchor="end">' + fmtDec(t.rate) + '</text>' +
        '<text x="210" y="' + (currentY + 19) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" font-weight="bold" fill="#991b1b" text-anchor="end">' + fmtNum(t.converted) + ' $</text>';
      currentY += 28;
    });
  }

  currentY += 20;

  // Summary Cards SVG
  const cardsSvg = '<!-- Buy Card -->' +
    '<rect x="420" y="' + currentY + '" width="340" height="95" rx="10" fill="#f0fdf4" stroke="#86efac"/>' +
    '<text x="740" y="' + (currentY + 24) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="bold" fill="#15803d" text-anchor="end">مجموع خریدها:</text>' +
    '<text x="440" y="' + (currentY + 45) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="bold" fill="#15803d">' + fmtNum(calc.buy.totalUsd) + ' $</text>' +
    '<text x="740" y="' + (currentY + 70) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" fill="#475569" text-anchor="end">میانگین نرخ خرید: ' + fmtNum(calc.buy.avg) + '</text>' +
    '<text x="740" y="' + (currentY + 86) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" fill="#475569" text-anchor="end">مجموع تومان: ' + fmtNum(calc.buy.tomanSum) + '</text>' +
    '<!-- Sell Card -->' +
    '<rect x="40" y="' + currentY + '" width="340" height="95" rx="10" fill="#fef2f2" stroke="#fca5a5"/>' +
    '<text x="360" y="' + (currentY + 24) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="13" font-weight="bold" fill="#b91c1c" text-anchor="end">مجموع فروش‌ها:</text>' +
    '<text x="60" y="' + (currentY + 45) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="bold" fill="#b91c1c">' + fmtNum(calc.sell.totalUsd) + ' $</text>' +
    '<text x="360" y="' + (currentY + 70) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" fill="#475569" text-anchor="end">میانگین نرخ فروش: ' + fmtNum(calc.sell.avg) + '</text>' +
    '<text x="360" y="' + (currentY + 86) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" fill="#475569" text-anchor="end">مجموع تومان: ' + fmtNum(calc.sell.tomanSum) + '</text>';

  currentY += 110;

  const profitBg = calc.profit > 0 ? '#dcfce7' : calc.profit < 0 ? '#fee2e2' : '#f1f5f9';
  const profitStroke = calc.profit > 0 ? '#4ade80' : calc.profit < 0 ? '#f87171' : '#cbd5e1';
  const profitTextFill = calc.profit > 0 ? '#15803d' : calc.profit < 0 ? '#b91c1c' : '#334155';
  const profitStatusText = calc.profit > 0 ? 'سود ارزی قطعی' : calc.profit < 0 ? 'زیان ارزی' : 'سربه‌سر';

  const profitSvg = '<rect x="40" y="' + currentY + '" width="720" height="75" rx="12" fill="' + profitBg + '" stroke="' + profitStroke + '"/>' +
    '<text x="400" y="' + (currentY + 26) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="14" font-weight="bold" fill="' + profitTextFill + '" text-anchor="middle">' + profitStatusText + ': ' + (calc.profit > 0 ? '+' : '') + fmtNum(calc.profit) + ' دلار</text>' +
    '<text x="400" y="' + (currentY + 54) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" fill="#475569" text-anchor="middle">' + (calc.diffToman > 0 ? 'موازنه: ' + fmtNum(calc.diffToman) + ' تومان بیشتر باید فروخته شود' : calc.diffToman < 0 ? 'موازنه: ' + fmtNum(Math.abs(calc.diffToman)) + ' تومان بیشتر باید خریداری شود' : 'تراز تومانی کامل است') + '</text>';

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg">\n' +
    '  <rect width="100%" height="100%" fill="#f1f5f9"/>\n' +
    '  <rect x="20" y="20" width="760" height="' + (height - 40) + '" rx="16" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>\n' +
    '  <text x="750" y="60" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="bold" fill="#1e3a8a" text-anchor="end">صرافی و خدمات پولی</text>\n' +
    '  <text x="750" y="88" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="bold" fill="#0f172a" text-anchor="end">صورت معاملات: ' + escapeXml(list.name) + '</text>\n' +
    '  <rect x="40" y="44" width="90" height="24" rx="6" fill="#eff6ff" stroke="#bfdbfe"/>\n' +
    '  <text x="85" y="60" font-family="monospace" font-size="12" font-weight="bold" fill="#1d4ed8" text-anchor="middle">' + escapeXml(list.code || 'T-1405') + '</text>\n' +
    '  <text x="40" y="88" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" fill="#64748b">تاریخ: ' + dateStr + ' - ساعت: ' + timeStr + '</text>\n' +
    '  <line x1="40" y1="110" x2="760" y2="110" stroke="#e2e8f0" stroke-width="1.5"/>\n' +
    buysSvg + '\n' +
    sellsSvg + '\n' +
    cardsSvg + '\n' +
    profitSvg + '\n' +
    '  <line x1="40" y1="' + (height - 45) + '" x2="760" y2="' + (height - 45) + '" stroke="#e2e8f0" stroke-width="1"/>\n' +
    '  <text x="50" y="' + (height - 30) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="10" fill="#94a3b8">HAMED-SOFTWARE | +93 794557385</text>\n' +
    '  <text x="750" y="' + (height - 30) + '" font-family="DejaVu Sans, Arial, sans-serif" font-size="10" fill="#94a3b8" text-anchor="end">Exchange Manager Telegram Bot</text>\n' +
    '</svg>';
}

async function generatePngBuffer(list) {
  if (!sharp) sharp = require('sharp');
  const svg = generateReportSvg(list);
  return await sharp(Buffer.from(svg)).png().toBuffer();
}

async function generatePdfBuffer(list) {
  if (!sharp) sharp = require('sharp');
  if (!PDFDocument) PDFDocument = require('pdf-lib').PDFDocument;

  const pngBuffer = await generatePngBuffer(list);
  const pdfDoc = await PDFDocument.create();
  // Standard A4 dimensions in points: 595.28 x 841.89
  const page = pdfDoc.addPage([595.28, 841.89]);
  const image = await pdfDoc.embedPng(pngBuffer);

  page.drawImage(image, {
    x: 0,
    y: 0,
    width: 595.28,
    height: 841.89
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ==========================================
// 8. MAIN KEYBOARDS & MENUS
// ==========================================
const MAIN_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: '📊 خلاصه وضعیت' }, { text: '📋 گزارش کامل' }],
      [{ text: '📄 خروجی PDF' }, { text: '🖼 عکس فاکتور' }],
      [{ text: '🔍 جستجو' }, { text: '👤 حساب مشتری' }],
      [{ text: '📁 لیست‌ها' }, { text: '➕ لیست جدید' }],
      [{ text: '🗑 حذف آخرین معامله' }, { text: '❓ راهنما' }]
    ],
    resize_keyboard: true
  }
};

function getReportInlineButtons(listId) {
  return {
    inline_keyboard: [
      [
        { text: '📄 دریافت فایل PDF', callback_data: 'export_pdf:' + listId },
        { text: '🖼 دریافت عکس فاکتور', callback_data: 'export_img:' + listId }
      ]
    ]
  };
}

// ==========================================
// 9. BOT MESSAGE HANDLERS
// ==========================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const rawText = msg.text ? msg.text.trim() : '';

  if (!rawText) return;

  const currentList = getActiveList();
  const textNorm = normalize(rawText);

  // 1. Pending Slot-Filling & State handling
  const userState = db.userStates[chatId];
  if (userState && userState.step) {
    if (textNorm === 'لغو' || textNorm === '/cancel' || textNorm === 'انصراف') {
      delete db.userStates[chatId];
      bot.sendMessage(chatId, '❌ عملیات لغو شد.', MAIN_KEYBOARD);
      return;
    }

    if (userState.step === 'ask_search_query') {
      delete db.userStates[chatId];
      const result = performGlobalSearch(rawText);
      bot.sendMessage(chatId, result, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
      return;
    }

    if (userState.step === 'ask_customer_name') {
      delete db.userStates[chatId];
      const result = getCustomerAccountText(rawText.trim());
      bot.sendMessage(chatId, result, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
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
      bot.sendMessage(chatId, '✅ لیست جدید *' + name + '* (کد: ' + newList.code + ') ایجاد و فعال شد.', { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
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
        const msgRes = [
          '✅ معامله با موفقیت ثبت شد:',
          sideText + ': *' + userState.trade.name + '*',
          'مبلغ: ' + fmtNum(userState.trade.toman) + ' تومان',
          'نرخ: ' + fmtDec(rateNum),
          'معادل دلار: *' + fmtNum(userState.trade.converted) + ' $*',
          'لیست: ' + currentList.name
        ].join('\n');
        bot.sendMessage(chatId, msgRes, {
          parse_mode: 'Markdown',
          reply_markup: getReportInlineButtons(currentList.id)
        });
        return;
      } else {
        bot.sendMessage(chatId, '⚠️ لطفاً نرخ معامله را به صورت عدد صحیح وارد کنید (مثال: ۲۵۶۰۰۰۰):');
        return;
      }
    }
  }

  // 2. Commands & Keyboards
  if (textNorm === '/start' || textNorm === '❓ راهنما' || textNorm === '/help') {
    const listCodeTag = currentList.code ? '(' + currentList.code + ')' : '';
    const welcome = [
      '👋 *سلام صراف محترم! به ربات معاملات تومان خوش آمدید.*',
      '',
      '📌 *لیست فعال کنونی:* ' + currentList.name + ' ' + listCodeTag,
      '',
      '💡 *روش‌های ثبت معامله (متنی یا صوتی):*',
      '۱. ثبت تکی سریع:',
      '« خرید احمد ۲ م ۲۵۶۰۰۰۰ »',
      '« فروش صرافی امید ۴۰۰۰ نرخ ۲۶۵۰۰۰ »',
      '',
      '۲. ثبت دسته‌ای (چندخطی با هدر):',
      'خرید لیست هرات:',
      'احمد ۲ م ۲۵۶۰۰۰۰',
      'محمد ۴۰۰۰ ۲۶۵۰۰۰',
      'علی ۵۰۰۰ ۲۷۰۰۰۰',
      '',
      '۳. امکانات خروجی و جستجو:',
      '• 📄 خروجی رسمی PDF چاپی A4',
      '• 🖼 خروجی عکس فاکتور باکیفیت',
      '• 🔍 جستجوی پیشرفته در تمام لیست‌ها و نرخ‌ها',
      '• 👤 استعلام صورتحساب مشتری: حساب احمد'
    ].join('\n');

    bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
    return;
  }

  // 3. Export PDF
  if (textNorm === '📄 خروجی pdf' || textNorm === '/pdf' || textNorm === 'پی دی اف' || textNorm === 'pdf') {
    if (currentList.trades.length === 0) {
      bot.sendMessage(chatId, '❌ در لیست فعال (*' + currentList.name + '*) هیچ معامله‌ای برای صدور PDF ثبت نشده است.', { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
      return;
    }
    const waitMsg = await bot.sendMessage(chatId, '⏳ در حال ساخت سند PDF رسمی A4...', { reply_markup: { remove_keyboard: true } });
    try {
      const pdfBuffer = await generatePdfBuffer(currentList);
      await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
      await bot.sendDocument(chatId, pdfBuffer, {
        caption: '📄 فاکتور رسمی PDF: *' + currentList.name + '*',
        parse_mode: 'Markdown'
      }, {
        filename: 'Factor-' + (currentList.name || 'Exchange') + '.pdf',
        contentType: 'application/pdf'
      });
      bot.sendMessage(chatId, '✅ فایل PDF ارسال شد.', MAIN_KEYBOARD);
    } catch (err) {
      console.error('PDF error:', err);
      bot.sendMessage(chatId, '⚠️ خطا در تولید PDF: ' + err.message, MAIN_KEYBOARD);
    }
    return;
  }

  // 4. Export Image
  if (textNorm === '🖼 عکس فاکتور' || textNorm === '/image' || textNorm === 'عکس' || textNorm === 'تصویر') {
    if (currentList.trades.length === 0) {
      bot.sendMessage(chatId, '❌ در لیست فعال (*' + currentList.name + '*) هیچ معامله‌ای برای صدور عکس ثبت نشده است.', { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
      return;
    }
    const waitMsg = await bot.sendMessage(chatId, '⏳ در حال آماده‌سازی تصویر فاکتور...', { reply_markup: { remove_keyboard: true } });
    try {
      const pngBuffer = await generatePngBuffer(currentList);
      await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
      await bot.sendPhoto(chatId, pngBuffer, {
        caption: '🖼 عکس فاکتور صورت معاملات: *' + currentList.name + '*',
        parse_mode: 'Markdown'
      });
      bot.sendMessage(chatId, '✅ عکس فاکتور ارسال شد.', MAIN_KEYBOARD);
    } catch (err) {
      console.error('Image error:', err);
      bot.sendMessage(chatId, '⚠️ خطا در ساخت عکس: ' + err.message, MAIN_KEYBOARD);
    }
    return;
  }

  // 5. Global Search Command
  if (textNorm.startsWith('جستجو') || textNorm.startsWith('/search') || textNorm.startsWith('بگرد') || textNorm.startsWith('پیدا کن')) {
    const query = rawText
      .replace(/^(جستجو|بگرد|پیدا\s*کن|\/search)\s*/iu, '')
      .trim();

    if (query) {
      const searchRes = performGlobalSearch(query);
      bot.sendMessage(chatId, searchRes, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
    } else {
      db.userStates[chatId] = { step: 'ask_search_query' };
      bot.sendMessage(chatId, '🔍 لطفاً عبارت مورد نظر را بنویسید (نام مشتری، نرخ مانند ۲۵۶۰۰۰۰، مبلغ یا شهر):', {
        reply_markup: { keyboard: [[{ text: 'لغو' }]], resize_keyboard: true }
      });
    }
    return;
  }

  if (textNorm === '🔍 جستجو') {
    db.userStates[chatId] = { step: 'ask_search_query' };
    bot.sendMessage(chatId, '🔍 لطفاً عبارت مورد نظر برای جستجو را ارسال کنید (نام مشتری، نرخ مانند ۲۵۶۰۰۰۰، مبلغ یا شهر):', {
      reply_markup: { keyboard: [[{ text: 'لغو' }]], resize_keyboard: true }
    });
    return;
  }

  if (textNorm === '👤 حساب مشتری') {
    db.userStates[chatId] = { step: 'ask_customer_name' };
    bot.sendMessage(chatId, '👤 نام مشتری مورد نظر را بنویسید (مثال: احمد یا صرافی برادران):', {
      reply_markup: { keyboard: [[{ text: 'لغو' }]], resize_keyboard: true }
    });
    return;
  }

  if (textNorm === '📊 خلاصه وضعیت' || textNorm === '/summary') {
    bot.sendMessage(chatId, getSummaryText(currentList), {
      parse_mode: 'Markdown',
      reply_markup: getReportInlineButtons(currentList.id)
    });
    return;
  }

  if (textNorm === '📋 گزارش کامل' || textNorm === '/report' || textNorm === 'گزارش') {
    bot.sendMessage(chatId, getReportText(currentList), {
      parse_mode: 'Markdown',
      reply_markup: getReportInlineButtons(currentList.id)
    });
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
    const delMsg = '🗑 آخرین معامله حذف شد:\n' + sideText + ': *' + removed.name + '* (' + fmtNum(removed.toman) + ' ت | ' + fmtNum(removed.converted) + ' $)';
    bot.sendMessage(chatId, delMsg, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
    return;
  }

  if (textNorm === '📁 لیست‌ها' || textNorm === '/lists') {
    let out = '📁 *فهرست لیست‌های فعال شما:*\n\n';
    const inlineButtons = [];

    db.lists.forEach((l, i) => {
      const isActive = l.id === db.activeListId;
      const calc = calculateList(l.trades);
      out += toFaDigits(i + 1) + '. ' + (isActive ? '👉 *' : '') + l.name + (isActive ? ' (فعال)*' : '') + ' [' + l.code + ']\n';
      out += '   تعداد معاملات: ' + toFaDigits(l.trades.length) + ' | سود/زیان: ' + fmtNum(calc.profit) + ' $\n\n';
      inlineButtons.push([{ text: (isActive ? '✅ ' : '') + 'انتخاب ' + l.name, callback_data: 'select_list:' + l.id }]);
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
      bot.sendMessage(chatId, '✅ لیست جدید *' + explicitName + '* (کد: ' + newList.code + ') ایجاد و فعال شد.', { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
    } else {
      db.userStates[chatId] = { step: 'ask_new_list_name' };
      bot.sendMessage(chatId, '📝 لطفاً نام لیست جدید را بنویسید (مثال: لیست کابل، هرات، تهران):', {
        reply_markup: { keyboard: [[{ text: 'لغو' }]], resize_keyboard: true }
      });
    }
    return;
  }

  // 6. Customer Account Query (e.g. "حساب احمد", "معاملات صرافی امید")
  const custMatch = /(?:حساب|معاملات|صورتحساب)\s+([^\s\d]+(?:\s+[^\s\d]+)?)/iu.exec(textNorm);
  if (custMatch) {
    const custName = custMatch[1].trim();
    bot.sendMessage(chatId, getCustomerAccountText(custName), { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
    return;
  }

  // 7. Multi-Line Batch Trades (e.g. "خرید هرات:\nاحمد ۲ م ۲۵۶۰۰۰۰\nمحمد ۴۰۰۰ ۲۶۵۰۰۰")
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
        const sTxt = parsed.side === 'buy' ? '🟢 خرید' : '🔴 فروش';
        addedSummaries.push('  • ' + sTxt + ': ' + parsed.name + ' | ' + fmtNum(parsed.amountToman) + ' ت | نرخ ' + fmtDec(parsed.rate) + ' = *' + fmtNum(parsed.converted) + ' $*');
      }
    }

    if (addedCount > 0) {
      saveData();
      const resMsg = '✅ تعداد ' + toFaDigits(addedCount) + ' معامله در *' + targetList.name + '* ثبت شد:\n\n' + addedSummaries.join('\n');
      bot.sendMessage(chatId, resMsg, {
        parse_mode: 'Markdown',
        reply_markup: getReportInlineButtons(targetList.id)
      });
      return;
    }
  }

  // 8. Single Trade Natural Language Parsing (e.g. "خرید احمد ۲ م ۲۵۶۰۰۰۰")
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
    const repMsg = [
      '✅ معامله با موفقیت ثبت شد:',
      sideText + ': *' + singleParsed.name + '*',
      'مبلغ: ' + fmtNum(singleParsed.amountToman) + ' تومان',
      'نرخ: ' + fmtDec(singleParsed.rate),
      'معادل دلار: *' + fmtNum(singleParsed.converted) + ' $*',
      'لیست: ' + currentList.name
    ].join('\n');

    bot.sendMessage(chatId, repMsg, {
      parse_mode: 'Markdown',
      reply_markup: getReportInlineButtons(currentList.id)
    });
    return;
  }

  // 9. Slot-Filling Assistant (If partial trade detected)
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
      bot.sendMessage(chatId, 'مبلغ ' + fmtNum(singleParsed.amountToman) + ' تومان برای ' + singleParsed.name + ' مشخص شد. لطفاً *نرخ معامله* را ارسال کنید:', {
        parse_mode: 'Markdown',
        reply_markup: { keyboard: [[{ text: 'لغو' }]], resize_keyboard: true }
      });
      return;
    }
  }

  // Default fallback
  bot.sendMessage(chatId, 'متوجه این پیام نشدم. برای ثبت معامله، مبلغ و نام و نرخ را وارد کنید (مثال: «خرید احمد ۲ میلیارد نرخ ۲۵۶۰۰۰۰») یا از منوی زیر استفاده فرمایید.', {
    parse_mode: 'Markdown',
    ...MAIN_KEYBOARD
  });
});

// ==========================================
// 10. INLINE BUTTON CALLBACKS
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
      bot.answerCallbackQuery(query.id, { text: 'لیست ' + found.name + ' فعال شد.' });
      bot.sendMessage(chatId, '📌 لیست فعال تغییر یافت به: *' + found.name + '*', { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
    }
    return;
  }

  if (data.startsWith('export_pdf:')) {
    const listId = data.replace('export_pdf:', '');
    const target = db.lists.find(l => l.id === listId) || getActiveList();
    bot.answerCallbackQuery(query.id, { text: 'در حال تولید PDF...' });
    try {
      const pdfBuffer = await generatePdfBuffer(target);
      await bot.sendDocument(chatId, pdfBuffer, {
        caption: '📄 فاکتور رسمی PDF: *' + target.name + '*',
        parse_mode: 'Markdown'
      }, {
        filename: 'Factor-' + (target.name || 'Exchange') + '.pdf',
        contentType: 'application/pdf'
      });
    } catch (err) {
      bot.sendMessage(chatId, '⚠️ خطا در ساخت PDF: ' + err.message);
    }
    return;
  }

  if (data.startsWith('export_img:')) {
    const listId = data.replace('export_img:', '');
    const target = db.lists.find(l => l.id === listId) || getActiveList();
    bot.answerCallbackQuery(query.id, { text: 'در حال تولید عکس...' });
    try {
      const pngBuffer = await generatePngBuffer(target);
      await bot.sendPhoto(chatId, pngBuffer, {
        caption: '🖼 عکس فاکتور: *' + target.name + '*',
        parse_mode: 'Markdown'
      });
    } catch (err) {
      bot.sendMessage(chatId, '⚠️ خطا در ساخت عکس: ' + err.message);
    }
    return;
  }
});

// ==========================================
// 11. EXPRESS HTTP SERVER (REQUIRED FOR RENDER)
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
  console.log('🚀 Health server running on port ' + PORT + ' for Render deployment.');
  console.log('🤖 Telegram Bot is polling and ready to receive messages...');
});
