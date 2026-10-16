/** Usernames: 3-20 characters, letters, digits and underscore. Unique ignoring case (the database enforces it). */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
const USERNAME_RE = /^[A-Za-z0-9_]+$/;
/** Same list as the database check; the database is the real guard, this just gives an instant message. */
export const RESERVED_NAMES: readonly string[] = ['admin', 'administrator', 'support', 'moderator', 'staff', 'root', 'system', 'stockfish', 'chess', 'lichess', 'chesscom', 'official', 'anonymous', 'null', 'undefined'];

/** Returns an explanation of what is wrong with a username, or null when it is acceptable. */
export function usernameProblem(name: string): string | null {
  if (name.length < USERNAME_MIN) return `At least ${USERNAME_MIN} characters.`;
  if (name.length > USERNAME_MAX) return `At most ${USERNAME_MAX} characters.`;
  if (!USERNAME_RE.test(name)) return 'Only letters A-Z, digits and underscore (_).';
  if (RESERVED_NAMES.includes(name.toLowerCase())) return 'That name is reserved.';
  return null;
}

export interface Profile { username: string; createdAt: number; avatar: string | null }
