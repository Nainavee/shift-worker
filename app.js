// ════════════════════════════════════════════════════════════════
//  Work Tracker · app.js
//  Firebase Firestore + full app logic
// ════════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── ⚙️  PASTE YOUR FIREBASE CONFIG HERE ─────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCoc1yKIXIxDknoEcGuhkbJUUFFbbv48Is",
  authDomain: "shift-tracker-14594.firebaseapp.com",
  projectId: "shift-tracker-14594",
  storageBucket: "shift-tracker-14594.firebasestorage.app",
  messagingSenderId: "542544109932",
  appId: "1:542544109932:web:53e51382a352f15b465349",
};
// ────────────────────────────────────────────────────────────────

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ── Constants ────────────────────────────────────────────────────
const RATES = { cash: 21, tfn: 33, post: 20 };
const LABELS = { cash: "Mad Mex Cash", tfn: "Mad Mex TFN", post: "Post" };
const CAT_ICONS = { transport: "🚌", food: "🍔", clothing: "👕", other: "📦" };

// ── State ─────────────────────────────────────────────────────────
let shifts = [];
let expenses = [];
let selectedJob = "cash";
let selectedCat = "transport";
let activeTab = "schedule";
let currentWeekOffset = 0;
let payPeriodFilter = "upcoming";
let jobFilter = "all";
let expFilter = "all";
let pendingDeleteId = null;
let pendingDeleteType = null; // 'shift' | 'expense'

// ── Firebase sync indicator ───────────────────────────────────────
function setSyncState(state) {
  const dot = document.getElementById("sync-dot");
  dot.className = "sync-dot " + state;
}

// ── Firestore listeners ───────────────────────────────────────────
function initFirestore() {
  // Shifts
  onSnapshot(
    collection(db, "shifts"),
    (snap) => {
      shifts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderAll();
      setSyncState("ok");
    },
    (err) => {
      console.error("Shifts sync error:", err);
      setSyncState("err");
    },
  );

  // Expenses
  onSnapshot(
    collection(db, "expenses"),
    (snap) => {
      expenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderExpenses();
      renderPayNetBar();
      setSyncState("ok");
    },
    (err) => {
      console.error("Expenses sync error:", err);
      setSyncState("err");
    },
  );
}

// ── Time helpers ──────────────────────────────────────────────────
function generateTimeOptions() {
  const times = [];
  for (let h = 6; h <= 23; h++) {
    for (let m = 0; m < 60; m += 15) {
      times.push({ h, m });
    }
  }
  // Add midnight (0:00)
  times.push({ h: 0, m: 0 });
  return times;
}

function formatTime(h, m) {
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const displayM = m === 0 ? "00" : m;
  return `${displayH}:${displayM} ${period}`;
}

function buildTimeDropdowns() {
  const times = generateTimeOptions();
  const startSel = document.getElementById("shift-start");
  const endSel = document.getElementById("shift-end");

  startSel.innerHTML = "";
  endSel.innerHTML = "";

  times.forEach(({ h, m }) => {
    const label = formatTime(h, m);
    const val = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    startSel.innerHTML += `<option value="${val}">${label}</option>`;
    endSel.innerHTML += `<option value="${val}">${label}</option>`;
  });

  // Defaults: start 2 PM, end 8 PM
  startSel.value = "15:30";
  endSel.value = "20:00";

  startSel.addEventListener("change", updatePreview);
  endSel.addEventListener("change", updatePreview);
  updatePreview();
}

function calcHours(startVal, endVal) {
  const [sh, sm] = startVal.split(":").map(Number);
  const [eh, em] = endVal.split(":").map(Number);
  let startMins = sh * 60 + sm;
  let endMins = eh * 60 + em;
  if (endMins <= startMins) endMins += 24 * 60; // past midnight
  return (endMins - startMins) / 60;
}

function updatePreview() {
  const start = document.getElementById("shift-start").value;
  const end = document.getElementById("shift-end").value;
  const hours = calcHours(start, end);
  const earn = hours * RATES[selectedJob];
  const preview = document.getElementById("shift-preview");
  preview.style.display = "block";
  document.getElementById("preview-hours").textContent =
    hours.toFixed(2) + " hrs";
  document.getElementById("preview-earn").textContent = "$" + earn.toFixed(2);
}

// ── Init ──────────────────────────────────────────────────────────
function init() {
  setSyncState("syncing");
  buildTimeDropdowns();
  setTodayDate();

  // Pre-seed default date for expense
  document.getElementById("exp-date").value = todayStr();

  // Seed Post shifts (April 2026) if first time — handled by Firestore; we seed once
  seedPostShifts();

  initFirestore();
  hideLoader();
  selectJob("cash");
}

function setTodayDate() {
  const today = new Date();
  const iso = today.toISOString().split("T")[0];
  document.getElementById("shift-date").value = iso;
}

function todayStr() {
  return formatDateInput(new Date());
}

// ── Seed legacy Post shifts (once) ───────────────────────────────
async function seedPostShifts() {
  const postShifts = [
    {
      id: "post-20apr",
      date: "2026-04-20",
      start: "09:00",
      end: "14:00",
      hours: 5,
      job: "post",
      earn: 100,
      paid: true,
    },
    {
      id: "post-22apr",
      date: "2026-04-22",
      start: "09:00",
      end: "14:30",
      hours: 5.5,
      job: "post",
      earn: 110,
      paid: true,
    },
  ];

  for (const s of postShifts) {
    try {
      const ref = doc(db, "shifts", s.id);
      // Only write if doesn't exist — onSnapshot will handle it
      await setDoc(
        ref,
        {
          date: s.date,
          start: s.start,
          end: s.end,
          hours: s.hours,
          job: s.job,
          earn: s.earn,
          paid: s.paid,
          createdAt: serverTimestamp(),
        },
        { merge: false },
      );
    } catch (_) {
      // Already seeded or Firebase not configured — silently ignore
    }
  }
}

// ── Loader ────────────────────────────────────────────────────────
function hideLoader() {
  setTimeout(() => {
    document.getElementById("loader").classList.add("hidden");
  }, 800);
}

// ── Tab switching ─────────────────────────────────────────────────
window.switchTab = function (tab) {
  const order = ["schedule", "pay", "expenses"];
  const prev = activeTab;
  activeTab = tab;

  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });

  const prevIdx = order.indexOf(prev);
  const nextIdx = order.indexOf(tab);
  const goRight = nextIdx > prevIdx;

  order.forEach((key) => {
    const el = document.getElementById("page-" + key);
    el.classList.remove("active", "slide-left");
    if (key === tab) {
      el.classList.add("active");
    } else if (key === prev && goRight) {
      el.classList.add("slide-left");
    }
  });

  if (tab === "pay") renderPay();
  if (tab === "expenses") renderExpenses();
};

// ── Job selection ─────────────────────────────────────────────────
window.selectJob = function (job) {
  selectedJob = job;
  document.querySelectorAll(".shift-pill").forEach((p) => {
    p.classList.toggle("selected", p.dataset.job === job);
  });
  updatePreview();
};

// ── Category selection ────────────────────────────────────────────
window.selectCat = function (cat) {
  selectedCat = cat;
  document.querySelectorAll(".cat-pill").forEach((p) => {
    p.classList.toggle("selected", p.dataset.cat === cat);
  });
};

// ── Add shift ─────────────────────────────────────────────────────
window.addShift = async function () {
  const date = document.getElementById("shift-date").value;
  const start = document.getElementById("shift-start").value;
  const end = document.getElementById("shift-end").value;

  if (!date) {
    toast("Please pick a date");
    return;
  }

  const hours = calcHours(start, end);
  if (hours <= 0) {
    toast("End must be after start");
    return;
  }

  const earn = parseFloat((hours * RATES[selectedJob]).toFixed(2));
  const id = "shift-" + Date.now();

  setSyncState("syncing");
  try {
    await setDoc(doc(db, "shifts", id), {
      date,
      start,
      end,
      hours,
      job: selectedJob,
      earn,
      paid: false,
      createdAt: serverTimestamp(),
    });
    toast("Shift added ✓");
  } catch (e) {
    console.error(e);
    toast("Error — check Firebase config");
    setSyncState("err");
  }
};

// ── Delete shift (modal) ──────────────────────────────────────────
window.confirmDelete = function (id, type) {
  pendingDeleteId = id;
  pendingDeleteType = type;
  document.getElementById("modal-title").textContent =
    type === "shift" ? "Delete shift?" : "Delete expense?";
  document.getElementById("modal-body").textContent = "This cannot be undone.";
  document.getElementById("modal-confirm-btn").onclick = executeDelete;
  document.getElementById("modal-overlay").classList.add("open");
};

window.closeModal = function () {
  document.getElementById("modal-overlay").classList.remove("open");
  pendingDeleteId = null;
  pendingDeleteType = null;
};

async function executeDelete() {
  const id = pendingDeleteId;
  const type = pendingDeleteType;
  closeModal();
  if (!id) return;
  setSyncState("syncing");
  try {
    const col = type === "shift" ? "shifts" : "expenses";
    await deleteDoc(doc(db, col, id));
    toast((type === "shift" ? "Shift" : "Expense") + " deleted");
  } catch (e) {
    console.error(e);
    setSyncState("err");
    toast("Delete failed");
  }
}

// ── Toggle paid status ────────────────────────────────────────────
window.togglePaid = async function (id) {
  const shift = shifts.find((s) => s.id === id);
  if (!shift) return;
  setSyncState("syncing");
  try {
    await setDoc(doc(db, "shifts", id), { paid: !shift.paid }, { merge: true });
    toast(shift.paid ? "Marked unpaid" : "Marked as paid ✓");
  } catch (e) {
    console.error(e);
    setSyncState("err");
  }
};

// ── Week nav ──────────────────────────────────────────────────────
window.changeWeek = function (delta) {
  currentWeekOffset += delta;
  renderWeek();
  renderUpcomingList();
};

function getWeekStart(offset = 0) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  return monday;
}

function formatDateInput(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Render all (schedule page) ────────────────────────────────────
function renderAll() {
  renderWeek();
  renderUpcomingList();
  if (activeTab === "pay") renderPay();
}

function renderWeek() {
  const ws = getWeekStart(currentWeekOffset);
  const we = new Date(ws);
  we.setDate(ws.getDate() + 7);
  const weStr = formatDateInput(we);
  const wsStr = formatDateInput(ws);

  // Label
  const opts = { day: "numeric", month: "short" };
  const wEnd = new Date(ws);
  wEnd.setDate(ws.getDate() + 6);
  document.getElementById("week-label").textContent =
    currentWeekOffset === 0
      ? "This week"
      : `${ws.toLocaleDateString("en-AU", opts)} – ${wEnd.toLocaleDateString("en-AU", opts)}`;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  const container = document.getElementById("sched-week");
  container.innerHTML = "";

  for (let i = 0; i < 7; i++) {
    const d = new Date(ws);
    d.setDate(ws.getDate() + i);
    const ds = formatDateInput(d);
    const dayShifts = shifts.filter((s) => s.date === ds);
    const isToday = d.getTime() === today.getTime();

    const dots = dayShifts
      .map((s) => {
        const cls =
          s.job === "post"
            ? "dot-post"
            : s.job === "cash"
              ? "dot-cash"
              : "dot-tfn";
        return `<div class="day-dot ${cls}"></div>`;
      })
      .join("");

    const numClass = [
      "day-num",
      isToday ? "today" : "",
      dayShifts.length ? "has-shift" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const fgColor = isToday
      ? ""
      : dayShifts.length === 1
        ? dayShifts[0].job === "post"
          ? "var(--post-fg)"
          : dayShifts[0].job === "cash"
            ? "var(--cash-fg)"
            : "var(--tfn-fg)"
        : "var(--text)";

    container.innerHTML += `
      <div class="day-col">
        <div class="day-label">${days[i]}</div>
        <div class="${numClass}" style="${fgColor ? "color:" + fgColor : ""}">${d.getDate()}</div>
        <div class="day-dots">${dots}</div>
      </div>`;
  }
}

function renderUpcomingList() {
  const ws = getWeekStart(currentWeekOffset);
  const we = new Date(ws);
  we.setDate(ws.getDate() + 7);
  const wsStr = formatDateInput(ws);
  const weStr = formatDateInput(we);

  const week = shifts
    .filter((s) => s.date >= wsStr && s.date < weStr)
    .sort(
      (a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start),
    );

  const el = document.getElementById("upcoming-list");
  if (!week.length) {
    el.innerHTML = `<div class="empty-state"><div class="es-icon">🗓️</div><p>No shifts this week</p></div>`;
    return;
  }
  el.innerHTML = week.map((s) => shiftHTML(s, true)).join("");
}

// ── Pay page ──────────────────────────────────────────────────────
window.setPayPeriod = function (period, btn) {
  payPeriodFilter = period;
  document
    .querySelectorAll("#chip-upcoming, #chip-paid, #chip-all-pay")
    .forEach((c) => c.classList.remove("active"));
  btn.classList.add("active");
  renderPay();
};

window.setJobFilter = function (job, btn) {
  jobFilter = job;
  const filterRows = document.querySelectorAll("#page-pay .filter-row");
  if (filterRows[1]) {
    filterRows[1]
      .querySelectorAll(".chip")
      .forEach((c) => c.classList.remove("active"));
  }
  btn.classList.add("active");
  renderPay();
};

function renderPay() {
  const now = new Date();

  const filteredByPeriod = (job) =>
    shifts.filter((s) => {
      const [eh, em] = s.end.split(":").map(Number);
      const endDt = new Date(s.date + "T" + s.end);
      const typeMatch = !job || s.job === job;

      let periodMatch = true;
      if (payPeriodFilter === "upcoming") periodMatch = !s.paid;
      else if (payPeriodFilter === "paid") periodMatch = s.paid;

      return typeMatch && periodMatch;
    });

  const calc = (job) => {
    const arr = filteredByPeriod(job);
    return {
      earn: arr.reduce((a, c) => a + c.earn, 0),
      hrs: arr.reduce((a, c) => a + c.hours, 0),
    };
  };

  const total = calc(null);
  const post = calc("post");
  const cash = calc("cash");
  const tfn = calc("tfn");

  document.getElementById("sum-total").textContent =
    "$" + total.earn.toFixed(2);
  document.getElementById("sum-hours").textContent =
    total.hrs.toFixed(1) + " hrs";
  document.getElementById("sum-post").textContent = "$" + post.earn.toFixed(2);
  document.getElementById("sum-post-h").textContent =
    post.hrs.toFixed(1) + " hrs";
  document.getElementById("sum-cash").textContent = "$" + cash.earn.toFixed(2);
  document.getElementById("sum-cash-h").textContent =
    cash.hrs.toFixed(1) + " hrs";
  document.getElementById("sum-tfn").textContent = "$" + tfn.earn.toFixed(2);
  document.getElementById("sum-tfn-h").textContent =
    tfn.hrs.toFixed(1) + " hrs";

  renderPayNetBar();

  // List
  const filtered = shifts
    .filter((s) => {
      const jobMatch = jobFilter === "all" || s.job === jobFilter;
      let periodMatch = true;
      if (payPeriodFilter === "upcoming") periodMatch = !s.paid;
      else if (payPeriodFilter === "paid") periodMatch = s.paid;
      return jobMatch && periodMatch;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const el = document.getElementById("pay-list");
  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state"><div class="es-icon">💸</div><p>No shifts here.<br>Add one on the Shifts tab.</p></div>`;
    return;
  }

  let html = "";
  let lastMonth = "";
  filtered.forEach((s) => {
    const month = new Date(s.date + "T00:00").toLocaleDateString("en-AU", {
      month: "long",
      year: "numeric",
    });
    if (month !== lastMonth) {
      html += `<div class="month-header">${month}</div>`;
      lastMonth = month;
    }
    html += shiftHTML(s, false, true);
  });
  el.innerHTML = html;
}

function renderPayNetBar() {
  const totalEarned = shifts.reduce((a, s) => a + s.earn, 0);
  const totalExp = expenses.reduce((a, e) => a + e.amount, 0);
  const net = totalEarned - totalExp;
  document.getElementById("net-amount").textContent = "$" + net.toFixed(2);
}

// ── Shift HTML ────────────────────────────────────────────────────
function shiftHTML(s, showDel = true, showPayToggle = false) {
  const dotClass =
    s.job === "post" ? "dot-post" : s.job === "cash" ? "dot-cash" : "dot-tfn";
  const dateStr = new Date(s.date + "T00:00").toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const st = formatTimeStr(s.start);
  const en = formatTimeStr(s.end);
  const badge = s.paid
    ? `<span class="si-badge badge-paid">Paid</span>`
    : `<span class="si-badge badge-upcoming">Unpaid</span>`;
  const delBtn = showDel
    ? `<button class="shift-del" onclick="confirmDelete('${s.id}', 'shift')" title="Delete">×</button>`
    : "";
  const payBtn = showPayToggle
    ? `<button class="shift-pay-toggle" onclick="togglePaid('${s.id}')" title="${s.paid ? "Mark unpaid" : "Mark paid"}">${s.paid ? "↩" : "✓"}</button>`
    : "";

  return `
    <div class="shift-item">
      <div class="shift-dot ${dotClass}"></div>
      <div class="shift-info">
        <div class="si-top">
          <span class="si-job">${LABELS[s.job]}</span>
          <span class="si-date">${dateStr}</span>
          ${badge}
        </div>
        <div class="si-time">${st} – ${en} · ${s.hours.toFixed(2)} hrs</div>
      </div>
      <div class="shift-earn">$${s.earn.toFixed(2)}</div>
      <div class="shift-actions">${payBtn}${delBtn}</div>
    </div>`;
}

function formatTimeStr(t) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return formatTime(h, m);
}

// ── Expenses ──────────────────────────────────────────────────────
window.addExpense = async function () {
  const desc = document.getElementById("exp-desc").value.trim();
  const amountRaw = document.getElementById("exp-amount").value;
  const date = document.getElementById("exp-date").value;
  const amount = parseFloat(amountRaw);

  if (!desc) {
    toast("Add a description");
    return;
  }
  if (!amountRaw || isNaN(amount) || amount <= 0) {
    toast("Enter a valid amount");
    return;
  }
  if (!date) {
    toast("Pick a date");
    return;
  }

  const id = "exp-" + Date.now();
  setSyncState("syncing");
  try {
    await setDoc(doc(db, "expenses", id), {
      desc,
      amount,
      date,
      cat: selectedCat,
      createdAt: serverTimestamp(),
    });
    document.getElementById("exp-desc").value = "";
    document.getElementById("exp-amount").value = "";
    document.getElementById("exp-date").value = todayStr();
    toast("Expense added ✓");
  } catch (e) {
    console.error(e);
    setSyncState("err");
    toast("Error — check Firebase config");
  }
};

window.setExpFilter = function (cat, btn) {
  expFilter = cat;
  const row = document.querySelector(
    "#page-expenses .filter-row:nth-of-type(1)",
  );
  if (row)
    row.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
  btn.classList.add("active");
  renderExpenses();
};

function renderExpenses() {
  // Summary
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthExp = expenses.filter(
    (e) => e.date && e.date.startsWith(thisMonth),
  );
  const totalExp = monthExp.reduce((a, e) => a + e.amount, 0);
  const totalEarned = shifts.reduce((a, s) => a + s.earn, 0);

  document.getElementById("exp-total").textContent = "$" + totalExp.toFixed(2);
  document.getElementById("exp-net").textContent =
    "$" + (totalEarned - expenses.reduce((a, e) => a + e.amount, 0)).toFixed(2);

  // List
  const filtered = expenses
    .filter((e) => expFilter === "all" || e.cat === expFilter)
    .sort((a, b) => b.date.localeCompare(a.date));

  const el = document.getElementById("exp-list");
  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state"><div class="es-icon">🧾</div><p>No expenses yet.</p></div>`;
    return;
  }

  let html = "";
  let lastMonth = "";
  filtered.forEach((e) => {
    const month = new Date(e.date + "T00:00").toLocaleDateString("en-AU", {
      month: "long",
      year: "numeric",
    });
    if (month !== lastMonth) {
      html += `<div class="month-header">${month}</div>`;
      lastMonth = month;
    }
    const dateStr = new Date(e.date + "T00:00").toLocaleDateString("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    const icon = CAT_ICONS[e.cat] || "📦";
    html += `
      <div class="exp-item">
        <div class="exp-icon">${icon}</div>
        <div class="exp-info">
          <div class="exp-desc">${e.desc}</div>
          <div class="exp-meta">${dateStr}</div>
        </div>
        <div class="exp-amount">$${e.amount.toFixed(2)}</div>
        <button class="exp-del" onclick="confirmDelete('${e.id}', 'expense')">×</button>
      </div>`;
  });
  el.innerHTML = html;
}

// ── Toast ──────────────────────────────────────────────────────────
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2400);
}

// ── Boot ───────────────────────────────────────────────────────────
init();
