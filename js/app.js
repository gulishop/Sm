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
  "": renderDashboard,
  "dashboard": renderDashboard,
  "pos": renderPOS,
  "products": renderProducts,
  "customers": renderCustomers,
  "repairs": renderRepairs,
  "installments": renderInstallments,
  "suppliers": renderSuppliers,
  "expenses": renderExpenses,
  "reports": renderReports,
  "settings": renderSettings,
};

async function router() {
  if (!state.user) { renderLogin(); return; }
  const hash = location.hash.replace("#/", "").split("?")[0];
  const fn = routes[hash] || renderDashboard;
  root.innerHTML = `<div id="page-slot"></div>`;
  await fn();
}
window.addEventListener("hashchange", router);

// ---------- Login ----------
function renderLogin() {
  root.innerHTML = `
  <div class="login-screen">
    <img src="icons/icon-512.png" class="login-logo" alt="logo" />
    <div class="login-title">SANAULLAH</div>
    <div class="login-sub">MOBILE COMMUNICATION</div>
    <div class="field"><input id="li-user" placeholder="Email or Phone" /></div>
    <div class="field"><input id="li-pass" type="password" placeholder="Password" /></div>
    <button class="btn-primary" id="li-btn">LOGIN</button>
    <button class="btn-secondary" id="li-guest">Continue as Admin (Demo)</button>
  </div>`;
  document.getElementById("li-btn").onclick = doLogin;
  document.getElementById("li-guest").onclick = doLogin;
}

async function doLogin() {
  state.user = { name: "Admin" };
  await DB.put("settings", { id: "session", user: state.user });
  location.hash = "#/dashboard";
  router();
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
  <div class="sync-status">${navigator.onLine ? "🟢 Online" : "🟠 Offline"} ${pending ? "· " + pending + " pending sync" : "· synced"}</div>
  ${innerHtml}
  <div class="bottomnav">
    ${navBtn("dashboard", "🏠", "Dashboard", activeTab)}
    ${navBtn("pos", "🛒", "Sales", activeTab)}
    ${navBtn("products", "📦", "Products", activeTab)}
    ${navBtn("reports", "📊", "Reports", activeTab)}
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
        <select id="pos-product">
          <option value="">Select product…</option>
          ${products.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} — ${fmt(p.salePrice)} (Stock: ${p.qty})</option>`).join("")}
        </select></div>
      <button class="btn full" id="pos-add">Add to Cart</button>
    </div>
    <div class="card" id="pos-cart"></div>
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
  const total = cart.reduce((a, c) => a + c.price * c.qty, 0);
  const profit = cart.reduce((a, c) => a + (c.price - c.cost) * c.qty, 0);
  const invoiceNo = "INV-" + (10000 + (await DB.getAll("sales")).length + 1);
  const sale = { invoiceNo, customerId: custId || null, customerName: cust ? cust.name : "Walk-in Customer", items: cart, total, profit, date: new Date().toISOString() };
  await DB.put("sales", sale);
  for (const item of cart) {
    const p = products.find((x) => x.id === item.id);
    if (p) { p.qty = Math.max(0, Number(p.qty) - item.qty); await DB.put("products", p); }
  }
  cart = [];
  toast("Invoice " + invoiceNo + " created");
  location.hash = "#/dashboard";
}

// ---------- Generic list-page builder for simple CRUD modules ----------
function moduleListPage(opts) {
  // opts: {title, store, activeTab, fields[], renderRow(item), emptyText}
  return async function render() {
    const items = (await DB.getAll(opts.store)).sort((a, b) => b.updatedAt - a.updatedAt);
    const html = `
    <div class="page">
      <h2>${opts.title}</h2>
      <div class="search-bar"><input id="mod-search" placeholder="Search ${opts.title.toLowerCase()}…" /></div>
      <div id="mod-list">${items.length ? items.map(opts.renderRow).join("") : `<div class="empty">${opts.emptyText}</div>`}</div>
    </div>
    <button class="fab" id="mod-add">+</button>`;
    root.innerHTML = shell(opts.activeTab, html);
    document.getElementById("mod-add").onclick = () => openForm(opts, null);
    document.getElementById("mod-search").oninput = (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = items.filter((it) => JSON.stringify(it).toLowerCase().includes(q));
      document.getElementById("mod-list").innerHTML = filtered.length ? filtered.map(opts.renderRow).join("") : `<div class="empty">No matches</div>`;
    };
  };
}

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
  overlay.querySelector("#form-cancel").onclick = () => overlay.remove();
  overlay.querySelector("#form-save").onclick = async () => {
    const record = existing ? { ...existing } : {};
    opts.fields.forEach((f) => {
      const v = overlay.querySelector("#f-" + f.key).value;
      record[f.key] = f.type === "number" ? Number(v || 0) : v;
    });
    if (opts.beforeSave) opts.beforeSave(record);
    await DB.put(opts.store, record);
    overlay.remove();
    toast("Saved");
    router();
  };
  if (existing) {
    overlay.querySelector("#form-del").onclick = async () => {
      await DB.remove(opts.store, existing.id);
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
    <div style="text-align:right"><div class="l-title">${fmt(p.salePrice)}</div>${Number(p.qty) <= Number(p.reorderLevel || 5) ? `<span class="pill bad">Low</span>` : `<span class="pill ok">OK</span>`}</div></div>`
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
      <div><div class="l-title">${escapeHtml(c.name)}</div><div class="l-sub">${escapeHtml(c.phone || "")}</div></div></div></div>`
};
window.customersOpts = customersOpts;
const renderCustomers = moduleListPage(customersOpts);

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
    <button class="btn full ghost" id="set-logout">Logout</button>
  </div>`;
  root.innerHTML = shell("settings", html);
  document.getElementById("set-theme").onchange = (e) => {
    state.theme = e.target.value;
    localStorage.setItem("sm_theme", state.theme);
    document.documentElement.setAttribute("data-theme", state.theme);
  };
  document.getElementById("set-logout").onclick = async () => {
    state.user = null;
    await DB.remove("settings", "session");
    location.hash = "";
    router();
  };
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
