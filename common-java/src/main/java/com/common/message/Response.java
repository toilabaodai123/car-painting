package com.common.message;

import java.util.Map;

public class Response {
    private Object data;
    private Status status;

    public Response() {}

    public static Response dataResponse(Object data) {
        Response response = new Response();
        response.setData(data);
        return response;
    }

    public static Response errorResponse(String code, Map<String, Object> messageParams) {
        Response response = new Response();
        Status status = new Status();
        status.setCode(code);
        status.setMessageParams(messageParams);
        response.setStatus(status);
        return response;
    }

    public static Response systemErrorResponse(String code) {
        Response response = new Response();
        Status status = new Status();
        status.setCode(code);
        status.setIsSystemError(true);
        response.setStatus(status);
        return response;
    }

    public boolean hasError() {
        return this.status != null && this.status.getCode() != null && !this.status.getCode().isEmpty();
    }

    public Object getData() { return data; }
    public void setData(Object data) { this.data = data; }

    public Status getStatus() { return status; }
    public void setStatus(Status status) { this.status = status; }
}
