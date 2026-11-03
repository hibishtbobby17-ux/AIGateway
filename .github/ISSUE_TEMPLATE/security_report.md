---
name: "\U0001F512 Security Issue / Hardening Report"
about: Report a non-critical security hardening issue, auth/policy bug, or guardrail bypass
title: "[SECURITY] "
labels: ["security", "triage"]
assignees: ["hibishtbobby17-ux"]
---

> **IMPORTANT**: For critical or unpatched zero-day vulnerabilities, please do **not** file a public ticket. Instead, review our [Security Policy (`SECURITY.md`)](../../SECURITY.md) and submit a [Private Security Advisory](https://github.com/hibishtbobby17-ux/AIGateway/security/advisories/new).

## Security Finding Overview
<!-- Describe the security issue, configuration gap, or hardening recommendation. -->

## Security Domain
- [ ] **OAuth 2.1 / OIDC / JWT Verification** (`internal/identity/`)
- [ ] **RBAC / ABAC Policy Engine & Tenant Isolation** (`internal/policy/`, `internal/tenants/`)
- [ ] **SSRF Guard / Outbound Egress Dialer** (`internal/resilience/`)
- [ ] **AI Guardrails (PII Redaction, Prompt Injection, Content Safety)**
- [ ] **Cryptographic Storage / TLS / mTLS** (`gateway/`, `internal/storage/`)
- [ ] **CI/CD / Container / Dependency Vulnerability (CVE)**

## Reproduction or Verification Steps
1. 
2. 
3. 

## Security Impact & Severity
- **Estimated Severity**: (Critical / High / Medium / Low / Informational)
- **Potential Impact**: 

## Recommended Mitigation
<!-- Suggest how the control or validation should be strengthened. -->
