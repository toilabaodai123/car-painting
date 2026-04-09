package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"common-golang/message"

	"github.com/IBM/sarama"
)

type MessageHandler func(msg *message.Message)

type Consumer struct {
	group  sarama.ConsumerGroup
	config *Config
	topics []string
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

func NewConsumer(ctx context.Context, cfg *Config, topics []string, handler MessageHandler) (*Consumer, error) {
	cfg.applyDefaults()

	group, err := sarama.NewConsumerGroup(cfg.Brokers, cfg.ClusterID, cfg.buildSaramaConfig())
	if err != nil {
		return nil, fmt.Errorf("create consumer group: %w", err)
	}

	cctx, cancel := context.WithCancel(ctx)
	c := &Consumer{group: group, config: cfg, topics: topics, cancel: cancel}

	gh := &groupHandler{handler: handler, config: cfg, ready: make(chan struct{})}

	c.wg.Add(1)
	go func() {
		defer c.wg.Done()
		for {
			if cctx.Err() != nil {
				return
			}
			if err := group.Consume(cctx, topics, gh); err != nil {
				slog.Error("consumer error, retrying", "topics", topics, "error", err, "retryIn", cfg.ReconnectInterval)
				select {
				case <-cctx.Done():
					return
				case <-time.After(cfg.ReconnectInterval):
				}
			}
		}
	}()

	select {
	case <-gh.ready:
		slog.Info("consumer ready", "topics", topics, "group", cfg.ClusterID)
	case <-time.After(30 * time.Second):
		slog.Warn("consumer ready timeout, proceeding anyway", "topics", topics)
	case <-cctx.Done():
		return nil, cctx.Err()
	}

	return c, nil
}

func (c *Consumer) Close() error {
	c.cancel()
	c.wg.Wait()
	return c.group.Close()
}

// --- sarama.ConsumerGroupHandler ---

type groupHandler struct {
	handler MessageHandler
	config  *Config
	ready   chan struct{}
	once    sync.Once
}

func (h *groupHandler) Setup(_ sarama.ConsumerGroupSession) error {
	h.once.Do(func() { close(h.ready) })
	return nil
}

func (h *groupHandler) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }

func (h *groupHandler) ConsumeClaim(session sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	sem := make(chan struct{}, h.config.MaxConcurrency)

	for msg := range claim.Messages() {
		parsed, err := h.parse(msg)
		if err != nil {
			session.MarkMessage(msg, "")
			continue
		}

		if h.config.TimeDiffIgnore > 0 {
			age := time.Since(time.UnixMilli(msg.Timestamp.UnixMilli()))
			if age > h.config.TimeDiffIgnore {
				slog.Warn("dropping stale message", "msgId", parsed.MessageID, "age", age)
				session.MarkMessage(msg, "")
				continue
			}
		}

		sem <- struct{}{}
		go func(m *sarama.ConsumerMessage, p *message.Message) {
			defer func() { <-sem }()
			defer func() {
				if r := recover(); r != nil {
					slog.Error("panic in message handler", "uri", p.URI, "msgId", p.MessageID, "panic", fmt.Sprintf("%v", r))
				}
			}()
			h.handler(p)
			session.MarkMessage(m, "")
		}(msg, parsed)
	}
	return nil
}

func (h *groupHandler) parse(msg *sarama.ConsumerMessage) (*message.Message, error) {
	var m message.Message
	if err := json.Unmarshal(msg.Value, &m); err != nil {
		slog.Error("failed to parse kafka message", "topic", msg.Topic, "offset", msg.Offset, "error", err)
		return nil, err
	}
	slog.Debug("kafka recv", "topic", msg.Topic, "uri", m.URI, "msgId", m.MessageID)
	return &m, nil
}
