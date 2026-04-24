const STORAGE_KEY = "task-orbit-v1";

const state = {
  tasks: loadTasks(),
  editingId: null,
  sortables: [],
  filters: {
    q: "",
    status: "all",
    priority: "all",
  },
};

const els = {
  form: document.getElementById("task-form"),
  title: document.getElementById("task-title"),
  deadline: document.getElementById("task-deadline"),
  priority: document.getElementById("task-priority"),
  tags: document.getElementById("task-tags"),
  search: document.getElementById("search-input"),
  statusFilter: document.getElementById("status-filter"),
  priorityFilter: document.getElementById("priority-filter"),
  groups: document.getElementById("task-groups"),
  empty: document.getElementById("list-empty"),
  clearDone: document.getElementById("clear-done"),
  statTotal: document.getElementById("stat-total"),
  statActive: document.getElementById("stat-active"),
  statDone: document.getElementById("stat-done"),
  submitBtn: document.getElementById("submit-btn"),
};

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const title = els.title.value.trim();
  if (!title) return;

  const payload = {
    title,
    deadline: els.deadline.value || "",
    priority: els.priority.value,
    tags: parseTags(els.tags.value),
  };

  if (state.editingId) {
    state.tasks = state.tasks.map((t) => {
      if (t.id !== state.editingId) return t;
      return { ...t, ...payload };
    });
    state.editingId = null;
  } else {
    state.tasks.unshift({
      id: crypto.randomUUID(),
      done: false,
      createdAt: Date.now(),
      ...payload,
    });
  }

  saveTasks();
  els.form.reset();
  els.priority.value = "medium";
  render();
});

els.search.addEventListener("input", () => {
  state.filters.q = els.search.value.trim().toLowerCase();
  render();
});

els.statusFilter.addEventListener("change", () => {
  state.filters.status = els.statusFilter.value;
  render();
});

els.priorityFilter.addEventListener("change", () => {
  state.filters.priority = els.priorityFilter.value;
  render();
});

els.clearDone.addEventListener("click", () => {
  state.tasks = state.tasks.filter((t) => !t.done);
  saveTasks();
  render();
});

els.groups.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;
  const item = e.target.closest("li[data-id]");
  if (!item) return;
  const id = item.dataset.id;

  if (button.dataset.action === "toggle") {
    state.tasks = state.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
    saveTasks();
    render();
    return;
  }

  if (button.dataset.action === "edit") {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    state.editingId = task.id;
    els.title.value = task.title;
    els.deadline.value = task.deadline;
    els.priority.value = task.priority;
    els.tags.value = task.tags.join(", ");
    els.title.focus();
    return;
  }

  if (button.dataset.action === "delete") {
    state.tasks = state.tasks.filter((t) => t.id !== id);
    if (state.editingId === id) {
      state.editingId = null;
      els.form.reset();
      els.priority.value = "medium";
    }
    saveTasks();
    render();
  }
});

function getFilteredTasks() {
  return state.tasks.filter((task) => {
    const hitSearch =
      !state.filters.q ||
      task.title.toLowerCase().includes(state.filters.q) ||
      task.tags.join(" ").toLowerCase().includes(state.filters.q);

    const hitStatus =
      state.filters.status === "all" ||
      (state.filters.status === "done" && task.done) ||
      (state.filters.status === "active" && !task.done);

    const hitPriority = state.filters.priority === "all" || task.priority === state.filters.priority;

    return hitSearch && hitStatus && hitPriority;
  });
}

function render() {
  const grouped = getGroupedTasks();
  const totalVisible = grouped.today.length + grouped.week.length + grouped.later.length + grouped.none.length;
  els.groups.innerHTML = [
    groupToHtml("today", "今日", grouped.today),
    groupToHtml("week", "今週", grouped.week),
    groupToHtml("later", "来週以降", grouped.later),
    groupToHtml("none", "期限なし", grouped.none),
  ].join("");
  els.empty.hidden = totalVisible > 0;
  initSortables(grouped);
  updateSummary();
  els.submitBtn.textContent = state.editingId ? "変更を保存" : "タスクを追加";
}

function getGroupedTasks() {
  const grouped = { today: [], week: [], later: [], none: [] };
  const now = new Date();
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);
  const endWeek = new Date(now);
  const remainingDays = (7 - endWeek.getDay()) % 7;
  endWeek.setDate(endWeek.getDate() + remainingDays);
  endWeek.setHours(23, 59, 59, 999);

  for (const task of getFilteredTasks()) {
    if (!task.deadline) {
      grouped.none.push(task);
      continue;
    }

    const date = new Date(task.deadline);
    if (Number.isNaN(date.getTime())) {
      grouped.none.push(task);
      continue;
    }

    if (date <= endToday) {
      grouped.today.push(task);
      continue;
    }

    if (date <= endWeek) {
      grouped.week.push(task);
      continue;
    }

    grouped.later.push(task);
  }

  return grouped;
}

function groupToHtml(key, title, tasks) {
  return `
    <section class="group" data-group="${key}">
      <div class="group-head">
        <h3 class="group-title">${title}</h3>
        <span class="group-count">${tasks.length}件</span>
      </div>
      <ul class="task-list" data-group-list="${key}">
        ${tasks.map((task) => taskToHtml(task)).join("")}
      </ul>
    </section>
  `;
}

function initSortables(grouped) {
  for (const sortable of state.sortables) {
    sortable.destroy();
  }
  state.sortables = [];

  const lists = els.groups.querySelectorAll("[data-group-list]");
  for (const list of lists) {
    const group = list.dataset.groupList;
    const sortable = new Sortable(list, {
      animation: 180,
      handle: ".drag-handle",
      ghostClass: "sortable-ghost",
      onEnd: (evt) => {
        const oldIndex = evt.oldDraggableIndex ?? evt.oldIndex;
        const newIndex = evt.newDraggableIndex ?? evt.newIndex;
        if (oldIndex == null || newIndex == null || oldIndex === newIndex) {
          return;
        }
        reorderWithinGroup(group, oldIndex, newIndex, grouped);
      },
    });
    state.sortables.push(sortable);
  }
}

function reorderWithinGroup(group, oldIndex, newIndex, grouped) {
  const ids = grouped[group].map((task) => task.id);
  const movedId = ids[oldIndex];
  if (!movedId) return;

  ids.splice(oldIndex, 1);
  ids.splice(newIndex, 0, movedId);
  const idSet = new Set(ids);
  let pointer = 0;

  state.tasks = state.tasks.map((task) => {
    if (!idSet.has(task.id)) {
      return task;
    }
    const nextId = ids[pointer++];
    return state.tasks.find((t) => t.id === nextId) || task;
  });

  saveTasks();
  render();
}

function updateSummary() {
  const total = state.tasks.length;
  const done = state.tasks.filter((task) => task.done).length;
  const active = total - done;
  els.statTotal.textContent = String(total);
  els.statActive.textContent = String(active);
  els.statDone.textContent = String(done);
}

function taskToHtml(task) {
  const date = task.deadline ? formatDeadline(task.deadline) : "期限なし";
  const safeTitle = escapeHtml(task.title);
  const safeTags = task.tags.map((tag) => `<span class="badge">#${escapeHtml(tag)}</span>`).join("");

  return `
    <li class="task-item" data-id="${task.id}">
      <span class="drag-handle" aria-hidden="true">☰</span>
      <div class="task-main">
        <p class="task-title ${task.done ? "done" : ""}">${safeTitle}</p>
        <div class="task-meta">
          <span class="badge ${task.priority}">優先: ${priorityLabel(task.priority)}</span>
          <span class="badge">${escapeHtml(date)}</span>
          ${safeTags}
        </div>
      </div>
      <div class="task-actions">
        <button class="icon-btn" data-action="toggle" type="button">${task.done ? "戻す" : "完了"}</button>
        <button class="icon-btn" data-action="edit" type="button">編集</button>
        <button class="icon-btn delete" data-action="delete" type="button">削除</button>
      </div>
    </li>
  `;
}

function priorityLabel(priority) {
  if (priority === "high") return "高";
  if (priority === "low") return "低";
  return "中";
}

function formatDeadline(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "期限なし";
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseTags(raw) {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

render();
