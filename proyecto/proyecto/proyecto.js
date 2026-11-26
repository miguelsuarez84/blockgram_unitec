(() => {
  window.blockgramReady.then((authenticated) => {
    if (!authenticated) return;

    (() => {
  "use strict";

  const accountUsername = window.blockgramAccountUsername;
  const accountStorageKey = window.blockgramAccountStorageKey;
  const STORAGE_KEY = accountStorageKey("notes", accountUsername);
  const PROJECTS_KEY = accountStorageKey("projects", accountUsername);
  const STREAK_KEY = accountStorageKey("progress", accountUsername);
  const ATTACHMENTS_DB_NAME = window.blockgramAttachmentDBName || "blockgramAttachments";
  const ATTACHMENTS_STORE_NAME = "noteAttachments";
  const MAX_SYNC_REQUEST_BYTES = 2 * 1024 * 1024;
  const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
  const MAX_BACKUP_ATTACHMENTS_SIZE = 50 * 1024 * 1024;
  const allowedAttachmentName = /\.(?:png|jpe?g|gif|webp|avif|bmp|tiff?|heic|heif|ico|svg|pdf|docx?|odt|pptx?|xlsx?|txt|md|csv|rtf|py|js|mjs|jsx|ts|tsx|html|css|json|java|c|h|cpp|cs|go|rs|sql|xml|ya?ml|toml|ipynb|sh|ps1|bat|php|rb|kt|swift|dart|r|log|ini|zip)$/i;
  const notesView = document.getElementById("notesWorkspaceView");
  const projectWorkspace = document.getElementById("projectWorkspace");
  const globalNoteSearch = document.getElementById("globalNoteSearch");
  const globalSearchResults = document.getElementById("globalNoteSearchResults");
  const listElement = document.getElementById("workspaceNoteList");
  const searchInput = document.getElementById("workspaceNoteSearch");
  const titleInput = document.getElementById("workspaceNoteTitle");
  const contentInput = document.getElementById("workspaceNoteContent");
  const linkInput = document.getElementById("workspaceNoteLink");
  const languageInput = document.getElementById("workspaceNoteLanguage");
  const languageTag = document.getElementById("workspaceLanguageTag");
  const attachmentInput = document.getElementById("noteAttachmentInput");
  const attachmentList = document.getElementById("noteAttachmentsList");
  const attachmentEmptyState = document.getElementById("noteAttachmentsEmpty");
  const streakCount = document.getElementById("streakCount");
  const streakUnit = document.getElementById("streakUnit");
  const emptyState = document.getElementById("workspaceEmptyState");
  const editor = document.getElementById("workspaceEditor");
  const saveStatus = document.getElementById("workspaceSaveStatus");
  const editorSaveState = document.getElementById("editorSaveState");
  const supportedLanguages = ["auto", "python", "javascript", "html", "css", "json", "text"];
  const languageNames = {
    auto: "Automático",
    python: "Python",
    javascript: "JavaScript",
    html: "HTML",
    css: "CSS",
    json: "JSON",
    text: "Texto"
  };
  const codeMirrorModes = {
    python: "python",
    javascript: "javascript",
    html: "htmlmixed",
    css: "css",
    json: "application/json",
    text: "text/plain"
  };
  let notes = [];
  let savedNotesSnapshot = "[]";
  let savedProjectsSnapshot = "{\"projects\":[],\"selectedProjectId\":null,\"activeWorkSession\":null}";
  let codeEditor = null;
  let syncingCodeEditor = false;
  let selectedId = null;
  let newestFirst = true;
  let saveTimeout = 0;
  let remoteSyncTimeout = 0;
  let remoteSyncQueue = Promise.resolve();
  let accountRevision = window.blockgramAccountRevision;
  let syncConflict = window.blockgramSyncConflict || null;
  let accountMismatch = false;
  let noteDirty = false;
  let toastTimeout = 0;
  let attachmentDBPromise = null;
  let attachmentRenderSequence = 0;
  let attachmentObjectUrls = [];
  let streakState = { count: 0, lastProgressDate: "" };
  let projects = [];
  let selectedProjectId = null;
  let activeWorkSession = null;
  const today = new Date();
  let displayedMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let selectedCalendarDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const setSyncStatus = (message) => {
    const status = document.getElementById("accountSyncStatus");
    if (status) status.textContent = message;
  };
  const showSyncConflict = () => {
    const panel = document.getElementById("syncConflictPanel");
    panel.hidden = !syncConflict;
    if (syncConflict) {
      panel.querySelector("p").textContent = syncConflict.reason ||
        "Ambas versiones se conservaron. Elige cuál guardar en la cuenta o descarga las dos para compararlas.";
      setSyncStatus("Conflicto por resolver");
    }
  };
  const currentAccountData = () => window.blockgramValidateAccountData({
    notes: JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"),
    ...JSON.parse(localStorage.getItem(PROJECTS_KEY) || "{\"projects\":[]}"),
    dailyProgress: JSON.parse(localStorage.getItem(STREAK_KEY) || "{\"count\":0,\"lastProgressDate\":\"\"}")
  });
  const saveConflict = (localData, remoteData, revision) => {
    syncConflict = {
      localData: window.blockgramValidateAccountData(localData),
      remoteData: window.blockgramValidateAccountData(remoteData),
      remoteRevision: revision
    };
    window.blockgramSyncConflict = syncConflict;
    showSyncConflict();
  };
  const syncAccountData = () => {
    if (window.blockgramOffline) {
      setSyncStatus("Solo en este dispositivo");
      return Promise.resolve();
    }
    remoteSyncQueue = remoteSyncQueue.catch(() => {}).then(async () => {
      if (syncConflict || accountMismatch) return;
      const data = currentAccountData();
      const body = JSON.stringify({ ...data, expectedRevision: accountRevision });
      if (new TextEncoder().encode(body).byteLength > MAX_SYNC_REQUEST_BYTES) {
        const error = new Error("Los datos superan el límite de sincronización de 2 MiB. Exporta un respaldo y reduce el contenido.");
        error.code = "SYNC_PAYLOAD_TOO_LARGE";
        throw error;
      }
      setSyncStatus("Sincronizando...");
      const response = await fetch("/api/data", {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Blockgram-Account": accountUsername
        },
        body
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 409 && result.data && Number.isSafeInteger(result.revision)) {
        saveConflict(data, result.data, result.revision);
        showMessage("Se detectaron cambios simultáneos. Ambas versiones se conservaron; elige cómo resolverlos.");
        return;
      }
      if (response.status === 409) {
        accountMismatch = true;
        setSyncStatus("Cuenta distinta en otra pestaña");
        showMessage("La sesión de esta pestaña cambió en otra ventana. Tus datos locales se conservaron; recarga para entrar con la cuenta actual.");
        return;
      }
      if (!response.ok) throw new Error(result.error || "No se pudieron sincronizar los datos.");
      if (!Number.isSafeInteger(result.revision) || result.revision <= accountRevision) {
        throw new Error("El servidor devolvió una revisión de datos inválida.");
      }
      accountRevision = result.revision;
      window.blockgramAccountRevision = accountRevision;
      setSyncStatus("Sincronizado");
    }).catch((error) => {
      console.error("No se pudieron sincronizar los datos de la cuenta:", error);
      setSyncStatus("Error de sincronización");
      showMessage(error.code === "SYNC_PAYLOAD_TOO_LARGE"
        ? error.message
        : `Los cambios quedaron en este dispositivo, pero no se sincronizaron: ${error.message || "revisa la conexión y vuelve a intentarlo."}`);
      throw error;
    });
    return remoteSyncQueue;
  };
  const queueAccountSync = () => {
    if (window.blockgramOffline) {
      setSyncStatus("Solo en este dispositivo");
      return;
    }
    if (syncConflict || accountMismatch) return;
    window.clearTimeout(remoteSyncTimeout);
    setSyncStatus("Cambios pendientes...");
    remoteSyncTimeout = window.setTimeout(() => {
      syncAccountData().catch(() => {});
    }, 500);
  };
  window.blockgramFlushSync = () => {
    window.clearTimeout(remoteSyncTimeout);
    if (window.blockgramOffline) return Promise.resolve();
    if (syncConflict) return Promise.reject(new Error("Resuelve el conflicto de sincronización antes de cerrar sesión."));
    if (accountMismatch) return Promise.reject(new Error("Recarga la página para usar la cuenta activa."));
    return syncAccountData();
  };

  const setConflictButtonsDisabled = (disabled) => {
    ["keepLocalSyncConflict", "keepRemoteSyncConflict", "exportSyncConflict"].forEach((id) => {
      document.getElementById(id).disabled = disabled;
    });
  };
  const handleConflictAction = async (action) => {
    setConflictButtonsDisabled(true);
    try {
      if (action === "export") {
        const localData = currentAccountData();
        const blob = new Blob([JSON.stringify({
          local: localData,
          remote: syncConflict.remoteData,
          exportedAt: new Date().toISOString()
        }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `blockgram-conflicto-${new Date().toISOString().slice(0, 10)}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        return;
      }
      if (action === "remote") {
        window.blockgramStoreAccountData(syncConflict.remoteData, accountUsername);
        accountRevision = syncConflict.remoteRevision;
        window.blockgramAccountRevision = accountRevision;
        syncConflict = null;
        window.blockgramSyncConflict = null;
        window.blockgramPendingConflict = false;
        window.location.reload();
        return;
      }

      const data = currentAccountData();
      const body = JSON.stringify({ ...data, expectedRevision: syncConflict.remoteRevision });
      if (new TextEncoder().encode(body).byteLength > MAX_SYNC_REQUEST_BYTES) {
        throw new Error("Los datos superan el límite de sincronización de 2 MiB. Exporta un respaldo y reduce el contenido.");
      }
      const response = await fetch("/api/data", {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Blockgram-Account": accountUsername
        },
        body
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 409 && result.data && Number.isSafeInteger(result.revision)) {
        saveConflict(data, result.data, result.revision);
        showMessage("La cuenta volvió a cambiar. Se conservaron ambas versiones; vuelve a elegir.");
        return;
      }
      if (!response.ok) throw new Error(result.error || "No se pudo guardar la versión local.");
      if (!Number.isSafeInteger(result.revision)) throw new Error("El servidor devolvió una revisión inválida.");
      accountRevision = result.revision;
      window.blockgramAccountRevision = accountRevision;
      syncConflict = null;
      window.blockgramSyncConflict = null;
      window.blockgramPendingConflict = false;
      showSyncConflict();
      setSyncStatus("Sincronizado");
      showMessage("Se guardó tu versión local en la cuenta.");
    } catch (error) {
      console.error("No se pudo resolver el conflicto de sincronización:", error);
      showMessage(error.message || "No se pudo resolver el conflicto. Ambas versiones se conservaron.");
    } finally {
      setConflictButtonsDisabled(false);
    }
  };
  document.getElementById("keepLocalSyncConflict").addEventListener("click", () => handleConflictAction("local"));
  document.getElementById("keepRemoteSyncConflict").addEventListener("click", () => handleConflictAction("remote"));
  document.getElementById("exportSyncConflict").addEventListener("click", () => handleConflictAction("export"));
  showSyncConflict();

  // ===== SISTEMA DE EXPORTAR/IMPORTAR JSON =====

  const exportData = async () => {
    try {
      const attachmentRecords = await getAllAttachments();
      const totalAttachmentSize = attachmentRecords.reduce((sum, item) => sum + item.size, 0);
      if (totalAttachmentSize > MAX_BACKUP_ATTACHMENTS_SIZE) {
        showMessage("El respaldo supera 50 MB de archivos adjuntos. Reduce los adjuntos e inténtalo otra vez.");
        return;
      }
      const attachments = await Promise.all(attachmentRecords.map(async (item) => ({
        id: item.id,
        noteId: item.noteId,
        name: item.name,
        type: item.type,
        size: item.size,
        createdAt: item.createdAt,
        data: await blobToBase64(item.blob)
      })));
      const data = {
        notes,
        projects,
        selectedProjectId,
        activeWorkSession,
        dailyProgress: streakState,
        attachments,
        exportDate: new Date().toISOString(),
        version: "1.1"
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `blockgram-backup-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showMessage("Respaldo de Blockgram exportado con sus archivos adjuntos.");
    } catch (error) {
      console.error("No se pudieron exportar los datos de Blockgram:", error);
      showMessage("No se pudo crear el respaldo. Revisa el almacenamiento del navegador e inténtalo de nuevo.");
    }
  };

  const importData = (file) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);

        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("El respaldo debe contener un objeto JSON.");
        }
        if (data.attachments !== undefined && !Array.isArray(data.attachments)) {
          throw new Error("Formato inválido: los archivos adjuntos deben ser una lista.");
        }
        const accountData = window.blockgramValidateAccountData({
          notes: data.notes,
          projects: data.projects,
          selectedProjectId: data.selectedProjectId || null,
          activeWorkSession: data.activeWorkSession || null,
          dailyProgress: data.dailyProgress
        });
        const importedNotes = accountData.notes.map(normalizeNote);
        const noteIds = new Set(importedNotes.map((note) => note.id));
        const importedAttachmentIds = new Set();
        const importedAttachments = (data.attachments || []).map((item) => {
          if (!item || typeof item.id !== "string" || typeof item.noteId !== "string" ||
            !noteIds.has(item.noteId) || typeof item.name !== "string" ||
            item.name.length > 255 || !allowedAttachmentName.test(item.name) ||
            importedAttachmentIds.has(item.id) || typeof item.type !== "string" ||
            !Number.isSafeInteger(item.size) || item.size < 0 || item.size > MAX_ATTACHMENT_SIZE ||
            typeof item.data !== "string" || item.data.length > Math.ceil(MAX_ATTACHMENT_SIZE * 4 / 3) + 4) {
            throw new Error("El respaldo contiene un archivo adjunto inválido.");
          }
          importedAttachmentIds.add(item.id);
          const blob = base64ToBlob(item.data, item.type);
          if (blob.size !== item.size) throw new Error(`El tamaño de “${item.name}” no coincide con el respaldo.`);
          return {
            id: item.id,
            noteId: item.noteId,
            name: item.name,
            type: item.type,
            size: blob.size,
            createdAt: Number(item.createdAt) || Date.now(),
            blob
          };
        });
        if (importedAttachments.reduce((sum, item) => sum + item.size, 0) > MAX_BACKUP_ATTACHMENTS_SIZE) {
          throw new Error("El respaldo contiene más de 50 MB de archivos adjuntos.");
        }
        let importedStreak = null;
        if (data.dailyProgress !== undefined) {
          const progress = data.dailyProgress;
          if (!progress || !Number.isSafeInteger(progress.count) || progress.count < 0 ||
            typeof progress.lastProgressDate !== "string" ||
            (progress.lastProgressDate && !/^\d{4}-\d{2}-\d{2}$/.test(progress.lastProgressDate))) {
            throw new Error("El respaldo contiene una racha inválida.");
          }
          importedStreak = { count: progress.count, lastProgressDate: progress.lastProgressDate };
        }

        // Confirmar importación
        if (!window.confirm(`¿Importar ${importedNotes.length} notas, ${data.projects.length} proyectos y ${importedAttachments.length} archivos adjuntos?\n\nEsto reemplazará tus datos actuales.`)) {
          return;
        }

        const oldNotes = localStorage.getItem(STORAGE_KEY);
        const oldProjects = localStorage.getItem(PROJECTS_KEY);
        const oldStreak = localStorage.getItem(STREAK_KEY);
        const importedProjects = accountData.projects;
        const importedProjectState = {
          projects: importedProjects,
          selectedProjectId: accountData.selectedProjectId,
          activeWorkSession: accountData.activeWorkSession
        };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(importedNotes));
          localStorage.setItem(PROJECTS_KEY, JSON.stringify(importedProjectState));
          localStorage.setItem(STREAK_KEY, JSON.stringify(importedStreak || accountData.dailyProgress));
          if (window.indexedDB) {
            await replaceAllAttachments(importedAttachments);
          } else if (importedAttachments.length) {
            throw new Error("Este navegador no permite restaurar archivos adjuntos.");
          }
        } catch (error) {
          try {
            if (oldNotes === null) localStorage.removeItem(STORAGE_KEY);
            else localStorage.setItem(STORAGE_KEY, oldNotes);
            if (oldProjects === null) localStorage.removeItem(PROJECTS_KEY);
            else localStorage.setItem(PROJECTS_KEY, oldProjects);
            if (oldStreak === null) localStorage.removeItem(STREAK_KEY);
            else localStorage.setItem(STREAK_KEY, oldStreak);
          } catch (restoreError) {
            console.error("No se pudieron restaurar los datos anteriores tras fallar la importación:", restoreError);
          }
          throw error;
        }
        notes = importedNotes;
        savedNotesSnapshot = JSON.stringify(importedNotes);
        projects = importedProjects;
        selectedProjectId = importedProjectState.selectedProjectId;
        activeWorkSession = importedProjectState.activeWorkSession;
        savedProjectsSnapshot = JSON.stringify(importedProjectState);
        streakState = importedStreak || accountData.dailyProgress;
        renderStreak();
        queueAccountSync();

        // Renderizar
        renderList();
        renderDashboardRecentNotes();
        renderProjects();
        if (selectedId) renderEditor();

        showMessage(`Datos importados: ${notes.length} notas, ${projects.length} proyectos y ${importedAttachments.length} archivos adjuntos.`);
      } catch (error) {
        console.error("Error al importar:", error);
        showMessage(`Error al importar: ${error.message || "archivo inválido"}`);
      }
    };

    reader.readAsText(file);
  };

  // Event listeners para exportar/importar
  document.getElementById("exportData").addEventListener("click", exportData);

  document.getElementById("importData").addEventListener("click", () => {
    document.getElementById("importFile").click();
  });

  document.getElementById("importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      importData(file);
      e.target.value = ""; // Limpiar input
    }
  });

  // ===== FIN DE EXPORTAR/IMPORTAR =====

  const showMessage = (message) => {
    let toast = document.getElementById("notesToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "notesToast";
      toast.className = "toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 2800);
  };

  const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const isValidDateKey = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  };
  const sameLocalDay = (first, second) => first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() && first.getDate() === second.getDate();
  const loadStreak = () => {
    try {
      const saved = localStorage.getItem(STREAK_KEY);
      if (!saved) return { count: 0, lastProgressDate: "" };
      const parsed = JSON.parse(saved);
      if (!parsed || !Number.isSafeInteger(parsed.count) || parsed.count < 0 ||
        typeof parsed.lastProgressDate !== "string" ||
        (parsed.lastProgressDate && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.lastProgressDate))) {
        throw new Error("El registro de progreso no tiene el formato esperado.");
      }
      return { count: parsed.count, lastProgressDate: parsed.lastProgressDate };
    } catch (error) {
      console.error("No se pudo cargar la racha de Blockgram:", error);
      showMessage(`No se pudo cargar la racha guardada: ${error.message || "el formato no es válido."}`);
      return { count: 0, lastProgressDate: "" };
    }
  };
  const currentStreakCount = () => {
    if (!streakState.lastProgressDate) return 0;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return [dateKey(new Date()), dateKey(yesterday)].includes(streakState.lastProgressDate)
      ? streakState.count
      : 0;
  };
  const renderStreak = () => {
    const count = currentStreakCount();
    streakCount.textContent = String(count);
    streakUnit.textContent = count === 1 ? "día" : "días";
  };
  streakState = loadStreak();
  renderStreak();
  const recordProgress = () => {
    const todayKey = dateKey(new Date());
    if (streakState.lastProgressDate === todayKey) {
      renderStreak();
      return false;
    }
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const nextState = {
      count: streakState.lastProgressDate === dateKey(yesterday) ? streakState.count + 1 : 1,
      lastProgressDate: todayKey
    };
    try {
      localStorage.setItem(STREAK_KEY, JSON.stringify(nextState));
      queueAccountSync();
    } catch (error) {
      console.error("No se pudo guardar la racha de Blockgram:", error);
      showMessage(`No se pudo guardar la racha: ${error.message || "revisa el almacenamiento del navegador."}`);
      return false;
    }
    streakState = nextState;
    renderStreak();
    return true;
  };
  const renderCalendarAgenda = (projectsByDeadline) => {
    const agenda = document.getElementById("scheduleAgenda");
    const label = new Intl.DateTimeFormat("es", {
      weekday: "long", day: "numeric", month: "long", year: "numeric"
    }).format(selectedCalendarDate);
    document.getElementById("agendaDateLabel").textContent = `Agenda · ${label}`;
    const dueProjects = projectsByDeadline.get(dateKey(selectedCalendarDate)) || [];
    document.getElementById("agendaEventCount").textContent = dueProjects.length === 1
      ? "1 entrega"
      : `${dueProjects.length} entregas`;
    agenda.replaceChildren();
    if (!dueProjects.length) {
      const empty = document.createElement("p");
      empty.className = "agenda-empty";
      empty.textContent = "No hay entregas de proyectos para esta fecha.";
      agenda.append(empty);
      return;
    }
    dueProjects.forEach((project) => {
      const item = document.createElement("article");
      item.className = "agenda-event";
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      item.setAttribute("aria-label", `Abrir el plan ${project.name}`);
      const openProject = () => {
        selectedProjectId = project.id;
        openProjectWorkspace();
      };
      item.addEventListener("click", openProject);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openProject();
        }
      });
      const icon = document.createElement("span");
      icon.className = "agenda-event-icon";
      icon.textContent = project.type === "exam" ? "✎" : project.type === "task" ? "☑" : "▦";
      const details = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = project.name;
      const description = document.createElement("small");
      const completed = project.tasks.filter((task) => task.done).length;
      description.textContent = `${projectTypes[project.type] || "Proyecto"} · ${completed}/${project.tasks.length} tareas completadas`;
      details.append(title, description);
      const marker = document.createElement("span");
      marker.className = "agenda-due-label";
      marker.textContent = "Entrega";
      item.append(icon, details, marker);
      agenda.append(item);
    });
  };
  const renderMonthlyCalendar = () => {
    const grid = document.getElementById("monthGrid");
    const today = new Date();
    const projectsByDeadline = new Map();
    const notesById = new Map(notes.map((note) => [note.id, note]));
    const dayLabelFormatter = new Intl.DateTimeFormat("es", {
      weekday: "long", day: "numeric", month: "long", year: "numeric"
    });
    projects.forEach((project) => {
      if (!project.deadline) return;
      const deadlineProjects = projectsByDeadline.get(project.deadline) || [];
      deadlineProjects.push(project);
      projectsByDeadline.set(project.deadline, deadlineProjects);
    });
    document.getElementById("monthLabel").textContent = new Intl.DateTimeFormat("es", {
      month: "long", year: "numeric"
    }).format(displayedMonth);
    grid.replaceChildren();
    const first = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(1 - first.getDay());
    for (let offset = 0; offset < 42; offset++) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + offset);
      const key = dateKey(date);
      const dueProjects = projectsByDeadline.get(key) || [];
      const projectNames = dueProjects.map((project) => project.name).join(", ");
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `month-day${date.getMonth() !== displayedMonth.getMonth() ? " outside-month" : ""}${sameLocalDay(date, today) ? " today" : ""}${sameLocalDay(date, selectedCalendarDate) ? " selected-day" : ""}${dueProjects.length ? " has-events" : ""}`;
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", dayLabelFormatter.format(date));
      if (sameLocalDay(date, today)) cell.setAttribute("aria-current", "date");
      const dayNumber = document.createElement("strong");
      dayNumber.textContent = date.getDate();
      cell.append(dayNumber);
      if (dueProjects.length) {
        const events = document.createElement("span");
        events.className = "month-day-events";
        events.textContent = projectNames;
        events.title = projectNames;

        const linkedNotes = dueProjects
          .map((project) => notesById.get(project.noteId))
          .filter(Boolean);

        if (linkedNotes.length > 0) {
          events.classList.add("has-linked-notes");
          events.setAttribute("data-tooltip", `${linkedNotes.length} nota(s) vinculada(s)`);
          events.classList.add("tooltip");
        }

        cell.append(events);
      }
      cell.setAttribute("aria-selected", String(sameLocalDay(date, selectedCalendarDate)));
      cell.addEventListener("click", () => {
        selectedCalendarDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        if (date.getMonth() !== displayedMonth.getMonth()) displayedMonth = new Date(date.getFullYear(), date.getMonth(), 1);
        renderMonthlyCalendar();
      });
      grid.append(cell);
    }
    renderCalendarAgenda(projectsByDeadline);
  };
  const normalizeNote = (note) => ({
    id: String(note.id || makeId()),
    title: String(note.title || "Nota sin título"),
    content: String(note.content || ""),
    linkedTo: String(note.linkedTo || ""),
    language: supportedLanguages.includes(note.language) ? note.language : "auto",
    createdAt: Number(note.createdAt) || Date.now(),
    updatedAt: Number(note.updatedAt) || Number(note.createdAt) || Date.now()
  });

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) throw new Error("La biblioteca guardada no tiene el formato esperado.");
      notes = parsed.map(normalizeNote);
      savedNotesSnapshot = JSON.stringify(notes);
    }
  } catch (error) {
    console.error("No se pudo cargar la biblioteca de notas:", error);
    showMessage("No se pudieron cargar las notas guardadas. Prueba a recargar la página.");
    notes = [];
  }

  try {
    const savedProjects = localStorage.getItem(PROJECTS_KEY);
    if (savedProjects) {
      const parsed = JSON.parse(savedProjects);
      if (!parsed || !Array.isArray(parsed.projects)) throw new Error("Los proyectos guardados no tienen el formato esperado.");
      projects = parsed.projects;
      selectedProjectId = parsed.selectedProjectId || null;
      activeWorkSession = parsed.activeWorkSession || null;
      savedProjectsSnapshot = JSON.stringify({
        projects,
        selectedProjectId,
        activeWorkSession
      });
    }
  } catch (error) {
    console.error("No se pudieron cargar los proyectos:", error);
    showMessage("No se pudieron cargar los proyectos guardados. Prueba a recargar la página.");
    projects = [];
    selectedProjectId = null;
    activeWorkSession = null;
  }

  const saveNotes = () => {
    try {
      window.blockgramValidateAccountData({
        notes,
        projects,
        selectedProjectId,
        activeWorkSession,
        dailyProgress: streakState
      });
      const serialized = JSON.stringify(notes);
      localStorage.setItem(STORAGE_KEY, serialized);
      savedNotesSnapshot = serialized;
      queueAccountSync();
      saveStatus.textContent = "Guardado en este dispositivo";
      editorSaveState.textContent = "Guardado";
      return true;
    } catch (error) {
      notes = JSON.parse(savedNotesSnapshot);
      if (!notes.some((note) => note.id === selectedId)) selectedId = notes[0]?.id || null;
      noteDirty = false;
      renderList();
      renderEditor();
      console.error("No se pudieron guardar las notas:", error);
      saveStatus.textContent = "No se pudo guardar";
      editorSaveState.textContent = "Error al guardar";
      showMessage(`No se pudo guardar la nota: ${error.message || "revisa el almacenamiento de tu navegador."}`);
      return false;
    }
  };

  const openAttachmentsDatabase = () => {
    if (!window.indexedDB) return Promise.reject(new Error("Este navegador no permite guardar archivos localmente."));
    if (!attachmentDBPromise) {
      attachmentDBPromise = new Promise((resolve, reject) => {
        const request = window.indexedDB.open(ATTACHMENTS_DB_NAME, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          const store = database.objectStoreNames.contains(ATTACHMENTS_STORE_NAME)
            ? request.transaction.objectStore(ATTACHMENTS_STORE_NAME)
            : database.createObjectStore(ATTACHMENTS_STORE_NAME, { keyPath: "id" });
          if (!store.indexNames.contains("noteId")) store.createIndex("noteId", "noteId", { unique: false });
        };
        request.onsuccess = () => {
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        };
        request.onerror = () => {
          attachmentDBPromise = null;
          reject(request.error || new Error("No se pudo abrir el almacenamiento de archivos."));
        };
      });
    }
    return attachmentDBPromise;
  };
  const runAttachmentTransaction = (mode, action) => openAttachmentsDatabase().then((database) =>
    new Promise((resolve, reject) => {
      const transaction = database.transaction(ATTACHMENTS_STORE_NAME, mode);
      let request;
      try {
        request = action(transaction.objectStore(ATTACHMENTS_STORE_NAME));
      } catch (error) {
        transaction.abort();
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(request && "result" in request ? request.result : undefined);
      transaction.onabort = () => reject(transaction.error || request?.error || new Error("No se pudo completar la operación de archivos."));
      transaction.onerror = () => reject(transaction.error || new Error("Falló el almacenamiento de archivos."));
    }));
  const getNoteAttachments = (noteId) => runAttachmentTransaction("readonly", (store) =>
    store.index("noteId").getAll(IDBKeyRange.only(noteId)));
  const getAllAttachments = () => window.indexedDB
    ? runAttachmentTransaction("readonly", (store) => store.getAll())
    : Promise.resolve([]);
  const replaceAllAttachments = (attachments) => runAttachmentTransaction("readwrite", (store) => {
    store.clear();
    attachments.forEach((attachment) => store.put(attachment));
  });
  const saveNoteAttachment = (noteId, file) => runAttachmentTransaction("readwrite", (store) =>
    store.add({
      id: makeId(),
      noteId,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      createdAt: Date.now(),
      blob: file.slice(0, file.size, file.type)
    }));
  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new Error("No se pudo codificar un archivo adjunto."));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer un archivo adjunto."));
    reader.readAsDataURL(blob);
  });
  const base64ToBlob = (value, type) => {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      throw new Error("El respaldo contiene datos de archivo inválidos.");
    }
    const binary = window.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type });
  };
  const deleteNoteAttachment = (attachmentId) => runAttachmentTransaction("readwrite", (store) =>
    store.delete(attachmentId));
  const deleteAttachmentsForNote = (noteId) => runAttachmentTransaction("readwrite", (store) => {
    const request = store.index("noteId").getAllKeys(IDBKeyRange.only(noteId));
    request.onsuccess = () => request.result.forEach((key) => store.delete(key));
    return request;
  });
  const formatAttachmentSize = (size) => size === 0
    ? "0 B"
    : size < 1024 * 1024
      ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  const revokeAttachmentObjectUrls = () => {
    attachmentObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    attachmentObjectUrls = [];
  };
  const renderNoteAttachments = async (noteId) => {
    const renderSequence = ++attachmentRenderSequence;
    revokeAttachmentObjectUrls();
    attachmentList.replaceChildren();
    attachmentEmptyState.hidden = false;
    try {
      const attachments = await getNoteAttachments(noteId);
      if (renderSequence !== attachmentRenderSequence || currentNote()?.id !== noteId) return;
      attachmentEmptyState.hidden = attachments.length > 0;
      attachments.sort((first, second) => first.createdAt - second.createdAt).forEach((attachment) => {
        const row = document.createElement("article");
        row.className = "note-attachment-row";
        const url = URL.createObjectURL(attachment.blob);
        attachmentObjectUrls.push(url);
        if (attachment.type.startsWith("image/") && attachment.type !== "image/svg+xml") {
          const preview = document.createElement("img");
          preview.className = "attachment-preview";
          preview.src = url;
          preview.alt = `Vista previa de ${attachment.name}`;
          row.append(preview);
        } else {
          const icon = document.createElement("span");
          icon.className = "attachment-file-icon";
          icon.textContent = (attachment.name.split(".").pop() || "FILE").slice(0, 4).toUpperCase();
          row.append(icon);
        }
        const details = document.createElement("div");
        details.className = "attachment-details";
        const name = document.createElement("strong");
        name.textContent = attachment.name;
        const metadata = document.createElement("small");
        metadata.textContent = formatAttachmentSize(attachment.size);
        details.append(name, metadata);
        const download = document.createElement("a");
        download.className = "attachment-download";
        download.href = url;
        download.download = attachment.name;
        download.textContent = "Descargar";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "attachment-remove";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `Eliminar archivo ${attachment.name}`);
        remove.addEventListener("click", async () => {
          try {
            await deleteNoteAttachment(attachment.id);
            if (currentNote()?.id === noteId) await renderNoteAttachments(noteId);
            showMessage("Archivo eliminado de la nota.");
          } catch (error) {
            console.error("No se pudo eliminar el archivo adjunto:", error);
            showMessage("No se pudo eliminar el archivo adjunto.");
          }
        });
        row.append(details, download, remove);
        attachmentList.append(row);
      });
    } catch (error) {
      console.error("No se pudieron cargar los archivos de la nota:", error);
      if (renderSequence === attachmentRenderSequence) {
        attachmentEmptyState.textContent = "No se pudieron cargar los archivos en este navegador.";
        showMessage("No se pudieron cargar los archivos adjuntos.");
      }
    }
  };

  const formatDate = (timestamp) => new Intl.DateTimeFormat("es", {
    day: "numeric", month: "short", year: "numeric"
  }).format(new Date(timestamp));
  const formatUpdated = (timestamp) => new Intl.DateTimeFormat("es", {
    day: "numeric", month: "short"
  }).format(new Date(timestamp));
  const notePreview = (note) => (note.content || note.linkedTo || "Sin contenido").replace(/\s+/g, " ").trim();
  const recentLabel = (timestamp) => {
    const elapsed = Math.max(0, Date.now() - timestamp);
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return "ahora";
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.floor(hours / 24);
    return days === 1 ? "ayer" : `hace ${days} días`;
  };
  const detectLanguage = (source) => {
    const code = String(source || "").trim();
    if (!code) return "text";
    if (/<!doctype\s+html|<html\b|<\/?[a-z][\w:-]*(?:\s[^<>]*)?>/i.test(code)) return "html";
    if (/^[\[{]/.test(code)) {
      try {
        const value = JSON.parse(code);
        if (value && typeof value === "object") return "json";
      } catch {
        // Continue checking other languages when the snippet is not valid JSON.
      }
    }

    const pythonPatterns = [
      /^\s*(?:from\s+\S+\s+import|import\s+\S+)/m,
      /^\s*(?:async\s+)?def\s+\w+\s*\(/m,
      /^\s*(?:class\s+\w+|if\b.*:|elif\b.*:|else\s*:|for\b.*:|while\b.*:|try\s*:|except\b.*:|with\b.*:)\s*$/m,
      /\b(?:True|False|None)\b/,
      /\b(?:print|input|range)\s*\(/
    ].filter((pattern) => pattern.test(code)).length;
    const javascriptPatterns = [
      /\b(?:const|let|var)\s+[$\w]+/,
      /\bfunction\s*[$\w]*\s*\(/,
      /=>|\b(?:console\.(?:log|warn|error)|alert|fetch|document\.)/,
      /^\s*(?:export|import)\s+/m
    ].filter((pattern) => pattern.test(code)).length;

    if (pythonPatterns >= 1 && javascriptPatterns === 0) return "python";
    if (javascriptPatterns >= 1 && pythonPatterns === 0) return "javascript";
    if (pythonPatterns >= 2 && pythonPatterns > javascriptPatterns) return "python";
    if (javascriptPatterns >= 2 && javascriptPatterns > pythonPatterns) return "javascript";
    if (/\{[^{}]*\b[a-z-]+\s*:\s*[^{};]+;/i.test(code)) return "css";
    return "text";
  };
  const noteLanguage = (note) => note.language === "auto"
    ? detectLanguage(note.content)
    : note.language;
  const noteLanguageName = (note) => languageNames[noteLanguage(note)] || "Texto";
  const findMatchingNotes = (query) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return notes
      .filter((note) => !normalizedQuery || `${note.title} ${note.content} ${note.linkedTo} ${noteLanguageName(note)}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  };
  const matchingNotes = () => {
    const results = findMatchingNotes(searchInput.value);
    return newestFirst ? results : results.reverse();
  };
  const renderGlobalSearchResults = () => {
    const query = globalNoteSearch.value.trim();
    globalSearchResults.replaceChildren();
    if (!query) {
      globalSearchResults.hidden = true;
      return;
    }

    globalSearchResults.hidden = false;
    const results = findMatchingNotes(query);
    if (!results.length) {
      const empty = document.createElement("p");
      empty.className = "global-search-empty";
      empty.textContent = notes.length
        ? `No encontré notas para “${query}”.`
        : "Todavía no hay notas guardadas.";
      globalSearchResults.append(empty);
      return;
    }

    results.slice(0, 8).forEach((note) => {
      const result = document.createElement("button");
      result.type = "button";
      result.className = "global-search-result";
      result.setAttribute("role", "option");

      const title = document.createElement("strong");
      title.textContent = note.title || "Nota sin título";
      const preview = document.createElement("span");
      preview.textContent = notePreview(note);
      const tag = document.createElement("span");
      tag.className = "note-language-chip";
      tag.textContent = noteLanguageName(note);
      result.append(title, tag, preview);
      result.addEventListener("click", () => openNoteInWorkspace(note));
      globalSearchResults.append(result);
    });
  };

  const renderDashboardRecentNotes = () => {
    const container = document.getElementById("dashboardRecentNotes");
    const recent = [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
    document.getElementById("dashboardNotesCount").textContent = notes.length;
    container.replaceChildren();
    if (!recent.length) {
      const empty = document.createElement("p");
      empty.className = "recent-notes-empty";
      empty.textContent = "Las notas recientes que crees aparecerán aquí.";
      container.append(empty);
      return;
    }
    recent.forEach((note, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quick-note";
      const mark = document.createElement("span");
      const isCode = ["python", "javascript", "html", "css", "json"].includes(noteLanguage(note));
      mark.className = `quick-note-mark${isCode ? " code-mark" : index === 1 ? " lilac-mark" : ""}`;
      mark.textContent = isCode ? "</>" : index === 1 ? "▤" : "✳";
      const details = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = note.title || "Nota sin título";
      const preview = document.createElement("p");
      preview.textContent = notePreview(note);
      const updated = document.createElement("small");
      updated.textContent = recentLabel(note.updatedAt);
      details.append(title, preview, updated);
      button.append(mark, details);
      button.addEventListener("click", () => {
        flushSave();
        selectedId = note.id;
        searchInput.value = "";
        renderList();
        renderEditor();
        setView("notes");

        // Animación al seleccionar nota
        const notesView = document.getElementById("notesWorkspaceView");
        notesView.style.animation = "none";
        notesView.offsetHeight; // Trigger reflow
        notesView.style.animation = "fadeIn 0.5s ease-out";
      });
      container.append(button);
    });
  };

  const currentNote = () => notes.find((note) => note.id === selectedId) || null;
  const getEditorContent = () => codeEditor ? codeEditor.getValue() : contentInput.value;
  const setEditorContent = (content) => {
    if (!codeEditor) {
      contentInput.value = content;
      return;
    }
    syncingCodeEditor = true;
    codeEditor.setValue(content);
    codeEditor.clearHistory();
    contentInput.value = content;
    syncingCodeEditor = false;
  };
  const updateCodeLanguageUI = () => {
    const note = currentNote();
    if (!note) return;
    const language = note.language === "auto" ? detectLanguage(getEditorContent()) : note.language;
    const mode = codeMirrorModes[language] || "text/plain";
    languageTag.textContent = languageNames[language] || "Texto";
    const detectionLabel = note.language === "auto" ? "Detectado" : "Lenguaje seleccionado";
    document.getElementById("codeEditorHint").textContent =
      `${detectionLabel}: ${languageNames[language] || "Texto"}. Puedes cambiarlo manualmente.`;
    if (codeEditor && window.CodeMirror) {
      const modeAvailable = mode === "text/plain" ||
        window.CodeMirror.modes[mode] ||
        window.CodeMirror.mimeModes[mode];
      codeEditor.setOption("mode", modeAvailable ? mode : "text/plain");
    }
  };

  if (window.CodeMirror) {
    codeEditor = window.CodeMirror.fromTextArea(contentInput, {
      lineNumbers: true,
      lineWrapping: false,
      tabSize: 4,
      indentUnit: 4,
      mode: "text/plain"
    });
    codeEditor.on("change", () => {
      if (syncingCodeEditor) return;
      contentInput.value = codeEditor.getValue();
      updateCodeLanguageUI();
      queueSave();
    });
  }

  const renderEditor = () => {
    const note = currentNote();
    emptyState.hidden = Boolean(note);
    editor.hidden = !note;
    if (!note) {
      attachmentRenderSequence += 1;
      revokeAttachmentObjectUrls();
      attachmentList.replaceChildren();
      attachmentEmptyState.hidden = false;
      return;
    }
    titleInput.value = note.title;
    setEditorContent(note.content);
    linkInput.value = note.linkedTo;
    languageInput.value = supportedLanguages.includes(note.language) ? note.language : "auto";
    document.getElementById("workspaceNoteDate").textContent = `Creada el ${formatDate(note.createdAt)}`;
    document.getElementById("workspaceNoteCharacters").textContent = `${note.content.length} caracteres`;
    editorSaveState.textContent = "Guardado";
    renderNoteAttachments(note.id);
    updateCodeLanguageUI();

    // Mostrar indicadores de conexión
    const connectionIndicators = document.getElementById("connectionIndicators");
    connectionIndicators.replaceChildren();

    if (note.linkedTo) {
      const linkedProject = projects.find(p => p.name.toLowerCase().includes(note.linkedTo.toLowerCase()) || p.id === note.linkedTo);
      if (linkedProject) {
        const badge = document.createElement("span");
        badge.className = "connection-badge project-connected";
        badge.textContent = `◷ ${linkedProject.name}`;
        badge.setAttribute("data-tooltip", "Vinculado a proyecto");
        badge.classList.add("tooltip");
        connectionIndicators.appendChild(badge);
      }
    }

    const noteInProject = projects.find(p => p.noteId === note.id);
    if (noteInProject) {
      const badge = document.createElement("span");
      badge.className = "connection-badge note-connected";
      badge.textContent = `▦ ${noteInProject.name}`;
      badge.setAttribute("data-tooltip", "Nota del proyecto");
      badge.classList.add("tooltip");
      connectionIndicators.appendChild(badge);
    }
  };

  const renderList = () => {
    renderGlobalSearchResults();
    document.getElementById("workspaceNoteCount").textContent = notes.length;
    renderDashboardRecentNotes();
    const results = matchingNotes();
    listElement.replaceChildren();
    if (!results.length) {
      const empty = document.createElement("div");
      empty.className = "workspace-list-empty";
      empty.textContent = notes.length
        ? "No encontré notas con ese título o contenido."
        : "Todavía no hay notas. Crea una para empezar tu biblioteca.";
      listElement.append(empty);
      return;
    }

    results.forEach((note) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `workspace-note-row${note.id === selectedId ? " selected" : ""}`;

      // Agregar clases según conexiones
      const linkedProject = projects.find(p => p.noteId === note.id);
      if (linkedProject) {
        button.classList.add("note-with-project");
      }
      if (note.linkedTo) {
        button.classList.add("note-with-calendar");
      }

      const heading = document.createElement("strong");
      heading.textContent = note.title || "Nota sin título";
      const preview = document.createElement("p");
      preview.textContent = notePreview(note);
      const footer = document.createElement("footer");
      const updated = document.createElement("span");
      updated.textContent = formatUpdated(note.updatedAt);
      footer.append(updated);
      const language = document.createElement("span");
      language.className = "note-language-chip";
      language.textContent = noteLanguageName(note);
      footer.append(language);
      if (note.linkedTo) {
        const linked = document.createElement("span");
        linked.className = "linked-note-label";
        linked.textContent = note.linkedTo;
        footer.append(linked);
      }
      if (linkedProject) {
        const projectBadge = document.createElement("span");
        projectBadge.className = "connection-badge note-connected";
        projectBadge.textContent = `▦ ${linkedProject.name}`;
        footer.append(projectBadge);
      }
      button.append(heading, preview, footer);
      button.addEventListener("click", () => {
        flushSave();
        selectedId = note.id;
        renderList();
        renderEditor();
      });
      listElement.append(button);
    });
  };

  const flushSave = () => {
    window.clearTimeout(saveTimeout);
    const note = currentNote();
    if (!note) return;

    note.title = titleInput.value.trim() || "Nota sin título";
    note.content = getEditorContent();
    note.linkedTo = linkInput.value.trim();
    note.language = supportedLanguages.includes(languageInput.value) ? languageInput.value : "auto";
    note.updatedAt = Date.now();

    if (!validateNote(note)) {
      notes = JSON.parse(savedNotesSnapshot);
      noteDirty = false;
      renderList();
      renderEditor();
      showMessage("No se guardaron los cambios: los datos de la nota no son válidos o superan el límite permitido.");
      return;
    }

    const saved = saveNotes();
    renderList();
    document.getElementById("workspaceNoteCharacters").textContent = `${note.content.length} caracteres`;
    if (saved && noteDirty) {
      noteDirty = false;
      recordProgress();
    }
  };

  const queueSave = () => {
    const note = currentNote();
    if (!note) return;

    note.title = titleInput.value.trim() || "Nota sin título";
    note.content = getEditorContent();
    note.linkedTo = linkInput.value.trim();
    note.language = supportedLanguages.includes(languageInput.value) ? languageInput.value : "auto";
    note.updatedAt = Date.now();

    if (!validateNote(note)) {
      editorSaveState.textContent = "Nota demasiado larga";
      saveStatus.textContent = "No se pudo guardar";
      return;
    }

    noteDirty = true;
    editorSaveState.textContent = "Guardando...";
    saveStatus.textContent = "Guardando cambios...";
    document.getElementById("workspaceNoteCharacters").textContent = `${note.content.length} caracteres`;
    updateCodeLanguageUI();
    renderList();
    saveTimeout = window.setTimeout(() => {
      if (saveNotes()) {
        editorSaveState.textContent = "Guardado";
        if (noteDirty) {
          noteDirty = false;
          recordProgress();
        }
      }
    }, 350);
  };

  const validateNote = (note) => {
    if (!note || typeof note !== "object" || Array.isArray(note)) return false;
    if (typeof note.id !== "string" || !note.id || note.id.length > 100) return false;
    if (!note.title || typeof note.title !== "string" || note.title.length > 200) return false;
    if (typeof note.content !== "string" || note.content.length > 50000) return false;
    if (typeof note.linkedTo !== "string" || note.linkedTo.length > 100) return false;
    if (!supportedLanguages.includes(note.language)) return false;
    if (!Number.isSafeInteger(note.createdAt) || note.createdAt < 0 ||
      !Number.isSafeInteger(note.updatedAt) || note.updatedAt < 0) return false;
    return true;
  };

  const createNote = () => {
    flushSave();
    const now = Date.now();
    const note = {
      id: makeId(),
      title: "Nota sin título",
      content: "",
      linkedTo: "",
      language: "auto",
      createdAt: now,
      updatedAt: now
    };

    // Validar antes de guardar
    if (!validateNote(note)) {
      showMessage("Error: Datos inválidos");
      return;
    }

    notes.unshift(note);
    selectedId = note.id;
    searchInput.value = "";
    const saved = saveNotes();
    renderList();
    renderEditor();
    if (!saved) return;
    if (saved) recordProgress();
    showMessage("Nota creada. Añade un título y empieza a escribir.");
    titleInput.focus();
    titleInput.select();

    editor.style.animation = "none";
    editor.offsetHeight;
    editor.style.animation = "scaleIn 0.3s ease-out";
  };

  const deleteCurrentNote = async () => {
    const note = currentNote();
    if (!note) return;
    if (!window.confirm(`¿Quieres eliminar “${note.title}”?`)) return;
    window.clearTimeout(saveTimeout);
    notes = notes.filter((item) => item.id !== note.id);
    selectedId = matchingNotes()[0]?.id || null;
    if (!saveNotes()) return;
    renderList();
    renderEditor();
    if (attachmentDBPromise) {
      try {
        await deleteAttachmentsForNote(note.id);
      } catch (error) {
        console.error("No se pudieron eliminar los archivos adjuntos de la nota:", error);
        showMessage("La nota se eliminó, pero algunos archivos adjuntos quedaron almacenados en este dispositivo.");
        return;
      }
    }
    showMessage("Nota eliminada.");
  };

  const addAttachmentsToCurrentNote = async (files) => {
    const note = currentNote();
    if (!note || !files.length) return;
    let savedCount = 0;
    const failedNames = [];
    for (const file of files) {
      if (!allowedAttachmentName.test(file.name)) {
        failedNames.push(`${file.name} (tipo no admitido)`);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_SIZE) {
        failedNames.push(`${file.name} (supera 20 MB)`);
        continue;
      }
      try {
        await saveNoteAttachment(note.id, file);
        savedCount += 1;
      } catch (error) {
        console.error(`No se pudo guardar el archivo ${file.name}:`, error);
        failedNames.push(`${file.name} (error de almacenamiento)`);
      }
    }
    if (savedCount) {
      note.updatedAt = Date.now();
      const noteSaved = saveNotes();
      renderList();
      await renderNoteAttachments(note.id);
      if (!noteSaved) {
        showMessage(`${savedCount} archivo(s) guardado(s), pero no se pudo actualizar la nota.`);
        return;
      }
      recordProgress();
    }
    if (failedNames.length) {
      const summary = failedNames.length > 2
        ? `${failedNames.slice(0, 2).join(", ")} y ${failedNames.length - 2} más`
        : failedNames.join(", ");
      showMessage(savedCount
        ? `${savedCount} archivo(s) guardado(s). No se añadieron: ${summary}.`
        : `No se añadieron los archivos: ${summary}.`);
    } else if (savedCount) {
      showMessage(savedCount === 1 ? "Archivo guardado en la nota." : `${savedCount} archivos guardados en la nota.`);
    }
  };

  const projectTypes = { project: "Proyecto", task: "Tarea", exam: "Examen" };
  const importanceLabels = {
    important: "Importante",
    normal: "No tan importante",
    low: "Aún no importante",
    upcoming: "Próximo"
  };
  const projectDialog = document.getElementById("projectDialog");
  const projectDeadlineInput = document.getElementById("newProjectDeadline");
  const projectListElement = document.getElementById("projectList");
  const projectDetailContent = document.getElementById("projectDetailContent");
  const projectEmptyState = document.getElementById("projectEmptyState");
  const projectTaskForm = document.getElementById("projectTaskForm");
  const projectTaskTitle = document.getElementById("projectTaskTitle");
  const projectTaskHours = document.getElementById("projectTaskHours");

  const selectedProject = () => projects.find((project) => project.id === selectedProjectId) || null;
  const formatWorkTime = (seconds) => {
    const safeSeconds = Math.max(0, seconds);
    const totalMinutes = safeSeconds > 0 ? Math.max(1, Math.floor(safeSeconds / 60)) : 0;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours} h ${String(minutes).padStart(2, "0")} min` : `${minutes} min`;
  };
  const projectProgress = (project) => {
    if (!project.tasks.length) return 0;
    return Math.round(project.tasks.filter((task) => task.done).length / project.tasks.length * 100);
  };
  const projectTimeRemaining = (project) => {
    if (!project.deadline) return "Sin fecha";
    const deadline = new Date(`${project.deadline}T23:59:59`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayDiff = Math.ceil((deadline.getTime() - today.getTime()) / 86400000);
    if (dayDiff < 0) return `${Math.abs(dayDiff)} días vencido`;
    if (dayDiff === 0) return "Entrega hoy";
    return dayDiff === 1 ? "1 día" : `${dayDiff} días`;
  };
  const projectEstimatedHours = (project) => project.tasks
    .filter((task) => !task.done)
    .reduce((sum, task) => sum + Number(task.hours || 0), 0);
  const projectWorkedSeconds = (project) => {
    const activeSeconds = activeWorkSession?.projectId === project.id
      ? Math.floor(Math.max(0, Date.now() - activeWorkSession.startedAt) / 1000)
      : 0;
    return Number(project.workedSeconds || 0) + activeSeconds;
  };
  const remainingDays = (project) => {
    if (!project.deadline) return null;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const due = new Date(`${project.deadline}T12:00:00`);
    return Math.max(1, Math.ceil((due.getTime() - now.getTime()) / 86400000));
  };
  const recommendationFor = (project) => {
    const pending = project.tasks.filter((task) => !task.done);
    if (!pending.length) return "Completaste todos los pasos. ¡Buen trabajo! Puedes cerrar el plan o añadir nuevas tareas.";
    const effort = projectEstimatedHours(project);
    const cap = Number(project.dailyLimit || 2);
    const days = remainingDays(project);
    if (days !== null && project.deadline && projectTimeRemaining(project).includes("vencido")) {
      return `La fecha de entrega ya pasó. Reorganiza las ${effort.toFixed(1)} h de trabajo pendiente según tu disponibilidad.`;
    }
    if (days === null) {
      return `Prueba con hasta ${cap} h al día. Divide el trabajo en sesiones de 25–50 min y toma pausas.`;
    }
    const neededPerDay = effort / days; 
    if (neededPerDay > cap) {
      return `Quedan ${days} días y cerca de ${effort.toFixed(1)} h de trabajo. Tu límite es ${cap} h/día; considera ampliar la fecha para evitar sobrecargarte.`;
    }
    const suggested = Math.max(0.5, Math.ceil(neededPerDay * 2) / 2);
    return `Quedan ${days} días. Reserva cerca de ${Math.min(cap, suggested)} h al día, con pausas, para completar ${effort.toFixed(1)} h de trabajo.`;
  };
  const persistProjects = () => {
    try {
      window.blockgramValidateAccountData({
        notes,
        projects,
        selectedProjectId,
        activeWorkSession,
        dailyProgress: streakState
      });
      const serialized = JSON.stringify({
        projects,
        selectedProjectId,
        activeWorkSession
      });
      localStorage.setItem(PROJECTS_KEY, serialized);
      savedProjectsSnapshot = serialized;
      queueAccountSync();
      return true;
    } catch (error) {
      const previous = JSON.parse(savedProjectsSnapshot);
      projects = previous.projects;
      selectedProjectId = previous.selectedProjectId;
      activeWorkSession = previous.activeWorkSession;
      renderProjects();
      console.error("No se pudieron guardar los proyectos:", error);
      showMessage(`No se pudo guardar el proyecto: ${error.message || "revisa el almacenamiento del navegador."}`);
      return false;
    }
  };
  const createPlannedTasks = (type, name, estimatedHours) => {
    let steps;
    if (type === "exam") {
      steps = ["Repasar los temas principales", "Practicar ejercicios", "Hacer un simulacro", "Repaso final y descanso"];
    } else if (type === "task") {
      steps = [`Completar: ${name}`, "Revisar el resultado"];
    } else {
      steps = ["Definir objetivo y dividir el trabajo", "Reunir materiales y referencias", "Desarrollar una primera versión", "Revisar y preparar la entrega"];
    }
    const unitHours = Math.max(0.25, Math.round((estimatedHours / steps.length) * 4) / 4);
    return steps.map((title) => ({ id: makeId(), title, hours: unitHours, done: false }));
  };
  const renderProjectNoteOptions = () => {
    const select = document.getElementById("newProjectNote");
    const currentValue = select.value;
    select.replaceChildren(new Option("Sin nota vinculada", ""));
    [...notes].sort((a, b) => b.updatedAt - a.updatedAt).forEach((note) => {
      select.add(new Option(note.title || "Nota sin título", note.id));
    });
    if (notes.some((note) => note.id === currentValue)) select.value = currentValue;
  };
  const openProjectDialog = () => {
    renderProjectNoteOptions();
    projectDeadlineInput.min = dateKey(new Date());
    projectDeadlineInput.setCustomValidity("");
    projectDialog.showModal();
    document.getElementById("newProjectName").focus();
  };
  projectDeadlineInput.addEventListener("input", () => projectDeadlineInput.setCustomValidity(""));

  const renderProjectList = () => {
    document.getElementById("projectCount").textContent = projects.length;
    projectListElement.replaceChildren();
    if (!projects.length) {
      const empty = document.createElement("p");
      empty.className = "project-list-empty";
      empty.textContent = "Todavía no tienes planes. Crea uno para organizar tus tareas.";
      projectListElement.append(empty);
      return;
    }
    [...projects].sort((a, b) => b.updatedAt - a.updatedAt).forEach((project) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `project-list-item${project.id === selectedProjectId ? " selected" : ""}`;
      button.dataset.type = project.type;

      // Agregar indicador de nota vinculada
      if (project.noteId) {
        button.classList.add("has-linked-note");
      }

      const icon = document.createElement("span");
      icon.className = "project-list-icon";
      icon.textContent = project.type === "exam" ? "✎" : project.type === "task" ? "☑" : "▦";
      const nameAndType = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = project.name;
      const subtitle = document.createElement("small");
      subtitle.textContent = `${projectTypes[project.type] || "Proyecto"} · ${project.tasks.filter((task) => task.done).length}/${project.tasks.length} pasos`;

      // Mostrar nota vinculada si existe
      if (project.noteId) {
        const linkedNote = notes.find(n => n.id === project.noteId);
        if (linkedNote) {
          const noteBadge = document.createElement("span");
          noteBadge.className = "connection-badge note-connected";
          noteBadge.textContent = `▤ ${linkedNote.title}`;
          subtitle.append(document.createElement("br"), noteBadge);
        }
      }

      nameAndType.append(name, subtitle);
      const progress = document.createElement("span");
      progress.className = "project-list-progress";
      progress.textContent = `${projectProgress(project)}%`;
      button.append(icon, nameAndType, progress);
      button.addEventListener("click", () => {
        selectedProjectId = project.id;
        persistProjects();
        renderProjects();
      });
      projectListElement.append(button);
    });
  };

  const renderProjectDashboard = () => {
    const project = selectedProject();
    const goalList = document.getElementById("dashboardGoalsList");
    const progressBar = document.getElementById("dashboardProjectProgressBar");
    const goalsProgress = document.getElementById("dashboardGoalsProgress");
    goalList.replaceChildren();
    if (!project) {
      document.getElementById("dashboardProjectIcon").textContent = "✳";
      document.getElementById("dashboardProjectName").textContent = "Aún no hay proyectos";
      document.getElementById("dashboardProjectType").textContent = "Crea un proyecto, tarea o examen para empezar";
      document.getElementById("dashboardProjectPriority").textContent = "—";
      document.getElementById("dashboardProjectPriority").className = "priority-badge";
      document.getElementById("dashboardTaskCount").textContent = "0 de 0 completadas";
      document.getElementById("dashboardTimeRemaining").textContent = "—";
      document.getElementById("dashboardHoursSpent").textContent = "0 min";
      document.getElementById("dashboardProjectProgress").textContent = "0%";
      progressBar.style.width = "0%";
      document.getElementById("dashboardStudyPlan").textContent = "Crea un plan para ver el tiempo recomendado.";
      document.getElementById("dashboardGoalsLabel").textContent = "Tu plan de estudio";
      document.getElementById("dashboardGoalsCount").textContent = "0 de 0 completadas";
      goalsProgress.style.width = "0%";
      const empty = document.createElement("li");
      empty.className = "goal-empty";
      empty.textContent = "Tus tareas del proyecto aparecerán aquí.";
      goalList.append(empty);
      return;
    }
    const completed = project.tasks.filter((task) => task.done).length;
    const progress = projectProgress(project);
    const importance = document.getElementById("dashboardProjectPriority");
    const linkedNote = notes.find((note) => note.id === project.noteId);
    document.getElementById("dashboardProjectIcon").textContent = project.type === "exam" ? "✎" : project.type === "task" ? "☑" : "▦";
    document.getElementById("dashboardProjectName").textContent = project.name;
    document.getElementById("dashboardProjectType").textContent = `${projectTypes[project.type] || "Proyecto"}${linkedNote ? ` · Nota: ${linkedNote.title}` : project.description ? ` · ${project.description}` : ""}`;
    importance.textContent = importanceLabels[project.importance] || "Próximo";
    importance.className = `priority-badge ${project.importance === "important" ? "high" : project.importance === "upcoming" ? "low" : ""}`;
    document.getElementById("dashboardTaskCount").textContent = `${completed} de ${project.tasks.length} completadas`;
    document.getElementById("dashboardTimeRemaining").textContent = projectTimeRemaining(project);
    document.getElementById("dashboardHoursSpent").textContent = formatWorkTime(projectWorkedSeconds(project));
    document.getElementById("dashboardProjectProgress").textContent = `${progress}%`;
    progressBar.style.width = `${progress}%`;
    document.getElementById("dashboardStudyPlan").textContent = `Límite recomendado: ${project.dailyLimit} h al día`;
    document.getElementById("dashboardGoalsLabel").textContent = project.name;
    document.getElementById("dashboardGoalsCount").textContent = `${completed} de ${project.tasks.length} completadas`;
    goalsProgress.style.width = `${progress}%`;
    project.tasks.slice(0, 4).forEach((task) => {
      const item = document.createElement("li");
      item.className = task.done ? "goal-done" : "";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "dashboard-goal-check";
      checkbox.checked = task.done;
      checkbox.setAttribute("aria-label", `Marcar ${task.title} como completada`);
      checkbox.addEventListener("change", () => toggleProjectTask(project.id, task.id, checkbox.checked));
      const label = document.createElement("span");
      label.textContent = task.title;
      const status = document.createElement("small");
      status.textContent = task.done ? "Lista" : `${task.hours} h`;
      item.append(checkbox, label, status);
      goalList.append(item);
    });
  };

  const renderProjectDetail = () => {
    const project = selectedProject();
    projectEmptyState.hidden = Boolean(project);
    projectDetailContent.hidden = !project;
    if (!project) return;
    const completed = project.tasks.filter((task) => task.done).length;
    const progress = projectProgress(project);
    const importance = document.getElementById("projectDetailImportance");
    document.getElementById("projectDetailType").textContent = (projectTypes[project.type] || "Proyecto").toLocaleUpperCase();
    document.getElementById("projectDetailName").textContent = project.name;
    document.getElementById("projectDetailDescription").textContent = project.description || "Tu plan de trabajo con pasos claros y alcanzables.";
    importance.textContent = importanceLabels[project.importance] || "Próximo";
    importance.dataset.level = project.importance;
    document.getElementById("projectDetailDeadline").textContent = project.deadline
      ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${project.deadline}T12:00:00`))
      : "Sin fecha";
    document.getElementById("projectDetailHours").textContent = formatWorkTime(projectWorkedSeconds(project));
    document.getElementById("projectDetailDailyLimit").textContent = `${project.dailyLimit} h / día`;
    document.getElementById("projectDetailRemaining").textContent = projectTimeRemaining(project);
    document.getElementById("projectDetailProgress").textContent = `${progress}%`;
    document.getElementById("projectDetailProgressBar").style.width = `${progress}%`;
    document.getElementById("projectDetailTaskCount").textContent = `${completed} de ${project.tasks.length} tareas completadas`;
    const linkedNote = notes.find((note) => note.id === project.noteId);
    const recommendation = recommendationFor(project);
    document.getElementById("projectRecommendation").textContent = linkedNote
      ? `${recommendation} Nota vinculada: “${linkedNote.title}”.`
      : recommendation;
    const active = activeWorkSession?.projectId === project.id;
    document.getElementById("workSessionButton").textContent = active ? "■ Terminar sesión" : "▶ Iniciar enfoque";
    document.getElementById("workSessionButton").classList.toggle("running", active);
    document.getElementById("workSessionLabel").textContent = active ? "Sesión en curso" : "¿Vas a trabajar en este plan?";
    document.getElementById("workSessionHint").textContent = active
      ? `Tiempo transcurrido: ${formatWorkTime(projectWorkedSeconds(project) - Number(project.workedSeconds || 0))}`
      : "Inicia y termina una sesión para registrar las horas dedicadas.";
    const tasksList = document.getElementById("projectTasksList");
    tasksList.replaceChildren();
    project.tasks.forEach((task) => {
      const row = document.createElement("div");
      row.className = `project-task-row${task.done ? " done" : ""}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(task.done);
      checkbox.setAttribute("aria-label", `Marcar ${task.title} como completada`);
      checkbox.addEventListener("change", () => toggleProjectTask(project.id, task.id, checkbox.checked));
      const title = document.createElement("span");
      title.textContent = task.title;
      const estimate = document.createElement("small");
      estimate.textContent = `${task.hours} h`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Eliminar paso";
      remove.setAttribute("aria-label", `Eliminar ${task.title}`);
      remove.addEventListener("click", () => {
        const current = projects.find((item) => item.id === project.id);
        if (!current) return;
        current.tasks = current.tasks.filter((item) => item.id !== task.id);
        current.updatedAt = Date.now();
        persistProjects();
        renderProjects();
      });
      row.append(checkbox, title, estimate, remove);
      tasksList.append(row);
    });
  };

  const renderProjects = () => {
    if (selectedProjectId && !projects.some((project) => project.id === selectedProjectId)) selectedProjectId = null;
    renderProjectList();
    renderProjectDetail();
    renderProjectDashboard();
    renderMonthlyCalendar();
  };

  document.getElementById("previousMonth").addEventListener("click", () => {
    displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() - 1, 1);
    renderMonthlyCalendar();
  });
  document.getElementById("nextMonth").addEventListener("click", () => {
    displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + 1, 1);
    renderMonthlyCalendar();
  });
  document.getElementById("currentMonthButton").addEventListener("click", () => {
    const now = new Date();
    displayedMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    selectedCalendarDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    renderMonthlyCalendar();
  });

  const toggleProjectTask = (projectId, taskId, done) => {
    const project = projects.find((item) => item.id === projectId);
    const task = project?.tasks.find((item) => item.id === taskId);
    if (!project || !task) return;
    task.done = done;
    project.updatedAt = Date.now();
    const saved = persistProjects();
    renderProjects();
    if (done && saved) recordProgress();

    // Animación de barra de progreso
    if (done) {
      const progressBar = document.getElementById("projectDetailProgressBar");
      if (progressBar) {
        progressBar.style.animation = "none";
        progressBar.offsetHeight; // Trigger reflow
        progressBar.style.animation = "shimmer 0.5s ease-out";
      }
    }
  };

  const finishWorkSession = () => {
    if (!activeWorkSession) return;
    const project = projects.find((item) => item.id === activeWorkSession.projectId);
    if (project) {
      project.workedSeconds = Number(project.workedSeconds || 0) + Math.floor(Math.max(0, Date.now() - activeWorkSession.startedAt) / 1000);
      project.updatedAt = Date.now();
    }
    activeWorkSession = null;
    const saved = persistProjects();
    renderProjects();
    if (saved) recordProgress();
  };

  const createProject = () => {
    const name = document.getElementById("newProjectName").value.trim();
    const deadline = projectDeadlineInput.value;
    const dailyLimit = Number(document.getElementById("newProjectDailyLimit").value);
    const estimate = Number(document.getElementById("newProjectEstimate").value);
    const type = document.getElementById("newProjectType").value;
    if (deadline && (!isValidDateKey(deadline) || deadline < dateKey(new Date()))) {
      projectDeadlineInput.setCustomValidity("Elige hoy o una fecha futura que exista en el calendario.");
      projectDeadlineInput.reportValidity();
      showMessage("La fecha de entrega debe ser hoy o una fecha futura válida.");
      return;
    }
    projectDeadlineInput.setCustomValidity("");
    if (!name || !Number.isFinite(dailyLimit) || dailyLimit < 0.5 || dailyLimit > 12 ||
      !Number.isFinite(estimate) || estimate < 0.5 || estimate > 500) return;
    const now = Date.now();
    const project = {
      id: makeId(),
      name,
      description: document.getElementById("newProjectDescription").value.trim(),
      type,
      importance: document.getElementById("newProjectImportance").value,
      deadline,
      dailyLimit,
      estimatedHours: estimate,
      noteId: document.getElementById("newProjectNote").value,
      tasks: createPlannedTasks(type, name, estimate),
      workedSeconds: 0,
      createdAt: now,
      updatedAt: now
    };
    projects.push(project);
    selectedProjectId = project.id;
    if (!persistProjects()) return;
    projectDialog.close();
    document.getElementById("projectForm").reset();
    document.getElementById("newProjectDailyLimit").value = "2";
    document.getElementById("newProjectEstimate").value = "6";
    renderProjects();
    showMessage("Plan creado con una lista inicial de tareas.");
  };

  const openProjectWorkspace = (createNew = false) => {
    if (!selectedProjectId && projects.length) selectedProjectId = projects[0].id;
    renderProjects();
    setView("projects");
    if (createNew) openProjectDialog();

    // Animación del área de proyectos
    const projectDetail = document.getElementById("projectDetailContent");
    if (projectDetail && !projectDetail.hidden) {
      projectDetail.style.animation = "none";
      projectDetail.offsetHeight; // Trigger reflow
      projectDetail.style.animation = "fadeInUp 0.4s ease-out";
    }
  };

  document.getElementById("createProjectButton").addEventListener("click", openProjectDialog);
  document.getElementById("createProjectFromList").addEventListener("click", openProjectDialog);
  document.getElementById("emptyCreateProject").addEventListener("click", openProjectDialog);
  document.getElementById("createProjectFromGoals").addEventListener("click", () => openProjectWorkspace(true));
  document.getElementById("openProjectsFromData").addEventListener("click", () => openProjectWorkspace());
  document.getElementById("openProjectDetails").addEventListener("click", () => openProjectWorkspace());
  document.querySelectorAll("[data-close-project]").forEach((button) => {
    button.addEventListener("click", () => projectDialog.close());
  });
  document.getElementById("projectForm").addEventListener("submit", (event) => {
    event.preventDefault();
    createProject();
  });
  document.getElementById("deleteProjectButton").addEventListener("click", () => {
    const project = selectedProject();
    if (!project || !window.confirm(`¿Eliminar el plan “${project.name}” y sus tareas?`)) return;
    if (activeWorkSession?.projectId === project.id) activeWorkSession = null;
    projects = projects.filter((item) => item.id !== project.id);
    selectedProjectId = projects[0]?.id || null;
    const saved = persistProjects();
    renderProjects();
    if (saved) showMessage("Plan eliminado.");
  });
  document.getElementById("addProjectTask").addEventListener("click", () => {
    projectTaskForm.hidden = false;
    projectTaskTitle.focus();
  });
  document.getElementById("cancelProjectTask").addEventListener("click", () => {
    projectTaskForm.reset();
    projectTaskForm.hidden = true;
  });
  projectTaskForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const project = selectedProject();
    const title = projectTaskTitle.value.trim();
    const hours = Number(projectTaskHours.value);
    if (!project || !title || !Number.isFinite(hours) || hours <= 0 || hours > 24) return;
    project.tasks.push({ id: makeId(), title, hours, done: false });
    project.updatedAt = Date.now();
    persistProjects();
    projectTaskForm.reset();
    projectTaskForm.hidden = true;
    renderProjects();
  });
  document.getElementById("workSessionButton").addEventListener("click", () => {
    const project = selectedProject();
    if (!project) return;
    if (activeWorkSession?.projectId === project.id) {
      finishWorkSession();
      showMessage("Sesión registrada en el proyecto.");
      return;
    }
    const finishedPreviousSession = Boolean(activeWorkSession);
    if (activeWorkSession) {
      const previous = projects.find((item) => item.id === activeWorkSession.projectId);
      if (previous) {
        previous.workedSeconds = Number(previous.workedSeconds || 0) + Math.floor(Math.max(0, Date.now() - activeWorkSession.startedAt) / 1000);
        previous.updatedAt = Date.now();
      }
    }
    activeWorkSession = { projectId: project.id, startedAt: Date.now() };
    const saved = persistProjects();
    renderProjects();
    if (saved && finishedPreviousSession) recordProgress();
  });
  window.setInterval(() => {
    if (!activeWorkSession) return;
    renderProjectDashboard();
    renderProjectDetail();
  }, 1000);
  renderProjects();

  const setView = (view, target) => {
    const showNotes = view === "notes";
    if (!showNotes) flushSave();
    const activeHref = showNotes ? "#notas" : view === "projects" ? "#projectWorkspace" : `#${target || "inicio"}`;
    document.querySelectorAll(".side-nav .nav-link").forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === activeHref);
    });
    const destination = showNotes
      ? notesView
      : view === "projects"
        ? projectWorkspace
        : target ? document.getElementById(target) : null;

    // Animación de transición de vista
    if (destination) {
      destination.style.opacity = "0";
      destination.style.transform = "translateY(20px)";
      destination.style.transition = "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)";
    }

    window.setTimeout(() => {
      if (destination) {
        destination.scrollIntoView({ behavior: "smooth", block: "start" });
        requestAnimationFrame(() => {
          destination.style.opacity = "1";
          destination.style.transform = "translateY(0)";
        });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, 0);
  };

  const openNoteInWorkspace = (note) => {
    flushSave();
    selectedId = note.id;
    searchInput.value = "";
    globalNoteSearch.value = "";
    renderList();
    renderEditor();
    setView("notes");
  };

  globalNoteSearch.addEventListener("input", renderGlobalSearchResults);
  globalNoteSearch.addEventListener("focus", renderGlobalSearchResults);
  globalNoteSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      globalSearchResults.hidden = true;
    } else if (event.key === "Enter") {
      const firstResult = globalSearchResults.querySelector(".global-search-result");
      if (firstResult) {
        event.preventDefault();
        firstResult.click();
      }
    }
  });
  document.getElementById("clearGlobalNoteSearch").addEventListener("click", () => {
    globalNoteSearch.value = "";
    renderGlobalSearchResults();
    globalNoteSearch.focus();
  });
  document.addEventListener("click", (event) => {
    if (!globalNoteSearch.closest(".mockup-search").contains(event.target)) {
      globalSearchResults.hidden = true;
    }
  });

  document.querySelectorAll(".side-nav .nav-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const href = link.getAttribute("href").slice(1);
      const view = link.dataset.view || "dashboard";
      if (view === "notes") {
        setView("notes");
        if (!selectedId && notes.length) selectedId = matchingNotes()[0]?.id || null;
        renderList();
        renderEditor();
      } else if (view === "projects") {
        openProjectWorkspace();
      } else {
        setView("dashboard", href === "inicio" ? null : href);
      }
    });
  });

  document.getElementById("openAllNotes").addEventListener("click", () => {
    setView("notes");
    if (!selectedId && notes.length) selectedId = matchingNotes()[0]?.id || null;
    renderList();
    renderEditor();
  });
  document.getElementById("openNotesAndCreate").addEventListener("click", () => {
    globalNoteSearch.value = "";
    setView("notes");
    renderList();
    renderEditor();
    createNote();
  });
  document.getElementById("backToDashboard").addEventListener("click", () => setView("dashboard"));
  document.getElementById("createWorkspaceNote").addEventListener("click", createNote);
  document.getElementById("emptyCreateWorkspaceNote").addEventListener("click", createNote);
  document.getElementById("deleteWorkspaceNote").addEventListener("click", deleteCurrentNote);
  document.getElementById("addNoteAttachment").addEventListener("click", () => {
    if (!currentNote()) {
      showMessage("Crea o selecciona una nota antes de adjuntar archivos.");
      return;
    }
    attachmentInput.click();
  });
  attachmentInput.addEventListener("change", () => {
    const files = Array.from(attachmentInput.files || []);
    attachmentInput.value = "";
    addAttachmentsToCurrentNote(files);
  });
  document.getElementById("workspaceSortNotes").addEventListener("click", () => {
    newestFirst = !newestFirst;
    renderList();
  });
  languageInput.addEventListener("change", () => {
    const note = currentNote();
    if (!note) return;
    note.language = languageInput.value;
    updateCodeLanguageUI();
    queueSave();
  });
  searchInput.addEventListener("input", () => {
    const results = matchingNotes();
    if (results.length && !results.some((note) => note.id === selectedId)) {
      selectedId = results[0].id;
      renderEditor();
    }
    renderList();
  });
  [titleInput, linkInput].forEach((input) => input.addEventListener("input", queueSave));
  if (!codeEditor) {
    contentInput.addEventListener("input", () => {
      updateCodeLanguageUI();
      queueSave();
    });
  }
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      setView("notes");
      createNote();
    }
  });

  renderList();
  renderEditor();
})();
  });
})();
