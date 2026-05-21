export function isPasswordValid(password: string) {
  return password.length >= 6;
}

export async function hashPassword(password: string) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure password hashing requires localhost or HTTPS.");
  }
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}