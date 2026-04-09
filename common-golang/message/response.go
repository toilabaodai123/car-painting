package message

type ParamError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

type Status struct {
	Code          string         `json:"code,omitempty"`
	MessageParams map[string]any `json:"messageParams,omitempty"`
	Source        string         `json:"source,omitempty"`
	Params        []ParamError   `json:"params,omitempty"`
	IsSystemError bool           `json:"isSystemError,omitempty"`
}

// Sanitize strips internal details, safe to return to external clients.
func (s *Status) Sanitize() *Status {
	if s == nil {
		return nil
	}
	safe := &Status{
		Code:          s.Code,
		MessageParams: s.MessageParams,
	}
	if s.IsSystemError {
		safe.Code = "INTERNAL_SERVER_ERROR"
		safe.MessageParams = nil
	}
	return safe
}

type Response struct {
	Data   any     `json:"data,omitempty"`
	Status *Status `json:"status,omitempty"`
}

func DataResponse(data any) *Response {
	return &Response{Data: data}
}

func ErrorResponse(code string, messageParams map[string]any) *Response {
	return &Response{
		Status: &Status{
			Code:          code,
			MessageParams: messageParams,
		},
	}
}

func SystemErrorResponse(code string) *Response {
	return &Response{
		Status: &Status{
			Code:          code,
			IsSystemError: true,
		},
	}
}

func (r *Response) HasError() bool {
	return r != nil && r.Status != nil && r.Status.Code != ""
}
