// ============================================================
// Rukmini Pharmacy — Shared Data & Utilities
// ============================================================

const RP = {
  SHEET_URL: 'https://script.google.com/macros/s/AKfycbyOlHuEAkk95tbQAtY0nCs_TQJ3F93jIx8arGEOaNLuITIubZqFg5ffsATnsoZsfqkgyg/exec', // Replace with actual Google Apps Script URL
  OWNER_EMAIL: 'saivenkatachala@gmail.com',

  // Medicine types
  MED_TYPES: ['Tablets','Injections','Syrups','Drops','Ointments','Lotions','Soaps','Creams','Powders','Capsules','Suppositories','Patches','Sprays','Gels','Suspensions','Others'],

  // Quantity types
  QTY_TYPES: ['Strips','Bottles','Boxes','Vials','Sachets','Tubes','Packets','Others'],

  // Low stock threshold
  LOW_STOCK: 5,

  // Expiry warning months
  EXPIRY_WARN_MONTHS: 3,

  /* ---------- localStorage helpers ---------- */
  getStock(){
    try{ return JSON.parse(localStorage.getItem('rp_stock')||'[]'); }
    catch{ return []; }
  },
  saveStock(arr){ localStorage.setItem('rp_stock', JSON.stringify(arr)); },

  getBills(){
    try{ return JSON.parse(localStorage.getItem('rp_bills')||'[]'); }
    catch{ return []; }
  },
  saveBills(arr){ localStorage.setItem('rp_bills', JSON.stringify(arr)); },

  getDismissedAlerts(){
    try{ return JSON.parse(localStorage.getItem('rp_dismissed_alerts')||'[]'); }
    catch{ return []; }
  },
  saveDismissedAlerts(arr){ localStorage.setItem('rp_dismissed_alerts', JSON.stringify(arr)); },

  /* ---------- Alert calculation ---------- */
  computeAlerts(){
    const stock = this.getStock();
    const dismissed = this.getDismissedAlerts();
    const alerts = [];
    const now = new Date();
    const warnDate = new Date();
    warnDate.setMonth(warnDate.getMonth() + this.EXPIRY_WARN_MONTHS);

    stock.forEach(item => {
      const qty = parseInt(item.quantity) || 0;
      // Low stock alert
      if(qty > 0 && qty <= this.LOW_STOCK){
        const id = `low_${item.id}`;
        if(!dismissed.includes(id)){
          alerts.push({id, type:'low', item, msg:`Low stock: ${item.name} (${qty} ${item.qtyType} left)`});
        }
      }
      // Zero stock alert
      if(qty === 0){
        const id = `zero_${item.id}`;
        if(!dismissed.includes(id)){
          alerts.push({id, type:'zero', item, msg:`Out of stock: ${item.name}`});
        }
      }
      // Expiry alert
      if(item.expiry){
        const exp = new Date(item.expiry);
        if(exp <= warnDate && exp >= now){
          const id = `exp_${item.id}`;
          if(!dismissed.includes(id)){
            const days = Math.ceil((exp - now)/(1000*60*60*24));
            alerts.push({id, type:'expiry', item, msg:`Expiring soon: ${item.name} (${days} days — ${item.expiry})`});
          }
        }
        if(exp < now){
          const id = `expired_${item.id}`;
          if(!dismissed.includes(id)){
            alerts.push({id, type:'expired', item, msg:`EXPIRED: ${item.name} (expired ${item.expiry})`});
          }
        }
      }
    });
    return alerts;
  },

  dismissAlert(id){
    const d = this.getDismissedAlerts();
    if(!d.includes(id)){ d.push(id); this.saveDismissedAlerts(d); }
  },

  /* ---------- Theme ---------- */
  getTheme(){ return localStorage.getItem('rp_theme')||'dark'; },
  setTheme(t){ localStorage.setItem('rp_theme',t); document.documentElement.setAttribute('data-theme',t); },
  applyTheme(){ document.documentElement.setAttribute('data-theme', this.getTheme()); },

  /* ---------- Guard ---------- */
  guard(){
    if(sessionStorage.getItem('rp_auth')!=='1'){
      window.location.href='index.html';
      return false;
    }
    return true;
  },

  /* ---------- ID Generator ---------- */
  uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); },

  /* ---------- Format date ---------- */
  fmtDate(d){ if(!d) return '—'; const dt=new Date(d); return dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); },

  /* ==========================================================
     POST TO GOOGLE SHEET — CORS FIX
     ----------------------------------------------------------
     ROOT CAUSE: Google Apps Script blocks preflight (OPTIONS)
     requests from browser origins (localhost, file://, etc.)
     because it does NOT send 'Access-Control-Allow-Origin' on
     preflight responses — only on actual GET/POST responses.

     FIX: Send data as a GET request with the payload encoded
     as a URL query parameter. GET requests never trigger a
     CORS preflight check. The Apps Script doGet() function
     reads the 'data' param and processes it identically.

     We use mode:'no-cors' so the browser does not block the
     opaque response. The request still reaches Google — we
     just cannot read the response body (which is fine).
  ========================================================== */
  async postToSheet(payload){
    // Skip if URL is not configured yet
    if(!this.SHEET_URL || this.SHEET_URL.includes('YOUR_DEPLOYMENT_ID')){
      console.info('[RP] Google Sheet URL not set — data saved locally only.');
      return;
    }
    try{
      // Encode entire payload as a single 'data' query param
      const encoded = encodeURIComponent(JSON.stringify(payload));
      const url = this.SHEET_URL + '?data=' + encoded;

      // fire-and-forget GET with no-cors (bypasses CORS preflight entirely)
      fetch(url, { method: 'GET', mode: 'no-cors' })
        .then(() => console.info('[RP] Sheet sync sent:', payload.action))
        .catch(err => console.warn('[RP] Sheet sync error:', err.message));
    } catch(e){
      console.warn('[RP] postToSheet failed:', e.message);
    }
  },

  /* ---------- Show toast ---------- */
  toast(msg, type='success'){
    const t=document.createElement('div');
    t.className=`rp-toast rp-toast--${type}`;
    t.textContent=msg;
    document.body.appendChild(t);
    setTimeout(()=>t.classList.add('show'),10);
    setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),400); },3500);
  }
};