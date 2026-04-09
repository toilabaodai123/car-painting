package utils

import (
	"encoding/json"
	"fmt"

	"common-golang/errors"
)

// ParseData converts msg.Data (map[string]any) to target struct via JSON round-trip.
func ParseData(data any, target any) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return errors.New(errors.CodeInvalidParameter).WithCause(fmt.Errorf("marshal data: %w", err))
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return errors.New(errors.CodeInvalidParameter).WithCause(fmt.Errorf("unmarshal data: %w", err))
	}
	return nil
}

func ToJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}
