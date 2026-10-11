const base = new URL('./', import.meta.url);
let delivery;
async function manifest() {
  if (!delivery) delivery = fetch(new URL('delivery-manifest.json', base)).then(async response => response.ok ? response.json() : {}).catch(() => ({}));
  return delivery;
}
export async function assetBytes(path) {
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('Builder assets must belong to this published snapshot.');
  const key = decodeURIComponent(url.pathname.slice(base.pathname.length)), mapping = await manifest();
  const item = (mapping.files || mapping)[key];
  if (!item?.parts) { const response = await fetch(url); if (!response.ok) throw new Error(`Asset unavailable (${response.status}): ${key}`); return { buffer: await response.arrayBuffer(), mime: response.headers.get('content-type') || 'application/octet-stream' }; }
  if (!Number.isInteger(item.size) || item.size < 0 || item.size > 512_000_000 || !Array.isArray(item.parts)) throw new Error(`Invalid delivery manifest: ${key}`);
  const parts = await Promise.all(item.parts.map(async part => { const response = await fetch(new URL(part, base)); if (!response.ok) throw new Error(`Asset chunk unavailable: ${part}`); return new Uint8Array(await response.arrayBuffer()); }));
  const storedSize = item.storedSize ?? item.size;
  const buffer = new Uint8Array(storedSize); let offset = 0;
  for (const part of parts) { if (offset + part.length > buffer.length) throw new Error(`Asset length mismatch: ${key}`); buffer.set(part, offset); offset += part.length; }
  if (offset !== buffer.length) throw new Error(`Incomplete asset: ${key}`);
  let restored = buffer.buffer;
  if (item.encoding) {
    if (item.encoding !== 'gzip' || typeof DecompressionStream === 'undefined') throw new Error(`This browser cannot decode ${item.encoding} snapshot assets.`);
    restored = await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  if (restored.byteLength !== item.size) throw new Error(`Decoded asset length mismatch: ${key}`);
  return { buffer: restored, mime: item.mime || 'application/octet-stream' };
}
export async function assetJSON(path) { return JSON.parse(new TextDecoder().decode((await assetBytes(path)).buffer)); }
export function typedArray(buffer, descriptor) {
  if (!descriptor) return null;
  const Type = { Float32Array, Uint32Array, Uint16Array, Uint8Array, Int32Array }[descriptor.type];
  if (!Type || !Number.isInteger(descriptor.offset) || !Number.isInteger(descriptor.length) || descriptor.offset < 0 || descriptor.length < 0 || descriptor.offset % Type.BYTES_PER_ELEMENT || descriptor.offset + descriptor.length * Type.BYTES_PER_ELEMENT > buffer.byteLength) throw new Error('Invalid mesh-buffer descriptor.');
  return new Type(buffer, descriptor.offset, descriptor.length);
}
export const assetPath = path => path.startsWith('browser_data/') ? path : `browser_data/${path}`;
export function cachedLoad(cache, key, loader) {
  if (!cache.has(key)) {
    const pending = Promise.resolve().then(loader); cache.set(key, pending);
    pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
  }
  return cache.get(key);
}
