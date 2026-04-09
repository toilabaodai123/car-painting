package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"common-golang/errors"
	"common-golang/message"
)

// HandlerFunc processes a request and returns (data, nil) for success,
// (nil, err) for error, or (nil, nil) to skip response.
type HandlerFunc func(ctx context.Context, msg *message.Message) (any, error)

type Middleware func(HandlerFunc) HandlerFunc

type Router struct {
	routes      map[string]HandlerFunc
	middlewares []Middleware
}

func NewRouter() *Router {
	return &Router{routes: make(map[string]HandlerFunc)}
}

func (r *Router) Use(mw ...Middleware) {
	r.middlewares = append(r.middlewares, mw...)
}

func (r *Router) Handle(uri string, handler HandlerFunc, mw ...Middleware) {
	h := handler
	for i := len(mw) - 1; i >= 0; i-- {
		h = mw[i](h)
	}
	for i := len(r.middlewares) - 1; i >= 0; i-- {
		h = r.middlewares[i](h)
	}
	r.routes[uri] = h
}

func (r *Router) match(uri string) HandlerFunc {
	return r.routes[uri]
}

// --- RequestHandler ---

type RequestHandler struct {
	config   *Config
	producer *Producer
	consumer *Consumer
	router   *Router
}

func NewRequestHandler(ctx context.Context, cfg *Config, router *Router) (*RequestHandler, error) {
	return NewRequestHandlerWithTopics(ctx, cfg, []string{cfg.ClusterID}, router)
}

func NewRequestHandlerWithTopics(ctx context.Context, cfg *Config, topics []string, router *Router) (*RequestHandler, error) {
	cfg.applyDefaults()

	producer, err := NewProducer(cfg)
	if err != nil {
		return nil, fmt.Errorf("create producer: %w", err)
	}

	h := &RequestHandler{config: cfg, producer: producer, router: router}

	consumer, err := NewConsumer(ctx, cfg, topics, h.dispatch)
	if err != nil {
		_ = producer.Close()
		return nil, fmt.Errorf("create consumer: %w", err)
	}
	h.consumer = consumer

	slog.Info("request handler ready", "topics", topics, "routes", routeKeys(router))
	return h, nil
}

func (h *RequestHandler) Close() error {
	var errs []error
	if h.consumer != nil {
		if err := h.consumer.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if h.producer != nil {
		if err := h.producer.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("close handler: %v", errs)
	}
	return nil
}

func (h *RequestHandler) dispatch(msg *message.Message) {
	start := time.Now()

	ctx := context.Background()
	ctx = WithTransactionID(ctx, msg.TransactionID)
	ctx = WithMessageID(ctx, msg.MessageID)
	ctx = WithSourceID(ctx, msg.SourceID)
	ctx = WithURI(ctx, msg.URI)

	if h.config.Hooks != nil && h.config.Hooks.OnRequestReceived != nil {
		h.config.Hooks.OnRequestReceived(msg.URI)
	}

	handler := h.router.match(msg.URI)
	if handler == nil {
		h.sendError(ctx, msg, errors.NewURINotFound(msg.URI))
		h.hookDone(msg.URI, start, errors.NewURINotFound(msg.URI))
		return
	}

	data, err := handler(ctx, msg)
	if err != nil {
		h.sendError(ctx, msg, err)
		h.hookDone(msg.URI, start, err)
		return
	}

	if data == nil {
		h.hookDone(msg.URI, start, nil)
		return
	}

	h.sendData(ctx, msg, data)
	h.hookDone(msg.URI, start, nil)
}

func (h *RequestHandler) sendData(ctx context.Context, original *message.Message, data any) {
	if original.ResponseDestination == nil || original.ResponseDestination.Topic == "" {
		return
	}
	resp := message.DataResponse(data)
	respMsg := message.NewResponse(*original, h.config.ClusterID, resp)
	if err := h.producer.Send(ctx, original.ResponseDestination.Topic, respMsg); err != nil {
		slog.Error("failed to send data response", "uri", original.URI, "error", err)
	}
}

func (h *RequestHandler) sendError(ctx context.Context, original *message.Message, handlerErr error) {
	if original.ResponseDestination == nil || original.ResponseDestination.Topic == "" {
		slog.Error("handler error (no response destination)", "uri", original.URI, "error", handlerErr)
		return
	}
	resp := errors.ToResponse(handlerErr)
	respMsg := message.NewResponse(*original, h.config.ClusterID, resp)
	if err := h.producer.Send(ctx, original.ResponseDestination.Topic, respMsg); err != nil {
		slog.Error("failed to send error response", "uri", original.URI, "error", err)
	}
}

func (h *RequestHandler) hookDone(uri string, start time.Time, err error) {
	if h.config.Hooks != nil && h.config.Hooks.OnResponseSent != nil {
		h.config.Hooks.OnResponseSent(uri, time.Since(start), err)
	}
}

// TypedHandler auto-parses msg.Data into the request type.
func TypedHandler[Req any](fn func(ctx context.Context, req *Req, msg *message.Message) (any, error)) HandlerFunc {
	return func(ctx context.Context, msg *message.Message) (any, error) {
		var req Req
		raw, err := json.Marshal(msg.Data)
		if err != nil {
			return nil, errors.New(errors.CodeInvalidParameter).WithCause(fmt.Errorf("marshal data: %w", err))
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, errors.New(errors.CodeInvalidParameter).WithCause(fmt.Errorf("parse request: %w", err))
		}
		return fn(ctx, &req, msg)
	}
}

func routeKeys(r *Router) []string {
	keys := make([]string, 0, len(r.routes))
	for k := range r.routes {
		keys = append(keys, k)
	}
	return keys
}
