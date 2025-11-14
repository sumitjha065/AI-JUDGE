


/* ===========================
   script.js - AI Judge Frontend
   =========================== */

/* ---------- Utilities ---------- */
const fmtSize = (bytes) => {
  if (!bytes && bytes !== 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let val = bytes;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${parseFloat(val.toFixed(2))} ${units[i]}`;
};

const nowDateStr = () => new Date().toISOString().split("T")[0];

/* ---------- Courtroom State & Methods ---------- */
const Courtroom = {
  currentCase: null,
  arguments: [],
  roundsUsed: 0,
  maxRounds: 5,
  files: { plaintiff: [], defendant: [] },
  isSubmitting: false,

  init() {
    this.cache();
    this.bind();
    this.updateRounds();
    this.setConfidence("HIGH");
    this.animateSeal();
    // initial dynamic date (will update per verdict)
    const verdictDateEl = document.getElementById("verdictDate");
    if (verdictDateEl) verdictDateEl.textContent = "Date: " + nowDateStr();
  },

  cache() {
    this.el = {
      plaintiffFilesInput: document.getElementById("plaintiffFiles"),
      defendantFilesInput: document.getElementById("defendantFiles"),
      plaintiffFileList: document.getElementById("plaintiffFileList"),
      defendantFileList: document.getElementById("defendantFileList"),
      plaintiffUploadArea: document.getElementById("plaintiffUpload"),
      defendantUploadArea: document.getElementById("defendantUpload"),
      plaintiffSelectBtn: document.getElementById("plaintiffSelectBtn"),
      defendantSelectBtn: document.getElementById("defendantSelectBtn"),
      plaintiffUploadStatus: document.getElementById("plaintiffUploadStatus"),
      defendantUploadStatus: document.getElementById("defendantUploadStatus"),
      jurisdiction: document.getElementById("jurisdiction"),
      caseCategory: document.getElementById("case-category"),
      submitCaseBtn: document.getElementById("submitCase"),
      courtLoading: document.getElementById("courtLoading"),
      courtNotice: document.getElementById("courtNotice"),
      noticeText: document.getElementById("noticeText"),
      verdictContent: document.getElementById("verdictContent"),
      reasoningContent: document.getElementById("reasoningContent"),
      plaintiffEvidence: document.getElementById("plaintiffEvidence"),
      defendantEvidence: document.getElementById("defendantEvidence"),
      confidenceBadgeUI: document.getElementById("confidenceBadgeUI"),
      judgmentTab: document.getElementById("judgmentTab"),
      argumentsTab: document.getElementById("argumentsTab"),
      proceedToArguments: document.getElementById("proceedToArguments"),
      newCase: document.getElementById("newCase"),
      plaintiffArgument: document.getElementById("plaintiffArgument"),
      defendantArgument: document.getElementById("defendantArgument"),
      plaintiffArgBtn: document.getElementById("plaintiffArgBtn"),
      defendantArgBtn: document.getElementById("defendantArgBtn"),
      argumentsTimeline: document.getElementById("argumentsTimeline"),
      totalArguments: document.getElementById("totalArguments"),
      roundCounter: document.getElementById("roundCounter"),
      roundsLeft: document.getElementById("roundsLeft"),
      navItems: document.querySelectorAll(".nav-item"),
      proceedings: document.querySelectorAll(".proceeding"),
    };
  },

  bind() {
    // Navigation click
    this.el.navItems.forEach((it) => {
      it.addEventListener("click", () => {
        if (it.disabled) return;
        const tab = it.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Select buttons
    this.el.plaintiffSelectBtn.addEventListener("click", () => this.el.plaintiffFilesInput.click());
    this.el.defendantSelectBtn.addEventListener("click", () => this.el.defendantFilesInput.click());

    // File input change (fix: reset input.value after handling)
    this.el.plaintiffFilesInput.addEventListener("change", (e) => this.handleFiles("plaintiff", e.target.files, e));
    this.el.defendantFilesInput.addEventListener("change", (e) => this.handleFiles("defendant", e.target.files, e));

    // Drag & drop
    ["dragenter", "dragover"].forEach((ev) => {
      this.el.plaintiffUploadArea.addEventListener(ev, (e) => { e.preventDefault(); this.el.plaintiffUploadArea.style.borderColor = "var(--gold)"; });
      this.el.defendantUploadArea.addEventListener(ev, (e) => { e.preventDefault(); this.el.defendantUploadArea.style.borderColor = "var(--gold)"; });
    });
    ["dragleave", "dragend", "drop"].forEach((ev) => {
      this.el.plaintiffUploadArea.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "drop") this.handleDrop(e, "plaintiff"); this.el.plaintiffUploadArea.style.borderColor = ""; });
      this.el.defendantUploadArea.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "drop") this.handleDrop(e, "defendant"); this.el.defendantUploadArea.style.borderColor = ""; });
    });

    // Submit case
    this.el.submitCaseBtn.addEventListener("click", () => this.submitCase());

    // Proceed to arguments & new case
    const proceedBtn = document.getElementById("proceedToArguments");
    if (proceedBtn) proceedBtn.addEventListener("click", () => this.switchTab("arguments"));
    if (this.el.newCase) this.el.newCase.addEventListener("click", () => this.resetCase());

    // Arguments
    if (this.el.plaintiffArgBtn) this.el.plaintiffArgBtn.addEventListener("click", (e) => { e.preventDefault(); this.submitArgument("plaintiff"); });
    if (this.el.defendantArgBtn) this.el.defendantArgBtn.addEventListener("click", (e) => { e.preventDefault(); this.submitArgument("defendant"); });
  },

  handleDrop(e, side) {
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    this.handleFiles(side, files, null);
  },

  handleFiles(side, fileList, event) {
    const newFiles = Array.from(fileList || []);
    if (newFiles.length === 0) return;

    // merge but avoid exact duplicate file objects with same name+size (still allow different versions)
    newFiles.forEach((f) => {
      const exists = this.files[side].some((g) => g.name === f.name && g.size === f.size);
      if (!exists) this.files[side].push(f);
    });

    // update UI
    this.renderFileList(side);

    // show status
    const statusEl = side === "plaintiff" ? this.el.plaintiffUploadStatus : this.el.defendantUploadStatus;
    statusEl.textContent = `${this.files[side].length} file(s) ready`;

    // reset input value so re-selecting same file triggers change (fix)
    if (event && event.target) event.target.value = "";

    // enable submit
    this.updateSubmitBtn();
  },

  renderFileList(side) {
    const listEl = side === "plaintiff" ? this.el.plaintiffFileList : this.el.defendantFileList;
    listEl.innerHTML = "";
    this.files[side].forEach((file, idx) => {
      const item = document.createElement("div");
      item.className = "file-item";
      item.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center;">
          <i class="fas fa-file-pdf" style="font-size:18px;color:var(--court-dark)"></i>
          <div>
            <div class="file-name">${file.name}</div>
            <div class="file-size">${fmtSize(file.size)}</div>
          </div>
        </div>
        <div>
          <button class="file-remove" data-side="${side}" data-idx="${idx}" title="Remove file" style="background:none;border:none;color:var(--text-gray);cursor:pointer;">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
      `;
      listEl.appendChild(item);
    });

    // attach remove handlers
    listEl.querySelectorAll(".file-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const side = btn.dataset.side;
        const idx = parseInt(btn.dataset.idx);
        this.files[side].splice(idx, 1);
        this.renderFileList(side);
        const statusEl = side === "plaintiff" ? this.el.plaintiffUploadStatus : this.el.defendantUploadStatus;
        statusEl.textContent = this.files[side].length > 0 ? `${this.files[side].length} file(s) ready` : "";
        this.updateSubmitBtn();
      });
    });
  },

  updateSubmitBtn() {
    const hasFiles = this.files.plaintiff.length > 0 || this.files.defendant.length > 0;
    this.el.submitCaseBtn.disabled = !hasFiles || this.isSubmitting;
  },

  async submitCase() {
    if (this.isSubmitting) return;
    if (this.files.plaintiff.length === 0 && this.files.defendant.length === 0) {
      this.showNotice("Please upload at least one document", "error");
      return;
    }

    this.isSubmitting = true;
    this.updateSubmitBtn();
    this.showLoading(true);

    try {
      const formData = new FormData();

      // Append files with both names (camelCase + snake_case) for compatibility
      this.files.plaintiff.forEach((f) => {
        formData.append("plaintiffFiles", f);
        formData.append("plaintiff_files", f);
      });
      this.files.defendant.forEach((f) => {
        formData.append("defendantFiles", f);
        formData.append("defendant_files", f);
      });

      // metadata
      formData.append("jurisdiction", this.el.jurisdiction.value || "Supreme Court");
      formData.append("case_category", this.el.caseCategory.value || "Civil");

      const res = await fetch("http://localhost:8000/api/upload-documents", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!data || !data.success) {
        throw new Error(data?.error || "Upload failed");
      }

      this.currentCase = data.case_id;
      this.showNotice("Case filed successfully", "success");

      // Immediately request verdict
      await this.fetchVerdictAfterUpload();

      // enable navigation
      if (this.el.judgmentTab) this.el.judgmentTab.disabled = false;
      if (this.el.argumentsTab) this.el.argumentsTab.disabled = false;

      this.switchTab("judgment");
    } catch (err) {
      console.error("submitCase error:", err);
      this.showNotice("Upload error: " + err.message, "error");
    } finally {
      this.isSubmitting = false;
      this.showLoading(false);
      this.updateSubmitBtn();
    }
  },

  async fetchVerdictAfterUpload() {
    // show interim UI
    this.el.verdictContent.innerHTML = `<div class="placeholder-judgment"><i class="fas fa-hourglass-half"></i><p>Preparing case for AI review...</p></div>`;
    this.el.reasoningContent.innerHTML = `<p>Awaiting AI reasoning...</p>`;

    // Build request payload referencing filenames (backend stores actual texts)
    const payload = {
      case_data: {
        plaintiff_docs: this.files.plaintiff.map((f) => f.name),
        defendant_docs: this.files.defendant.map((f) => f.name),
        jurisdiction: this.el.jurisdiction.value || "Supreme Court",
        case_category: this.el.caseCategory.value || "Civil",
      },
      previous_arguments: this.arguments.map((a) => ({ side: a.side, argument_text: a.text, documents: a.documents || [] })),
    };

    try {
      const res = await fetch("http://localhost:8000/api/get-verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();

      if (!result || !result.success) {
        throw new Error(result?.error || "No verdict returned");
      }

      this.displayVerdict(result);
    } catch (err) {
      console.error("fetchVerdict error:", err);
      this.showNotice("Failed to get verdict: " + err.message, "error");
      // fallback UI
      this.el.verdictContent.innerHTML = `<div class="placeholder-judgment"><p>AI verdict unavailable</p></div>`;
    }
  },

  displayVerdict(judgment) {
    // set dynamic date
    const verdictDateEl = document.getElementById("verdictDate");
    if (verdictDateEl) verdictDateEl.textContent = "Date: " + nowDateStr();

    // confidence
    if (judgment.confidence) this.setConfidence(judgment.confidence);

    // fill verdict content
    if (judgment.verdict) {
      this.el.verdictContent.innerHTML = `
        <div class="verdict-text">
          <h4 style="color:var(--court-dark); margin-bottom:8px;">${judgment.verdict}</h4>
          ${judgment.reasoning ? `<p style="color:var(--court-dark); line-height:1.6;">${judgment.reasoning}</p>` : ""}
        </div>
      `;
    } else if (judgment.raw_output) {
      this.el.verdictContent.innerHTML = `<pre style="color:var(--court-dark); white-space:pre-wrap;">${judgment.raw_output}</pre>`;
    }

    // reasoning panel
    if (judgment.reasoning) {
      this.el.reasoningContent.innerHTML = `<p style="color:var(--court-dark); line-height:1.6;">${judgment.reasoning}</p>`;
    }

    // evidence lists
    if (judgment.key_evidence) {
      this.updateEvidence("plaintiffEvidence", judgment.key_evidence.plaintiff || []);
      this.updateEvidence("defendantEvidence", judgment.key_evidence.defendant || []);
    } else {
      this.updateEvidence("plaintiffEvidence", []);
      this.updateEvidence("defendantEvidence", []);
    }

    // scroll to verdict panel
    const verdictPanel = document.querySelector("#judgment .verdict-panel");
    if (verdictPanel) verdictPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  },

  updateEvidence(elementId, list) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!list || list.length === 0) {
      el.innerHTML = `<div class="evidence-item">No specific evidence highlighted</div>`;
      return;
    }
    el.innerHTML = list.map((it) => `<div class="evidence-item">${it}</div>`).join("");
  },

  setConfidence(level) {
    const badge = this.el.confidenceBadgeUI;
    if (!badge) return;
    const txt = ("" + level).toUpperCase();
    badge.textContent = txt + " CONFIDENCE";
    if (txt.includes("HIGH")) {
      badge.style.background = "linear-gradient(135deg, var(--success), #047857)";
      badge.style.color = "#fff";
    } else if (txt.includes("MED") || txt.includes("MEDIUM")) {
      badge.style.background = "linear-gradient(135deg, var(--warning), #b45309)";
      badge.style.color = "#fff";
    } else {
      badge.style.background = "linear-gradient(135deg, var(--plaintiff), #b91c1c)";
      badge.style.color = "#fff";
    }
  },

  async submitArgument(side) {
    if (!this.currentCase) {
      this.showNotice("No active case. Please file a case first.", "warning");
      return;
    }
    if (this.roundsUsed >= this.maxRounds) {
      this.showNotice("Maximum argument rounds reached", "warning");
      return;
    }

    const textarea = side === "plaintiff" ? this.el.plaintiffArgument : this.el.defendantArgument;
    const text = textarea.value.trim();
    if (!text) {
      this.showNotice("Please enter an argument", "warning");
      return;
    }

    this.showLoading(true);
    try {
      const payload = {
        argument: { side, argument_text: text, documents: [] },
        case_id: this.currentCase,
      };

      const res = await fetch("http://localhost:8000/api/submit-argument", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!data || !data.success) throw new Error(data?.error || "Argument failed");

      // update local arguments for UI
      this.arguments.push({ side, text, time: new Date().toISOString() });
      this.roundsUsed++;
      textarea.value = "";
      this.renderArguments();
      this.updateRounds();

      // update verdict with returned judgment
      this.displayVerdict(data);

      this.showNotice("Argument submitted", "success");
    } catch (err) {
      console.error("submitArgument error:", err);
      this.showNotice("Failed to submit argument: " + err.message, "error");
    } finally {
      this.showLoading(false);
    }
  },

  renderArguments() {
    const timeline = this.el.argumentsTimeline;
    timeline.innerHTML = "";
    if (!this.arguments || this.arguments.length === 0) {
      timeline.innerHTML = `<div class="empty-record"><i class="fas fa-file-alt"></i><p>No arguments yet...</p></div>`;
      this.el.totalArguments.textContent = "0 arguments recorded";
      return;
    }

    this.arguments.forEach((arg, idx) => {
      const el = document.createElement("div");
      el.className = `argument-record ${arg.side}`;
      el.innerHTML = `
        <div class="argument-meta">
          <span class="argument-party ${arg.side}"><i class="fas fa-${arg.side === "plaintiff" ? "user-tie" : "user-shield"}"></i> ${arg.side === "plaintiff" ? "PLAINTIFF" : "DEFENDANT"}</span>
          <span class="argument-round">Round ${idx + 1} • ${new Date(arg.time).toLocaleString()}</span>
        </div>
        <div class="argument-text">${arg.text}</div>
      `;
      timeline.appendChild(el);
    });

    this.el.totalArguments.textContent = `${this.arguments.length} arguments recorded`;
    timeline.scrollTop = timeline.scrollHeight;
  },

  updateRounds() {
    const remaining = this.maxRounds - this.roundsUsed;
    if (this.el.roundCounter) this.el.roundCounter.textContent = `${this.roundsUsed}/${this.maxRounds}`;
    if (this.el.roundsLeft) this.el.roundsLeft.textContent = `${remaining} rounds remaining`;
  },

  resetCase() {
    this.currentCase = null;
    this.arguments = [];
    this.roundsUsed = 0;
    this.files = { plaintiff: [], defendant: [] };
    this.el.plaintiffFileList.innerHTML = "";
    this.el.defendantFileList.innerHTML = "";
    this.el.plaintiffUploadStatus.textContent = "";
    this.el.defendantUploadStatus.textContent = "";
    this.el.verdictContent.innerHTML = `<div class="placeholder-judgment"><i class="fas fa-scale-balanced"></i><p>Awaiting judicial review...</p></div>`;
    this.el.reasoningContent.innerHTML = `<p>AI judge reasoning will appear here...</p>`;
    this.updateSubmitBtn();
    this.renderArguments();
    this.updateRounds();
    // disable judgment & arguments nav
    if (this.el.judgmentTab) { this.el.judgmentTab.disabled = true; }
    if (this.el.argumentsTab) { this.el.argumentsTab.disabled = true; }
    // go to case-filing
    this.switchTab("case-filing");
    this.showNotice("New case started", "success");
  },

  showLoading(show) {
    const overlay = this.el.courtLoading;
    const submitBtn = this.el.submitCaseBtn;
    const loadingEl = submitBtn.querySelector(".loading");
    if (show) {
      overlay.style.display = "flex";
      if (loadingEl) loadingEl.style.display = "flex";
      submitBtn.disabled = true;
    } else {
      overlay.style.display = "none";
      if (loadingEl) loadingEl.style.display = "none";
      this.updateSubmitBtn();
    }
  },

  showNotice(msg, type = "success") {
    const notice = this.el.courtNotice;
    const text = this.el.noticeText;
    text.textContent = msg;
    if (type === "error") notice.style.background = "linear-gradient(135deg, var(--plaintiff), #b91c1c)";
    else if (type === "warning") notice.style.background = "linear-gradient(135deg, var(--warning), #b45309)";
    else notice.style.background = "linear-gradient(135deg, var(--success), #047857)";
    notice.classList.add("show");
    setTimeout(() => notice.classList.remove("show"), 3000);
  },

  switchTab(tab) {
    this.el.proceedings.forEach((p) => p.classList.remove("active"));
    this.el.navItems.forEach((n) => n.classList.remove("active"));
    const sel = document.getElementById(tab);
    if (sel) sel.classList.add("active");
    const navBtn = document.querySelector(`[data-tab="${tab}"]`);
    if (navBtn) navBtn.classList.add("active");
  },

  animateSeal() {
    const seal = document.querySelector(".seal");
    if (!seal) return;
    setInterval(() => {
      seal.style.transform = "scale(1.05)";
      setTimeout(() => (seal.style.transform = "scale(1)"), 450);
    }, 3000);
  },
};

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", () => Courtroom.init());
