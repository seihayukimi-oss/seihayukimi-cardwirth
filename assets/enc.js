// DLキーでの暗号化（ブラウザの中だけで行う。キーも元のファイルも外へは送らない）
// 形：目印8バイト "CWENC1\0\0" ＋ 塩16 ＋ IV12 ＋ AES-256-GCM の暗号文
export const ENC_ITER = 600000;
const MAGIC = new Uint8Array([0x43, 0x57, 0x45, 0x4e, 0x43, 0x31, 0, 0]);

async function deriveKey(password, salt, iter) {
  const raw = new TextEncoder().encode(String(password).normalize("NFKC"));
  const base = await crypto.subtle.importKey("raw", raw, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iter },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptBytes(plain, password, iter = ENC_ITER) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iter);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(36 + ct.length);
  out.set(MAGIC, 0); out.set(salt, 8); out.set(iv, 24); out.set(ct, 36);
  return out;
}

// キーが違う・壊れているときは Error("bad-key")
export async function decryptBytes(data, password, iter = ENC_ITER) {
  const u = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (u.length < 36 + 16 || MAGIC.some((b, i) => u[i] !== b)) throw new Error("bad-file");
  const key = await deriveKey(password, u.slice(8, 24), iter);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(24, 36) }, key, u.subarray(36)));
  } catch { throw new Error("bad-key"); }
}

export async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
