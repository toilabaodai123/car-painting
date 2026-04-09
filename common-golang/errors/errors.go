package errors

import (
	stderrors "errors"
	"fmt"

	"common-golang/message"
)

type GeneralError struct {
	Code          string                `json:"code"`
	MessageParams map[string]any        `json:"messageParams,omitempty"`
	Source        string                `json:"source,omitempty"`
	Params        []message.ParamError  `json:"params,omitempty"`
	IsSystemError bool                  `json:"isSystemError,omitempty"`
	cause         error
}

func (e *GeneralError) Error() string {
	if e.Source != "" {
		return fmt.Sprintf("%s [source: %s]", e.Code, e.Source)
	}
	return e.Code
}

func (e *GeneralError) Unwrap() error { return e.cause }

func (e *GeneralError) ToStatus() *message.Status {
	return &message.Status{
		Code:          e.Code,
		MessageParams: e.MessageParams,
		Source:        e.Source,
		Params:        e.Params,
		IsSystemError: e.IsSystemError,
	}
}

func (e *GeneralError) ToResponse() *message.Response {
	return &message.Response{Status: e.ToStatus()}
}

// --- Builder ---

func New(code string) *GeneralError {
	return &GeneralError{Code: code}
}

func (e *GeneralError) WithSource(source string) *GeneralError {
	e.Source = source
	return e
}

func (e *GeneralError) WithParam(field, msg string) *GeneralError {
	e.Params = append(e.Params, message.ParamError{Field: field, Message: msg})
	return e
}

func (e *GeneralError) WithParams(params []message.ParamError) *GeneralError {
	e.Params = params
	return e
}

func (e *GeneralError) WithMessageParams(mp map[string]any) *GeneralError {
	e.MessageParams = mp
	return e
}

func (e *GeneralError) WithCause(err error) *GeneralError {
	e.cause = err
	return e
}

func (e *GeneralError) AsSystemError() *GeneralError {
	e.IsSystemError = true
	return e
}

// --- Shortcuts ---

func NewInternal(err error) *GeneralError {
	return New(CodeInternalServer).WithCause(err).AsSystemError()
}

func NewTimeout(source string) *GeneralError {
	return New(CodeTimeout).WithSource(source)
}

func NewURINotFound(uri string) *GeneralError {
	return New(CodeURINotFound).WithSource(uri)
}

func NewInvalidParam(field, reason string) *GeneralError {
	return New(CodeInvalidParameter).WithParam(field, reason)
}

func NewUnauthorized() *GeneralError {
	return New(CodeUnauthorized)
}

func NewObjectNotFound(object string, id any) *GeneralError {
	return New(CodeObjectNotFound).WithMessageParams(map[string]any{
		"object": object,
		"id":     id,
	})
}

// --- Helpers ---

func AsGeneralError(err error) (*GeneralError, bool) {
	var ge *GeneralError
	if stderrors.As(err, &ge) {
		return ge, true
	}
	return nil, false
}

// ToResponse converts any error to a Response.
// *GeneralError preserves code/params, other errors become INTERNAL_SERVER_ERROR.
func ToResponse(err error) *message.Response {
	if ge, ok := AsGeneralError(err); ok {
		return ge.ToResponse()
	}
	return NewInternal(err).ToResponse()
}
