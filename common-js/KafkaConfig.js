class KafkaConfig {
    constructor() {
        this.clusterId = null;
        this.nodeId = null;
        this.brokers = ['localhost:9092'];
        this.requestTimeoutMs = 180000;
        this.reconnectIntervalMs = 10000;
        this.maxConcurrency = 4;
        this.timeDiffIgnoreMs = 0;
    }

    responseTopic() {
        return `${this.clusterId}.response.${this.nodeId}`;
    }

    setClusterId(id) { this.clusterId = id; return this; }
    setNodeId(id) { this.nodeId = id; return this; }
    setBrokers(brokers) { this.brokers = brokers; return this; }
}

module.exports = KafkaConfig;
