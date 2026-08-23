/* app.js — SPA shell: hash routing + render functions for every module.
   All data reads/writes go through window.DB (IndexedDB, offline-first). */

const root = document.getElementById("app");
const state = { user: null, theme: localStorage.getItem("sm_theme") || "dark" };
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
};

function can(feature) {
  // simple role permissions: admin sees everything; cashier limited to sales+products+customers;
  // technician limited to repairs.
  const role = state.user && state.user.role;
  if (role === "admin" || !role) return true;
  const cashierAllowed = ["dashboard", "pos", "products", "customers", "installments", "reports", "settings"];
  const techAllowed = ["dashboard", "repairs", "settings"];
  if (role === "cashier") return cashierAllowed.includes(feature);
  if (role === "technician") return techAllowed.includes(feature);
  return true;
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
// DEMO credentials — change these before going live, or wire up Firebase Auth
// later (see js/firebase-sync.js). Staff added in the Staff module can also
// log in with their own PIN once created.
const DEMO_ADMIN = { username: "admin", password: "admin123", name: "Admin", role: "admin" };

function renderLogin() {
  root.innerHTML = `
  <div class="login-screen">
    <img src="icons/icon-512.png" class="login-logo" alt="logo" />
    <div class="login-title">SANAULLAH</div>
    <div class="login-sub">MOBILE COMMUNICATION</div>
    <div class="field"><input id="li-user" placeholder="Email or Phone" /></div>
    <div class="field"><input id="li-pass" type="password" placeholder="Password" /></div>
    <div id="li-error" style="color:#f87171;font-size:12px;margin:-4px 0 10px;display:none"></div>
    <button class="btn-primary" id="li-btn">LOGIN</button>
    <div style="color:var(--muted);font-size:12px;margin-top:10px">Demo login — Username: <b>admin</b> · Password: <b>admin123</b></div>
  </div>`;
  document.getElementById("li-btn").onclick = doLogin;
  document.getElementById("li-pass").onkeydown = (e) => { if (e.key === "Enter") doLogin(); };
}

async function doLogin() {
  const u = document.getElementById("li-user").value.trim();
  const p = document.getElementById("li-pass").value.trim();
  const err = document.getElementById("li-error");

  // 1. Check demo admin
  if (u.toLowerCase() === DEMO_ADMIN.username && p === DEMO_ADMIN.password) {
    state.user = { name: DEMO_ADMIN.name, role: "admin" };
  } else {
    // 2. Check staff records (username = phone, password = pin)
    const staffList = await DB.getAll("staff");
    const match = staffList.find((s) => (s.phone === u || s.name === u) && String(s.pin) === p);
    if (match) {
      state.user = { name: match.name, role: match.role || "staff", staffId: match.id };
    } else {
      err.textContent = "Invalid username or password.";
      err.style.display = "block";
      return;
    }
  }
  await DB.put("settings", { id: "session", user: state.user });
  await logAudit("login", state.user.name + " logged in");
  location.hash = "#/dashboard";
  router();
}

async function logAudit(action, detail) {
  await DB.put("auditLogs", { action, detail, by: state.user ? state.user.name : "system", ts: new Date().toISOString() });
}

async function tryRestoreSession() {
  const s = await DB.get("settings", "session");
  if (s && s.user) state.user = s.user;
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
  const [sales, repairs, installments, products] = await Promise.all([
    DB.getAll("sales"), DB.getAll("repairs"), DB.getAll("installments"), DB.getAll("products")
  ]);
  const today = todayKey();
  const todaySales = sales.filter((s) => (s.date || "").slice(0, 10) === today);
  const todayTotal = todaySales.reduce((a, s) => a + Number(s.total || 0), 0);
  const todayProfit = todaySales.reduce((a, s) => a + Number(s.profit || 0), 0);
  const lowStock = products.filter((p) => Number(p.qty) <= Number(p.reorderLevel || 5));
  const dueInstallments = installments.filter((i) => i.status !== "paid");
  const dueTotal = dueInstallments.reduce((a, i) => a + Number(i.remaining || 0), 0);
  const recent = [...sales].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);

  const html = `
  <div class="stat-grid">
    <div class="stat-card stat-blue"><div class="label">Today's Sales</div><div class="value">${fmt(todayTotal)}</div><div class="delta">${todaySales.length} invoices</div></div>
    <div class="stat-card stat-green"><div class="label">Today's Profit</div><div class="value">${fmt(todayProfit)}</div><div class="delta">&nbsp;</div></div>
    <div class="stat-card stat-purple"><div class="label">Total Products</div><div class="value">${products.length}</div><div class="delta">All items</div></div>
    <div class="stat-card stat-orange"><div class="label">Low Stock</div><div class="value">${lowStock.length}</div><div class="delta">View & manage</div></div>
  </div>
  <div class="banner">
    <div><div style="font-weight:700">Installment Due</div><div style="color:var(--muted);font-size:12px">${fmt(dueTotal)} from ${dueInstallments.length} customers</div></div>
    <button class="btn ghost" onclick="location.hash='#/installments'">View All</button>
  </div>
  <div class="section-title">Quick Actions</div>
  <div class="qa-grid">
    ${qa("pos", "🛒", "POS / Billing")}
    ${qa("products", "➕", "Add Product")}
    ${qa("customers", "👥", "Customers")}
    ${qa("repairs", "🔧", "Repairs")}
    ${qa("installments", "📅", "Installments")}
    ${qa("suppliers", "🚚", "Suppliers")}
    ${qa("expenses", "💰", "Expenses")}
    ${qa("reports", "📈", "Reports")}
  </div>
  <div class="section-title" style="display:flex;justify-content:space-between">Recent Transactions <a href="#/pos" style="color:var(--blue);font-size:12px">View All</a></div>
  ${recent.length ? recent.map((s) => `
    <div class="list-row"><div class="l-left"><div class="dot" style="background:var(--blue)">🧾</div>
      <div><div class="l-title">Invoice #${escapeHtml(s.invoiceNo || s.id)}</div><div class="l-sub">${escapeHtml(s.customerName || "Walk-in Customer")}</div></div></div>
      <div style="text-align:right"><div class="l-title">${fmt(s.total)}</div><div class="l-sub">${(s.date || "").slice(11, 16)}</div></div></div>`).join("")
    : `<div class="empty">No sales yet. Tap POS / Billing to create your first invoice.</div>`}
  `;
  root.innerHTML = shell("dashboard", html);
}
function qa(route, icon, label) {
  return `<button class="qa-item" onclick="location.hash='#/${route}'"><div class="qi" style="background:var(--blue)">${icon}</div>${label}</button>`;
}

// ---------- POS / Billing ----------
let cart = [];
async function renderPOS() {
  const products = await DB.getAll("products");
  const customers = await DB.getAll("customers");
  const html = `
  <div class="page">
    <h2>POS / Billing</h2>
    <div class="card">
      <div class="form-row"><label>Customer</label>
        <select id="pos-cust"><option value="">Walk-in Customer</option>
          ${customers.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select></div>
      <div class="form-row"><label>Add Product</label>
        <div style="display:flex;gap:8px">
          <select id="pos-product" style="flex:1">
            <option value="">Select product…</option>
            ${products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} — ${fmt(p.salePrice)} (Stock: ${p.qty})</option>`).join("")}
          </select>
          <button class="icon-btn" id="pos-scan" title="Scan barcode">📷</button>
        </div></div>
      <button class="btn full" id="pos-add">Add to Cart</button>
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
  document.getElementById("pos-add").onclick = () => {
    const id = document.getElementById("pos-product").value;
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const existing = cart.find((c) => c.id === id);
    if (existing) existing.qty += 1; else cart.push({ id: p.id, name: p.name, price: Number(p.salePrice), cost: Number(p.costPrice || 0), qty: 1 });
    renderCart();
  };
  document.getElementById("pos-checkout").onclick = () => checkout(products, customers);
  document.getElementById("pos-scan").onclick = () => openBarcodeScanner((code) => {
    const match = products.find((p) => p.imei === code || p.id === code || p.name.toLowerCase() === code.toLowerCase());
    if (match) {
      const existing = cart.find((c) => c.id === match.id);
      if (existing) existing.qty += 1; else cart.push({ id: match.id, name: match.name, price: Number(match.salePrice), cost: Number(match.costPrice || 0), qty: 1 });
      renderCart();
      toast("Added " + match.name);
    } else toast("No product found for that code");
  });
}
function renderCart() {
  const el = document.getElementById("pos-cart");
  if (!cart.length) { el.innerHTML = `<div class="empty">Cart is empty</div>`; return; }
  const total = cart.reduce((a, c) => a + c.price * c.qty, 0);
  el.innerHTML = cart.map((c, i) => `
    <div class="list-row" style="padding:8px 0">
      <div class="l-left"><div><div class="l-title">${escapeHtml(c.name)}</div><div class="l-sub">${fmt(c.price)} × ${c.qty}</div></div></div>
      <div style="display:flex;align-items:center;gap:8px">
        <button class="btn ghost" style="padding:4px 10px" onclick="cartQty(${i},-1)">−</button>
        <button class="btn ghost" style="padding:4px 10px" onclick="cartQty(${i},1)">+</button>
      </div>
    </div>`).join("") + `<div style="text-align:right;font-weight:700;margin-top:8px">Total: ${fmt(total)}</div>`;
}
window.cartQty = (i, d) => { cart[i].qty += d; if (cart[i].qty <= 0) cart.splice(i, 1); renderCart(); };

async function checkout(products, customers) {
  if (!cart.length) { toast("Cart is empty"); return; }
  const custId = document.getElementById("pos-cust").value;
  const cust = customers.find((c) => c.id === custId);
  const discount = Number(document.getElementById("pos-discount").value || 0);
  const payment = document.getElementById("pos-payment").value;
  const subtotal = cart.reduce((a, c) => a + c.price * c.qty, 0);
  const total = Math.max(0, subtotal - discount);
  const profit = cart.reduce((a, c) => a + (c.price - c.cost) * c.qty, 0) - discount;
  const invoiceNo = "INV-" + (10000 + (await DB.getAll("sales")).length + 1);
  const sale = { invoiceNo, customerId: custId || null, customerName: cust ? cust.name : "Walk-in Customer",
    customerPhone: cust ? cust.phone : "", items: cart, subtotal, discount, total, profit, payment, date: new Date().toISOString() };
  await DB.put("sales", sale);
  for (const item of cart) {
    const p = products.find((x) => x.id === item.id);
    if (p) { p.qty = Math.max(0, Number(p.qty) - item.qty); await DB.put("products", p); }
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

function showInvoice(sale) {
  const overlay = document.createElement("div");
  overlay.id = "invoice-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px";
  const itemsHtml = sale.items.map((i) => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0">
    <span>${escapeHtml(i.name)} × ${i.qty}</span><span>${fmt(i.price * i.qty)}</span></div>`).join("");
  const waText = encodeURIComponent(
    `Sanaullah Mobile Communication\nInvoice #${sale.invoiceNo}\nCustomer: ${sale.customerName}\n\n` +
    sale.items.map((i) => `${i.name} x${i.qty} = ${fmt(i.price * i.qty)}`).join("\n") +
    `\n\nDiscount: ${fmt(sale.discount)}\nTotal: ${fmt(sale.total)}\nPayment: ${sale.payment}\nThank you for your business!`
  );
  overlay.innerHTML = `<div id="invoice-box" style="background:#fff;color:#111;width:100%;max-width:360px;border-radius:14px;padding:20px">
    <div style="text-align:center;font-weight:800">SANAULLAH MOBILE COMMUNICATION</div>
    <div style="text-align:center;font-size:11px;color:#666;margin-bottom:10px">Sales · Accessories · Repairs · Service</div>
    <div style="font-size:13px">Invoice #${sale.invoiceNo}<br/>Customer: ${escapeHtml(sale.customerName)}<br/>Date: ${new Date(sale.date).toLocaleString()}</div>
    <hr/>${itemsHtml}<hr/>
    <div style="display:flex;justify-content:space-between;font-size:13px"><span>Subtotal</span><span>${fmt(sale.subtotal)}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:13px"><span>Discount</span><span>-${fmt(sale.discount)}</span></div>
    <div style="display:flex;justify-content:space-between;font-weight:800;font-size:15px;margin-top:4px"><span>Total</span><span>${fmt(sale.total)}</span></div>
    <div style="font-size:12px;color:#666;margin-top:4px">Payment: ${sale.payment}</div>
  </div>
  <div style="position:fixed;bottom:24px;left:0;right:0;display:flex;gap:10px;justify-content:center;padding:0 20px">
    <button class="btn" onclick="window.print()">🖨️ Print</button>
    ${sale.customerPhone ? `<a class="btn" style="background:#25D366;text-decoration:none" target="_blank" href="https://wa.me/${sale.customerPhone.replace(/\D/g, "")}?text=${waText}">WhatsApp</a>` : ""}
    <button class="btn ghost" id="invoice-close">Close</button>
  </div>`;
  document.body.appendChild(overlay);
  document.getElementById("invoice-close").onclick = () => { overlay.remove(); location.hash = "#/dashboard"; };
}

// ---------- Generic list-page builder for simple CRUD modules ----------
function moduleListPage(opts) {
  // opts: {title, store, activeTab, fields[], renderRow(item), emptyText}
  return async function render() {
    const items = (await DB.getAll(opts.store)).sort((a, b) => b.updatedAt - a.updatedAt);
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
  overlay.querySelector("#form-cancel").onclick = () => overlay.remove();
  overlay.querySelector("#form-save").onclick = async () => {
    const record = existing ? { ...existing } : {};
    opts.fields.forEach((f) => {
      const v = overlay.querySelector("#f-" + f.key).value;
      record[f.key] = f.type === "number" ? Number(v || 0) : v;
    });
    if (opts.beforeSave) opts.beforeSave(record);
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
    <div class="l-left"><div class="dot" style="background:${Number(p.qty) <= Number(p.reorderLevel || 5) ? "var(--red)" : "var(--blue)"}">📦</div>
      <div><div class="l-title">${escapeHtml(p.name)}</div><div class="l-sub">${escapeHtml(p.category || "")} · Stock: ${p.qty}</div></div></div>
    <div style="text-align:right;display:flex;align-items:center;gap:8px">
      <button class="icon-btn" style="width:30px;height:30px" onclick='event.stopPropagation();printBarcodeLabel(${JSON.stringify(p).replace(/'/g, "&#39;")})'>🏷️</button>
      <div><div class="l-title">${fmt(p.salePrice)}</div>${Number(p.qty) <= Number(p.reorderLevel || 5) ? `<span class="pill bad">Low</span>` : `<span class="pill ok">OK</span>`}</div>
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
    ${custSales.map((s) => `<div class="list-row"><div class="l-title">Invoice #${escapeHtml(s.invoiceNo)}</div><div class="l-title">${fmt(s.total)}</div></div>`).join("")}
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
  renderRow: (r) => `<div class="list-row" onclick='editItem("repairs","${r.id}", repairsOpts)'>
    <div class="l-left"><div class="dot" style="background:var(--orange)">🔧</div>
      <div><div class="l-title">${escapeHtml(r.device || "")}</div><div class="l-sub">${escapeHtml(r.customerName || "")} · ${escapeHtml(r.fault || "")}</div></div></div>
    <span class="pill ${r.status === "delivered" ? "ok" : r.status === "ready" ? "warn" : "bad"}">${(r.status || "received").replace("_", " ")}</span></div>`
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
  renderRow: (i) => `<div class="list-row" onclick='editItem("installments","${i.id}", installmentsOpts)'>
    <div class="l-left"><div class="dot" style="background:var(--blue)">📅</div>
      <div><div class="l-title">${escapeHtml(i.customerName || "")}</div><div class="l-sub">${escapeHtml(i.item || "")} · Due ${escapeHtml(i.dueDate || "-")}</div></div></div>
    <div style="text-align:right"><div class="l-title">${fmt(i.remaining)}</div><span class="pill ${i.status === "paid" ? "ok" : "warn"}">${i.status}</span></div></div>`
};
window.installmentsOpts = installmentsOpts;
const renderInstallments = moduleListPage(installmentsOpts);

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
  const [sales, expenses, products] = await Promise.all([DB.getAll("sales"), DB.getAll("expenses"), DB.getAll("products")]);
  const totalSales = sales.reduce((a, s) => a + Number(s.total || 0), 0);
  const totalProfit = sales.reduce((a, s) => a + Number(s.profit || 0), 0);
  const totalExpenses = expenses.reduce((a, e) => a + Number(e.amount || 0), 0);
  const stockValue = products.reduce((a, p) => a + Number(p.costPrice || 0) * Number(p.qty || 0), 0);
  const html = `
  <div class="page">
    <h2>Reports</h2>
    <div class="card"><div class="l-sub">Total Sales</div><div class="l-title" style="font-size:20px">${fmt(totalSales)}</div></div>
    <div class="card"><div class="l-sub">Total Profit</div><div class="l-title" style="font-size:20px">${fmt(totalProfit)}</div></div>
    <div class="card"><div class="l-sub">Total Expenses</div><div class="l-title" style="font-size:20px">${fmt(totalExpenses)}</div></div>
    <div class="card"><div class="l-sub">Net (Profit − Expenses)</div><div class="l-title" style="font-size:20px">${fmt(totalProfit - totalExpenses)}</div></div>
    <div class="card"><div class="l-sub">Current Stock Value</div><div class="l-title" style="font-size:20px">${fmt(stockValue)}</div></div>
    <button class="btn full ghost" id="rep-export">Export Sales as CSV</button>
    <button class="btn full" id="expenses-btn" style="margin-top:10px">Manage Expenses</button>
  </div>`;
  root.innerHTML = shell("reports", html);
  document.getElementById("expenses-btn").onclick = () => location.hash = "#/expenses";
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
      <div class="l-sub">${window.SMSync && window.SMSync.isReady() ? "🟢 Connected — data syncs in real time." : "⚪ Not configured. Add your Firebase config in js/firebase-sync.js and uncomment the SDK script tags in index.html to enable real-time cloud sync."}</div>
    </div>
    ${state.user.role === "admin" ? `
    <div class="card">
      <div class="l-title" style="margin-bottom:10px">Management</div>
      <button class="btn full ghost" style="margin-bottom:8px" onclick="location.hash='#/staff'">👨‍💼 Staff & Roles</button>
      <button class="btn full ghost" style="margin-bottom:8px" onclick="location.hash='#/purchase-orders'">🚚 Purchase Orders</button>
      <button class="btn full ghost" style="margin-bottom:8px" onclick="location.hash='#/cashbook'">💵 Cash Book / Daily Closing</button>
      <button class="btn full ghost" onclick="location.hash='#/audit-logs'">📋 Audit Logs</button>
    </div>
    <div class="card">
      <div class="l-title" style="margin-bottom:6px">Import Products (CSV)</div>
      <div class="l-sub" style="margin-bottom:8px">Columns: name,category,costPrice,salePrice,qty,reorderLevel</div>
      <input type="file" id="csv-import" accept=".csv" />
    </div>` : ""}
    <button class="btn full ghost" id="set-logout">Logout</button>
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
    state.user = null;
    await DB.remove("settings", "session");
    location.hash = "";
    router();
  };
  const csvInput = document.getElementById("csv-import");
  if (csvInput) csvInput.onchange = (e) => importProductsCSV(e.target.files[0]);
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
  const html = `
  <div class="page">
    <h2>Cash Book / Daily Closing</h2>
    ${days.length ? days.map((d) => `
      <div class="card">
        <div class="l-title">${d}</div>
        <div class="l-sub">Cash In: ${fmt(byDay[d].in)} · Cash Out: ${fmt(byDay[d].out)}</div>
        <div style="font-weight:700;margin-top:4px">Net: ${fmt(byDay[d].in - byDay[d].out)}</div>
      </div>`).join("") : `<div class="empty">No cash movements recorded yet.</div>`}
  </div>`;
  root.innerHTML = shell("settings", html);
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
window.addEventListener("sm:queued", async () => { window._pendingCount = await DB.pendingSyncCount(); });
window.addEventListener("sm:synced", async () => { window._pendingCount = await DB.pendingSyncCount(); router(); });
window.addEventListener("online", () => router());
window.addEventListener("offline", () => router());

(async function boot() {
  await tryRestoreSession();
  window._pendingCount = await DB.pendingSyncCount();
  router();
})();
