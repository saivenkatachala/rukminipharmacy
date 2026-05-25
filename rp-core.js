// ============================================================
// Rukmini Pharmacy — Core Data Engine v3.0
// PRIMARY DATABASE : Google Sheets (shared across all devices)
// LOCAL CACHE      : localStorage (speeds up page loads)
// ============================================================
//
// HOW IT WORKS:
//   WRITE  → always goes to Google Sheets first, then updates local cache
//   READ   → fetches from Google Sheets on every page load, stores in cache
//   CACHE  → used only while the Sheet fetch is in-flight (instant display)
//
// This means ALL devices always see the SAME data.
// ============================================================

const RP = {

  // ---- IMPORTANT: Replace with your deployed Apps Script URL ----
      SHEET_URL: 'https://script.google.com/macros/s/AKfycbxsbmlG0VMPBmXbnEs28wpd8zbJ5ZATZwJYi5jouMxnxsgxCicugKIKpwmRY-1mnBfzvQ/exec',

  OWNER_EMAIL: 'saivenkatachala@gmail.com',

  MED_TYPES: [
    'Tablets','Injections','Syrups','Drops','Ointments',
    'Lotions','Soaps','Creams','Powders','Capsules',
    'Suppositories','Patches','Sprays','Gels','Suspensions','Others'
  ],

  QTY_TYPES: ['Strips','Bottles','Boxes','Vials','Sachets','Tubes','Packets','Others'],

  LOW_STOCK: 5,
  EXPIRY_WARN_MONTHS: 3,

  // ============================================================
  // LOCAL DATE — returns YYYY-MM-DD in the device's local timezone
  // DO NOT use new Date().toISOString().slice(0,10) — that gives
  // UTC date which is yesterday for India (UTC+5:30) before 5:30 AM
  // ============================================================
  localDateStr(d){
    const dt = d ? new Date(d) : new Date();
    const y  = dt.getFullYear();
    const m  = String(dt.getMonth()+1).padStart(2,'0');
    const day= String(dt.getDate()).padStart(2,'0');
    return y+'-'+m+'-'+day;
  },



  // ============================================================
  // CACHE KEYS  (localStorage — per-device speed cache only)
  // ============================================================
  _KEY_STOCK    : 'rp_stock_cache',
  _KEY_BILLS    : 'rp_bills_cache',
  _KEY_DISMISSED: 'rp_dismissed_alerts',
  _KEY_THEME    : 'rp_theme',
  _KEY_SYNC_TS  : 'rp_last_sync',   // timestamp of last successful sync

  // ============================================================
  // SYNC STATE — prevents duplicate simultaneous fetches
  // ============================================================
  _syncing: false,

  // ============================================================
  // LOCAL CACHE HELPERS
  // ============================================================
  _getCached(key){ try{ return JSON.parse(localStorage.getItem(key)||'[]'); }catch{ return []; } },
  _setCached(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} },

  getStock()  { return this._getCached(this._KEY_STOCK);  },
  getBills()  { return this._getCached(this._KEY_BILLS);  },
  saveStock(arr){ this._setCached(this._KEY_STOCK, arr);  },
  saveBills(arr){ this._setCached(this._KEY_BILLS, arr);  },

  getDismissedAlerts(){ return this._getCached(this._KEY_DISMISSED); },
  saveDismissedAlerts(arr){ this._setCached(this._KEY_DISMISSED, arr); },

  // ============================================================
  // CHECK IF SHEET URL IS CONFIGURED
  // ============================================================
  isSheetConfigured(){
    return this.SHEET_URL &&
           !this.SHEET_URL.includes('YOUR_DEPLOYMENT_ID') &&
           this.SHEET_URL.startsWith('https://script.google.com');
  },

  // ============================================================
  // FETCH FROM GOOGLE SHEETS  →  update local cache
  // Call this on every page load to get fresh shared data.
  // Returns a Promise that resolves when cache is updated.
  // ============================================================
  async syncFromSheet(){
    if(!this.isSheetConfigured()){
      console.info('[RP] Sheet URL not configured — using local cache only (single-device mode).');
      return { ok: false, reason: 'not_configured' };
    }
    if(this._syncing) return { ok: false, reason: 'already_syncing' };
    this._syncing = true;

    try {
      // Single GET call fetches both stock and bills
      const url = this.SHEET_URL + '?data=' + encodeURIComponent(JSON.stringify({ action: 'fetchAll' }));
      const resp = await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' });

      // no-cors returns opaque response — we can't read the body directly.
      // WORKAROUND: Use a separate JSONP-style fetch via script tag,
      // OR switch to a cors-friendly fetch via the redirect trick below.
      // Since Apps Script supports ?callback= JSONP, we use that approach.
      const data = await this._fetchViaJSONP({ action: 'fetchAll' });

      if(data && data.status === 'ok'){
        if(Array.isArray(data.stock))  this._setCached(this._KEY_STOCK, data.stock);
        if(Array.isArray(data.bills))  this._setCached(this._KEY_BILLS, data.bills);
        if(Array.isArray(data.sales))  { try{ localStorage.setItem('rp_sales_cache', JSON.stringify(data.sales)); }catch(e){} }
        localStorage.setItem(this._KEY_SYNC_TS, new Date().toISOString());
        console.info('[RP] Synced from Sheet —', (data.stock||[]).length, 'stock items,', (data.bills||[]).length, 'bills.');
        return { ok: true, stock: data.stock, bills: data.bills };
      }
      return { ok: false, reason: 'bad_response', data };

    } catch(e) {
      console.warn('[RP] Sync failed:', e.message);
      return { ok: false, reason: e.message };
    } finally {
      this._syncing = false;
    }
  },

  // ============================================================
  // JSONP FETCH — bypasses CORS completely.
  // Injects a <script> tag pointing to the Apps Script URL with
  // a callback param. Apps Script wraps the JSON in the callback.
  // ============================================================
  _fetchViaJSONP(payload){
    return new Promise((resolve, reject) => {
      const cbName = '_rp_cb_' + Date.now();
      const timeout = setTimeout(() => {
        delete window[cbName];
        const script = document.getElementById(cbName);
        if(script) script.remove();
        reject(new Error('JSONP timeout'));
      }, 15000);

      window[cbName] = (data) => {
        clearTimeout(timeout);
        delete window[cbName];
        const script = document.getElementById(cbName);
        if(script) script.remove();
        resolve(data);
      };

      const params = new URLSearchParams({
        data: JSON.stringify(payload),
        callback: cbName
      });

      const script = document.createElement('script');
      script.id = cbName;
      script.src = this.SHEET_URL + '?' + params.toString();
      script.onerror = () => {
        clearTimeout(timeout);
        delete window[cbName];
        script.remove();
        reject(new Error('JSONP script load error'));
      };
      document.head.appendChild(script);
    });
  },

  // ============================================================
  // WRITE TO GOOGLE SHEETS  — fire-and-forget GET
  // Also updates local cache immediately so UI feels instant.
  // ============================================================
  async postToSheet(payload){
    if(!this.isSheetConfigured()){
      console.info('[RP] Sheet not configured — saved locally only.');
      return;
    }
    try {
      const encoded = encodeURIComponent(JSON.stringify(payload));
      const url = this.SHEET_URL + '?data=' + encoded;
      // Use no-cors GET — bypasses preflight, request reaches Google
      fetch(url, { method: 'GET', mode: 'no-cors' })
        .then(() => console.info('[RP] Sheet write sent:', payload.action))
        .catch(err => console.warn('[RP] Sheet write error:', err.message));
    } catch(e) {
      console.warn('[RP] postToSheet failed:', e.message);
    }
  },

  // ============================================================
  // HIGH-LEVEL DATA OPERATIONS
  // Each operation:
  //   1. Updates local cache immediately (instant UI)
  //   2. Writes to Google Sheets (syncs all devices)
  // ============================================================

  // Add a new stock item
  addStockItem(item){
    item.id      = item.id || this.uid();
    item.addedOn = item.addedOn || this.localDateStr();
    const stock  = this.getStock();
    stock.push(item);
    this.saveStock(stock);
    this.postToSheet({ action: 'addStock', data: item });
    return item;
  },

  // Update existing stock item
  updateStockItem(id, changes){
    const stock = this.getStock();
    const idx   = stock.findIndex(s => s.id === id);
    if(idx === -1) return false;
    stock[idx] = { ...stock[idx], ...changes, updatedOn: this.localDateStr() };
    this.saveStock(stock);
    this.postToSheet({ action: 'updateStock', data: stock[idx] });
    return true;
  },

  // Delete stock item
  deleteStockItem(id){
    const stock = this.getStock().filter(s => s.id !== id);
    this.saveStock(stock);
    this.postToSheet({ action: 'deleteStock', id });
    return true;
  },

  // Add a bill and deduct stock
  addBill(bill){
    bill.id        = bill.id || this.uid();
    bill.createdOn = bill.createdOn || new Date().toISOString();
    const bills    = this.getBills();
    bills.push(bill);
    this.saveBills(bills);

    // Deduct stock quantities
    const stock = this.getStock();
    (bill.items || []).forEach(item => {
      const idx = stock.findIndex(s => s.id === item.medId);
      if(idx !== -1){
        stock[idx].quantity = Math.max(0, (parseInt(stock[idx].quantity)||0) - item.qty);
      }
    });
    this.saveStock(stock);

    // Single call to sheet handles bill save + stock deduction + email
    this.postToSheet({ action: 'addBill', data: bill });
    return bill;
  },

  // ============================================================
  // SYNC STATUS BANNER — call on any page to show sync state
  // ============================================================
  showSyncBanner(containerId){
    const el = document.getElementById(containerId);
    if(!el) return;

    if(!this.isSheetConfigured()){
      el.innerHTML = `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;
        padding:10px 16px;font-size:.83rem;color:#92400e;margin-bottom:16px;">
        <strong>Single-device mode:</strong> Data is saved on this device only.
        To sync across devices, add your Google Sheet URL to <code>rp-core.js</code>.
      </div>`;
      return;
    }

    const lastSync = localStorage.getItem(this._KEY_SYNC_TS);
    const lastSyncText = lastSync
      ? 'Last synced: ' + new Date(lastSync).toLocaleTimeString('en-IN')
      : 'Not yet synced this session';

    el.innerHTML = `<div id="sync-banner" style="background:rgba(0,212,170,.08);
      border:1px solid rgba(0,212,170,.2);border-radius:8px;
      padding:9px 16px;font-size:.82rem;color:var(--accent);
      margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <span id="sync-status-text">&#x1F504; Syncing with Google Sheets...</span>
      <span style="color:var(--muted);font-size:.75rem;" id="sync-last">${lastSyncText}</span>
    </div>`;

    // Trigger actual sync
    this.syncFromSheet().then(result => {
      const banner   = document.getElementById('sync-banner');
      const statusEl = document.getElementById('sync-status-text');
      if(!banner) return;
      if(result.ok){
        banner.style.background   = 'rgba(34,197,94,.08)';
        banner.style.borderColor  = 'rgba(34,197,94,.2)';
        banner.style.color        = 'var(--success)';
        statusEl.textContent      = '&#x2713; Synced with Google Sheets';
        document.getElementById('sync-last').textContent =
          'Updated: ' + new Date().toLocaleTimeString('en-IN');
        // Trigger page re-render if a callback is registered
        if(typeof window._rpOnSyncComplete === 'function'){
          window._rpOnSyncComplete();
        }
      } else {
        banner.style.background  = 'rgba(255,183,3,.08)';
        banner.style.borderColor = 'rgba(255,183,3,.2)';
        banner.style.color       = 'var(--warn)';
        statusEl.textContent     = '&#x26A0; Using cached data (' + (result.reason||'check Sheet URL') + ')';
      }
    });
  },

  // ============================================================
  // ALERT COMPUTATION
  // ============================================================
  computeAlerts(){
    const stock     = this.getStock();
    const dismissed = this.getDismissedAlerts();
    const alerts    = [];
    const now       = new Date();
    const warnDate  = new Date();
    warnDate.setMonth(warnDate.getMonth() + this.EXPIRY_WARN_MONTHS);

    stock.forEach(item => {
      const qty = parseInt(item.quantity) || 0;

      if(qty > 0 && qty <= this.LOW_STOCK){
        const id = `low_${item.id}`;
        if(!dismissed.includes(id))
          alerts.push({ id, type:'low', item, msg:`Low stock: ${item.name} (${qty} ${item.qtyType} left)` });
      }
      if(qty === 0){
        const id = `zero_${item.id}`;
        if(!dismissed.includes(id))
          alerts.push({ id, type:'zero', item, msg:`Out of stock: ${item.name}` });
      }
      if(item.expiry){
        const exp = new Date(item.expiry);
        if(exp < now){
          const id = `expired_${item.id}`;
          if(!dismissed.includes(id))
            alerts.push({ id, type:'expired', item, msg:`EXPIRED: ${item.name} (${item.expiry})` });
        } else if(exp <= warnDate){
          const id  = `exp_${item.id}`;
          const days = Math.ceil((exp - now)/(1000*60*60*24));
          if(!dismissed.includes(id))
            alerts.push({ id, type:'expiry', item, msg:`Expiring in ${days} days: ${item.name} (${item.expiry})` });
        }
      }
    });
    return alerts;
  },

  dismissAlert(id){
    const d = this.getDismissedAlerts();
    if(!d.includes(id)){ d.push(id); this.saveDismissedAlerts(d); }
  },

  // ============================================================
  // THEME
  // ============================================================
  getTheme(){ return localStorage.getItem(this._KEY_THEME) || 'dark'; },
  setTheme(t){ localStorage.setItem(this._KEY_THEME, t); document.documentElement.setAttribute('data-theme', t); },
  applyTheme(){ document.documentElement.setAttribute('data-theme', this.getTheme()); },

  // ============================================================
  // AUTH GUARD
  // ============================================================
  guard(){
    if(sessionStorage.getItem('rp_auth') !== '1'){
      window.location.href = 'index.html';
      return false;
    }
    return true;
  },

  // ============================================================
  // UTILITIES
  // ============================================================
  uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,6); },

  fmtDate(d){
    if(!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  },

  toast(msg, type='success'){
    const t = document.createElement('div');
    t.className = `rp-toast rp-toast--${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3500);
  }
};

// ============================================================
// SALES DATA  (v2 — Stock Sale feature)
// ============================================================
// Sales are stored separately from bills.
// Bills = customer invoices (use MRP)
// Sales = internal stock movement tracking (use cost price for profit)

const RP_SALES = {

  _KEY: 'rp_sales_cache',

  _get(){ try{ return JSON.parse(localStorage.getItem(this._KEY)||'[]'); }catch{ return []; } },
  _set(arr){ try{ localStorage.setItem(this._KEY, JSON.stringify(arr)); }catch(e){} },

  getAll(){ return this._get(); },

  // skipStockDeduct=true when caller (billing.html) already deducted stock
  add(sale, skipStockDeduct){
    sale.id        = sale.id || RP.uid();
    sale.createdOn = sale.createdOn || new Date().toISOString();
    sale.date      = sale.date      || RP.localDateStr();
    const sales = this._get();
    sales.push(sale);
    this._set(sales);
    // Only deduct stock if caller hasn't already done it
    if(!skipStockDeduct){
      const stock = RP.getStock();
      const idx = stock.findIndex(s => s.id === sale.stockId);
      if(idx !== -1){
        stock[idx].quantity = Math.max(0, (parseInt(stock[idx].quantity)||0) - (parseInt(sale.qtySold)||0));
      }
      RP.saveStock(stock);
    }
    RP.postToSheet({ action: 'addSale', data: sale });
    return sale;
  },

  // Profit = (sellingPrice - costPrice) * qty
  // costPrice here = cost per unit as entered in add-stock
  getProfit(sales){
    return (sales||this._get()).reduce((sum, s) => {
      const profit = ((parseFloat(s.sellingPricePerUnit)||0) - (parseFloat(s.costPricePerUnit)||0))
                     * (parseInt(s.qtySold)||0);
      return sum + profit;
    }, 0);
  },

  // Today's sales
  getToday(){
    const today = RP.localDateStr();
    // Compare date strings directly — no Date object to avoid UTC shift
    return this._get().filter(s => this._saleDate(s) === today);
  },

  // Sales in a date range — pure string comparison, no Date objects
  getRange(from, to){
    const f = String(from).slice(0,10);
    const t = String(to).slice(0,10);
    return this._get().filter(s => {
      const d = this._saleDate(s);
      return d >= f && d <= t;
    });
  },

  // Get the local YYYY-MM-DD date of a sale record safely
  // Uses stored .date field (already localDateStr format)
  // Falls back to parsing createdOn in LOCAL timezone
  _saleDate(s){
    if(s.date && /^\d{4}-\d{2}-\d{2}/.test(s.date)){
      return s.date.slice(0,10);
    }
    // createdOn is ISO string — extract local date via localDateStr
    if(s.createdOn){
      return RP.localDateStr(new Date(s.createdOn));
    }
    return '';
  }
};