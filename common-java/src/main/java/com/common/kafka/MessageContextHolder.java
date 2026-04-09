package com.common.kafka;

import java.util.HashMap;
import java.util.Map;

public class MessageContextHolder {
    private static final ThreadLocal<Map<String, String>> contextHolder = ThreadLocal.withInitial(HashMap::new);

    public static final String TXN_ID = "transactionId";
    public static final String MSG_ID = "messageId";
    public static final String SOURCE_ID = "sourceId";
    public static final String URI = "uri";

    public static void setTransactionId(String id) {
        contextHolder.get().put(TXN_ID, id);
    }

    public static String getTransactionId() {
        return contextHolder.get().get(TXN_ID);
    }

    public static void setMessageId(String id) {
        contextHolder.get().put(MSG_ID, id);
    }

    public static String getMessageId() {
        return contextHolder.get().get(MSG_ID);
    }

    public static void setSourceId(String id) {
        contextHolder.get().put(SOURCE_ID, id);
    }

    public static String getSourceId() {
        return contextHolder.get().get(SOURCE_ID);
    }

    public static void setUri(String uri) {
        contextHolder.get().put(URI, uri);
    }

    public static String getUri() {
        return contextHolder.get().get(URI);
    }

    public static void clear() {
        contextHolder.remove();
    }
}
