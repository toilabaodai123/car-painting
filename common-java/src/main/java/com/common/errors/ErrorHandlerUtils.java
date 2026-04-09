package com.common.errors;

import com.common.message.Response;

public class ErrorHandlerUtils {
    
    public static Response toResponse(Throwable err) {
        if (err instanceof GeneralError) {
            return ((GeneralError) err).toResponse();
        }
        return GeneralError.newInternal(err).toResponse();
    }
}
