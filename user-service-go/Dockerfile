FROM golang:alpine AS build

RUN apk add --no-cache git

WORKDIR /app
COPY common-golang /app/common-golang

WORKDIR /app/user-service-go
COPY user-service-go/go.mod user-service-go/go.sum* ./
# We will download via module cache if possible, otherwise rely on mod replacement locally

COPY user-service-go/main.go ./
# Run mod tidy in container to dynamically fetch lib/pq natively while parsing replace directives
RUN go mod tidy
RUN go build -o /app/target/user-service-go

FROM alpine:latest
WORKDIR /app
COPY --from=build /app/target/user-service-go ./
CMD ["./user-service-go"]
