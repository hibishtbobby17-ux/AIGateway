package middleware

import "testing"

func TestOAuthAuthorizeRequiresAuthentication(t *testing.T) {
	tests := []struct {
		path   string
		public bool
	}{
		{path: "/oauth/authorize", public: false},
		{path: "/oauth/token", public: true},
		{path: "/oauth/revoke", public: true},
		{path: "/.well-known/jwks.json", public: true},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			if got := isPublicEndpoint(test.path); got != test.public {
				t.Fatalf("isPublicEndpoint(%q) = %t, want %t", test.path, got, test.public)
			}
		})
	}
}
