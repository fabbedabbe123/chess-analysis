/** Tiny build marker in the bottom-right corner (commit + build time) so you can see which version is loaded. */
export function VersionBadge() {
  const id = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
  return (
    <div className="version-badge" data-testid="version-badge" title="Version of this page: commit and build time">
      {id}
    </div>
  );
}
