package com.common.kafka;

import com.common.errors.GeneralError;
import com.common.message.Message;
import com.common.message.Response;
import com.common.utils.JsonUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public class KafkaClient {
    private static final Logger log = LoggerFactory.getLogger(KafkaClient.class);

    private final KafkaConfig config;
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ConcurrentHashMap<String, CompletableFuture<Message>> pendingRequests;

    public KafkaClient(KafkaConfig config, KafkaTemplate<String, String> kafkaTemplate) {
        this.config = config;
        this.kafkaTemplate = kafkaTemplate;
        this.pendingRequests = new ConcurrentHashMap<>();
    }

    public Response sendRequest(String topic, String uri, Object data) throws Exception {
        String txnId = MessageContextHolder.getTransactionId() != null ? 
                       MessageContextHolder.getTransactionId() : UUID.randomUUID().toString();

        Message msg = Message.newRequest(uri, config.getClusterId(), txnId, config.responseTopic(), data);

        CompletableFuture<Message> future = new CompletableFuture<>();
        pendingRequests.put(msg.getMessageId(), future);

        try {
            sendMessageInternal(topic, msg);
            Message respMsg = future.get(config.getRequestTimeoutMs(), TimeUnit.MILLISECONDS);
            return unwrapResponse(respMsg);
        } catch (TimeoutException e) {
            throw GeneralError.newTimeout(topic + "/" + uri);
        } finally {
            pendingRequests.remove(msg.getMessageId());
        }
    }

    public void sendMessage(String topic, String uri, Object data) throws Exception {
        String txnId = MessageContextHolder.getTransactionId() != null ? 
                       MessageContextHolder.getTransactionId() : UUID.randomUUID().toString();
        Message msg = Message.newRequest(uri, config.getClusterId(), txnId, null, data);
        msg.setMessageType(com.common.message.MessageType.MESSAGE);
        sendMessageInternal(topic, msg);
    }

    public void sendResponse(Message original, Object data) throws Exception {
        if (original.getResponseDestination() == null || original.getResponseDestination().getTopic() == null) {
            return;
        }
        Message resp = Message.newResponse(original, config.getClusterId(), data);
        sendMessageInternal(original.getResponseDestination().getTopic(), resp);
    }

    private void sendMessageInternal(String topic, Message msg) throws Exception {
        String json = JsonUtils.toJson(msg);
        log.debug("kafka send topic: {} uri: {} msgId: {}", topic, msg.getUri(), msg.getMessageId());
        kafkaTemplate.send(topic, msg.getMessageId(), json).get();
    }

    public void handleResponse(Message msg) {
        CompletableFuture<Message> future = pendingRequests.get(msg.getMessageId());
        if (future != null) {
            future.complete(msg);
        } else {
            log.warn("response for unknown request msgId: {}", msg.getMessageId());
        }
    }

    private Response unwrapResponse(Message msg) throws Exception {
        Response resp = JsonUtils.parseData(msg.getData(), Response.class);
        if (resp != null && resp.hasError()) {
            throw new GeneralError(resp.getStatus().getCode())
                    .withMessageParams(resp.getStatus().getMessageParams())
                    .withSource(resp.getStatus().getSource())
                    .withParams(resp.getStatus().getParams());
        }
        return resp;
    }
}
