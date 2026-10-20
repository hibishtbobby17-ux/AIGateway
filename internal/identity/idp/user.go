package idp

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrUserNotFound        = errors.New("user not found")
	ErrInvalidCredentials  = errors.New("invalid username or password")
	ErrUserAlreadyExists   = errors.New("username already registered for tenant")
	ErrUserInactive        = errors.New("user account is inactive")
	ErrPasswordTooShort    = errors.New("password must contain at least 8 characters")
)

// User represents a tenant-scoped built-in identity account.
type User struct {
	ID           string    `json:"id"`
	TenantID     string    `json:"tenant_id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Roles        []string  `json:"roles"`
	Active       bool      `json:"active"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// UserRepository provides storage and authentication for built-in users.
type UserRepository interface {
	CreateUser(ctx context.Context, u *User, rawPassword string) error
	Authenticate(ctx context.Context, tenantID, username, password string) (*User, error)
	GetUserByID(ctx context.Context, tenantID, id string) (*User, error)
	GetUserByUsername(ctx context.Context, tenantID, username string) (*User, error)
	GetUserByUsernameGlobal(ctx context.Context, username string) (*User, error)
}

// SQLUserRepository implements UserRepository with SQL storage and bcrypt hashing.
type SQLUserRepository struct {
	db       *sql.DB
	hashCost int
}

// NewSQLUserRepository creates a new SQL user repository.
func NewSQLUserRepository(db *sql.DB, hashCost int) (*SQLUserRepository, error) {
	if db == nil {
		return nil, errors.New("database handle cannot be nil")
	}
	if hashCost < bcrypt.MinCost || hashCost > bcrypt.MaxCost {
		hashCost = bcrypt.DefaultCost
	}
	return &SQLUserRepository{db: db, hashCost: hashCost}, nil
}

// CreateUser persists a new user with bcrypt password hashing.
func (r *SQLUserRepository) CreateUser(ctx context.Context, u *User, rawPassword string) error {
	if u == nil {
		return errors.New("user cannot be nil")
	}
	if u.TenantID == "" || u.Username == "" {
		return errors.New("tenant_id and username are required")
	}
	if len(rawPassword) < 8 {
		return ErrPasswordTooShort
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(rawPassword), r.hashCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	u.PasswordHash = string(hash)

	if u.ID == "" {
		idBytes := make([]byte, 16)
		if _, err := rand.Read(idBytes); err != nil {
			return fmt.Errorf("generate user id: %w", err)
		}
		u.ID = hex.EncodeToString(idBytes)
	}

	if len(u.Roles) == 0 {
		u.Roles = []string{"tool-consumer"}
	}
	rolesJSON, err := json.Marshal(u.Roles)
	if err != nil {
		return fmt.Errorf("encode roles: %w", err)
	}

	now := time.Now().UTC()
	u.CreatedAt = now
	u.UpdatedAt = now
	u.Active = true

	query := `
	INSERT INTO users (id, tenant_id, username, email, password_hash, roles, active, created_at, updated_at)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

	_, err = r.db.ExecContext(ctx, query,
		u.ID, u.TenantID, u.Username, u.Email, u.PasswordHash, string(rolesJSON), u.Active, u.CreatedAt, u.UpdatedAt,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return ErrUserAlreadyExists
		}
		return fmt.Errorf("persist user: %w", err)
	}

	return nil
}

// Authenticate verifies the user's password against the stored bcrypt hash.
func (r *SQLUserRepository) Authenticate(ctx context.Context, tenantID, username, password string) (*User, error) {
	var user *User
	var err error
	if tenantID == "" {
		user, err = r.GetUserByUsernameGlobal(ctx, username)
	} else {
		user, err = r.GetUserByUsername(ctx, tenantID, username)
	}
	if err != nil {
		return nil, ErrInvalidCredentials
	}
	if !user.Active {
		return nil, ErrUserInactive
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	return user, nil
}

// GetUserByID retrieves a user by ID scoped to the tenant.
func (r *SQLUserRepository) GetUserByID(ctx context.Context, tenantID, id string) (*User, error) {
	query := `
	SELECT id, tenant_id, username, email, password_hash, roles, active, created_at, updated_at
	FROM users
	WHERE tenant_id = $1 AND id = $2`

	var u User
	var rolesStr string
	err := r.db.QueryRowContext(ctx, query, tenantID, id).Scan(
		&u.ID, &u.TenantID, &u.Username, &u.Email, &u.PasswordHash, &rolesStr, &u.Active, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("query user by id: %w", err)
	}

	if rolesStr != "" {
		_ = json.Unmarshal([]byte(rolesStr), &u.Roles)
	}
	return &u, nil
}

// GetUserByUsername retrieves a user by username scoped to the tenant.
func (r *SQLUserRepository) GetUserByUsername(ctx context.Context, tenantID, username string) (*User, error) {
	query := `
	SELECT id, tenant_id, username, email, password_hash, roles, active, created_at, updated_at
	FROM users
	WHERE tenant_id = $1 AND username = $2`

	var u User
	var rolesStr string
	err := r.db.QueryRowContext(ctx, query, tenantID, username).Scan(
		&u.ID, &u.TenantID, &u.Username, &u.Email, &u.PasswordHash, &rolesStr, &u.Active, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("query user by username: %w", err)
	}

	if rolesStr != "" {
		_ = json.Unmarshal([]byte(rolesStr), &u.Roles)
	}
	return &u, nil
}

// GetUserByUsernameGlobal retrieves a user by username across all tenants.
func (r *SQLUserRepository) GetUserByUsernameGlobal(ctx context.Context, username string) (*User, error) {
	query := `
	SELECT id, tenant_id, username, email, password_hash, roles, active, created_at, updated_at
	FROM users
	WHERE username = $1
	LIMIT 1`

	var u User
	var rolesStr string
	err := r.db.QueryRowContext(ctx, query, username).Scan(
		&u.ID, &u.TenantID, &u.Username, &u.Email, &u.PasswordHash, &rolesStr, &u.Active, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("query user by username global: %w", err)
	}

	if rolesStr != "" {
		_ = json.Unmarshal([]byte(rolesStr), &u.Roles)
	}
	return &u, nil
}
