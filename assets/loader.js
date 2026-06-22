// loader.js — Tier 1.5: descarga TODO el repo a un sistema de archivos virtual
// (VFS), reensambla el HTML "inline" y, además, inyecta un shim de fetch/XHR que
// sirve los archivos del repo desde memoria en tiempo de ejecución.
//
// Esto permite que apps que hacen `fetch('datos.json')` en runtime funcionen sin
// servidor y sin red — incluso en modo "aislado" (origen opaco), porque el shim
// responde desde el VFS. Las peticiones a orígenes externos pasan a la red real.
//
// El visor decide los flags de sandbox según el modo del perfil:
//   aislado   -> allow-scripts            (origen opaco, PAT cifrado seguro)
//   confianza -> allow-scripts allow-same-origin allow-forms allow-popups
//
// Limitaciones (Tier 1.5): los `import` de módulos ES y los Service Workers usan
// el cargador del navegador, no fetch/XHR, así que el shim no los cubre. Se avisa.

const MAX_FILE = 3 * 1024 * 1024;   // no meter al VFS archivos > 3 MB
const MAX_TOTAL = 16 * 1024 * 1024; // tope total del VFS inyectado
const CONCURRENCY = 8;

const MIME = {
  html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript",
  mjs: "text/javascript", json: "application/json", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", ico: "image/x-icon", bmp: "image/bmp",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  eot: "application/vnd.ms-fontobject", mp4: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav", txt: "text/plain", csv: "text/csv",
  md: "text/markdown", xml: "application/xml", wasm: "application/wasm",
};

function ext(path) {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : "";
}
function mimeOf(path) {
  return MIME[ext(path)] || "application/octet-stream";
}
function isExternal(ref) {
  return /^(https?:|data:|mailto:|tel:|#|javascript:|\/\/)/i.test(ref);
}
function bytesToB64(bytes) {
  let binary = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(binary);
}

export async function assemble({ client, profile, onProgress }) {
  const { owner, repo, branch, entry } = profile;
  const report = (msg) => onProgress && onProgress(msg);
  const dec = new TextDecoder();

  report("Listando archivos del repo…");
  const tree = await client.getTree(owner, repo, branch);
  const available = new Set(tree.map((n) => n.path));
  if (!available.has(entry)) {
    throw new Error(`El archivo de entrada "${entry}" no existe en ${branch}.`);
  }

  // --- Descarga concurrente de todos los archivos a un caché de bytes ---
  report(`Descargando ${tree.length} archivos…`);
  const cache = new Map(); // path -> Uint8Array
  const queue = tree.filter((n) => (n.size ?? 0) <= MAX_FILE).map((n) => n.path);
  let done = 0;
  async function worker() {
    while (queue.length) {
      const path = queue.shift();
      try {
        cache.set(path, new Uint8Array(await client.getFileBytes(owner, repo, path, branch)));
      } catch (e) {
        console.warn("Vitrina: no se pudo descargar", path, e.message);
      }
      report(`Descargando… ${++done}/${tree.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const getText = (path) => dec.decode(cache.get(path));
  const getDataUri = (path) => `data:${mimeOf(path)};base64,${bytesToB64(cache.get(path))}`;
  const has = (path) => cache.has(path);

  function dirOf(path) {
    const i = path.lastIndexOf("/");
    return i >= 0 ? path.slice(0, i) : "";
  }
  function resolve(ref, baseDir) {
    if (!ref || isExternal(ref)) return null;
    try {
      const base = `https://repo.local/${baseDir ? baseDir + "/" : ""}`;
      const path = new URL(ref.split("?")[0].split("#")[0], base).pathname.slice(1);
      return has(path) ? path : null;
    } catch {
      return null;
    }
  }

  // --- CSS: inlinar url(...) y @import recursivamente ---
  function inlineCss(cssText, cssDir, depth = 0) {
    if (depth > 5) return cssText;
    cssText = cssText.replace(
      /@import\s+(?:url\()?\s*['"]?([^'")\s]+)['"]?\s*\)?[^;]*;/gi,
      (m, ref) => {
        const p = resolve(ref, cssDir);
        return p ? inlineCss(getText(p), dirOf(p), depth + 1) : "";
      }
    );
    cssText = cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, ref) => {
      const p = resolve(ref, cssDir);
      return p ? `url("${getDataUri(p)}")` : m;
    });
    return cssText;
  }

  report("Ensamblando el sitio…");
  const entryDir = dirOf(entry);
  const doc = new DOMParser().parseFromString(getText(entry), "text/html");
  const rawHtml = getText(entry);

  for (const link of [...doc.querySelectorAll("link[href]")]) {
    const rel = (link.getAttribute("rel") || "").toLowerCase();
    const p = resolve(link.getAttribute("href"), entryDir);
    if (!p) continue;
    if (rel.includes("stylesheet")) {
      const style = doc.createElement("style");
      style.textContent = inlineCss(getText(p), dirOf(p));
      link.replaceWith(style);
    } else if (rel.includes("icon")) {
      link.setAttribute("href", getDataUri(p));
    }
  }
  for (const style of [...doc.querySelectorAll("style")]) {
    style.textContent = inlineCss(style.textContent || "", entryDir);
  }
  for (const script of [...doc.querySelectorAll("script[src]")]) {
    const p = resolve(script.getAttribute("src"), entryDir);
    if (!p) continue;
    const inline = doc.createElement("script");
    const type = script.getAttribute("type");
    if (type) inline.setAttribute("type", type);
    inline.textContent = getText(p);
    script.replaceWith(inline);
  }
  for (const el of [...doc.querySelectorAll("[src]")]) {
    const p = resolve(el.getAttribute("src"), entryDir);
    if (p) el.setAttribute("src", getDataUri(p));
  }
  for (const el of [...doc.querySelectorAll("[poster]")]) {
    const p = resolve(el.getAttribute("poster"), entryDir);
    if (p) el.setAttribute("poster", getDataUri(p));
  }

  // --- Construir el VFS para el shim de runtime ---
  const fs = {};
  let total = 0;
  for (const [path, bytes] of cache) {
    if (total + bytes.length > MAX_TOTAL) {
      console.warn("Vitrina: VFS truncado por tamaño en", path);
      break;
    }
    total += bytes.length;
    fs[path] = { t: mimeOf(path), b: bytesToB64(bytes) };
  }

  // Inyectar el shim como primer hijo de <head> (corre antes que el código de la app).
  const boot = doc.createElement("script");
  boot.textContent = shimSource(fs, entryDir);
  const head = doc.querySelector("head") || doc.documentElement;
  head.insertBefore(boot, head.firstChild);

  const warnings = detectHazards(doc, rawHtml);
  return { html: "<!DOCTYPE html>\n" + doc.documentElement.outerHTML, warnings };
}

// Código del shim que se ejecuta DENTRO del iframe. Sobrescribe fetch y
// XMLHttpRequest para servir archivos del repo desde el VFS inyectado.
function shimSource(fs, entryDir) {
  return `(function(){
  var FS = ${JSON.stringify(fs)};
  var DIR = ${JSON.stringify(entryDir)};
  function b64(s){var b=atob(s),n=b.length,a=new Uint8Array(n);for(var i=0;i<n;i++)a[i]=b.charCodeAt(i);return a;}
  function norm(p){var s=p.split('/'),o=[];for(var i=0;i<s.length;i++){var x=s[i];if(x===''||x==='.')continue;if(x==='..')o.pop();else o.push(x);}return o.join('/');}
  function toPath(u){
    if(!u) return null; u=String(u).split('#')[0].split('?')[0];
    if(/^about:/.test(u)) u=u.replace(/^about:[^/]*/,'');
    else if(/^[a-z]+:\\/\\//i.test(u)||u.slice(0,2)==='//'||u.slice(0,5)==='data:') return null;
    var base=u.charAt(0)==='/'?'':(DIR?DIR+'/':'');
    return norm(base+u);
  }
  var hit=function(u){var p=toPath(u);return (p&&FS[p])?{p:p,f:FS[p]}:null;};
  var of=window.fetch?window.fetch.bind(window):null;
  window.fetch=function(input,init){
    try{var u=(input&&typeof input==='object'&&'url' in input)?input.url:input;var h=hit(u);
      if(h){return Promise.resolve(new Response(b64(h.f.b),{status:200,statusText:'OK',headers:{'Content-Type':h.f.t}}));}
    }catch(e){}
    if(of)return of(input,init);
    return Promise.reject(new Error('fetch unavailable'));
  };
  var OX=window.XMLHttpRequest;
  function X(){this._m='GET';this._u='';this._hd={};this.readyState=0;this.status=0;this.statusText='';this.responseText='';this.response=null;this.responseType='';this._l={};this.onreadystatechange=null;this.onload=null;this.onerror=null;this.onloadend=null;}
  X.prototype.open=function(m,u){this._m=m;this._u=u;this.readyState=1;if(this.onreadystatechange)this.onreadystatechange({target:this});};
  X.prototype.setRequestHeader=function(k,v){this._hd[k]=v;};
  X.prototype.addEventListener=function(t,cb){(this._l[t]=this._l[t]||[]).push(cb);};
  X.prototype.removeEventListener=function(){};
  X.prototype.getResponseHeader=function(){return null;};
  X.prototype.getAllResponseHeaders=function(){return '';};
  X.prototype.abort=function(){if(this._r)this._r.abort();};
  X.prototype._fire=function(t){var e={target:this};if(this['on'+t])this['on'+t](e);(this._l[t]||[]).forEach(function(cb){cb(e);});};
  X.prototype.send=function(body){
    var self=this,h=hit(this._u);
    if(h){
      var by=b64(h.f.b),tx='';try{tx=new TextDecoder().decode(by);}catch(e){}
      this.status=200;this.statusText='OK';this.responseText=tx;
      this.response=this.responseType==='json'?JSON.parse(tx):this.responseType==='arraybuffer'?by.buffer:this.responseType==='blob'?new Blob([by],{type:h.f.t}):tx;
      this.readyState=4;
      setTimeout(function(){self._fire('readystatechange');self._fire('load');self._fire('loadend');},0);
      return;
    }
    var r=new OX();this._r=r;
    try{r.open(this._m,this._u,true);}catch(e){}
    for(var k in this._hd){try{r.setRequestHeader(k,this._hd[k]);}catch(e){}}
    if(this.responseType)try{r.responseType=this.responseType;}catch(e){}
    r.onreadystatechange=function(){self.readyState=r.readyState;self.status=r.status;self.statusText=r.statusText;try{self.responseText=r.responseText;}catch(e){}try{self.response=r.response;}catch(e){}self._fire('readystatechange');};
    r.onload=function(){self._fire('load');};
    r.onerror=function(){self._fire('error');};
    r.onloadend=function(){self._fire('loadend');};
    try{r.send(body);}catch(e){self._fire('error');}
  };
  window.XMLHttpRequest=X;
})();`;
}

function detectHazards(doc, rawHtml) {
  const warnings = [];
  const scripts = [...doc.querySelectorAll("script")].map((s) => s.textContent || "").join("\n");
  if (/serviceWorker\b/.test(scripts)) {
    warnings.push("La app registra un Service Worker; no está soportado en Tier 1.5.");
  }
  if (/type=["']module["']|\bimport\s+[^(]/.test(rawHtml)) {
    warnings.push("La app usa módulos ES; los imports relativos pueden no resolverse.");
  }
  if (/fetch\s*\(\s*['"`]https?:\/\//.test(scripts)) {
    warnings.push("La app llama a APIs externas; dependerán de CORS y de tus credenciales.");
  }
  return warnings;
}
