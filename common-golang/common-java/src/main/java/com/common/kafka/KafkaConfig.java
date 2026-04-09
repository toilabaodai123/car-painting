package com.common.kafka;

public class KafkaConfig {
    private String clusterId;
    private String nodeId;
    private String[] brokers;
    private Long requestTimeoutMs = 180000L;
    private Long reconnectIntervalMs = 10000L;
    private Integer maxConcurrency = Runtime.getRuntime().availableProcessors() * 2;
    private Long timeDiffIgnoreMs = 0L;

    public KafkaConfig() {}

    public String responseTopic() {
        return clusterId + ".response." + nodeId;
    }

    // Getters and Builders
    public String getClusterId() { return clusterId; }
    public KafkaConfig setClusterId(String clusterId) { this.clusterId = clusterId; return this; }

    public String getNodeId() { return nodeId; }
    public KafkaConfig setNodeId(String nodeId) { this.nodeId = nodeId; return this; }

    public String[] getBrokers() { return brokers; }
    public KafkaConfig setBrokers(String[] brokers) { this.brokers = brokers; return this; }

    public Long getRequestTimeoutMs() { return requestTimeoutMs; }
    public KafkaConfig setRequestTimeoutMs(Long requestTimeoutMs) { this.requestTimeoutMs = requestTimeoutMs; return this; }

    public Long getReconnectIntervalMs() { return reconnectIntervalMs; }
    public KafkaConfig setReconnectIntervalMs(Long reconnectIntervalMs) { this.reconnectIntervalMs = reconnectIntervalMs; return this; }

    public Integer getMaxConcurrency() { return maxConcurrency; }
    public KafkaConfig setMaxConcurrency(Integer maxConcurrency) { this.maxConcurrency = maxConcurrency; return this; }

    public Long getTimeDiffIgnoreMs() { return timeDiffIgnoreMs; }
    public KafkaConfig setTimeDiffIgnoreMs(Long timeDiffIgnoreMs) { this.timeDiffIgnoreMs = timeDiffIgnoreMs; return this; }
}
