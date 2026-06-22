// app.js — Controlador de la SPA "Vitrina".
import * as store from "./store.js";
import * as enc from "./crypto.js";
import { GitHubClient } from "./github.js";
import { assemble } from "./loader.js";

// ---- Estado en memoria (nunca se persiste) ----
let masterKey = null;   // CryptoKey derivada de la passphrase global
let masterSalt = null;  // Uint8Array del salt del vault

const $ = (sel, root = document) => root.querySelector(sel);
const main = () => $("#main");
const modalRoot = () => $("#modal-root");
const viewerRoot = () => $("#viewer-root");

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function closeModal() { modalRoot().innerHTML = ""; }

async function getToken(profile) {
  if (!profile.patEnc) throw new Error("Este perfil no tiene PAT guardado.");
  return enc.decrypt(masterKey, profile.patEnc);
}

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
  masterKey = null; masterSalt = null;
  updateSession(); renderLanding();
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
        <p>Perfiles de un repo concreto o de tipo <em>Owner</em>, que listan todos tus
           repos accesibles con un buscador para entrar o crear perfiles al vuelo.</p>
      </div>
      <div class="card feature">
        <h3><span class="ico">◆</span> PAT cifrado</h3>
        <p>El token de cada perfil se guarda cifrado con AES-GCM, protegido por una
           passphrase global que solo vive en memoria durante la sesión.</p>
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
      <li><strong>Añades un perfil</strong> (de un repo, o de tipo Owner para explorar).</li>
      <li><strong>Vitrina descarga el repo</strong> vía la API de GitHub y lo reensambla
        en el navegador (Tier 1.5: inline + shim de runtime).</li>
      <li><strong>Se muestra en un iframe</strong> con el aislamiento que elijas por perfil.</li>
    </ol>

    <h2>Modos de aislamiento</h2>
    <div class="grid cols-3">
      <div class="card">
        <h3><span class="badge aislado">Aislado</span></h3>
        <p class="muted" style="font-size:14px;margin:8px 0 0">Para apps de solo
          visualización. El iframe corre con origen opaco: el código cargado
          <strong>no puede leer tu PAT</strong>.</p>
      </div>
      <div class="card">
        <h3><span class="badge confianza">Confianza</span></h3>
        <p class="muted" style="font-size:14px;margin:8px 0 0">Para apps que necesitan
          su propio almacenamiento. Comparten origen, así que el código cargado
          <strong>podría leer datos de Vitrina</strong>: úsalo solo con repos tuyos.</p>
      </div>
      <div class="card">
        <h3><span class="ico" style="color:var(--accent)">◆</span> Tier 1.5</h3>
        <p class="muted" style="font-size:14px;margin:8px 0 0">Sitios estáticos y apps
          que leen archivos del repo en runtime (<code>fetch</code>/XHR) funcionan vía
          un shim. Módulos ES y Service Workers aún no: Vitrina te avisa.</p>
      </div>
    </div>

    <div class="alert info" style="margin-top:24px">
      <strong>Seguridad.</strong> Usa siempre un fine-grained PAT de solo lectura,
      con el mínimo de repos y expiración corta. El PAT se guarda cifrado, pero Vitrina
      es estática y pública: si un token se ve comprometido, revócalo en GitHub.
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
      closeModal(); updateSession(); renderManager();
    } catch (e) {
      showErr("Error: " + e.message);
    }
  };
}

// ======================================================================
// Gestor de perfiles
// ======================================================================
function renderManager() {
  viewerRoot().classList.add("hidden");
  viewerRoot().innerHTML = "";
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
        ? `<div class="empty">Aún no tienes perfiles.<br>Crea uno de un repo, o uno de tipo <strong>Owner</strong> para explorar todos tus repos.</div>`
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
  const isOwner = p.kind === "owner";
  const noPat = !p.patEnc ? `<span class="badge">sin PAT</span>` : "";
  const sub = isOwner
    ? `Explorador · owner: ${esc(p.owner || "todos los accesibles")}`
    : `${esc(p.owner)}/${esc(p.repo)} · ${esc(p.branch || "rama por defecto")} · ${esc(p.entry)}`;
  return `
    <div class="profile">
      <div class="meta">
        <div class="name">${esc(p.name)}
          ${isOwner ? `<span class="badge">Owner</span>` : `<span class="badge ${p.isolation}">${p.isolation}</span>`}
          ${noPat}
        </div>
        <div class="sub">${sub}</div>
      </div>
      <div class="acts">
        <button class="btn sm primary" data-act="open" data-id="${p.id}">${isOwner ? "Explorar" : "Ver"}</button>
        <button class="btn sm" data-act="edit" data-id="${p.id}">Editar</button>
        <button class="btn sm danger" data-act="delete" data-id="${p.id}">Borrar</button>
      </div>
    </div>`;
}

function deleteProfile(id) {
  const p = store.getProfile(id);
  if (!confirm(`¿Borrar el perfil "${p.name}"?`)) return;
  store.deleteProfile(id);
  renderManager();
}

// ======================================================================
// Editor de perfil
// ======================================================================
function showEditor(profile, prefillToken = "") {
  const isEdit = !!(profile && profile.id); // sin id => perfil nuevo pre-rellenado
  const p = profile || { kind: "repo", isolation: "aislado", branch: "", entry: "index.html" };
  modalRoot().innerHTML = `
    <div class="overlay">
      <div class="modal" style="max-width:560px">
        <h2 style="margin-top:0">${isEdit ? "Editar perfil" : "Nuevo perfil"}</h2>

        <div class="field">
          <label>Tipo de perfil</label>
          <div class="segmented">
            <label><input type="radio" name="kind" value="repo" ${p.kind !== "owner" ? "checked" : ""}>
              <div class="t">Repo único</div>
              <div class="d">Apunta a un repositorio concreto.</div></label>
            <label><input type="radio" name="kind" value="owner" ${p.kind === "owner" ? "checked" : ""}>
              <div class="t">Owner / Explorador</div>
              <div class="d">Lista tus repos accesibles para entrar o crear perfiles.</div></label>
          </div>
        </div>

        <div class="field">
          <label>Nombre</label>
          <input id="f-name" value="${esc(p.name || "")}" placeholder="Mi dashboard interno" />
        </div>

        <div id="repo-fields">
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
                <div class="d">Solo visualización. Origen opaco.</div></label>
              <label><input type="radio" name="iso" value="confianza" ${p.isolation === "confianza" ? "checked" : ""}>
                <div class="t"><span class="badge confianza">Confianza</span></div>
                <div class="d">La app usa storage. Mismo origen.</div></label>
            </div>
          </div>
        </div>

        <div id="owner-fields" class="hidden">
          <div class="field"><label>Owner a explorar <span class="hint">(opcional)</span></label>
            <input id="f-owner2" class="mono" value="${esc(p.owner || "")}" placeholder="(vacío = todos los accesibles)" />
            <span class="hint">Si lo dejas vacío, se listan todos los repos que el PAT pueda ver.</span></div>
        </div>

        <div class="field">
          <label>Personal Access Token</label>
          <input id="f-pat" class="mono" type="password" autocomplete="off" value="${esc(prefillToken)}"
            placeholder="${isEdit && p.patEnc ? "•••••• (déjalo vacío para no cambiarlo)" : "github_pat_..."}" />
          <span class="hint">Se guarda cifrado con tu passphrase global.</span>
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
  const setMsg = (cls, text) => { msg.className = "alert " + cls; msg.innerHTML = text; msg.classList.remove("hidden"); };
  const kindOf = () => modalRoot().querySelector('input[name="kind"]:checked').value;
  const syncKind = () => {
    const owner = kindOf() === "owner";
    $("#repo-fields").classList.toggle("hidden", owner);
    $("#owner-fields").classList.toggle("hidden", !owner);
  };
  modalRoot().querySelectorAll('input[name="kind"]').forEach((r) => (r.onchange = syncKind));
  syncKind();
  $("#ed-cancel").onclick = closeModal;

  const readForm = () => {
    const kind = kindOf();
    return {
      kind, name: $("#f-name").value.trim(),
      owner: (kind === "owner" ? $("#f-owner2").value : $("#f-owner").value).trim(),
      repo: $("#f-repo").value.trim(),
      branch: $("#f-branch").value.trim(),
      entry: $("#f-entry").value.trim() || "index.html",
      isolation: modalRoot().querySelector('input[name="iso"]:checked').value,
      pat: $("#f-pat").value,
    };
  };

  async function resolveTokenForTest(form) {
    if (form.pat) return form.pat;
    if (isEdit && p.patEnc) return getToken(p);
    return null;
  }

  $("#ed-test").onclick = async () => {
    const form = readForm();
    const token = await resolveTokenForTest(form).catch(() => null);
    if (!token) return setMsg("danger", "Introduce un PAT para probar.");
    setMsg("info", "Probando…");
    try {
      const client = new GitHubClient(token);
      const viewer = await client.getViewer();
      if (form.kind === "owner") {
        const repos = await client.listRepos({ owner: form.owner });
        setMsg("ok", `✓ Conectado como <strong>${esc(viewer.login)}</strong>. ${repos.length} repos accesibles${form.owner ? " de " + esc(form.owner) : ""}.`);
      } else {
        if (!form.owner || !form.repo) return setMsg("danger", "Indica owner y repo.");
        const repo = await client.getRepo(form.owner, form.repo);
        setMsg("ok", `✓ Conectado como <strong>${esc(viewer.login)}</strong>. Acceso a <code>${esc(repo.full_name)}</code> (rama: <code>${esc(repo.default_branch)}</code>).`);
      }
    } catch (e) {
      setMsg("danger", "✗ " + esc(e.message));
    }
  };

  $("#ed-save").onclick = async () => {
    const form = readForm();
    if (!form.name) return setMsg("danger", "El nombre es obligatorio.");
    if (form.kind === "repo" && (!form.owner || !form.repo))
      return setMsg("danger", "Owner y repo son obligatorios.");

    const id = isEdit ? p.id : store.newId();
    const next = {
      id, kind: form.kind, name: form.name, owner: form.owner,
      patEnc: isEdit ? p.patEnc || null : null,
      createdAt: isEdit ? p.createdAt : Date.now(),
      lastUsedAt: p.lastUsedAt || 0,
    };
    if (form.kind === "repo") {
      next.repo = form.repo; next.branch = form.branch;
      next.entry = form.entry; next.isolation = form.isolation;
    }

    try {
      if (form.pat) next.patEnc = await enc.encrypt(masterKey, form.pat);
      if (!next.patEnc) return setMsg("danger", "Hace falta un PAT (se guardará cifrado).");
      store.saveProfile(next);
      closeModal(); renderManager();
    } catch (e) {
      setMsg("danger", "Error al guardar: " + esc(e.message));
    }
  };
}

// ======================================================================
// Export / Import
// ======================================================================
function doExport() {
  if (!confirm("La exportación incluye los PAT cifrados de tus perfiles.\nGuárdala en lugar seguro. ¿Continuar?")) return;
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
    masterKey = null;
    alert(`Importados ${n} perfiles. Vuelve a desbloquear con la passphrase correspondiente.`);
    enterManager();
  } catch (err) {
    alert("Error al importar: " + err.message);
  }
}

// ======================================================================
// Navegador de repos (perfil Owner)
// ======================================================================
async function openRepoBrowser(ownerProfile) {
  let token;
  try { token = await getToken(ownerProfile); }
  catch { return alert("No se pudo descifrar el PAT del perfil."); }

  const root = viewerRoot();
  root.classList.remove("hidden");
  root.innerHTML = `
    <div class="viewer-wrap">
      <div class="viewer-bar">
        <button class="btn ghost sm" id="b-back">← Perfiles</button>
        <div><div class="title">${esc(ownerProfile.name)}</div>
          <div class="sub">explorador${ownerProfile.owner ? " · " + esc(ownerProfile.owner) : ""}</div></div>
        <div style="flex:1"></div>
        <label class="muted" style="font-size:12px">Ver como
          <select id="b-mode" style="width:auto;display:inline-block;padding:4px 8px">
            <option value="confianza">Confianza</option>
            <option value="aislado">Aislado</option>
          </select></label>
      </div>
      <div style="padding:14px 16px;border-bottom:1px solid var(--border)">
        <input id="b-search" placeholder="Buscar por nombre, owner, descripción, lenguaje…" autofocus />
      </div>
      <div class="frame-host" id="b-list" style="background:var(--bg);overflow:auto">
        <div class="loading"><div style="text-align:center">
          <div class="spin"></div><div class="progress-msg">Cargando repos…</div></div></div>
      </div>
    </div>`;
  $("#b-back").onclick = renderManager;

  let repos = [];
  try {
    repos = await new GitHubClient(token).listRepos({ owner: ownerProfile.owner });
  } catch (e) {
    $("#b-list").innerHTML = `<div class="loading"><div style="text-align:center;max-width:420px">
      <p style="color:var(--danger);font-weight:600">No se pudieron listar los repos</p>
      <p class="muted">${esc(e.message)}</p></div></div>`;
    return;
  }
  store.touchProfile(ownerProfile.id);

  // Orden: con Pages primero, luego por actividad reciente.
  repos.sort((a, b) =>
    (b.has_pages - a.has_pages) ||
    (new Date(b.pushed_at) - new Date(a.pushed_at))
  );

  const listEl = $("#b-list");
  const render = (items) => {
    if (!items.length) {
      listEl.innerHTML = `<div class="empty" style="margin:24px">Sin coincidencias.</div>`;
      return;
    }
    listEl.innerHTML = `<div class="profiles" style="padding:14px 16px">
      ${items.map(repoRow).join("")}</div>`;
    listEl.querySelectorAll("[data-act]").forEach((btn) => {
      const repo = items[+btn.dataset.i];
      btn.onclick = () => {
        if (btn.dataset.act === "view") {
          launchViewer(
            { id: "ephemeral", kind: "repo", name: repo.name, owner: repo.owner.login,
              repo: repo.name, branch: repo.default_branch, entry: "index.html",
              isolation: $("#b-mode").value },
            token,
            { onBack: () => openRepoBrowser(ownerProfile) }
          );
        } else {
          showEditor(
            { kind: "repo", name: repo.name, owner: repo.owner.login, repo: repo.name,
              branch: "", entry: "index.html", isolation: $("#b-mode").value, patEnc: null },
            token // reutiliza el PAT del perfil Owner; el usuario puede cambiarlo
          );
        }
      };
    });
  };

  // Buscador "inteligente": todos los tokens deben aparecer en el texto del repo.
  const haystack = (r) =>
    `${r.full_name} ${r.description || ""} ${r.language || ""} ${r.private ? "private" : "public"} ${r.has_pages ? "pages" : ""}`.toLowerCase();
  const filter = (q) => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    return repos.filter((r) => tokens.every((t) => haystack(r).includes(t)));
  };

  const search = $("#b-search");
  search.oninput = () => render(filter(search.value));
  render(repos);
}

function repoRow(r, i) {
  const badges = [
    r.private ? `<span class="badge">privado</span>` : `<span class="badge">público</span>`,
    r.has_pages ? `<span class="badge aislado">pages</span>` : "",
    r.language ? `<span class="badge">${esc(r.language)}</span>` : "",
  ].join(" ");
  return `
    <div class="profile">
      <div class="meta">
        <div class="name">${esc(r.full_name)} ${badges}</div>
        <div class="sub">${esc(r.description || "—")}</div>
      </div>
      <div class="acts">
        <button class="btn sm primary" data-act="view" data-i="${i}">Ver</button>
        <button class="btn sm" data-act="create" data-i="${i}">Crear perfil</button>
      </div>
    </div>`;
}

// ======================================================================
// Visor
// ======================================================================
async function openViewer(id) {
  const p = store.getProfile(id);
  if (!p) return;
  if (p.kind === "owner") return openRepoBrowser(p);

  let token;
  try { token = await getToken(p); }
  catch { return alert("No se pudo descifrar el PAT. ¿Passphrase correcta? ¿El perfil tiene PAT?"); }

  let branch = p.branch;
  if (!branch) {
    try { branch = (await new GitHubClient(token).getRepo(p.owner, p.repo)).default_branch; }
    catch (e) { return alert("Error: " + e.message); }
  }
  store.touchProfile(id);
  launchViewer({ ...p, branch }, token, { onBack: renderManager });
}

async function launchViewer(profile, token, { onBack }) {
  showViewerShell(profile, {
    onBack,
    onReload: () => launchViewer(profile, token, { onBack }),
  });
  const setProgress = (m) => { const el = $("#progress-msg"); if (el) el.textContent = m; };
  try {
    const client = new GitHubClient(token);
    const { html, warnings } = await assemble({ client, profile, onProgress: setProgress });
    mountFrame(profile, html, warnings);
  } catch (e) {
    $("#frame-host").innerHTML =
      `<div class="loading"><div style="text-align:center;max-width:420px">
         <p style="color:var(--danger);font-weight:600">No se pudo cargar el sitio</p>
         <p class="muted">${esc(e.message)}</p>
         <button class="btn" id="back-btn">← Volver</button></div></div>`;
    $("#back-btn").onclick = onBack;
  }
}

function showViewerShell(p, { onBack, onReload }) {
  const root = viewerRoot();
  root.classList.remove("hidden");
  root.innerHTML = `
    <div class="viewer-wrap">
      <div class="viewer-bar">
        <button class="btn ghost sm" id="v-back">←</button>
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
  $("#v-back").onclick = onBack;
  $("#v-reload").onclick = onReload;
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

// ---- arranque ----
renderLanding();
