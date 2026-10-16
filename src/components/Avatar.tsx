import { isAvatarDataUrl } from '@/utils/avatar';

/** Profile picture (validated JPEG data URL) or the first letter of the name on a coloured circle. */
export function Avatar({ name, src, size = 32, online }: { name: string | null; src?: string | null; size?: number; online?: boolean }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.45) };
  const face = isAvatarDataUrl(src)
    ? <img className="avatar" src={src} alt="" width={size} height={size} style={style} />
    : <span className="avatar letter" aria-hidden style={style}>{(name?.trim()[0] ?? '?').toUpperCase()}</span>;
  if (online === undefined) return face;
  return <span className="avatar-wrap">{face}<i className={`presence-dot ${online ? 'on' : 'off'}`} data-testid={online ? 'presence-online' : 'presence-offline'} aria-hidden /></span>;
}
