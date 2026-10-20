/**
 * High-Fidelity Canvas & PDF Renderer for Toman Exchange Reports
 * 100% Self-Contained with Embedded Vazirmatn Fonts
 * Exact 1:1 match with Android report.css and ReportGenerator.kt
 * Dynamic Natural-Height Cropping (zero empty white gap, no extra headers or footers)
 */

const PDFDocument = require('pdfkit');
const canvasModule = require('@napi-rs/canvas');
const embeddedFonts = require('./embeddedFonts.js');

let fontRegularLoaded = false;
let fontBoldLoaded = false;

if (canvasModule && canvasModule.GlobalFonts) {
  try {
    canvasModule.GlobalFonts.register(embeddedFonts.getRegularFontBuffer(), 'Vazirmatn');
    fontRegularLoaded = true;
  } catch (err) {
    console.warn('Could not register embedded Vazirmatn:', err.message);
  }

  try {
    canvasModule.GlobalFonts.register(embeddedFonts.getBoldFontBuffer(), 'VazirmatnBold');
    fontBoldLoaded = true;
  } catch (err) {
    console.warn('Could not register embedded VazirmatnBold:', err.message);
  }
}

const FONT_REG = fontRegularLoaded ? 'Vazirmatn, sans-serif' : 'sans-serif';
const FONT_BLD = fontBoldLoaded ? 'VazirmatnBold, Vazirmatn, sans-serif' : 'sans-serif';

/**
 * Format numbers with comma grouping (Matching Android I18n.F / Locale.US)
 * English digits with commas: 2,000,000,000
 */
function F(val) {
  if (val == null || isNaN(val)) return '0';
  const n = Math.round(Number(val));
  return n.toLocaleString('en-US');
}

function F2(val) {
  if (val == null || isNaN(val)) return '0';
  const num = Number(val);
  if (!isFinite(num)) return '0';
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function roundRect(ctx, x, y, width, height, radius) {
  if (typeof radius === 'number') {
    radius = { tl: radius, tr: radius, br: radius, bl: radius };
  } else {
    radius = Object.assign({ tl: 0, tr: 0, br: 0, bl: 0 }, radius);
  }
  ctx.beginPath();
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + width - radius.tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
  ctx.lineTo(x + width, y + height - radius.br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
  ctx.lineTo(x + radius.bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  ctx.closePath();
}

/**
 * Calculate list financials (Exact 1:1 match with Android Finance.calc)
 */
function calculateList(trades) {
  const buys = (trades || []).filter(t => t.side === 'buy');
  const sells = (trades || []).filter(t => t.side === 'sell');

  const buyToman = buys.reduce((acc, t) => acc + (Number(t.toman) || 0), 0);
  const buyTotal = buys.reduce((acc, t) => acc + (Number(t.converted) || 0), 0);
  const buyAvg = buyTotal > 0 ? (buyToman / buyTotal) : 0;
  const buyAvgRounded = buyTotal > 0 ? Math.round(buyAvg) : 0;

  const sellToman = sells.reduce((acc, t) => acc + (Number(t.toman) || 0), 0);
  const sellTotal = sells.reduce((acc, t) => acc + (Number(t.converted) || 0), 0);
  const sellAvg = sellTotal > 0 ? (sellToman / sellTotal) : 0;
  const sellAvgRounded = sellTotal > 0 ? Math.round(sellAvg) : 0;

  let profit = 0;
  if (buyAvg > 0 && sellAvg > 0) {
    if (sellAvg > buyAvg) {
      const minUsd = Math.min(buyTotal, sellTotal);
      const diffToman = (sellAvg - buyAvg) * minUsd;
      profit = buyAvg > 0 ? Math.round(diffToman / buyAvg) : 0;
    } else {
      const minUsd = Math.min(buyTotal, sellTotal);
      const diffToman = (buyAvg - sellAvg) * minUsd;
      profit = - (sellAvg > 0 ? Math.round(diffToman / sellAvg) : 0);
    }
  }

  return {
    buys,
    sells,
    buy: { count: buys.length, toman: buyToman, total: buyTotal, avg: buyAvgRounded },
    sell: { count: sells.length, toman: sellToman, total: sellTotal, avg: sellAvgRounded },
    profit
  };
}

/**
 * Pre-computes natural content height to crop out all empty white space
 */
function computeReportHeight(list, info) {
  const trades = list.trades || [];
  const buys = trades.filter(t => t.side === 'buy');
  const sells = trades.filter(t => t.side === 'sell');

  let h = 32; // Top padding

  // Optional letterhead (only if explicitly configured with non-empty name/phone)
  const hasInfo = Boolean(info && (info.name || info.phone || info.address));
  if (hasInfo) h += 50;

  h += 48; // Title bar + dates
  h += 16; // Margin

  // Buy section
  h += 32; // h3 title
  if (buys.length === 0) {
    h += 42; // empty banner
  } else {
    h += 34; // thead
    h += buys.length * 32; // rows
    h += 12; // spacing
  }

  // Sell section
  h += 32; // h3 title
  if (sells.length === 0) {
    h += 42; // empty banner
  } else {
    h += 34; // thead
    h += sells.length * 32; // rows
    h += 12; // spacing
  }

  // Summary cards block
  h += 165;

  // Profit box
  h += 54;

  h += 24; // Bottom padding
  return Math.max(h, 420);
}

/**
 * Render Ultra High-Resolution Crisp PNG (2x Retina scale)
 * Exactly mirrors Android ReportGenerator.kt and report.css
 */
function renderReportImage(list, info, dateText) {
  const baseW = 794; // Standard A4 width base
  const totalH = computeReportHeight(list, info);
  const padX = 40;
  const contentW = baseW - (padX * 2); // 714px

  const SCALE = 2;
  const canvasW = baseW * SCALE;
  const canvasH = totalH * SCALE;

  const canvas = canvasModule.createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');

  ctx.scale(SCALE, SCALE);

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, baseW, totalH);

  let curY = 32;

  // 1. Optional Header (Only if explicit user info exists)
  const hasInfo = Boolean(info && (info.name || info.phone || info.address));
  if (hasInfo) {
    ctx.textAlign = 'right';
    if (info.name) {
      ctx.fillStyle = '#0f172a';
      ctx.font = `bold 20px ${FONT_BLD}`;
      ctx.fillText(info.name, baseW - padX, curY + 20);
    }
    const subLines = [info.phone, info.address].filter(Boolean).join('  |  ');
    if (subLines) {
      ctx.fillStyle = '#64748b';
      ctx.font = `12px ${FONT_REG}`;
      ctx.fillText(subLines, baseW - padX, curY + 40);
    }
    curY += 48;

    // Divider
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, curY);
    ctx.lineTo(baseW - padX, curY);
    ctx.stroke();
    curY += 14;
  }

  // 2. Title bar: "صورتحساب معاملات {name}" (Strictly matching Android report.title)
  const listTitle = `صورتحساب معاملات ${list.name || ''}`.trim();
  ctx.textAlign = 'right';
  ctx.fillStyle = '#0f172a';
  ctx.font = `bold 18px ${FONT_BLD}`;
  ctx.fillText(listTitle, baseW - padX, curY + 20);

  // Optional code badge e.g. L-101
  if (list.code) {
    const titleWidth = ctx.measureText(listTitle).width;
    const badgeX = baseW - padX - titleWidth - 12;
    ctx.font = `bold 11px ${FONT_BLD}`;
    const badgeW = ctx.measureText(list.code).width + 14;
    ctx.fillStyle = '#eff6ff';
    roundRect(ctx, badgeX - badgeW, curY + 4, badgeW, 20, 4);
    ctx.fill();
    ctx.strokeStyle = '#bfdbfe';
    ctx.stroke();
    ctx.fillStyle = '#1d4ed8';
    ctx.textAlign = 'center';
    ctx.fillText(list.code, badgeX - (badgeW / 2), curY + 18);
  }

  // Date and Time (on the left side, matching Android ReportGenerator dl.rh-dt)
  ctx.textAlign = 'left';
  ctx.font = `12.5px ${FONT_REG}`;
  ctx.fillStyle = '#64748b';
  ctx.fillText('تاریخ: ' + (dateText?.date || 'امروز'), padX, curY + 12);
  ctx.fillText('ساعت: ' + (dateText?.time || 'اکنون'), padX, curY + 28);

  curY += 40;

  // Divider line under title
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(padX, curY);
  ctx.lineTo(baseW - padX, curY);
  ctx.stroke();
  curY += 18;

  const fin = calculateList(list.trades);

  // Table Renderer (Buy / Sell)
  function drawTable(trades, side) {
    const isBuy = side === 'buy';
    const primaryColor = isBuy ? '#1f4e8c' : '#c2620a';
    const bgHeader = isBuy ? '#eef4fd' : '#fff4eb';
    const titleText = isBuy ? 'خریدات' : 'فروشات';

    // Section title
    ctx.fillStyle = primaryColor;
    ctx.fillRect(baseW - padX - 4, curY, 4, 20);

    ctx.textAlign = 'right';
    ctx.font = `bold 15px ${FONT_BLD}`;
    ctx.fillStyle = primaryColor;
    ctx.fillText(titleText, baseW - padX - 12, curY + 16);

    // Count badge
    const badgeText = String(trades.length);
    ctx.font = `bold 11.5px ${FONT_BLD}`;
    const pW = ctx.measureText(badgeText).width + 16;
    ctx.fillStyle = isBuy ? '#dbeafe' : '#ffedd5';
    roundRect(ctx, baseW - padX - 85 - pW, curY + 1, pW, 19, 9);
    ctx.fill();
    ctx.fillStyle = primaryColor;
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, baseW - padX - 85 - (pW / 2), curY + 14);

    curY += 26;

    if (trades.length === 0) {
      ctx.fillStyle = '#f8fafc';
      roundRect(ctx, padX, curY, contentW, 36, 6);
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.font = `13px ${FONT_REG}`;
      ctx.textAlign = 'center';
      ctx.fillText('هیچ معامله‌ای در این بخش وجود ندارد.', padX + contentW / 2, curY + 23);
      curY += 46;
      return;
    }

    // Column definitions matching Android report.css
    const cols = [
      { key: 'idx', label: '#', w: 35, align: 'center', type: 'num' },
      { key: 'name', label: 'نام مشتری', w: 180, align: 'right', type: 'text' },
      { key: 'province', label: 'ولایت/شهر', w: 85, align: 'right', type: 'text' },
      { key: 'toman', label: 'مبلغ (تومان)', w: 140, align: 'right', type: 'num' },
      { key: 'rate', label: 'نرخ', w: 114, align: 'right', type: 'num' },
      { key: 'usd', label: 'معادل (دالر)', w: 160, align: 'right', type: 'num', bold: true }
    ];

    // Header Row
    ctx.fillStyle = bgHeader;
    roundRect(ctx, padX, curY, contentW, 30, 4);
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.stroke();

    ctx.font = `bold 12.5px ${FONT_BLD}`;
    ctx.fillStyle = '#334155';

    let hX = baseW - padX;
    cols.forEach(col => {
      if (col.align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(col.label, hX - (col.w / 2), curY + 20);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(col.label, hX - 12, curY + 20);
      }
      hX -= col.w;
    });

    curY += 30;

    // Body Rows
    trades.forEach((t, i) => {
      const isEven = i % 2 === 1;
      ctx.fillStyle = isEven ? '#f8fafc' : '#ffffff';
      ctx.fillRect(padX, curY, contentW, 32);

      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX, curY + 32);
      ctx.lineTo(baseW - padX, curY + 32);
      ctx.stroke();

      let rX = baseW - padX;

      // #
      ctx.textAlign = 'center';
      ctx.font = `12px ${FONT_REG}`;
      ctx.fillStyle = '#64748b';
      ctx.fillText(String(i + 1), rX - (cols[0].w / 2), curY + 21);
      rX -= cols[0].w;

      // Name
      ctx.textAlign = 'right';
      ctx.font = `bold 13px ${FONT_BLD}`;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(t.name || 'ـ', rX - 12, curY + 21);
      rX -= cols[1].w;

      // Province / Note
      ctx.textAlign = 'right';
      ctx.font = `12px ${FONT_REG}`;
      ctx.fillStyle = '#475569';
      ctx.fillText(t.province || 'ـ', rX - 12, curY + 21);
      rX -= cols[2].w;

      // Toman (English digits with commas)
      ctx.textAlign = 'right';
      ctx.font = `13px ${FONT_REG}`;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(F(t.toman), rX - 12, curY + 21);
      rX -= cols[3].w;

      // Rate
      ctx.textAlign = 'right';
      ctx.font = `13px ${FONT_REG}`;
      ctx.fillStyle = '#334155';
      ctx.fillText(F2(t.rate), rX - 12, curY + 21);
      rX -= cols[4].w;

      // USD Converted
      ctx.textAlign = 'right';
      ctx.font = `bold 13.5px ${FONT_BLD}`;
      ctx.fillStyle = isBuy ? '#047857' : '#b45309';
      ctx.fillText(F(t.converted), rX - 12, curY + 21);

      curY += 32;
    });

    curY += 12;
  }

  // Draw Buys & Sells
  drawTable(fin.buys, 'buy');
  drawTable(fin.sells, 'sell');

  // Summary Cards (Buy / Sell Cards side by side)
  const cardW = (contentW - 14) / 2; // 350px
  const cardH = 150;

  function drawCardRow(label, value, y, cardStartX) {
    ctx.textAlign = 'right';
    ctx.font = `12px ${FONT_REG}`;
    ctx.fillStyle = '#64748b';
    ctx.fillText(label, cardStartX + cardW - 16, y);

    ctx.textAlign = 'left';
    ctx.font = `bold 13px ${FONT_BLD}`;
    ctx.fillStyle = '#0f172a';
    ctx.fillText(value, cardStartX + 16, y);
  }

  // Buy Card (Right side in RTL)
  const buyCardX = padX + cardW + 14;
  ctx.fillStyle = '#f0fdf4';
  roundRect(ctx, buyCardX, curY, cardW, cardH, 8);
  ctx.fill();
  ctx.strokeStyle = '#bbf7d0';
  ctx.stroke();

  ctx.fillStyle = '#047857';
  roundRect(ctx, buyCardX, curY, cardW, 4, { tl: 8, tr: 8, br: 0, bl: 0 });
  ctx.fill();

  ctx.textAlign = 'right';
  ctx.font = `bold 13.5px ${FONT_BLD}`;
  ctx.fillStyle = '#065f46';
  ctx.fillText('مجموع خریدها', buyCardX + cardW - 16, curY + 24);

  drawCardRow('نرخ اوسط:', F(fin.buy.avg), curY + 50, buyCardX);

  ctx.strokeStyle = '#bbf7d0';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(buyCardX + 16, curY + 68);
  ctx.lineTo(buyCardX + cardW - 16, curY + 68);
  ctx.stroke();
  ctx.setLineDash([]);

  drawCardRow('مجموع تومان:', F(fin.buy.toman), curY + 90, buyCardX);
  drawCardRow('مجموع دالر:', F(fin.buy.total) + ' دالر', curY + 112, buyCardX);
  drawCardRow('تعداد معاملات:', String(fin.buy.count), curY + 132, buyCardX);

  // Sell Card (Left side in RTL)
  const sellCardX = padX;
  ctx.fillStyle = '#fff7ed';
  roundRect(ctx, sellCardX, curY, cardW, cardH, 8);
  ctx.fill();
  ctx.strokeStyle = '#fed7aa';
  ctx.stroke();

  ctx.fillStyle = '#c2410c';
  roundRect(ctx, sellCardX, curY, cardW, 4, { tl: 8, tr: 8, br: 0, bl: 0 });
  ctx.fill();

  ctx.textAlign = 'right';
  ctx.font = `bold 13.5px ${FONT_BLD}`;
  ctx.fillStyle = '#9a3412';
  ctx.fillText('مجموع فروش‌ها', sellCardX + cardW - 16, curY + 24);

  drawCardRow('نرخ اوسط:', F(fin.sell.avg), curY + 50, sellCardX);

  ctx.strokeStyle = '#fed7aa';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(sellCardX + 16, curY + 68);
  ctx.lineTo(sellCardX + cardW - 16, curY + 68);
  ctx.stroke();
  ctx.setLineDash([]);

  drawCardRow('مجموع تومان:', F(fin.sell.toman), curY + 90, sellCardX);
  drawCardRow('مجموع دالر:', F(fin.sell.total) + ' دالر', curY + 112, sellCardX);
  drawCardRow('تعداد معاملات:', String(fin.sell.count), curY + 132, sellCardX);

  curY += cardH + 14;

  // Profit / Loss Banner (Exact styling as Android .pf)
  let pfBg = '#eef1f5';
  let pfBorder = '#cfd8ea';
  let pfColor = '#334155';
  let pfText = `یر به یر: 0 دالر`;

  if (fin.profit > 0) {
    pfBg = '#dff7ee';
    pfBorder = '#a7f3d0';
    pfColor = '#0a7a58';
    pfText = `مفاد: ${F(fin.profit)} دالر`;
  } else if (fin.profit < 0) {
    pfBg = '#ffe3e8';
    pfBorder = '#fecdd3';
    pfColor = '#c0223f';
    pfText = `ضرر: ${F(Math.abs(fin.profit))} دالر`;
  }

  ctx.fillStyle = pfBg;
  roundRect(ctx, padX, curY, contentW, 46, 8);
  ctx.fill();
  ctx.strokeStyle = pfBorder;
  ctx.stroke();

  ctx.fillStyle = pfColor;
  ctx.font = `bold 18px ${FONT_BLD}`;
  ctx.textAlign = 'center';
  ctx.fillText(pfText, padX + contentW / 2, curY + 29);

  return canvas.toBuffer('image/png');
}

/**
 * Render Vector PDF using PDFKit
 * Exact natural height with zero extraneous header/footer text
 */
function renderReportPdf(list, info, dateText) {
  return new Promise((resolve, reject) => {
    try {
      const pngBuffer = renderReportImage(list, info, dateText);
      const totalH = computeReportHeight(list, info);
      const baseW = 794;

      const doc = new PDFDocument({
        size: [baseW, totalH],
        margin: 0
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      doc.image(pngBuffer, 0, 0, { width: baseW, height: totalH });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate standard Text Report (1:1 with Android ReportGenerator.copyReportText)
 */
function generateTextReport(list, dateText) {
  const fin = calculateList(list.trades);
  const dateStr = dateText?.fullDate || 'امروز';
  const dash = '---------------';

  let profitLine = 'مفاد: 0 دالر';
  if (fin.profit > 0) {
    profitLine = `مفاد: ${F(fin.profit)} دالر`;
  } else if (fin.profit < 0) {
    profitLine = `ضرر: ${F(Math.abs(fin.profit))} دالر`;
  }

  return `${dateStr}  (${list.name || 'لیست معاملات'})
${dash}
خرید
${dash}
مجموع تومان: ${F(fin.buy.toman)}
میانگین نرخ: ${F(fin.buy.avg)}
مجموع دالر: ${F(fin.buy.total)}
${dash}
فروش
${dash}
مجموع تومان: ${F(fin.sell.toman)}
میانگین نرخ: ${F(fin.sell.avg)}
مجموع دالر: ${F(fin.sell.total)}
${profitLine}`;
}

module.exports = {
  renderReportImage,
  renderReportPdf,
  generateTextReport,
  calculateList,
  computeReportHeight,
  F,
  F2
};
