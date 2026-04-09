package kafka

import (
	"runtime"
	"time"

	"github.com/IBM/sarama"
)

type Config struct {
	ClusterID         string
	NodeID            string
	Brokers           []string
	RequestTimeout    time.Duration // default 180s
	ReconnectInterval time.Duration // default 10s
	MaxConcurrency    int           // default NumCPU*2
	TimeDiffIgnore    time.Duration // drop messages older than this; 0 = disabled
	SaramaConfig      *sarama.Config
	Hooks             *Hooks
}

type Hooks struct {
	OnRequestReceived func(uri string)
	OnResponseSent    func(uri string, duration time.Duration, err error)
}

func (c *Config) applyDefaults() {
	if c.RequestTimeout <= 0 {
		c.RequestTimeout = 180 * time.Second
	}
	if c.ReconnectInterval <= 0 {
		c.ReconnectInterval = 10 * time.Second
	}
	if c.MaxConcurrency <= 0 {
		c.MaxConcurrency = runtime.NumCPU() * 2
	}
}

func (c *Config) responseTopic() string {
	return c.ClusterID + ".response." + c.NodeID
}

func (c *Config) buildSaramaConfig() *sarama.Config {
	if c.SaramaConfig != nil {
		return c.SaramaConfig
	}
	sc := sarama.NewConfig()
	sc.Producer.Return.Successes = true
	sc.Producer.RequiredAcks = sarama.WaitForLocal
	sc.Producer.MaxMessageBytes = 10 * 1024 * 1024
	sc.Consumer.Offsets.Initial = sarama.OffsetNewest
	sc.Consumer.Fetch.Max = 10 * 1024 * 1024
	return sc
}
