# Security Policy

## Overview

AIGateway is an enterprise-grade AI Gateway and Observability Platform unifying the Model Context Protocol (MCP), Agent-to-Agent (A2A) protocol, and a Universal Multi-Cloud LLM Gateway. Security, tenant isolation, cryptographic integrity, and zero-trust outbound networking are foundational to this project.

---

## Supported Versions

The following versions of AIGateway are currently supported with security updates and vulnerability patches:

| Version | Branch / Tag | Supported |
| :--- | :--- | :--- |
| `1.0.x` (Latest) | `main` / `v1.0.*` | :white_check_mark: Yes |
| `< 1.0.0` | Pre-release | :x: No |

---

## Built-in Security Controls

AIGateway enforces defense-in-depth across both the Control Plane and Data Plane:

1. **Enterprise Identity & OAuth 2.1 (PKCE S256)**:
   - Full OAuth 2.1 authorization code flow with mandatory `S256` PKCE, confidential client credentials, JWKS key rotation, and durable token revocation checks (fail-closed).
2. **Cryptographic Storage & Secret Protection**:
   - AES-256-GCM authenticated encryption for stored credentials, signing keys, and spooled offline events.
3. **SSRF-Safe Outbound Dialer & Anti-Relay Protection**:
   - Blocks private RFC 1918 networks, loopback (`127.0.0.0/8`, `::1`), and cloud metadata services (`169.254.169.254`) in production mode, and strips inbound bearer tokens before upstream relay.
4. **AI Guardrails & Telemetry Redaction**:
   - Real-time PII and credential masking (SSN, email, AWS keys, bearer tokens), prompt injection / jailbreak blocking, and malicious payload filtering prior to upstream LLM dispatch.
5. **Multi-Tenant Isolation (RBAC + ABAC)**:
   - Strict project and tenant scoping across MCP tool catalogs, A2A agent registries, task state stores, and observability trace queries.

---

## Reporting a Vulnerability

We take all security vulnerabilities seriously.

### 1. Private Vulnerability Reporting (Preferred for Critical / High Severity)
- **Do NOT open a public GitHub issue for unpatched zero-day or critical vulnerabilities.**
- Please use **[GitHub Private Vulnerability Reporting](https://github.com/hibishtbobby17-ux/AIGateway/security/advisories/new)** in the repository's **Security** tab.

### 2. Security Enhancement / Non-Sensitive Security Issues
- For non-sensitive security hardening suggestions, configuration questions, or dependency updates, use the **[Security Report Issue Template](https://github.com/hibishtbobby17-ux/AIGateway/issues/new?template=security_report.md)**.

### What to Include in Your Report
Please provide as much of the following information as possible to help us triage and reproduce the issue quickly:
- **Affected Component**: Data Plane Gateway (`gateway/`), Control Plane (`cmd/control-plane/`), Console (`console/`), Telemetry Ingest (`ingest/`), OAuth/OIDC Identity (`internal/identity/`), or Deployment/Helm charts (`deployments/`).
- **Vulnerability Category**: e.g., Authentication Bypass, SSRF, Tenant Isolation Leak, Prompt Injection Bypass, Cryptographic Weakness, or Dependency CVE.
- **Step-by-Step Reproduction / Proof of Concept (PoC)**: Request payloads, configuration settings, and observed vs. expected behavior.
- **Impact Assessment**: Potential scope of compromise and CVSS estimate if known.

---

## Automated Security Scanning in CI/CD

Every commit, pull request, and release runs through the automated security phase in [`.github/workflows/ci.yaml`](.github/workflows/ci.yaml) and [`.github/workflows/release.yaml`](.github/workflows/release.yaml):
- **Go Static Analysis & Vulnerability Scanning**: `go vet ./...` and `govulncheck ./...`
- **Filesystem & Dependency CVE Scanning**: Trivy vulnerability scanner (`aquasecurity/trivy-action`) & `npm audit`
- **Automated Security Test Suite**: `go test -v ./tests/security/...` verifying OAuth 2.1 PKCE enforcement, client secret authentication, cross-tenant isolation, and token revocation/tampering rejection

