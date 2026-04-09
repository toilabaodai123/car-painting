package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"common-golang/kafka"
	"common-golang/message"

	"github.com/minio/minio-go/v7"
)

type ExportHandler struct {
	client      *kafka.Client
	minioClient *minio.Client
	bucketName  string
}

func NewExportHandler(client *kafka.Client, minioClient *minio.Client, bucketName string) *ExportHandler {
	return &ExportHandler{
		client:      client,
		minioClient: minioClient,
		bucketName:  bucketName,
	}
}

func (h *ExportHandler) HandleExportOrders(ctx context.Context, msg *message.Message) (any, error) {
	log.Printf("Received export request from user %s", msg.Headers["X-User-Id"])

	// 1. Authorization: Verify permissions
	permissionsStr, ok := msg.Headers["X-User-Permissions"]
	if !ok || !strings.Contains(permissionsStr, "orders:read") {
		return map[string]interface{}{"error": "Forbidden: missing orders:read permission"}, nil
	}

	// 2. Fetch Orders
	respRaw, err := h.client.SendRequest(
		ctx,
		"order-service-topic", 
		"/orders", 
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch orders: %v", err)
	}

	// Parse JSON output from order-service
	var responseData struct {
		Orders []map[string]interface{} `json:"orders"`
		// we can ignore users and products for a simple CSV
	}
	dataBytes, _ := json.Marshal(respRaw.Data)
	if err := json.Unmarshal(dataBytes, &responseData); err != nil {
		log.Printf("Failed to parse orders data: %v (raw data: %s)", err, string(dataBytes))
		return nil, fmt.Errorf("failed to parse orders data: %v", err)
	}

	orders := responseData.Orders

	// 3. Generate CSV
	var csvBuffer bytes.Buffer
	csvBuffer.WriteString("ID,UserID,ProductID,Status\n")
	for _, rawOrder := range orders {
		id := fmt.Sprintf("%v", rawOrder["id"])
		userId := fmt.Sprintf("%v", rawOrder["userId"])
		productId := fmt.Sprintf("%v", rawOrder["productId"])
		status := fmt.Sprintf("%v", rawOrder["status"])
		csvBuffer.WriteString(fmt.Sprintf("%s,%s,%s,%s\n", id, userId, productId, status))
	}

	// 4. Upload to Minio
	fileName := fmt.Sprintf("orders-export-%d.csv", time.Now().Unix())
	dataReader := bytes.NewReader(csvBuffer.Bytes())

	_, err = h.minioClient.PutObject(ctx, h.bucketName, fileName, dataReader, int64(csvBuffer.Len()), minio.PutObjectOptions{
		ContentType: "text/csv",
	})
	if err != nil {
		log.Printf("Failed to upload to minio: %v", err)
		return nil, fmt.Errorf("failed to upload to minio: %v", err)
	}

	// 5. Generate Presigned URL
	reqParams := make(map[string][]string)
	reqParams["response-content-disposition"] = []string{fmt.Sprintf("attachment; filename=\"%s\"", fileName)}

	presignedURL, err := h.minioClient.PresignedGetObject(context.Background(), h.bucketName, fileName, time.Hour*1, reqParams)
	if err != nil {
		log.Printf("Failed to generate presigned URL: %v", err)
		return nil, fmt.Errorf("failed to generate presigned URL: %v", err)
	}

	// 6. Return response
	return map[string]string{
		"downloadUrl": presignedURL.String(),
		"fileName":    fileName,
		"status":      "SUCCESS",
	}, nil
}
