package session

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	"AIGateway/internal/mcp/protocol"
)

// Session represents an active MCP client connection.
type Session struct {
	ID           string
	TenantID     string
	MessageChan  chan *protocol.Response
	CreatedAt    time.Time
	LastActivity time.Time
}

// Manager maintains active client sessions.
type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

// NewManager creates a session manager.
func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

// CreateSession generates a new session for an SSE connection.
func (m *Manager) CreateSession(tenantID string) *Session {
	idBytes := make([]byte, 16)
	_, _ = rand.Read(idBytes)
	id := hex.EncodeToString(idBytes)

	now := time.Now()
	s := &Session{
		ID:           id,
		TenantID:     tenantID,
		MessageChan:  make(chan *protocol.Response, 100),
		CreatedAt:    now,
		LastActivity: now,
	}

	m.mu.Lock()
	m.sessions[id] = s
	m.mu.Unlock()

	return s
}

// GetSession retrieves an existing active session.
func (m *Manager) GetSession(id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	s, ok := m.sessions[id]
	if ok {
		s.LastActivity = time.Now()
	}
	return s, ok
}

// CloseSession closes and removes an expired or disconnected session.
func (m *Manager) CloseSession(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if s, ok := m.sessions[id]; ok {
		close(s.MessageChan)
		delete(m.sessions, id)
	}
}
