package com.common.utils;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.common.errors.ErrorCodes;
import com.common.errors.GeneralError;

public class JsonUtils {
    private static final ObjectMapper mapper = new ObjectMapper();

    public static <T> T parseData(Object data, Class<T> target) {
        try {
            // Equivalent to JSON roundtrip in go
            String raw = mapper.writeValueAsString(data);
            return mapper.readValue(raw, target);
        } catch (Exception e) {
            throw new GeneralError(ErrorCodes.INVALID_PARAMETER).withCause(e);
        }
    }

    public static String toJson(Object v) {
        try {
            return mapper.writeValueAsString(v);
        } catch (Exception e) {
            return "";
        }
    }
    
    public static ObjectMapper getMapper() {
        return mapper;
    }
}
