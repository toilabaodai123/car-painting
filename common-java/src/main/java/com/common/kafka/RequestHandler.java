package com.common.kafka;

import com.common.errors.ErrorHandlerUtils;
import com.common.message.Message;
import com.common.message.Response;
import com.common.utils.JsonUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Function;

public class RequestHandler {
    private static final Logger log = LoggerFactory.getLogger(RequestHandler.class);
    
    private final KafkaConfig config;
    private final KafkaClient client;
    private final Map<String, Function<Message, Object>> routes = new HashMap<>();

    public RequestHandler(KafkaConfig config, KafkaClient client) {
        this.config = config;
        this.client = client;
    }

    public void handle(String uri, Function<Message, Object> handler) {
        routes.put(uri, handler);
    }

    public void dispatch(String jsonPayload) {
        long start = System.currentTimeMillis();
        Message msg;
        try {
            msg = JsonUtils.getMapper().readValue(jsonPayload, Message.class);
        } catch (Exception e) {
            log.error("failed to parse kafka message", e);
            return;
        }

        if (config.getTimeDiffIgnoreMs() > 0 && msg.getTimestamp() != null) {
            long age = System.currentTimeMillis() - msg.getTimestamp();
            if (age > config.getTimeDiffIgnoreMs()) {
                log.warn("dropping stale message msgId: {} age: {}", msg.getMessageId(), age);
                return;
            }
        }

        try {
            MessageContextHolder.setTransactionId(msg.getTransactionId());
            MessageContextHolder.setMessageId(msg.getMessageId());
            MessageContextHolder.setSourceId(msg.getSourceId());
            MessageContextHolder.setUri(msg.getUri());

            Function<Message, Object> handler = routes.get(msg.getUri());
            if (handler == null) {
                throw com.common.errors.GeneralError.newUriNotFound(msg.getUri());
            }

            Object data = handler.apply(msg);
            
            if (data != null && msg.getResponseDestination() != null) {
                Response resp = Response.dataResponse(data);
                client.sendResponse(msg, resp);
            }
            
            log.info("← response OK uri: {} took: {}ms", msg.getUri(), (System.currentTimeMillis() - start));
        } catch (Throwable err) {
            log.warn("← response ERROR uri: {} took: {}ms error: {}", msg.getUri(), (System.currentTimeMillis() - start), err.getMessage());
            if (msg.getResponseDestination() != null) {
                try {
                    Response resp = ErrorHandlerUtils.toResponse(err);
                    client.sendResponse(msg, resp);
                } catch (Exception sendErr) {
                    log.error("failed to send error response", sendErr);
                }
            }
        } finally {
            MessageContextHolder.clear();
        }
    }
}
