/** Profile pictures are stored as a small square JPEG data URL inside the profile row (no file storage needed). */
export const AVATAR_PX = 128;
export const AVATAR_MAX_CHARS = 60000; // same limit as the database check
const AVATAR_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

/** Only accept exactly what the database accepts, so nothing but our own JPEGs is ever rendered as an <img>. */
export function isAvatarDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.length <= AVATAR_MAX_CHARS && AVATAR_RE.test(v);
}

/** Crops the picture to a centred square, scales it to 128x128 and encodes a JPEG under the size limit. */
export async function resizeToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') throw new Error('Choose a PNG, JPEG or WebP picture.');
  if (file.size > 15_000_000) throw new Error('That picture is too large (max 15 MB).');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That picture could not be read.');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('This browser cannot process pictures.');
  ctx.fillStyle = '#ffffff'; // JPEG has no transparency
  ctx.fillRect(0, 0, AVATAR_PX, AVATAR_PX);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  bitmap.close();
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (isAvatarDataUrl(url)) return url;
  }
  throw new Error('The picture could not be made small enough.');
}
