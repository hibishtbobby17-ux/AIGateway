# AI Gateway and Observability Platform Makefile
# Provides cross-platform building, testing, linting, Docker and Helm operations.

.PHONY: all build clean test test-deployment lint docker-build compose-up compose-down helm-lint helm-template help

BIN_DIR := bin
VERSION ?= 1.0.0
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "dev")
LDFLAGS := -s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT)

CHART_DIR := deployments/helm/ai-gateway-platform
COMPOSE_FILE := deployments/compose/docker-compose.yml

all: build

## help: Display available targets
help:
	@echo "Available commands:"
	@echo "  make build           - Build all Go binaries (gateway, control-plane, migrate, dev-seed)"
	@echo "  make test            - Run all unit and integration tests"
	@echo "  make test-deployment - Run deployment and helm smoke tests"
	@echo "  make lint            - Run code formatting and static analysis checks"
	@echo "  make docker-build    - Build production Docker images for all services"
	@echo "  make compose-up      - Start the full platform via Docker Compose"
	@echo "  make compose-down    - Stop the Docker Compose deployment"
	@echo "  make helm-lint       - Lint the platform umbrella Helm chart"
	@echo "  make helm-template   - Render and validate Helm chart templates"
	@echo "  make clean           - Remove built binaries and temporary artifacts"

## build: Compile all executable entry points
build:
	@echo "Building binaries..."
	@mkdir -p $(BIN_DIR)
	go build -trimpath -ldflags="$(LDFLAGS)" -o $(BIN_DIR)/gateway ./cmd/gateway
	go build -trimpath -ldflags="$(LDFLAGS)" -o $(BIN_DIR)/control-plane ./cmd/control-plane
	go build -trimpath -ldflags="$(LDFLAGS)" -o $(BIN_DIR)/migrate ./cmd/migrate
	go build -trimpath -ldflags="$(LDFLAGS)" -o $(BIN_DIR)/dev-seed ./cmd/dev-seed
	@echo "Build complete. Executables placed in $(BIN_DIR)/"

## test: Run all project tests
test:
	@echo "Running all tests..."
	go test -v -race ./...

## test-deployment: Run deployment and release readiness tests
test-deployment:
	@echo "Running deployment tests..."
	go test -v ./tests/deployment/...

## lint: Check Go code and Helm templates
lint:
	@echo "Checking Go code..."
	go vet ./...
	@if command -v golangci-lint >/dev/null 2>&1; then \
		golangci-lint run; \
	fi
	@echo "Linting Helm chart..."
	@if command -v helm >/dev/null 2>&1; then \
		helm lint $(CHART_DIR); \
	fi

## docker-build: Build container images for each platform component
docker-build:
	@echo "Building Docker images..."
	docker build -t ghcr.io/organization/ai-gateway:$(VERSION) -f deployments/docker/Dockerfile.gateway .
	docker build -t ghcr.io/organization/ai-control-plane:$(VERSION) -f deployments/docker/Dockerfile.control-plane .
	docker build -t ghcr.io/organization/ai-gateway-migrate:$(VERSION) -f deployments/docker/Dockerfile.migrate .
	docker build -t ghcr.io/organization/ai-dev-seed:$(VERSION) -f deployments/docker/Dockerfile.dev-seed .
	@echo "Docker images successfully built."

## compose-up: Start full platform in background
compose-up:
	@echo "Starting Docker Compose platform..."
	docker compose -f $(COMPOSE_FILE) up -d
	@echo "Platform started. Gateway: http://localhost:8080, Console: http://localhost:8081"

## compose-down: Stop full platform
compose-down:
	@echo "Stopping Docker Compose platform..."
	docker compose -f $(COMPOSE_FILE) down

## helm-lint: Lint the Helm umbrella chart
helm-lint:
	helm lint $(CHART_DIR)

## helm-template: Dry-run Helm template generation
helm-template:
	helm template test-release $(CHART_DIR)

## clean: Clean built artifacts
clean:
	@echo "Cleaning artifacts..."
	rm -rf $(BIN_DIR)
	@echo "Clean completed."
