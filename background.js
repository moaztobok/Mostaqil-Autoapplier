// AutoApplier background service worker (MV3)
// Handles AI proposal generation via any OpenAI-compatible API.

const DEFAULT_SETTINGS = {
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  portfolioUrl: "https://mostaql.com/u/tobok/portfolio",
  freelancerName: "",
  extraInstructions: ""
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get("settings");
  if (!existing.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "GENERATE_PROPOSAL") {
    generateProposal(message.project)
      .then((proposal) => sendResponse({ ok: true, proposal }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    return true; // async response
  }
  if (message && message.type === "GET_SETTINGS") {
    getSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }
  return false;
});

async function getSettings() {
  const data = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
}

function normalizeBaseUrl(url) {
  let u = (url || "").trim();
  if (!u) return "https://api.openai.com/v1";
  u = u.replace(/\/+$/, "");
  return u;
}

async function generateProposal(project) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error("لم يتم ضبط مفتاح الـ API. افتح الإعدادات وأدخل المفتاح.");
  }

  const systemPrompt = buildSystemPrompt(settings);
  const userPrompt = buildUserPrompt(project);

  const endpoint = `${normalizeBaseUrl(settings.apiBaseUrl)}/chat/completions`;

  const body = {
    model: settings.model || "gpt-4o-mini",
    temperature: 0.7,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  let resp;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error("تعذر الاتصال بمزوّد الذكاء الاصطناعي. تحقق من رابط الـ API والاتصال بالإنترنت.");
  }

  if (!resp.ok) {
    let detail = "";
    try {
      const j = await resp.json();
      detail = j && (j.error && j.error.message ? j.error.message : JSON.stringify(j.error || j));
    } catch (e) {
      detail = await resp.text().catch(() => "");
    }
    throw new Error(`رد المزوّد بخطأ ${resp.status}: ${detail}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    throw new Error("استجابة غير صالحة من مزوّد الذكاء الاصطناعي.");
  }

  const content =
    (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";

  const parsed = extractProposal(content);
  validateProposal(parsed);
  return parsed;
}

function buildSystemPrompt(settings) {
  return [
    "أنت مستقل محترف تقدّم عرضاً على مشروع في منصة «مستقل» العربية للعمل الحر.",
    "مهمتك: كتابة تفاصيل العرض واختيار مدة التسليم وقيمة العرض المناسبة للمشروع.",
    "",
    "أعد ردّك بصيغة JSON فقط وبدون أي نص إضافي، بالشكل التالي تماماً:",
    '{"period": <عدد أيام التسليم كرقم صحيح>, "cost": <قيمة العرض بالدولار كرقم صحيح>, "details": "<نص تفاصيل العرض>", "fields": {}}',
    "كائن fields (اختياري) يُملأ فقط إذا وُجدت حقول إضافية في نموذج التقديم، بمفتاح يساوي اسم الحقل أو عنوانه.",
    "",
    "قواعد إلزامية لنص details:",
    "- اكتب بالعربية الفصحى وبأسلوب مهني وودّي ومباشر.",
    "- خاطب صاحب المشروع وأبرز خبرتك المناسبة لهذا المشروع تحديداً.",
    "- لا تستخدم وسائل تواصل خارجية (بريد إلكتروني، هاتف، واتساب، تيليجرام، سكايب...).",
    "- لا تضع أي روابط أو عناوين URL إطلاقاً، لا روابط خارجية ولا روابط داخلية.",
    "- أشر إلى معرض أعمالك بالاسم فقط دون أي رابط (مثال: يمكنك الاطلاع على معرض أعمالي).",
    "- لا تدرج روابط http/https أو www أو عناوين مواقع نهائياً.",
    "- لا تبالغ في الحشو، وكن محدداً فيما ستقدّمه.",
    "- يجب أن يكون طول details على الأقل 250 حرفاً ولا يزيد عن 4000 حرف.",
    "",
    "قواعد اختيار الأرقام:",
    "- period: عدد أيام تسليم واقعي ومناسب لحجم المشروع (بين 1 و365).",
    "- cost: رقم صحيح بالدولار، لا يقل عن 25، ومنافس ضمن نطاق ميزانية المشروع المذكورة أو قريب منها.",
    "",
    "قواعد الحقول الإضافية:",
    "- إذا كانت قائمة حقول نموذج التقديم تحتوي حقولاً إضافية (غير period/cost/details)، املأها ضمن كائن fields بقيم مناسبة ومختصرة.",
    "- للحقول المنسدلة (قوائم الخيارات)، اختر قيمة من الخيارات المتاحة حصراً.",
    "- لا تضع أي روابط في أي حقل إطلاقاً.",
    "",
    (settings.freelancerName ? `- وقع العرض باسم: ${settings.freelancerName}` : ""),
    (settings.extraInstructions ? `- تعليمات إضافية من المستخدم: ${settings.extraInstructions}` : "")
  ]
    .filter(Boolean)
    .join("\n");
}

function buildUserPrompt(project) {
  const p = project || {};
  const parts = [];
  parts.push("تفاصيل المشروع:");
  parts.push(`- العنوان: ${p.title || ""}`);
  if (p.budget) parts.push(`- الميزانية: ${p.budget}`);
  if (p.deliveryTime) parts.push(`- مدة التنفيذ المتوقعة: ${p.deliveryTime}`);
  if (p.skills) parts.push(`- المهارات المطلوبة: ${p.skills}`);
  if (p.category) parts.push(`- التصنيف: ${p.category}`);
  parts.push(`- الوصف: ${p.description || ""}`);
  if (p.minCost && Number(p.minCost) > 25) {
    parts.push(`- قيد إضافي: قيمة العرض يجب ألا تقل عن $${p.minCost} (الحد الأدنى المسموح في هذا المشروع).`);
  }
  if (Array.isArray(p.formFields) && p.formFields.length) {
    parts.push("- حقول نموذج التقديم المكتشفة في الصفحة (بالإضافة إلى period وcost وdetails):");
    p.formFields.forEach((f) => {
      const opts =
        f.options && f.options.length
          ? " [خيارات: " + f.options.map((o) => o.text).join(" / ") + "]"
          : "";
      parts.push(
        `  • ${f.label || f.id || f.name || f.tag}${f.name ? ` (name="${f.name}")` : ""}${opts}`
      );
    });
  }
  if (Array.isArray(p.contextFiles) && p.contextFiles.length) {
    parts.push("");
    parts.push("- سياق إضافي من ملفات رفعها المستخدم (استخدمه لفهم خبرته وأعماله وتخصيص العرض):");
    p.contextFiles.forEach((cf) => {
      parts.push(`### ملف: ${cf.name}`);
      parts.push(cf.text);
    });
  }
  parts.push("");
  parts.push("اكتب الآن العرض بالصيغة المطلوبة.");
  return parts.join("\n");
}

function extractProposal(text) {
  if (!text) throw new Error("لم يعد الذكاء الاصطناعي أي نص.");
  const cleaned = text.trim();
  let obj;
  try {
    obj = JSON.parse(cleaned);
  } catch (e) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("تعذر استخراج JSON من رد الذكاء الاصطناعي.");
    try {
      obj = JSON.parse(m[0]);
    } catch (e2) {
      throw new Error("رد الذكاء الاصطناعي ليس JSON صالحاً.");
    }
  }
  return obj;
}

function validateProposal(proposal) {
  const period = parseInt(proposal.period, 10);
  const cost = parseInt(proposal.cost, 10);
  const details = String(proposal.details || "").trim();

  if (!Number.isFinite(period) || period < 1 || period > 365) {
    throw new Error("قيمة مدة التسليم غير صالحة.");
  }
  if (!Number.isFinite(cost) || cost < 25) {
    throw new Error("قيمة العرض غير صالحة (يجب أن تكون 25 دولاراً أو أكثر).");
  }
  if (details.length < 50) {
    throw new Error("نص تفاصيل العرض قصير جداً.");
  }

  proposal.period = period;
  proposal.cost = cost;
  proposal.details = stripUrls(details);
  if (proposal.fields && typeof proposal.fields === "object") {
    const clean = {};
    for (const [k, v] of Object.entries(proposal.fields)) {
      if (v == null || v === "") continue;
      clean[k] = stripUrls(String(v));
    }
    proposal.fields = clean;
  }
  return proposal;
}

function stripUrls(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/www\.\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
