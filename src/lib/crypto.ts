/** Client-side demo hashing. The production backend uses bcrypt; this keeps passwords out of storage in plain text. */
export async function hashPassword(username: string, password: string) {
  const text = `rexera:${username.toLowerCase()}:${password}`
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Fallback for non-secure contexts (plain-http LAN address).
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return 'fnv' + (h >>> 0).toString(16)
}
