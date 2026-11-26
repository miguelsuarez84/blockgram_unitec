(() => {
  "use strict";

  const authScreen = document.getElementById("authScreen");
  const authForm = document.getElementById("authForm");
  const authTitle = document.getElementById("authTitle");
  const authDescription = document.getElementById("authDescription");
  const authUsername = document.getElementById("authUsername");
  const authPassword = document.getElementById("authPassword");
  const authMessage = document.getElementById("authMessage");
  const authSubmit = document.getElementById("authSubmit");
  const toggleAuthMode = document.getElementById("toggleAuthMode");
  const legacyAttachmentOwnerKey = "blockgramLegacyAttachmentOwnerV1";
  const accountStorageKey = (key, username) =>
    `blockgram:${encodeURIComponent(username.toLowerCase())}:${key}`;
  const lastAccountUsernameKey = "blockgramLastAccountUsernameV1";
  let registering = false;

  const setMessage = (message) => {
    authMessage.textContent = message;
  };

  const request = async (path, options) => {
    const controller = path === "session" && typeof AbortController === "function"
      ? new AbortController()
      : null;
    const timeout = controller ? window.setTimeout(() => controller.abort(), 4000) : 0;
    try {
      const response = await fetch(`/api/${path}`, {
        credentials: "same-origin",
        ...options,
        ...(controller ? { signal: controller.signal } : {})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(result.error || "No se pudo completar la solicitud.");
        error.status = response.status;
        error.result = result;
        throw error;
      }
      return result;
    } finally {
      if (timeout) window.clearTimeout(timeout);
    }
  };
  const isApiUnavailable = (error) =>
    error.code === "API_UNAVAILABLE" ||
    error.name === "TypeError" ||
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    error.status === 404 ||
    error.status === 405 ||
    error.status === 501 ||
    (error.status >= 500 && error.status < 600);

  const accountHeaders = (username, json = false) => ({
    ...(json ? { "Content-Type": "application/json" } : {}),
    "X-Blockgram-Account": username
  });

  const isValidDateKey = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  };

  const validateAccountData = (data) => {
    if (!data || !Array.isArray(data.notes) || !Array.isArray(data.projects)) {
      throw new Error("Los datos de la cuenta no tienen un formato válido.");
    }
    const noteIds = new Set();
    for (const note of data.notes) {
      if (!note || typeof note !== "object" || Array.isArray(note) ||
        typeof note.id !== "string" || !note.id || note.id.length > 100 || noteIds.has(note.id) ||
        typeof note.title !== "string" || !note.title.trim() || note.title.length > 200 ||
        typeof note.content !== "string" || note.content.length > 50000 ||
        typeof note.linkedTo !== "string" || note.linkedTo.length > 100 ||
        !["auto", "python", "javascript", "html", "css", "json", "text"].includes(note.language) ||
        !Number.isSafeInteger(note.createdAt) || note.createdAt < 0 ||
        !Number.isSafeInteger(note.updatedAt) || note.updatedAt < 0) {
        throw new Error("La cuenta contiene una nota con datos inválidos.");
      }
      noteIds.add(note.id);
    }
    const projectIds = new Set();
    for (const project of data.projects) {
      if (!project || typeof project !== "object" || Array.isArray(project) ||
        typeof project.id !== "string" || !project.id || project.id.length > 100 || projectIds.has(project.id) ||
        typeof project.name !== "string" || !project.name.trim() || project.name.length > 100 ||
        typeof project.description !== "string" || project.description.length > 180 ||
        !["project", "task", "exam"].includes(project.type) ||
        !["important", "normal", "low", "upcoming"].includes(project.importance) ||
        typeof project.deadline !== "string" ||
        (project.deadline && !isValidDateKey(project.deadline)) ||
        typeof project.noteId !== "string" || !Array.isArray(project.tasks) ||
        project.tasks.length > 500 || !Number.isFinite(project.dailyLimit) ||
        project.dailyLimit < 0.5 || project.dailyLimit > 12 ||
        !Number.isFinite(project.estimatedHours) || project.estimatedHours < 0.5 ||
        project.estimatedHours > 500 || !Number.isFinite(project.workedSeconds) ||
        project.workedSeconds < 0 || !Number.isSafeInteger(project.createdAt) ||
        project.createdAt < 0 || !Number.isSafeInteger(project.updatedAt) || project.updatedAt < 0) {
        throw new Error("La cuenta contiene un proyecto con datos inválidos.");
      }
      const taskIds = new Set();
      for (const task of project.tasks) {
        if (!task || typeof task !== "object" || Array.isArray(task) ||
          typeof task.id !== "string" || !task.id || task.id.length > 100 || taskIds.has(task.id) ||
          typeof task.title !== "string" || !task.title.trim() || task.title.length > 120 ||
          !Number.isFinite(task.hours) || task.hours <= 0 || task.hours > 500 ||
          typeof task.done !== "boolean") {
          throw new Error("La cuenta contiene una tarea con datos inválidos.");
        }
        taskIds.add(task.id);
      }
      projectIds.add(project.id);
    }
    const progress = data.dailyProgress || { count: 0, lastProgressDate: "" };
    if (!progress || !Number.isSafeInteger(progress.count) || progress.count < 0 ||
      typeof progress.lastProgressDate !== "string" ||
      (progress.lastProgressDate && !isValidDateKey(progress.lastProgressDate))) {
      throw new Error("La cuenta contiene un registro de progreso inválido.");
    }
    if (data.selectedProjectId !== null && data.selectedProjectId !== undefined &&
      (typeof data.selectedProjectId !== "string" || !projectIds.has(data.selectedProjectId))) {
      throw new Error("La cuenta tiene un proyecto seleccionado que no existe.");
    }
    if (data.activeWorkSession !== null && data.activeWorkSession !== undefined &&
      (!data.activeWorkSession || typeof data.activeWorkSession !== "object" ||
        !projectIds.has(data.activeWorkSession.projectId) ||
        !Number.isSafeInteger(data.activeWorkSession.startedAt) || data.activeWorkSession.startedAt < 0)) {
      throw new Error("La cuenta tiene una sesión de trabajo inválida.");
    }
    return {
      notes: data.notes,
      projects: data.projects,
      selectedProjectId: data.selectedProjectId || null,
      activeWorkSession: data.activeWorkSession || null,
      dailyProgress: progress
    };
  };

  const readLocalData = (username, includeLegacy = false) => {
    const notesKey = accountStorageKey("notes", username);
    const projectsKey = accountStorageKey("projects", username);
    const progressKey = accountStorageKey("progress", username);
    const notesText = localStorage.getItem(notesKey);
    const projectsText = localStorage.getItem(projectsKey);
    const progressText = localStorage.getItem(progressKey);
    const savedProjects = projectsText ? JSON.parse(projectsText) : {};
    let data = {
      notes: notesText ? JSON.parse(notesText) : [],
      projects: savedProjects.projects || [],
      selectedProjectId: savedProjects.selectedProjectId || null,
      activeWorkSession: savedProjects.activeWorkSession || null,
      dailyProgress: progressText ? JSON.parse(progressText) : { count: 0, lastProgressDate: "" }
    };
    const legacyOwner = localStorage.getItem(legacyAttachmentOwnerKey);
    if (includeLegacy && (!legacyOwner || legacyOwner.toLowerCase() === username.toLowerCase()) &&
      !notesText && !projectsText && !progressText) {
      let legacyNotes = JSON.parse(localStorage.getItem("blocStudioNotesV1") || "[]");
      const previousData = JSON.parse(localStorage.getItem("blocStudioDataV1") || "null");
      if (!legacyNotes.length && previousData && Array.isArray(previousData.notes)) {
        legacyNotes = previousData.notes.map((note, index) => {
          if (!note || typeof note !== "object" || Array.isArray(note)) {
            throw new Error("El respaldo local contiene una nota inválida.");
          }
          const now = Date.now();
          const createdAt = Number(note.createdAt);
          const updatedAt = Number(note.updatedAt);
          return {
            id: String(note.id || `legacy-${now}-${index}`),
            title: String(note.title || "Nota sin título"),
            content: String(note.content || ""),
            linkedTo: String(note.linkedTo || note.project || ""),
            language: ["auto", "python", "javascript", "html", "css", "json", "text"].includes(note.language)
              ? note.language
              : "auto",
            createdAt: Number.isSafeInteger(createdAt) && createdAt >= 0 ? createdAt : now,
            updatedAt: Number.isSafeInteger(updatedAt) && updatedAt >= 0 ? updatedAt : now
          };
        });
      }
      const legacyProjectState = JSON.parse(localStorage.getItem("blocStudioProjectsV1") || "{}");
      if (legacyNotes.length || (Array.isArray(legacyProjectState.projects) && legacyProjectState.projects.length)) {
        data = {
          ...data,
          notes: legacyNotes,
          projects: legacyProjectState.projects || [],
          selectedProjectId: legacyProjectState.selectedProjectId || null,
          activeWorkSession: legacyProjectState.activeWorkSession || null,
          dailyProgress: JSON.parse(localStorage.getItem("blockgramDailyProgressV1") ||
            "{\"count\":0,\"lastProgressDate\":\"\"}"),
          legacySource: true
        };
      }
    }
    return {
      ...validateAccountData(data),
      legacySource: Boolean(data.legacySource),
      cachePresent: Boolean(notesText || projectsText || progressText)
    };
  };

  const hasLocalData = (data) => data.notes.length > 0 || data.projects.length > 0 ||
    Boolean(data.activeWorkSession) || (data.dailyProgress && data.dailyProgress.count > 0);

  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  };

  const sameAccountData = (first, second) =>
    JSON.stringify(canonicalize(validateAccountData(first))) ===
    JSON.stringify(canonicalize(validateAccountData(second)));

  const storeAccountData = (data, username) => {
    const normalized = validateAccountData(data);
    const keys = [
      [accountStorageKey("notes", username), JSON.stringify(normalized.notes)],
      [accountStorageKey("projects", username), JSON.stringify({
        projects: normalized.projects,
        selectedProjectId: normalized.selectedProjectId,
        activeWorkSession: normalized.activeWorkSession
      })],
      [accountStorageKey("progress", username), JSON.stringify(normalized.dailyProgress)]
    ];
    const previous = keys.map(([key]) => [key, localStorage.getItem(key)]);
    try {
      keys.forEach(([key, value]) => localStorage.setItem(key, value));
    } catch (error) {
      try {
        previous.forEach(([key, value]) => {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        });
      } catch (restoreError) {
        console.error("No se pudieron restaurar los datos locales anteriores:", restoreError);
      }
      throw error;
    }
  };

  const saveLegacyOwner = (username) => {
    localStorage.setItem(legacyAttachmentOwnerKey, username);
  };

  const storeConflict = (username, localData, remoteData, revision) => {
    return {
      localData: validateAccountData(localData),
      remoteData: validateAccountData(remoteData),
      remoteRevision: revision
    };
  };

  const showApplication = (username) => {
    const legacyAttachmentOwner = localStorage.getItem(legacyAttachmentOwnerKey);
    window.blockgramAttachmentDBName = username === legacyAttachmentOwner
      ? "blockgramAttachments"
      : `blockgramAttachments:${username.toLowerCase()}`;
    window.blockgramAccountUsername = username;
    document.getElementById("accountUsername").textContent =
      window.blockgramOffline ? "Local" : username;
    const logoutButton = document.getElementById("logoutButton");
    logoutButton.hidden = Boolean(window.blockgramOffline);
    if (window.blockgramOffline) {
      document.getElementById("accountSyncStatus").textContent = "Solo en este dispositivo";
    }
    authScreen.hidden = true;
    document.getElementById("appShell").hidden = false;
  };

  const initializeLocalMode = () => {
    const username = localStorage.getItem(lastAccountUsernameKey) || "local";
    const localData = readLocalData(username, true);
    if (localData.legacySource) {
      saveLegacyOwner(username);
      storeAccountData(localData, username);
    }
    window.blockgramOffline = true;
    window.blockgramAccountRevision = 0;
    showApplication(username);
    return true;
  };

  const initialize = async () => {
    try {
      let session;
      try {
        session = await request("session");
        if (!session || typeof session.authenticated !== "boolean") {
          const error = new Error("La ruta de sesión de la API no está disponible.");
          error.code = "API_UNAVAILABLE";
          throw error;
        }
      } catch (error) {
        if (isApiUnavailable(error)) return initializeLocalMode();
        throw error;
      }
      if (!session.authenticated) return false;
      const data = await request("data", { headers: accountHeaders(session.username) });
      if (!Number.isSafeInteger(data._revision) || data._revision < 1) {
        throw new Error("El servidor devolvió una versión de datos inválida.");
      }
      let localData;
      try {
        localData = readLocalData(session.username, true);
      } catch (error) {
        throw new Error(`No se pudieron leer los datos locales de la cuenta: ${error.message}`);
      }
      if (localData.legacySource) saveLegacyOwner(session.username);
      if ((localData.cachePresent || localData.legacySource) &&
        !sameAccountData(localData, data)) {
        window.blockgramSyncConflict = storeConflict(session.username, localData, data, data._revision);
        storeAccountData(localData, session.username);
        window.blockgramPendingConflict = true;
      } else if (!hasLocalData(data) && hasLocalData(localData)) {
        const importLocal = window.confirm(
          "Esta cuenta no tiene notas guardadas todavía. ¿Quieres copiar a la cuenta las notas y proyectos de este dispositivo?"
        );
        if (importLocal) {
          try {
            const result = await request("data", {
              method: "PUT",
              headers: accountHeaders(session.username, true),
              body: JSON.stringify({ ...localData, expectedRevision: data._revision })
            });
            data.notes = localData.notes;
            data.projects = localData.projects;
            data.selectedProjectId = localData.selectedProjectId;
            data.activeWorkSession = localData.activeWorkSession;
            data.dailyProgress = localData.dailyProgress;
            data._revision = result.revision;
          } catch (error) {
            if (error.status === 413) {
              window.blockgramSyncConflict = {
                ...storeConflict(session.username, localData, data, data._revision),
                reason: "Los datos superan el límite de 2 MiB. Se conservaron localmente; reduce el contenido antes de sincronizar."
              };
            } else if (error.status === 409 && error.result.data &&
              Number.isSafeInteger(error.result.revision)) {
              window.blockgramSyncConflict = storeConflict(
                session.username,
                localData,
                error.result.data,
                error.result.revision
              );
              data._revision = error.result.revision;
            } else {
              throw error;
            }
            storeAccountData(localData, session.username);
            window.blockgramPendingConflict = true;
          }
        } else if (!window.confirm(
          "Si continúas, los datos de este dispositivo se reemplazarán por los de la cuenta. ¿Continuar?"
        )) {
          setMessage("Se mantuvieron tus datos locales. Puedes iniciar sesión de nuevo cuando decidas qué cuenta usar.");
          return false;
        }
      }
      if (!window.blockgramPendingConflict) storeAccountData(data, session.username);
      try {
        localStorage.setItem(lastAccountUsernameKey, session.username);
      } catch (error) {
        console.warn("No se pudo recordar la última cuenta de Blockgram:", error);
      }
      window.blockgramAccountRevision = data._revision;
      showApplication(session.username);
      return true;
    } catch (error) {
      setMessage(error.message || "No se pudo conectar con Blockgram. Comprueba el servidor e inténtalo otra vez.");
      return false;
    }
  };
  const updateMode = () => {
    authTitle.textContent = registering ? "Crea tu cuenta" : "Inicia sesión";
    authDescription.textContent = registering
      ? "Elige un usuario único y una contraseña para guardar tus notas en línea."
      : "Entra con tu usuario y contraseña para acceder a tus notas.";
    authSubmit.textContent = registering ? "Registrarme" : "Iniciar sesión";
    toggleAuthMode.textContent = registering
      ? "¿Ya tienes cuenta? Inicia sesión"
      : "¿No tienes cuenta? Regístrate";
    authPassword.autocomplete = registering ? "new-password" : "current-password";
    authPassword.minLength = registering ? 10 : 1;
    setMessage("");
  };

  toggleAuthMode.addEventListener("click", () => {
    registering = !registering;
    updateMode();
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    authSubmit.disabled = true;
    setMessage(registering ? "Creando cuenta..." : "Iniciando sesión...");
    let activeUsername = authUsername.value.trim();
    try {
      if (registering) {
        const localData = readLocalData(activeUsername, true);
        const importLocal = hasLocalData(localData) && window.confirm(
          "Hay notas o proyectos guardados en este dispositivo. ¿Quieres copiarlos a tu nueva cuenta?"
        );
        if (hasLocalData(localData) && !importLocal && !window.confirm(
          "Al continuar sin copiarlos, los datos locales de este dispositivo se reemplazarán por los de la cuenta. ¿Continuar?"
        )) {
          setMessage("Registro cancelado; tus datos locales se conservaron.");
          return;
        }
        const registered = await request("register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: authUsername.value.trim(), password: authPassword.value })
        });
        activeUsername = registered.username;
        if (localData.legacySource) saveLegacyOwner(activeUsername);
        if (importLocal) {
          const result = await request("data", {
            method: "PUT",
            headers: accountHeaders(activeUsername, true),
            body: JSON.stringify({ ...localData, expectedRevision: 1 })
          });
          storeAccountData({ ...localData, _revision: result.revision }, activeUsername);
        } else {
          storeAccountData({
            notes: [],
            projects: [],
            selectedProjectId: null,
            activeWorkSession: null,
            dailyProgress: { count: 0, lastProgressDate: "" },
            _revision: 1
          }, activeUsername);
        }
      } else {
        const loggedIn = await request("login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: authUsername.value.trim(), password: authPassword.value })
        });
        activeUsername = loggedIn.username;
      }
      try {
        localStorage.setItem(lastAccountUsernameKey, activeUsername);
      } catch (error) {
        console.warn("No se pudo recordar la última cuenta de Blockgram:", error);
      }
      window.location.reload();
    } catch (error) {
      if (registering && error.message !== "Ese usuario ya está ocupado.") {
        try {
          await request("logout", {
            method: "POST",
            headers: accountHeaders(activeUsername, true),
            body: "{}"
          });
        } catch (logoutError) {
          console.error("No se pudo cerrar la sesión creada durante el registro:", logoutError);
        }
      }
      setMessage(error.message || "No se pudo conectar con el servidor. Inténtalo de nuevo.");
    } finally {
      authSubmit.disabled = false;
    }
  });

  document.getElementById("logoutButton").addEventListener("click", async () => {
    const button = document.getElementById("logoutButton");
    button.disabled = true;
    try {
      if (window.blockgramOffline) return;
      if (window.blockgramFlushSync) await window.blockgramFlushSync();
      await request("logout", {
        method: "POST",
        headers: accountHeaders(window.blockgramAccountUsername, true),
        body: "{}"
      });
      window.location.reload();
    } catch (error) {
      button.disabled = false;
      window.alert(error.message || "No se pudo cerrar la sesión.");
    }
  });

  window.blockgramValidateAccountData = validateAccountData;
  window.blockgramAccountStorageKey = accountStorageKey;
  window.blockgramStoreAccountData = storeAccountData;
  window.blockgramReady = initialize();
})();
