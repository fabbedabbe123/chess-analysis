import { isAvatarDataUrl } from '@/utils/avatar';

/** Profile picture (validated JPEG data URL) or the first letter of the name on a coloured circle. */
export function Avatar({ name, src, size = 32 }: { name: string | null; src?: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.45) };
  if (isAvatarDataUrl(src)) return <img className="avatar" src={src} alt="" width={size} height={size} style={style} />;
  return <span className="avatar letter" aria-hidden style={style}>{(name?.trim()[0] ?? '?').toUpperCase()}</span>;
}
