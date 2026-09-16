// AutoApplier content script (runs on mostaql.com)
// Scrapes the projects list + project details, generates the proposal via background,
// fills the bid form and submits it after a review overlay.

(() => {
  const MQ_HOST = "mostaql.com";

  let selectedFiles = [];

  // ---------- helpers ----------
  function isProjectsList() {
    return !!document.querySelector("tr.project-row");
  }

  function isProjectDetail() {
    return /\/project\/\d+/.test(window.location.pathname);
  }

  function projectIdFromUrl(url) {
    const m = String(url || "").match(/\/project\/(\d+)/);
    return m ? m[1] : null;
  }

  function cleanText(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  // ---------- scraping ----------
  function scrapeProjectList() {
    const rows = document.querySelectorAll("tr.project-row");
    const projects = [];
    rows.forEach((row) => {
      const titleLink = row.querySelector('.card--title h2 a[href*="/project/"]');
      if (!titleLink) return;
      const brief = row.querySelector("p.project__brief a.details-url");
      let bids = "";
      let time = "";
      const metaItems = row.querySelectorAll("ul.project__meta li");
      metaItems.forEach((li) => {
        const t = cleanText(li.textContent);
        if (/عرض/.test(t)) bids = t;
        if (/منذ|ساعة|يوم|دقيقة|أسبوع|شهر/.test(t)) time = t;
      });
      projects.push({
        id: projectIdFromUrl(titleLink.href),
        title: cleanText(titleLink.textContent),
        url: titleLink.href,
        description: brief ? cleanText(brief.textContent) : "",
        bids,
        time
      });
    });
    return projects;
  }

  function metaValue(label) {
    const rows = document.querySelectorAll(".meta-row");
    for (const r of rows) {
      const lab = r.querySelector(".meta-label");
      if (lab && cleanText(lab.textContent) === label) {
        const v = r.querySelector(".meta-value");
        return v ? cleanText(v.textContent) : "";
      }
    }
    return "";
  }

  function scrapeProjectDetail() {
    const titleEl = document.querySelector("h1.heada__title") || document.querySelector('span[data-type="page-header-title"]');
    const descEl = document.querySelector("#projectDetailsTab .text-wrapper-div") || document.querySelector("#project-brief");
    const skills = Array.from(document.querySelectorAll("#project-meta-panel ul.skills li.skills__item a.tag bdi")).map(
      (el) => cleanText(el.textContent)
    );

    let csrf = "";
    try {
      if (window.Mostaql && window.Mostaql.config && window.Mostaql.config.csrfToken) {
        csrf = window.Mostaql.config.csrfToken;
      }
    } catch (e) {}
    if (!csrf) {
      const tokenInput = document.querySelector('input[name="_token"]');
      if (tokenInput) csrf = tokenInput.value;
    }

    const loginLink = document.querySelector('#add-bid a[href*="/login"], #add-bid a[href*="/register"]');

    let minCost = "";
    try {
      if (window.costValidationMinValue) minCost = window.costValidationMinValue;
    } catch (e) {}

    return {
      id: projectIdFromUrl(window.location.href),
      title: cleanText(titleEl ? titleEl.textContent : document.title),
      description: descEl ? cleanText(descEl.textContent) : "",
      budget: metaValue("الميزانية"),
      deliveryTime: metaValue("مدة التنفيذ"),
      status: metaValue("حالة المشروع"),
      skills: skills.join("، "),
      category: cleanText(
        (document.querySelector('.breadcrumb-item[data-index="2"] a') || {}).textContent || ""
      ),
      csrf,
      minCost,
      loggedIn: !loginLink,
      hasBidForm: !!locateBidForm()
    };
  }

  // ---------- bid form ----------
  function isField(el) {
    return el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
  }

  function byLabel(scope, labelText) {
    const labels = scope.querySelectorAll("label");
    for (const label of labels) {
      const text = cleanText(label.textContent);
      if (!text || text.indexOf(labelText) === -1) continue;
      if (label.htmlFor) {
        try {
          const el = scope.querySelector("#" + CSS.escape(label.htmlFor));
          if (isField(el)) return el;
        } catch (e) {}
      }
      const wrapped = label.querySelector("input, textarea, select");
      if (isField(wrapped)) return wrapped;
      const container = (label.closest && label.closest(".form-group")) || label.parentElement;
      if (container) {
        const inContainer = container.querySelector("input, textarea, select");
        if (isField(inContainer)) return inContainer;
      }
    }
    return null;
  }

  function findField(scope, names, labelText) {
    for (const n of names) {
      const sels = [`[name="${n}"]`, `#${n}`, `[id*="${n}"]`, `[data-name="${n}"]`, `[name*="${n}"]`];
      for (const sel of sels) {
        try {
          const el = scope.querySelector(sel);
          if (isField(el)) return el;
        } catch (e) {}
      }
    }
    return byLabel(scope, labelText);
  }

  function findSubmit(scope) {
    let btn = scope.querySelector('button[type="submit"], input[type="submit"]');
    if (btn) return btn;
    const buttons = scope.querySelectorAll("button, input[type='button'], a.btn");
    for (const b of buttons) {
      const txt = cleanText(b.textContent || b.value);
      if (/إرسال|أرسل|تقدم|قدّم|اعتماد|حفظ/.test(txt)) return b;
    }
    return scope.querySelector("button") || null;
  }

  function findInScope(scope) {
    return {
      container: scope,
      period: findField(scope, ["period", "duration", "delivery"], "مدة التسليم"),
      cost: findField(scope, ["cost", "price", "amount"], "قيمة العرض"),
      details: findField(scope, ["details", "description", "body", "message"], "تفاصيل العرض"),
      submit: findSubmit(scope)
    };
  }

  function locateBidForm() {
    const scopes = [
      document.getElementById("edit_bid__form"),
      document.getElementById("add-bid"),
      document.getElementById("add-bid-panel"),
      document.querySelector("form#edit_bid__form"),
      document.querySelector("form")
    ].filter(Boolean);

    for (const scope of scopes) {
      const r = findInScope(scope);
      if (r.period && r.cost && r.details) return r;
    }
    const global = findInScope(document);
    if (global.period && global.cost && global.details) return global;

    for (const scope of scopes) {
      const r = findInScope(scope);
      if (r.details && (r.period || r.cost)) return r;
    }
    if (global.details && (global.period || global.cost)) return global;

    return null;
  }

  function setNativeValue(el, value) {
    if (!el) return;
    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    let proto;
    if (el.tagName === "TEXTAREA") proto = HTMLTextAreaElement.prototype;
    else if (el.tagName === "SELECT") proto = HTMLSelectElement.prototype;
    else proto = HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillBidForm(proposal) {
    const loc = locateBidForm();
    if (!loc || !loc.details) return null;
    if (loc.period) setNativeValue(loc.period, String(proposal.period));
    if (loc.cost) setNativeValue(loc.cost, String(proposal.cost));
    setNativeValue(loc.details, proposal.details);
    return loc;
  }

  function submitBidForm(loc) {
    const l = loc || locateBidForm();
    if (!l) return false;
    if (l.submit) {
      l.submit.click();
      return true;
    }
    if (l.container && l.container.tagName === "FORM") {
      if (typeof l.container.requestSubmit === "function") l.container.requestSubmit();
      else l.container.submit();
      return true;
    }
    return false;
  }

  function describeField(el) {
    let label = "";
    if (el.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) label = cleanText(l.textContent);
      } catch (e) {}
    }
    if (!label && el.getAttribute("aria-label")) label = el.getAttribute("aria-label");
    if (!label && el.placeholder) label = el.placeholder;
    if (!label) {
      const fg = el.closest && el.closest(".form-group");
      if (fg) {
        const l = fg.querySelector("label");
        if (l) label = cleanText(l.textContent);
      }
    }
    return {
      tag: el.tagName,
      name: el.name || "",
      id: el.id || "",
      type: el.type || "",
      label,
      required: !!el.required,
      options:
        el.tagName === "SELECT"
          ? Array.from(el.options).map((o) => ({ value: o.value, text: cleanText(o.textContent) }))
          : []
    };
  }

  function scrapeBidFormFields(loc) {
    const l = loc || locateBidForm();
    const scope = l && l.container ? l.container : document;
    const fields = [];
    scope.querySelectorAll("input, textarea, select").forEach((el) => {
      if (["hidden", "submit", "button", "file", "reset", "image"].includes(el.type)) return;
      if (el.name === "_token" || el.name === "multiple_up_completed") return;
      fields.push(describeField(el));
    });
    return fields;
  }

  function findFieldElement(f) {
    const scope = (locateBidForm() || {}).container || document;
    if (f.name) {
      try {
        const el = scope.querySelector(`[name="${CSS.escape(f.name)}"]`);
        if (el) return el;
      } catch (e) {}
    }
    if (f.id) return document.getElementById(f.id);
    return null;
  }

  function fillExtraFields(proposal) {
    const extras = proposal.fields;
    if (!extras || typeof extras !== "object") return;
    const fields = scrapeBidFormFields();
    for (const f of fields) {
      const key = f.name || f.label;
      if (!key) continue;
      let value = extras[f.name];
      if (value == null && f.label) value = extras[f.label];
      if (value == null || value === "") continue;
      const el = findFieldElement(f);
      if (!el) continue;
      if (el.tagName === "SELECT") {
        const opt = Array.from(el.options).find(
          (o) => String(o.value) === String(value) || cleanText(o.textContent) === String(value)
        );
        if (opt) setNativeValue(el, opt.value);
      } else {
        setNativeValue(el, String(value));
      }
    }
  }

  function waitForBidForm(timeout) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tryFind = () => {
        const loc = locateBidForm();
        if (loc) return resolve(loc);
        if (Date.now() - start > timeout) return resolve(null);
        setTimeout(tryFind, 300);
      };
      tryFind();
    });
  }

  // ---------- files ----------
  function readFileContext(files) {
    const list = Array.from(files || []);
    const jobs = list.map(async (f) => {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      const textExts = ["txt", "md", "markdown", "csv", "json", "js", "ts", "py", "html", "css", "xml", "yaml", "yml", "log", "rtf", "env"];
      const isText = textExts.includes(ext) || /^text\//.test(f.type) || f.type === "application/json";
      if (!isText) return null;
      try {
        const text = await f.text();
        if (!text || !text.trim()) return null;
        return { name: f.name, text: text.slice(0, 4000) };
      } catch (e) {
        return null;
      }
    });
    return Promise.all(jobs).then((res) => res.filter(Boolean));
  }

  function attachFiles() {
    if (!selectedFiles.length) return { ok: true };
    const scope = (locateBidForm() || {}).container || document;
    let fileInput = scope.querySelector('input[type="file"]');
    if (!fileInput) {
      fileInput = document.querySelector('#add-bid input[type="file"], #add-bid-panel input[type="file"], input[type="file"]');
    }
    if (!fileInput) return { ok: false, reason: "no-file-input" };
    try {
      const dt = new DataTransfer();
      selectedFiles.forEach((f) => dt.items.add(f));
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  // ---------- floating button + pre-apply panel ----------
  function injectFloatingButton() {
    if (!isProjectDetail()) return;
    if (document.getElementById("aa-floating-btn")) return;
    const btn = document.createElement("button");
    btn.id = "aa-floating-btn";
    btn.textContent = "تقديم عرض (AutoApplier)";
    btn.style.cssText =
      "position:fixed;bottom:16px;left:16px;z-index:2147483645;background:#2386c8;color:#fff;border:none;border-radius:24px;padding:10px 18px;font-size:14px;font-weight:bold;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3);font-family:Tahoma,Arial,sans-serif;";
    btn.addEventListener("click", () => showPreApplyPanel());
    document.documentElement.appendChild(btn);
  }

  function showPreApplyPanel() {
    removeOverlay();
    const detail = scrapeProjectDetail();

    overlay = document.createElement("div");
    overlay.id = "autoapplier-overlay";
    overlay.setAttribute("dir", "rtl");
    overlay.innerHTML = `
      <div class="aa-panel">
        <div class="aa-head">
          <div class="aa-title">تقديم عرض على المشروع</div>
          <button class="aa-close" title="إغلاق">×</button>
        </div>
        <div class="aa-project">${escapeHtml(detail.title || "")}</div>
        <label class="aa-label">ملفات للإرفاق وإعطاء سياق للعرض (اختياري)</label>
        <div class="aa-filearea">
          <button class="aa-pick">اختيار ملفات</button>
          <ul class="aa-filelist"></ul>
        </div>
        <div class="aa-actions">
          <button class="aa-start">تجهيز العرض بالذكاء الاصطناعي</button>
        </div>
        <div class="aa-status"></div>
      </div>`;
    overlay.style.cssText =
      "position:fixed;bottom:16px;left:16px;z-index:2147483646;max-width:440px;width:calc(100% - 32px);font-family:Tahoma,Arial,sans-serif;direction:rtl;";
    const style = document.createElement("style");
    style.textContent = `
      #autoapplier-overlay .aa-panel{background:#fff;border:1px solid #dcdcdc;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:14px;color:#222;}
      #autoapplier-overlay .aa-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
      #autoapplier-overlay .aa-title{font-weight:bold;font-size:15px;color:#2386c8;}
      #autoapplier-overlay .aa-close{background:none;border:none;font-size:20px;line-height:1;cursor:pointer;color:#999;padding:0 4px;}
      #autoapplier-overlay .aa-project{font-size:12px;color:#666;margin-bottom:10px;}
      #autoapplier-overlay .aa-label{display:block;font-size:12px;color:#555;margin-bottom:4px;}
      #autoapplier-overlay .aa-filearea{background:#f6f8fa;border:1px dashed #ccd4dc;border-radius:6px;padding:10px;margin-bottom:10px;}
      #autoapplier-overlay .aa-pick{background:#fff;color:#2386c8;border:1px solid #2386c8;border-radius:6px;padding:8px 14px;font-size:13px;cursor:pointer;}
      #autoapplier-overlay .aa-filelist{list-style:none;margin:8px 0 0;padding:0;font-size:12px;color:#444;}
      #autoapplier-overlay .aa-filelist li{padding:2px 0;}
      #autoapplier-overlay .aa-actions{display:flex;gap:8px;}
      #autoapplier-overlay .aa-start{flex:1;background:#2386c8;color:#fff;border:none;border-radius:6px;padding:10px;font-size:14px;font-weight:bold;cursor:pointer;}
      #autoapplier-overlay .aa-status{font-size:12px;margin-top:8px;color:#2386c8;min-height:14px;text-align:center;}
    `;
    overlay.appendChild(style);
    document.documentElement.appendChild(overlay);

    const filelist = overlay.querySelector(".aa-filelist");
    const renderFileList = () => {
      filelist.innerHTML = "";
      if (!selectedFiles.length) {
        filelist.innerHTML = '<li style="color:#999;">لم يتم اختيار ملفات.</li>';
        return;
      }
      selectedFiles.forEach((f) => {
        const li = document.createElement("li");
        li.textContent = f.name + " (" + Math.round(f.size / 1024) + " KB)";
        filelist.appendChild(li);
      });
    };
    renderFileList();

    overlay.querySelector(".aa-close").addEventListener("click", removeOverlay);
    overlay.querySelector(".aa-pick").addEventListener("click", () => pickFiles(renderFileList));
    overlay.querySelector(".aa-start").addEventListener("click", () => {
      removeOverlay();
      runApply();
    });
  }

  function pickFiles(onDone) {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const files = Array.from(input.files || []);
      files.forEach((f) => selectedFiles.push(f));
      if (onDone) onDone();
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  // ---------- review overlay ----------
  let overlay = null;

  function removeOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  function showReviewOverlay(project, proposal) {
    removeOverlay();

    const earnings = Math.max(0, Math.round(proposal.cost * 0.8 * 100) / 100);

    overlay = document.createElement("div");
    overlay.id = "autoapplier-overlay";
    overlay.setAttribute("dir", "rtl");
    overlay.innerHTML = `
      <div class="aa-panel">
        <div class="aa-head">
          <div class="aa-title">تم تجهيز العرض تلقائياً</div>
          <button class="aa-close" title="إغلاق">×</button>
        </div>
        <div class="aa-project">${escapeHtml(project.title || "")}</div>
        <div class="aa-row">
          <div class="aa-cell"><label>مدة التسليم</label><b>${proposal.period} يوم</b></div>
          <div class="aa-cell"><label>قيمة العرض</label><b>$${proposal.cost}</b></div>
          <div class="aa-cell"><label>مستحقاتك (تقريباً)</label><b>$${earnings}</b></div>
        </div>
        <label class="aa-label">تفاصيل العرض</label>
        <textarea class="aa-details" rows="10">${escapeHtml(proposal.details)}</textarea>
        ${
          selectedFiles.length
            ? `<div class="aa-filesnote">الملفات المرفقة (${selectedFiles.length}): ${escapeHtml(
                selectedFiles.map((f) => f.name).join("، ")
              )}</div>`
            : ""
        }
        <div class="aa-actions">
          <button class="aa-submit">إرسال العرض</button>
          <button class="aa-cancel">إلغاء</button>
        </div>
        <div class="aa-status"></div>
      </div>`;

    overlay.style.cssText =
      "position:fixed;bottom:16px;left:16px;z-index:2147483646;max-width:420px;width:calc(100% - 32px);" +
      "font-family:Tahoma,Arial,sans-serif;direction:rtl;";

    const style = document.createElement("style");
    style.textContent = `
      #autoapplier-overlay .aa-panel{background:#fff;border:1px solid #dcdcdc;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:14px;color:#222;}
      #autoapplier-overlay .aa-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
      #autoapplier-overlay .aa-title{font-weight:bold;font-size:15px;color:#2386c8;}
      #autoapplier-overlay .aa-close{background:none;border:none;font-size:20px;line-height:1;cursor:pointer;color:#999;padding:0 4px;}
      #autoapplier-overlay .aa-project{font-size:12px;color:#666;margin-bottom:10px;}
      #autoapplier-overlay .aa-row{display:flex;gap:8px;margin-bottom:10px;}
      #autoapplier-overlay .aa-cell{flex:1;background:#f5f9fc;border-radius:6px;padding:8px;text-align:center;}
      #autoapplier-overlay .aa-cell label{display:block;font-size:11px;color:#888;margin-bottom:2px;}
      #autoapplier-overlay .aa-cell b{font-size:14px;}
      #autoapplier-overlay .aa-label{display:block;font-size:12px;color:#555;margin-bottom:4px;}
      #autoapplier-overlay .aa-details{width:100%;box-sizing:border-box;border:1px solid #dcdcdc;border-radius:6px;padding:8px;font-size:13px;font-family:inherit;resize:vertical;}
      #autoapplier-overlay .aa-filesnote{font-size:11px;color:#2386c8;margin-top:6px;line-height:1.6;}
      #autoapplier-overlay .aa-actions{display:flex;gap:8px;margin-top:10px;}
      #autoapplier-overlay .aa-submit{flex:1;background:#2386c8;color:#fff;border:none;border-radius:6px;padding:10px;font-size:14px;font-weight:bold;cursor:pointer;}
      #autoapplier-overlay .aa-cancel{background:#eee;color:#444;border:none;border-radius:6px;padding:10px 16px;font-size:14px;cursor:pointer;}
      #autoapplier-overlay .aa-status{font-size:12px;margin-top:8px;color:#2386c8;min-height:14px;text-align:center;}
      #autoapplier-overlay .aa-error{color:#c0392b;}
      #autoapplier-overlay .aa-success{color:#27ae60;}
    `;
    overlay.appendChild(style);

    document.documentElement.appendChild(overlay);

    const status = overlay.querySelector(".aa-status");
    overlay.querySelector(".aa-close").addEventListener("click", removeOverlay);
    overlay.querySelector(".aa-cancel").addEventListener("click", removeOverlay);

    overlay.querySelector(".aa-submit").addEventListener("click", () => {
      const detailsEl = overlay.querySelector(".aa-details");
      const finalProposal = {
        period: proposal.period,
        cost: proposal.cost,
        details: detailsEl.value
      };
      const loc = fillBidForm(finalProposal);
      if (!loc) {
        setStatus("error", "تعذر العثور على نموذج العرض.");
        showDiagnostic();
        return;
      }
      fillExtraFields(finalProposal);

      const attached = attachFiles();
      if (!attached.ok) {
        setStatus("error", "تم تعبئة النموذج لكن تعذر إرفاق الملفات تلقائياً — أرفقها يدوياً ثم أرسل من الموقع.");
        return;
      }

      setStatus("info", "جاري إرسال العرض...");
      try {
        submitBidForm(loc);
        setStatus("success", "تم الإرسال. تحقق من ظهور رسالة تأكيد الموقع.");
      } catch (e) {
        setStatus("error", "تعذر الإرسال: " + String(e));
      }
    });

    function setStatus(kind, text) {
      status.textContent = text;
      status.className = "aa-status";
      if (kind === "error") status.classList.add("aa-error");
      if (kind === "success") status.classList.add("aa-success");
    }
  }

  function showNotice(title, message, linkUrl, linkText) {
    removeOverlay();
    overlay = document.createElement("div");
    overlay.id = "autoapplier-overlay";
    overlay.setAttribute("dir", "rtl");
    overlay.innerHTML = `
      <div class="aa-panel">
        <div class="aa-head">
          <div class="aa-title">${escapeHtml(title)}</div>
          <button class="aa-close" title="إغلاق">×</button>
        </div>
        <div class="aa-project">${escapeHtml(message)}</div>
        ${linkUrl ? `<div class="aa-actions"><a class="aa-submit" style="text-align:center;text-decoration:none;" href="${escapeHtml(linkUrl)}">${escapeHtml(linkText || "متابعة")}</a></div>` : ""}
      </div>`;
    overlay.style.cssText =
      "position:fixed;bottom:16px;left:16px;z-index:2147483646;max-width:420px;width:calc(100% - 32px);font-family:Tahoma,Arial,sans-serif;direction:rtl;";
    const style = document.createElement("style");
    style.textContent = `
      #autoapplier-overlay .aa-panel{background:#fff;border:1px solid #dcdcdc;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:14px;color:#222;}
      #autoapplier-overlay .aa-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
      #autoapplier-overlay .aa-title{font-weight:bold;font-size:15px;color:#c0392b;}
      #autoapplier-overlay .aa-close{background:none;border:none;font-size:20px;line-height:1;cursor:pointer;color:#999;}
      #autoapplier-overlay .aa-project{font-size:13px;color:#555;line-height:1.7;}
      #autoapplier-overlay .aa-actions{display:flex;gap:8px;margin-top:12px;}
      #autoapplier-overlay .aa-submit{flex:1;display:block;background:#2386c8;color:#fff;border:none;border-radius:6px;padding:10px;font-size:14px;font-weight:bold;cursor:pointer;}
    `;
    overlay.appendChild(style);
    document.documentElement.appendChild(overlay);
    overlay.querySelector(".aa-close").addEventListener("click", removeOverlay);
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function collectDiagnostics() {
    const area =
      document.getElementById("add-bid") ||
      document.getElementById("add-bid-panel") ||
      document;
    const fields = Array.from(area.querySelectorAll("input, textarea, select")).map((el) => ({
      tag: el.tagName,
      name: el.name || "",
      id: el.id || "",
      type: el.type || "",
      placeholder: el.placeholder || "",
      label: describeField(el).label
    }));
    const buttons = Array.from(area.querySelectorAll("button, input[type='submit'], input[type='button']")).map(
      (b) => ({
        tag: b.tagName,
        id: b.id || "",
        type: b.type || "",
        text: cleanText(b.textContent || b.value)
      })
    );
    const forms = Array.from(document.querySelectorAll("form")).map((f) => ({
      id: f.id || "",
      name: f.name || "",
      action: f.getAttribute("action") || ""
    }));
    return {
      url: location.href,
      addBidText: cleanText((area.textContent || "").slice(0, 300)),
      forms,
      fields,
      buttons
    };
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(ta);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function showDiagnostic() {
    removeOverlay();
    const json = JSON.stringify(collectDiagnostics(), null, 2);
    overlay = document.createElement("div");
    overlay.id = "autoapplier-overlay";
    overlay.setAttribute("dir", "rtl");
    overlay.innerHTML = `
      <div class="aa-panel">
        <div class="aa-head">
          <div class="aa-title" style="color:#c0392b;">تعذر العثور على نموذج العرض</div>
          <button class="aa-close" title="إغلاق">×</button>
        </div>
        <div class="aa-project">لم أستطع تحديد حقول (مدة التسليم / قيمة العرض / تفاصيل العرض) في الصفحة تلقائياً.</div>
        <div class="aa-project" style="margin-top:6px;">انسخ التشخيص أدناه وأرسله لضبط التوافق:</div>
        <pre class="aa-diag">${escapeHtml(json)}</pre>
        <div class="aa-actions">
          <button class="aa-copy">نسخ التشخيص</button>
          <button class="aa-cancel">إغلاق</button>
        </div>
      </div>`;
    overlay.style.cssText =
      "position:fixed;bottom:16px;left:16px;z-index:2147483646;max-width:480px;width:calc(100% - 32px);font-family:Tahoma,Arial,sans-serif;direction:rtl;";
    const style = document.createElement("style");
    style.textContent = `
      #autoapplier-overlay .aa-panel{background:#fff;border:1px solid #dcdcdc;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:14px;color:#222;}
      #autoapplier-overlay .aa-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
      #autoapplier-overlay .aa-title{font-weight:bold;font-size:15px;}
      #autoapplier-overlay .aa-close{background:none;border:none;font-size:20px;line-height:1;cursor:pointer;color:#999;}
      #autoapplier-overlay .aa-project{font-size:13px;color:#555;line-height:1.7;}
      #autoapplier-overlay .aa-diag{background:#f6f8fa;border:1px solid #e3e8ee;border-radius:6px;padding:8px;font-size:11px;max-height:180px;overflow:auto;direction:ltr;text-align:left;white-space:pre-wrap;word-break:break-all;}
      #autoapplier-overlay .aa-actions{display:flex;gap:8px;margin-top:10px;}
      #autoapplier-overlay .aa-copy{flex:1;background:#2386c8;color:#fff;border:none;border-radius:6px;padding:10px;font-size:14px;font-weight:bold;cursor:pointer;}
      #autoapplier-overlay .aa-cancel{background:#eee;color:#444;border:none;border-radius:6px;padding:10px 16px;font-size:14px;cursor:pointer;}
    `;
    overlay.appendChild(style);
    document.documentElement.appendChild(overlay);
    overlay.querySelector(".aa-close").addEventListener("click", removeOverlay);
    overlay.querySelector(".aa-cancel").addEventListener("click", removeOverlay);
    overlay.querySelector(".aa-copy").addEventListener("click", () => {
      copyText(json);
      overlay.querySelector(".aa-copy").textContent = "تم النسخ ✓";
    });
  }

  // ---------- apply flow ----------
  async function runApply(project) {
    const detail = scrapeProjectDetail();

    if (!detail.loggedIn) {
      showNotice(
        "يلزم تسجيل الدخول",
        "أنت غير مسجّل الدخول في مستقل. سجّل الدخول أولاً ثم أعد المحاولة.",
        "https://mostaql.com/login",
        "تسجيل الدخول"
      );
      return;
    }

    if (!(await waitForBidForm(5000))) {
      showDiagnostic();
      return;
    }

    const contextFiles = await readFileContext(selectedFiles);

    showNotice("جاري تجهيز العرض...", "يتم توليد العرض بالذكاء الاصطناعي، يرجى الانتظار لحظات.", null, null);

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "GENERATE_PROPOSAL",
        project: {
          id: detail.id,
          title: detail.title,
          description: detail.description,
          budget: detail.budget,
          deliveryTime: detail.deliveryTime,
          skills: detail.skills,
          category: detail.category,
          minCost: detail.minCost,
          formFields: scrapeBidFormFields(),
          contextFiles
        }
      });
    } catch (e) {
      showNotice("خطأ", "تعذر الاتصال بالإضافة: " + String(e), null, null);
      return;
    }

    if (!response || !response.ok) {
      showNotice("خطأ", response && response.error ? response.error : "فشل توليد العرض.", null, null);
      return;
    }

    removeOverlay();
    showReviewOverlay(project || detail, response.proposal);
  }

  // ---------- messaging ----------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return false;

    if (message.type === "PING") {
      sendResponse({ ok: true, page: isProjectsList() ? "list" : isProjectDetail() ? "detail" : "other" });
      return false;
    }
    if (message.type === "SCRAPE_LIST") {
      sendResponse({ ok: true, projects: scrapeProjectList() });
      return false;
    }
    if (message.type === "SCRAPE_DETAIL") {
      sendResponse({ ok: true, project: scrapeProjectDetail() });
      return false;
    }
    if (message.type === "RUN_APPLY") {
      runApply(message.project).then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  });

  // ---------- auto-run on load (pending apply) ----------
  async function checkPendingApply() {
    if (!isProjectDetail()) return;
    try {
      const data = await chrome.storage.local.get("pendingApply");
      const pending = data.pendingApply;
      if (!pending || !pending.id || !pending.url) return;
      const currentId = projectIdFromUrl(window.location.href);
      if (String(currentId) !== String(pending.id)) return;
      await chrome.storage.local.remove("pendingApply");
      // slight delay to let the page settle
      setTimeout(() => showPreApplyPanel(), 600);
    } catch (e) {
      /* ignore */
    }
  }

  function init() {
    injectFloatingButton();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", checkPendingApply);
    } else {
      checkPendingApply();
    }
  }

  init();
})();
