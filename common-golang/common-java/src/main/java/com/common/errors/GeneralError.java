package com.common.errors;

import com.common.message.ParamError;
import com.common.message.Response;
import com.common.message.Status;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class GeneralError extends RuntimeException {
    private String code;
    private Map<String, Object> messageParams;
    private String source;
    private List<ParamError> params;
    private boolean isSystemError;

    public GeneralError(String code) {
        super(code);
        this.code = code;
    }

    public GeneralError withSource(String source) {
        this.source = source;
        return this;
    }

    public GeneralError withParam(String field, String msg) {
        if (this.params == null) {
            this.params = new ArrayList<>();
        }
        this.params.add(new ParamError(field, msg));
        return this;
    }

    public GeneralError withParams(List<ParamError> params) {
        this.params = params;
        return this;
    }

    public GeneralError withMessageParams(Map<String, Object> mp) {
        this.messageParams = mp;
        return this;
    }

    public GeneralError withCause(Throwable t) {
        this.initCause(t);
        return this;
    }

    public GeneralError asSystemError() {
        this.isSystemError = true;
        return this;
    }

    public Status toStatus() {
        Status status = new Status();
        status.setCode(code);
        status.setMessageParams(messageParams);
        status.setSource(source);
        status.setParams(params);
        status.setIsSystemError(isSystemError);
        return status;
    }

    public Response toResponse() {
        Response resp = new Response();
        resp.setStatus(toStatus());
        return resp;
    }

    // Builder shortcuts
    public static GeneralError newInternal(Throwable t) {
        return new GeneralError(ErrorCodes.INTERNAL_SERVER_ERROR)
                .withCause(t)
                .asSystemError();
    }

    public static GeneralError newTimeout(String source) {
        return new GeneralError(ErrorCodes.TIMEOUT_ERROR).withSource(source);
    }

    public static GeneralError newUriNotFound(String uri) {
        return new GeneralError(ErrorCodes.URI_NOT_FOUND).withSource(uri);
    }

    public static GeneralError newInvalidParam(String field, String reason) {
        return new GeneralError(ErrorCodes.INVALID_PARAMETER).withParam(field, reason);
    }

    public static GeneralError newUnauthorized() {
        return new GeneralError(ErrorCodes.UNAUTHORIZED);
    }

    public static GeneralError newObjectNotFound(String object, Object id) {
        Map<String, Object> map = new HashMap<>();
        map.put("object", object);
        map.put("id", id);
        return new GeneralError(ErrorCodes.OBJECT_NOT_FOUND).withMessageParams(map);
    }

    // Getters
    public String getCode() { return code; }
    public Map<String, Object> getMessageParams() { return messageParams; }
    public String getSource() { return source; }
    public List<ParamError> getParams() { return params; }
    public boolean isSystemError() { return isSystemError; }
}
