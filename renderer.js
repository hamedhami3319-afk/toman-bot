/**
 * High-Fidelity Canvas & PDF Renderer for Toman Exchange Reports
 * 100% Self-Contained with Embedded Vazirmatn Fonts (Zero external files needed)
 * 2x DPI Retina Scaling for Crystal Clear Text and Tables
 * Dynamic Natural-Height Cropping (No empty white spaces)
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
 * Calculate list financials (1:1 match with Android Finance.calc)
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
 * Pre-computes exact content height to crop out all empty white spaces
 */
function computeReportHeight(list, info) {
  const trades = list.trades || [];
  const buys = trades.filter(t => t.side === 'buy');
  const sells = trades.filter(t => t.side === 'sell');

  let h = 36; // Top padding

  // Header Letterhead
  const hasInfo = info && (info.name || info.phone || info.address);
  if (hasInfo) h += 65;
  h += 60; // Title bar + dates + divider
  h += 16;

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
  h += 60;

  // Footer banner
  h += 45;

  h += 30; // Bottom padding
  return Math.max(h, 480);
}

/**
 * Render Ultra High-Resolution Crisp PNG (2x Retina scale)
 */
function renderReportImage(list, info, dateText) {
  const baseW = 794; // Standard A4 width base
  const totalH = computeReportHeight(list, info);
  const padX = 40;
  const contentW = baseW - (padX * 2); // 714px

  // 2x Retina Scaling for ultra-crisp fonts and graphics
  const SCALE = 2;
  const canvasW = baseW * SCALE;
  const canvasH = totalH * SCALE;

  const canvas = canvasModule.createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');

  // Scale all drawing operations by 2
  ctx.scale(SCALE, SCALE);

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, baseW, totalH);

  let curY = 32;

  // 1. Header (Letterhead)
  if (info && (info.name || info.phone || info.address)) {
    ctx.textAlign = 'right';
    if (info.name) {
      ctx.fillStyle = '#111827';
      ctx.font = `bold 21px ${FONT_BLD}`;
      ctx.fillText(info.name, baseW - padX, curY + 22);
    }
    let subY = curY + 44;
    ctx.fillStyle = '#4b5563';
    ctx.font = `12.5px ${FONT_REG}`;
    const subLines = [info.phone, info.address].filter(Boolean).join('  |  ');
    if (subLines) {
      ctx.fillText(subLines, baseW - padX, subY);
    }
    curY += 60;
  }

  // Divider
  ctx.strokeStyle = '#cfd8ea';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padX, curY);
  ctx.lineTo(baseW - padX, curY);
  ctx.stroke();
  curY += 16;

  // Title bar
  const listTitle = `معاملات (${list.name || 'لیست معاملات'})`;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#0f172a';
  ctx.font = `bold 18px ${FONT_BLD}`;
  ctx.fillText(listTitle, baseW - padX, curY + 20);

  // Optional code badge
  if (list.code) {
    const titleWidth = ctx.measureText(listTitle).width;
    const badgeX = baseW - padX - titleWidth - 14;
    ctx.font = `bold 11px ${FONT_BLD}`;
    const badgeW = ctx.measureText(list.code).width + 14;
    ctx.fillStyle = '#e2e8f0';
    roundRect(ctx, badgeX - badgeW, curY + 4, badgeW, 20, 5);
    ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.textAlign = 'center';
    ctx.fillText(list.code, badgeX - (badgeW / 2), curY + 18);
  }

  // Date and Time (on the left side)
  ctx.textAlign = 'left';
  ctx.font = `12.5px ${FONT_REG}`;
  ctx.fillStyle = '#64748b';
  ctx.fillText('تاریخ: ' + (dateText?.date || 'امروز'), padX, curY + 12);
  ctx.fillText('ساعت: ' + (dateText?.time || 'اکنون'), padX, curY + 28);

  curY += 46;

  const fin = calculateList(list.trades);

  // Table Renderer (Buy / Sell)
  function drawTable(trades, side) {
    const isBuy = side === 'buy';
    const primaryColor = isBuy ? '#1f4e8c' : '#c2620a';
    const bgHeader = isBuy ? '#eef4fd' : '#fff4eb';
    const titleText = isBuy ? 'خریدات' : 'فروشات';

    // Section title with colored bar accent
    ctx.fillStyle = primaryColor;
    ctx.fillRect(baseW - padX - 4, curY, 4, 22);

    ctx.textAlign = 'right';
    ctx.font = `bold 15px ${FONT_BLD}`;
    ctx.fillStyle = primaryColor;
    ctx.fillText(titleText, baseW - padX - 12, curY + 17);

    // Count badge
    const badgeText = String(trades.length);
    ctx.font = `bold 11.5px ${FONT_BLD}`;
    const pW = ctx.measureText(badgeText).width + 16;
    ctx.fillStyle = isBuy ? '#dbeafe' : '#ffedd5';
    roundRect(ctx, baseW - padX - 85 - pW, curY + 1, pW, 20, 10);
    ctx.fill();
    ctx.fillStyle = primaryColor;
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, baseW - padX - 85 - (pW / 2), curY + 15);

    curY += 28;

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

    // Column definitions
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

    let curColX = baseW - padX;
    for (const c of cols) {
      curColX -= c.w;
      ctx.fillStyle = '#334155';
      ctx.font = `bold 12px ${FONT_BLD}`;
      if (c.align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(c.label, curColX + (c.w / 2), curY + 20);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(c.label, curColX + c.w - 10, curY + 20);
      }
    }
    curY += 32;

    // Body rows
    trades.forEach((t, idx) => {
      const rowY = curY;
      const isEven = idx % 2 === 0;

      ctx.fillStyle = isEven ? '#ffffff' : '#f8fafc';
      ctx.fillRect(padX, rowY, contentW, 30);

      // Row bottom line
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX, rowY + 30);
      ctx.lineTo(baseW - padX, rowY + 30);
      ctx.stroke();

      let cellX = baseW - padX;
      for (const c of cols) {
        cellX -= c.w;
        let text = '';
        if (c.key === 'idx') text = String(idx + 1);
        else if (c.key === 'name') text = t.name || '-';
        else if (c.key === 'province') text = t.province || '-';
        else if (c.key === 'toman') text = F(t.toman);
        else if (c.key === 'rate') text = F2(t.rate);
        else if (c.key === 'usd') text = F(t.converted);

        ctx.fillStyle = c.bold ? '#0f172a' : '#1e293b';
        ctx.font = c.bold ? `bold 13px ${FONT_BLD}` : `13px ${FONT_REG}`;

        if (c.align === 'center') {
          ctx.textAlign = 'center';
          ctx.fillText(text, cellX + (c.w / 2), rowY + 20);
        } else {
          ctx.textAlign = 'right';
          ctx.fillText(text, cellX + c.w - 10, rowY + 20);
        }
      }

      curY += 31;
    });

    curY += 14;
  }

  // Draw Buys
  drawTable(fin.buys, 'buy');

  // Draw Sells
  drawTable(fin.sells, 'sell');

  // Summary Cards block
  const cardW = (contentW - 14) / 2;
  const cardH = 145;

  const buyCardX = baseW - padX - cardW;
  const sellCardX = padX;

  // Buy Card
  ctx.fillStyle = '#f3f7fe';
  roundRect(ctx, buyCardX, curY, cardW, cardH, 12);
  ctx.fill();
  ctx.strokeStyle = '#cfd8ea';
  ctx.stroke();

  ctx.fillStyle = '#1f4e8c';
  roundRect(ctx, buyCardX, curY, cardW, 5, { tl: 12, tr: 12, br: 0, bl: 0 });
  ctx.fill();

  ctx.textAlign = 'right';
  ctx.fillStyle = '#1f4e8c';
  ctx.font = `bold 14px ${FONT_BLD}`;
  ctx.fillText('مجموع خریدات', buyCardX + cardW - 16, curY + 26);

  ctx.fillStyle = '#64748b';
  ctx.font = `12px ${FONT_REG}`;
  ctx.fillText('فی اوسط:', buyCardX + cardW - 16, curY + 54);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';
  ctx.font = `bold 22px ${FONT_BLD}`;
  ctx.fillText(F(fin.buy.avg), buyCardX + 16, curY + 56);

  // Dashed separator
  ctx.strokeStyle = '#cbd5e1';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(buyCardX + 16, curY + 70);
  ctx.lineTo(buyCardX + cardW - 16, curY + 70);
  ctx.stroke();
  ctx.setLineDash([]);

  function drawCardRow(label, value, yPos, parentX) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#475569';
    ctx.font = `12px ${FONT_REG}`;
    ctx.fillText(label, parentX + cardW - 16, yPos);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f172a';
    ctx.font = `bold 13px ${FONT_BLD}`;
    ctx.fillText(value, parentX + 16, yPos);
  }

  drawCardRow('مجموع تومان:', F(fin.buy.toman), curY + 92, buyCardX);
  drawCardRow('مجموع دالر:', F(fin.buy.total) + ' دالر', curY + 114, buyCardX);
  drawCardRow('تعداد معاملات:', String(fin.buy.count), curY + 134, buyCardX);

  // Sell Card
  ctx.fillStyle = '#fff6ec';
  roundRect(ctx, sellCardX, curY, cardW, cardH, 12);
  ctx.fill();
  ctx.strokeStyle = '#f0d9bd';
  ctx.stroke();

  ctx.fillStyle = '#c2620a';
  roundRect(ctx, sellCardX, curY, cardW, 5, { tl: 12, tr: 12, br: 0, bl: 0 });
  ctx.fill();

  ctx.textAlign = 'right';
  ctx.fillStyle = '#9a4a07';
  ctx.font = `bold 14px ${FONT_BLD}`;
  ctx.fillText('مجموع فروشات', sellCardX + cardW - 16, curY + 26);

  ctx.fillStyle = '#64748b';
  ctx.font = `12px ${FONT_REG}`;
  ctx.fillText('فی اوسط:', sellCardX + cardW - 16, curY + 54);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';
  ctx.font = `bold 22px ${FONT_BLD}`;
  ctx.fillText(F(fin.sell.avg), sellCardX + 16, curY + 56);

  ctx.strokeStyle = '#fed7aa';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(sellCardX + 16, curY + 70);
  ctx.lineTo(sellCardX + cardW - 16, curY + 70);
  ctx.stroke();
  ctx.setLineDash([]);

  drawCardRow('مجموع تومان:', F(fin.sell.toman), curY + 92, sellCardX);
  drawCardRow('مجموع دالر:', F(fin.sell.total) + ' دالر', curY + 114, sellCardX);
  drawCardRow('تعداد معاملات:', String(fin.sell.count), curY + 134, sellCardX);

  curY += cardH + 16;

  // Profit / Loss Banner
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
  roundRect(ctx, padX, curY, contentW, 46, 10);
  ctx.fill();
  ctx.strokeStyle = pfBorder;
  ctx.stroke();

  ctx.fillStyle = pfColor;
  ctx.font = `bold 18px ${FONT_BLD}`;
  ctx.textAlign = 'center';
  ctx.fillText(pfText, padX + contentW / 2, curY + 29);

  curY += 58;

  // Footer (HAMED-SOFTWARE & Phone)
  ctx.fillStyle = '#94a3b8';
  ctx.font = `11.5px ${FONT_REG}`;
  ctx.textAlign = 'right';
  ctx.fillText('HAMED-SOFTWARE', baseW - padX, curY + 14);
  ctx.textAlign = 'left';
  ctx.fillText('+93 794557385', padX, curY + 14);

  return canvas.toBuffer('image/png');
}

/**
 * Render Vector PDF using PDFKit
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

  return `${dateStr}
معاملات (${list.name || 'لیست معاملات'})
${dash} خریدات ${dash}
کل خریدات: ${F(fin.buy.toman)} تومان
فی اوسط: ${F(fin.buy.avg)}
مبلغ دالر: ${F(fin.buy.total)}
${dash} فروشات ${dash}
کل فروشات: ${F(fin.sell.toman)} تومان
فی اوسط: ${F(fin.sell.avg)}
مبلغ دالr: ${F(fin.sell.total)}
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
