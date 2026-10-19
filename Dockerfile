# Multi-stage build for AI Gateway
FROM golang:1.23-alpine AS builder

WORKDIR /app

# Cache dependencies
COPY go.mod go.sum* ./
RUN go mod download || true

# Copy source code
COPY . .

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /bin/gateway ./cmd/gateway
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /bin/control-plane ./cmd/control-plane
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /bin/migrate ./cmd/migrate

# Minimal production image
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY --from=builder /bin/gateway /bin/gateway
COPY --from=builder /bin/control-plane /bin/control-plane
COPY --from=builder /bin/migrate /bin/migrate
COPY configs/ /app/configs/

USER nonroot:nonroot

EXPOSE 8080 8081

ENTRYPOINT ["/bin/gateway"]
