/** GitHub REST `/repos/{owner}/{repo}/commits` returns 409 when the repository has no commits yet. */
export function isGitHubEmptyRepositoryError(error: unknown): boolean {
  const message = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : null;
  if (!message || !/Git Repository is empty/i.test(message)) return false;
  // Capability errors are joined with "; ". Treat the whole string as benign only when every part is empty-repo noise.
  const leftovers = message
    .split(/;\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/Git Repository is empty/i.test(part));
  return leftovers.length === 0;
}

export function sanitizeGitHubSyncError(error: string | null | undefined): string | null {
  if (!error) return null;
  return isGitHubEmptyRepositoryError(error) ? null : error;
}
