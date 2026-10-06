const WEAK_WORD = /^(wip|tmp|temp|test|asdf|sdf|foo|bar|baz|xxx|fix|update|misc|stuff|ok|n\/a)$/i;

export function isWeakWorkTitle(title: string | null | undefined): boolean {
  const value = title?.trim() ?? "";
  if (value.length < 4) return true;
  if (!/[a-zA-Z]/.test(value)) return true;
  return WEAK_WORD.test(value);
}

export function cleanWorkTitle(input: {
  title: string;
  kind?: string | null;
  sha?: string | null;
  issueTitle?: string | null;
  pullRequestTitle?: string | null;
}): { title: string; originalTitle: string | null } {
  const fallback = input.issueTitle?.trim() || input.pullRequestTitle?.trim() || "";
  if (!isWeakWorkTitle(input.title)) return { title: input.title, originalTitle: null };
  if (fallback && !isWeakWorkTitle(fallback)) return { title: fallback, originalTitle: input.title };
  if (input.kind === "commit" && input.sha) {
    return { title: `Commit ${input.sha.slice(0, 7)}`, originalTitle: input.title };
  }
  return { title: input.title, originalTitle: isWeakWorkTitle(input.title) ? input.title : null };
}
