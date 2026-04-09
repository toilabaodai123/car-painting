package com.common.message;

import java.util.UUID;

public class Message {
    private MessageType messageType;
    private String sourceId;
    private String messageId;
    private String transactionId;
    private String uri;
    private Integer partition;
    private ResponseDestination responseDestination;
    private Object data;
    private Long timestamp;
    private Boolean stream;
    private String streamState;
    private Integer streamIndex;

    public Message() {}

    // Getters and Setters
    public MessageType getMessageType() { return messageType; }
    public void setMessageType(MessageType messageType) { this.messageType = messageType; }

    public String getSourceId() { return sourceId; }
    public void setSourceId(String sourceId) { this.sourceId = sourceId; }

    public String getMessageId() { return messageId; }
    public void setMessageId(String messageId) { this.messageId = messageId; }

    public String getTransactionId() { return transactionId; }
    public void setTransactionId(String transactionId) { this.transactionId = transactionId; }

    public String getUri() { return uri; }
    public void setUri(String uri) { this.uri = uri; }

    public Integer getPartition() { return partition; }
    public void setPartition(Integer partition) { this.partition = partition; }

    public ResponseDestination getResponseDestination() { return responseDestination; }
    public void setResponseDestination(ResponseDestination responseDestination) { this.responseDestination = responseDestination; }

    public Object getData() { return data; }
    public void setData(Object data) { this.data = data; }

    public Long getTimestamp() { return timestamp; }
    public void setTimestamp(Long timestamp) { this.timestamp = timestamp; }

    public Boolean getStream() { return stream; }
    public void setStream(Boolean stream) { this.stream = stream; }

    public String getStreamState() { return streamState; }
    public void setStreamState(String streamState) { this.streamState = streamState; }

    public Integer getStreamIndex() { return streamIndex; }
    public void setStreamIndex(Integer streamIndex) { this.streamIndex = streamIndex; }

    // Helpers based on common-golang message builders
    public static Message newMessage(String uri, String sourceId, Object data) {
        Message msg = new Message();
        msg.setMessageType(MessageType.MESSAGE);
        msg.setMessageId(UUID.randomUUID().toString());
        msg.setTransactionId(UUID.randomUUID().toString());
        msg.setUri(uri);
        msg.setSourceId(sourceId);
        msg.setData(data);
        msg.setTimestamp(System.currentTimeMillis());
        return msg;
    }

    public static Message newRequest(String uri, String sourceId, String transactionId, String responseTopic, Object data) {
        Message msg = new Message();
        msg.setMessageType(MessageType.REQUEST);
        msg.setMessageId(UUID.randomUUID().toString());
        msg.setTransactionId(transactionId != null ? transactionId : UUID.randomUUID().toString());
        msg.setUri(uri);
        msg.setSourceId(sourceId);
        msg.setData(data);
        msg.setTimestamp(System.currentTimeMillis());
        
        if (responseTopic != null && !responseTopic.isEmpty()) {
            msg.setResponseDestination(new ResponseDestination(responseTopic, uri));
        }
        return msg;
    }

    public static Message newResponse(Message original, String sourceId, Object data) {
        Message msg = new Message();
        msg.setMessageType(MessageType.RESPONSE);
        msg.setMessageId(original.getMessageId());
        msg.setTransactionId(original.getTransactionId());
        msg.setUri(original.getUri());
        msg.setSourceId(sourceId);
        msg.setData(data);
        msg.setTimestamp(System.currentTimeMillis());
        return msg;
    }
}
