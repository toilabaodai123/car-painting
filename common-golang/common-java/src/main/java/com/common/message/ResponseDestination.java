package com.common.message;

public class ResponseDestination {
    private String topic;
    private String uri;

    public ResponseDestination() {}

    public ResponseDestination(String topic, String uri) {
        this.topic = topic;
        this.uri = uri;
    }

    public String getTopic() { return topic; }
    public void setTopic(String topic) { this.topic = topic; }

    public String getUri() { return uri; }
    public void setUri(String uri) { this.uri = uri; }
}
