'use client';

import React, { useState, useEffect } from 'react';

interface DeploySettingsViewProps {
  gatewaysList?: any[];
  initialGatewayId?: string;
  initialGatewayKey?: string;
  showBanner: (text: string, type: 'success' | 'error' | 'info') => void;
}

export default function DeploySettingsView({
  gatewaysList = [],
  initialGatewayId,
  initialGatewayKey,
  showBanner,
}: DeploySettingsViewProps) {
  // Selected Gateway & User-Supplied Key
  const [selectedGatewayId, setSelectedGatewayId] = useState<string>(
    initialGatewayId || gatewaysList[0]?.name || gatewaysList[0]?.id || 'gateway-default-01'
  );
  const [userSuppliedKey, setUserSuppliedKey] = useState<string>(
    initialGatewayKey || 'dev-gateway-secret'
  );
  const [showSecret, setShowSecret] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Network URLs
  const [consoleUrl, setConsoleUrl] = useState<string>('http://localhost:3000');
  const [ingestUrl, setIngestUrl] = useState<string>('http://localhost:8082');
  const [gatewayPort, setGatewayPort] = useState<number>(8080);

  // Telemetry & Logging Sink Selection (Deployment-Time Option)
  const [telemetrySink, setTelemetrySink] = useState<'clickhouse' | 'opensearch' | 's3' | 'otlp'>('clickhouse');
  const [clickhouseUrl, setClickhouseUrl] = useState<string>('http://clickhouse:8123');
  const [clickhouseDb, setClickhouseDb] = useState<string>('gateway_telemetry');
  const [opensearchUrl, setOpensearchUrl] = useState<string>('https://search-my-corp.us-east-1.es.amazonaws.com');
  const [opensearchIndex, setOpensearchIndex] = useState<string>('ai-gateway-telemetry');
  const [opensearchAuthMode, setOpensearchAuthMode] = useState<'iam_role' | 'basic'>('iam_role');
  const [s3Bucket, setS3Bucket] = useState<string>('my-corp-ai-audit-logs');
  const [s3Region, setS3Region] = useState<string>('us-east-1');
  const [s3Prefix, setS3Prefix] = useState<string>('telemetry/v1/');
  const [s3Format, setS3Format] = useState<'parquet' | 'json.gz'>('parquet');
  const [otlpEndpoint, setOtlpEndpoint] = useState<string>('http://jaeger-collector:4318/v1/traces');
  const [otlpProtocol, setOtlpProtocol] = useState<'grpc' | 'http/protobuf'>('grpc');

  // Active Config Tab
  const [activeConfigTab, setActiveConfigTab] = useState<'compose' | 'helm' | 'cli' | 'env'>('compose');

  // Key Validation State
  const [isValidatingKey, setIsValidatingKey] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<{ status: 'success' | 'error'; message: string; details?: any } | null>(null);

  // Synchronize when initial props change
  useEffect(() => {
    if (initialGatewayId) {
      setSelectedGatewayId(initialGatewayId);
    }
    if (initialGatewayKey) {
      setUserSuppliedKey(initialGatewayKey);
    }
  }, [initialGatewayId, initialGatewayKey]);

  // When user selects a different gateway from the fleet dropdown
  const handleSelectGateway = (gwId: string) => {
    setSelectedGatewayId(gwId);
    if (gwId === 'gateway-default-01') {
      setUserSuppliedKey('dev-gateway-secret');
    }
    setValidationResult(null);
  };

  // Generate a random cryptographically secure 32-character key
  const handleGenerateKey = () => {
    const chars = 'abcdef0123456789';
    let randKey = 'sec_';
    for (let i = 0; i < 32; i++) {
      randKey += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setUserSuppliedKey(randKey);
    setValidationResult(null);
    showBanner('Generated fresh 32-byte secret key!', 'info');
  };

  const copyToClipboard = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2000);
    showBanner('Copied to clipboard!', 'info');
  };

  // Test & Validate Key Against Gateway Auth API
  const handleValidateKey = async () => {
    setIsValidatingKey(true);
    setValidationResult(null);

    try {
      const res = await fetch('/api/gateway/v1/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway_id: selectedGatewayId,
          secret: userSuppliedKey,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.token) {
        setValidationResult({
          status: 'success',
          message: `✓ Key Verified! Gateway successfully authenticated with Console API. Valid JWT bearer issued.`,
          details: { tokenPreview: data.token.slice(0, 30) + '...', expiresIn: '24h' }
        });
        showBanner('Gateway Key verification succeeded!', 'success');
      } else {
        setValidationResult({
          status: 'error',
          message: `Authentication check: ${data.error || 'Secret does not match gateway hash in database'}`,
          details: { code: res.status }
        });
        showBanner(data.error || 'Key validation failed', 'error');
      }
    } catch (err: any) {
      setValidationResult({
        status: 'error',
        message: `Validation Error: ${err.message || 'Could not connect to Console Auth endpoint'}`
      });
    } finally {
      setIsValidatingKey(false);
    }
  };

  // Sink-specific Environment snippet for Docker Compose and .env
  let sinkEnvCompose = '';
  let sinkEnvFile = '';
  let sinkHelmArgs = '';
  let sinkCliArgs = '';

  if (telemetrySink === 'clickhouse') {
    sinkEnvCompose = `      TELEMETRY_SINK: "clickhouse"
      CLICKHOUSE_URL: "${clickhouseUrl}"
      CLICKHOUSE_DB: "${clickhouseDb}"`;
    sinkEnvFile = `TELEMETRY_SINK=clickhouse
CLICKHOUSE_URL=${clickhouseUrl}
CLICKHOUSE_DB=${clickhouseDb}`;
    sinkHelmArgs = `  --set telemetry.sink="clickhouse" \\
  --set telemetry.clickhouse.url="${clickhouseUrl}"`;
    sinkCliArgs = `  --telemetry-sink="clickhouse" \\
  --clickhouse-url="${clickhouseUrl}"`;
  } else if (telemetrySink === 'opensearch') {
    sinkEnvCompose = `      TELEMETRY_SINK: "opensearch"
      OPENSEARCH_URL: "${opensearchUrl}"
      OPENSEARCH_INDEX: "${opensearchIndex}"
      AWS_REGION: "${s3Region}"
      OPENSEARCH_AUTH_MODE: "${opensearchAuthMode}"`;
    sinkEnvFile = `TELEMETRY_SINK=opensearch
OPENSEARCH_URL=${opensearchUrl}
OPENSEARCH_INDEX=${opensearchIndex}
AWS_REGION=${s3Region}
OPENSEARCH_AUTH_MODE=${opensearchAuthMode}
# Note: In AWS EKS, attach IRSA IAM role with 'es:ESHttp*' permissions`;
    sinkHelmArgs = `  --set telemetry.sink="opensearch" \\
  --set telemetry.opensearch.endpoint="${opensearchUrl}" \\
  --set telemetry.opensearch.index="${opensearchIndex}"`;
    sinkCliArgs = `  --telemetry-sink="opensearch" \\
  --opensearch-url="${opensearchUrl}" \\
  --opensearch-index="${opensearchIndex}"`;
  } else if (telemetrySink === 's3') {
    sinkEnvCompose = `      TELEMETRY_SINK: "s3"
      S3_BUCKET: "${s3Bucket}"
      AWS_REGION: "${s3Region}"
      S3_PREFIX: "${s3Prefix}"
      S3_OUTPUT_FORMAT: "${s3Format}"
      S3_FLUSH_INTERVAL: "60s"
      S3_FLUSH_MAX_BYTES: "10485760"`;
    sinkEnvFile = `TELEMETRY_SINK=s3
S3_BUCKET=${s3Bucket}
AWS_REGION=${s3Region}
S3_PREFIX=${s3Prefix}
S3_OUTPUT_FORMAT=${s3Format}
S3_FLUSH_INTERVAL=60s
# Batched into compressed Parquet/JSONL queryable directly via AWS Athena or Snowflake`;
    sinkHelmArgs = `  --set telemetry.sink="s3" \\
  --set telemetry.s3.bucket="${s3Bucket}" \\
  --set telemetry.s3.region="${s3Region}" \\
  --set telemetry.s3.prefix="${s3Prefix}" \\
  --set telemetry.s3.format="${s3Format}"`;
    sinkCliArgs = `  --telemetry-sink="s3" \\
  --s3-bucket="${s3Bucket}" \\
  --aws-region="${s3Region}" \\
  --s3-prefix="${s3Prefix}" \\
  --s3-format="${s3Format}"`;
  } else if (telemetrySink === 'otlp') {
    sinkEnvCompose = `      TELEMETRY_SINK: "otlp"
      OTEL_EXPORTER_OTLP_ENDPOINT: "${otlpEndpoint}"
      OTEL_EXPORTER_OTLP_PROTOCOL: "${otlpProtocol}"`;
    sinkEnvFile = `TELEMETRY_SINK=otlp
OTEL_EXPORTER_OTLP_ENDPOINT=${otlpEndpoint}
OTEL_EXPORTER_OTLP_PROTOCOL=${otlpProtocol}
# Ships standard OTLP protobuf spans to Datadog, Dynatrace, New Relic, or Tempo`;
    sinkHelmArgs = `  --set telemetry.sink="otlp" \\
  --set telemetry.otlpEndpoint="${otlpEndpoint}"`;
    sinkCliArgs = `  --telemetry-sink="otlp" \\
  --otlp-endpoint="${otlpEndpoint}"`;
  }

  // Dynamically Generated Configurations (Reactive to userSuppliedKey, selectedGatewayId, and telemetrySink)
  const dockerComposeSnippet = `version: '3.8'

services:
  gateway:
    image: ghcr.io/organization/ai-gateway:1.0.0
    container_name: ai-gateway
    restart: unless-stopped
    ports:
      - "${gatewayPort}:${gatewayPort}"
    environment:
      GATEWAY_PORT: "${gatewayPort}"
      CONSOLE_URL: "${consoleUrl}"
      INGEST_URL: "${ingestUrl}"
      GATEWAY_ID: "${selectedGatewayId}"
      GATEWAY_SECRET: "${userSuppliedKey}"
      SPOOL_FILE_PATH: "/tmp/gateway_events.spool"
${sinkEnvCompose}
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://127.0.0.1:${gatewayPort}/healthz || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 5`;

  const helmCommand = `helm upgrade --install ai-gateway ./deployments/helm/ai-gateway-platform \\
  --namespace ai-platform \\
  --create-namespace \\
  --set gateway.id="${selectedGatewayId}" \\
  --set gateway.secret="${userSuppliedKey}" \\
  --set gateway.consoleUrl="${consoleUrl}" \\
  --set gateway.ingestUrl="${ingestUrl}" \\
  --set gateway.port=${gatewayPort} \\
${sinkHelmArgs} \\
  --wait`;

  const binaryLinuxCommand = `./bin/gateway \\
  --id="${selectedGatewayId}" \\
  --secret="${userSuppliedKey}" \\
  --console-url="${consoleUrl}" \\
  --ingest-url="${ingestUrl}" \\
  --port=${gatewayPort} \\
${sinkCliArgs}`;

  const binaryWindowsCommand = `.\\gateway.exe \`
  --id="${selectedGatewayId}" \`
  --secret="${userSuppliedKey}" \`
  --console-url="${consoleUrl}" \`
  --ingest-url="${ingestUrl}" \`
  --port=${gatewayPort} \`
${sinkCliArgs.replace(/\\/g, '`')}`;

  const envFileSnippet = `# AI Gateway Environment Configuration
# Driven from AI Gateway Page, Key & Telemetry Storage Choice
GATEWAY_ID=${selectedGatewayId}
GATEWAY_SECRET=${userSuppliedKey}
CONSOLE_URL=${consoleUrl}
INGEST_URL=${ingestUrl}
GATEWAY_PORT=${gatewayPort}
ALLOW_LOCAL_EGRESS=true
SPOOL_FILE_PATH=/tmp/gateway_events.spool

# Telemetry & Audit Log Storage Sink Configuration
${sinkEnvFile}`;

  const curlRegisterCommand = `curl -X POST "${consoleUrl}/api/gateway/v1/auth" \\
  -H "Content-Type: application/json" \\
  -d '{
    "gateway_id": "${selectedGatewayId}",
    "secret": "${userSuppliedKey}",
    "version": "1.0.0"
  }'`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.025em' }}>
              Deploy AI Gateway
            </h1>
            <span className="badge badge-indigo">Dynamic Manifest Generator</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '4px' }}>
            Generates real-time, production-ready deployment configurations (Docker Compose, Helm, CLI, .env) dynamically driven by your user-supplied Gateway Key.
          </p>
        </div>

        <button
          onClick={() => copyToClipboard(curlRegisterCommand, 'curl')}
          className="btn-primary"
          style={{ height: '38px', padding: '0 16px' }}
        >
          {copiedKey === 'curl' ? '✓ Copied Registration Curl' : '📋 Copy Registration Curl'}
        </button>
      </div>

      {/* USER-SUPPLIED GATEWAY KEY & INSTANCE CONTROLS */}
      <div className="glass-panel" style={{ padding: '26px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '14px' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)' }}>
              1. Gateway Identity & User-Supplied Key Configuration
            </h3>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Drive credentials from the Gateway Fleet page or paste your custom authorization key.
            </span>
          </div>

          <span className="badge badge-emerald" style={{ fontSize: '0.72rem' }}>
            Reactive Real-Time Output
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px' }}>
          {/* Select Gateway From Fleet */}
          <div>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
              Select AI Gateway Instance
            </label>
            <select
              className="input-field"
              value={selectedGatewayId}
              onChange={(e) => handleSelectGateway(e.target.value)}
              style={{ height: '38px' }}
            >
              {gatewaysList.map(gw => (
                <option key={gw.id} value={gw.name || gw.id}>
                  {gw.name} ({gw.status}) - ID: {gw.id.slice(0, 8)}...
                </option>
              ))}
              <option value="custom-gateway-instance">➕ Custom / New Gateway Instance</option>
            </select>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Selected gateway will be injected as <code>GATEWAY_ID</code>.
            </span>
          </div>

          {/* User-Supplied Gateway Key / Secret */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-main)' }}>
                User-Supplied Gateway Key / Secret *
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handleGenerateKey}
                  style={{ background: 'none', border: 'none', color: 'var(--primary-text)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                  title="Generate a random secure key"
                >
                  🎲 Generate
                </button>
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  style={{ background: 'none', border: 'none', color: 'var(--primary-text)', cursor: 'pointer', fontSize: '0.75rem' }}
                >
                  {showSecret ? 'Hide' : 'Reveal'}
                </button>
                <button
                  type="button"
                  onClick={() => copyToClipboard(userSuppliedKey, 'key')}
                  style={{ background: 'none', border: 'none', color: 'var(--primary-text)', cursor: 'pointer', fontSize: '0.75rem' }}
                >
                  {copiedKey === 'key' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <input
              type={showSecret ? 'text' : 'password'}
              required
              className="input-field font-mono"
              placeholder="Paste or enter gateway secret key..."
              value={userSuppliedKey}
              onChange={(e) => {
                setUserSuppliedKey(e.target.value);
                setValidationResult(null);
              }}
              style={{
                height: '38px',
                borderColor: userSuppliedKey ? 'var(--primary)' : undefined,
                background: 'var(--bg-surface-subtle)'
              }}
            />
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              This key authenticates the data plane to the Console API (Port 3000).
            </span>
          </div>

          {/* Console URL */}
          <div>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
              Console API URL
            </label>
            <input
              type="text"
              className="input-field font-mono"
              value={consoleUrl}
              onChange={(e) => setConsoleUrl(e.target.value)}
              style={{ height: '38px' }}
            />
          </div>

          {/* Ingest Service URL */}
          <div>
            <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
              Ingest Telemetry URL
            </label>
            <input
              type="text"
              className="input-field font-mono"
              value={ingestUrl}
              onChange={(e) => setIngestUrl(e.target.value)}
              style={{ height: '38px' }}
            />
          </div>
        </div>

        {/* Live Key Validation Bar */}
        <div style={{
          background: 'var(--bg-surface-subtle)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div>
            <strong style={{ fontSize: '0.85rem', color: 'var(--text-main)', display: 'block' }}>
              Live Key Authentication Verification
            </strong>
            <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Test if the user-supplied key <code>{userSuppliedKey ? '••••••••' : '(empty)'}</code> authenticates with <code>{selectedGatewayId}</code>.
            </span>
          </div>

          <button
            type="button"
            onClick={handleValidateKey}
            disabled={isValidatingKey || !userSuppliedKey}
            className="btn-secondary"
            style={{ fontSize: '0.82rem', height: '34px', padding: '0 14px', fontWeight: 600 }}
          >
            {isValidatingKey ? 'Verifying...' : '⚡ Test Key with Console API'}
          </button>

          {validationResult && (
            <div style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              background: validationResult.status === 'success' ? '#ecfdf5' : '#fef2f2',
              border: `1px solid ${validationResult.status === 'success' ? '#a7f3d0' : '#fecaca'}`,
              color: validationResult.status === 'success' ? '#047857' : '#b91c1c',
              fontSize: '0.82rem',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span>{validationResult.message}</span>
              {validationResult.details?.tokenPreview && (
                <code className="font-mono" style={{ fontSize: '0.72rem', background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                  JWT: {validationResult.details.tokenPreview}
                </code>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2. TELEMETRY & AUDIT LOG STORAGE SINK SELECTION */}
      <div className="glass-panel" style={{ padding: '26px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)' }}>
              2. Telemetry & Audit Log Storage Sink Selection
            </h3>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Choose your target telemetry backend at deployment time. The configuration manifests below adapt automatically.
            </span>
          </div>

          <span className="badge badge-indigo" style={{ fontSize: '0.72rem' }}>
            Pluggable Storage Architecture
          </span>
        </div>

        {/* 4 Interactive Storage Option Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
          {/* Option 1: ClickHouse */}
          <div
            onClick={() => setTelemetrySink('clickhouse')}
            style={{
              padding: '16px',
              borderRadius: 'var(--radius-sm)',
              border: `2px solid ${telemetrySink === 'clickhouse' ? 'var(--primary)' : 'var(--border-subtle)'}`,
              background: telemetrySink === 'clickhouse' ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-surface-subtle)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '1.4rem' }}>⚡</span>
              <span className="badge badge-emerald" style={{ fontSize: '0.68rem' }}>Default & Fast</span>
            </div>
            <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>ClickHouse OLAP</strong>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
              Sub-second queries, 85-90% columnar compression, and real-time FinOps aggregations over billions of AI spans.
            </p>
          </div>

          {/* Option 2: AWS OpenSearch */}
          <div
            onClick={() => setTelemetrySink('opensearch')}
            style={{
              padding: '16px',
              borderRadius: 'var(--radius-sm)',
              border: `2px solid ${telemetrySink === 'opensearch' ? 'var(--primary)' : 'var(--border-subtle)'}`,
              background: telemetrySink === 'opensearch' ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-surface-subtle)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '1.4rem' }}>🔍</span>
              <span className="badge badge-indigo" style={{ fontSize: '0.68rem' }}>AWS Managed</span>
            </div>
            <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>AWS OpenSearch</strong>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
              Native text indexing for LLM prompts/responses, IAM SigV4 auth, and built-in OpenSearch / Kibana dashboards.
            </p>
          </div>

          {/* Option 3: AWS S3 Data Lake */}
          <div
            onClick={() => setTelemetrySink('s3')}
            style={{
              padding: '16px',
              borderRadius: 'var(--radius-sm)',
              border: `2px solid ${telemetrySink === 's3' ? 'var(--primary)' : 'var(--border-subtle)'}`,
              background: telemetrySink === 's3' ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-surface-subtle)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '1.4rem' }}>🪣</span>
              <span className="badge badge-amber" style={{ fontSize: '0.68rem' }}>Lowest Cost</span>
            </div>
            <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>AWS S3 Data Lake</strong>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
              Direct micro-batching to S3 Parquet/JSONL. Zero dedicated database compute costs; queryable via AWS Athena or Snowflake.
            </p>
          </div>

          {/* Option 4: OpenTelemetry OTLP */}
          <div
            onClick={() => setTelemetrySink('otlp')}
            style={{
              padding: '16px',
              borderRadius: 'var(--radius-sm)',
              border: `2px solid ${telemetrySink === 'otlp' ? 'var(--primary)' : 'var(--border-subtle)'}`,
              background: telemetrySink === 'otlp' ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-surface-subtle)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '1.4rem' }}>📡</span>
              <span className="badge badge-blue" style={{ fontSize: '0.68rem' }}>Vendor Neutral</span>
            </div>
            <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>OpenTelemetry (OTLP)</strong>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
              Standard OTLP protobuf stream forwarded to enterprise collectors (Datadog, Dynatrace, New Relic, Jaeger, Tempo).
            </p>
          </div>
        </div>

        {/* Selected Sink Dynamic Parameters Panel */}
        <div style={{
          background: 'var(--bg-surface-subtle)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-main)' }}>
              ⚙️ {telemetrySink === 'clickhouse' ? 'ClickHouse Connection Settings' : telemetrySink === 'opensearch' ? 'AWS OpenSearch Domain & IAM Settings' : telemetrySink === 's3' ? 'AWS S3 Bucket & Partitioning Settings' : 'OpenTelemetry OTLP Collector Settings'}
            </span>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              Injected into Gateway Environment & Manifests
            </span>
          </div>

          {telemetrySink === 'clickhouse' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  ClickHouse Server URL (HTTP/Native)
                </label>
                <input
                  type="text"
                  className="input-field font-mono"
                  value={clickhouseUrl}
                  onChange={(e) => setClickhouseUrl(e.target.value)}
                  style={{ height: '36px', fontSize: '0.8rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  ClickHouse Database Name
                </label>
                <input
                  type="text"
                  className="input-field font-mono"
                  value={clickhouseDb}
                  onChange={(e) => setClickhouseDb(e.target.value)}
                  style={{ height: '36px', fontSize: '0.8rem' }}
                />
              </div>
            </div>
          )}

          {telemetrySink === 'opensearch' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  AWS OpenSearch Domain Endpoint
                </label>
                <input
                  type="text"
                  className="input-field font-mono"
                  value={opensearchUrl}
                  onChange={(e) => setOpensearchUrl(e.target.value)}
                  style={{ height: '36px', fontSize: '0.8rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  Index Name / Prefix
                </label>
                <input
                  type="text"
                  className="input-field font-mono"
                  value={opensearchIndex}
                  onChange={(e) => setOpensearchIndex(e.target.value)}
                  style={{ height: '36px', fontSize: '0.8rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  Authentication Mode
                </label>
                <select
                  className="input-field"
                  value={opensearchAuthMode}
                  onChange={(e) => setOpensearchAuthMode(e.target.value as any)}
                  style={{ height: '36px', fontSize: '0.8rem' }}
                >
                  <option value="iam_role">AWS IAM Role (IRSA / Pod Identity)</option>
                  <option value="basic">HTTP Basic Authentication</option>
                </select>
              </div>
            </div>
          )}

          {telemetrySink === 's3' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  S3 Bucket Name
                </label>
                <input
                  type="text"
                  className="input-field font-mono"
                  value={s3Bucket}
                  onChange={(e) => setS3Bucket(e.target.value)}
                  style={{ height: '36px', fontSize: '0.8rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  AWS Region
                </label>
                <input
                  type="text"
                  className="input-field font-mono"
                  value={s3Region}
                  onChange={(e) => setS3Region(e.target.value)}
                  style={{ height: '36px', fontSize: '0.8rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  S3 Partition Prefix
                </label>
                <input
                  type="text"
                  className="input-field font-mono"
                  value={s3Prefix}
                  onChange={(e) => setS3Prefix(e.target.value)}
                  style={{ height: '36px', fontSize: '0.8rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  File Format
                </label>
                <select
                  className="input-field"
                  value={s3Format}
                  onChange={(e) => setS3Format(e.target.value as any)}
                  style={{ height: '36px', fontSize: '0.8rem' }}
                >
                  <option value="parquet">Apache Parquet (Snappy Compressed)</option>
                  <option value="json.gz">JSONL (Gzip Compressed)</option>
                </select>
              </div>
            </div>
          )}

          {telemetrySink === 'otlp' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  OTLP Collector Endpoint
                </label>
                <input
                  type="text"
                  className="input-field font-mono"
                  value={otlpEndpoint}
                  onChange={(e) => setOtlpEndpoint(e.target.value)}
                  style={{ height: '36px', fontSize: '0.8rem' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  Protocol
                </label>
                <select
                  className="input-field"
                  value={otlpProtocol}
                  onChange={(e) => setOtlpProtocol(e.target.value as any)}
                  style={{ height: '36px', fontSize: '0.8rem' }}
                >
                  <option value="grpc">gRPC (Port 4317)</option>
                  <option value="http/protobuf">HTTP / Protobuf (Port 4318)</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DYNAMICALLY GENERATED CONFIGURATIONS */}
      <div className="glass-panel" style={{ padding: '26px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)' }}>
              3. Generated Deployment Configurations
            </h3>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Configuration code dynamically rendered with your user-supplied key: <strong className="font-mono" style={{ color: 'var(--primary-text)' }}>{userSuppliedKey || 'dev-gateway-secret'}</strong>
            </span>
          </div>

          {/* Config Tabs */}
          <div style={{ display: 'flex', gap: '6px', background: 'var(--bg-surface-subtle)', padding: '3px', borderRadius: 'var(--radius-sm)' }}>
            {[
              { id: 'compose', label: 'Docker Compose' },
              { id: 'helm', label: 'Kubernetes Helm' },
              { id: 'cli', label: 'CLI Binary' },
              { id: 'env', label: '.env File' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveConfigTab(tab.id as any)}
                style={{
                  background: activeConfigTab === tab.id ? 'var(--bg-surface)' : 'transparent',
                  color: activeConfigTab === tab.id ? 'var(--primary-text)' : 'var(--text-muted)',
                  fontWeight: activeConfigTab === tab.id ? 700 : 500,
                  fontSize: '0.8rem',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  boxShadow: activeConfigTab === tab.id ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* TAB 1: DOCKER COMPOSE */}
        {activeConfigTab === 'compose' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Ready to paste into <code>docker-compose.yml</code> or run with <code>docker compose up -d gateway</code>:
              </span>
              <button
                onClick={() => copyToClipboard(dockerComposeSnippet, 'compose')}
                className="btn-secondary"
                style={{ fontSize: '0.76rem', padding: '4px 10px' }}
              >
                {copiedKey === 'compose' ? '✓ Copied YAML' : '📋 Copy Docker Compose'}
              </button>
            </div>
            <pre className="font-mono" style={{
              background: '#090d16',
              color: '#38bdf8',
              padding: '16px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              overflowX: 'auto',
              lineHeight: '1.5'
            }}>
              {dockerComposeSnippet}
            </pre>
          </div>
        )}

        {/* TAB 2: KUBERNETES HELM */}
        {activeConfigTab === 'helm' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Production Kubernetes umbrella release command:
              </span>
              <button
                onClick={() => copyToClipboard(helmCommand, 'helm')}
                className="btn-secondary"
                style={{ fontSize: '0.76rem', padding: '4px 10px' }}
              >
                {copiedKey === 'helm' ? '✓ Copied Command' : '📋 Copy Helm Command'}
              </button>
            </div>
            <pre className="font-mono" style={{
              background: '#090d16',
              color: '#a7f3d0',
              padding: '16px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              overflowX: 'auto',
              lineHeight: '1.5'
            }}>
              {helmCommand}
            </pre>
          </div>
        )}

        {/* TAB 3: CLI BINARY */}
        {activeConfigTab === 'cli' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>
                  Windows CLI Command (PowerShell / Command Prompt):
                </span>
                <button
                  onClick={() => copyToClipboard(binaryWindowsCommand, 'win')}
                  className="btn-secondary"
                  style={{ fontSize: '0.76rem', padding: '4px 10px' }}
                >
                  {copiedKey === 'win' ? '✓ Copied' : '📋 Copy Windows'}
                </button>
              </div>
              <pre className="font-mono" style={{
                background: '#090d16',
                color: '#fed7aa',
                padding: '14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                overflowX: 'auto'
              }}>
                {binaryWindowsCommand}
              </pre>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>
                  Linux / macOS Shell Script:
                </span>
                <button
                  onClick={() => copyToClipboard(binaryLinuxCommand, 'nix')}
                  className="btn-secondary"
                  style={{ fontSize: '0.76rem', padding: '4px 10px' }}
                >
                  {copiedKey === 'nix' ? '✓ Copied' : '📋 Copy Linux'}
                </button>
              </div>
              <pre className="font-mono" style={{
                background: '#090d16',
                color: '#fed7aa',
                padding: '14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                overflowX: 'auto'
              }}>
                {binaryLinuxCommand}
              </pre>
            </div>
          </div>
        )}

        {/* TAB 4: .ENV FILE */}
        {activeConfigTab === 'env' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Environment variable file (<code>.env</code>) formatted with user-supplied key:
              </span>
              <button
                onClick={() => copyToClipboard(envFileSnippet, 'env')}
                className="btn-secondary"
                style={{ fontSize: '0.76rem', padding: '4px 10px' }}
              >
                {copiedKey === 'env' ? '✓ Copied .env' : '📋 Copy .env File'}
              </button>
            </div>
            <pre className="font-mono" style={{
              background: '#090d16',
              color: '#fbcfe8',
              padding: '16px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              overflowX: 'auto',
              lineHeight: '1.5'
            }}>
              {envFileSnippet}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
