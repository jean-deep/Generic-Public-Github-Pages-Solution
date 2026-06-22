// loader.js — Tier 1: descarga el repo y lo reensambla "inline" en un único
// documento HTML (srcdoc). Para repos pequeños es robusto y evita el problema
// de los blob: URLs cross-origin en iframes sandbox de origen opaco.
//
// El visor decide los flags de sandbox según el modo del perfil:
//   aislado   -> allow-scripts            (origen opaco, PAT cifrado seguro)
//   confianza -> allow-scripts allow-same-origin allow-forms allow-popups
//
// Limitación conocida (Tier 1): peticiones en runtime (fetch/XHR), módulos ES con
// imports sin resolver y Service Workers NO funcionan. Se detectan y se avisa.

const MIME = {
  html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript",
  mjs: "text/javascript", json: "application/json", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", ico: "image/x-icon", bmp: "image/bmp",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  eot: "application/vnd.ms-fontobject", mp4: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav", txt: "text/plain",
};

function ext(path) {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : "";
}
function mimeOf(path) {
  return MIME[ext(path)] || "application/octet-stream";
}
function isExternal(ref) {
  return /^(https?:|data:|mailto:|tel:|#|javascript:)/i.test(ref);
}

export async function assemble({ client, profile, onProgress }) {
  const { owner, repo, branch, entry } = profile;
  const report = (msg) => onProgress && onProgress(msg);

  report("Listando archivos del repo…");
  const tree = await client.getTree(owner, repo, branch);
  const available = new Set(tree.map((n) => n.path));

  const textCache = new Map(); // path -> string
  const dataCache = new Map(); // path -> "data:...;base64,..."
  const dec = new TextDecoder();

  async function getBytes(path) {
    report(`Descargando ${path}…`);
    return client.getFileBytes(owner, repo, path, branch);
  }
  async function getText(path) {
    if (textCache.has(path)) return textCache.get(path);
    const text = dec.decode(await getBytes(path));
    textCache.set(path, text);
    return text;
  }
  async function getDataUri(path) {
    if (dataCache.has(path)) return dataCache.get(path);
    const bytes = new Uint8Array(await getBytes(path));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const uri = `data:${mimeOf(path)};base64,${btoa(binary)}`;
    dataCache.set(path, uri);
    return uri;
  }

  // Resuelve una referencia relativa a una ruta del repo. Devuelve null si es
  // externa o no existe en el árbol.
  function resolve(ref, baseDir) {
    if (!ref || isExternal(ref)) return null;
    try {
      const base = `https://repo.local/${baseDir ? baseDir + "/" : ""}`;
      const path = new URL(ref.split("?")[0].split("#")[0], base).pathname.slice(1);
      return available.has(path) ? path : null;
    } catch {
      return null;
    }
  }
  function dirOf(path) {
    const i = path.lastIndexOf("/");
    return i >= 0 ? path.slice(0, i) : "";
  }

  // --- CSS: inlinar url(...) y @import recursivamente ---
  async function inlineCss(cssText, cssDir, depth = 0) {
    if (depth > 5) return cssText;
    // @import
    const imports = [...cssText.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s]+)['"]?\s*\)?[^;]*;/gi)];
    for (const m of imports) {
      const p = resolve(m[1], cssDir);
      const replacement = p
        ? await inlineCss(await getText(p), dirOf(p), depth + 1)
        : "";
      cssText = cssText.replace(m[0], replacement);
    }
    // url(...)
    const urls = [...cssText.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)];
    for (const m of urls) {
      const p = resolve(m[2], cssDir);
      if (p) cssText = cssText.replace(m[0], `url("${await getDataUri(p)}")`);
    }
    return cssText;
  }

  if (!available.has(entry)) {
    throw new Error(`El archivo de entrada "${entry}" no existe en ${branch}.`);
  }

  report("Ensamblando el sitio…");
  const html = await getText(entry);
  const entryDir = dirOf(entry);
  const doc = new DOMParser().parseFromString(html, "text/html");

  // <link rel=stylesheet> y <link rel=icon> -> inline
  for (const link of [...doc.querySelectorAll("link[href]")]) {
    const rel = (link.getAttribute("rel") || "").toLowerCase();
    const p = resolve(link.getAttribute("href"), entryDir);
    if (!p) continue;
    if (rel.includes("stylesheet")) {
      const style = doc.createElement("style");
      style.textContent = await inlineCss(await getText(p), dirOf(p));
      link.replaceWith(style);
    } else if (rel.includes("icon")) {
      link.setAttribute("href", await getDataUri(p));
    }
  }

  // <style> inline -> procesar url()
  for (const style of [...doc.querySelectorAll("style")]) {
    style.textContent = await inlineCss(style.textContent || "", entryDir);
  }

  // <script src> -> inline
  for (const script of [...doc.querySelectorAll("script[src]")]) {
    const p = resolve(script.getAttribute("src"), entryDir);
    if (!p) continue;
    const inline = doc.createElement("script");
    const type = script.getAttribute("type");
    if (type) inline.setAttribute("type", type);
    inline.textContent = await getText(p);
    script.replaceWith(inline);
  }

  // src / poster / etc. -> data URI
  for (const el of [...doc.querySelectorAll("[src]")]) {
    const p = resolve(el.getAttribute("src"), entryDir);
    if (p) el.setAttribute("src", await getDataUri(p));
  }
  for (const el of [...doc.querySelectorAll("[poster]")]) {
    const p = resolve(el.getAttribute("poster"), entryDir);
    if (p) el.setAttribute("poster", await getDataUri(p));
  }

  // Detección de peligros de runtime (Tier 1 no los soporta).
  const warnings = detectHazards(doc, html);

  return { html: "<!DOCTYPE html>\n" + doc.documentElement.outerHTML, warnings };
}

function detectHazards(doc, rawHtml) {
  const warnings = [];
  const scripts = [...doc.querySelectorAll("script")]
    .map((s) => s.textContent || "")
    .join("\n");
  if (/\bfetch\s*\(|XMLHttpRequest|EventSource\b/.test(scripts)) {
    warnings.push("La app hace peticiones de red en runtime; no funcionarán en modo Tier 1.");
  }
  if (/serviceWorker\b/.test(scripts)) {
    warnings.push("La app registra un Service Worker; no está soportado en Tier 1.");
  }
  if (/\bimport\s*\(|type=["']module["']/.test(rawHtml)) {
    warnings.push("La app usa módulos ES; los imports sin resolver pueden fallar.");
  }
  return warnings;
}
