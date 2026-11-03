export interface GuardrailsConfig {
  rate_limits?: {
    requests_per_minute: number;
    tokens_per_minute: number;
  };
  pii_masking?: boolean;
  pii_action?: 'mask' | 'block';
  prompt_injection_detection?: boolean;
  toxicity_filter?: boolean;
  secret_leak_prevention?: boolean;
  blocked_keywords?: string[];
  max_tokens_ceiling?: number;
}

export interface GuardrailCheckDetail {
  policy: string;
  status: 'passed' | 'masked' | 'blocked';
  findings: string[];
}

export interface GuardrailEvaluationResult {
  allowed: boolean;
  action_taken: 'passed' | 'masked' | 'blocked';
  blocked_reason?: string;
  blocked_code?: string;
  violation_category?: string;
  redactions_count: number;
  redacted_types: string[];
  sanitized_messages: Array<{ role: string; content: string }>;
  effective_max_tokens: number;
  checks: GuardrailCheckDetail[];
}

const PROMPT_INJECTION_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  {
    label: 'Instruction Override (Ignore Previous Instructions)',
    regex: /\b(ignore|disregard|forget|bypass)\s+(all\s+)?(previous|prior|above|system|initial)\s+(instructions|prompts|rules|directions|guardrails)\b/i,
  },
  {
    label: 'System Prompt Extraction Attempt',
    regex: /\b(reveal|print|repeat|output|show|dump)\s+(your\s+|the\s+)?(exact\s+|full\s+|verbatim\s+)?(system\s+prompt|hidden\s+instructions|initial\s+prompt|developer\s+message)\b/i,
  },
  {
    label: 'Jailbreak Persona / DAN Mode',
    regex: /\b(you\s+are\s+now\s+DAN|do\s+anything\s+now|developer\s+mode\s+enabled|act\s+as\s+an?\s+unrestricted|bypass\s+all\s+safety\s+filters)\b/i,
  },
  {
    label: 'Delimiter / System Role Spoofing',
    regex: /(<\s*\|?\s*system\s*\|?\s*>|\[\s*SYSTEM\s*INSTRUCTION\s*\]|###\s*SYSTEM\s*OVERRIDE)/i,
  },
];

const TOXICITY_AND_EXPLOIT_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  {
    label: 'Malware / Ransomware Generation',
    regex: /\b(write|create|generate|build|code)\s+(a\s+|an\s+)?(ransomware|keylogger|rootkit|trojan|credential\s+stealer|reverse\s+shell\s+payload)\b/i,
  },
  {
    label: 'Destructive SQL / Command Injection Payload',
    regex: /(;\s*DROP\s+TABLE\s+|UNION\s+SELECT\s+.*FROM\s+information_schema|rm\s+-rf\s+\/\s*--no-preserve-root)/i,
  },
  {
    label: 'Self-Harm / Severe Violence',
    regex: /\b(instructions\s+for\s+making\s+a\s+bomb|how\s+to\s+synthesize\s+nerve\s+agent)\b/i,
  },
];

const PII_PATTERNS: Array<{ type: string; placeholder: string; regex: RegExp }> = [
  {
    type: 'US_SSN',
    placeholder: '[REDACTED_SSN]',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    type: 'CREDIT_CARD',
    placeholder: '[REDACTED_CREDIT_CARD]',
    regex: /\b(?:\d[ -]*?){13,16}\b/g,
  },
  {
    type: 'EMAIL_ADDRESS',
    placeholder: '[REDACTED_EMAIL]',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    type: 'PHONE_NUMBER',
    placeholder: '[REDACTED_PHONE]',
    regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
  },
];

const SECRET_PATTERNS: Array<{ type: string; placeholder: string; regex: RegExp }> = [
  {
    type: 'AWS_ACCESS_KEY',
    placeholder: '[REDACTED_AWS_KEY]',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    type: 'OPENAI_OR_ANTHROPIC_KEY',
    placeholder: '[REDACTED_API_KEY]',
    regex: /\bsk-(?:proj-|ant-api03-)?[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    type: 'PRIVATE_KEY_BLOCK',
    placeholder: '[REDACTED_PRIVATE_KEY]',
    regex: /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g,
  },
];

/**
 * Evaluates inbound chat messages against the LLM Gateway's configured AI Guardrails.
 */
export function evaluateInboundGuardrails(
  messages: Array<{ role: string; content: any }>,
  requestedMaxTokens: number | undefined,
  config: GuardrailsConfig = {}
): GuardrailEvaluationResult {
  const checks: GuardrailCheckDetail[] = [];
  const redactedTypesSet = new Set<string>();
  let totalRedactions = 0;

  const piiEnabled = config.pii_masking ?? true;
  const piiAction = config.pii_action || 'mask';
  const promptInjectionEnabled = config.prompt_injection_detection ?? true;
  const toxicityEnabled = config.toxicity_filter ?? true;
  const secretLeakEnabled = config.secret_leak_prevention ?? true;
  const blockedKeywords = Array.isArray(config.blocked_keywords)
    ? config.blocked_keywords.map((k) => k.trim()).filter(Boolean)
    : [];
  const maxTokensCeiling = config.max_tokens_ceiling || 4096;

  const normalizedMessages = (Array.isArray(messages) ? messages : []).map((m) => ({
    role: m?.role || 'user',
    content: typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content || ''),
  }));

  const combinedText = normalizedMessages.map((m) => m.content).join('\n');

  // 1. Prompt Injection & Jailbreak Shield
  if (promptInjectionEnabled) {
    const injectionFindings: string[] = [];
    for (const pat of PROMPT_INJECTION_PATTERNS) {
      if (pat.regex.test(combinedText)) {
        injectionFindings.push(pat.label);
      }
    }

    if (injectionFindings.length > 0) {
      checks.push({
        policy: 'prompt_injection_detection',
        status: 'blocked',
        findings: injectionFindings,
      });
      return {
        allowed: false,
        action_taken: 'blocked',
        blocked_reason: `AI Guardrail Intervention: Prompt Injection / Jailbreak detected (${injectionFindings.join(', ')}). Request blocked before reaching upstream LLM.`,
        blocked_code: 'guardrail_prompt_injection_blocked',
        violation_category: 'prompt_injection',
        redactions_count: 0,
        redacted_types: [],
        sanitized_messages: normalizedMessages,
        effective_max_tokens: Math.min(requestedMaxTokens || 1000, maxTokensCeiling),
        checks,
      };
    }

    checks.push({
      policy: 'prompt_injection_detection',
      status: 'passed',
      findings: [],
    });
  }

  // 2. Content Safety, Toxicity & Cyber-Exploit Filter
  if (toxicityEnabled) {
    const toxicityFindings: string[] = [];
    for (const pat of TOXICITY_AND_EXPLOIT_PATTERNS) {
      if (pat.regex.test(combinedText)) {
        toxicityFindings.push(pat.label);
      }
    }

    if (toxicityFindings.length > 0) {
      checks.push({
        policy: 'toxicity_and_exploit_filter',
        status: 'blocked',
        findings: toxicityFindings,
      });
      return {
        allowed: false,
        action_taken: 'blocked',
        blocked_reason: `AI Guardrail Intervention: Harmful content or exploit payload detected (${toxicityFindings.join(', ')}).`,
        blocked_code: 'guardrail_content_safety_blocked',
        violation_category: 'content_safety',
        redactions_count: 0,
        redacted_types: [],
        sanitized_messages: normalizedMessages,
        effective_max_tokens: Math.min(requestedMaxTokens || 1000, maxTokensCeiling),
        checks,
      };
    }

    checks.push({
      policy: 'toxicity_and_exploit_filter',
      status: 'passed',
      findings: [],
    });
  }

  // 3. Custom Blocked Keywords / Topics
  if (blockedKeywords.length > 0) {
    const matchedKeywords: string[] = [];
    const lowerCombined = combinedText.toLowerCase();
    for (const kw of blockedKeywords) {
      if (lowerCombined.includes(kw.toLowerCase())) {
        matchedKeywords.push(kw);
      }
    }

    if (matchedKeywords.length > 0) {
      checks.push({
        policy: 'blocked_keywords_policy',
        status: 'blocked',
        findings: matchedKeywords.map((k) => `Restricted topic/keyword: "${k}"`),
      });
      return {
        allowed: false,
        action_taken: 'blocked',
        blocked_reason: `AI Guardrail Intervention: Prompt contains restricted enterprise keyword/topic (${matchedKeywords.map((k) => `"${k}"`).join(', ')}).`,
        blocked_code: 'guardrail_denied_topic_blocked',
        violation_category: 'denied_topic',
        redactions_count: 0,
        redacted_types: [],
        sanitized_messages: normalizedMessages,
        effective_max_tokens: Math.min(requestedMaxTokens || 1000, maxTokensCeiling),
        checks,
      };
    }

    checks.push({
      policy: 'blocked_keywords_policy',
      status: 'passed',
      findings: [],
    });
  }

  // 4. PII & Sensitive Credential Redaction / Blocking
  let sanitizedMessages = normalizedMessages.map((m) => ({ ...m }));
  if (piiEnabled || secretLeakEnabled) {
    const activePatterns = [
      ...(piiEnabled ? PII_PATTERNS : []),
      ...(secretLeakEnabled ? SECRET_PATTERNS : []),
    ];

    sanitizedMessages = sanitizedMessages.map((msg) => {
      let text = msg.content;
      for (const pat of activePatterns) {
        const matches = text.match(pat.regex);
        if (matches && matches.length > 0) {
          totalRedactions += matches.length;
          redactedTypesSet.add(pat.type);
          text = text.replace(pat.regex, pat.placeholder);
        }
      }
      return { ...msg, content: text };
    });

    const redactedTypes = Array.from(redactedTypesSet);

    if (totalRedactions > 0 && piiAction === 'block') {
      checks.push({
        policy: 'pii_and_secret_guardrail',
        status: 'blocked',
        findings: redactedTypes.map((t) => `Detected ${t}`),
      });
      return {
        allowed: false,
        action_taken: 'blocked',
        blocked_reason: `AI Guardrail Intervention: Sensitive PII or credentials detected (${redactedTypes.join(', ')}) and gateway PII policy is set to BLOCK.`,
        blocked_code: 'guardrail_pii_blocked',
        violation_category: 'pii_detected',
        redactions_count: totalRedactions,
        redacted_types: redactedTypes,
        sanitized_messages: sanitizedMessages,
        effective_max_tokens: Math.min(requestedMaxTokens || 1000, maxTokensCeiling),
        checks,
      };
    }

    checks.push({
      policy: 'pii_and_secret_guardrail',
      status: totalRedactions > 0 ? 'masked' : 'passed',
      findings:
        totalRedactions > 0
          ? [`Redacted ${totalRedactions} sensitive item(s): ${redactedTypes.join(', ')}`]
          : [],
    });
  }

  // 5. Max Tokens Ceiling Enforcement
  const reqMax = requestedMaxTokens || 1000;
  const effectiveMaxTokens = Math.min(reqMax, maxTokensCeiling);
  checks.push({
    policy: 'max_tokens_ceiling',
    status: 'passed',
    findings:
      reqMax > maxTokensCeiling
        ? [`Clamped requested max_tokens (${reqMax}) to gateway ceiling (${maxTokensCeiling})`]
        : [],
  });

  return {
    allowed: true,
    action_taken: totalRedactions > 0 ? 'masked' : 'passed',
    redactions_count: totalRedactions,
    redacted_types: Array.from(redactedTypesSet),
    sanitized_messages: sanitizedMessages,
    effective_max_tokens: effectiveMaxTokens,
    checks,
  };
}

