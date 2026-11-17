package scan

import "context"

type localOnlyKey struct{}

// LocalOnly marks ctx so a usage scan reads what is on this machine and
// nothing else. Some tools keep their real costs on their own servers, and the
// background service fetches them with the tool's local login. The terminal
// tables and the summary shown before sign-in promise that nothing left the
// machine, so they must not make that request.
func LocalOnly(ctx context.Context) context.Context {
	return context.WithValue(ctx, localOnlyKey{}, true)
}

// IsLocalOnly reports whether ctx was marked by LocalOnly.
func IsLocalOnly(ctx context.Context) bool {
	marked, _ := ctx.Value(localOnlyKey{}).(bool)
	return marked
}
