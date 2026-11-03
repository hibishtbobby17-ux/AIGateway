package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"AIGateway/internal/config"
	"AIGateway/internal/storage"
	"AIGateway/migrations"
)

func main() {
	var (
		direction = flag.String("direction", "up", "Migration direction: up or down")
	)
	flag.Parse()

	cfg := config.NewDefaultConfig()
	cfg.LoadFromEnv()

	if cfg.Database.URL == "" {
		fmt.Fprintf(os.Stderr, "Error: database URL must be configured via YAML or GATEWAY_DATABASE_URL\n")
		os.Exit(1)
	}

	fmt.Printf("AI Gateway Migration Tool\n")
	fmt.Printf("Driver: %s | Direction: %s\n", cfg.Database.Driver, *direction)

	db, err := storage.OpenDB(&cfg.Database)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error connecting to database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	switch *direction {
	case "up":
		fmt.Println("Applying pending schema migrations...")
		if err := migrations.MigrateUp(ctx, db); err != nil {
			fmt.Fprintf(os.Stderr, "Migration failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("Schema migrations applied successfully.")

	case "down":
		fmt.Println("Rolling back schema migrations...")
		if err := migrations.MigrateDown(ctx, db); err != nil {
			fmt.Fprintf(os.Stderr, "Rollback failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("Schema rollback completed successfully.")

	default:
		fmt.Fprintf(os.Stderr, "Unknown direction %q: must be 'up' or 'down'\n", *direction)
		os.Exit(1)
	}
}
