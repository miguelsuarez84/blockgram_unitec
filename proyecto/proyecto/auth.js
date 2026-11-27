(() => {
  "use strict";

  const authScreen = document.getElementById("authScreen");
  const authForm = document.getElementById("authForm");
  const authTitle = document.getElementById("authTitle");
  const authDescription = document.getElementById("authDescription");
  const authUsername = document.getElementById("authUsername");
  const authPassword = document.getElementById("authPassword");
  const authMessage = document.getElementById("authMessage");
  const authLocalNotice = document.getElementById("authLocalNotice");
  const authSubmit = document.getElementById("authSubmit");
  const toggleAuthMode = document.getElementById("toggleAuthMode");
  const accountDialog = document.getElementById("accountDialog");
  const accountMenu = document.getElementById("accountMenu");
  const passwordChangeForm = document.getElementById("passwordChangeForm");
  const passwordChangeMessage = document.getElementById("passwordChangeMessage");
  const currentPassword = document.getElementById("currentPassword");
  const newPassword = document.getElementById("newPassword");
  const confirmPassword = document.getElementById("confirmPassword");
  const deleteAccountForm = document.getElementById("deleteAccountForm");
  const deleteAccountUsername = document.getElementById("deleteAccountUsername");
  const deleteAccountPassword = document.getElementById("deleteAccountPassword");
  const deleteAccountMessage = document.getElementById("deleteAccountMessage");
  const deleteAccountWarning = document.getElementById("deleteAccountWarning");
  let useLocalButton = document.getElementById("useLocalButton");
  const legacyAttachmentOwnerKey = "blockgramLegacyAttachmentOwnerV1";
  const accountStorageKey = (key, username) =>
    `blockgram:${encodeURIComponent(username.toLowerCase())}:${key}`;
  const localAccountPrefix = "blockgramLocalAccountV1:";
  const localSessionKey = "blockgramLocalSessionV1";
  const guestUsername = "__blockgram_guest__";
  const localUsernamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$/;
  const localPasswordIterations = 210000;
  let registering = false;
  let apiUnavailable = false;
  let resolveBlockgramReady;
  window.blockgramReady = new Promise((resolve) => {
    resolveBlockgramReady = resolve;
  });

  if (!useLocalButton) {
    useLocalButton = document.createElement("button");
    useLocalButton.id = "useLocalButton";
    useLocalButton.className = "auth-toggle";
    useLocalButton.type = "button";
    useLocalButton.textContent = "Continuar como invitado/local";
    const footnote = authForm.querySelector(".auth-footnote");
    if (footnote) authForm.insertBefore(useLocalButton, footnote);
    else authForm.append(useLocalButton);
  }

  const setMessage = (message) => {
    authMessage.textContent = message;
  };

  const request = async (path, options) => {
    const timeoutDuration = path === "session" ? 4000 :
      path === "login" || path === "register" ? 10000 : 0;
    const controller = timeoutDuration && typeof AbortController === "function"
      ? new AbortController()
      : null;
    const timeout = controller ? window.setTimeout(() => controller.abort(), timeoutDuration) : 0;
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

  const localAccountKey = (username) =>
    `${localAccountPrefix}${encodeURIComponent(username.toLowerCase())}`;

  const encodeBase64 = (bytes) =>
    window.btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));

  const decodeBase64 = (value) => {
    try {
      return Uint8Array.from(window.atob(value), (character) => character.charCodeAt(0));
    } catch (error) {
      throw new Error("La cuenta local tiene credenciales inválidas.");
    }
  };

  const deriveLocalPasswordHash = async (password, salt) => {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("Este navegador no admite el inicio de sesión local seguro. Usa HTTPS o conecta el servidor de Blockgram.");
    }
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const derivedBits = await window.crypto.subtle.deriveBits({
      name: "PBKDF2",
      salt,
      iterations: localPasswordIterations,
      hash: "SHA-256"
    }, keyMaterial, 256);
    return new Uint8Array(derivedBits);
  };

  const readLocalAccount = (username) => {
    const text = localStorage.getItem(localAccountKey(username));
    if (text === null) return null;
    let account;
    try {
      account = JSON.parse(text);
    } catch (error) {
      throw new Error("Los datos de la cuenta local están dañados.");
    }
    if (!account || account.version !== 1 || typeof account.username !== "string" ||
      account.username.toLowerCase() !== username.toLowerCase() ||
      !localUsernamePattern.test(account.username) ||
      typeof account.salt !== "string" || typeof account.passwordHash !== "string") {
      throw new Error("Los datos de la cuenta local tienen un formato inválido.");
    }
    const salt = decodeBase64(account.salt);
    const passwordHash = decodeBase64(account.passwordHash);
    if (salt.length !== 16 || passwordHash.length !== 32) {
      throw new Error("La cuenta local tiene credenciales inválidas.");
    }
    return { ...account, salt, passwordHash };
  };

  const equalBytes = (first, second) => {
    if (first.length !== second.length) return false;
    let difference = 0;
    for (let index = 0; index < first.length; index += 1) {
      difference |= first[index] ^ second[index];
    }
    return difference === 0;
  };

  const validateLocalCredentials = (username, password, requireNewPassword = false) => {
    const normalizedUsername = username.trim();
    if (!localUsernamePattern.test(normalizedUsername)) {
      throw new Error("El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo.");
    }
    if (typeof password !== "string" || !password || (requireNewPassword && password.length < 10)) {
      throw new Error("La contraseña debe tener al menos 10 caracteres.");
    }
    if (password.length > 128 || new TextEncoder().encode(password).byteLength > 512) {
      throw new Error("La contraseña no puede superar 128 caracteres.");
    }
    return normalizedUsername;
  };

  const startLocalSession = (username) => {
    localStorage.setItem(localSessionKey, username);
    window.blockgramOffline = true;
    window.blockgramAccountRevision = 0;
    showApplication(username);
  };

  const registerLocalAccount = async (username, password) => {
    const normalizedUsername = validateLocalCredentials(username, password, true);
    const key = localAccountKey(normalizedUsername);
    if (localStorage.getItem(key) !== null) {
      throw new Error("Ese usuario ya está registrado en este navegador.");
    }
    const localData = readLocalData(normalizedUsername);
    const salt = window.crypto && window.crypto.getRandomValues
      ? window.crypto.getRandomValues(new Uint8Array(16))
      : null;
    if (!salt) {
      throw new Error("Este navegador no permite crear credenciales locales seguras.");
    }
    const passwordHash = await deriveLocalPasswordHash(password, salt);
    const account = {
      version: 1,
      username: normalizedUsername,
      salt: encodeBase64(salt),
      passwordHash: encodeBase64(passwordHash)
    };
    try {
      localStorage.setItem(key, JSON.stringify(account));
      if (!localData.cachePresent) {
        storeAccountData({
          notes: [],
          projects: [],
          selectedProjectId: null,
          activeWorkSession: null,
          dailyProgress: { count: 0, lastProgressDate: "" }
        }, normalizedUsername);
      }
      startLocalSession(normalizedUsername);
    } catch (error) {
      try {
        localStorage.removeItem(key);
      } catch (cleanupError) {
        console.error("No se pudo limpiar el registro local incompleto:", cleanupError);
      }
      throw error;
    }
  };

  const loginLocalAccount = async (username, password) => {
    const normalizedUsername = validateLocalCredentials(username, password);
    const account = readLocalAccount(normalizedUsername);
    if (!account) {
      throw new Error("No existe una cuenta con ese usuario en este navegador. Regístrate aquí o conecta con el servidor.");
    }
    const candidateHash = await deriveLocalPasswordHash(password, account.salt);
    if (!equalBytes(candidateHash, account.passwordHash)) {
      throw new Error("Usuario o contraseña incorrectos.");
    }
    readLocalData(account.username);
    startLocalSession(account.username);
  };

  const clearLocalAccountStorage = (username) => {
    [
      accountStorageKey("notes", username),
      accountStorageKey("projects", username),
      accountStorageKey("progress", username)
    ].forEach((key) => localStorage.removeItem(key));
    const activeUsername = localStorage.getItem(localSessionKey);
    if (activeUsername && activeUsername.toLowerCase() === username.toLowerCase()) {
      localStorage.removeItem(localSessionKey);
    }
    const attachmentOwner = localStorage.getItem(legacyAttachmentOwnerKey);
    if (attachmentOwner && attachmentOwner.toLowerCase() === username.toLowerCase()) {
      localStorage.removeItem(legacyAttachmentOwnerKey);
    }
    localStorage.removeItem(localAccountKey(username));
  };

  const resumeLocalSession = () => {
    const username = localStorage.getItem(localSessionKey);
    if (!username) return false;
    if (username === guestUsername) {
      const localData = readLocalData(guestUsername, true);
      if (localData.legacySource) {
        saveLegacyOwner(guestUsername);
        storeAccountData(localData, guestUsername);
      }
      window.blockgramOffline = true;
      window.blockgramAccountRevision = 0;
      showApplication(guestUsername);
      return true;
    }
    const account = readLocalAccount(username);
    if (!account) {
      localStorage.removeItem(localSessionKey);
      return false;
    }
    readLocalData(account.username);
    window.blockgramOffline = true;
    window.blockgramAccountRevision = 0;
    showApplication(account.username);
    return true;
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
    const displayUsername = window.blockgramOffline && username === guestUsername
      ? "Invitado"
      : username;
    document.getElementById("accountUsername").textContent =
      window.blockgramOffline ? displayUsername : username;
    document.getElementById("accountDialogUsername").textContent =
      window.blockgramOffline ? displayUsername : username;
    document.getElementById("openPasswordChange").hidden =
      Boolean(window.blockgramOffline && username === guestUsername);
    document.getElementById("openDeleteAccount").hidden =
      Boolean(window.blockgramOffline && username === guestUsername);
    if (window.blockgramOffline) {
      document.getElementById("accountSyncStatus").textContent = "Solo en este dispositivo";
    }
    authScreen.hidden = true;
    document.getElementById("appShell").hidden = false;
    resolveBlockgramReady(true);
  };

  const initializeLocalMode = () => {
    const username = guestUsername;
    const localData = readLocalData(username, true);
    if (localData.legacySource) {
      saveLegacyOwner(username);
      storeAccountData(localData, username);
    }
    startLocalSession(username);
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
        if (isApiUnavailable(error)) {
          apiUnavailable = true;
          updateMode();
          try {
            if (resumeLocalSession()) return true;
          } catch (localError) {
            setMessage(localError.message || "No se pudo abrir la cuenta local de este navegador.");
            return false;
          }
          setMessage("");
          return false;
        }
        throw error;
      }
      if (!session.authenticated) return false;
      window.blockgramOffline = false;
      try {
        localStorage.removeItem(localSessionKey);
      } catch (error) {
        console.warn("No se pudo limpiar la sesión local anterior:", error);
      }
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
      window.blockgramAccountRevision = data._revision;
      showApplication(session.username);
      return true;
    } catch (error) {
      if (isApiUnavailable(error)) {
        apiUnavailable = true;
        updateMode();
        setMessage("");
      } else {
        setMessage(error.message || "No se pudo conectar con Blockgram. Comprueba el servidor e inténtalo otra vez.");
      }
      return false;
    }
  };
  const updateMode = () => {
    authTitle.textContent = registering ? "Crea tu cuenta" : "Inicia sesión";
    authDescription.textContent = apiUnavailable
      ? registering
        ? "Crea una cuenta que se guardará solo en este navegador; no se sincronizará con otros dispositivos."
        : "Entra con una cuenta creada en este navegador. Sus datos no se sincronizan con otros dispositivos."
      : registering
        ? "Elige un usuario único y una contraseña para guardar tus notas en línea."
        : "Entra con tu usuario y contraseña para acceder a tus notas.";
    authLocalNotice.hidden = !apiUnavailable;
    authLocalNotice.textContent = apiUnavailable
      ? "Modo local del navegador: las cuentas y sus datos solo estarán disponibles en este dispositivo."
      : "";
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

  useLocalButton.addEventListener("click", () => {
    useLocalButton.disabled = true;
    try {
      initializeLocalMode();
    } catch (error) {
      useLocalButton.disabled = false;
      setMessage(error.message || "No se pudo abrir el almacenamiento local de Blockgram.");
    }
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    authSubmit.disabled = true;
    let activeUsername = authUsername.value.trim();
    let registrationSucceeded = false;
    let usedLocalAuth = false;
    try {
      if (apiUnavailable) {
        setMessage(registering ? "Creando cuenta local..." : "Iniciando sesión local...");
        if (registering) {
          await registerLocalAccount(activeUsername, authPassword.value);
        } else {
          await loginLocalAccount(activeUsername, authPassword.value);
        }
        usedLocalAuth = true;
      } else if (registering) {
        setMessage("Creando cuenta...");
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
        let registered;
        try {
          registered = await request("register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: activeUsername, password: authPassword.value })
          });
        } catch (error) {
          if (!isApiUnavailable(error)) throw error;
          apiUnavailable = true;
          updateMode();
          setMessage("Creando cuenta local...");
          await registerLocalAccount(activeUsername, authPassword.value);
          usedLocalAuth = true;
        }
        if (!usedLocalAuth) {
          registrationSucceeded = true;
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
        }
      } else {
        setMessage("Iniciando sesión...");
        let loggedIn;
        try {
          loggedIn = await request("login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: activeUsername, password: authPassword.value })
          });
        } catch (error) {
          if (!isApiUnavailable(error)) throw error;
          apiUnavailable = true;
          updateMode();
          setMessage("Iniciando sesión local...");
          await loginLocalAccount(activeUsername, authPassword.value);
          usedLocalAuth = true;
        }
        if (!usedLocalAuth) activeUsername = loggedIn.username;
      }
      if (!usedLocalAuth) {
        try {
          localStorage.removeItem(localSessionKey);
        } catch (error) {
          console.warn("No se pudo limpiar la sesión local anterior:", error);
        }
      }
      window.location.reload();
    } catch (error) {
      if (registering && registrationSucceeded && error.message !== "Ese usuario ya está ocupado.") {
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
      if (isApiUnavailable(error)) {
        apiUnavailable = true;
        updateMode();
      }
      setMessage(error.message || "No se pudo conectar con el servidor. Inténtalo de nuevo.");
    } finally {
      authSubmit.disabled = false;
    }
  });

  document.getElementById("logoutButton").addEventListener("click", async () => {
    const button = document.getElementById("logoutButton");
    if (window.blockgramOffline) {
      try {
        localStorage.removeItem(localSessionKey);
        window.location.reload();
      } catch (error) {
        window.alert(error.message || "No se pudo cerrar la sesión local.");
      }
      return;
    }
    button.disabled = true;
    try {
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

  document.querySelectorAll("[data-open-account]").forEach((button) => {
    button.addEventListener("click", () => accountDialog.showModal());
  });
  document.querySelectorAll("[data-close-account]").forEach((button) => {
    button.addEventListener("click", () => accountDialog.close());
  });

  const showAccountMenu = () => {
    passwordChangeForm.reset();
    passwordChangeMessage.textContent = "";
    passwordChangeForm.hidden = true;
    deleteAccountForm.reset();
    deleteAccountMessage.textContent = "";
    deleteAccountForm.hidden = true;
    accountMenu.hidden = false;
  };
  document.getElementById("openPasswordChange").addEventListener("click", () => {
    accountMenu.hidden = true;
    passwordChangeForm.hidden = false;
    currentPassword.focus();
  });
  document.getElementById("cancelPasswordChange").addEventListener("click", showAccountMenu);
  accountDialog.addEventListener("close", showAccountMenu);
  document.getElementById("openDeleteAccount").addEventListener("click", () => {
    accountMenu.hidden = true;
    deleteAccountForm.reset();
    deleteAccountMessage.textContent = "";
    deleteAccountWarning.textContent = window.blockgramOffline
      ? "Se borrarán permanentemente esta cuenta, sus notas, proyectos, tareas y adjuntos de este navegador. No se puede deshacer."
      : "Se borrarán permanentemente esta cuenta y sus datos del servidor, además de los datos y adjuntos de este navegador. Las copias locales de otros dispositivos no se pueden borrar desde aquí.";
    deleteAccountForm.hidden = false;
    deleteAccountUsername.focus();
  });
  document.getElementById("cancelDeleteAccount").addEventListener("click", showAccountMenu);
  document.getElementById("switchAccountButton").addEventListener("click", async () => {
    const button = document.getElementById("switchAccountButton");
    if (window.blockgramOffline) {
      try {
        localStorage.removeItem(localSessionKey);
        window.location.reload();
      } catch (error) {
        window.alert(error.message || "No se pudo cambiar de cuenta local.");
      }
      return;
    }
    button.disabled = true;
    try {
      if (window.blockgramFlushSync) await window.blockgramFlushSync();
      await request("logout", {
        method: "POST",
        headers: accountHeaders(window.blockgramAccountUsername, true),
        body: "{}"
      });
      window.location.reload();
    } catch (error) {
      button.disabled = false;
      window.alert(error.message || "No se pudo cambiar de cuenta.");
    }
  });
  passwordChangeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (newPassword.value !== confirmPassword.value) {
      passwordChangeMessage.textContent = "Las contraseñas nuevas no coinciden.";
      confirmPassword.focus();
      return;
    }
    const button = document.getElementById("savePasswordChange");
    button.disabled = true;
    passwordChangeMessage.textContent = "Actualizando contraseña...";
    try {
      if (window.blockgramOffline) {
        const username = window.blockgramAccountUsername;
        const account = readLocalAccount(username);
        if (!account) throw new Error("No se encontró la cuenta local activa.");
        validateLocalCredentials(username, currentPassword.value);
        const currentHash = await deriveLocalPasswordHash(currentPassword.value, account.salt);
        if (!equalBytes(currentHash, account.passwordHash)) {
          throw new Error("La contraseña actual es incorrecta.");
        }
        validateLocalCredentials(username, newPassword.value, true);
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const passwordHash = await deriveLocalPasswordHash(newPassword.value, salt);
        localStorage.setItem(localAccountKey(username), JSON.stringify({
          version: 1,
          username: account.username,
          salt: encodeBase64(salt),
          passwordHash: encodeBase64(passwordHash)
        }));
      } else {
        await request("change-password", {
          method: "POST",
          headers: accountHeaders(window.blockgramAccountUsername, true),
          body: JSON.stringify({
            currentPassword: currentPassword.value,
            newPassword: newPassword.value
          })
        });
      }
      passwordChangeMessage.textContent = "Contraseña actualizada.";
      passwordChangeForm.reset();
      window.setTimeout(() => {
        if (accountDialog.open) accountDialog.close();
      }, 700);
    } catch (error) {
      passwordChangeMessage.textContent =
        error.message || "No se pudo actualizar la contraseña.";
    } finally {
      button.disabled = false;
    }
  });
  deleteAccountForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = window.blockgramAccountUsername;
    if (deleteAccountUsername.value.trim().toLowerCase() !== username.toLowerCase()) {
      deleteAccountMessage.textContent = "El usuario escrito no coincide con la cuenta activa.";
      deleteAccountUsername.focus();
      return;
    }
    const button = document.getElementById("confirmDeleteAccount");
    button.disabled = true;
    deleteAccountMessage.textContent = "Eliminando cuenta y datos...";
    try {
      if (window.blockgramOffline) {
        const account = readLocalAccount(username);
        if (!account) throw new Error("No se encontró la cuenta local que se va a eliminar.");
        const normalizedUsername = validateLocalCredentials(username, deleteAccountPassword.value);
        const candidateHash = await deriveLocalPasswordHash(deleteAccountPassword.value, account.salt);
        if (!equalBytes(candidateHash, account.passwordHash)) {
          throw new Error("La contraseña actual es incorrecta.");
        }
        await window.blockgramDeleteAccountAttachments();
        if (window.blockgramStopAccountAutosave) window.blockgramStopAccountAutosave();
        clearLocalAccountStorage(normalizedUsername);
      } else {
        await request("delete-account", {
          method: "POST",
          headers: accountHeaders(username, true),
          body: JSON.stringify({ currentPassword: deleteAccountPassword.value })
        });
        if (window.blockgramStopAccountAutosave) window.blockgramStopAccountAutosave();
        const cleanupErrors = [];
        try {
          await window.blockgramDeleteAccountAttachments();
        } catch (error) {
          cleanupErrors.push(error.message || "No se pudieron eliminar los adjuntos locales.");
        }
        try {
          clearLocalAccountStorage(username);
        } catch (error) {
          cleanupErrors.push(error.message || "No se pudieron eliminar los datos locales.");
        }
        if (cleanupErrors.length) {
          window.alert(`La cuenta se eliminó del servidor, pero falta limpiar este navegador: ${cleanupErrors.join(" ")}`);
        }
      }
      window.location.reload();
    } catch (error) {
      deleteAccountMessage.textContent = error.message || "No se pudo eliminar la cuenta.";
      button.disabled = false;
    }
  });

  window.blockgramValidateAccountData = validateAccountData;
  window.blockgramAccountStorageKey = accountStorageKey;
  window.blockgramStoreAccountData = storeAccountData;
  initialize();
})();
