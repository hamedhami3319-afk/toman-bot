/**
 * High-fidelity canvas renderer for Exchange Reports
 * 1:1 match with Android report.css and reportpages.js
 * Supports natural-height cropping for short lists (no blank white gaps!)
 */

const path = require('path');
const fs = require('fs');
let canvasModule = null;
let PDFDocument = null;

try {
  canvasModule = require('@napi-rs/canvas');
} catch (e) {
  try {
    canvasModule = require('./node_modules/@napi-rs/canvas');
  } catch (err) {
    console.error('Could not load @napi-rs/canvas:', err.message);
  }
}

try {
  PDFDocument = require('pdfkit');
} catch (e) {
  try {
    PDFDocument = require('./node_modules/pdfkit');
  } catch (err) {
    console.error('Could not load pdfkit:', err.message);
  }
}

// Register fonts if available
let fontRegularLoaded = false;
let fontBoldLoaded = false;

if (canvasModule && canvasModule.GlobalFonts) {
  const fontPaths = [
    path.join(__dirname, 'fonts', 'Vazirmatn-Regular.ttf'),
    path.join(process.cwd(), 'fonts', 'Vazirmatn-Regular.ttf'),
    path.join(__dirname, '..', 'telegram-bot', 'fonts', 'Vazirmatn-Regular.ttf')
  ];
  for (const fp of fontPaths) {
    if (fs.existsSync(fp)) {
      try {
        canvasModule.GlobalFonts.registerFromPath(fp, 'Vazirmatn');
        fontRegularLoaded = true;
        break;
      } catch (err) {
        console.warn('Error loading regular font:', err.message);
      }
    }
  }

  const boldPaths = [
    path.join(__dirname, 'fonts', 'Vazirmatn-Bold.ttf'),
    path.join(process.cwd(), 'fonts', 'Vazirmatn-Bold.ttf'),
    path.join(__dirname, '..', 'telegram-bot', 'fonts', 'Vazirmatn-Bold.ttf')
  ];
  for (const bp of boldPaths) {
    if (fs.existsSync(bp)) {
      try {
        canvasModule.GlobalFonts.registerFromPath(bp, 'VazirmatnBold');
        fontBoldLoaded = true;
        break;
      } catch (err) {
        console.warn('Error loading bold font:', err.message);
      }
    }
  }
}

const FONT_REGULAR = fontRegularLoaded ? 'Vazirmatn, sans-serif' : 'sans-serif';
const FONT_BOLD = fontBoldLoaded ? 'VazirmatnBold, Vazirmatn, sans-serif' : 'sans-serif';

/**
 * Format numbers with comma grouping and English digits (matching Android I18n.F / I18n.F2)
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
 * Calculate list financials (matching Android Finance.calc)
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
 * Pre-computes exact height to achieve natural cropping with zero blank space
 */
function computeReportHeight(list, info) {
  const trades = list.trades || [];
  const buys = trades.filter(t => t.side === 'buy');
  const sells = trades.filter(t => t.side === 'sell');

  let h = 40; // Top padding
  // Header
  const hasInfo = info && (info.name || info.phone || info.address);
  if (hasInfo) h += 65;
  h += 60; // Title bar + dates + divider
  h += 20;

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

  // Summary cards (2 side by side)
  h += 165;

  // Profit box
  h += 60;

  // Footer banner
  h += 45;

  h += 35; // Bottom padding
  return Math.max(h, 480);
}

/**
 * Render report to crisp PNG buffer
 */
function renderReportImage(list, info, dateText) {
  if (!canvasModule) throw new Error('@napi-rs/canvas is not loaded');

  const width = 794; // Standard A4 width (96 DPI)
  const padX = 40;
  const contentW = width - (padX * 2); // 714px
  const totalH = computeReportHeight(list, info);

  const canvas = canvasModule.createCanvas(width, totalH);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, totalH);

  let curY = 36;

  // 1. Header (Letterhead if info exists)
  if (info && (info.name || info.phone || info.address)) {
    ctx.textAlign = 'right';
    if (info.name) {
      ctx.fillStyle = '#111827';
      ctx.font = `bold 20px ${FONT_BOLD}`;
      ctx.fillText(info.name, width - padX, curY + 20);
    }
    let subY = curY + 40;
    ctx.fillStyle = '#4b5563';
    ctx.font = `12px ${FONT_REGULAR}`;
    const subLines = [info.phone, info.address].filter(Boolean).join('  |  ');
    if (subLines) {
      ctx.fillText(subLines, width - padX, subY);
    }
    curY += 60;
  }

  // Divider
  ctx.strokeStyle = '#cfd8ea';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padX, curY);
  ctx.lineTo(width - padX, curY);
  ctx.stroke();
  curY += 16;

  // Title bar
  const listTitle = `معاملات (${list.name || 'لیست معاملات'})`;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#0f172a';
  ctx.font = `bold 18px ${FONT_BOLD}`;
  ctx.fillText(listTitle, width - padX, curY + 20);

  // Optional code badge
  if (list.code) {
    const titleWidth = ctx.measureText(listTitle).width;
    const badgeX = width - padX - titleWidth - 14;
    ctx.font = `bold 11px ${FONT_BOLD}`;
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
  ctx.font = `12px ${FONT_REGULAR}`;
  ctx.fillStyle = '#64748b';
  ctx.fillText('تاریخ: ' + (dateText?.date || 'امروز'), padX, curY + 12);
  ctx.fillText('ساعت: ' + (dateText?.time || 'اکنون'), padX, curY + 28);

  curY += 46;

  const fin = calculateList(list.trades);

  // Helper function to render a table (Buy / Sell)
  function drawTable(trades, side) {
    const isBuy = side === 'buy';
    const primaryColor = isBuy ? '#1f4e8c' : '#c2620a';
    const bgHeader = isBuy ? '#eef4fd' : '#fff4eb';
    const titleText = isBuy ? 'خریدات' : 'فروشات';

    // Section title with colored side accent
    ctx.fillStyle = primaryColor;
    ctx.fillRect(width - padX - 4, curY, 4, 22);

    ctx.textAlign = 'right';
    ctx.font = `bold 15px ${FONT_BOLD}`;
    ctx.fillStyle = primaryColor;
    ctx.fillText(titleText, width - padX - 12, curY + 17);

    // Count pill badge
    const badgeText = String(trades.length);
    ctx.font = `bold 11px ${FONT_BOLD}`;
    const pW = ctx.measureText(badgeText).width + 16;
    ctx.fillStyle = isBuy ? '#dbeafe' : '#ffedd5';
    roundRect(ctx, width - padX - 85 - pW, curY + 1, pW, 20, 10);
    ctx.fill();
    ctx.fillStyle = primaryColor;
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, width - padX - 85 - (pW / 2), curY + 15);

    curY += 28;

    if (trades.length === 0) {
      ctx.fillStyle = '#f8fafc';
      roundRect(ctx, padX, curY, contentW, 36, 6);
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.font = `13px ${FONT_REGULAR}`;
      ctx.textAlign = 'center';
      ctx.fillText('هیچ معامله‌ای در این بخش وجود ندارد.', padX + contentW / 2, curY + 23);
      curY += 46;
      return;
    }

    // Column definitions
    // Table width: 714px
    // Columns: # (35px), نام (180px), ولایت (85px), مبلغ تومان (140px), نرخ (114px), معادل دالر (160px)
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

    let curColX = width - padX;
    // RTL ordering
    for (const c of cols) {
      curColX -= c.w;
      ctx.fillStyle = '#334155';
      ctx.font = `bold 12px ${FONT_BOLD}`;
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

      // Row bottom border
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX, rowY + 30);
      ctx.lineTo(width - padX, rowY + 30);
      ctx.stroke();

      let cellX = width - padX;
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
        ctx.font = c.bold ? `bold 13px ${FONT_BOLD}` : `13px ${FONT_REGULAR}`;

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

  // Summary Cards block (side by side)
  const cardW = (contentW - 14) / 2; // ~350px each
  const cardH = 145;

  // Buy Card (Left or Right in RTL: Buy on right)
  const buyCardX = width - padX - cardW;
  const sellCardX = padX;

  // Draw Buy Card
  ctx.fillStyle = '#f3f7fe';
  roundRect(ctx, buyCardX, curY, cardW, cardH, 12);
  ctx.fill();
  ctx.strokeStyle = '#cfd8ea';
  ctx.stroke();

  // Top colored border (5px)
  ctx.fillStyle = '#1f4e8c';
  roundRect(ctx, buyCardX, curY, cardW, 5, { tl: 12, tr: 12, br: 0, bl: 0 });
  ctx.fill();

  // Buy Card Content
  ctx.textAlign = 'right';
  ctx.fillStyle = '#1f4e8c';
  ctx.font = `bold 14px ${FONT_BOLD}`;
  ctx.fillText('مجموع خریدات', buyCardX + cardW - 16, curY + 26);

  ctx.fillStyle = '#64748b';
  ctx.font = `12px ${FONT_REGULAR}`;
  ctx.fillText('فی اوسط:', buyCardX + cardW - 16, curY + 54);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';
  ctx.font = `bold 22px ${FONT_BOLD}`;
  ctx.fillText(F(fin.buy.avg), buyCardX + 16, curY + 56);

  // Dashed separator
  ctx.strokeStyle = '#cbd5e1';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(buyCardX + 16, curY + 70);
  ctx.lineTo(buyCardX + cardW - 16, curY + 70);
  ctx.stroke();
  ctx.setLineDash([]);

  // Sub rows
  function drawCardRow(label, value, yPos, parentX) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#475569';
    ctx.font = `12px ${FONT_REGULAR}`;
    ctx.fillText(label, parentX + cardW - 16, yPos);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f172a';
    ctx.font = `bold 13px ${FONT_BOLD}`;
    ctx.fillText(value, parentX + 16, yPos);
  }

  drawCardRow('مجموع تومان:', F(fin.buy.toman), curY + 92, buyCardX);
  drawCardRow('مجموع دالر:', F(fin.buy.total) + ' دالر', curY + 114, buyCardX);
  drawCardRow('تعداد معاملات:', String(fin.buy.count), curY + 134, buyCardX);

  // Draw Sell Card
  ctx.fillStyle = '#fff6ec';
  roundRect(ctx, sellCardX, curY, cardW, cardH, 12);
  ctx.fill();
  ctx.strokeStyle = '#f0d9bd';
  ctx.stroke();

  // Top colored border (5px)
  ctx.fillStyle = '#c2620a';
  roundRect(ctx, sellCardX, curY, cardW, 5, { tl: 12, tr: 12, br: 0, bl: 0 });
  ctx.fill();

  // Sell Card Content
  ctx.textAlign = 'right';
  ctx.fillStyle = '#9a4a07';
  ctx.font = `bold 14px ${FONT_BOLD}`;
  ctx.fillText('مجموع فروشات', sellCardX + cardW - 16, curY + 26);

  ctx.fillStyle = '#64748b';
  ctx.font = `12px ${FONT_REGULAR}`;
  ctx.fillText('فی اوسط:', sellCardX + cardW - 16, curY + 54);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';
  ctx.font = `bold 22px ${FONT_BOLD}`;
  ctx.fillText(F(fin.sell.avg), sellCardX + 16, curY + 56);

  // Dashed separator
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
  ctx.font = `bold 18px ${FONT_BOLD}`;
  ctx.textAlign = 'center';
  ctx.fillText(pfText, padX + contentW / 2, curY + 29);

  curY += 58;

  // Footer (HAMED-SOFTWARE & Phone)
  ctx.fillStyle = '#94a3b8';
  ctx.font = `11px ${FONT_REGULAR}`;
  ctx.textAlign = 'right';
  ctx.fillText('HAMED-SOFTWARE', width - padX, curY + 14);
  ctx.textAlign = 'left';
  ctx.fillText('+93 794557385', padX, curY + 14);

  return canvas.toBuffer('image/png');
}

/**
 * Render report to PDF Buffer using PDFKit
 */
function renderReportPdf(list, info, dateText) {
  if (!PDFDocument) throw new Error('pdfkit is not loaded');

  return new Promise((resolve, reject) => {
    try {
      const pngBuffer = renderReportImage(list, info, dateText);
      const totalH = computeReportHeight(list, info);
      const width = 794;

      const doc = new PDFDocument({
        size: [width, totalH],
        margin: 0
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      doc.image(pngBuffer, 0, 0, { width, height: totalH });
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
مبلغ دالر: ${F(fin.sell.total)}
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
