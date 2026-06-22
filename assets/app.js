// app.js — Controlador de la SPA "Vitrina".
import * as store from "./store.js";
import * as enc from "./crypto.js";
import { GitHubClient } from "./github.js";
import { assemble } from "./loader.js";

// ---- Estado en memoria (nunca se persiste) ----
let masterKey = null;            // CryptoKey derivada de la passphrase global
let masterSalt = null;           // Uint8Array del salt del vault
const sessionPats = new Map();   // profileId -> PAT (solo perfiles "confianza")

const $ = (sel, root = document) => root.querySelector(sel);
const main = () => $("#main");
const modalRoot = () => $("#modal-root");

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function closeModal() { modalRoot().innerHTML = ""; }

function updateSession() {
  const el = $("#session");
  if (!el) return;
  if (masterKey) {
    el.innerHTML = `<span style="color:var(--ok)">●</span> Desbloqueado
      <button class="btn ghost sm" id="lock-btn">Bloquear</button>`;
    $("#lock-btn").onclick = lockSession;
  } else {
    el.innerHTML = `<span style="color:var(--faint)">●</span> Bloqueado`;
  }
}

function lockSession() {
  masterKey = null;
  masterSalt = null;
  sessionPats.clear();
  updateSession();
  renderLanding();
}

// ======================================================================
// Landing
// ======================================================================
function renderLanding() {
  main().innerHTML = `
    <p class="eyebrow">Vitrina</p>
    <h1>Mira tus repos privados desde una página pública</h1>
    <p class="lead">Vitrina es una webapp 100% estática que puedes publicar en GitHub
      Pages. Carga el contenido de tus repos <strong>privados</strong> usando un
      Personal Access Token (PAT) y lo renderiza en un iframe — sin servidor, sin backend.</p>

    <div class="btn-row" style="margin:22px 0 30px">
      <button class="btn primary" id="open-manager">Abrir gestor de perfiles →</button>
      <a class="btn ghost" href="#como-funciona">Cómo funciona</a>
    </div>

    <div class="grid cols-3">
      <div class="card feature">
        <h3><span class="ico">◆</span> Multi-perfil</h3>
        <p>Guarda varios perfiles (org, repo, rama, PAT). Funciona con cualquier webapp
           de cualquier repo, mientras el PAT tenga acceso.</p>
      </div>
      <div class="card feature">
        <h3><span class="ico">◆</span> PAT cifrado</h3>
        <p>Los tokens de los perfiles "aislado" se guardan cifrados con AES-GCM,
           protegidos por una passphrase global que solo vive en memoria.</p>
      </div>
      <div class="card feature">
        <h3><span class="ico">◆</span> Sin backend</h3>
        <p>Todo ocurre en tu navegador. El PAT viaja solo a la API de GitHub,
           siempre por header, nunca en la URL.</p>
      </div>
    </div>

    <h2 id="como-funciona">Cómo funciona</h2>
    <ol class="steps">
      <li><strong>Creas un fine-grained PAT</strong> de solo lectura con permiso
        <code>Contents: Read-only</code> sobre los repos que quieras mostrar.</li>
      <li><strong>Añades un perfil</strong> con la org/repo, la rama y el PAT.</li>
      <li><strong>Vitrina descarga el repo</strong> vía la API de GitHub y lo reensambla
        en el navegador (modo Tier 1: inline en un iframe).</li>
      <li><strong>Se muestra en un iframe</strong> con el aislamiento que elijas por perfil.</li>
    </ol>

    <h2>Modos de aislamiento</h2>
    <div class="grid cols-3">
      <div class="card">
        <h3><span class="badge aislado">Aislado</span></h3>
        <p class="muted" style="font-size:14px;margin:8px 0 0">Para apps de solo
          visualización. El iframe corre con origen opaco: no puede leer tu PAT.
          El token se guarda <strong>cifrado</strong>.</p>
      </div>
      <div class="card">
        <h3><span class="badge confianza">Confianza</span></h3>
        <p class="muted" style="font-size:14px;margin:8px 0 0">Para apps que necesitan
          su propio almacenamiento. Comparten origen, así que el PAT es
          <strong>solo de sesión</strong> (no se guarda).</p>
      </div>
      <div class="card">
        <h3><span class="ico" style="color:var(--accent)">◆</span> Tier 1.5</h3>
        <p class="muted" style="font-size:14px;margin:8px 0 0">Sitios estáticos y
          apps que leen archivos del repo en runtime (<code>fetch</code>/XHR) funcionan
          vía un shim. Módulos ES y Service Workers aún no: Vitrina te avisa.</p>
      </div>
    </div>

    <div class="alert info" style="margin-top:24px">
      <strong>Seguridad.</strong> Usa siempre un fine-grained PAT de solo lectura,
      con el mínimo de repos y expiración corta. Vitrina es estática y pública: si un
      token se ve comprometido, revócalo en GitHub y listo.
    </div>
  `;
  $("#open-manager").onclick = enterManager;
  updateSession();
}

// ======================================================================
// Lock / creación de passphrase
// ======================================================================
function enterManager() {
  if (masterKey) return renderManager();
  showLock();
}

function showLock() {
  const firstRun = !store.hasVault();
  modalRoot().innerHTML = `
    <div class="overlay">
      <div class="modal">
        <div class="head">
          <div class="brand"><span class="logo"></span></div>
          <h2 style="margin:0">${firstRun ? "Crea tu passphrase" : "Desbloquear"}</h2>
        </div>
        <p class="muted" style="font-size:14px">
          ${firstRun
            ? "Esta passphrase global cifra los PAT de tus perfiles. No se guarda en ningún sitio: si la olvidas, tendrás que volver a introducir los tokens."
            : "Introduce tu passphrase global para descifrar tus perfiles."}
        </p>
        <div class="field">
          <label>Passphrase</label>
          <input type="password" id="pp" autocomplete="${firstRun ? "new-password" : "current-password"}" autofocus />
        </div>
        ${firstRun ? `<div class="field"><label>Repite la passphrase</label><input type="password" id="pp2" /></div>` : ""}
        <div id="lock-err" class="alert danger hidden"></div>
        <div class="modal-foot">
          <button class="btn ghost" id="lock-cancel">Cancelar</button>
          <button class="btn primary" id="lock-ok">${firstRun ? "Crear y entrar" : "Desbloquear"}</button>
        </div>
      </div>
    </div>`;

  const err = $("#lock-err");
  const showErr = (m) => { err.textContent = m; err.classList.remove("hidden"); };
  $("#lock-cancel").onclick = closeModal;
  $("#pp").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#lock-ok").click(); });

  $("#lock-ok").onclick = async () => {
    const pp = $("#pp").value;
    if (!pp) return showErr("Introduce una passphrase.");
    try {
      if (firstRun) {
        if (pp !== $("#pp2").value) return showErr("Las passphrases no coinciden.");
        if (pp.length < 8) return showErr("Usa al menos 8 caracteres.");
        masterSalt = enc.randomBytes(16);
        masterKey = await enc.deriveKey(pp, masterSalt);
        const verifier = await enc.makeVerifier(masterKey);
        store.setVault({ salt: enc.toBase64(masterSalt), verifier });
      } else {
        const vault = store.getVault();
        masterSalt = enc.fromBase64(vault.salt);
        const key = await enc.deriveKey(pp, masterSalt);
        if (!(await enc.checkVerifier(key, vault.verifier)))
          return showErr("Passphrase incorrecta.");
        masterKey = key;
      }
      closeModal();
      updateSession();
      renderManager();
    } catch (e) {
      showErr("Error: " + e.message);
    }
  };
}

// ======================================================================
// Gestor de perfiles
// ======================================================================
function renderManager() {
  const profiles = store.getProfiles().sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  main().innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
      <div><p class="eyebrow">Gestor</p><h1 style="margin:0">Perfiles</h1></div>
      <div class="spacer" style="flex:1"></div>
      <button class="btn ghost sm" id="export-btn">Exportar</button>
      <button class="btn ghost sm" id="import-btn">Importar</button>
      <button class="btn primary" id="add-btn">+ Nuevo perfil</button>
    </div>
    <div class="profiles" id="profiles">
      ${profiles.length === 0
        ? `<div class="empty">Aún no tienes perfiles.<br>Crea uno para mostrar el contenido de un repo privado.</div>`
        : profiles.map(profileRow).join("")}
    </div>
    <input type="file" id="import-file" accept="application/json" class="hidden" />
  `;

  $("#add-btn").onclick = () => showEditor(null);
  $("#export-btn").onclick = doExport;
  $("#import-btn").onclick = () => $("#import-file").click();
  $("#import-file").onchange = doImport;

  $("#profiles").querySelectorAll("[data-act]").forEach((btn) => {
    btn.onclick = () => {
      const { act, id } = btn.dataset;
      if (act === "open") openViewer(id);
      if (act === "edit") showEditor(store.getProfile(id));
      if (act === "delete") deleteProfile(id);
    };
  });
  updateSession();
}

function profileRow(p) {
  const needsSessionPat = p.isolation === "confianza" && !sessionPats.has(p.id);
  return `
    <div class="profile">
      <div class="meta">
        <div class="name">${esc(p.name)}
          <span class="badge ${p.isolation}">${p.isolation}</span>
          ${needsSessionPat ? `<span class="badge">PAT requerido</span>` : ""}
        </div>
        <div class="sub">${esc(p.owner)}/${esc(p.repo)} · ${esc(p.branch || "rama por defecto")} · ${esc(p.entry)}</div>
      </div>
      <div class="acts">
        <button class="btn sm primary" data-act="open" data-id="${p.id}">Ver</button>
        <button class="btn sm" data-act="edit" data-id="${p.id}">Editar</button>
        <button class="btn sm danger" data-act="delete" data-id="${p.id}">Borrar</button>
      </div>
    </div>`;
}

function deleteProfile(id) {
  const p = store.getProfile(id);
  if (!confirm(`¿Borrar el perfil "${p.name}"?`)) return;
  store.deleteProfile(id);
  sessionPats.delete(id);
  renderManager();
}

// ======================================================================
// Editor de perfil
// ======================================================================
function showEditor(profile) {
  const isEdit = !!profile;
  const p = profile || { isolation: "aislado", branch: "", entry: "index.html" };
  modalRoot().innerHTML = `
    <div class="overlay">
      <div class="modal" style="max-width:540px">
        <h2 style="margin-top:0">${isEdit ? "Editar perfil" : "Nuevo perfil"}</h2>
        <div class="field">
          <label>Nombre</label>
          <input id="f-name" value="${esc(p.name || "")}" placeholder="Mi dashboard interno" />
        </div>
        <div class="row2">
          <div class="field"><label>Owner / organización</label>
            <input id="f-owner" class="mono" value="${esc(p.owner || "")}" placeholder="mi-org" /></div>
          <div class="field"><label>Repositorio</label>
            <input id="f-repo" class="mono" value="${esc(p.repo || "")}" placeholder="repo-privado" /></div>
        </div>
        <div class="row2">
          <div class="field"><label>Rama</label>
            <input id="f-branch" class="mono" value="${esc(p.branch || "")}" placeholder="(rama por defecto)" /></div>
          <div class="field"><label>Archivo de entrada</label>
            <input id="f-entry" class="mono" value="${esc(p.entry || "index.html")}" /></div>
        </div>

        <div class="field">
          <label>Modo de aislamiento</label>
          <div class="segmented">
            <label><input type="radio" name="iso" value="aislado" ${p.isolation !== "confianza" ? "checked" : ""}>
              <div class="t"><span class="badge aislado">Aislado</span></div>
              <div class="d">Solo visualización. PAT cifrado y guardado.</div></label>
            <label><input type="radio" name="iso" value="confianza" ${p.isolation === "confianza" ? "checked" : ""}>
              <div class="t"><span class="badge confianza">Confianza</span></div>
              <div class="d">La app usa storage. PAT solo de sesión.</div></label>
          </div>
        </div>

        <div class="field">
          <label>Personal Access Token</label>
          <input id="f-pat" class="mono" type="password" autocomplete="off"
            placeholder="${isEdit && p.patEnc ? "•••••• (déjalo vacío para no cambiarlo)" : "github_pat_..."}" />
          <span class="hint" id="pat-hint"></span>
        </div>

        <div id="ed-msg" class="alert hidden"></div>
        <div class="modal-foot">
          <button class="btn ghost" id="ed-test">Probar conexión</button>
          <div style="flex:1"></div>
          <button class="btn ghost" id="ed-cancel">Cancelar</button>
          <button class="btn primary" id="ed-save">${isEdit ? "Guardar" : "Crear"}</button>
        </div>
      </div>
    </div>`;

  const msg = $("#ed-msg");
  const setMsg = (cls, text) => { msg.className = "alert " + cls; msg.innerHTML = text; };
  const updateHint = () => {
    const iso = modalRoot().querySelector('input[name="iso"]:checked').value;
    $("#pat-hint").textContent = iso === "confianza"
      ? "Modo confianza: el PAT no se guarda, lo pedirá cada sesión."
      : "Modo aislado: el PAT se cifra con tu passphrase global.";
  };
  modalRoot().querySelectorAll('input[name="iso"]').forEach((r) => (r.onchange = updateHint));
  updateHint();
  $("#ed-cancel").onclick = closeModal;

  const readForm = () => ({
    name: $("#f-name").value.trim(),
    owner: $("#f-owner").value.trim(),
    repo: $("#f-repo").value.trim(),
    branch: $("#f-branch").value.trim(),
    entry: $("#f-entry").value.trim() || "index.html",
    isolation: modalRoot().querySelector('input[name="iso"]:checked').value,
    pat: $("#f-pat").value,
  });

  // Resuelve el token a usar para "Probar conexión": el escrito, o el guardado.
  async function resolveTokenForTest(form) {
    if (form.pat) return form.pat;
    if (isEdit && p.isolation === "confianza" && sessionPats.has(p.id)) return sessionPats.get(p.id);
    if (isEdit && p.patEnc) return enc.decrypt(masterKey, p.patEnc);
    return null;
  }

  $("#ed-test").onclick = async () => {
    const form = readForm();
    if (!form.owner || !form.repo) return setMsg("danger", "Indica owner y repo."), msg.classList.remove("hidden");
    const token = await resolveTokenForTest(form).catch(() => null);
    if (!token) return setMsg("danger", "Introduce un PAT para probar."), msg.classList.remove("hidden");
    setMsg("info", "Probando…"); msg.classList.remove("hidden");
    try {
      const client = new GitHubClient(token);
      const [viewer, repo] = await Promise.all([
        client.getViewer(),
        client.getRepo(form.owner, form.repo),
      ]);
      setMsg("ok",
        `✓ Conectado como <strong>${esc(viewer.login)}</strong>. Acceso a
         <code>${esc(repo.full_name)}</code> (rama por defecto: <code>${esc(repo.default_branch)}</code>).`);
    } catch (e) {
      setMsg("danger", "✗ " + esc(e.message));
    }
  };

  $("#ed-save").onclick = async () => {
    const form = readForm();
    if (!form.name || !form.owner || !form.repo) {
      setMsg("danger", "Nombre, owner y repo son obligatorios."); msg.classList.remove("hidden"); return;
    }
    const id = isEdit ? p.id : store.newId();
    const next = {
      id, name: form.name, owner: form.owner, repo: form.repo,
      branch: form.branch, entry: form.entry, isolation: form.isolation,
      patEnc: isEdit ? p.patEnc || null : null,
      createdAt: isEdit ? p.createdAt : Date.now(),
      lastUsedAt: p.lastUsedAt || 0,
    };

    try {
      if (form.isolation === "aislado") {
        if (form.pat) next.patEnc = await enc.encrypt(masterKey, form.pat);
        if (!next.patEnc) { setMsg("danger", "El modo aislado necesita un PAT."); msg.classList.remove("hidden"); return; }
        sessionPats.delete(id);
      } else {
        next.patEnc = null;
        if (form.pat) sessionPats.set(id, form.pat);
      }
      store.saveProfile(next);
      closeModal();
      renderManager();
    } catch (e) {
      setMsg("danger", "Error al guardar: " + esc(e.message)); msg.classList.remove("hidden");
    }
  };
}

// ======================================================================
// Export / Import
// ======================================================================
function doExport() {
  if (!confirm("La exportación incluye los PAT cifrados de los perfiles 'aislado'.\nGuárdala en lugar seguro. ¿Continuar?")) return;
  const blob = new Blob([store.exportData()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "vitrina-perfiles.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function doImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const n = store.importData(await file.text());
    masterKey = null; // el vault pudo cambiar: forzar re-desbloqueo
    alert(`Importados ${n} perfiles. Vuelve a desbloquear con la passphrase correspondiente.`);
    enterManager();
  } catch (err) {
    alert("Error al importar: " + err.message);
  }
}

// ======================================================================
// Visor
// ======================================================================
async function openViewer(id) {
  const p = store.getProfile(id);
  if (!p) return;

  // Resolver token
  let token;
  try {
    if (p.isolation === "aislado") {
      token = await enc.decrypt(masterKey, p.patEnc);
    } else {
      token = sessionPats.get(id) || (await promptSessionPat(p));
      if (!token) return;
    }
  } catch {
    return alert("No se pudo descifrar el PAT. ¿Passphrase correcta?");
  }

  const branch = p.branch || (await new GitHubClient(token).getRepo(p.owner, p.repo)).default_branch;

  showViewerShell(p);
  const setProgress = (m) => { const el = $("#progress-msg"); if (el) el.textContent = m; };

  try {
    const client = new GitHubClient(token);
    const { html, warnings } = await assemble({
      client, profile: { ...p, branch }, onProgress: setProgress,
    });
    mountFrame(p, html, warnings);
    store.touchProfile(id);
  } catch (e) {
    $("#frame-host").innerHTML =
      `<div class="loading"><div style="text-align:center;max-width:420px">
         <p style="color:var(--danger);font-weight:600">No se pudo cargar el sitio</p>
         <p class="muted">${esc(e.message)}</p>
         <button class="btn" id="back-btn">← Volver</button></div></div>`;
    $("#back-btn").onclick = closeViewer;
  }
}

function showViewerShell(p) {
  const root = $("#viewer-root");
  root.classList.remove("hidden");
  root.innerHTML = `
    <div class="viewer-wrap">
      <div class="viewer-bar">
        <button class="btn ghost sm" id="v-back">← Perfiles</button>
        <div><div class="title">${esc(p.name)}</div>
          <div class="sub">${esc(p.owner)}/${esc(p.repo)}</div></div>
        <div style="flex:1"></div>
        <span class="badge ${p.isolation}">${p.isolation}</span>
        <button class="btn ghost sm" id="v-reload">↻ Recargar</button>
      </div>
      <div id="warn-host"></div>
      <div class="frame-host" id="frame-host">
        <div class="loading"><div style="text-align:center">
          <div class="spin"></div>
          <div class="progress-msg" id="progress-msg">Cargando…</div></div></div>
      </div>
    </div>`;
  $("#v-back").onclick = closeViewer;
  $("#v-reload").onclick = () => openViewer(p.id);
}

function mountFrame(p, html, warnings) {
  if (warnings.length) {
    $("#warn-host").innerHTML =
      `<div class="alert warn" style="margin:0;border-radius:0;border-width:0 0 1px">
        <strong>Aviso (Tier 1.5):</strong> ${warnings.map(esc).join(" ")}</div>`;
  }
  const sandbox = p.isolation === "confianza"
    ? "allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
    : "allow-scripts";
  const host = $("#frame-host");
  host.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", sandbox);
  iframe.setAttribute("title", p.name);
  iframe.srcdoc = html;
  host.appendChild(iframe);
}

function closeViewer() {
  const root = $("#viewer-root");
  root.classList.add("hidden");
  root.innerHTML = "";
  renderManager();
}

function promptSessionPat(p) {
  return new Promise((resolve) => {
    modalRoot().innerHTML = `
      <div class="overlay"><div class="modal">
        <h2 style="margin-top:0">PAT de sesión</h2>
        <p class="muted" style="font-size:14px">El perfil <strong>${esc(p.name)}</strong>
          es de modo confianza: su PAT no se guarda. Introdúcelo para esta sesión.</p>
        <div class="field"><label>Personal Access Token</label>
          <input id="sp-pat" class="mono" type="password" autocomplete="off" autofocus placeholder="github_pat_..." /></div>
        <div class="modal-foot">
          <button class="btn ghost" id="sp-cancel">Cancelar</button>
          <button class="btn primary" id="sp-ok">Usar</button>
        </div>
      </div></div>`;
    $("#sp-cancel").onclick = () => { closeModal(); resolve(null); };
    $("#sp-ok").onclick = () => {
      const v = $("#sp-pat").value.trim();
      if (!v) return;
      sessionPats.set(p.id, v);
      closeModal();
      resolve(v);
    };
    $("#sp-pat").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#sp-ok").click(); });
  });
}

// ---- arranque ----
renderLanding();
