// github.js — Capa de acceso abstracta a GitHub.
// El resto de la app pide "el árbol" o "este archivo" sin saber CÓMO se obtiene.
// Hoy lo resuelve la API REST con el PAT en el header (Tier 1). Mañana, este mismo
// contrato puede implementarlo un Service Worker (Tier 2) sin tocar la UI.

const API = "https://api.github.com";

export class GitHubClient {
  constructor(token) {
    this.token = token;
  }

  get headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async _json(path) {
    const res = await fetch(`${API}${path}`, {
      headers: { ...this.headers, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw await toError(res);
    return res.json();
  }

  // Valida acceso y devuelve metadatos básicos del repo (incl. rama por defecto).
  async getRepo(owner, repo) {
    return this._json(`/repos/${owner}/${repo}`);
  }

  // Información del usuario/token autenticado (para "Probar conexión").
  async getViewer() {
    return this._json(`/user`);
  }

  // Estado del rate limit autenticado.
  async getRateLimit() {
    return this._json(`/rate_limit`);
  }

  // Lista recursiva de archivos de una rama: [{path, type, size, sha}].
  async getTree(owner, repo, branch) {
    const data = await this._json(
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    );
    if (data.truncated) {
      console.warn("Vitrina: el árbol del repo está truncado (repo muy grande).");
    }
    return (data.tree || []).filter((n) => n.type === "blob");
  }

  // Contenido crudo de un archivo como ArrayBuffer (sirve texto y binario).
  async getFileBytes(owner, repo, path, ref) {
    const res = await fetch(
      `${API}/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`,
      { headers: { ...this.headers, Accept: "application/vnd.github.raw" } }
    );
    if (!res.ok) throw await toError(res);
    return res.arrayBuffer();
  }
}

async function toError(res) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body.message ? ` — ${body.message}` : "";
  } catch {
    /* sin cuerpo JSON */
  }
  const messages = {
    401: "PAT no válido o caducado (401).",
    403: "Acceso denegado o límite de peticiones alcanzado (403).",
    404: "Repo, rama o archivo no encontrado, o el PAT no tiene acceso (404).",
  };
  return new Error((messages[res.status] || `Error HTTP ${res.status}`) + detail);
}
