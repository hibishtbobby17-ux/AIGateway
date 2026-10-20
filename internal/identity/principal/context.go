package principal

import "context"

type Principal struct {
	Subject  string
	TenantID string
	Roles    []string
	Scopes   []string
}

type contextKey struct{}

func WithContext(ctx context.Context, value Principal) context.Context {
	return context.WithValue(ctx, contextKey{}, value)
}

func FromContext(ctx context.Context) (Principal, bool) {
	if ctx == nil {
		return Principal{}, false
	}
	value, ok := ctx.Value(contextKey{}).(Principal)
	return value, ok
}
