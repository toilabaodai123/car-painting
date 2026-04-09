package kafka

import "context"

type contextKey int

const (
	ctxTransactionID contextKey = iota
	ctxMessageID
	ctxSourceID
	ctxURI
)

func WithTransactionID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxTransactionID, id)
}

func TransactionIDFrom(ctx context.Context) string {
	v, _ := ctx.Value(ctxTransactionID).(string)
	return v
}

func WithMessageID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxMessageID, id)
}

func MessageIDFrom(ctx context.Context) string {
	v, _ := ctx.Value(ctxMessageID).(string)
	return v
}

func WithSourceID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxSourceID, id)
}

func SourceIDFrom(ctx context.Context) string {
	v, _ := ctx.Value(ctxSourceID).(string)
	return v
}

func WithURI(ctx context.Context, uri string) context.Context {
	return context.WithValue(ctx, ctxURI, uri)
}

func URIFrom(ctx context.Context) string {
	v, _ := ctx.Value(ctxURI).(string)
	return v
}
