// AutoApplier options page

const DEFAULT_SETTINGS = {
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  portfolioUrl: "https://mostaql.com/u/tobok/portfolio",
  freelancerName: "",
  extraInstructions: ""
};

const form = document.getElementById("form");
const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("saveBtn");
const testBtn = document.getElementById("testBtn");

const fields = {
  apiBaseUrl: document.getElementById("apiBaseUrl"),
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  portfolioUrl: document.getElementById("portfolioUrl"),
  freelancerName: document.getElementById("freelancerName"),
  extraInstructions: document.getElementById("extraInstructions")
};

function setStatus(kind, text) {
  if (!text) {
    statusEl.classList.add("hidden");
    statusEl.textContent = "";
    return;
  }
  statusEl.className = "status " + kind;
  statusEl.textContent = text;
}

async function load() {
  const data = await chrome.storage.local.get("settings");
  const s = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  for (const key of Object.keys(fields)) {
    fields[key].value = s[key] != null ? s[key] : "";
  }
}

async function save() {
  const settings = {
    apiBaseUrl: fields.apiBaseUrl.value.trim(),
    apiKey: fields.apiKey.value.trim(),
    model: fields.model.value.trim(),
    portfolioUrl: fields.portfolioUrl.value.trim(),
    freelancerName: fields.freelancerName.value.trim(),
    extraInstructions: fields.extraInstructions.value.trim()
  };
  await chrome.storage.local.set({ settings });
  return settings;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await save();
    setStatus("success", "تم حفظ الإعدادات بنجاح.");
  } catch (err) {
    setStatus("error", "فشل الحفظ: " + String(err));
  }
});

testBtn.addEventListener("click", async () => {
  const settings = await save();
  if (!settings.apiKey) {
    setStatus("error", "أدخل مفتاح الـ API أولاً.");
    return;
  }
  testBtn.disabled = true;
  testBtn.textContent = "جارٍ الاختبار...";
  setStatus("info", "جارٍ إرسال طلب تجريبي إلى الذكاء الاصطناعي...");

  try {
    const resp = await chrome.runtime.sendMessage({
      type: "GENERATE_PROPOSAL",
      project: {
        title: "تصميم شعار لمتجر إلكتروني",
        description: "أحتاج تصميم شعار احترافي لمتجر ملابس إلكتروني جديد.",
        budget: "$100.00 - $250.00",
        deliveryTime: "5 أيام",
        skills: "تصميم شعار، فوتوشوب",
        category: "تصميم"
      }
    });
    if (resp && resp.ok) {
      setStatus(
        "success",
        "نجح الاختبار! مثال عرض مُولّد:\nمدة التسليم: " +
          resp.proposal.period +
          " يوم — القيمة: $" +
          resp.proposal.cost
      );
    } else {
      setStatus("error", "فشل الاختبار: " + (resp && resp.error ? resp.error : "خطأ غير معروف"));
    }
  } catch (err) {
    setStatus("error", "فشل الاختبار: " + String(err));
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = "اختبار الاتصال بالذكاء الاصطناعي";
  }
});

load();
