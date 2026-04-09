package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"common-golang/kafka"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func main() {
	log.Println("Starting export-service...")

	// 1. Initialize Minio Client
	endpoint := os.Getenv("MINIO_ENDPOINT")
	if endpoint == "" {
		endpoint = "minio:9000"
	}
	accessKeyID := os.Getenv("MINIO_ACCESS_KEY")
	if accessKeyID == "" {
		accessKeyID = "admin"
	}
	secretAccessKey := os.Getenv("MINIO_SECRET_KEY")
	if secretAccessKey == "" {
		secretAccessKey = "password"
	}

	minioClient, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKeyID, secretAccessKey, ""),
		Secure: false,
	})
	if err != nil {
		log.Fatalf("Failed to initialize Minio client: %v", err)
	}

	ctx := context.Background()
	bucketName := "exports"
	err = minioClient.MakeBucket(ctx, bucketName, minio.MakeBucketOptions{})
	if err != nil {
		exists, errBucketExists := minioClient.BucketExists(ctx, bucketName)
		if errBucketExists == nil && exists {
			log.Printf("We already own %s\n", bucketName)
		} else {
			log.Fatalf("Failed to create bucket: %v", err)
		}
	} else {
		log.Printf("Successfully created %s\n", bucketName)
	}

	// 2. Initialize Kafka Client
	brokers := []string{"kafka:9092"}
	if b := os.Getenv("KAFKA_BROKERS"); b != "" {
		brokers = []string{b}
	}

	cfg := &kafka.Config{
		Brokers:   brokers,
		ClusterID: "export-service",
	}

	client, err := kafka.NewClient(ctx, cfg)
	if err != nil {
		log.Fatalf("Failed to create Kafka client: %v", err)
	}
	defer client.Close()

	// 2.a Initialize separate client for Localhost Presigned URL generation
	localMinioClient, _ := minio.New("localhost:9000", &minio.Options{
		Creds:  credentials.NewStaticV4(accessKeyID, secretAccessKey, ""),
		Secure: false,
		Region: "us-east-1", // Force region to avoid network location lookup!
	})

	// 3. Register Handler
	handler := NewExportHandler(client, minioClient, localMinioClient, bucketName)
	router := kafka.NewRouter()
	router.Handle("/exports/orders", handler.HandleExportOrders)

	// Topics to listen for requests
	topics := []string{"export-service-topic"}

	reqHandler, err := kafka.NewRequestHandlerWithTopics(ctx, cfg, topics, router)
	if err != nil {
		log.Fatalf("Failed to create RequestHandler: %v", err)
	}
	defer reqHandler.Close()

	// Wait for interrupt
	sigchan := make(chan os.Signal, 1)
	signal.Notify(sigchan, syscall.SIGINT, syscall.SIGTERM)
	<-sigchan

	log.Println("Shutting down export-service...")
	time.Sleep(1 * time.Second)
}
