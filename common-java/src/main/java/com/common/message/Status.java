package com.common.message;

import java.util.List;
import java.util.Map;

public class Status {
    private String code;
    private Map<String, Object> messageParams;
    private String source;
    private List<ParamError> params;
    private Boolean isSystemError;

    public Status() {}

    public Status sanitize() {
        Status safe = new Status();
        if (Boolean.TRUE.equals(this.isSystemError)) {
            safe.setCode("INTERNAL_SERVER_ERROR");
            safe.setMessageParams(null);
        } else {
            safe.setCode(this.code);
            safe.setMessageParams(this.messageParams);
        }
        return safe;
    }

    // Getters and Setters
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }

    public Map<String, Object> getMessageParams() { return messageParams; }
    public void setMessageParams(Map<String, Object> messageParams) { this.messageParams = messageParams; }

    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }

    public List<ParamError> getParams() { return params; }
    public void setParams(List<ParamError> params) { this.params = params; }

    public Boolean getIsSystemError() { return isSystemError; }
    public void setIsSystemError(Boolean systemError) { isSystemError = systemError; }
}
