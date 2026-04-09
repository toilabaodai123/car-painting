package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"

	"common-golang/errors"
	"common-golang/message"

	"github.com/google/uuid"
)

type Client struct {
	config   *Config
	producer *Producer
	consumer *Consumer
	pending  sync.Map // messageID → chan *message.Message
}

func NewClient(ctx context.Context, cfg *Config) (*Client, error) {
	cfg.applyDefaults()

	producer, err := NewProducer(cfg)
	if err != nil {
		return nil, fmt.Errorf("create producer: %w", err)
	}

	c := &Client{config: cfg, producer: producer}

	responseTopic := cfg.responseTopic()
	consumer, err := NewConsumer(ctx, &Config{
		ClusterID:         responseTopic,
		NodeID:            cfg.NodeID,
		Brokers:           cfg.Brokers,
		ReconnectInterval: cfg.ReconnectInterval,
		MaxConcurrency:    cfg.MaxConcurrency,
		SaramaConfig:      cfg.SaramaConfig,
	}, []string{responseTopic}, c.handleResponse)
	if err != nil {
		_ = producer.Close()
		return nil, fmt.Errorf("create response consumer: %w", err)
	}
	c.consumer = consumer

	slog.Info("kafka client ready", "clusterID", cfg.ClusterID, "responseTopic", responseTopic)
	return c, nil
}

// SendRequest sends a request and blocks until response or context cancellation.
// Error responses are unwrapped into *errors.GeneralError.
// TransactionID is propagated from context automatically.
func (c *Client) SendRequest(ctx context.Context, topic, uri string, data any) (*message.Response, error) {
	txnID := TransactionIDFrom(ctx)
	if txnID == "" {
		txnID = uuid.New().String()
	}

	msg := message.NewRequest(uri, c.config.ClusterID, txnID, c.config.responseTopic(), data)

	ch := make(chan *message.Message, 1)
	c.pending.Store(msg.MessageID, ch)
	defer c.pending.Delete(msg.MessageID)

	if err := c.producer.Send(ctx, topic, msg); err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}

	select {
	case resp := <-ch:
		return c.unwrapResponse(resp)
	case <-ctx.Done():
		return nil, errors.NewTimeout(topic + "/" + uri)
	}
}

func (c *Client) SendMessage(ctx context.Context, topic, uri string, data any) error {
	txnID := TransactionIDFrom(ctx)
	if txnID == "" {
		txnID = uuid.New().String()
	}
	msg := message.NewRequest(uri, c.config.ClusterID, txnID, "", data)
	msg.MessageType = message.TypeMessage
	return c.producer.Send(ctx, topic, msg)
}

func (c *Client) SendResponse(ctx context.Context, original message.Message, data any) error {
	if original.ResponseDestination == nil || original.ResponseDestination.Topic == "" {
		return nil
	}
	resp := message.NewResponse(original, c.config.ClusterID, data)
	return c.producer.Send(ctx, original.ResponseDestination.Topic, resp)
}

func (c *Client) Close() error {
	var errs []error
	if c.consumer != nil {
		if err := c.consumer.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if c.producer != nil {
		if err := c.producer.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("close client: %v", errs)
	}
	return nil
}

func (c *Client) handleResponse(msg *message.Message) {
	v, ok := c.pending.Load(msg.MessageID)
	if !ok {
		slog.Warn("response for unknown request", "msgId", msg.MessageID)
		return
	}
	ch := v.(chan *message.Message)
	select {
	case ch <- msg:
	default:
		slog.Warn("response channel full, dropping", "msgId", msg.MessageID)
	}
}

func (c *Client) unwrapResponse(msg *message.Message) (*message.Response, error) {
	raw, err := json.Marshal(msg.Data)
	if err != nil {
		return nil, errors.NewInternal(fmt.Errorf("marshal response data: %w", err))
	}

	var resp message.Response
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, errors.NewInternal(fmt.Errorf("unmarshal response: %w", err))
	}

	if resp.HasError() {
		return nil, &errors.GeneralError{
			Code:          resp.Status.Code,
			MessageParams: resp.Status.MessageParams,
			Source:        resp.Status.Source,
			Params:        resp.Status.Params,
			IsSystemError: resp.Status.IsSystemError,
		}
	}

	return &resp, nil
}
