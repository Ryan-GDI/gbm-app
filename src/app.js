// GBM main application logic
// Adapted from the prototype widget to use Supabase backend

import * as DB from './db.js';

// ===== CONSTANTS =====
const COUNTRIES = {
  ZA:{name:'South Africa',currency:'ZAR',symbol:'R',taxLabel:'VAT',taxRate:15,deadlines:[{label:'VAT return',type:'monthly',day:25,vatOnly:true},{label:'1st provisional tax',type:'annual',month:8,day:31},{label:'2nd provisional tax',type:'annual',month:2,day:28},{label:'Annual income tax return',type:'annual',month:11,day:30}]},
  US:{name:'United States',currency:'USD',symbol:'$',taxLabel:'Sales tax',taxRate:0,deadlines:[{label:'Quarterly estimated tax',type:'multi',dates:[{m:4,d:15},{m:6,d:15},{m:9,d:15},{m:1,d:15}]},{label:'Annual return (Form 1040)',type:'annual',month:4,day:15}]},
  GB:{name:'United Kingdom',currency:'GBP',symbol:'£',taxLabel:'VAT',taxRate:20,deadlines:[{label:'Quarterly VAT return',type:'multi',dates:[{m:1,d:7},{m:4,d:7},{m:7,d:7},{m:10,d:7}],vatOnly:true},{label:'Self Assessment return',type:'annual',month:1,day:31}]},
  AU:{name:'Australia',currency:'AUD',symbol:'A$',taxLabel:'GST',taxRate:10,deadlines:[{label:'Quarterly BAS',type:'multi',dates:[{m:10,d:28},{m:2,d:28},{m:4,d:28},{m:7,d:28}],vatOnly:true},{label:'Annual tax return',type:'annual',month:10,day:31}]},
  NZ:{name:'New Zealand',currency:'NZD',symbol:'NZ$',taxLabel:'GST',taxRate:15,deadlines:[{label:'GST return',type:'multi',dates:[{m:1,d:28},{m:3,d:28},{m:5,d:28},{m:7,d:28},{m:9,d:28},{m:11,d:28}],vatOnly:true},{label:'Income tax return',type:'annual',month:7,day:7}]},
  CA:{name:'Canada',currency:'CAD',symbol:'C$',taxLabel:'GST/HST',taxRate:5,deadlines:[{label:'Quarterly instalments',type:'multi',dates:[{m:3,d:15},{m:6,d:15},{m:9,d:15},{m:12,d:15}]},{label:'Annual T1 return',type:'annual',month:4,day:30}]},
  IN:{name:'India',currency:'INR',symbol:'₹',taxLabel:'GST',taxRate:18,deadlines:[{label:'GSTR-3B monthly',type:'monthly',day:20,vatOnly:true},{label:'Annual income tax return',type:'annual',month:7,day:31}]},
  KE:{name:'Kenya',currency:'KES',symbol:'KSh',taxLabel:'VAT',taxRate:16,deadlines:[{label:'VAT return',type:'monthly',day:20,vatOnly:true},{label:'Annual income tax',type:'annual',month:6,day:30}]},
  NG:{name:'Nigeria',currency:'NGN',symbol:'₦',taxLabel:'VAT',taxRate:7.5,deadlines:[{label:'VAT return',type:'monthly',day:21,vatOnly:true},{label:'Companies income tax',type:'annual',month:6,day:30}]},
  SG:{name:'Singapore',currency:'SGD',symbol:'S$',taxLabel:'GST',taxRate:9,deadlines:[{label:'Quarterly GST return',type:'multi',dates:[{m:1,d:31},{m:4,d:30},{m:7,d:31},{m:10,d:31}],vatOnly:true},{label:'Annual corporate tax',type:'annual',month:11,day:30}]},
  AE:{name:'United Arab Emirates',currency:'AED',symbol:'AED',taxLabel:'VAT',taxRate:5,deadlines:[{label:'Quarterly VAT return',type:'multi',dates:[{m:1,d:28},{m:4,d:28},{m:7,d:28},{m:10,d:28}],vatOnly:true}]},
  DE:{name:'Germany',currency:'EUR',symbol:'€',taxLabel:'VAT',taxRate:19,deadlines:[{label:'VAT return',type:'monthly',day:10,vatOnly:true},{label:'Annual income tax return',type:'annual',month:7,day:31}]},
  OTHER:{name:'Other / custom',currency:'USD',symbol:'$',taxLabel:'Tax',taxRate:0,deadlines:[]}
};
const CURRENCIES = [{c:'ZAR',s:'R'},{c:'USD',s:'$'},{c:'EUR',s:'€'},{c:'GBP',s:'£'},{c:'AUD',s:'A$'},{c:'NZD',s:'NZ$'},{c:'CAD',s:'C$'},{c:'INR',s:'₹'},{c:'KES',s:'KSh'},{c:'NGN',s:'₦'},{c:'SGD',s:'S$'},{c:'AED',s:'AED'},{c:'JPY',s:'¥'},{c:'CNY',s:'¥'},{c:'BRL',s:'R$'},{c:'CHF',s:'CHF'}];
const CATS = ['Office','Travel','Marketing','Utilities','Subscriptions','Equipment','Inventory','Professional fees','Bank charges','Rent','Salaries','Other'];
const PMTS = ['Bank transfer','Cash','Card','Cheque','Mobile money','Other'];
const GDI_GLOBE = '/gdi-globe.jpg';

// ===== STATE =====
let D = { settings:{}, customers:[], invoices:[], quotes:[], expenses:[] };
let view = 'dash', sub = null, tmpReceipt = null, tmpRType = 'image', salesTab = 'inv', reportTab = 'sum';
let logoDataUrl = null;

// ===== HELPERS =====
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const round2 = n => Math.round(Number(n||0)*100)/100;
const fmt = (n, sy) => { const s = sy || D?.settings?.currencySymbol || '$'; return s + ' ' + round2(n).toLocaleString('en', {minimumFractionDigits:2, maximumFractionDigits:2}); };
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };
const uid = () => crypto.randomUUID();
const fmtDate = s => { if (!s) return ''; const d = new Date(s); return d.toLocaleDateString('en', {day:'2-digit',month:'short',year:'numeric'}); };
const sym = cur => { const c = CURRENCIES.find(x => x.c === cur); return c ? c.s : cur; };

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), 1800);
}

function invBal(i) { const p = (i.payments||[]).reduce((s,x) => s + (Number(x.amount)||0), 0); return round2((i.total||0) - p); }
function invPaid(i) { return (i.payments||[]).reduce((s,x) => s + (Number(x.amount)||0), 0); }
function invStatus(i) { const b = invBal(i), p = invPaid(i); if (b <= 0.01 && p > 0) return 'paid'; if (p > 0) return 'partial'; if (i.due && new Date(i.due) < new Date(today())) return 'overdue'; return 'unpaid'; }
function totalAR() { return D.invoices.reduce((s,i) => s + toBase(invBal(i), i), 0); }
function toBase(amt, o) { const r = o?.exchangeRate; if (!o?.currency || o.currency === D.settings.currency) return Number(amt)||0; return (Number(amt)||0) * (Number(r)||1); }

function nextTaxDates() {
  const c = COUNTRIES[D.settings.country] || COUNTRIES.OTHER;
  const now = new Date(), out = [];
  c.deadlines.forEach(dl => {
    if (dl.vatOnly && !D.settings.isTaxRegistered) return;
    if (dl.type === 'monthly') { let d = new Date(now.getFullYear(), now.getMonth(), dl.day); if (d <= now) d = new Date(now.getFullYear(), now.getMonth()+1, dl.day); out.push({label:dl.label, date:d}); }
    else if (dl.type === 'annual') { let d = new Date(now.getFullYear(), dl.month-1, dl.day); if (d <= now) d = new Date(now.getFullYear()+1, dl.month-1, dl.day); out.push({label:dl.label, date:d}); }
    else if (dl.type === 'multi') { let nx = null; for (let y = now.getFullYear(); y <= now.getFullYear()+1; y++) for (const dt of dl.dates) { const d = new Date(y, dt.m-1, dt.d); if (d > now && (!nx || d < nx)) nx = d; } if (nx) out.push({label:dl.label, date:nx}); }
  });
  out.sort((a,b) => a.date - b.date);
  return out;
}

function recvThisMonth() { const n = new Date(), y = n.getFullYear(), m = n.getMonth(); let t = 0; D.invoices.forEach(i => (i.payments||[]).forEach(p => { const d = new Date(p.date); if (d.getFullYear() === y && d.getMonth() === m) t += toBase(p.amount, i); })); return t; }
function expThisMonth() { const n = new Date(), y = n.getFullYear(), m = n.getMonth(); return D.expenses.filter(e => { const d = new Date(e.date); return d.getFullYear() === y && d.getMonth() === m; }).reduce((s,e) => s + toBase(e.amount, e), 0); }

function ytd() {
  const y = new Date().getFullYear();
  const iv = D.invoices.filter(i => new Date(i.date).getFullYear() === y);
  const ex = D.expenses.filter(e => new Date(e.date).getFullYear() === y);
  return { income: iv.reduce((s,i) => s + toBase(i.total, i), 0), expense: ex.reduce((s,e) => s + toBase(e.amount, e), 0), taxOut: iv.reduce((s,i) => s + toBase(i.taxAmount||0, i), 0), taxIn: ex.reduce((s,e) => s + toBase(e.taxAmount||0, e), 0) };
}

function recurDue() { const soon = addDays(today(), 7); return D.invoices.filter(i => i.isRecurring && i.recurringNextDate && i.recurringNextDate <= soon); }
function advRec(d, f) { const x = new Date(d); if (f === 'weekly') x.setDate(x.getDate()+7); else if (f === 'monthly') x.setMonth(x.getMonth()+1); else if (f === 'quarterly') x.setMonth(x.getMonth()+3); else if (f === 'yearly') x.setFullYear(x.getFullYear()+1); return x.toISOString().slice(0,10); }

async function processImg(file, max) {
  max = max || 1000;
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => { const img = new Image(); img.onload = () => { let w = img.width, h = img.height; if (w > h && w > max) { h = h * (max/w); w = max; } else if (h > max) { w = w * (max/h); h = max; } const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); res(c.toDataURL('image/jpeg', 0.8)); }; img.onerror = rej; img.src = e.target.result; };
    r.onerror = rej; r.readAsDataURL(file);
  });
}
async function fileToDataURL(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsDataURL(f); }); }

function parseEmail(text) {
  const r = {};
  // Amount patterns: try "Total/Amount/Paid: $X.XX" first (more reliable on receipts)
  const ap = [
    /(?:total|grand\s*total|amount(?:\s+due)?|amount\s+paid|paid|charged|balance)[:\s]+(?:[A-Z]{3}\s*)?[$€£¥₹₦R]?\s*([\d,]+\.\d{2})/i,
    /[$€£¥₹₦]\s*([\d,]+\.\d{2})\b/,
    /\b([\d,]+\.\d{2})\s*(?:USD|EUR|GBP|ZAR|JPY|INR|CAD|AUD|NZD)\b/i,
    // Fallback: largest currency-style number in the text (often the total on receipts)
    /\b(\d{1,5}\.\d{2})\b/g
  ];
  for (let i = 0; i < ap.length; i++) {
    const p = ap[i];
    if (p.flags && p.flags.includes('g')) {
      // For the fallback pattern, pick the biggest matched amount
      const matches = [...text.matchAll(p)].map(m => parseFloat(m[1].replace(/,/g, ''))).filter(n => n > 0 && n < 1000000);
      if (matches.length) { r.amount = Math.max(...matches); break; }
    } else {
      const m = text.match(p);
      if (m) { r.amount = parseFloat(m[1].replace(/,/g, '')); break; }
    }
  }
  // Date patterns
  const dp = [/(\d{4}-\d{2}-\d{2})/, /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i, /(\d{1,2}\/\d{1,2}\/\d{2,4})/];
  for (const p of dp) { const m = text.match(p); if (m) { const d = new Date(m[1]); if (!isNaN(d.getTime())) { r.date = d.toISOString().slice(0,10); break; } } }
  // Vendor: try "From:" header first (emails), then first non-empty line (receipts)
  const fm = text.match(/from[:\s]+([^\n<\r]+?)(?:<|\n|\r|$)/i);
  if (fm) {
    r.vendor = fm[1].trim().replace(/["'<>]/g, '').slice(0, 60);
  } else {
    // For OCR receipts: first meaningful line is usually the merchant name
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2 && l.length < 60 && /[a-zA-Z]/.test(l));
    if (lines.length) r.vendor = lines[0].replace(/["'<>*#]/g, '').slice(0, 60);
  }
  return r;
}

// On-device OCR using Tesseract.js. Returns extracted text or null on failure.
// Tesseract auto-loads its engine + language data on first call (~3MB cached after).
async function runOcr(dataUrl, onProgress) {
  if (!window.Tesseract) {
    console.warn('Tesseract.js not loaded');
    return null;
  }
  try {
    const result = await window.Tesseract.recognize(dataUrl, 'eng', {
      logger: onProgress ? m => { if (m.status === 'recognizing text') onProgress(Math.round((m.progress || 0) * 100)); } : null
    });
    return result?.data?.text || null;
  } catch (err) {
    console.error('OCR failed:', err);
    return null;
  }
}

function statusPill(s) { return {paid:'p-s',partial:'p-w',unpaid:'p-g',overdue:'p-d',draft:'p-g',sent:'p-i',accepted:'p-s',rejected:'p-d',converted:'p-i'}[s] || 'p-g'; }

// ===== VIEWS =====

function vDash() {
  const recv = recvThisMonth(), exp = expThisMonth(), ar = totalAR();
  const rec = recurDue();
  const setup = !D.settings.businessName;
  const bs = D.settings.currencySymbol;
  const ri = [...D.invoices].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 3);
  const re = [...D.expenses].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 3);
  const mix = [...ri.map(i => ({...i, kind:'inv'})), ...re.map(e => ({...e, kind:'exp'}))].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 4);

  // Daily chart for the last 30 days
  const days = dailySeries(30);
  const max = Math.max(1, ...days.flatMap(d => [d.in, d.ex]));
  const totalIn = days.reduce((s, d) => s + d.in, 0);
  const totalEx = days.reduce((s, d) => s + d.ex, 0);
  const hasAnyActivity = totalIn > 0 || totalEx > 0;

  return `<h2 class="vt">Dashboard</h2>
    ${setup ? `<div class="card" style="background:var(--warn-bg);border-color:var(--warn-bd);" data-go="set"><div class="r1"><div><div style="font-weight:500;font-size:13px;color:var(--warn-tx);">Welcome to GBM</div><div style="font-size:12px;color:var(--warn-tx);margin-top:2px;">Tap to set up your business, country, and tax info</div></div><i class="ti ti-chevron-right" style="color:var(--warn-tx);"></i></div></div>` : ''}
    <div class="mgrid">
      <div class="m"><div class="l">Received this month</div><div class="v pos">${fmt(recv, bs)}</div></div>
      <div class="m"><div class="l">Expenses this month</div><div class="v neg">${fmt(exp, bs)}</div></div>
      <div class="m"><div class="l">Net cashflow</div><div class="v ${recv - exp >= 0 ? 'pos' : 'neg'}">${fmt(recv - exp, bs)}</div></div>
      <div class="m" style="cursor:pointer;" data-go="inv"><div class="l">Outstanding receivables</div><div class="v ${ar > 0 ? 'warn' : ''}">${fmt(ar, bs)}</div></div>
    </div>
    ${rec.length ? `<div class="secH"><h3>Recurring invoices due</h3></div>${rec.map(r => `<div class="card" style="border-color:var(--info-bd);"><div class="r1"><div><div class="ttl"><i class="ti ti-repeat" style="font-size:14px;color:var(--info-tx);"></i> ${esc(r.customer)}</div><div style="font-size:11px;color:var(--text-sec);">${esc(r.recurringFreq)} · next: ${fmtDate(r.recurringNextDate)}</div></div><button class="bp" data-gen="${r.id}" style="padding:6px 10px;font-size:12px;"><i class="ti ti-plus"></i> Generate</button></div></div>`).join('')}` : ''}

    <div class="secH"><h3>Sales vs expenses · last 30 days</h3></div>
    <div class="card" style="cursor:default;padding:14px 12px 10px;">
      ${hasAnyActivity ? `
        <div class="daily-chart">
          ${days.map(d => `
            <div class="dcol" title="${d.date} — In ${fmt(d.in, bs)} · Out ${fmt(d.ex, bs)}">
              <div class="dgrp">
                ${d.in > 0 ? `<div class="dbar b-in" style="height:${(d.in/max)*100}%;"></div>` : '<div class="dbar empty"></div>'}
                ${d.ex > 0 ? `<div class="dbar b-ex" style="height:${(d.ex/max)*100}%;"></div>` : '<div class="dbar empty"></div>'}
              </div>
              <div class="dlab">${d.day}</div>
            </div>
          `).join('')}
        </div>
        <div class="lgnd" style="margin:8px 0 0;justify-content:space-between;">
          <span><i class="b-in"></i> Sales ${fmt(totalIn, bs)}</span>
          <span><i class="b-ex"></i> Expenses ${fmt(totalEx, bs)}</span>
        </div>
      ` : `<div class="gh" style="text-align:center;padding:20px 0;margin:0;">No activity in the last 30 days yet.</div>`}
    </div>

    <div class="secH"><h3>Recent activity</h3></div>
    ${mix.length ? mix.map(x => x.kind === 'inv' ? `<div class="card" data-go-inv="${x.id}"><div class="r1"><div><div class="ttl"><i class="ti ti-file-invoice" style="font-size:14px;color:var(--pos);"></i> ${esc(x.customer||'Customer')}</div><div style="font-size:11px;color:var(--text-sec);">${esc(x.number)} · ${fmtDate(x.date)} · <span class="pill ${statusPill(invStatus(x))}">${invStatus(x)}</span></div></div><div class="amt" style="color:var(--pos);">+${fmt(x.total, sym(x.currency))}</div></div></div>` : `<div class="card" data-go-exp="${x.id}"><div class="r1"><div><div class="ttl"><i class="ti ti-receipt" style="font-size:14px;color:var(--neg);"></i> ${esc(x.vendor||'Expense')}</div><div style="font-size:11px;color:var(--text-sec);">${esc(x.category||'')} · ${fmtDate(x.date)}</div></div><div class="amt" style="color:var(--neg);">-${fmt(x.amount, sym(x.currency))}</div></div></div>`).join('') : `<div class="empty"><i class="ti ti-inbox"></i>No activity yet. Create an invoice or capture an expense to begin.</div>`}`;
}

function vSales() {
  const isInv = salesTab === 'inv';
  const list = isInv ? [...D.invoices].sort((a,b) => b.date.localeCompare(a.date)) : [...D.quotes].sort((a,b) => b.date.localeCompare(a.date));
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h2 class="vt" style="margin:0;">Sales</h2>
      <button class="bp" data-new="${isInv ? 'inv' : 'quo'}"><i class="ti ti-plus"></i> New ${isInv ? 'invoice' : 'quote'}</button>
    </div>
    <div class="subnav"><button class="${isInv ? 'on' : ''}" data-sales="inv">Invoices (${D.invoices.length})</button><button class="${!isInv ? 'on' : ''}" data-sales="quo">Quotes (${D.quotes.length})</button></div>
    ${list.length ? list.map(i => { const st = isInv ? invStatus(i) : (i.status||'draft'); const bal = isInv ? invBal(i) : 0; return `<div class="card" data-go-${isInv ? 'inv' : 'quo'}="${i.id}"><div class="r1"><div class="ttl">${esc(i.customer||'Customer')}</div><div class="amt">${fmt(i.total, sym(i.currency))}</div></div><div class="r2"><span>${esc(i.number)} · ${fmtDate(i.date)}</span><span>${isInv && i.isRecurring ? '<span class="pill p-i"><i class="ti ti-repeat" style="font-size:11px;"></i></span> ' : ''}${isInv && bal > 0 ? `<span style="font-size:11px;color:var(--text-sec);">Bal: ${fmt(bal, sym(i.currency))}</span> ` : ''}<span class="pill ${statusPill(st)}">${st}</span></span></div></div>`; }).join('') : `<div class="empty"><i class="ti ti-${isInv ? 'file-invoice' : 'file-text'}"></i>No ${isInv ? 'invoices' : 'quotes'} yet.</div>`}`;
}

function vDocForm(editId, isQuote) {
  const arr = isQuote ? D.quotes : D.invoices;
  const doc = editId ? arr.find(x => x.id === editId) : null;
  const num = doc ? doc.number : ((isQuote ? D.settings.quotePrefix : D.settings.invoicePrefix) + String(isQuote ? D.settings.nextQuoteNumber : D.settings.nextInvoiceNumber).padStart(4, '0'));
  const items = doc ? doc.items : [{desc:'',qty:1,price:0}];
  const cur = doc?.currency || D.settings.currency;
  const isBase = cur === D.settings.currency;
  const label = isQuote ? 'quote' : 'invoice';
  return `<button class="bbk" data-back><i class="ti ti-arrow-left"></i> Back</button>
    <h2 class="vt">${doc ? 'Edit' : 'New'} ${label} <span style="font-size:13px;color:var(--text-sec);font-weight:400;">${esc(num)}</span></h2>
    <form id="docForm" data-quote="${isQuote ? '1' : '0'}">
      ${D.customers.length ? `<div class="fg"><label>Pick from clients (optional)</label><select id="custPick"><option value="">— Choose a client —</option>${D.customers.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>` : ''}
      <div class="fg"><label>Client name</label><input name="customer" value="${esc(doc?.customer||'')}" required></div>
      <div class="frow"><div class="fg"><label>Email</label><input name="email" type="email" value="${esc(doc?.email||'')}"></div><div class="fg"><label>Phone</label><input name="phone" value="${esc(doc?.phone||'')}"></div></div>
      <div class="fg"><label>Client address</label><textarea name="address" rows="2">${esc(doc?.address||'')}</textarea></div>
      <div class="fg"><label>Client ${esc(D.settings.taxLabel)} number</label><input name="custTax" value="${esc(doc?.custTax||'')}"></div>
      <label class="chk"><input type="checkbox" name="saveClient" ${doc?.customerId ? 'checked' : ''}> Save / update in client database</label>
      <div class="frow"><div class="fg"><label>${isQuote ? 'Quote' : 'Invoice'} date</label><input name="date" type="date" value="${doc?.date||today()}"></div><div class="fg"><label>${isQuote ? 'Valid until' : 'Due date'}</label><input name="due" type="date" value="${doc?.due||addDays(today(), isQuote ? D.settings.quoteValidDays : 30)}"></div></div>
      <div class="frow"><div class="fg"><label>Currency</label><select name="currency" id="curSel">${CURRENCIES.map(c => `<option value="${c.c}" ${cur === c.c ? 'selected' : ''}>${c.c} (${c.s})</option>`).join('')}</select></div><div class="fg" id="rateWrap" style="${isBase ? 'display:none;' : ''}"><label>Rate to ${esc(D.settings.currency)}</label><input name="exchangeRate" id="rateIn" type="number" step="0.0001" value="${doc?.exchangeRate||D.settings.exchangeRates?.[cur]||1}"></div></div>
      <div class="secH"><h3>Line items</h3><button type="button" class="bl" id="addLine"><i class="ti ti-plus"></i> Add</button></div>
      <div class="li" style="font-size:11px;color:var(--text-sec);"><div>Description</div><div>Qty</div><div>Unit</div><div>Unit price</div><div></div></div>
      <datalist id="uomList">${UOM_OPTIONS.map(u => `<option value="${u}">`).join('')}</datalist>
      <div id="lines">${items.map((it, i) => liRow(it, i)).join('')}</div>
      <div id="totals" style="background:var(--bg-sec);padding:10px;border-radius:8px;margin-top:10px;font-size:13px;"></div>
      ${!isQuote ? `<div class="secH"><h3>Recurring</h3></div><label class="chk"><input type="checkbox" name="isRecurring" id="recChk" ${doc?.isRecurring ? 'checked' : ''}> Mark as recurring invoice</label><div id="recWrap" style="${doc?.isRecurring ? '' : 'display:none;'}"><div class="frow"><div class="fg"><label>Frequency</label><select name="recurringFreq"><option value="weekly" ${doc?.recurringFreq === 'weekly' ? 'selected' : ''}>Weekly</option><option value="monthly" ${(!doc || doc?.recurringFreq === 'monthly') ? 'selected' : ''}>Monthly</option><option value="quarterly" ${doc?.recurringFreq === 'quarterly' ? 'selected' : ''}>Quarterly</option><option value="yearly" ${doc?.recurringFreq === 'yearly' ? 'selected' : ''}>Yearly</option></select></div><div class="fg"><label>Next due</label><input name="recurringNextDate" type="date" value="${doc?.recurringNextDate||addDays(today(), 30)}"></div></div></div>` : ''}
      <div class="act"><button class="bp" type="submit"><i class="ti ti-check"></i> Save ${label}</button></div>
    </form>`;
}

const UOM_OPTIONS = ['units', 'pcs', 'kg', 'ton', 'g', 'lb', 'm', 'l', 'box', 'pack', 'set', 'pallet', 'hr', 'day', 'service'];

function liRow(it, i) { return `<div class="li" data-row="${i}"><input data-f="desc" placeholder="Item description" value="${esc(it.desc)}"><input data-f="qty" type="number" step="0.01" value="${it.qty}"><input data-f="unit" list="uomList" placeholder="unit" value="${esc(it.unit||'')}" autocomplete="off"><input data-f="price" type="number" step="0.01" value="${it.price}"><button type="button" data-rm="${i}"><i class="ti ti-x"></i></button></div>`; }
function compTot(items) { const sub = items.reduce((s,i) => s + (Number(i.qty)||0) * (Number(i.price)||0), 0); const tax = D.settings.isTaxRegistered ? sub * (D.settings.taxRate/100) : 0; return {sub: round2(sub), tax: round2(tax), total: round2(sub+tax)}; }
function rendTot() { const lines = document.querySelectorAll('#lines .li'); const items = [...lines].map(l => ({desc: l.querySelector('[data-f=desc]').value, qty: l.querySelector('[data-f=qty]').value, unit: l.querySelector('[data-f=unit]')?.value || '', price: l.querySelector('[data-f=price]').value})); const t = compTot(items); const reg = D.settings.isTaxRegistered; const cs = sym(document.getElementById('curSel')?.value || D.settings.currency); document.getElementById('totals').innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="color:var(--text-sec);">Subtotal</span><span>${fmt(t.sub, cs)}</span></div>${reg ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="color:var(--text-sec);">${esc(D.settings.taxLabel)} @ ${D.settings.taxRate}%</span><span>${fmt(t.tax, cs)}</span></div>` : ''}<div style="display:flex;justify-content:space-between;font-weight:500;border-top:0.5px solid var(--bd-sec);padding-top:6px;margin-top:6px;"><span>Total</span><span>${fmt(t.total, cs)}</span></div>`; }

function gdiFooter() { return `<div class="gdi-footer"><img src="${GDI_GLOBE}" alt="Global Deal Inc"><div class="pby">Created with<br><b>Global Business Manager</b><br>powered by <b>GLOBAL</b><span>DEAL</span> <b>INC.</b></div></div>`; }

function partiesHTML(doc) { const s = D.settings; return `<div style="display:flex;justify-content:space-between;gap:16px;margin-bottom:12px;font-size:10px;line-height:1.45;"><div style="flex:1;"><div style="font-weight:700;margin-bottom:5px;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:#777;">From</div><div style="font-weight:700;font-size:11px;margin-bottom:2px;">${esc(s.businessName||'Your business')}</div><div style="white-space:pre-line;color:#444;">${esc(s.address)}</div>${s.phone ? `<div style="color:#444;">${esc(s.phone)}</div>` : ''}${s.email ? `<div style="color:#444;">${esc(s.email)}</div>` : ''}${s.website ? `<div style="color:#444;">${esc(s.website)}</div>` : ''}${s.taxNumber ? `<div style="color:#444;">${esc(s.taxLabel)} #: ${esc(s.taxNumber)}</div>` : ''}${s.regNumber ? `<div style="color:#444;">Reg #: ${esc(s.regNumber)}</div>` : ''}</div><div style="flex:1;"><div style="font-weight:700;margin-bottom:5px;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:#777;">${doc.status && !doc.payments ? 'Quote for' : 'Bill to'}</div><div style="font-weight:700;font-size:11px;margin-bottom:2px;">${esc(doc.customer)}</div><div style="white-space:pre-line;color:#444;">${esc(doc.address)}</div>${doc.email ? `<div style="color:#444;">${esc(doc.email)}</div>` : ''}${doc.phone ? `<div style="color:#444;">${esc(doc.phone)}</div>` : ''}${doc.custTax ? `<div style="color:#444;">${esc(s.taxLabel)} #: ${esc(doc.custTax)}</div>` : ''}</div></div>`; }
function itemsHTML(doc, cs) { return `<table style="font-size:10px;"><thead><tr><th style="font-size:9px;letter-spacing:0.6px;">Description</th><th style="text-align:right;width:50px;font-size:9px;letter-spacing:0.6px;">Qty</th><th style="text-align:center;width:60px;font-size:9px;letter-spacing:0.6px;">Unit</th><th style="text-align:right;width:90px;font-size:9px;letter-spacing:0.6px;">Unit price</th><th style="text-align:right;width:100px;font-size:9px;letter-spacing:0.6px;">Amount</th></tr></thead><tbody>${doc.items.map(it => `<tr class="li-row"><td style="padding:8px 4px;">${esc(it.desc)}</td><td style="text-align:right;padding:8px 4px;">${it.qty}</td><td style="text-align:center;padding:8px 4px;color:#555;">${esc(it.unit||'')}</td><td style="text-align:right;padding:8px 4px;">${fmt(it.price, cs)}</td><td style="text-align:right;padding:8px 4px;">${fmt(it.qty*it.price, cs)}</td></tr>`).join('')}</tbody></table><table class="tot" style="font-size:10px;"><tr><td class="lab" style="color:#444;">Subtotal</td><td class="val">${fmt(doc.subtotal, cs)}</td></tr>${doc.taxAmount > 0 ? `<tr><td class="lab" style="color:#444;">${esc(D.settings.taxLabel)} @ ${doc.taxRate||D.settings.taxRate}%</td><td class="val">${fmt(doc.taxAmount, cs)}</td></tr>` : ''}<tr><td class="lab">Total ${doc.payments ? 'due' : ''}</td><td class="val">${fmt(doc.total, cs)}</td></tr></table>`; }

function vInvDetail(id) {
  const inv = D.invoices.find(i => i.id === id); if (!inv) return `<div class="empty">Invoice not found</div>`;
  const s = D.settings, cs = sym(inv.currency), st = invStatus(inv), bal = invBal(inv), paid = invPaid(inv);
  return `<button class="bbk" data-back><i class="ti ti-arrow-left"></i> Back</button>
    <div style="display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap;align-items:center;">
      <span class="pill ${statusPill(st)}" style="font-size:11px;padding:3px 9px;">${st}</span>
      ${bal > 0 ? `<span style="font-size:12px;color:var(--text-sec);">Balance: ${fmt(bal, cs)}</span>` : ''}
      <div style="margin-left:auto;display:flex;gap:2px;flex-wrap:wrap;">
        ${bal > 0 ? `<button class="bl" data-pay-inv="${inv.id}"><i class="ti ti-cash"></i> Pay</button>` : ''}
        <button class="bl" data-edit-inv="${inv.id}"><i class="ti ti-edit"></i></button>
        <button class="bl" data-pdf-inv="${inv.id}"><i class="ti ti-download"></i></button>
        ${inv.isRecurring ? `<button class="bl" data-gen="${inv.id}"><i class="ti ti-repeat"></i></button>` : ''}
        <button class="bl" data-del-inv="${inv.id}" style="color:var(--neg);"><i class="ti ti-trash"></i></button>
      </div>
    </div>
    <div class="inv" id="invPrintable">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;">
        <div style="flex:1;">${s.hasLogo && logoDataUrl ? `<img class="inv-logo" src="${logoDataUrl}" alt="Logo" style="margin-bottom:8px;">` : ''}<h2>TAX INVOICE</h2><div style="font-size:11px;color:#666;margin-top:2px;">${esc(inv.number)}</div></div>
        <div style="text-align:right;font-size:11px;"><div><span style="color:#666;">Date:</span> ${fmtDate(inv.date)}</div><div><span style="color:#666;">Due:</span> ${fmtDate(inv.due)}</div>${inv.currency !== s.currency ? `<div style="margin-top:4px;"><span style="color:#666;">Currency:</span> ${esc(inv.currency)}</div>` : ''}</div>
      </div>
      ${partiesHTML(inv)}
      ${itemsHTML(inv, cs)}
      ${s.bankDetails ? `<div style="margin-top:18px;padding-top:12px;border-top:0.5px solid #ddd;"><div style="font-weight:700;margin-bottom:5px;text-transform:uppercase;font-size:9px;letter-spacing:1px;color:#777;">Banking details</div><div style="white-space:pre-line;font-size:10px;line-height:1.55;">${esc(s.bankDetails)}</div></div>` : ''}
      ${gdiFooter()}
    </div>
    <div class="secH"><h3>Payments (${(inv.payments||[]).length})</h3>${bal > 0 ? `<button class="bl" data-pay-inv="${inv.id}"><i class="ti ti-plus"></i> Record payment</button>` : ''}</div>
    <div class="card" style="cursor:default;">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;"><span style="color:var(--text-sec);">Invoice total</span><span>${fmt(inv.total, cs)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;"><span style="color:var(--text-sec);">Paid to date</span><span style="color:var(--pos);">${fmt(paid, cs)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:500;border-top:0.5px solid var(--bd-sec);padding-top:8px;"><span>Balance due</span><span style="color:${bal > 0 ? 'var(--warn-tx)' : 'var(--pos)'};">${fmt(bal, cs)}</span></div>
      <div style="margin-top:8px;">${(inv.payments||[]).length ? inv.payments.map(p => `<div class="pmt-row"><div><div>${fmtDate(p.date)} · ${esc(p.method||'')}</div>${p.notes ? `<div style="color:var(--text-ter);font-size:11px;">${esc(p.notes)}</div>` : ''}</div><div style="display:flex;gap:8px;align-items:center;"><span style="font-weight:500;">${fmt(p.amount, cs)}</span><button class="x" data-del-pay="${inv.id}|${p.id}"><i class="ti ti-x"></i></button></div></div>`).join('') : '<div class="gh" style="margin:8px 0 0;">No payments recorded yet.</div>'}</div>
    </div>`;
}

function vQuoDetail(id) {
  const q = D.quotes.find(x => x.id === id); if (!q) return `<div class="empty">Quote not found</div>`;
  const s = D.settings, cs = sym(q.currency), conv = q.status === 'converted';
  return `<button class="bbk" data-back><i class="ti ti-arrow-left"></i> Back</button>
    <div style="display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap;align-items:center;">
      <span class="pill ${statusPill(q.status||'draft')}" style="font-size:11px;padding:3px 9px;">${q.status||'draft'}</span>
      <div style="margin-left:auto;display:flex;gap:2px;flex-wrap:wrap;">
        ${!conv ? `<button class="bl" data-convert="${q.id}" style="color:var(--pos);"><i class="ti ti-arrow-right"></i> To invoice</button>` : ''}
        ${!conv ? `<button class="bl" data-qstat="${q.id}|sent">Sent</button><button class="bl" data-qstat="${q.id}|accepted">Accept</button><button class="bl" data-qstat="${q.id}|rejected" style="color:var(--neg);">Reject</button>` : ''}
        <button class="bl" data-edit-quo="${q.id}"><i class="ti ti-edit"></i></button>
        <button class="bl" data-pdf-quo="${q.id}"><i class="ti ti-download"></i></button>
        <button class="bl" data-del-quo="${q.id}" style="color:var(--neg);"><i class="ti ti-trash"></i></button>
      </div>
    </div>
    ${conv && q.convertedInvoiceId ? `<div class="card" data-go-inv="${q.convertedInvoiceId}" style="background:var(--info-bg);border-color:var(--info-bd);"><div class="r1"><div style="font-size:12px;color:var(--info-tx);">Converted to invoice — tap to view</div><i class="ti ti-chevron-right" style="color:var(--info-tx);"></i></div></div>` : ''}
    <div class="inv" id="invPrintable">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;">
        <div style="flex:1;">${s.hasLogo && logoDataUrl ? `<img class="inv-logo" src="${logoDataUrl}" alt="Logo" style="margin-bottom:8px;">` : ''}<h2>QUOTATION</h2><div style="font-size:11px;color:#666;margin-top:2px;">${esc(q.number)}</div></div>
        <div style="text-align:right;font-size:11px;"><div><span style="color:#666;">Date:</span> ${fmtDate(q.date)}</div><div><span style="color:#666;">Valid until:</span> ${fmtDate(q.due)}</div></div>
      </div>
      ${partiesHTML(q)}
      ${itemsHTML(q, cs)}
      <div style="margin-top:18px;padding:12px 14px;background:#fff8e1;border-left:3px solid #f4a623;font-size:10px;font-style:italic;color:#5a4818;line-height:1.5;">Prices are negotiable and dependent on quantities ordered.</div>
      ${gdiFooter()}
    </div>`;
}

function vPayForm(invId) {
  const inv = D.invoices.find(i => i.id === invId); if (!inv) return `<div class="empty">Invoice not found</div>`;
  const cs = sym(inv.currency), bal = invBal(inv);
  return `<button class="bbk" data-back><i class="ti ti-arrow-left"></i> Back</button>
    <h2 class="vt">Record payment</h2>
    <div class="gh">Invoice ${esc(inv.number)} · ${esc(inv.customer)} · Balance ${fmt(bal, cs)}</div>
    <form id="payForm">
      <div class="frow"><div class="fg"><label>Payment date</label><input name="date" type="date" value="${today()}" required></div><div class="fg"><label>Amount (${esc(inv.currency)})</label><input name="amount" type="number" step="0.01" value="${bal}" required></div></div>
      <div class="fg"><label>Method</label><select name="method">${PMTS.map(m => `<option>${m}</option>`).join('')}</select></div>
      <div class="fg"><label>Reference / notes</label><textarea name="notes" rows="2"></textarea></div>
      <div class="act"><button class="bp" type="button" id="payFull" style="background:var(--bg-sec);color:var(--text);">Mark fully paid</button><button class="bp" type="submit"><i class="ti ti-check"></i> Record</button></div>
    </form>`;
}

function vCust() {
  const list = [...D.customers].sort((a,b) => a.name.localeCompare(b.name));
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;"><h2 class="vt" style="margin:0;">Clients</h2><button class="bp" data-new="cust"><i class="ti ti-plus"></i> New</button></div>
    ${list.length ? list.map(c => { const inv = D.invoices.filter(i => i.customerId === c.id); const tot = inv.reduce((s,i) => s + toBase(i.total, i), 0); const ow = inv.reduce((s,i) => s + toBase(invBal(i), i), 0); return `<div class="card" data-go-cust="${c.id}"><div class="r1"><div class="ttl">${esc(c.name)}</div><div class="amt">${fmt(tot)}</div></div><div class="r2"><span>${esc(c.email||c.phone||'No contact info')}</span><span>${inv.length} inv${ow > 0 ? ` · <span style="color:var(--warn-tx);">${fmt(ow)} owing</span>` : ''}</span></div></div>`; }).join('') : `<div class="empty"><i class="ti ti-users"></i>No clients yet.</div>`}`;
}

function vCustForm(editId) {
  const c = editId ? D.customers.find(x => x.id === editId) : null;
  return `<button class="bbk" data-back><i class="ti ti-arrow-left"></i> Back</button>
    <h2 class="vt">${c ? 'Edit' : 'New'} client</h2>
    <form id="custForm">
      <div class="fg"><label>Name / company</label><input name="name" value="${esc(c?.name||'')}" required></div>
      <div class="frow"><div class="fg"><label>Email</label><input name="email" type="email" value="${esc(c?.email||'')}"></div><div class="fg"><label>Phone</label><input name="phone" value="${esc(c?.phone||'')}"></div></div>
      <div class="fg"><label>Address</label><textarea name="address" rows="3">${esc(c?.address||'')}</textarea></div>
      <div class="fg"><label>${esc(D.settings.taxLabel)} / tax number</label><input name="taxNumber" value="${esc(c?.taxNumber||'')}"></div>
      <div class="fg"><label>Notes</label><textarea name="notes" rows="2">${esc(c?.notes||'')}</textarea></div>
      <div class="act"><button class="bp" type="submit"><i class="ti ti-check"></i> Save</button>${c ? `<button class="bp" type="button" data-del-cust="${c.id}" style="background:var(--neg);"><i class="ti ti-trash"></i> Delete</button>` : ''}</div>
    </form>`;
}

function vExp() {
  const list = [...D.expenses].sort((a,b) => b.date.localeCompare(a.date));
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><h2 class="vt" style="margin:0;">Expenses</h2><button class="bp" data-new="exp"><i class="ti ti-plus"></i> New</button></div>
    <div class="gh">Snap, upload from email/PDF, or enter manually.</div>
    ${list.length ? list.map(e => `<div class="card" data-go-exp="${e.id}"><div class="r1"><div class="ttl">${esc(e.vendor||'Expense')}</div><div class="amt" style="color:var(--neg);">${fmt(e.amount, sym(e.currency))}</div></div><div class="r2"><span><span class="pill p-g">${esc(e.category||'Other')}</span> ${fmtDate(e.date)}</span>${e.hasReceipt ? `<span class="pill p-i"><i class="ti ti-paperclip" style="font-size:11px;"></i> ${e.receiptType === 'pdf' ? 'PDF' : 'Receipt'}</span>` : '<span class="pill p-g">Manual</span>'}</div></div>`).join('') : `<div class="empty"><i class="ti ti-receipt"></i>No expenses yet.</div>`}`;
}

function vExpForm(editId) {
  const ex = editId ? D.expenses.find(e => e.id === editId) : null;
  const cur = ex?.currency || D.settings.currency;
  const isBase = cur === D.settings.currency;
  return `<button class="bbk" data-back><i class="ti ti-arrow-left"></i> Back</button>
    <h2 class="vt">${ex ? 'Edit' : 'New'} expense</h2>
    <div id="rcptArea">${rcptHTML(ex)}</div>
    ${!ex ? `<details class="email-paste"><summary><i class="ti ti-mail"></i> Paste from email receipt</summary><div style="padding-top:8px;"><textarea id="emailPaste" placeholder="Paste email or receipt text here…"></textarea><button type="button" class="bp" id="extractBtn" style="margin-top:6px;padding:6px 10px;font-size:12px;"><i class="ti ti-wand"></i> Extract</button></div></details>` : ''}
    <form id="expForm">
      <div class="frow"><div class="fg"><label>Date</label><input name="date" type="date" value="${ex?.date||today()}" required></div><div class="fg"><label>Amount (incl. tax)</label><input name="amount" type="number" step="0.01" value="${ex?.amount||''}" required></div></div>
      <div class="fg"><label>Vendor / supplier</label><input name="vendor" value="${esc(ex?.vendor||'')}" required></div>
      <div class="frow"><div class="fg"><label>Category</label><select name="category">${CATS.map(c => `<option ${(ex?.category||'Other') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div><div class="fg"><label>Currency</label><select name="currency" id="expCurSel">${CURRENCIES.map(c => `<option value="${c.c}" ${cur === c.c ? 'selected' : ''}>${c.c}</option>`).join('')}</select></div></div>
      <div class="fg" id="expRateWrap" style="${isBase ? 'display:none;' : ''}"><label>Rate to ${esc(D.settings.currency)}</label><input name="exchangeRate" type="number" step="0.0001" value="${ex?.exchangeRate||1}"></div>
      ${D.settings.isTaxRegistered ? `<label class="chk"><input type="checkbox" name="claimsTax" ${(!ex || ex?.claimsTax) ? 'checked' : ''}> Claim ${esc(D.settings.taxLabel)} input</label>` : ''}
      <div class="fg"><label>Notes</label><textarea name="notes" rows="2">${esc(ex?.notes||'')}</textarea></div>
      <div class="act"><button class="bp" type="submit"><i class="ti ti-check"></i> Save expense</button></div>
    </form>`;
}

function rcptHTML(ex) {
  if (tmpReceipt || ex?.hasReceipt) {
    const isPdf = tmpRType === 'pdf' || ex?.receiptType === 'pdf';
    return `${isPdf ? `<div class="rcpt-pdf" id="rcptImg"><i class="ti ti-file-type-pdf"></i><div><div style="font-weight:500;">PDF receipt attached</div></div></div>` : `<img class="rcpt" id="rcptImg" alt="Receipt">`}<div style="display:flex;gap:6px;margin-bottom:10px;"><label class="bl" style="cursor:pointer;"><i class="ti ti-refresh"></i> Replace<input type="file" accept="image/*,.pdf,application/pdf" id="rcptInput" style="display:none;"></label><button type="button" class="bl" id="rcptRemove" style="color:var(--neg);"><i class="ti ti-x"></i> Remove</button></div>`;
  }
  return `<div class="upload-opts"><label class="cam"><i class="ti ti-camera"></i><span>Snap with camera</span><input type="file" accept="image/*" capture="environment" id="rcptInputCam"></label><label class="cam"><i class="ti ti-upload"></i><span>Upload image or PDF</span><input type="file" accept="image/*,.pdf,application/pdf" id="rcptInput"></label></div>`;
}

function vExpDetail(id) {
  const ex = D.expenses.find(e => e.id === id); if (!ex) return `<div class="empty">Expense not found</div>`;
  return `<button class="bbk" data-back><i class="ti ti-arrow-left"></i> Back</button>
    <div style="display:flex;gap:6px;margin-bottom:12px;"><button class="bl" data-edit-exp="${ex.id}"><i class="ti ti-edit"></i> Edit</button><button class="bl" data-del-exp="${ex.id}" style="color:var(--neg);margin-left:auto;"><i class="ti ti-trash"></i> Delete</button></div>
    ${ex.hasReceipt ? (ex.receiptType === 'pdf' ? `<div class="rcpt-pdf" id="rcptView" style="cursor:pointer;"><i class="ti ti-file-type-pdf"></i><div><div style="font-weight:500;">PDF receipt</div><div style="font-size:11px;color:var(--text-sec);">Tap to open</div></div></div>` : `<img class="rcpt" id="rcptView" alt="Receipt">`) : ''}
    <div class="card" style="cursor:default;">
      <div style="font-size:17px;font-weight:500;margin-bottom:4px;">${esc(ex.vendor)}</div>
      <div style="font-size:22px;color:var(--neg);font-weight:500;margin-bottom:10px;">${fmt(ex.amount, sym(ex.currency))}</div>
      <div class="tx-row"><span class="lbl">Date</span><span class="dt">${fmtDate(ex.date)}</span></div>
      <div class="tx-row"><span class="lbl">Category</span><span class="dt">${esc(ex.category)}</span></div>
      ${ex.currency && ex.currency !== D.settings.currency ? `<div class="tx-row"><span class="lbl">Currency</span><span class="dt">${esc(ex.currency)} @ ${ex.exchangeRate||1}</span></div>` : ''}
      ${ex.taxAmount > 0 ? `<div class="tx-row"><span class="lbl">${esc(D.settings.taxLabel)} input</span><span class="dt">${fmt(ex.taxAmount, sym(ex.currency))}</span></div>` : ''}
      ${ex.notes ? `<div class="tx-row" style="flex-direction:column;align-items:flex-start;gap:4px;"><span class="lbl">Notes</span><span class="dt">${esc(ex.notes)}</span></div>` : ''}
    </div>`;
}

function vRep() { return `<h2 class="vt">Reports · ${new Date().getFullYear()}</h2><div class="subnav"><button class="${reportTab === 'sum' ? 'on' : ''}" data-rep="sum">Summary</button><button class="${reportTab === 'is' ? 'on' : ''}" data-rep="is">Income</button><button class="${reportTab === 'cf' ? 'on' : ''}" data-rep="cf">Cash flow</button><button class="${reportTab === 'tax' ? 'on' : ''}" data-rep="tax">Tax</button></div>${reportTab === 'sum' ? repSum() : reportTab === 'is' ? repIS() : reportTab === 'cf' ? repCF() : repTax()}`; }

function cashSeries(n) { const now = new Date(), s = []; for (let i = n-1; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth()-i, 1); const y = d.getFullYear(), m = d.getMonth(); let inc = 0; D.invoices.forEach(iv => (iv.payments||[]).forEach(p => { const dd = new Date(p.date); if (dd.getFullYear() === y && dd.getMonth() === m) inc += toBase(p.amount, iv); })); const ex = D.expenses.filter(x => { const dd = new Date(x.date); return dd.getFullYear() === y && dd.getMonth() === m; }).reduce((s,x) => s + toBase(x.amount, x), 0); s.push({label: d.toLocaleDateString('en', {month:'short'}) + (n > 6 ? ' ' + String(d.getFullYear()).slice(2) : ''), in: inc, ex}); } return s; }

// Daily series for the last N days. Each bucket is one day.
// `inc` is invoice TOTAL on that day (sales), not payments — gives an "activity today" view.
function dailySeries(days) {
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today0); d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const inv = D.invoices.filter(x => x.date === iso);
    const exp = D.expenses.filter(x => x.date === iso);
    const inc = inv.reduce((s, x) => s + toBase(x.total, x), 0);
    const ex = exp.reduce((s, x) => s + toBase(x.amount, x), 0);
    out.push({ date: iso, day: d.getDate(), dow: d.toLocaleDateString('en', { weekday: 'short' }).charAt(0), in: inc, ex });
  }
  return out;
}

function repSum() { const t = ytd(), months = cashSeries(6), max = Math.max(1, ...months.flatMap(m => [m.in, m.ex])), bs = D.settings.currencySymbol, recv = totalAR(); return `<div class="mgrid"><div class="m"><div class="l">YTD billed</div><div class="v pos">${fmt(t.income, bs)}</div></div><div class="m"><div class="l">YTD expenses</div><div class="v neg">${fmt(t.expense, bs)}</div></div><div class="m"><div class="l">Outstanding</div><div class="v ${recv > 0 ? 'warn' : ''}">${fmt(recv, bs)}</div></div><div class="m"><div class="l">Activity</div><div class="v">${D.invoices.length}inv·${D.quotes.length}qt</div></div></div><div class="secH"><h3>Cash flow · last 6 months</h3></div><div class="bars">${months.map(m => `<div class="bcol"><div class="bgrp"><div class="bar b-in" style="height:${Math.max(1, (m.in/max)*100)}%;"></div><div class="bar b-ex" style="height:${Math.max(1, (m.ex/max)*100)}%;"></div></div><div class="blab">${m.label}</div></div>`).join('')}</div><div class="lgnd"><span><i class="b-in"></i> Received</span><span><i class="b-ex"></i> Expenses</span></div>`; }

function repIS() { const y = new Date().getFullYear(), inv = D.invoices.filter(i => new Date(i.date).getFullYear() === y), exp = D.expenses.filter(e => new Date(e.date).getFullYear() === y); const gross = inv.reduce((s,i) => s + toBase(i.total, i), 0), taxOut = inv.reduce((s,i) => s + toBase(i.taxAmount||0, i), 0), netRev = gross - taxOut; const byCat = {}; exp.forEach(e => { const c = e.category||'Other'; byCat[c] = (byCat[c]||0) + toBase(e.amount, e) - toBase(e.taxAmount||0, e); }); const totExp = Object.values(byCat).reduce((s,v) => s+v, 0), profit = netRev - totExp, bs = D.settings.currencySymbol, reg = D.settings.isTaxRegistered; return `<div class="card" style="cursor:default;"><div style="font-weight:500;margin-bottom:8px;">Income statement (YTD, accrual)</div><div class="is-row h">Revenue</div><div class="is-row"><span>Gross sales</span><span>${fmt(gross, bs)}</span></div>${reg ? `<div class="is-row sub"><span>Less: ${esc(D.settings.taxLabel)} collected</span><span>(${fmt(taxOut, bs).replace(bs+' ', '')})</span></div>` : ''}<div class="is-row" style="font-weight:500;"><span>Net revenue</span><span>${fmt(netRev, bs)}</span></div><div class="is-row h">Operating expenses</div>${Object.keys(byCat).length ? Object.entries(byCat).sort((a,b) => b[1]-a[1]).map(([c,v]) => `<div class="is-row sub"><span>${esc(c)}</span><span>${fmt(v, bs)}</span></div>`).join('') : `<div class="is-row sub"><span>No expenses</span><span>${fmt(0, bs)}</span></div>`}<div class="is-row" style="font-weight:500;"><span>Total expenses</span><span>${fmt(totExp, bs)}</span></div><div class="is-row tot"><span>Net profit / (loss)</span><span style="color:${profit >= 0 ? 'var(--pos)' : 'var(--neg)'};">${fmt(profit, bs)}</span></div></div><div class="gh" style="margin-top:10px;">Accrual basis — revenue recorded when invoiced.</div>`; }

function repCF() { const months = cashSeries(12); let bal = 0; const rows = months.map(m => { const net = m.in - m.ex; bal += net; return {...m, net, bal}; }); const bs = D.settings.currencySymbol, totIn = rows.reduce((s,r) => s + r.in, 0), totEx = rows.reduce((s,r) => s + r.ex, 0), recv = totalAR(); return `<div class="mgrid"><div class="m"><div class="l">12mo received</div><div class="v pos">${fmt(totIn, bs)}</div></div><div class="m"><div class="l">12mo spent</div><div class="v neg">${fmt(totEx, bs)}</div></div><div class="m"><div class="l">Net cash</div><div class="v ${(totIn-totEx) >= 0 ? 'pos' : 'neg'}">${fmt(totIn-totEx, bs)}</div></div><div class="m"><div class="l">Outstanding</div><div class="v ${recv > 0 ? 'warn' : ''}">${fmt(recv, bs)}</div></div></div><div class="secH"><h3>Monthly cash flow</h3></div><div class="card" style="cursor:default;overflow-x:auto;padding:8px;"><table class="cf-tbl"><thead><tr><th>Month</th><th>In</th><th>Out</th><th>Net</th><th>Balance</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.label}</td><td class="pos">${fmt(r.in, bs)}</td><td class="neg">${fmt(r.ex, bs)}</td><td class="${r.net >= 0 ? 'pos' : 'neg'}">${fmt(r.net, bs)}</td><td class="${r.bal >= 0 ? 'pos' : 'neg'}">${fmt(r.bal, bs)}</td></tr>`).join('')}</tbody></table></div><div class="gh" style="margin-top:10px;">Inflows reflect actual payments. Outstanding: ${fmt(recv, bs)} not yet received.</div>`; }

function repTax() { const t = ytd(), bs = D.settings.currencySymbol, next = nextTaxDates().slice(0, 6); return `${D.settings.isTaxRegistered ? `<div class="card" style="cursor:default;"><div style="font-weight:500;margin-bottom:8px;">${esc(D.settings.taxLabel)} summary (YTD)</div><div class="tx-row"><span class="lbl">${esc(D.settings.taxLabel)} collected (output)</span><span>${fmt(t.taxOut, bs)}</span></div><div class="tx-row"><span class="lbl">${esc(D.settings.taxLabel)} paid (input)</span><span>${fmt(t.taxIn, bs)}</span></div><div class="tx-row" style="font-weight:500;"><span class="lbl">Net payable</span><span style="color:${(t.taxOut-t.taxIn) >= 0 ? 'var(--neg)' : 'var(--pos)'};">${fmt(t.taxOut-t.taxIn, bs)}</span></div></div>` : `<div class="gh">Enable tax registration in Settings.</div>`}<div class="secH"><h3>Upcoming deadlines · ${esc(COUNTRIES[D.settings.country]?.name||'')}</h3></div>${next.length ? `<div class="card" style="cursor:default;padding:4px 12px;">${next.map(x => { const d = Math.ceil((x.date - new Date())/(1000*60*60*24)); return `<div class="tx-row"><div><div class="lbl">${esc(x.label)}</div><div class="dt">${fmtDate(x.date.toISOString().slice(0,10))}</div></div><div class="when ${d <= 14 ? 'soon' : ''}">${d} days</div></div>`; }).join('')}</div>` : `<div class="gh">No deadlines configured.</div>`}`; }

function vSet() {
  const s = D.settings;
  return `<h2 class="vt">Settings</h2>
    <div class="gh">These details appear on every invoice and quote.</div>
    <div class="logo-wrap" id="logoWrap"><div class="logo-thumb" id="logoThumb">${s.hasLogo ? '<span>Loading…</span>' : '<span>No logo</span>'}</div><div style="display:flex;flex-direction:column;gap:4px;"><label class="bl" style="padding:6px 10px;border:0.5px solid var(--bd-sec);border-radius:8px;cursor:pointer;"><i class="ti ti-upload"></i> Upload logo<input type="file" accept="image/*" id="logoInput" style="display:none;"></label>${s.hasLogo ? '<button type="button" class="bl" id="logoRemove" style="color:var(--neg);padding:2px 10px;"><i class="ti ti-trash" style="font-size:14px;"></i> Remove</button>' : ''}</div></div>
    <form id="setForm">
      <div class="fg"><label>Business name</label><input name="businessName" value="${esc(s.businessName)}" required></div>
      <div class="fg"><label>Business address</label><textarea name="address" rows="2">${esc(s.address)}</textarea></div>
      <div class="frow"><div class="fg"><label>Phone</label><input name="phone" value="${esc(s.phone)}"></div><div class="fg"><label>Email</label><input name="email" type="email" value="${esc(s.email)}"></div></div>
      <div class="fg"><label>Website</label><input name="website" value="${esc(s.website||'')}"></div>
      <div class="fg"><label>Business registration #</label><input name="regNumber" value="${esc(s.regNumber)}"></div>
      <div class="secH"><h3>Country & tax</h3></div>
      <div class="fg"><label>Country</label><select name="country" id="cySel">${Object.entries(COUNTRIES).map(([k,v]) => `<option value="${k}" ${s.country === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>
      <div class="frow"><div class="fg"><label>Base currency</label><select name="currency">${CURRENCIES.map(c => `<option value="${c.c}" ${s.currency === c.c ? 'selected' : ''}>${c.c} (${c.s})</option>`).join('')}</select></div><div class="fg"><label>Symbol</label><input name="currencySymbol" value="${esc(s.currencySymbol)}" maxlength="4"></div></div>
      <label class="chk"><input type="checkbox" name="isTaxRegistered" ${s.isTaxRegistered ? 'checked' : ''}> Registered for ${esc(s.taxLabel)}</label>
      <div class="frow3"><div class="fg"><label>Tax label</label><input name="taxLabel" value="${esc(s.taxLabel)}"></div><div class="fg"><label>Rate %</label><input name="taxRate" type="number" step="0.01" value="${s.taxRate}"></div><div class="fg"><label>Tax #</label><input name="taxNumber" value="${esc(s.taxNumber)}"></div></div>
      <div class="secH"><h3>Invoicing & quotes</h3></div>
      <div class="frow3"><div class="fg"><label>Invoice prefix</label><input name="invoicePrefix" value="${esc(s.invoicePrefix)}" maxlength="8"></div><div class="fg"><label>Next inv #</label><input name="nextInvoiceNumber" type="number" min="1" value="${s.nextInvoiceNumber}"></div><div class="fg"></div></div>
      <div class="frow3"><div class="fg"><label>Quote prefix</label><input name="quotePrefix" value="${esc(s.quotePrefix||'QUO-')}" maxlength="8"></div><div class="fg"><label>Next quote #</label><input name="nextQuoteNumber" type="number" min="1" value="${s.nextQuoteNumber||1}"></div><div class="fg"><label>Valid days</label><input name="quoteValidDays" type="number" min="1" value="${s.quoteValidDays||30}"></div></div>
      <div class="fg"><label>Banking details</label><textarea name="bankDetails" rows="4">${esc(s.bankDetails)}</textarea></div>
      <div class="secH"><h3>Exchange rates (to base)</h3></div>
      <div id="ratesArea">${renderRates(s.exchangeRates||{})}</div>
      <button type="button" class="bl" id="addRate"><i class="ti ti-plus"></i> Add rate</button>
      <div class="act"><button class="bp" type="submit"><i class="ti ti-check"></i> Save settings</button></div>
    </form>`;
}

function renderRates(r) { const e = Object.entries(r); if (!e.length) return '<div class="gh" style="margin-bottom:6px;">No rates set.</div>'; return e.map(([c,v]) => `<div class="frow" style="grid-template-columns:1fr 2fr 32px;align-items:end;gap:6px;margin-bottom:6px;"><div class="fg" style="margin:0;"><select data-rc>${CURRENCIES.map(x => `<option value="${x.c}" ${c === x.c ? 'selected' : ''}>${x.c}</option>`).join('')}</select></div><div class="fg" style="margin:0;"><input type="number" step="0.0001" data-rv value="${v}"></div><button type="button" class="bl" data-rmr style="color:var(--neg);padding:8px 4px;"><i class="ti ti-x"></i></button></div>`).join(''); }

// ===== RENDER =====
function render() {
  document.querySelectorAll('.tb').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  document.getElementById('bizName').textContent = D.settings.businessName || '';
  const body = document.getElementById('body');
  if (sub) {
    if (sub.type === 'doc-form') body.innerHTML = vDocForm(sub.id, sub.isQuote);
    else if (sub.type === 'inv-view') body.innerHTML = vInvDetail(sub.id);
    else if (sub.type === 'quo-view') body.innerHTML = vQuoDetail(sub.id);
    else if (sub.type === 'exp-form') body.innerHTML = vExpForm(sub.id);
    else if (sub.type === 'exp-view') body.innerHTML = vExpDetail(sub.id);
    else if (sub.type === 'cust-form') body.innerHTML = vCustForm(sub.id);
    else if (sub.type === 'pay-form') body.innerHTML = vPayForm(sub.invId);
  } else {
    if (view === 'dash') body.innerHTML = vDash();
    else if (view === 'inv') body.innerHTML = vSales();
    else if (view === 'cust') body.innerHTML = vCust();
    else if (view === 'exp') body.innerHTML = vExp();
    else if (view === 'rep') body.innerHTML = vRep();
    else if (view === 'set') body.innerHTML = vSet();
  }
  body.scrollTop = 0;
  hook();
}

function hook() {
  document.querySelectorAll('[data-go]').forEach(el => el.onclick = () => { view = el.dataset.go; sub = null; render(); });
  document.querySelectorAll('[data-back]').forEach(el => el.onclick = () => { sub = null; tmpReceipt = null; tmpRType = 'image'; render(); });
  document.querySelectorAll('[data-new=inv]').forEach(el => el.onclick = () => { sub = {type: 'doc-form', isQuote: false}; render(); });
  document.querySelectorAll('[data-new=quo]').forEach(el => el.onclick = () => { sub = {type: 'doc-form', isQuote: true}; render(); });
  document.querySelectorAll('[data-new=exp]').forEach(el => el.onclick = () => { tmpReceipt = null; sub = {type: 'exp-form'}; render(); });
  document.querySelectorAll('[data-new=cust]').forEach(el => el.onclick = () => { sub = {type: 'cust-form'}; render(); });
  document.querySelectorAll('[data-sales]').forEach(el => el.onclick = () => { salesTab = el.dataset.sales; render(); });
  document.querySelectorAll('[data-go-inv]').forEach(el => el.onclick = () => { sub = {type: 'inv-view', id: el.dataset.goInv}; view = 'inv'; salesTab = 'inv'; render(); });
  document.querySelectorAll('[data-go-quo]').forEach(el => el.onclick = () => { sub = {type: 'quo-view', id: el.dataset.goQuo}; view = 'inv'; salesTab = 'quo'; render(); });
  document.querySelectorAll('[data-go-exp]').forEach(el => el.onclick = async () => { sub = {type: 'exp-view', id: el.dataset.goExp}; render(); const ex = D.expenses.find(e => e.id === sub.id); if (ex?.hasReceipt) { const dataUrl = await DB.getReceiptDataUrl(ex.id, ex.receiptType); if (dataUrl) { const v = document.getElementById('rcptView'); if (v) { if (ex.receiptType === 'pdf') v.onclick = () => window.open(dataUrl, '_blank'); else v.src = dataUrl; } } } });
  document.querySelectorAll('[data-go-cust]').forEach(el => el.onclick = () => { sub = {type: 'cust-form', id: el.dataset.goCust}; render(); });
  document.querySelectorAll('[data-edit-inv]').forEach(el => el.onclick = () => { sub = {type: 'doc-form', id: el.dataset.editInv, isQuote: false}; render(); });
  document.querySelectorAll('[data-edit-quo]').forEach(el => el.onclick = () => { sub = {type: 'doc-form', id: el.dataset.editQuo, isQuote: true}; render(); });
  document.querySelectorAll('[data-edit-exp]').forEach(el => el.onclick = async () => { const id = el.dataset.editExp; const ex = D.expenses.find(e => e.id === id); tmpReceipt = null; tmpRType = ex?.receiptType || 'image'; if (ex?.hasReceipt) tmpReceipt = await DB.getReceiptDataUrl(id, ex.receiptType); sub = {type: 'exp-form', id}; render(); });
  document.querySelectorAll('[data-del-inv]').forEach(el => el.onclick = async () => { if (!confirm('Delete this invoice?')) return; await DB.deleteInvoice(el.dataset.delInv); D.invoices = D.invoices.filter(i => i.id !== el.dataset.delInv); sub = null; view = 'inv'; render(); toast('Invoice deleted'); });
  document.querySelectorAll('[data-del-quo]').forEach(el => el.onclick = async () => { if (!confirm('Delete this quote?')) return; await DB.deleteQuote(el.dataset.delQuo); D.quotes = D.quotes.filter(q => q.id !== el.dataset.delQuo); sub = null; view = 'inv'; salesTab = 'quo'; render(); toast('Quote deleted'); });
  document.querySelectorAll('[data-del-exp]').forEach(el => el.onclick = async () => { if (!confirm('Delete this expense?')) return; const id = el.dataset.delExp; const ex = D.expenses.find(e => e.id === id); if (ex?.hasReceipt) await DB.deleteReceipt(id, ex.receiptType); await DB.deleteExpense(id); D.expenses = D.expenses.filter(e => e.id !== id); sub = null; view = 'exp'; render(); toast('Expense deleted'); });
  document.querySelectorAll('[data-del-cust]').forEach(el => el.onclick = async () => { if (!confirm('Delete this client?')) return; await DB.deleteCustomer(el.dataset.delCust); D.customers = D.customers.filter(c => c.id !== el.dataset.delCust); sub = null; view = 'cust'; render(); toast('Client deleted'); });
  document.querySelectorAll('[data-pdf-inv]').forEach(el => el.onclick = () => exportPDF(el.dataset.pdfInv, 'inv'));
  document.querySelectorAll('[data-pdf-quo]').forEach(el => el.onclick = () => exportPDF(el.dataset.pdfQuo, 'quo'));
  document.querySelectorAll('[data-gen]').forEach(el => el.onclick = () => genRecurring(el.dataset.gen));
  document.querySelectorAll('[data-rep]').forEach(el => el.onclick = () => { reportTab = el.dataset.rep; render(); });
  document.querySelectorAll('[data-pay-inv]').forEach(el => el.onclick = () => { sub = {type: 'pay-form', invId: el.dataset.payInv}; render(); });
  document.querySelectorAll('[data-del-pay]').forEach(el => el.onclick = async () => { const [iid, pid] = el.dataset.delPay.split('|'); const inv = D.invoices.find(i => i.id === iid); if (!inv || !confirm('Remove this payment?')) return; inv.payments = (inv.payments||[]).filter(p => p.id !== pid); await DB.saveInvoice(inv); render(); toast('Payment removed'); });
  document.querySelectorAll('[data-convert]').forEach(el => el.onclick = () => convQuote(el.dataset.convert));
  document.querySelectorAll('[data-qstat]').forEach(el => el.onclick = async () => { const [id, st] = el.dataset.qstat.split('|'); const q = D.quotes.find(x => x.id === id); if (!q) return; q.status = st; await DB.saveQuote(q); render(); toast('Quote ' + st); });

  hookDocForm(); hookCustForm(); hookSetForm(); hookExpForm(); hookPayForm();
}

function hookDocForm() {
  const f = document.getElementById('docForm'); if (!f) return;
  const isQ = f.dataset.quote === '1', lines = document.getElementById('lines'), curSel = document.getElementById('curSel'), rateWrap = document.getElementById('rateWrap'), recChk = document.getElementById('recChk'), recWrap = document.getElementById('recWrap'), custPick = document.getElementById('custPick');
  function bindLines() { lines.querySelectorAll('input').forEach(i => i.oninput = rendTot); lines.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { if (lines.children.length > 1) { b.closest('.li').remove(); rendTot(); } }); }
  document.getElementById('addLine').onclick = () => { const i = lines.children.length; lines.insertAdjacentHTML('beforeend', liRow({desc:'',qty:1,price:0}, i)); bindLines(); };
  bindLines(); rendTot();
  curSel.onchange = () => { const ib = curSel.value === D.settings.currency; rateWrap.style.display = ib ? 'none' : ''; if (D.settings.exchangeRates?.[curSel.value]) document.getElementById('rateIn').value = D.settings.exchangeRates[curSel.value]; rendTot(); };
  if (recChk) recChk.onchange = () => { recWrap.style.display = recChk.checked ? '' : 'none'; };
  if (custPick) custPick.onchange = () => { const c = D.customers.find(x => x.id === custPick.value); if (!c) return; f.customer.value = c.name||''; f.email.value = c.email||''; f.phone.value = c.phone||''; f.address.value = c.address||''; f.custTax.value = c.taxNumber||''; };
  f.onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(f);
    const items = [...lines.querySelectorAll('.li')].map(l => ({desc: l.querySelector('[data-f=desc]').value, qty: Number(l.querySelector('[data-f=qty]').value)||0, unit: l.querySelector('[data-f=unit]')?.value?.trim() || '', price: Number(l.querySelector('[data-f=price]').value)||0})).filter(it => it.desc && it.qty && it.price);
    if (!items.length) { toast('Add at least one line item'); return; }
    const t = compTot(items), id = sub.id || uid(), arr = isQ ? D.quotes : D.invoices, existing = sub.id ? arr.find(x => x.id === sub.id) : null;
    const num = existing ? existing.number : ((isQ ? D.settings.quotePrefix : D.settings.invoicePrefix) + String(isQ ? D.settings.nextQuoteNumber : D.settings.nextInvoiceNumber).padStart(4, '0'));
    let cId = existing?.customerId || null;
    if (fd.get('saveClient') === 'on') {
      const name = fd.get('customer');
      let c = D.customers.find(x => x.name === name);
      if (!c) {
        c = {id: uid(), name, email: fd.get('email'), phone: fd.get('phone'), address: fd.get('address'), taxNumber: fd.get('custTax'), notes: ''};
        await DB.saveCustomer(c); D.customers.push(c);
      } else {
        c.email = fd.get('email') || c.email; c.phone = fd.get('phone') || c.phone; c.address = fd.get('address') || c.address; c.taxNumber = fd.get('custTax') || c.taxNumber;
        await DB.saveCustomer(c);
      }
      cId = c.id;
    }
    const doc = {id, number: num, customerId: cId, customer: fd.get('customer'), email: fd.get('email'), phone: fd.get('phone'), address: fd.get('address'), custTax: fd.get('custTax'), date: fd.get('date'), due: fd.get('due'), items, subtotal: t.sub, taxAmount: t.tax, total: t.total, taxRate: D.settings.taxRate, currency: fd.get('currency'), exchangeRate: Number(fd.get('exchangeRate'))||1};
    if (isQ) {
      doc.status = existing?.status || 'draft'; doc.convertedInvoiceId = existing?.convertedInvoiceId || null;
      await DB.saveQuote(doc);
      if (existing) D.quotes = D.quotes.map(x => x.id === id ? doc : x); else { D.quotes.push(doc); D.settings.nextQuoteNumber = (D.settings.nextQuoteNumber||1) + 1; await DB.saveSettings(D.settings); }
    } else {
      doc.payments = existing?.payments || []; doc.isRecurring = fd.get('isRecurring') === 'on'; doc.recurringFreq = fd.get('recurringFreq') || 'monthly'; doc.recurringNextDate = fd.get('recurringNextDate') || null;
      await DB.saveInvoice(doc);
      if (existing) D.invoices = D.invoices.map(x => x.id === id ? doc : x); else { D.invoices.push(doc); D.settings.nextInvoiceNumber++; await DB.saveSettings(D.settings); }
    }
    sub = {type: isQ ? 'quo-view' : 'inv-view', id}; render(); toast((isQ ? 'Quote' : 'Invoice') + ' saved');
  };
}

function hookCustForm() {
  const f = document.getElementById('custForm'); if (!f) return;
  f.onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(f); const id = sub.id || uid();
    const c = {id, name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'), address: fd.get('address'), taxNumber: fd.get('taxNumber'), notes: fd.get('notes')};
    await DB.saveCustomer(c);
    if (sub.id) D.customers = D.customers.map(x => x.id === id ? c : x); else D.customers.push(c);
    sub = null; view = 'cust'; render(); toast('Client saved');
  };
}

function hookPayForm() {
  const f = document.getElementById('payForm'); if (!f) return;
  const inv = D.invoices.find(i => i.id === sub.invId);
  const fb = document.getElementById('payFull');
  if (fb) fb.onclick = () => { f.amount.value = invBal(inv); };
  f.onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(f);
    const p = {id: uid(), date: fd.get('date'), amount: Number(fd.get('amount'))||0, method: fd.get('method'), notes: fd.get('notes')};
    if (!inv.payments) inv.payments = [];
    inv.payments.push(p);
    await DB.saveInvoice(inv);
    sub = {type: 'inv-view', id: inv.id}; render(); toast('Payment recorded');
  };
}

function hookExpForm() {
  const f = document.getElementById('expForm'); if (!f) return;
  const showImg = src => { const img = document.getElementById('rcptImg'); if (img && img.tagName === 'IMG') img.src = src; };
  if (tmpReceipt && tmpRType === 'image') showImg(tmpReceipt);
  const ec = document.getElementById('expCurSel'), er = document.getElementById('expRateWrap');
  if (ec) ec.onchange = () => { er.style.display = ec.value === D.settings.currency ? 'none' : ''; };
  const eb = document.getElementById('extractBtn');
  if (eb) eb.onclick = () => { const t = document.getElementById('emailPaste').value; if (!t.trim()) { toast('Paste an email first'); return; } const r = parseEmail(t); let n = 0; if (r.amount && !f.amount.value) { f.amount.value = r.amount; n++; } if (r.date) { f.date.value = r.date; n++; } if (r.vendor && !f.vendor.value) { f.vendor.value = r.vendor; n++; } toast(n ? `Extracted ${n} field${n > 1 ? 's' : ''}` : 'Could not extract'); };
  wireRcpt();
  function wireRcpt() {
    document.querySelectorAll('#rcptInput,#rcptInputCam').forEach(inp => { inp.onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      try {
        if (isPdf) { const data = await fileToDataURL(file); tmpReceipt = data; tmpRType = 'pdf'; document.getElementById('rcptArea').innerHTML = `<div class="rcpt-pdf" id="rcptImg"><i class="ti ti-file-type-pdf"></i><div><div style="font-weight:500;">PDF attached</div></div></div><div style="display:flex;gap:6px;margin-bottom:10px;"><label class="bl" style="cursor:pointer;"><i class="ti ti-refresh"></i> Replace<input type="file" accept="image/*,.pdf,application/pdf" id="rcptInput" style="display:none;"></label><button type="button" class="bl" id="rcptRemove" style="color:var(--neg);"><i class="ti ti-x"></i> Remove</button></div>`; wireRcpt(); }
        else {
          const data = await processImg(file); tmpReceipt = data; tmpRType = 'image';
          document.getElementById('rcptArea').innerHTML = `<img class="rcpt" id="rcptImg" src="${data}" alt="Receipt"><div id="scanStatus" class="scan-status"><i class="ti ti-scan"></i> <span>Scanning receipt…</span></div><div style="display:flex;gap:6px;margin-bottom:10px;"><label class="bl" style="cursor:pointer;"><i class="ti ti-refresh"></i> Replace<input type="file" accept="image/*,.pdf,application/pdf" id="rcptInput" style="display:none;"></label><button type="button" class="bl" id="rcptRemove" style="color:var(--neg);"><i class="ti ti-x"></i> Remove</button></div>`;
          wireRcpt();
          // Kick off OCR in the background — don't block the user
          runReceiptOcr(data);
        }
      } catch (err) { toast('Could not load file'); }
    }; });
    const rmv = document.getElementById('rcptRemove');
    if (rmv) rmv.onclick = () => { tmpReceipt = null; tmpRType = 'image'; document.getElementById('rcptArea').innerHTML = `<div class="upload-opts"><label class="cam"><i class="ti ti-camera"></i><span>Snap with camera</span><input type="file" accept="image/*" capture="environment" id="rcptInputCam"></label><label class="cam"><i class="ti ti-upload"></i><span>Upload image or PDF</span><input type="file" accept="image/*,.pdf,application/pdf" id="rcptInput"></label></div>`; wireRcpt(); };
  }

  // OCR + auto-fill blank fields. Runs in the background, never blocks the form.
  async function runReceiptOcr(dataUrl) {
    const status = () => document.getElementById('scanStatus');
    const text = await runOcr(dataUrl, pct => {
      const s = status();
      if (s) s.querySelector('span').textContent = `Scanning receipt… ${pct}%`;
    });
    const s = status();
    if (!text) { if (s) { s.classList.add('done'); s.innerHTML = '<i class="ti ti-info-circle"></i> <span>Couldn\u2019t read this receipt — fill in manually.</span>'; setTimeout(() => s.remove(), 4000); } return; }
    const parsed = parseEmail(text);
    let n = 0;
    if (parsed.amount && !f.amount.value) { f.amount.value = parsed.amount; n++; }
    if (parsed.date) { f.date.value = parsed.date; n++; }
    if (parsed.vendor && !f.vendor.value) { f.vendor.value = parsed.vendor; n++; }
    if (s) {
      if (n > 0) {
        s.classList.add('done', 'ok');
        s.innerHTML = `<i class="ti ti-check"></i> <span>Scanned: extracted ${n} field${n>1?'s':''}. Check before saving.</span>`;
      } else {
        s.classList.add('done');
        s.innerHTML = '<i class="ti ti-info-circle"></i> <span>Couldn\u2019t auto-fill — please enter manually.</span>';
      }
      setTimeout(() => s.remove(), 5000);
    }
  }
  f.onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(f); const id = sub.id || uid();
    const amt = Number(fd.get('amount'))||0; const claims = D.settings.isTaxRegistered && fd.get('claimsTax') === 'on';
    const tax = claims ? (amt - amt/(1 + D.settings.taxRate/100)) : 0;
    const ex = {id, date: fd.get('date'), vendor: fd.get('vendor'), category: fd.get('category'), amount: amt, taxAmount: round2(tax), claimsTax: claims, notes: fd.get('notes'), hasReceipt: !!tmpReceipt, receiptType: tmpRType, currency: fd.get('currency'), exchangeRate: Number(fd.get('exchangeRate'))||1};
    if (tmpReceipt) await DB.uploadReceipt(id, tmpReceipt, tmpRType);
    await DB.saveExpense(ex);
    const existing = sub.id ? D.expenses.find(e => e.id === sub.id) : null;
    if (existing) D.expenses = D.expenses.map(e => e.id === id ? ex : e); else D.expenses.push(ex);
    tmpReceipt = null; tmpRType = 'image'; sub = {type: 'exp-view', id}; render(); toast('Expense saved');
  };
}

function hookSetForm() {
  const f = document.getElementById('setForm'); if (!f) return;
  const cy = document.getElementById('cySel');
  cy.onchange = () => { const c = COUNTRIES[cy.value]; if (!c) return; f.currency.value = c.currency; f.currencySymbol.value = c.symbol; f.taxLabel.value = c.taxLabel; f.taxRate.value = c.taxRate; toast('Country defaults applied'); };
  const li = document.getElementById('logoInput');
  li.onchange = async e => { const file = e.target.files[0]; if (!file) return; try { const data = await processImg(file, 400); await DB.uploadLogo(data); D.settings.hasLogo = true; logoDataUrl = data; await DB.saveSettings(D.settings); render(); toast('Logo saved'); } catch (err) { toast('Could not load image'); } };
  const lr = document.getElementById('logoRemove');
  if (lr) lr.onclick = async () => { await DB.deleteLogo(); D.settings.hasLogo = false; logoDataUrl = null; await DB.saveSettings(D.settings); render(); toast('Logo removed'); };
  loadLogoThumb();
  const ra = document.getElementById('ratesArea');
  document.getElementById('addRate').onclick = () => { const def = CURRENCIES.find(c => c.c !== D.settings.currency)?.c || 'USD'; if (ra.querySelector('.gh')) ra.innerHTML = ''; ra.insertAdjacentHTML('beforeend', renderRates({[def]: 1})); bindR(); };
  function bindR() { ra.querySelectorAll('[data-rmr]').forEach(b => b.onclick = () => b.closest('.frow').remove()); }
  bindR();
  f.onsubmit = async ev => {
    ev.preventDefault(); const fd = new FormData(f);
    Object.assign(D.settings, {businessName: fd.get('businessName'), address: fd.get('address'), phone: fd.get('phone'), email: fd.get('email'), website: fd.get('website'), regNumber: fd.get('regNumber'), country: fd.get('country'), currency: fd.get('currency'), currencySymbol: fd.get('currencySymbol') || sym(fd.get('currency')), isTaxRegistered: fd.get('isTaxRegistered') === 'on', taxLabel: fd.get('taxLabel'), taxRate: Number(fd.get('taxRate'))||0, taxNumber: fd.get('taxNumber'), invoicePrefix: fd.get('invoicePrefix') || 'INV-', nextInvoiceNumber: Number(fd.get('nextInvoiceNumber'))||1, quotePrefix: fd.get('quotePrefix') || 'QUO-', nextQuoteNumber: Number(fd.get('nextQuoteNumber'))||1, quoteValidDays: Number(fd.get('quoteValidDays'))||30, bankDetails: fd.get('bankDetails')});
    const rates = {}; ra.querySelectorAll('.frow').forEach(r => { const c = r.querySelector('[data-rc]')?.value, v = Number(r.querySelector('[data-rv]')?.value); if (c && v > 0 && c !== D.settings.currency) rates[c] = v; });
    D.settings.exchangeRates = rates;
    await DB.saveSettings(D.settings);
    toast('Settings saved'); render();
  };
}

async function loadLogoThumb() {
  if (!D.settings.hasLogo) return;
  if (!logoDataUrl) logoDataUrl = await DB.getLogoDataUrl();
  if (!logoDataUrl) return;
  const w = document.getElementById('logoWrap');
  if (w) { const t = w.querySelector('.logo-thumb'); if (t) t.outerHTML = `<img class="logo-thumb" src="${logoDataUrl}" alt="Logo">`; }
}

async function genRecurring(sid) {
  const src = D.invoices.find(i => i.id === sid); if (!src) return;
  const nid = uid(), num = D.settings.invoicePrefix + String(D.settings.nextInvoiceNumber).padStart(4, '0');
  const nv = {...src, id: nid, number: num, date: today(), due: addDays(today(), 30), isRecurring: false, recurringFreq: null, recurringNextDate: null, payments: []};
  await DB.saveInvoice(nv); D.invoices.push(nv); D.settings.nextInvoiceNumber++;
  if (src.recurringNextDate) { src.recurringNextDate = advRec(src.recurringNextDate, src.recurringFreq || 'monthly'); await DB.saveInvoice(src); }
  await DB.saveSettings(D.settings);
  sub = {type: 'inv-view', id: nid}; view = 'inv'; salesTab = 'inv'; render(); toast('Invoice generated');
}

async function convQuote(qid) {
  const q = D.quotes.find(x => x.id === qid); if (!q) return;
  const nid = uid(), num = D.settings.invoicePrefix + String(D.settings.nextInvoiceNumber).padStart(4, '0');
  const inv = {id: nid, number: num, customerId: q.customerId, customer: q.customer, email: q.email, phone: q.phone, address: q.address, custTax: q.custTax, date: today(), due: addDays(today(), 30), items: q.items, subtotal: q.subtotal, taxAmount: q.taxAmount, total: q.total, taxRate: q.taxRate, currency: q.currency, exchangeRate: q.exchangeRate, payments: [], isRecurring: false};
  await DB.saveInvoice(inv); D.invoices.push(inv); D.settings.nextInvoiceNumber++;
  q.status = 'converted'; q.convertedInvoiceId = nid;
  await DB.saveQuote(q); await DB.saveSettings(D.settings);
  sub = {type: 'inv-view', id: nid}; view = 'inv'; salesTab = 'inv'; render(); toast('Converted to invoice');
}

// Build clean PDF-optimized HTML for an invoice or quote.
// Uses explicit, well-balanced typography and a scoped <style> block so the
// PDF output is identical regardless of screen rendering or dark mode.
function buildPdfHtml(doc, isQuote) {
  const s = D.settings;
  const cs = sym(doc.currency);
  const title = isQuote ? 'QUOTATION' : 'TAX INVOICE';
  const dueLabel = isQuote ? 'Valid until' : 'Due';
  const totalLabel = isQuote ? 'Total' : 'Total due';

  return `
  <style>
    .pdf-doc { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; background: #fff; padding: 36px 40px; width: 794px; box-sizing: border-box; font-size: 10px; line-height: 1.45; }
    .pdf-doc * { box-sizing: border-box; }
    .pdf-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 24px; }
    .pdf-head .lhs { flex: 1; }
    .pdf-head .logo { max-width: 140px; max-height: 64px; object-fit: contain; margin-bottom: 10px; display: block; }
    .pdf-head h1 { font-size: 22px; font-weight: 700; letter-spacing: 1.5px; color: #0f3a8a; margin: 0 0 4px; line-height: 1; }
    .pdf-head .num { font-size: 11px; color: #777; }
    .pdf-head .meta { text-align: right; font-size: 10px; line-height: 1.6; }
    .pdf-head .meta .lab { color: #777; }
    .pdf-parties { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
    .pdf-party { flex: 1; }
    .pdf-party .role { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #777; margin-bottom: 5px; }
    .pdf-party .name { font-size: 11px; font-weight: 700; color: #1a1a1a; margin-bottom: 2px; }
    .pdf-party .line { font-size: 10px; color: #444; white-space: pre-line; }
    .pdf-table { width: 100%; border-collapse: collapse; margin: 0 0 14px; }
    .pdf-table thead th { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #0f3a8a; padding: 8px 6px; border-bottom: 1.2px solid #0f3a8a; text-align: left; }
    .pdf-table thead th.r { text-align: right; }
    .pdf-table thead th.c { text-align: center; }
    .pdf-table tbody td.c { text-align: center; color: #555; }
    .pdf-table tbody td { font-size: 10px; padding: 8px 6px; border-bottom: 0.5px solid #eee; color: #1a1a1a; vertical-align: top; }
    .pdf-table tbody td.r { text-align: right; }
    .pdf-totals { width: 100%; margin-top: 4px; }
    .pdf-totals td { padding: 4px 6px; font-size: 10px; color: #444; }
    .pdf-totals td.lab { text-align: right; }
    .pdf-totals td.val { text-align: right; width: 110px; color: #1a1a1a; }
    .pdf-totals tr.tot td { font-size: 12px; font-weight: 700; color: #0f3a8a; border-top: 1.5px solid #0f3a8a; padding-top: 9px; }
    .pdf-bank { margin-top: 20px; padding-top: 12px; border-top: 0.5px solid #ddd; }
    .pdf-bank .role { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #777; margin-bottom: 5px; }
    .pdf-bank .lines { font-size: 10px; color: #1a1a1a; white-space: pre-line; line-height: 1.55; }
    .pdf-note { margin-top: 18px; padding: 11px 14px; background: #fff8e1; border-left: 3px solid #f4a623; font-size: 9.5px; font-style: italic; color: #5a4818; line-height: 1.5; }
    .pdf-foot { margin-top: 28px; padding-top: 12px; border-top: 0.5px solid #eee; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .pdf-foot img { height: 26px; opacity: 0.85; }
    .pdf-foot .pby { font-size: 7.5px; color: #999; text-transform: uppercase; letter-spacing: 1.5px; text-align: right; line-height: 1.5; }
    .pdf-foot .pby b { color: #0f3a8a; font-weight: 700; }
    .pdf-foot .pby span { color: #f4a623; font-weight: 700; }
  </style>
  <div class="pdf-doc">
    <div class="pdf-head">
      <div class="lhs">
        ${s.hasLogo && logoDataUrl ? `<img class="logo" src="${logoDataUrl}" alt="Logo">` : ''}
        <h1>${title}</h1>
        <div class="num">${esc(doc.number)}</div>
      </div>
      <div class="meta">
        <div><span class="lab">Date:</span> ${fmtDate(doc.date)}</div>
        <div><span class="lab">${dueLabel}:</span> ${fmtDate(doc.due)}</div>
        ${doc.currency !== s.currency ? `<div style="margin-top:4px;"><span class="lab">Currency:</span> ${esc(doc.currency)}</div>` : ''}
      </div>
    </div>

    <div class="pdf-parties">
      <div class="pdf-party">
        <div class="role">From</div>
        <div class="name">${esc(s.businessName || 'Your business')}</div>
        ${s.address ? `<div class="line">${esc(s.address)}</div>` : ''}
        ${s.phone ? `<div class="line">${esc(s.phone)}</div>` : ''}
        ${s.email ? `<div class="line">${esc(s.email)}</div>` : ''}
        ${s.website ? `<div class="line">${esc(s.website)}</div>` : ''}
        ${s.taxNumber ? `<div class="line">${esc(s.taxLabel)} #: ${esc(s.taxNumber)}</div>` : ''}
        ${s.regNumber ? `<div class="line">Reg #: ${esc(s.regNumber)}</div>` : ''}
      </div>
      <div class="pdf-party">
        <div class="role">${isQuote ? 'Quote for' : 'Bill to'}</div>
        <div class="name">${esc(doc.customer || '')}</div>
        ${doc.address ? `<div class="line">${esc(doc.address)}</div>` : ''}
        ${doc.email ? `<div class="line">${esc(doc.email)}</div>` : ''}
        ${doc.phone ? `<div class="line">${esc(doc.phone)}</div>` : ''}
        ${doc.custTax ? `<div class="line">${esc(s.taxLabel)} #: ${esc(doc.custTax)}</div>` : ''}
      </div>
    </div>

    <table class="pdf-table">
      <thead><tr><th>Description</th><th class="r" style="width:50px;">Qty</th><th class="c" style="width:60px;">Unit</th><th class="r" style="width:90px;">Unit price</th><th class="r" style="width:100px;">Amount</th></tr></thead>
      <tbody>
        ${doc.items.map(it => `<tr><td>${esc(it.desc)}</td><td class="r">${it.qty}</td><td class="c">${esc(it.unit||'')}</td><td class="r">${fmt(it.price, cs)}</td><td class="r">${fmt(it.qty * it.price, cs)}</td></tr>`).join('')}
      </tbody>
    </table>

    <table class="pdf-totals">
      <tr><td class="lab">Subtotal</td><td class="val">${fmt(doc.subtotal, cs)}</td></tr>
      ${doc.taxAmount > 0 ? `<tr><td class="lab">${esc(s.taxLabel)} @ ${doc.taxRate || s.taxRate}%</td><td class="val">${fmt(doc.taxAmount, cs)}</td></tr>` : ''}
      <tr class="tot"><td class="lab">${totalLabel}</td><td class="val">${fmt(doc.total, cs)}</td></tr>
    </table>

    ${!isQuote && s.bankDetails ? `<div class="pdf-bank"><div class="role">Banking details</div><div class="lines">${esc(s.bankDetails)}</div></div>` : ''}
    ${isQuote ? `<div class="pdf-note">Prices are negotiable and dependent on quantities ordered.</div>` : ''}

    <div class="pdf-foot">
      <img src="${GDI_GLOBE}" alt="Global Deal Inc">
      <div class="pby">Created with<br><b>Global Business Manager</b><br>powered by <b>GLOBAL</b><span>DEAL</span> <b>INC.</b></div>
    </div>
  </div>`;
}

async function exportPDF(id, kind) {
  const doc = kind === 'quo' ? D.quotes.find(x => x.id === id) : D.invoices.find(x => x.id === id);
  if (!doc) { toast('Could not find document'); return; }
  if (!window.html2canvas || !window.jspdf) { toast('PDF library still loading'); return; }
  toast('Generating PDF…');

  // Build clean PDF HTML in an off-screen container
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff;z-index:-1;';
  wrap.innerHTML = buildPdfHtml(doc, kind === 'quo');
  document.body.appendChild(wrap);
  const renderTarget = wrap.querySelector('.pdf-doc');

  try {
    // Wait a frame so images/layout settle
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => setTimeout(r, 50));

    const canvas = await window.html2canvas(renderTarget, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      width: 794,
      windowWidth: 794
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageH = 297, imgW = 190;
    const imgH = (canvas.height * imgW) / canvas.width;

    if (imgH <= pageH - 20) {
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 10, 10, imgW, imgH);
    } else {
      // Multi-page: slice the tall canvas into A4-sized chunks
      const pageHeightPx = (pageH - 20) * canvas.width / imgW;
      let yPos = 0;
      while (yPos < canvas.height) {
        const sliceH = Math.min(pageHeightPx, canvas.height - yPos);
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = sliceH;
        slice.getContext('2d').drawImage(canvas, 0, yPos, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        const sliceImgH = (sliceH * imgW) / canvas.width;
        if (yPos > 0) pdf.addPage();
        pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', 10, 10, imgW, sliceImgH);
        yPos += sliceH;
      }
    }

    pdf.save((doc.number || (kind === 'quo' ? 'quote' : 'invoice')) + '.pdf');
    toast('PDF downloaded');
  } catch (err) {
    toast('PDF export failed');
    console.error(err);
  } finally {
    document.body.removeChild(wrap);
  }
}

// ===== INIT =====
export async function startApp() {
  try {
    D.settings = await DB.loadSettings();
    [D.customers, D.invoices, D.quotes, D.expenses] = await Promise.all([DB.loadCustomers(), DB.loadInvoices(), DB.loadQuotes(), DB.loadExpenses()]);
    if (D.settings.hasLogo) logoDataUrl = await DB.getLogoDataUrl();
    document.querySelectorAll('.tb').forEach(b => b.onclick = () => { view = b.dataset.v; sub = null; tmpReceipt = null; tmpRType = 'image'; render(); });
    render();
  } catch (err) {
    console.error('Failed to load data:', err);
    document.getElementById('body').innerHTML = `<div class="empty"><i class="ti ti-alert-triangle"></i>Failed to load data.<br><small>${esc(err.message)}</small><br><button class="bp" style="margin-top:12px;" onclick="location.reload()">Retry</button></div>`;
  }
}
