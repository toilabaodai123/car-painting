package message

import (
	"time"

	"github.com/google/uuid"
)

type Type string

const (
	TypeMessage  Type = "MESSAGE"
	TypeRequest  Type = "REQUEST"
	TypeResponse Type = "RESPONSE"
)

type ResponseDestination struct {
	Topic string `json:"topic"`
	URI   string `json:"uri"`
}

type Message struct {
	MessageType         Type                 `json:"messageType,omitempty"`
	SourceID            string               `json:"sourceId,omitempty"`
	MessageID           string               `json:"messageId,omitempty"`
	TransactionID       string               `json:"transactionId,omitempty"`
	URI                 string               `json:"uri,omitempty"`
	Partition           *int                 `json:"partition,omitempty"`
	ResponseDestination *ResponseDestination `json:"responseDestination,omitempty"`
	Data                any                  `json:"data,omitempty"`
	Timestamp           *int64               `json:"timestamp,omitempty"`
	Stream              *bool                `json:"stream,omitempty"`
	StreamState         *string              `json:"streamState,omitempty"`
	TargetFile          *string              `json:"targetFile,omitempty"`
	Headers             map[string]string    `json:"headers,omitempty"`
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}

func NewMessage(uri, sourceID string, data any) Message {
	now := nowMillis()
	return Message{
		MessageType:   TypeMessage,
		MessageID:     uuid.New().String(),
		TransactionID: uuid.New().String(),
		URI:           uri,
		SourceID:      sourceID,
		Data:          data,
		Timestamp:     &now,
	}
}

func NewRequest(uri, sourceID, transactionID, responseTopic string, data any) Message {
	now := nowMillis()
	msg := Message{
		MessageType:   TypeRequest,
		MessageID:     uuid.New().String(),
		TransactionID: transactionID,
		URI:           uri,
		SourceID:      sourceID,
		Data:          data,
		Timestamp:     &now,
	}
	if responseTopic != "" {
		msg.ResponseDestination = &ResponseDestination{
			Topic: responseTopic,
			URI:   uri,
		}
	}
	return msg
}

func NewResponse(original Message, sourceID string, data any) Message {
	now := nowMillis()
	return Message{
		MessageType:   TypeResponse,
		MessageID:     original.MessageID,
		TransactionID: original.TransactionID,
		URI:           original.URI,
		SourceID:      sourceID,
		Data:          data,
		Timestamp:     &now,
	}
}
