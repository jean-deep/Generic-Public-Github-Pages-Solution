# Vitrina

**Una webapp estática, publicable en GitHub Pages, que muestra el contenido de tus repos _privados_** usando un Personal Access Token (PAT). Sin servidor ni backend: todo ocurre en el navegador.

> La necesidad es la madre de la creación. Si no puedes (o no quieres) servir webapps desde repos públicos, Vitrina las sirve desde repos privados a través de una única página pública.

## ¿Cómo funciona?

A diferencia de lo que parece intuitivo, **no se puede** apuntar un `<iframe src>` a las Pages de un repo privado con un PAT: el navegador no permite autenticar una navegación con un header, y las Pages de repos privados no se sirven públicamente. La táctica de Vitrina es otra:

1. Descarga los archivos del repo privado vía la **API REST de GitHub** (`fetch` con el PAT en el header `Authorization`).
2. Reensambla el sitio **en el navegador** (modo **Tier 1**: inline de CSS/JS/imágenes en un único documento).
3. Lo renderiza dentro de un **iframe** con el aislamiento que elijas.

Esto funciona **incluso con repos privados de cuentas gratuitas**, donde las Pages privadas ni siquiera están disponibles.

## Perfiles

Vitrina guarda múltiples **perfiles** en `localStorage`. Cada perfil apunta a un repo (`owner`, `repo`, `rama`, `archivo de entrada`) y tiene un **modo de aislamiento**:

| Modo | Para qué | Sandbox del iframe | PAT |
| --- | --- | --- | --- |
| **Aislado** | Apps de solo visualización | `allow-scripts` (origen opaco) | **Cifrado** con tu passphrase global y persistido |
| **Confianza** | Apps que necesitan `localStorage`/cookies propios | `allow-scripts allow-same-origin …` | **Solo de sesión** (no se guarda) |

El modo *Aislado* mantiene el iframe en un origen opaco, así que el código cargado **no puede leer tu PAT**. El modo *Confianza* comparte origen para que la app tenga su propio almacenamiento; a cambio el PAT nunca se persiste y se pide cada sesión.

## Seguridad

- Usa siempre un **fine-grained PAT de solo lectura** con permiso `Contents: Read-only`, limitado a los repos necesarios y con **expiración corta**.
- El PAT viaja **solo a `api.github.com`**, siempre por header, nunca en la URL.
- Una **passphrase global** (PBKDF2 + AES-GCM, vía Web Crypto) cifra los PAT de los perfiles *Aislado*. La clave vive **solo en memoria** durante la sesión; no se guarda nunca.
- Vitrina es una página estática y pública: trátala como tal. Si un token se ve comprometido, **revócalo en GitHub**.

## Cómo crear el fine-grained PAT

1. GitHub → *Settings* → *Developer settings* → *Personal access tokens* → **Fine-grained tokens**.
2. *Resource owner*: tu cuenta u organización.
3. *Repository access*: solo los repos que vayas a mostrar.
4. *Permissions* → *Repository permissions* → **Contents: Read-only**.
5. Define una expiración corta y genera el token.

## Carga en tiempo de ejecución (Tier 1.5)

Vitrina descarga **todos** los archivos del repo a un sistema de archivos virtual
(VFS) en memoria e inyecta un **shim de `fetch` y `XMLHttpRequest`** al principio del
iframe. Así, cuando la app pide un archivo del repo en runtime —por ejemplo
`fetch('urls.json?t=...')`— el shim lo resuelve desde el VFS **sin red y sin servidor**,
incluso en modo *Aislado* (origen opaco). Las peticiones a orígenes externos pasan a la
red real con normalidad.

### Compatibilidad

| Patrón de la app | Estado |
| --- | --- |
| Sitios estáticos (HTML/CSS/JS, imágenes, fuentes) | ✅ |
| `fetch`/`XHR` de archivos del propio repo en runtime | ✅ (vía shim) |
| `localStorage`/cookies propios | ✅ en modo **Confianza** |
| Llamadas a APIs externas | ⚠️ pasan a la red; dependen de CORS y de tus credenciales |
| Módulos ES con `import` relativos | ⚠️ el cargador del navegador no pasa por el shim |
| Service Workers | ❌ no soportado |

Vitrina **detecta y avisa** de los casos ⚠️/❌. La evolución prevista es el **Tier 2**
(un Service Worker que intercepta las peticiones del iframe y las proxia a la API de
GitHub), que cubriría también módulos ES y navegación entre páginas. La capa
`assets/github.js` es el punto de cambio para esa migración sin tocar la interfaz.

## Estructura

```
index.html            Shell de la SPA (landing + gestor + visor)
assets/
  app.js              Controlador de la interfaz
  store.js            Persistencia de perfiles y vault en localStorage
  crypto.js           PBKDF2 + AES-GCM (cifrado del PAT)
  github.js           Capa de acceso a la API de GitHub (swap point para Tier 2)
  loader.js           Tier 1.5: descarga + reensamblado + VFS y shim de runtime
  styles.css          Tema visual
```

## Despliegue

Es estática: súbela a GitHub Pages (rama `main`, carpeta raíz) o a cualquier host de estáticos. No requiere build.

## Uso local

Al ser módulos ES, ábrela con un servidor estático (no `file://`):

```sh
python3 -m http.server 8000
# luego abre http://localhost:8000
```
