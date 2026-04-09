package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"common-golang/message"

	"github.com/IBM/sarama"
)

type Producer struct {
	config       *Config
	inner        atomic.Value // sarama.SyncProducer
	closed       chan struct{}
	closeOnce    sync.Once
	reconnecting atomic.Bool
}

func NewProducer(cfg *Config) (*Producer, error) {
	cfg.applyDefaults()

	sp, err := sarama.NewSyncProducer(cfg.Brokers, cfg.buildSaramaConfig())
	if err != nil {
		return nil, fmt.Errorf("create producer: %w", err)
	}

	p := &Producer{config: cfg, closed: make(chan struct{})}
	p.inner.Store(sp)
	go p.monitor()

	slog.Info("producer created", "brokers", cfg.Brokers)
	return p, nil
}

func (p *Producer) Send(ctx context.Context, topic string, msg message.Message) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-p.closed:
		return fmt.Errorf("producer is closed")
	default:
	}

	sp := p.get()
	if sp == nil {
		return fmt.Errorf("producer unavailable (reconnecting)")
	}

	value, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal message: %w", err)
	}

	pm := &sarama.ProducerMessage{
		Topic: topic,
		Key:   sarama.StringEncoder(msg.MessageID),
		Value: sarama.ByteEncoder(value),
	}

	slog.Debug("kafka send", "topic", topic, "uri", msg.URI, "msgId", msg.MessageID)

	if _, _, err = sp.SendMessage(pm); err != nil {
		if err == sarama.ErrOutOfBrokers || err == sarama.ErrClosedClient {
			go p.reconnect()
		}
		return fmt.Errorf("send message: %w", err)
	}
	return nil
}

func (p *Producer) Close() error {
	var err error
	p.closeOnce.Do(func() {
		close(p.closed)
		if sp := p.get(); sp != nil {
			err = sp.Close()
		}
	})
	return err
}

func (p *Producer) get() sarama.SyncProducer {
	v := p.inner.Load()
	if v == nil {
		return nil
	}
	return v.(sarama.SyncProducer)
}

func (p *Producer) monitor() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-p.closed:
			return
		case <-ticker.C:
			if !p.checkHealth() {
				slog.Warn("kafka unavailable, triggering reconnect")
				p.reconnect()
			}
		}
	}
}

func (p *Producer) checkHealth() bool {
	if p.reconnecting.Load() {
		return false
	}
	client, err := sarama.NewClient(p.config.Brokers, p.config.buildSaramaConfig())
	if err != nil {
		return false
	}
	_ = client.Close()
	return true
}

func (p *Producer) reconnect() {
	if !p.reconnecting.CompareAndSwap(false, true) {
		return
	}
	defer p.reconnecting.Store(false)

	for {
		select {
		case <-p.closed:
			return
		default:
		}

		slog.Info("reconnecting producer...")
		sp, err := sarama.NewSyncProducer(p.config.Brokers, p.config.buildSaramaConfig())
		if err != nil {
			slog.Error("reconnect failed", "retryIn", p.config.ReconnectInterval, "error", err)
			time.Sleep(p.config.ReconnectInterval)
			continue
		}

		old := p.get()
		p.inner.Store(sp)
		if old != nil {
			_ = old.Close()
		}
		slog.Info("producer reconnected")
		return
	}
}
