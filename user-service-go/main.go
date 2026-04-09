package main

import (
	"context"
	"database/sql"
	"log"
	"time"

	"common-golang/kafka"
	"common-golang/message"

	_ "github.com/lib/pq"
)

type User struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

func main() {
	log.Println("Starting user-service-go...")

	connStr := "user=user password=password dbname=userdb host=postgres sslmode=disable"
	var db *sql.DB
	var err error

	for i := 0; i < 10; i++ {
		db, err = sql.Open("postgres", connStr)
		if err == nil {
			err = db.Ping()
			if err == nil {
				log.Println("Connected to PostgreSQL")
				break
			}
		}
		log.Println("Waiting for PostgreSQL...")
		time.Sleep(2 * time.Second)
	}

	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	cfg := &kafka.Config{
		ClusterID: "e-commerce",
		NodeID:    "user-service-go",
		Brokers:   []string{"kafka:9092"},
	}

	router := kafka.NewRouter()
	router.Handle("/users-go", func(ctx context.Context, msg *message.Message) (any, error) {
		rows, err := db.Query("SELECT id, name, email FROM users")
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		var users []User
		for rows.Next() {
			var u User
			if err := rows.Scan(&u.ID, &u.Name, &u.Email); err != nil {
				return nil, err
			}
			users = append(users, u)
		}
		return users, nil
	})

	ctx := context.Background()
	var handler *kafka.RequestHandler
	for i := 0; i < 15; i++ {
		handler, err = kafka.NewRequestHandlerWithTopics(ctx, cfg, []string{"user-service-go-topic"}, router)
		if err == nil {
			break
		}
		log.Printf("Waiting for Kafka... (%v)", err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		log.Fatalf("Failed to create RequestHandler: %v", err)
	}
	defer handler.Close()

	log.Println("user-service-go running and listening on user-service-go-topic!")
	select {}
}
