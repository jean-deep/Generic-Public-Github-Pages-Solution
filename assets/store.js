// store.js — Persistencia de perfiles y del "vault" (salt + verifier) en localStorage.
// El PAT cifrado (patEnc) de cada perfil vive aquí.

const PROFILES_KEY = "vitrina.profiles.v1";
const VAULT_KEY = "vitrina.vault.v1";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---- Vault (datos para validar la passphrase global) ----

export function getVault() {
  return read(VAULT_KEY, null);
}

export function setVault(vault) {
  write(VAULT_KEY, vault);
}

export function hasVault() {
  return getVault() !== null;
}

// ---- Perfiles ----

export function getProfiles() {
  return read(PROFILES_KEY, []);
}

export function getProfile(id) {
  return getProfiles().find((p) => p.id === id) || null;
}

export function saveProfile(profile) {
  const profiles = getProfiles();
  const idx = profiles.findIndex((p) => p.id === profile.id);
  if (idx >= 0) profiles[idx] = profile;
  else profiles.push(profile);
  write(PROFILES_KEY, profiles);
  return profile;
}

export function deleteProfile(id) {
  write(
    PROFILES_KEY,
    getProfiles().filter((p) => p.id !== id)
  );
}

export function touchProfile(id) {
  const p = getProfile(id);
  if (p) {
    p.lastUsedAt = Date.now();
    saveProfile(p);
  }
}

export function newId() {
  return crypto.randomUUID();
}

// ---- Export / Import ----
// La exportación incluye el PAT cifrado de todos los perfiles. Es sensible:
// quien tenga la passphrase puede descifrarlo. Se avisa en la UI.

export function exportData() {
  return JSON.stringify(
    { version: 1, vault: getVault(), profiles: getProfiles() },
    null,
    2
  );
}

export function importData(jsonText) {
  const data = JSON.parse(jsonText);
  if (!data || !Array.isArray(data.profiles)) {
    throw new Error("Formato de importación no válido.");
  }
  if (data.vault) setVault(data.vault);
  write(PROFILES_KEY, data.profiles);
  return data.profiles.length;
}
