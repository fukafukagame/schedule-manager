const API_TASKS = "/api/tasks";
const API_PROJECTS = "/api/projects";

let tasks = [];
let projects = [];
let editingId = null;
let editingProjectId = null;

// ビュー状態
let currentView = "projects"; // "projects" | "tasks"
let currentProjectId = null;  // null = 未分類, UUID = 特定プロジェクト

// タイマー状態
let activeTimer = null; // { taskId, intervalId, startedAt, baseSeconds }

// DOM要素
const taskList = document.getElementById("task-list");
const taskView = document.getElementById("task-view");
const projectView = document.getElementById("project-view");
const projectList = document.getElementById("project-list");
const modal = document.getElementById("modal");
const form = document.getElementById("task-form");
const modalTitle = document.getElementById("modal-title");
const filterStatus = document.getElementById("filter-status");
const filterPriority = document.getElementById("filter-priority");
const sortBy = document.getElementById("sort-by");
const searchInput = document.getElementById("search");
const projectSearch = document.getElementById("project-search");
const statTotal = document.getElementById("stat-total");
const statPending = document.getElementById("stat-pending");
const statDone = document.getElementById("stat-done");
const btnBack = document.getElementById("btn-back");
const headerTitle = document.getElementById("header-title");
const breadcrumb = document.getElementById("breadcrumb");
const projectModal = document.getElementById("project-modal");
const projectForm = document.getElementById("project-form");
const projectModalTitle = document.getElementById("project-modal-title");

// 初期化
document.addEventListener("DOMContentLoaded", () => {
  filterStatus.addEventListener("change", renderTasks);
  filterPriority.addEventListener("change", renderTasks);
  sortBy.addEventListener("change", renderTasks);
  searchInput.addEventListener("input", renderTasks);
  projectSearch.addEventListener("input", renderProjects);

  // プロジェクトモーダルイベント
  projectModal.addEventListener("click", (e) => {
    if (e.target === projectModal) closeProjectModal();
  });
  projectForm.addEventListener("submit", handleProjectSubmit);

  // ハッシュルーティング
  window.addEventListener("hashchange", handleHashChange);
  handleHashChange();
});

// ── ハッシュルーティング ──

function handleHashChange() {
  const hash = location.hash || "#projects";

  if (hash.startsWith("#project/")) {
    const id = hash.slice("#project/".length);
    currentView = "tasks";
    currentProjectId = id;
  } else if (hash === "#tasks") {
    currentView = "tasks";
    currentProjectId = null;
  } else {
    currentView = "projects";
    currentProjectId = null;
  }

  switchView();
}

function navigateTo(hash) {
  location.hash = hash;
}

function updateContext(view, projectId, projectName) {
  fetch("/api/context", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ view, projectId, projectName }),
  }).catch(() => {});
}

function switchView() {
  if (currentView === "projects") {
    projectView.style.display = "";
    taskView.style.display = "none";
    btnBack.style.display = "none";
    headerTitle.textContent = "タスク管理";
    breadcrumb.textContent = "";
    updateContext("projects", null, null);
    loadProjects();
    loadTasks(); // 統計用
  } else {
    projectView.style.display = "none";
    taskView.style.display = "";
    btnBack.style.display = "";
    if (currentProjectId) {
      const proj = projects.find(p => p.id === currentProjectId);
      const name = proj ? proj.name : "プロジェクト";
      headerTitle.textContent = name;
      breadcrumb.textContent = "";
      updateContext("project", currentProjectId, name);
    } else {
      headerTitle.textContent = "未分類タスク";
      breadcrumb.textContent = "";
      updateContext("unassigned", null, null);
    }
    loadTasks();
    loadProjects(); // ドロップダウン用
  }
}

// ── データ読み込み ──

async function loadTasks() {
  const res = await fetch(API_TASKS);
  tasks = await res.json();
  if (currentView === "tasks") {
    renderTasks();
  }
  updateStats();
}
window.loadTasks = loadTasks;

async function loadProjects() {
  const res = await fetch(API_PROJECTS);
  projects = await res.json();
  if (currentView === "projects") {
    renderProjects();
  }
  populateProjectDropdown();
}

// ── 統計 ──

function updateStats() {
  if (currentView === "projects") {
    // 全タスクの統計
    statTotal.textContent = tasks.length;
    statPending.textContent = tasks.filter(t => t.status !== "完了").length;
    statDone.textContent = tasks.filter(t => t.status === "完了").length;
  } else {
    // 現在のビューのタスクのみ
    const scoped = currentProjectId
      ? tasks.filter(t => t.projectId === currentProjectId)
      : tasks.filter(t => !t.projectId);
    statTotal.textContent = scoped.length;
    statPending.textContent = scoped.filter(t => t.status !== "完了").length;
    statDone.textContent = scoped.filter(t => t.status === "完了").length;
  }
}

// ── 時間フォーマット ──

function formatTime(seconds) {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${m > 0 ? m + "m" : ""}`;
  if (m > 0) return `${m}min`;
  return `${s}s`;
}

function formatTimeLive(seconds) {
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = n => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

// ── タイマー ──

function toggleTimer(taskId, event) {
  event.stopPropagation();
  if (activeTimer && activeTimer.taskId === taskId) {
    stopTimer();
  } else {
    if (activeTimer) stopTimer();
    startTimer(taskId);
  }
}

function startTimer(taskId) {
  const t = tasks.find(x => x.id === taskId);
  if (!t) return;
  const baseSeconds = t.timeSpent || 0;
  const startedAt = Date.now();

  const intervalId = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const total = baseSeconds + elapsed;
    const timeEl = document.querySelector(`[data-timer-id="${taskId}"]`);
    if (timeEl) timeEl.textContent = formatTimeLive(total);
  }, 1000);

  activeTimer = { taskId, intervalId, startedAt, baseSeconds };
  renderTasks();
}

async function stopTimer() {
  if (!activeTimer) return;
  clearInterval(activeTimer.intervalId);
  const elapsed = Math.floor((Date.now() - activeTimer.startedAt) / 1000);
  const total = activeTimer.baseSeconds + elapsed;
  const taskId = activeTimer.taskId;
  activeTimer = null;

  await fetch(`${API_TASKS}/${taskId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timeSpent: total }),
  });
  await loadTasks();
}

// ── プロジェクト一覧描画 ──

function renderProjects() {
  const q = projectSearch.value.trim().toLowerCase();
  let filtered = [...projects];
  if (q) {
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.description || "").toLowerCase().includes(q)
    );
  }

  // 未分類タスクの集計
  const unassignedTasks = tasks.filter(t => !t.projectId);
  const unassignedDone = unassignedTasks.filter(t => t.status === "完了").length;

  let html = filtered.map(p => {
    const pct = p.taskCount > 0 ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
    return `
    <div class="project-card" style="border-left-color: ${esc(p.color || '#4a6cf7')}" onclick="navigateTo('#project/${p.id}')">
      <div class="project-card-header">
        <div class="project-card-name">${esc(p.name)}</div>
        <div class="project-card-actions">
          <button onclick="openEditProject('${p.id}', event)">編集</button>
          <button class="btn-delete" onclick="deleteProject('${p.id}', event)">削除</button>
        </div>
      </div>
      <div class="project-card-stats">${p.taskCount}タスク (${p.doneCount}完了)</div>
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width: ${pct}%; background: ${esc(p.color || '#4a6cf7')}"></div>
      </div>
      ${p.description ? `<div class="project-card-desc">${esc(p.description)}</div>` : ""}
    </div>`;
  }).join("");

  // 未分類タスクカード
  if (unassignedTasks.length > 0 || filtered.length === projects.length) {
    const uPct = unassignedTasks.length > 0 ? Math.round((unassignedDone / unassignedTasks.length) * 100) : 0;
    html += `
    <div class="project-card unassigned-card" onclick="navigateTo('#tasks')">
      <div class="project-card-header">
        <div class="project-card-name">未分類タスク</div>
      </div>
      <div class="project-card-stats">${unassignedTasks.length}タスク (${unassignedDone}完了)</div>
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width: ${uPct}%; background: #999"></div>
      </div>
    </div>`;
  }

  if (!html) {
    html = `<div class="empty-state"><p>プロジェクトがありません</p><small>「プロジェクト追加」ボタンで最初のプロジェクトを作成しましょう</small></div>`;
  }

  projectList.innerHTML = html;
  updateStats();
}

// ── タスク一覧描画 ──

function renderTasks() {
  // プロジェクトでフィルタ
  let filtered = currentProjectId
    ? tasks.filter(t => t.projectId === currentProjectId)
    : tasks.filter(t => !t.projectId);

  // フィルタ: ステータス
  const sv = filterStatus.value;
  if (sv) filtered = filtered.filter(t => t.status === sv);

  // フィルタ: 優先度
  const pv = filterPriority.value;
  if (pv) filtered = filtered.filter(t => t.priority === pv);

  // 検索
  const q = searchInput.value.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.description || "").toLowerCase().includes(q) ||
      (t.category || "").toLowerCase().includes(q)
    );
  }

  // ソート
  const priorityOrder = { "高": 0, "中": 1, "低": 2 };
  const statusOrder = { "進行中": 0, "未着手": 1, "完了": 2 };

  switch (sortBy.value) {
    case "deadline":
      filtered.sort((a, b) => {
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return a.deadline.localeCompare(b.deadline);
      });
      break;
    case "priority":
      filtered.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));
      break;
    case "status":
      filtered.sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));
      break;
    case "created":
      filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
  }

  // 統計更新
  updateStats();

  // リスト描画
  if (filtered.length === 0) {
    const scopedAll = currentProjectId
      ? tasks.filter(t => t.projectId === currentProjectId)
      : tasks.filter(t => !t.projectId);
    taskList.innerHTML = `
      <div class="empty-state">
        <p>${scopedAll.length === 0 ? "タスクがありません" : "条件に一致するタスクがありません"}</p>
        <small>${scopedAll.length === 0 ? "「タスク追加」ボタンで最初のタスクを作成しましょう" : "フィルタを変更してください"}</small>
      </div>`;
    return;
  }

  taskList.innerHTML = filtered.map(t => {
    const isCompleted = t.status === "完了";
    const deadlineText = formatDeadline(t.deadline);
    const isTimerActive = activeTimer && activeTimer.taskId === t.id;
    const timeSeconds = t.timeSpent || 0;

    let timeDisplay = "";
    if (isTimerActive) {
      const elapsed = Math.floor((Date.now() - activeTimer.startedAt) / 1000);
      timeDisplay = formatTimeLive(activeTimer.baseSeconds + elapsed);
    } else if (timeSeconds > 0) {
      timeDisplay = formatTime(timeSeconds);
    }

    const hasDescription = t.description && t.description.trim();

    return `
    <div class="task-card ${isCompleted ? "completed" : ""}" data-id="${t.id}">
      <div class="task-card-top">
        <div class="task-check ${isCompleted ? "checked" : ""}" onclick="toggleComplete('${t.id}', event)">
          ${isCompleted ? "&#10003;" : ""}
        </div>
        <span class="priority-badge ${t.priority}">${t.priority}</span>
        <div class="task-info" onclick="openEdit('${t.id}')">
          <div class="task-title">${esc(t.title)}</div>
        </div>
        <div class="task-time">
          <button class="btn-timer ${isTimerActive ? "running" : ""}" onclick="toggleTimer('${t.id}', event)" title="${isTimerActive ? "タイマー停止" : "タイマー開始"}">
            ${isTimerActive ? "⏸" : "▶"}
          </button>
          <span class="time-display" data-timer-id="${t.id}">${timeDisplay}</span>
        </div>
        <span class="status-badge ${t.status}">${t.status}</span>
        <div class="task-actions">
          <button onclick="openEdit('${t.id}')">編集</button>
          <button class="btn-delete" onclick="deleteTask('${t.id}', event)">削除</button>
        </div>
      </div>
      <div class="task-card-top">
        <div class="task-meta">
          ${t.category ? `<span>${esc(t.category)}</span>` : ""}
          ${t.deadline ? `<span class="${deadlineText.overdue ? "overdue" : ""}">${deadlineText.label}</span>` : ""}
        </div>
      </div>
      ${hasDescription ? `
      <div class="task-description-area">
        <hr class="task-description-separator">
        <div class="task-description">${esc(t.description)}</div>
      </div>` : ""}
    </div>`;
  }).join("");
}

function formatDeadline(d) {
  if (!d) return { label: "", overdue: false };
  const deadline = new Date(d + "T23:59:59");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
  const label = d.replace(/-/g, "/");
  if (diff < 0) return { label: `${label} (${Math.abs(diff)}日超過)`, overdue: true };
  if (diff === 0) return { label: `${label} (今日)`, overdue: false };
  if (diff <= 3) return { label: `${label} (あと${diff}日)`, overdue: false };
  return { label, overdue: false };
}

function esc(s) {
  if (!s) return "";
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ── プロジェクトドロップダウン ──

function populateProjectDropdown() {
  const sel = document.getElementById("f-project");
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">未分類</option>' +
    projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  // 値を復元
  if (currentVal && [...sel.options].some(o => o.value === currentVal)) {
    sel.value = currentVal;
  }
}

// ── タスクモーダル ──

function openAdd() {
  editingId = null;
  modalTitle.textContent = "タスク追加";
  form.reset();
  document.getElementById("f-timeSpent").value = "";
  // 現在のプロジェクトをデフォルト選択
  const projSel = document.getElementById("f-project");
  if (projSel) {
    populateProjectDropdown();
    projSel.value = currentProjectId || "";
  }
  modal.classList.add("active");
  document.getElementById("f-title").focus();
}

function openEdit(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  editingId = id;
  modalTitle.textContent = "タスク編集";
  document.getElementById("f-title").value = t.title;
  document.getElementById("f-description").value = t.description || "";
  document.getElementById("f-priority").value = t.priority;
  document.getElementById("f-status").value = t.status;
  document.getElementById("f-deadline").value = t.deadline || "";
  document.getElementById("f-category").value = t.category || "";
  document.getElementById("f-timeSpent").value = formatTime(t.timeSpent || 0);
  populateProjectDropdown();
  const projSel = document.getElementById("f-project");
  if (projSel) projSel.value = t.projectId || "";
  modal.classList.add("active");
}

function closeModal() {
  modal.classList.remove("active");
  editingId = null;
}

// モーダル外クリックで閉じる
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

// Escキーで閉じる
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (modal.classList.contains("active")) closeModal();
    if (projectModal.classList.contains("active")) closeProjectModal();
  }
});

// タスクフォーム送信
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const projSel = document.getElementById("f-project");
  const data = {
    title: document.getElementById("f-title").value.trim(),
    description: document.getElementById("f-description").value.trim(),
    priority: document.getElementById("f-priority").value,
    status: document.getElementById("f-status").value,
    deadline: document.getElementById("f-deadline").value,
    category: document.getElementById("f-category").value.trim(),
    projectId: projSel ? (projSel.value || null) : null,
  };
  if (!data.title) return;

  if (editingId) {
    await fetch(`${API_TASKS}/${editingId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } else {
    await fetch(API_TASKS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }
  closeModal();
  await loadTasks();
  await loadProjects(); // プロジェクト集計更新
});

// ── プロジェクトモーダル ──

function openAddProject() {
  editingProjectId = null;
  projectModalTitle.textContent = "プロジェクト追加";
  projectForm.reset();
  document.getElementById("pf-color").value = "#4a6cf7";
  projectModal.classList.add("active");
  document.getElementById("pf-name").focus();
}

function openEditProject(id, event) {
  event.stopPropagation();
  const p = projects.find(x => x.id === id);
  if (!p) return;
  editingProjectId = id;
  projectModalTitle.textContent = "プロジェクト編集";
  document.getElementById("pf-name").value = p.name;
  document.getElementById("pf-description").value = p.description || "";
  document.getElementById("pf-color").value = p.color || "#4a6cf7";
  projectModal.classList.add("active");
}

function closeProjectModal() {
  projectModal.classList.remove("active");
  editingProjectId = null;
}

async function handleProjectSubmit(e) {
  e.preventDefault();
  const data = {
    name: document.getElementById("pf-name").value.trim(),
    description: document.getElementById("pf-description").value.trim(),
    color: document.getElementById("pf-color").value,
  };
  if (!data.name) return;

  if (editingProjectId) {
    await fetch(`${API_PROJECTS}/${editingProjectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } else {
    await fetch(API_PROJECTS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }
  closeProjectModal();
  await loadProjects();
}

async function deleteProject(id, event) {
  event.stopPropagation();
  if (!confirm("このプロジェクトを削除しますか？\n所属タスクは「未分類」に移動します。")) return;
  await fetch(`${API_PROJECTS}/${id}`, { method: "DELETE" });
  await loadProjects();
  await loadTasks();
}

// ── 完了トグル ──

async function toggleComplete(id, event) {
  event.stopPropagation();
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  if (t.status !== "完了" && activeTimer && activeTimer.taskId === id) {
    await stopTimer();
    return;
  }
  const newStatus = t.status === "完了" ? "未着手" : "完了";
  await fetch(`${API_TASKS}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: newStatus }),
  });
  await loadTasks();
  await loadProjects();
}

// ── 削除 ──

async function deleteTask(id, event) {
  event.stopPropagation();
  if (!confirm("このタスクを削除しますか？")) return;
  if (activeTimer && activeTimer.taskId === id) {
    clearInterval(activeTimer.intervalId);
    activeTimer = null;
  }
  await fetch(`${API_TASKS}/${id}`, { method: "DELETE" });
  await loadTasks();
  await loadProjects();
}
