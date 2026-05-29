// Supabase client and database layer
// Replaces the prototype's fake window.storage with real cloud storage

let supabase = null;
let currentUser = null;

export function initSupabase() {
  const url = window.GBM_CONFIG?.SUPABASE_URL;
  const key = window.GBM_CONFIG?.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase config missing. Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel.');
  }
  supabase = window.supabase.createClient(url, key);
  return supabase;
}

export function getSupabase() { return supabase; }
export function getUser() { return currentUser; }
export function setUser(u) { currentUser = u; }

// ===== AUTH =====
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  currentUser = data.user;
  return data.user;
}

export async function signOut() {
  await supabase.auth.signOut();
  currentUser = null;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    currentUser = data.session.user;
    return data.session;
  }
  return null;
}

// ===== SETTINGS =====
const DEFAULT_SETTINGS = {
  business_name: '', address: '', phone: '', email: '', website: '',
  tax_number: '', reg_number: '', bank_details: '',
  country: 'ZA', currency: 'ZAR', currency_symbol: 'R',
  tax_label: 'VAT', tax_rate: 15, is_tax_registered: false,
  has_logo: false, next_invoice_number: 1, invoice_prefix: 'INV-',
  next_quote_number: 1, quote_prefix: 'QUO-', quote_valid_days: 30,
  exchange_rates: {}
};

export async function loadSettings() {
  const { data, error } = await supabase.from('settings').select('*').eq('user_id', currentUser.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    // Create default settings row for this user
    const row = { user_id: currentUser.id, ...DEFAULT_SETTINGS };
    const { data: created, error: insErr } = await supabase.from('settings').insert(row).select().single();
    if (insErr) throw insErr;
    return dbToClient(created, 'settings');
  }
  return dbToClient(data, 'settings');
}

export async function saveSettings(settings) {
  const row = clientToDb(settings, 'settings');
  row.user_id = currentUser.id;
  row.updated_at = new Date().toISOString();
  const { error } = await supabase.from('settings').upsert(row, { onConflict: 'user_id' });
  if (error) throw error;
}

// ===== CUSTOMERS =====
export async function loadCustomers() {
  const { data, error } = await supabase.from('customers').select('*').eq('user_id', currentUser.id).order('name');
  if (error) throw error;
  return (data || []).map(r => dbToClient(r, 'customers'));
}

export async function saveCustomer(c) {
  const row = clientToDb(c, 'customers');
  row.user_id = currentUser.id;
  const { data, error } = await supabase.from('customers').upsert(row).select().single();
  if (error) throw error;
  return dbToClient(data, 'customers');
}

export async function deleteCustomer(id) {
  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) throw error;
}

// ===== INVOICES =====
export async function loadInvoices() {
  const { data, error } = await supabase.from('invoices').select('*').eq('user_id', currentUser.id).order('date', { ascending: false });
  if (error) throw error;
  return (data || []).map(r => dbToClient(r, 'invoices'));
}

export async function saveInvoice(inv) {
  const row = clientToDb(inv, 'invoices');
  row.user_id = currentUser.id;
  const { data, error } = await supabase.from('invoices').upsert(row).select().single();
  if (error) throw error;
  return dbToClient(data, 'invoices');
}

export async function deleteInvoice(id) {
  const { error } = await supabase.from('invoices').delete().eq('id', id);
  if (error) throw error;
}

// ===== QUOTES =====
export async function loadQuotes() {
  const { data, error } = await supabase.from('quotes').select('*').eq('user_id', currentUser.id).order('date', { ascending: false });
  if (error) throw error;
  return (data || []).map(r => dbToClient(r, 'quotes'));
}

export async function saveQuote(q) {
  const row = clientToDb(q, 'quotes');
  row.user_id = currentUser.id;
  const { data, error } = await supabase.from('quotes').upsert(row).select().single();
  if (error) throw error;
  return dbToClient(data, 'quotes');
}

export async function deleteQuote(id) {
  const { error } = await supabase.from('quotes').delete().eq('id', id);
  if (error) throw error;
}

// ===== EXPENSES =====
export async function loadExpenses() {
  const { data, error } = await supabase.from('expenses').select('*').eq('user_id', currentUser.id).order('date', { ascending: false });
  if (error) throw error;
  return (data || []).map(r => dbToClient(r, 'expenses'));
}

export async function saveExpense(e) {
  const row = clientToDb(e, 'expenses');
  row.user_id = currentUser.id;
  const { data, error } = await supabase.from('expenses').upsert(row).select().single();
  if (error) throw error;
  return dbToClient(data, 'expenses');
}

export async function deleteExpense(id) {
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;
}

// ===== STORAGE (files: receipts and logo) =====
function userPath(filename) { return `${currentUser.id}/${filename}`; }

export async function uploadReceipt(expenseId, dataUrl, type) {
  const blob = dataUrlToBlob(dataUrl);
  const ext = type === 'pdf' ? 'pdf' : 'jpg';
  const path = userPath(`${expenseId}.${ext}`);
  const { error } = await supabase.storage.from('receipts').upload(path, blob, { upsert: true, contentType: type === 'pdf' ? 'application/pdf' : 'image/jpeg' });
  if (error) throw error;
}

export async function getReceiptUrl(expenseId, type) {
  const ext = type === 'pdf' ? 'pdf' : 'jpg';
  const path = userPath(`${expenseId}.${ext}`);
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}

export async function getReceiptDataUrl(expenseId, type) {
  const url = await getReceiptUrl(expenseId, type);
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await blobToDataUrl(blob);
  } catch { return null; }
}

export async function deleteReceipt(expenseId, type) {
  const ext = type === 'pdf' ? 'pdf' : 'jpg';
  const path = userPath(`${expenseId}.${ext}`);
  await supabase.storage.from('receipts').remove([path]);
}

export async function uploadLogo(dataUrl) {
  const blob = dataUrlToBlob(dataUrl);
  const path = userPath('logo.jpg');
  const { error } = await supabase.storage.from('logos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw error;
}

export async function getLogoDataUrl() {
  const path = userPath('logo.jpg');
  const { data, error } = await supabase.storage.from('logos').createSignedUrl(path, 3600);
  if (error) return null;
  try {
    const res = await fetch(data.signedUrl);
    const blob = await res.blob();
    return await blobToDataUrl(blob);
  } catch { return null; }
}

export async function deleteLogo() {
  const path = userPath('logo.jpg');
  await supabase.storage.from('logos').remove([path]);
}

// ===== HELPERS: snake_case (DB) <-> camelCase (client) =====
const snake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const camel = s => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function clientToDb(obj, table) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[snake(k)] = v;
  }
  return out;
}

function dbToClient(row, table) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[camel(k)] = v;
  }
  return out;
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = meta.match(/:(.*?);/)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
