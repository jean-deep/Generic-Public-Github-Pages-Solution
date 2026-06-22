// crypto.js — Cifrado del PAT con Web Crypto (PBKDF2 + AES-GCM).
// La passphrase global deriva una clave maestra que vive SOLO en memoria
// durante la sesión. Nunca se persiste la clave ni la passphrase.

const PBKDF2_ITERATIONS = 310000;
const VERIFIER_PLAINTEXT = "vitrina-verifier-v1";

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(length) {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

export function toBase64(bytes) {
  let binary = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Deriva una CryptoKey AES-GCM 256 a partir de la passphrase y un salt.
export async function deriveKey(passphrase, saltBytes) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Cifra un texto. Devuelve {iv, ciphertext} en base64.
export async function encrypt(key, plaintext) {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );
  return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

// Descifra {iv, ciphertext}. Lanza si la clave es incorrecta o el dato está corrupto.
export async function decrypt(key, payload) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(payload.iv) },
    key,
    fromBase64(payload.ciphertext)
  );
  return dec.decode(plaintext);
}

// Crea el "verifier" cifrado que permite comprobar la passphrase sin tocar los PAT.
export async function makeVerifier(key) {
  return encrypt(key, VERIFIER_PLAINTEXT);
}

// Comprueba que la clave derivada descifra correctamente el verifier.
export async function checkVerifier(key, verifier) {
  try {
    const out = await decrypt(key, verifier);
    return out === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}
