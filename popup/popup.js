// AutoApplier popup
// Fetches and lists open projects from mostaql.com/projects and applies to them.

const PROJECTS_URL = "https://mostaql.com/projects";
const DEFAULT_SETTINGS = {
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  portfolioUrl: "https://mostaql.com/u/tobok/portfolio",
  freelancerName: "",
  extraInstructions: ""
};

let appliedIds = new Set();

const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const refreshBtn = document.getElementById("refreshBtn");
const settingsBtn = document.getElementById("settingsBtn");
const openProjectsBtn = document.getElementById("openProjectsBtn");

refreshBtn.addEventListener("click", init);
settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
openProjectsBtn.addEventListener("click", () => chrome.tabs.create({ url: PROJECTS_URL }));

function setStatus(kind, text) {
  if (!text) {
    statusEl.classList.add("hidden");
    statusEl.textContent = "";
    return;
  }
  statusEl.className = "status " + kind;
  statusEl.textContent = text;
}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function getSettings() {
  const data = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
}

function parseProjects(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = doc.querySelectorAll("tr.project-row");
  const projects = [];
  rows.forEach((row) => {
    const titleLink = row.querySelector('.card--title h2 a[href*="/project/"]');
    if (!titleLink) return;
    const brief = row.querySelector("p.project__brief a.details-url");
    let bids = "";
    let time = "";
    row.querySelectorAll("ul.project__meta li").forEach((li) => {
      const t = li.textContent.replace(/\s+/g, " ").trim();
      if (/عرض/.test(t)) bids = t;
      if (/منذ|ساعة|يوم|دقيقة|أسبوع|شهر/.test(t)) time = t;
    });
    const id = (titleLink.href.match(/\/project\/(\d+)/) || [])[1] || "";
    projects.push({
      id,
      title: titleLink.textContent.replace(/\s+/g, " ").trim(),
      url: titleLink.href,
      description: brief ? brief.textContent.replace(/\s+/g, " ").trim() : "",
      bids,
      time
    });
  });
  return projects;
}

function renderList(projects) {
  listEl.innerHTML = "";
  if (!projects.length) {
    listEl.innerHTML =
      '<div class="empty">لم يتم العثور على مشاريع.<br/>تأكد من وجود اتصال بالإنترنت أو افتح <a class="btn" href="https://mostaql.com/projects" target="_blank">صفحة المشاريع</a></div>';
    return;
  }

  projects.forEach((p) => {
    const applied = appliedIds.has(String(p.id));
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="title">${escapeHtml(p.title)}</div>
      <div class="meta">
        ${p.bids ? `<span>${escapeHtml(p.bids)}</span>` : ""}
        ${p.time ? `<span>${escapeHtml(p.time)}</span>` : ""}
      </div>
      <div class="desc">${escapeHtml(p.description)}</div>
      <div class="row">
        <a class="open-link" href="${escapeHtml(p.url)}" target="_blank">فتح</a>
        ${
          applied
            ? '<span class="applied">✓ تم التقديم</span>'
            : '<button class="apply" data-id="' + escapeHtml(p.id) + '">تقديم عرض</button>'
        }
      </div>`;
    listEl.appendChild(card);
  });

  listEl.querySelectorAll("button.apply").forEach((btn) => {
    btn.addEventListener("click", () => applyTo(btn, projects));
  });
}

async function applyTo(btn, projects) {
  const id = btn.dataset.id;
  const project = projects.find((p) => String(p.id) === String(id));
  if (!project) return;

  btn.disabled = true;
  btn.textContent = "جاري الفتح...";

  await chrome.storage.local.set({ pendingApply: project });
  await chrome.tabs.create({ url: project.url, active: true });

  // record history
  const data = await chrome.storage.local.get("appliedIds");
  const ids = data.appliedIds || [];
  if (!ids.includes(id)) {
    ids.push(id);
    await chrome.storage.local.set({ appliedIds: ids });
  }
  appliedIds.add(id);

  window.close();
}

async function loadAppliedIds() {
  const data = await chrome.storage.local.get("appliedIds");
  (data.appliedIds || []).forEach((id) => appliedIds.add(String(id)));
}

async function init() {
  setStatus();
  const settings = await getSettings();

  if (!settings.apiKey) {
    listEl.innerHTML =
      '<div class="empty">لم يتم ضبط مفتاح الـ API بعد.<br/>اضبطه في صفحة الإعدادات أولاً.</div>';
    setStatus("info", "افتح الإعدادات وأدخل مفتاح API للذكاء الاصطناعي.");
    return;
  }

  listEl.innerHTML = '<div class="loader"><span class="spin"></span>جارٍ تحميل المشاريع...</div>';

  let html;
  try {
    const resp = await fetch(PROJECTS_URL, { credentials: "include" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    html = await resp.text();
  } catch (err) {
    setStatus("error", "تعذر تحميل المشاريع: " + String(err));
    listEl.innerHTML = "";
    return;
  }

  const projects = parseProjects(html);
  renderList(projects);
}

loadAppliedIds().then(init);
