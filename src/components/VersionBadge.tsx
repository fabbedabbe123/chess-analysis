/** The build marker (commit + build time), shown in Help → About so it can be quoted in bug reports. */
export function VersionLine() {
  const id = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
  return <p className="muted small-print" data-testid="version-badge">Version: {id} (commit and build time)</p>;
}
