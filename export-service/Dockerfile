FROM golang:alpine

WORKDIR /app

# Copy common library for module replacement
COPY common-golang /app/common-golang

COPY export-service/ ./export-service/
WORKDIR /app/export-service
RUN go mod tidy
RUN go build -o export-service

CMD ["./export-service"]
