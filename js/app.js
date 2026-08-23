/* app.js — SPA shell: hash routing + render functions for every module.
   All data reads/writes go through window.DB (IndexedDB, offline-first). */

const root = document.getElementById("app");
const state = { user: null, theme: localStorage.getItem("sm_theme") || "light" };
document.documentElement.setAttribute("data-theme", state.theme);

const fmt = (n) => "Rs " + Number(n || 0).toLocaleString("en-PK");
const todayKey = () => new Date().toISOString().slice(0, 10);
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// ---------- Routing ----------
const routes = {
  "": () => renderDashboard(),
  "dashboard": () => renderDashboard(),
  "pos": () => renderPOS(),
  "sales": () => renderSalesList(),
  "products": () => renderProducts(),
  "customers": () => renderCustomers(),
  "repairs": () => renderRepairs(),
  "installments": () => renderInstallments(),
  "suppliers": () => renderSuppliers(),
  "expenses": () => renderExpenses(),
  "reports": () => renderReports(),
  "settings": () => renderSettings(),
  "staff": () => renderStaff(),
  "purchase-orders": () => renderPurchaseOrders(),
  "cashbook": () => renderCashbook(),
  "audit-logs": () => renderAuditLogs(),
  "returns": () => renderReturns(),
};

function can(feature) {
  const role = state.user && state.user.role;
  if (role === "admin" || !role) return true;
  const managerAllowed = ["dashboard", "pos", "products", "customers", "installments", "repairs", "suppliers", "expenses", "reports", "returns", "settings", "purchase-orders", "cashbook"];
  const cashierAllowed = ["dashboard", "pos", "products", "customers", "installments", "reports", "returns", "settings"];
  const techAllowed = ["dashboard", "repairs", "settings"];
  if (role === "manager") return managerAllowed.includes(feature);
  if (role === "cashier") return cashierAllowed.includes(feature);
  if (role === "technician") return techAllowed.includes(feature);
  return true;
}

// Simple i18n
const i18n = {
  en: {
    dashboard: "Dashboard", sales: "Sales", products: "Products", reports: "Reports", settings: "Settings",
    pos: "POS / Billing", checkout: "Checkout", cartEmpty: "Cart is empty"
  },
  ur: {
    dashboard: "ڈیش بورڈ", sales: "فروخت", products: "پروڈکٹس", reports: "رپورٹس", settings: "ترتیبات",
    pos: "بلنگ", checkout: "چیک آؤٹ", cartEmpty: "کارٹ خالی ہے"
  }
};
function t(key) {
  const lang = localStorage.getItem("sm_lang") || "en";
  return (i18n[lang] && i18n[lang][key]) || (i18n.en[key] || key);
}

async function router() {
  if (!state.user) { renderLogin(); return; }
  const hash = location.hash.replace("#/", "").split("?")[0];
  if (!can(hash)) { location.hash = "#/dashboard"; return; }
  const fn = routes[hash] || renderDashboard;
  root.innerHTML = `<div id="page-slot"></div>`;
  await fn();
}
window.addEventListener("hashchange", router);

// ---------- Login ----------
// Firebase Auth only — no demo user. Offline: restored session works after first online login.
function renderLogin() {
  const fbReady = window.SMSync && window.SMSync.isConfigured();
  root.innerHTML = `
  <div class="login-screen">
    <img src="icons/icon-512.png" class="login-logo" alt="logo" onerror="this.style.display='none'" />
    <div class="login-title">SANAULLAH</div>
    <div class="login-sub">MOBILE COMMUNICATION</div>
    <div class="field"><input id="li-user" type="email" placeholder="Email" autocomplete="username" /></div>
    <div class="field"><input id="li-pass" type="password" placeholder="Password" autocomplete="current-password" /></div>
    <div id="li-error" style="color:#f87171;font-size:12px;margin:-4px 0 10px;display:none"></div>
    <button class="btn-primary" id="li-btn">LOGIN</button>
    <div style="color:var(--muted);font-size:12px;margin-top:14px">${fbReady ? (navigator.onLine ? "🟢 Online · Firebase Auth" : "🟠 Offline · pehle se login session chalega") : "⚠️ Firebase config missing"}</div>
    <div style="color:var(--muted);font-size:10px;margin-top:18px">Software by Fazal Khan Chandio · 03333909816</div>
  </div>`;
  document.getElementById("li-btn").onclick = doLogin;
  document.getElementById("li-pass").onkeydown = (e) => { if (e.key === "Enter") doLogin(); };
}

async function doLogin() {
  const u = document.getElementById("li-user").value.trim();
  const p = document.getElementById("li-pass").value.trim();
  const err = document.getElementById("li-error");
  err.style.display = "none";

  if (!u || !p) {
    err.textContent = "Email aur password likho.";
    err.style.display = "block";
    return;
  }
  if (!u.includes("@")) {
    err.textContent = "Valid email address use karo.";
    err.style.display = "block";
    return;
  }
  if (!window.SMSync || !window.SMSync.isConfigured()) {
    err.textContent = "Firebase configured nahi hai.";
    err.style.display = "block";
    return;
  }
  if (!window.SMSync.isReady()) {
    // wait briefly for SDK init
    await new Promise((r) => setTimeout(r, 800));
  }
  if (!window.SMSync.isReady()) {
    err.textContent = "Firebase ready nahi. Internet check karo.";
    err.style.display = "block";
    return;
  }

  try {
    const user = await SMSync.signIn(u, p);
    state.user = {
      name: user.displayName || u.split("@")[0],
      role: "admin",
      email: u,
      firebase: true,
      uid: user.uid
    };
    await DB.put("settings", { id: "session", user: state.user });
    await logAudit("login", state.user.name + " logged in");
    try {
      await SMSync.clearPending();
      await SMSync.pullAll();
    } catch (e) { console.warn(e); }
    location.hash = "#/dashboard";
    router();
  } catch (e) {
    const code = e.code || "";
    let msg = e.message || "Login failed";
    if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential") {
      msg = "Email ya password ghalat hai.";
    } else if (code === "auth/network-request-failed" || !navigator.onLine) {
      msg = "Internet nahi. Offline me sirf pehle wala session chalega.";
    } else if (code === "auth/too-many-requests") {
      msg = "Bohat attempts. Thodi der baad try karo.";
    } else if (code === "auth/invalid-email") {
      msg = "Email format ghalat hai.";
    }
    err.textContent = msg;
    err.style.display = "block";
  }
}

async function logAudit(action, detail) {
  await DB.put("auditLogs", { action, detail, by: state.user ? state.user.name : "system", ts: new Date().toISOString() });
}

async function tryRestoreSession() {
  // 1) Local session (works offline after first login)
  const s = await DB.get("settings", "session");
  if (s && s.user) state.user = s.user;

  // 2) If Firebase Auth still has a user (persisted), prefer that
  if (window.SMSync && window.SMSync.isReady()) {
    const fu = SMSync.currentUser();
    if (fu) {
      state.user = {
        name: fu.displayName || (fu.email || "").split("@")[0] || "User",
        role: (state.user && state.user.role) || "admin",
        email: fu.email,
        firebase: true,
        uid: fu.uid
      };
      await DB.put("settings", { id: "session", user: state.user });
    }
  }
}

// ---------- Shell (topbar + bottomnav) wrapper ----------
function shell(activeTab, innerHtml) {
  const pending = window._pendingCount || 0;
  return `
  <div class="topbar">
    <div>
      <div class="greet">Assalamualaikum, ${escapeHtml(state.user.name)} 👋</div>
      <h1>Sanaullah Mobile Communication</h1>
    </div>
    <div style="display:flex;gap:8px">
      <button class="icon-btn" onclick="location.hash='#/settings'">⚙️</button>
    </div>
  </div>
  <div class="sync-status">${navigator.onLine ? "🟢 Online" : "🟠 Offline"} ${pending ? "· " + pending + " pending sync" : "· synced"} · ${escapeHtml(state.user.role || "admin")}</div>
  ${innerHtml}
  <div class="bottomnav">
    ${can("dashboard") ? navBtn("dashboard", "🏠", "Dashboard", activeTab) : ""}
    ${can("pos") ? navBtn("pos", "🛒", "Sales", activeTab) : ""}
    ${can("products") ? navBtn("products", "📦", "Products", activeTab) : ""}
    ${can("repairs") && state.user.role === "technician" ? navBtn("repairs", "🔧", "Repairs", activeTab) : ""}
    ${can("reports") ? navBtn("reports", "📊", "Reports", activeTab) : ""}
    ${navBtn("settings", "⚙️", "Settings", activeTab)}
  </div>`;
}
function navBtn(route, icon, label, active) {
  return `<button class="nav-item ${active === route ? "active" : ""}" onclick="location.hash='#/${route}'">
    <span>${icon}</span><span>${label}</span></button>`;
}

// ---------- Dashboard ----------
async function renderDashboard() {
  const [sales, repairs, installments, products, returnsList] = await Promise.all([
    DB.getAll("sales"), DB.getAll("repairs"), DB.getAll("installments"),
    DB.getAll("products"), DB.getAll("returns")
  ]);
  const today = todayKey();
  const todaySales = sales.filter((s) => (s.date || "").slice(0, 10) === today);
  const todayTotal = todaySales.reduce((a, s) => a + Number(s.total || 0), 0);
  const todayProfit = todaySales.reduce((a, s) => a + Number(s.profit || 0), 0);
  const outStock = products.filter((p) => Number(p.qty) <= 0);
  const lowStock = products.filter((p) => {
    const q = Number(p.qty);
    const rl = Number(p.reorderLevel || 5);
    return q > 0 && q <= rl;
  });
  const stockAlert = outStock.length + lowStock.length;
  const dueInstallments = installments.filter((i) => i.status !== "paid");
  const dueTotal = dueInstallments.reduce((a, i) => a + Number(i.remaining || 0), 0);
  const openRepairs = repairs.filter((r) => r.status !== "delivered");
  const recent = [...sales].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 6);

  const html = `
  <div class="stat-grid">
    <div class="stat-card stat-blue stat-tap" onclick="location.hash='#/sales'">
      <div class="label">Today's Sales</div>
      <div class="value">${fmt(todayTotal)}</div>
      <div class="delta">${todaySales.length} invoices · tap to open</div>
    </div>
    <div class="stat-card stat-green stat-tap" onclick="location.hash='#/reports'">
      <div class="label">Today's Profit</div>
      <div class="value">${fmt(todayProfit)}</div>
      <div class="delta">Reports · tap</div>
    </div>
    <div class="stat-card stat-purple stat-tap" onclick="location.hash='#/products'">
      <div class="label">Products</div>
      <div class="value">${products.length}</div>
      <div class="delta">Stock list · tap</div>
    </div>
    <div class="stat-card stat-orange stat-tap" onclick="location.hash='#/products'">
      <div class="label">Stock Alert</div>
      <div class="value">${stockAlert}</div>
      <div class="delta">${outStock.length} out · ${lowStock.length} low · tap</div>
    </div>
  </div>

  <div class="dash-pills">
    <button class="dash-pill" onclick="location.hash='#/installments'">📅 Due ${fmt(dueTotal)} · ${dueInstallments.length}</button>
    <button class="dash-pill" onclick="location.hash='#/repairs'">🔧 Repairs ${openRepairs.length}</button>
    <button class="dash-pill" onclick="location.hash='#/returns'">↩️ Returns ${returnsList.length}</button>
  </div>

  <div class="section-title">Quick Actions</div>
  <div class="qa-grid qa-modern">
    ${qa("pos", "🛒", "POS", "var(--blue)")}
    ${qa("sales", "🧾", "Invoices", "#0ea5e9")}
    ${qa("products", "📦", "Products", "var(--purple)")}
    ${qa("customers", "👥", "Customers", "#8b5cf6")}
    ${qa("repairs", "🔧", "Repairs", "var(--orange)")}
    ${qa("installments", "📅", "Installments", "#06b6d4")}
    ${qa("returns", "↩️", "Returns", "#f59e0b")}
    ${qa("suppliers", "🚚", "Suppliers", "var(--red)")}
    ${qa("expenses", "💰", "Expenses", "#10b981")}
    ${qa("reports", "📈", "Reports", "#6366f1")}
    ${qa("settings", "⚙️", "Settings", "var(--muted)")}
  </div>

  <div class="section-title" style="display:flex;justify-content:space-between;align-items:center">
    <span>Recent Invoices</span>
    <a href="#/sales" style="color:var(--blue);font-size:12px;font-weight:600">View All →</a>
  </div>
  ${recent.length ? recent.map((s) => `
    <div class="list-row dash-sale-row">
      <div class="l-left" style="flex:1;cursor:pointer" onclick='reprintInvoice("${s.id}")'>
        <div class="dot" style="background:linear-gradient(135deg,#2563eb,#7c3aed)">🧾</div>
        <div>
          <div class="l-title">#${escapeHtml(s.invoiceNo || s.id)}</div>
          <div class="l-sub">${escapeHtml(s.customerName || "Walk-in")} · ${(s.date || "").slice(0, 16).replace("T", " ")}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div class="l-title">${fmt(s.total)}</div>
        <button class="btn ghost" style="padding:4px 10px;margin-top:4px;font-size:11px" onclick='event.stopPropagation();reprintInvoice("${s.id}")'>🖨️</button>
      </div>
    </div>`).join("")
    : `<div class="empty">No sales yet. Tap <b>POS</b> to create first invoice.</div>`}
  `;
  root.innerHTML = shell("dashboard", html);
}
function qa(route, icon, label, color) {
  const bg = color || "var(--blue)";
  return `<button class="qa-item qa-modern-item" onclick="location.hash='#/${route}'">
    <div class="qi" style="background:${bg}">${icon}</div>
    <span>${label}</span>
  </button>`;
}

// ---------- POS / Billing ----------
let cart = [];

// ---------- Sales list + duplicate invoice print ----------
async function renderSalesList() {
  const sales = (await DB.getAll("sales")).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const html = `
  <div class="page">
    <h2>All Sales / Invoices</h2>
    <div class="search-bar">
      <input id="sales-search" placeholder="Search invoice, customer…" />
    </div>
    <div id="sales-list">
      ${sales.length ? sales.map(salesRow).join("") : `<div class="empty">No sales yet.</div>`}
    </div>
  </div>`;
  root.innerHTML = shell("pos", html);
  document.getElementById("sales-search").oninput = (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = sales.filter((s) => JSON.stringify(s).toLowerCase().includes(q));
    document.getElementById("sales-list").innerHTML = filtered.length
      ? filtered.map(salesRow).join("")
      : `<div class="empty">No matches</div>`;
  };
}
function salesRow(s) {
  return `<div class="list-row">
    <div class="l-left" style="flex:1">
      <div class="dot" style="background:var(--blue)">🧾</div>
      <div>
        <div class="l-title">#${escapeHtml(s.invoiceNo || s.id)}</div>
        <div class="l-sub">${escapeHtml(s.customerName || "Walk-in")} · ${(s.date || "").slice(0, 16).replace("T", " ")}</div>
      </div>
    </div>
    <div style="text-align:right">
      <div class="l-title">${fmt(s.total)}</div>
      <button class="btn ghost" style="padding:4px 10px;margin-top:4px;font-size:11px" onclick='reprintInvoice("${s.id}")'>🖨️ Duplicate</button>
    </div>
  </div>`;
}
window.reprintInvoice = async (id) => {
  const sale = await DB.get("sales", id);
  if (!sale) { toast("Invoice not found"); return; }
  showInvoice({ ...sale, _duplicate: true }, { duplicate: true });
};

async function renderPOS() {
  const products = await DB.getAll("products");
  const customers = await DB.getAll("customers");
  const html = `
  <div class="page">
    <h2>POS / Billing</h2>
    <div class="card">
      <div class="form-row"><label>Saved Customer (optional)</label>
        <select id="pos-cust">
          <option value="">— Select to auto-fill —</option>
          ${customers.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.phone ? " (" + escapeHtml(c.phone) + ")" : ""}</option>`).join("")}
        </select></div>
      <div class="form-row"><label>Customer Name *</label>
        <input id="pos-cust-name" type="text" placeholder="Name type karo…" autocomplete="off" /></div>
      <div class="form-row"><label>Phone</label>
        <input id="pos-cust-phone" type="tel" placeholder="03xx…" autocomplete="off" /></div>
      <div class="form-row"><label>Add Product</label>
        <div style="display:flex;gap:8px">
          <select id="pos-product" style="flex:1">
            <option value="">Select product…</option>
            ${products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} — ${fmt(p.salePrice)} (Stock: ${p.qty})</option>`).join("")}
          </select>
          <button class="icon-btn" id="pos-scan" title="Scan barcode">📷</button>
        </div></div>
    </div>
    <div class="card" id="pos-cart"></div>
    <div class="card">
      <div class="form-row"><label>Discount (Rs)</label><input id="pos-discount" type="number" value="0" /></div>
      <div class="form-row"><label>Payment Method</label>
        <select id="pos-payment"><option>Cash</option><option>Card</option><option>Bank Transfer</option><option>Installment</option></select></div>
    </div>
    <button class="btn full" id="pos-checkout" style="margin-bottom:20px">Checkout</button>
  </div>`;
  root.innerHTML = shell("pos", html);
  renderCart();

  // Select only auto-fills name/phone — user can still edit freely
  document.getElementById("pos-cust").onchange = () => {
    const id = document.getElementById("pos-cust").value;
    const c = customers.find((x) => x.id === id);
    if (c) {
      document.getElementById("pos-cust-name").value = c.name || "";
      document.getElementById("pos-cust-phone").value = c.phone || "";
    }
  };

  const addProductById = (id) => {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const existing = cart.find((c) => c.id === id);
    if (existing) existing.qty += 1;
    else cart.push({ id: p.id, name: p.name, price: Number(p.salePrice), cost: Number(p.costPrice || 0), qty: 1 });
    renderCart();
    toast(p.name + " added");
  };

  document.getElementById("pos-product").onchange = () => {
    const id = document.getElementById("pos-product").value;
    if (!id) return;
    addProductById(id);
    document.getElementById("pos-product").value = "";
  };

  document.getElementById("pos-checkout").onclick = () => checkout(products, customers);
  document.getElementById("pos-scan").onclick = () => openBarcodeScanner((code) => {
    const match = products.find((p) => p.imei === code || p.id === code || (p.name && p.name.toLowerCase() === code.toLowerCase()));
    if (match) addProductById(match.id);
    else toast("No product found for that code");
  });
}
function renderCart() {
  const el = document.getElementById("pos-cart");
  if (!el) return;
  if (!cart.length) { el.innerHTML = `<div class="empty">Cart is empty</div>`; return; }
  const total = cart.reduce((a, c) => a + c.price * c.qty, 0);
  el.innerHTML = cart.map((c, i) => `
    <div class="list-row" style="padding:8px 0">
      <div class="l-left"><div><div class="l-title">${escapeHtml(c.name)}</div><div class="l-sub">${fmt(c.price)} × ${c.qty}</div></div></div>
      <div style="display:flex;align-items:center;gap:8px">
        <button type="button" class="btn ghost" style="padding:4px 10px" onclick="cartQty(${i},-1)">−</button>
        <button type="button" class="btn ghost" style="padding:4px 10px" onclick="cartQty(${i},1)">+</button>
      </div>
    </div>`).join("") + `<div style="text-align:right;font-weight:700;margin-top:8px">Total: ${fmt(total)}</div>`;
}
window.cartQty = (i, d) => { cart[i].qty += d; if (cart[i].qty <= 0) cart.splice(i, 1); renderCart(); };

async function checkout(products, customers) {
  if (!cart.length) { toast("Cart is empty"); return; }
  const custId = document.getElementById("pos-cust").value;
  const cust = customers.find((c) => c.id === custId);
  const manualName = (document.getElementById("pos-cust-name")?.value || "").trim();
  const manualPhone = (document.getElementById("pos-cust-phone")?.value || "").trim();
  const discount = Number(document.getElementById("pos-discount").value || 0);
  const payment = document.getElementById("pos-payment").value;
  const subtotal = cart.reduce((a, c) => a + c.price * c.qty, 0);
  const total = Math.max(0, subtotal - discount);
  const profit = cart.reduce((a, c) => a + (c.price - c.cost) * c.qty, 0) - discount;
  const invoiceNo = "INV-" + (10000 + (await DB.getAll("sales")).length + 1);
  const customerName = manualName || (cust ? cust.name : "Walk-in Customer");
  const customerPhone = manualPhone || (cust ? (cust.phone || "") : "");
  const sale = { invoiceNo, customerId: custId || null, customerName, customerPhone,
    items: cart.map((c) => ({ id: c.id, name: c.name, price: c.price, cost: c.cost, qty: c.qty })),
    subtotal, discount, total, profit, payment, date: new Date().toISOString() };
  await DB.put("sales", sale);
  for (const item of cart) {
    const p = products.find((x) => x.id === item.id);
    if (p) {
      p.qty = Math.max(0, Number(p.qty) - item.qty);
      if (p.imei && p.qty === 0) p.soldInvoice = invoiceNo;
      await DB.put("products", p);
    }
  }
  if (cust) {
    cust.points = Number(cust.points || 0) + Math.floor(total / 1000); // 1 loyalty point per Rs 1000 spent
    await DB.put("customers", cust);
  }
  await logAudit("sale", `Invoice ${invoiceNo} created for ${sale.customerName} — ${fmt(total)}`);
  cart = [];
  toast("Invoice " + invoiceNo + " created");
  showInvoice(sale);
}

function showInvoice(sale, opts = {}) {
  const isDup = !!opts.duplicate;
  const overlay = document.createElement("div");
  overlay.id = "invoice-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px";
  const itemsHtml = (sale.items || []).map((i) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0">
    <span>${escapeHtml(i.name)} x${i.qty}</span><span>${fmt(i.price * i.qty)}</span></div>`).join("");
  const waText = encodeURIComponent(
    `Sanaullah Mobile Communication\nInvoice #${sale.invoiceNo}\nCustomer: ${sale.customerName}\n\n` +
    sale.items.map((i) => `${i.name} x${i.qty} = ${fmt(i.price * i.qty)}`).join("\n") +
    `\n\nDiscount: ${fmt(sale.discount)}\nTotal: ${fmt(sale.total)}\nPayment: ${sale.payment}\nThank you for your business!`
  );
  const qrPayload = `SM|${sale.invoiceNo}|${sale.customerName}|${sale.total}|${sale.date}`;
  overlay.innerHTML = `<div id="invoice-print-area">
  <div id="invoice-box" class="receipt-80mm">
    <div style="text-align:center;font-weight:800;font-size:15px">SANAULLAH MOBILE COMMUNICATION</div>
    <div style="text-align:center;font-size:10px;margin-bottom:6px">Sales · Accessories · Repairs · Service</div>
    ${isDup ? '<div style="text-align:center;font-weight:800;font-size:12px;margin:4px 0">*** DUPLICATE COPY ***</div>' : ''}
    <div class="rline"></div>
    <div style="font-size:11px">Invoice #${sale.invoiceNo}<br/>Customer: ${escapeHtml(sale.customerName)}${sale.customerPhone ? " (" + escapeHtml(sale.customerPhone) + ")" : ""}<br/>Date: ${new Date(sale.date).toLocaleString()}</div>
    <div class="rline"></div>
    ${itemsHtml}
    <div class="rline"></div>
    <div style="display:flex;justify-content:space-between;font-size:12px"><span>Subtotal</span><span>${fmt(sale.subtotal)}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:12px"><span>Discount</span><span>-${fmt(sale.discount)}</span></div>
    <div style="display:flex;justify-content:space-between;font-weight:800;font-size:14px;margin-top:2px"><span>TOTAL</span><span>${fmt(sale.total)}</span></div>
    <div style="font-size:11px;margin-top:2px">Payment: ${sale.payment}</div>
    <div class="rline"></div>
    <div id="qr-code" style="display:flex;justify-content:center;margin:8px 0"></div>
    <div style="text-align:center;font-size:11px">Thank you for your business!</div>
    <div style="text-align:center;font-size:9px;margin-top:8px;color:#555">Software by Fazal Khan Chandio · 03333909816</div>
  </div>
  </div>
  <div class="no-print" style="position:fixed;bottom:24px;left:0;right:0;display:flex;gap:10px;justify-content:center;padding:0 20px;flex-wrap:wrap">
    <button class="btn" id="thermal-print-btn">🖨️ Thermal Print</button>
    ${sale.customerPhone ? `<a class="btn" style="background:#25D366;text-decoration:none" target="_blank" href="https://wa.me/${sale.customerPhone.replace(/\D/g, "")}?text=${waText}">WhatsApp</a>` : ""}
    <button class="btn ghost" id="invoice-close">Close</button>
  </div>`;
  document.body.appendChild(overlay);
  if (typeof QRCode !== "undefined") {
    new QRCode(document.getElementById("qr-code"), { text: qrPayload, width: 90, height: 90, correctLevel: QRCode.CorrectLevel.M });
  }
  document.getElementById("thermal-print-btn").onclick = async () => {
    try {
      await printSaleThermal({ ...sale, _duplicate: isDup || sale._duplicate });
    } catch (e) {
      console.error(e);
      toast(e.message || "Print failed");
    }
  };
  document.getElementById("invoice-close").onclick = () => { overlay.remove(); location.hash = "#/dashboard"; };
}

/** ESC/POS thermal print for POS invoice (Bluetooth / USB) */
async function printSaleThermal(sale) {
  if (typeof ThermalPrinter === "undefined") {
    toast("Printer library missing");
    return;
  }
  const printer = window.shopPrinter || new ThermalPrinter({ paperWidth: 80, chunkSize: 48, chunkDelay: 40, feedBeforeCut: 1, usePartialCut: true });
  window.shopPrinter = printer;

  if (!printer.isConnected) {
    toast("Printer connect karo…");
    const name = await printer.connect();
    toast("Connected: " + name);
  }

  printer.setSettings({ paperWidth: 80 }); // shop receipts usually 80mm
  const w = printer.charsPerLine;
  const line = "-".repeat(Math.min(w, 42));
  const thick = "=".repeat(Math.min(w, 42));

  await printer.init();
  await printer.printText("SANAULLAH MOBILE", { align: "center", bold: true });
  await printer.printText("COMMUNICATION", { align: "center", bold: true });
  await printer.printText("Sales · Accessories · Repairs", { align: "center" });
  if (sale._duplicate) await printer.printText("*** DUPLICATE COPY ***", { align: "center", bold: true });
  await printer.printText(line, { align: "center" });
  await printer.printText("Invoice #" + (sale.invoiceNo || ""));
  await printer.printText("Customer: " + (sale.customerName || "Walk-in"));
  if (sale.customerPhone) await printer.printText("Phone: " + sale.customerPhone);
  await printer.printText("Date: " + new Date(sale.date).toLocaleString());
  await printer.printText(line, { align: "center" });

  for (const item of (sale.items || [])) {
    const name = String(item.name || "").slice(0, w - 10);
    const amt = "Rs " + Number(item.price * item.qty).toLocaleString("en-PK");
    await printer.printText(name + " x" + item.qty);
    await printer.printText(amt, { align: "right" });
  }

  await printer.printText(line, { align: "center" });
  await printer.printText("Subtotal: Rs " + Number(sale.subtotal || 0).toLocaleString("en-PK"));
  if (sale.discount) await printer.printText("Discount: -Rs " + Number(sale.discount).toLocaleString("en-PK"));
  await printer.printText(thick, { align: "center" });
  await printer.printText("TOTAL: Rs " + Number(sale.total || 0).toLocaleString("en-PK"), { bold: true });
  await printer.printText("Payment: " + (sale.payment || "Cash"));
  await printer.printText(line, { align: "center" });
  await printer.printText("Thank you for your business!", { align: "center" });
  await printer.printSmall("Software by Fazal Khan Chandio", { align: "center" });
  await printer.printSmall("03333909816", { align: "center" });
  await printer.feed(printer.feedBeforeCut || 1);
  await printer.doCut();
  toast("Printed");
}


// ---------- Generic list-page builder for simple CRUD modules ----------
function moduleListPage(opts) {
  // opts: {title, store, activeTab, fields[], renderRow(item), emptyText}
  return async function render() {
    const items = (await DB.getAll(opts.store)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const html = `
    <div class="page">
      <h2>${opts.title}</h2>
      <div class="search-bar">
        <input id="mod-search" placeholder="Search ${opts.title.toLowerCase()}…" />
        <button class="icon-btn" id="mod-voice" title="Voice search">🎤</button>
        ${opts.store === "products" ? `<button class="icon-btn" id="mod-scan" title="Scan barcode">📷</button>` : ""}
      </div>
      <div id="mod-list">${items.length ? items.map(opts.renderRow).join("") : `<div class="empty">${opts.emptyText}</div>`}</div>
    </div>
    <button class="fab" id="mod-add">+</button>`;
    root.innerHTML = shell(opts.activeTab, html);
    document.getElementById("mod-add").onclick = () => openForm(opts, null);
    const doFilter = (q) => {
      q = q.toLowerCase();
      const filtered = items.filter((it) => JSON.stringify(it).toLowerCase().includes(q));
      document.getElementById("mod-list").innerHTML = filtered.length ? filtered.map(opts.renderRow).join("") : `<div class="empty">No matches</div>`;
    };
    document.getElementById("mod-search").oninput = (e) => doFilter(e.target.value);
    document.getElementById("mod-voice").onclick = () => voiceSearch((text) => { document.getElementById("mod-search").value = text; doFilter(text); });
    const scanBtn = document.getElementById("mod-scan");
    if (scanBtn) scanBtn.onclick = () => openBarcodeScanner((code) => {
      document.getElementById("mod-search").value = code;
      doFilter(code);
    });
  };
}

// ---------- Voice search (Web Speech API — no external lib needed) ----------
function voiceSearch(onResult) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("Voice search not supported on this browser"); return; }
  const rec = new SR();
  rec.lang = "en-US";
  rec.onresult = (e) => onResult(e.results[0][0].transcript);
  rec.onerror = () => toast("Couldn't hear that, try again");
  rec.start();
  toast("Listening…");
}

// ---------- Barcode/QR camera scanner (html5-qrcode, loaded via CDN) ----------
function openBarcodeScanner(onResult) {
  if (typeof Html5Qrcode === "undefined") { toast("Scanner library not loaded — check your internet connection"); return; }
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:#000;z-index:1000;display:flex;flex-direction:column";
  overlay.innerHTML = `<div style="padding:14px;color:#fff;display:flex;justify-content:space-between;align-items:center">
    <b>Scan Barcode / QR</b><button class="icon-btn" id="scan-close">✕</button></div>
    <div id="scan-region" style="flex:1"></div>`;
  document.body.appendChild(overlay);
  const scanner = new Html5Qrcode("scan-region");
  scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 },
    (decodedText) => {
      scanner.stop().then(() => overlay.remove());
      onResult(decodedText);
    },
    () => {}
  ).catch(() => { toast("Camera unavailable"); overlay.remove(); });
  overlay.querySelector("#scan-close").onclick = () => { scanner.stop().catch(() => {}); overlay.remove(); };
}

// ---------- Barcode label printing (JsBarcode, loaded via CDN) ----------
function printBarcodeLabel(product) {
  if (typeof JsBarcode === "undefined") { toast("Barcode library not loaded — check your internet connection"); return; }
  const w = window.open("", "_blank");
  w.document.write(`<html><body style="text-align:center;font-family:sans-serif">
    <div>${escapeHtml(product.name)}</div><svg id="bc"></svg><div>${fmt(product.salePrice)}</div>
    <div style="font-size:9px;color:#777;margin-top:6px">Software by Fazal Khan Chandio · 03333909816</div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"><\/script>
    <script>JsBarcode("#bc","${(product.imei || product.id)}",{width:2,height:60}); window.print();<\/script>
    </body></html>`);
  w.document.close();
}
window.printBarcodeLabel = printBarcodeLabel;

function openForm(opts, existing) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:flex-end";
  overlay.innerHTML = `<div style="background:var(--card);width:100%;max-width:480px;margin:0 auto;border-radius:18px 18px 0 0;padding:18px;max-height:85vh;overflow:auto">
    <h2 style="margin-top:0">${existing ? "Edit" : "Add"} ${opts.title.replace(/s$/, "")}</h2>
    <div id="form-fields"></div>
    <button class="btn full" id="form-save">Save</button>
    <button class="btn ghost full" id="form-cancel" style="margin-top:8px">Cancel</button>
    ${existing ? `<button class="btn danger full" id="form-del" style="margin-top:8px">Delete</button>` : ""}
  </div>`;
  document.body.appendChild(overlay);
  const fc = overlay.querySelector("#form-fields");
  fc.innerHTML = opts.fields.map((f) => `
    <div class="form-row"><label>${f.label}</label>
    ${f.type === "select"
      ? `<select id="f-${f.key}">${f.options.map((o) => `<option value="${o.value}" ${existing && existing[f.key] === o.value ? "selected" : ""}>${o.label}</option>`).join("")}</select>`
      : `<input id="f-${f.key}" type="${f.type || "text"}" value="${escapeHtml(existing ? existing[f.key] ?? "" : f.default ?? "")}" />`}
    </div>`).join("");
  if (opts.store === "products") {
    const imeiInput = overlay.querySelector("#f-imei");
    if (imeiInput) {
      const scanBtn = document.createElement("button");
      scanBtn.className = "btn ghost full"; scanBtn.style.marginBottom = "10px"; scanBtn.textContent = "📷 Scan IMEI/Barcode";
      scanBtn.onclick = () => openBarcodeScanner((code) => { imeiInput.value = code; });
      imeiInput.after(scanBtn);
    }
  }
  // Returns: invoice # → auto-fill customer, item, amount
  if (opts.store === "returns") {
    const invInput = overlay.querySelector("#f-invoiceNo");
    if (invInput) {
      const hint = document.createElement("div");
      hint.style.cssText = "font-size:11px;color:var(--muted);margin:-6px 0 10px";
      hint.textContent = "Invoice # likho / paste karo — details auto fill";
      invInput.parentElement.after(hint);
      const fillFromInvoice = async () => {
        const q = (invInput.value || "").trim().toLowerCase();
        if (!q) return;
        const sales = await DB.getAll("sales");
        const sale = sales.find((s) =>
          String(s.invoiceNo || "").toLowerCase() === q ||
          String(s.id || "").toLowerCase() === q ||
          String(s.invoiceNo || "").toLowerCase().includes(q)
        );
        if (!sale) { toast("Invoice nahi mili"); return; }
        const nameEl = overlay.querySelector("#f-customerName");
        const itemEl = overlay.querySelector("#f-item");
        const amtEl = overlay.querySelector("#f-amount");
        const dateEl = overlay.querySelector("#f-date");
        if (nameEl) nameEl.value = sale.customerName || "";
        if (amtEl) amtEl.value = sale.total || 0;
        if (dateEl && !dateEl.value) dateEl.value = todayKey();
        if (itemEl) {
          const names = (sale.items || []).map((i) => i.name + " x" + i.qty).join(", ");
          itemEl.value = names || itemEl.value;
        }
        invInput.value = sale.invoiceNo || invInput.value;
        toast("Invoice loaded: " + (sale.invoiceNo || ""));
      };
      invInput.addEventListener("blur", fillFromInvoice);
      invInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fillFromInvoice(); } });
    }
  }
  overlay.querySelector("#form-cancel").onclick = () => overlay.remove();
  overlay.querySelector("#form-save").onclick = async () => {
    const record = existing ? { ...existing } : {};
    opts.fields.forEach((f) => {
      const v = overlay.querySelector("#f-" + f.key).value;
      record[f.key] = f.type === "number" ? Number(v || 0) : v;
    });
    if (opts.beforeSave) opts.beforeSave(record);
    // IMEI unique check for products
    if (opts.store === "products" && record.imei) {
      const all = await DB.getAll("products");
      const dup = all.find((p) => p.imei && p.imei === record.imei && p.id !== record.id);
      if (dup) { toast("IMEI already used: " + dup.name); return; }
    }
    // Returns: restore stock once (new records only)
    if (opts.store === "returns" && !existing) {
      await restoreStockFromReturn(record);
      record.stockRestored = true;
    }
    await DB.put(opts.store, record);
    await logAudit(existing ? "update" : "create", `${existing ? "Updated" : "Created"} ${opts.title.replace(/s$/, "")}: ${record.name || record.title || record.customerName || record.supplierName || record.id}`);
    overlay.remove();
    toast("Saved");
    router();
  };
  if (existing) {
    overlay.querySelector("#form-del").onclick = async () => {
      await DB.remove(opts.store, existing.id);
      await logAudit("delete", `Deleted ${opts.title.replace(/s$/, "")}: ${existing.name || existing.title || existing.customerName || existing.supplierName || existing.id}`);
      overlay.remove();
      toast("Deleted");
      router();
    };
  }
}
window.editItem = async (store, id, opts) => {
  const item = await DB.get(store, id);
  openForm(opts, item);
};

// ---------- Products ----------
const productsOpts = {
  title: "Products", store: "products", activeTab: "products",
  emptyText: "No products yet. Tap + to add your first item.",
  fields: [
    { key: "name", label: "Product Name" },
    { key: "category", label: "Category", type: "select", options: [
      { value: "Mobile", label: "Mobile" }, { value: "Accessory", label: "Accessory" }, { value: "Part", label: "Spare Part" }
    ] },
    { key: "imei", label: "IMEI / Serial (optional)" },
    { key: "costPrice", label: "Cost Price", type: "number" },
    { key: "salePrice", label: "Sale Price", type: "number" },
    { key: "qty", label: "Stock Quantity", type: "number" },
    { key: "reorderLevel", label: "Low Stock Alert Level", type: "number", default: 5 },
  ],
  renderRow: (p) => `<div class="list-row" onclick='editItem("products","${p.id}", productsOpts)'>
    <div class="l-left"><div class="dot" style="background:${Number(p.qty) <= 0 ? "var(--red)" : Number(p.qty) <= Number(p.reorderLevel || 5) ? "var(--orange)" : "var(--blue)"}">📦</div>
      <div><div class="l-title">${escapeHtml(p.name)}</div><div class="l-sub">${escapeHtml(p.category || "")} · Stock: ${p.qty}</div></div></div>
    <div style="text-align:right;display:flex;align-items:center;gap:8px">
      <button class="icon-btn" style="width:30px;height:30px" onclick='event.stopPropagation();printBarcodeLabel(${JSON.stringify(p).replace(/'/g, "&#39;")})'>🏷️</button>
      <div><div class="l-title">${fmt(p.salePrice)}</div>${Number(p.qty) <= 0 ? `<span class="pill bad">Out</span>` : Number(p.qty) <= Number(p.reorderLevel || 5) ? `<span class="pill warn">Low</span>` : `<span class="pill ok">OK</span>`}</div>
    </div></div>`
};
window.productsOpts = productsOpts;
const renderProducts = moduleListPage(productsOpts);

// ---------- Customers ----------
const customersOpts = {
  title: "Customers", store: "customers", activeTab: "customers",
  emptyText: "No customers yet.",
  fields: [
    { key: "name", label: "Full Name" },
    { key: "phone", label: "Phone" },
    { key: "address", label: "Address" },
    { key: "notes", label: "Notes" },
  ],
  renderRow: (c) => `<div class="list-row" onclick='editItem("customers","${c.id}", customersOpts)'>
    <div class="l-left"><div class="dot" style="background:var(--purple)">👤</div>
      <div><div class="l-title">${escapeHtml(c.name)}</div><div class="l-sub">${escapeHtml(c.phone || "")} · ${Number(c.points || 0)} pts</div></div></div>
    <button class="btn ghost" style="padding:6px 10px" onclick='event.stopPropagation();showLedger("${c.id}","${escapeHtml(c.name)}")'>Ledger</button></div>`
};
window.customersOpts = customersOpts;
const renderCustomers = moduleListPage(customersOpts);

window.showLedger = async (customerId, name) => {
  const [sales, installments] = await Promise.all([DB.getAll("sales"), DB.getAll("installments")]);
  const custSales = sales.filter((s) => s.customerId === customerId);
  const custInst = installments.filter((i) => i.customerName === name);
  const totalSpent = custSales.reduce((a, s) => a + Number(s.total || 0), 0);
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:flex-end";
  overlay.innerHTML = `<div style="background:var(--card);width:100%;max-width:480px;margin:0 auto;border-radius:18px 18px 0 0;padding:18px;max-height:85vh;overflow:auto">
    <h2 style="margin-top:0">${escapeHtml(name)}'s Ledger</h2>
    <div class="card">Total Spent: ${fmt(totalSpent)} · ${custSales.length} invoices</div>
    ${custSales.map((s) => `<div class="list-row">
      <div class="l-title">Invoice #${escapeHtml(s.invoiceNo)}</div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="l-title">${fmt(s.total)}</div>
        <button class="btn ghost" style="padding:4px 8px;font-size:11px" onclick='reprintInvoice("${s.id}")'>🖨️</button>
      </div></div>`).join("")}
    ${custInst.length ? `<div class="section-title" style="padding-left:0">Installments</div>` + custInst.map((i) => `<div class="list-row"><div class="l-title">${escapeHtml(i.item)}</div><div class="l-title">${fmt(i.remaining)} left</div></div>`).join("") : ""}
    <button class="btn full ghost" id="ledger-close" style="margin-top:12px">Close</button>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#ledger-close").onclick = () => overlay.remove();
};

// ---------- Repairs ----------
const repairsOpts = {
  title: "Repairs", store: "repairs", activeTab: "repairs",
  emptyText: "No repair jobs yet.",
  fields: [
    { key: "customerName", label: "Customer Name" },
    { key: "phone", label: "Phone" },
    { key: "device", label: "Device Model" },
    { key: "fault", label: "Fault Details" },
    { key: "technician", label: "Technician" },
    { key: "cost", label: "Repair Cost", type: "number" },
    { key: "status", label: "Status", type: "select", options: [
      { value: "received", label: "Received" }, { value: "in_progress", label: "In Progress" },
      { value: "ready", label: "Ready" }, { value: "delivered", label: "Delivered" }
    ] },
  ],
  renderRow: (r) => `<div class="list-row">
    <div class="l-left" style="flex:1;cursor:pointer" onclick='editItem("repairs","${r.id}", repairsOpts)'>
      <div class="dot" style="background:var(--orange)">🔧</div>
      <div><div class="l-title">${escapeHtml(r.device || "")}</div>
      <div class="l-sub">${escapeHtml(r.customerName || "")} · ${escapeHtml(r.fault || "")}</div></div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
      <span class="pill ${r.status === "delivered" ? "ok" : r.status === "ready" ? "warn" : "bad"}">${(r.status || "received").replace("_", " ")}</span>
      ${r.status === "ready" && r.phone ? `<a class="btn ghost" style="padding:3px 8px;font-size:11px;background:#25D366;color:#fff;border:none;text-decoration:none"
        href="https://wa.me/${String(r.phone).replace(/\D/g,"")}?text=${encodeURIComponent("Assalamualaikum " + (r.customerName||"") + ", aapka " + (r.device||"device") + " repair ready hai. Sanaullah Mobile Communication.")}"
        target="_blank" onclick="event.stopPropagation()">WhatsApp</a>` : ""}
    </div></div>`
};
window.repairsOpts = repairsOpts;
const renderRepairs = moduleListPage(repairsOpts);

// ---------- Installments ----------
const installmentsOpts = {
  title: "Installments", store: "installments", activeTab: "installments",
  emptyText: "No installment plans yet.",
  fields: [
    { key: "customerName", label: "Customer Name" },
    { key: "item", label: "Item" },
    { key: "totalAmount", label: "Total Amount", type: "number" },
    { key: "paid", label: "Amount Paid", type: "number", default: 0 },
    { key: "dueDate", label: "Next Due Date", type: "date" },
    { key: "status", label: "Status", type: "select", options: [
      { value: "active", label: "Active" }, { value: "paid", label: "Paid" }, { value: "overdue", label: "Overdue" }
    ] },
  ],
    beforeSave: (r) => { r.remaining = Number(r.totalAmount || 0) - Number(r.paid || 0); if (r.remaining <= 0) r.status = "paid"; },
  renderRow: (i) => `<div class="list-row">
    <div class="l-left" style="flex:1;cursor:pointer" onclick='editItem("installments","${i.id}", installmentsOpts)'>
      <div class="dot" style="background:var(--blue)">📅</div>
      <div><div class="l-title">${escapeHtml(i.customerName || "")}</div>
      <div class="l-sub">${escapeHtml(i.item || "")} · Due ${escapeHtml(i.dueDate || "-")}</div></div>
    </div>
    <div style="text-align:right">
      <div class="l-title">${fmt(i.remaining)}</div>
      <span class="pill ${i.status === "paid" ? "ok" : "warn"}">${i.status}</span>
      ${i.status !== "paid" ? `<button class="btn" style="padding:3px 8px;margin-top:4px;font-size:11px" onclick='event.stopPropagation();receiveInstallment("${i.id}")'>💵 Pay</button>` : ""}
    </div></div>`
};
window.installmentsOpts = installmentsOpts;
const renderInstallments = moduleListPage(installmentsOpts);

window.receiveInstallment = async (id) => {
  const row = await DB.get("installments", id);
  if (!row) return;
  const rem = Number(row.remaining != null ? row.remaining : (Number(row.totalAmount||0) - Number(row.paid||0)));
  const raw = prompt("Receive amount (Rs). Remaining: " + rem, String(rem));
  if (raw == null) return;
  const amt = Number(raw);
  if (!(amt > 0)) { toast("Invalid amount"); return; }
  row.paid = Number(row.paid || 0) + amt;
  row.remaining = Math.max(0, Number(row.totalAmount || 0) - row.paid);
  if (row.remaining <= 0) row.status = "paid";
  await DB.put("installments", row);
  await logAudit("installment", "Payment " + fmt(amt) + " from " + (row.customerName || ""));
  toast("Received " + fmt(amt));
  // quick receipt overlay
  const msg = "Sanaullah Mobile Communication\nInstallment Receipt\n" + (row.customerName||"") + "\nPaid: " + fmt(amt) + "\nRemaining: " + fmt(row.remaining);
  if (confirm("Print / show receipt?")) {
    showInvoice({
      invoiceNo: "INST-" + (row.id || "").slice(-6),
      customerName: row.customerName || "",
      customerPhone: "",
      items: [{ name: row.item || "Installment", qty: 1, price: amt }],
      subtotal: amt, discount: 0, total: amt, payment: "Installment",
      date: new Date().toISOString(), _duplicate: false
    });
  }
  router();
};


// ---------- Suppliers ----------
const suppliersOpts = {
  title: "Suppliers", store: "suppliers", activeTab: "suppliers",
  emptyText: "No suppliers yet.",
  fields: [
    { key: "name", label: "Supplier Name" }, { key: "phone", label: "Phone" },
    { key: "outstanding", label: "Outstanding Due", type: "number", default: 0 },
  ],
  renderRow: (s) => `<div class="list-row" onclick='editItem("suppliers","${s.id}", suppliersOpts)'>
    <div class="l-left"><div class="dot" style="background:var(--red)">🚚</div>
      <div><div class="l-title">${escapeHtml(s.name)}</div><div class="l-sub">${escapeHtml(s.phone || "")}</div></div></div>
    <div class="l-title">${fmt(s.outstanding)}</div></div>`
};
window.suppliersOpts = suppliersOpts;
const renderSuppliers = moduleListPage(suppliersOpts);

// ---------- Expenses ----------
const expensesOpts = {
  title: "Expenses", store: "expenses", activeTab: "reports",
  emptyText: "No expenses recorded yet.",
  fields: [
    { key: "title", label: "Expense Title" },
    { key: "amount", label: "Amount", type: "number" },
    { key: "date", label: "Date", type: "date" },
  ],
  renderRow: (e) => `<div class="list-row" onclick='editItem("expenses","${e.id}", expensesOpts)'>
    <div class="l-left"><div class="dot" style="background:var(--purple)">💰</div>
      <div><div class="l-title">${escapeHtml(e.title)}</div><div class="l-sub">${escapeHtml(e.date || "")}</div></div></div>
    <div class="l-title">${fmt(e.amount)}</div></div>`
};
window.expensesOpts = expensesOpts;
const renderExpenses = moduleListPage(expensesOpts);

// ---------- Reports ----------
async function renderReports() {
  const [sales, expenses, products, returnsList] = await Promise.all([
    DB.getAll("sales"), DB.getAll("expenses"), DB.getAll("products"), DB.getAll("returns")
  ]);
  const totalSales = sales.reduce((a, s) => a + Number(s.total || 0), 0);
  const totalProfit = sales.reduce((a, s) => a + Number(s.profit || 0), 0);
  const totalExpenses = expenses.reduce((a, e) => a + Number(e.amount || 0), 0);
  const totalReturns = returnsList.reduce((a, r) => a + Number(r.amount || 0), 0);
  const stockValue = products.reduce((a, p) => a + Number(p.costPrice || 0) * Number(p.qty || 0), 0);
  const lowStock = products.filter((p) => Number(p.qty) <= Number(p.reorderLevel || 5));

  // Last 7 days sales bars
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const sum = sales.filter((s) => (s.date || "").slice(0, 10) === key).reduce((a, s) => a + Number(s.total || 0), 0);
    days.push({ key: key.slice(5), sum });
  }
  const maxDay = Math.max(1, ...days.map((d) => d.sum));
  const bars = days.map((d) => {
    const h = Math.max(4, Math.round((d.sum / maxDay) * 80));
    return `<div style="flex:1;text-align:center"><div style="height:80px;display:flex;align-items:flex-end;justify-content:center"><div style="width:70%;height:${h}px;background:linear-gradient(180deg,var(--blue),var(--blue2));border-radius:6px 6px 0 0"></div></div><div style="font-size:10px;color:var(--muted);margin-top:4px">${d.key}</div></div>`;
  }).join("");

  const lowWa = lowStock.length
    ? encodeURIComponent("Low stock alert — Sanaullah MC\\n" + lowStock.map((p) => p.name + " qty:" + p.qty).join("\\n"))
    : "";

  const html = `
  <div class="page">
    <h2>Reports</h2>
    <div class="card"><div class="l-sub">Last 7 days sales</div>
      <div style="display:flex;gap:4px;margin-top:10px">${bars}</div>
    </div>
    <div class="card"><div class="l-sub">Total Sales</div><div class="l-title" style="font-size:20px">${fmt(totalSales)}</div></div>
    <div class="card"><div class="l-sub">Total Profit</div><div class="l-title" style="font-size:20px">${fmt(totalProfit)}</div></div>
    <div class="card"><div class="l-sub">Returns</div><div class="l-title" style="font-size:20px">${fmt(totalReturns)}</div></div>
    <div class="card"><div class="l-sub">Total Expenses</div><div class="l-title" style="font-size:20px">${fmt(totalExpenses)}</div></div>
    <div class="card"><div class="l-sub">Net (Profit − Expenses − Returns)</div><div class="l-title" style="font-size:20px">${fmt(totalProfit - totalExpenses - totalReturns)}</div></div>
    <div class="card"><div class="l-sub">Current Stock Value</div><div class="l-title" style="font-size:20px">${fmt(stockValue)}</div></div>
    <div class="card">
      <div class="l-sub">Low stock items: ${lowStock.length}</div>
      ${lowStock.length ? `<a class="btn full" style="margin-top:8px;background:#25D366;text-decoration:none;text-align:center" target="_blank" href="https://wa.me/?text=${lowWa}">WhatsApp low-stock list</a>` : ""}
    </div>
    <button class="btn full ghost" id="rep-export">Export Sales as CSV</button>
    <button class="btn full" id="returns-btn" style="margin-top:10px">Returns / Credit Notes</button>
    <button class="btn full ghost" id="expenses-btn" style="margin-top:10px">Manage Expenses</button>
  </div>`;
  root.innerHTML = shell("reports", html);
  document.getElementById("expenses-btn").onclick = () => location.hash = "#/expenses";
  document.getElementById("returns-btn").onclick = () => location.hash = "#/returns";
  document.getElementById("rep-export").onclick = () => exportCSV(sales);
}

function exportCSV(sales) {
  const rows = [["Invoice", "Customer", "Total", "Profit", "Date"]];
  sales.forEach((s) => rows.push([s.invoiceNo, s.customerName, s.total, s.profit, s.date]));
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "sales-report.csv";
  a.click();
}

// ---------- Settings ----------
async function renderSettings() {
  const html = `
  <div class="page">
    <h2>Settings</h2>
    <div class="card">
      <div class="form-row"><label>Shop Branch Name</label><input id="set-branch" value="${escapeHtml((await DB.get("settings", "shop"))?.branch || "Main Branch")}" /></div>
      <button class="btn ghost full" id="set-branch-save" style="margin-bottom:10px">Save Branch</button>
      <div class="form-row"><label>Theme</label>
        <select id="set-theme">
          <option value="dark" ${state.theme === "dark" ? "selected" : ""}>Dark</option>
          <option value="light" ${state.theme === "light" ? "selected" : ""}>Light</option>
        </select></div>
    </div>
    <div class="card">
      <div class="l-title" style="margin-bottom:6px">Firebase Sync</div>
      <div class="l-sub" style="margin-bottom:8px">${window.SMSync && window.SMSync.isReady() && window.SMSync.currentUser()
        ? "🟢 Signed in — 1 doc/record · sync 3s + realtime"
        : window.SMSync && window.SMSync.isReady()
          ? "🟡 Firebase ready — Firebase email se login karo"
          : "⚪ Firebase not ready."}</div>
      <button class="btn full" id="sync-now" style="margin-bottom:8px">🔄 Sync Now</button>
      <button class="btn full" id="sync-full" style="margin-bottom:8px;background:var(--green)">☁️ Full Cloud Resync</button>
      <button class="btn full ghost" id="sync-clear" style="margin-bottom:8px">Clear pending queue</button>
      <div class="form-row"><label>Language / زبان</label>
        <select id="set-lang">
          <option value="en" ${(localStorage.getItem("sm_lang")||"en")==="en"?"selected":""}>English</option>
          <option value="ur" ${(localStorage.getItem("sm_lang")||"en")==="ur"?"selected":""}>اردو</option>
        </select></div>
    </div>
    <div class="card">
      <div class="l-title" style="margin-bottom:6px">Thermal Printer</div>
      <div class="l-sub" style="margin-bottom:8px" id="printer-status">${window.shopPrinter && window.shopPrinter.isConnected ? "🟢 Printer connected" : "⚪ Not connected (Bluetooth / USB)"}</div>
      <button class="btn full" id="printer-connect" style="margin-bottom:8px">🔌 Connect Printer</button>
      <button class="btn full ghost" id="printer-test">Test Print</button>
    </div>
    ${state.user.role === "admin" ? `
    <div class="card">
      <div class="l-title" style="margin-bottom:10px">Management</div>
      <button class="btn full ghost" style="margin-bottom:8px" onclick="location.hash='#/staff'">👨‍💼 Staff & Roles</button>
      <button class="btn full ghost" style="margin-bottom:8px" onclick="location.hash='#/purchase-orders'">🚚 Purchase Orders</button>
      <button class="btn full ghost" style="margin-bottom:8px" onclick="location.hash='#/cashbook'">💵 Cash Book / Daily Closing</button>
      <button class="btn full ghost" style="margin-bottom:8px" onclick="searchImeiRegistry()">🔍 IMEI / Sold Registry</button>
      <button class="btn full ghost" onclick="location.hash='#/audit-logs'">📋 Audit Logs</button>
    </div>
    <div class="card">
      <div class="l-title" style="margin-bottom:6px">Backup & Restore</div>
      <div class="l-sub" style="margin-bottom:10px">Save all your shop data (products, sales, customers, repairs, everything) as one file, or restore it later on this or another device.</div>
      <button class="btn full" id="backup-now" style="margin-bottom:8px">⬇️ Backup Now</button>
      <label class="btn full ghost" style="display:block;text-align:center" for="restore-file">⬆️ Restore from Backup</label>
      <input type="file" id="restore-file" accept="application/json" style="display:none" />
    </div>
    <div class="card">
      <div class="l-title" style="margin-bottom:6px">Import Products (CSV)</div>
      <div class="l-sub" style="margin-bottom:8px">Columns: name,category,costPrice,salePrice,qty,reorderLevel</div>
      <input type="file" id="csv-import" accept=".csv" />
    </div>` : ""}
    <button class="btn full ghost" id="set-logout">Logout</button>
    <div style="text-align:center;color:var(--muted);font-size:11px;margin-top:16px">Software by Fazal Khan Chandio · 03333909816</div>
  </div>`;
  root.innerHTML = shell("settings", html);
  document.getElementById("set-branch-save").onclick = async () => {
    await DB.put("settings", { id: "shop", branch: document.getElementById("set-branch").value });
    toast("Branch saved");
  };
  document.getElementById("set-theme").onchange = (e) => {
    state.theme = e.target.value;
    localStorage.setItem("sm_theme", state.theme);
    document.documentElement.setAttribute("data-theme", state.theme);
  };
  document.getElementById("set-logout").onclick = async () => {
    await logAudit("logout", state.user.name + " logged out");
    if (window.SMSync && window.SMSync.currentUser()) {
      try { await SMSync.signOut(); } catch (e) { console.warn(e); }
    }
    state.user = null;
    await DB.remove("settings", "session");
    location.hash = "";
    router();
  };
  const pConn = document.getElementById("printer-connect");
  const pTest = document.getElementById("printer-test");
  if (pConn) pConn.onclick = async () => {
    try {
      if (typeof ThermalPrinter === "undefined") { toast("Printer lib missing"); return; }
      if (!window.shopPrinter) window.shopPrinter = new ThermalPrinter({ paperWidth: 80, debug: false });
      const name = await window.shopPrinter.connect();
      const st = document.getElementById("printer-status");
      if (st) st.textContent = "🟢 " + name;
      toast("Connected: " + name);
    } catch (e) { toast(e.message || "Connect failed"); }
  };
  if (pTest) pTest.onclick = async () => {
    try {
      if (!window.shopPrinter || !window.shopPrinter.isConnected) {
        toast("Pehle Connect Printer karo");
        return;
      }
      await window.shopPrinter.printTest();
      toast("Test printed");
    } catch (e) { toast(e.message || "Test failed"); }
  };
  const syncNow = document.getElementById("sync-now");
  const syncClear = document.getElementById("sync-clear");
  if (syncNow) syncNow.onclick = async () => {
    if (!window.SMSync || !SMSync.currentUser()) { toast("Firebase email se login karo"); return; }
    toast("Syncing…");
    await SMSync.flushQueue();
    window._pendingCount = await DB.pendingSyncCount();
    updateSyncStatusBar();
    toast(window._pendingCount ? (window._pendingCount + " still pending") : "Synced");
  };
  const syncFull = document.getElementById("sync-full");
  if (syncFull) syncFull.onclick = async () => {
    if (!window.SMSync || !SMSync.currentUser()) { toast("Firebase email se login karo"); return; }
    if (!confirm("Full resync: pending clear + pull cloud + push all local docs?")) return;
    toast("Full resync… wait");
    try {
      const n = await SMSync.fullResync();
      window._pendingCount = await DB.pendingSyncCount();
      updateSyncStatusBar();
      toast("Done — " + n + " docs on cloud");
    } catch (e) { toast(e.message || "Resync failed"); }
  };
  if (syncClear) syncClear.onclick = async () => {
    if (!confirm("Pending queue clear? Local data safe rahega.")) return;
    await SMSync.clearPending();
    window._pendingCount = 0;
    updateSyncStatusBar();
    toast("Queue cleared — fresh");
  };
  const langSel = document.getElementById("set-lang");
  if (langSel) langSel.onchange = (e) => {
    localStorage.setItem("sm_lang", e.target.value);
    toast(e.target.value === "ur" ? "زبان اردو" : "Language English");
    router();
  };
  const csvInput = document.getElementById("csv-import");
  if (csvInput) csvInput.onchange = (e) => importProductsCSV(e.target.files[0]);
  const backupBtn = document.getElementById("backup-now");
  if (backupBtn) backupBtn.onclick = backupNow;
  const restoreInput = document.getElementById("restore-file");
  if (restoreInput) restoreInput.onchange = (e) => restoreBackup(e.target.files[0]);
}

// ---------- Backup & Restore ----------
const BACKUP_STORES = ["products", "customers", "sales", "repairs", "installments",
  "suppliers", "expenses", "staff", "settings", "purchaseOrders", "auditLogs", "attendance", "returns"];

async function backupNow() {
  const data = {};
  for (const store of BACKUP_STORES) data[store] = await DB.getAll(store);
  const payload = { app: "sm-app", version: 2, exportedAt: new Date().toISOString(), data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sm-backup-${todayKey()}.json`;
  a.click();
  await logAudit("backup", "Full backup exported");
  toast("Backup downloaded");
}

function restoreBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    let payload;
    try { payload = JSON.parse(e.target.result); } catch { toast("Invalid backup file"); return; }
    if (!payload || !payload.data) { toast("Invalid backup file"); return; }
    let count = 0;
    for (const store of BACKUP_STORES) {
      const records = payload.data[store];
      if (!Array.isArray(records)) continue;
      for (const rec of records) { await DB.put(store, rec); count++; }
    }
    await logAudit("restore", `Restored ${count} records from backup`);
    toast(`Restored ${count} records`);
    router();
  };
  reader.readAsText(file);
}

function importProductsCSV(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const lines = e.target.result.split(/\r?\n/).filter(Boolean);
    const header = lines[0].split(",").map((h) => h.trim());
    let count = 0;
    for (const line of lines.slice(1)) {
      const cols = line.split(",");
      const rec = {};
      header.forEach((h, i) => { rec[h] = cols[i] ? cols[i].trim() : ""; });
      if (!rec.name) continue;
      rec.costPrice = Number(rec.costPrice || 0);
      rec.salePrice = Number(rec.salePrice || 0);
      rec.qty = Number(rec.qty || 0);
      rec.reorderLevel = Number(rec.reorderLevel || 5);
      await DB.put("products", rec);
      count++;
    }
    await logAudit("import", `Imported ${count} products via CSV`);
    toast(`Imported ${count} products`);
    router();
  };
  reader.readAsText(file);
}



/** Restore product qty when a return is saved */
async function restoreStockFromReturn(record) {
  const sales = await DB.getAll("sales");
  const inv = String(record.invoiceNo || "").trim().toLowerCase();
  const sale = sales.find((s) =>
    String(s.invoiceNo || "").toLowerCase() === inv ||
    String(s.id || "").toLowerCase() === inv
  );
  const products = await DB.getAll("products");
  let restored = 0;
  if (sale && Array.isArray(sale.items)) {
    for (const it of sale.items) {
      const p = products.find((x) => x.id === it.id) || products.find((x) => x.name === it.name);
      if (p) {
        p.qty = Number(p.qty || 0) + Number(it.qty || 1);
        if (p.soldInvoice) delete p.soldInvoice;
        await DB.put("products", p);
        restored++;
      }
    }
  } else if (record.item) {
    const name = String(record.item).split(",")[0].split(" x")[0].trim();
    const p = products.find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
    if (p) {
      p.qty = Number(p.qty || 0) + 1;
      await DB.put("products", p);
      restored = 1;
    }
  }
  if (restored) toast("Stock restored (" + restored + " item)");
  else toast("Return saved (stock auto-match nahi hua)");
}

/** IMEI / sold phone registry search */
async function searchImeiRegistry() {
  const q = prompt("IMEI / Serial search:");
  if (!q) return;
  const qq = q.trim().toLowerCase();
  const products = await DB.getAll("products");
  const sales = await DB.getAll("sales");
  const hits = [];
  for (const p of products) {
    if (p.imei && String(p.imei).toLowerCase().includes(qq)) {
      hits.push("Product: " + p.name + " · Stock " + p.qty + (p.soldInvoice ? " · Sold " + p.soldInvoice : ""));
    }
  }
  for (const s of sales) {
    for (const it of (s.items || [])) {
      const p = products.find((x) => x.id === it.id);
      if (p && p.imei && String(p.imei).toLowerCase().includes(qq)) {
        hits.push("Sale " + (s.invoiceNo || "") + " · " + (s.customerName || "") + " · " + it.name);
      }
    }
  }
  if (!hits.length) toast("No IMEI match");
  else alert("IMEI results:\n\n" + hits.slice(0, 15).join("\n"));
}
window.searchImeiRegistry = searchImeiRegistry;

// ---------- Returns / Credit Notes ----------
const returnsOpts = {
  title: "Returns", store: "returns", activeTab: "reports",
  emptyText: "No returns yet.",
  fields: [
    { key: "invoiceNo", label: "Original Invoice #" },
    { key: "customerName", label: "Customer Name" },
    { key: "item", label: "Item / Reason" },
    { key: "amount", label: "Return Amount", type: "number" },
    { key: "date", label: "Date", type: "date" },
    { key: "status", label: "Status", type: "select", options: [
      { value: "refunded", label: "Refunded" }, { value: "exchange", label: "Exchange" }, { value: "credit", label: "Store Credit" }
    ] },
  ],
  renderRow: (r) => `<div class="list-row" onclick='editItem("returns","${r.id}", returnsOpts)'>
    <div class="l-left"><div class="dot" style="background:var(--orange)">↩️</div>
      <div><div class="l-title">${escapeHtml(r.customerName || r.invoiceNo || "")}</div>
      <div class="l-sub">${escapeHtml(r.item || "")} · ${escapeHtml(r.date || "")}</div></div></div>
    <div style="text-align:right"><div class="l-title">${fmt(r.amount)}</div>
    <span class="pill warn">${escapeHtml(r.status || "")}</span></div></div>`
};
window.returnsOpts = returnsOpts;
const renderReturns = moduleListPage(returnsOpts);

// ---------- Staff & Roles ----------
const staffOpts = {
  title: "Staff", store: "staff", activeTab: "settings",
  emptyText: "No staff added yet.",
  fields: [
    { key: "name", label: "Full Name" },
    { key: "phone", label: "Phone (used as login username)" },
    { key: "pin", label: "PIN / Password (used to login)" },
    { key: "role", label: "Role", type: "select", options: [
      { value: "cashier", label: "Cashier (Sales, Products, Customers)" },
      { value: "manager", label: "Manager (Sales + Stock + Reports)" },
      { value: "technician", label: "Technician (Repairs only)" },
      { value: "admin", label: "Admin (Full access)" },
    ] },
    { key: "salary", label: "Monthly Salary", type: "number" },
  ],
  renderRow: (s) => `<div class="list-row" onclick='editItem("staff","${s.id}", staffOpts)'>
    <div class="l-left"><div class="dot" style="background:var(--blue)">👨‍💼</div>
      <div><div class="l-title">${escapeHtml(s.name)}</div><div class="l-sub">${escapeHtml(s.phone || "")} · ${escapeHtml(s.role || "cashier")}</div></div></div>
    <button class="btn ghost" style="padding:6px 10px" onclick='event.stopPropagation();markAttendance("${s.id}","${escapeHtml(s.name)}")'>✓ Attend</button></div>`
};
window.staffOpts = staffOpts;
const renderStaff = moduleListPage(staffOpts);
window.markAttendance = async (staffId, name) => {
  await DB.put("attendance", { staffId, name, date: todayKey(), time: new Date().toLocaleTimeString() });
  toast(`Attendance marked for ${name}`);
};

// ---------- Purchase Orders (Suppliers) ----------
const poOpts = {
  title: "Purchase Orders", store: "purchaseOrders", activeTab: "settings",
  emptyText: "No purchase orders yet.",
  fields: [
    { key: "supplierName", label: "Supplier Name" },
    { key: "items", label: "Items (description)" },
    { key: "amount", label: "Total Amount", type: "number" },
    { key: "paid", label: "Amount Paid", type: "number", default: 0 },
    { key: "status", label: "Status", type: "select", options: [
      { value: "ordered", label: "Ordered" }, { value: "received", label: "Received" }, { value: "paid", label: "Paid" }
    ] },
  ],
  renderRow: (o) => `<div class="list-row" onclick='editItem("purchaseOrders","${o.id}", poOpts)'>
    <div class="l-left"><div class="dot" style="background:var(--red)">🚚</div>
      <div><div class="l-title">${escapeHtml(o.supplierName)}</div><div class="l-sub">${escapeHtml(o.items || "")}</div></div></div>
    <div style="text-align:right"><div class="l-title">${fmt(o.amount)}</div><span class="pill ${o.status === "paid" ? "ok" : "warn"}">${o.status}</span></div></div>`
};
window.poOpts = poOpts;
const renderPurchaseOrders = moduleListPage(poOpts);

// ---------- Cash Book / Daily Closing ----------
async function renderCashbook() {
  const [sales, expenses, po] = await Promise.all([DB.getAll("sales"), DB.getAll("expenses"), DB.getAll("purchaseOrders")]);
  const byDay = {};
  sales.forEach((s) => { const d = (s.date || "").slice(0, 10); byDay[d] = byDay[d] || { in: 0, out: 0 }; byDay[d].in += Number(s.total || 0); });
  expenses.forEach((e) => { const d = e.date || ""; byDay[d] = byDay[d] || { in: 0, out: 0 }; byDay[d].out += Number(e.amount || 0); });
  po.forEach((o) => { const d = todayKey(); byDay[d] = byDay[d] || { in: 0, out: 0 }; });
  const days = Object.keys(byDay).sort().reverse();
  const today = todayKey();
  const t = byDay[today] || { in: 0, out: 0 };
  const html = `
  <div class="page">
    <h2>Cash Book / Daily Closing</h2>
    <div class="card" style="border:2px solid var(--blue)">
      <div class="l-title">Today (${today})</div>
      <div class="l-sub">Cash In: ${fmt(t.in)} · Cash Out: ${fmt(t.out)}</div>
      <div style="font-weight:800;font-size:18px;margin-top:6px">Net: ${fmt(t.in - t.out)}</div>
      <button class="btn full" id="day-close-print" style="margin-top:12px">🖨️ Print Day Close</button>
    </div>
    ${days.length ? days.map((d) => `
      <div class="card">
        <div class="l-title">${d}</div>
        <div class="l-sub">Cash In: ${fmt(byDay[d].in)} · Cash Out: ${fmt(byDay[d].out)}</div>
        <div style="font-weight:700;margin-top:4px">Net: ${fmt(byDay[d].in - byDay[d].out)}</div>
      </div>`).join("") : `<div class="empty">No cash movements recorded yet.</div>`}
  </div>`;
  root.innerHTML = shell("settings", html);
  document.getElementById("day-close-print").onclick = async () => {
    try {
      await printDayClose(today, t);
    } catch (e) { toast(e.message || "Print failed"); }
  };
}

async function printDayClose(day, totals) {
  if (typeof ThermalPrinter === "undefined") {
    // screen fallback
    alert("Day Close " + day + "\nIn: " + fmt(totals.in) + "\nOut: " + fmt(totals.out) + "\nNet: " + fmt(totals.in - totals.out));
    return;
  }
  const printer = window.shopPrinter || new ThermalPrinter({ paperWidth: 80 });
  window.shopPrinter = printer;
  if (!printer.isConnected) {
    toast("Printer connect…");
    await printer.connect();
  }
  await printer.init();
  await printer.printText("SANAULLAH MOBILE", { align: "center", bold: true });
  await printer.printText("DAY CLOSE", { align: "center", bold: true });
  await printer.printText(day, { align: "center" });
  await printer.printText("--------------------", { align: "center" });
  await printer.printText("Cash In:  " + fmt(totals.in));
  await printer.printText("Cash Out: " + fmt(totals.out));
  await printer.printText("NET:      " + fmt(totals.in - totals.out), { bold: true });
  await printer.printText("--------------------", { align: "center" });
  await printer.printSmall("Software by Fazal Khan Chandio", { align: "center" });
  await printer.printSmall("03333909816", { align: "center" });
  await printer.feed(1);
  await printer.doCut();
  toast("Day close printed");
}

// ---------- Audit Logs ----------
async function renderAuditLogs() {
  const logs = (await DB.getAll("auditLogs")).sort((a, b) => (b.ts || "").localeCompare(a.ts || "")).slice(0, 100);
  const html = `
  <div class="page">
    <h2>Audit Logs</h2>
    ${logs.length ? logs.map((l) => `
      <div class="list-row"><div class="l-left"><div><div class="l-title">${escapeHtml(l.detail)}</div>
        <div class="l-sub">${escapeHtml(l.by)} · ${escapeHtml((l.ts || "").replace("T", " ").slice(0, 19))}</div></div></div></div>`).join("")
      : `<div class="empty">No activity logged yet.</div>`}
  </div>`;
  root.innerHTML = shell("settings", html);
}

// ---------- Boot ----------
window.addEventListener("sm:queued", async () => {
  window._pendingCount = await DB.pendingSyncCount();
  updateSyncStatusBar();
});
window.addEventListener("sm:synced", async () => {
  window._pendingCount = await DB.pendingSyncCount();
  updateSyncStatusBar(); // do NOT router() — it wipes POS form inputs
});
window.addEventListener("online", () => updateSyncStatusBar());
window.addEventListener("offline", () => updateSyncStatusBar());

function updateSyncStatusBar() {
  const el = document.querySelector(".sync-status");
  if (!el || !state.user) return;
  const pending = window._pendingCount || 0;
  el.textContent = (navigator.onLine ? "🟢 Online" : "🟠 Offline")
    + (pending ? " · " + pending + " pending sync" : " · synced")
    + " · " + (state.user.role || "admin");
}

(async function boot() {
  await tryRestoreSession();
  window._pendingCount = await DB.pendingSyncCount();
  router();
  // Daily backup reminder (once per calendar day)
  try {
    const last = localStorage.getItem("sm_last_backup_day");
    const day = todayKey();
    if (state.user && last !== day) {
      setTimeout(() => {
        if (confirm("Daily backup? Shop data JSON download ho jaye.")) {
          backupNow().then(() => localStorage.setItem("sm_last_backup_day", day));
        } else {
          localStorage.setItem("sm_last_backup_day", day);
        }
      }, 2500);
    }
  } catch (e) {}
})();
