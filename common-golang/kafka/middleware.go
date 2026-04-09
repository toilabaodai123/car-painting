package kafka

import (
	"context"
	"fmt"
	"log/slog"
	"runtime/debug"
	"time"

	"common-golang/errors"
	"common-golang/message"
)

// Recovery catches panics and returns INTERNAL_SERVER_ERROR instead of crashing.
func Recovery() Middleware {
	return func(next HandlerFunc) HandlerFunc {
		return func(ctx context.Context, msg *message.Message) (data any, err error) {
			defer func() {
				if r := recover(); r != nil {
					slog.Error("handler panic recovered",
						"uri", msg.URI,
						"panic", fmt.Sprintf("%v", r),
						"stack", string(debug.Stack()),
					)
					data = nil
					err = errors.NewInternal(fmt.Errorf("panic: %v", r))
				}
			}()
			return next(ctx, msg)
		}
	}
}

// Logger logs request/response with processing duration.
func Logger() Middleware {
	return func(next HandlerFunc) HandlerFunc {
		return func(ctx context.Context, msg *message.Message) (any, error) {
			start := time.Now()
			slog.Info("→ request", "uri", msg.URI, "msgId", msg.MessageID, "txnId", msg.TransactionID)

			data, err := next(ctx, msg)

			if err != nil {
				slog.Warn("← response ERROR", "uri", msg.URI, "took", time.Since(start), "error", err.Error())
			} else {
				slog.Info("← response OK", "uri", msg.URI, "took", time.Since(start))
			}
			return data, err
		}
	}
}

// MessageExpiry drops messages older than maxAge.
func MessageExpiry(maxAge time.Duration) Middleware {
	return func(next HandlerFunc) HandlerFunc {
		return func(ctx context.Context, msg *message.Message) (any, error) {
			if msg.Timestamp != nil && *msg.Timestamp > 0 {
				age := time.Since(time.UnixMilli(*msg.Timestamp))
				if age > maxAge {
					slog.Warn("dropping expired message", "uri", msg.URI, "age", age, "maxAge", maxAge)
					return nil, nil
				}
			}
			return next(ctx, msg)
		}
	}
}
