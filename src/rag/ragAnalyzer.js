/**
 * RAG Analyzer Module
 * Performs AI-powered analysis of workflow logs using Llama 3 8B
 */

import chalk from 'chalk';
import { checkOllamaAvailability, generateCompletion, DEFAULT_MODEL } from './ollamaClient.js';
import { gatherRepositoryContext, findRelevantFiles, extractLogPatterns } from './repoContextGatherer.js';

// Maximum context length for Llama 3 8B (8192 tokens, ~4 chars per token)
const MAX_CONTEXT_CHARS = 24000;
const MAX_LOG_ENTRIES_PER_CHUNK = 20;

/**
 * System prompt for log analysis
 */
const SYSTEM_PROMPT = `You are an expert log analyzer specializing in workflow comparison and debugging.
Your task is to analyze two sets of logs (blue and green) from different workflow executions and determine if they are functionally equivalent.

MOST IMPORTANT - AUTOMATED ERROR DETECTION:
The prompt includes an "INTELLIGENT ERROR DETECTION RESULTS" section that uses a scoring-based system to automatically detect errors.
- If this section shows errors in GREEN but not in BLUE (or vice versa), this is a CRITICAL FUNCTIONAL DIFFERENCE
- HIGH-confidence errors (score > 50) are almost certainly real issues
- ALWAYS mention the specific errors found by the automated detection in your analysis
- If GREEN has MORE errors than BLUE, the workflows are NOT functionally equivalent - this indicates a REGRESSION
- Do NOT ignore or dismiss the automated error detection results

Guidelines:
1. Ignore cosmetic differences like timestamps, session IDs, request IDs, and other dynamic identifiers
2. Focus on the workflow structure and business logic
3. Identify any meaningful functional differences that could indicate bugs or issues
4. Consider the repository context provided to understand the codebase structure
5. Be concise but thorough in your analysis
6. Rate your confidence level (LOW, MEDIUM, HIGH) based on the quality of evidence
7. Logs are not in any particular order. Do not assume any order based on the log entries alone.
8. Check and analyze all blue and green logs entries thoroughly before making a decision.

CRITICAL - State and Error Detection:
9. Pay special attention to session variable failures - look for patterns like "not found", "undefined", "null", or missing state that appears in one workflow but not the other. These are HIGH-PRIORITY functional differences.
10. Treat the following as FUNCTIONALLY SIGNIFICANT differences (not cosmetic):
    - Session variable retrieval failures (e.g., "get session variable not found" → undefined)
    - Any value returning "undefined", "null", "N/A", or empty when it should have data
    - ERROR, WARN, FAIL, Exception, or failure messages that differ between workflows
    - Missing or incomplete data in one workflow vs another
    - Cache misses, database lookup failures, or API call errors
11. Flag any error messages, warnings, or failure conditions that appear in one workflow but not the other as MEANINGFUL differences.
12. Identify state management issues as high-priority:
    - Session variables not being set or retrieved correctly
    - Missing context or state that was expected
    - Data that exists in blue logs but is undefined/missing in green logs (or vice versa)
    - Variables or fields that have values in one execution but return empty/undefined in another

Repository Code Analysis:
13. Use the repository context to understand the expected workflow behavior
14. Cross-reference log messages with code patterns to identify where failures originate
15. Determine if the workflow differences indicate a bug in the code, configuration issue, or environmental problem
16. Suggest which code files or functions are likely responsible for any session/state issues found`;


/**
 * Chunks logs into smaller groups for processing
 * @param {Object[]} logs - Array of log entries
 * @param {number} chunkSize - Maximum entries per chunk
 * @returns {Object[][]} Array of log chunks
 */
function chunkLogs(logs, chunkSize = MAX_LOG_ENTRIES_PER_CHUNK) {
  const chunks = [];
  for (let i = 0; i < logs.length; i += chunkSize) {
    chunks.push(logs.slice(i, i + chunkSize));
  }
  return chunks;
}

// ============================================================================
// INTELLIGENT ERROR DETECTION SYSTEM
// Pattern-agnostic, scoring-based error detection with automatic categorization
// ============================================================================

/**
 * Error severity levels for log level detection
 */
const LOG_LEVEL_SEVERITY = {
  // Critical levels - highest priority
  'fatal': { score: 100, category: 'FATAL' },
  'critical': { score: 100, category: 'CRITICAL' },
  'emergency': { score: 100, category: 'EMERGENCY' },
  'panic': { score: 100, category: 'PANIC' },
  // Error levels
  'error': { score: 80, category: 'ERROR' },
  'err': { score: 80, category: 'ERROR' },
  'severe': { score: 80, category: 'SEVERE' },
  'alert': { score: 75, category: 'ALERT' },
  // Warning levels
  'warn': { score: 50, category: 'WARNING' },
  'warning': { score: 50, category: 'WARNING' },
  'caution': { score: 45, category: 'WARNING' },
  // Notice levels (lower priority but still notable)
  'notice': { score: 20, category: 'NOTICE' },
  'notic': { score: 20, category: 'NOTICE' },  // Common truncation
};

/**
 * Negative action keywords that indicate something went wrong
 * Each has a base score contribution
 */
const NEGATIVE_ACTION_KEYWORDS = {
  // Failure indicators
  'failed': 15,
  'failure': 15,
  'fail': 12,
  'failing': 12,
  // Error indicators
  'error': 15,
  'errors': 15,
  'errored': 15,
  // Exception indicators
  'exception': 20,
  'exceptions': 20,
  'threw': 15,
  'thrown': 15,
  'throw': 12,
  // Inability indicators
  'unable': 12,
  'cannot': 12,
  'can\'t': 12,
  'couldn\'t': 12,
  'could not': 12,
  'won\'t': 10,
  'wouldn\'t': 10,
  'would not': 10,
  'should not': 8,
  'must not': 10,
  // Missing/absence indicators
  'missing': 12,
  'absent': 10,
  'not found': 15,
  'notfound': 15,
  'no such': 12,
  'does not exist': 12,
  'doesn\'t exist': 12,
  'nonexistent': 10,
  'not set': 12,
  'unset': 10,
  'not defined': 12,
  'not available': 12,
  'unavailable': 12,
  // Null/undefined indicators (CRITICAL for the user's case)
  'undefined': 18,
  'null': 15,
  'nil': 12,
  'none': 10,
  'n/a': 12,
  'empty': 10,
  'blank': 8,
  // Invalid/bad state indicators
  'invalid': 12,
  'malformed': 12,
  'corrupt': 15,
  'corrupted': 15,
  'broken': 12,
  'bad': 8,
  'illegal': 12,
  'incorrect': 10,
  'wrong': 8,
  'mismatch': 10,
  'inconsistent': 12,
  // Timeout/connection issues
  'timeout': 15,
  'timed out': 15,
  'timedout': 15,
  'expired': 10,
  'expiration': 8,
  'deadline exceeded': 15,
  // Connection/network issues
  'refused': 15,
  'refused connection': 18,
  'connection refused': 18,
  'disconnected': 12,
  'disconnect': 10,
  'unreachable': 15,
  'connection failed': 18,
  'connection error': 18,
  'network error': 15,
  'connection lost': 15,
  'connection reset': 12,
  'connection closed': 10,
  // Access/permission issues
  'denied': 12,
  'forbidden': 12,
  'unauthorized': 12,
  'unauthenticated': 12,
  'permission denied': 15,
  'access denied': 15,
  'not permitted': 12,
  'not allowed': 10,
  // Crash/termination indicators
  'crash': 20,
  'crashed': 20,
  'abort': 15,
  'aborted': 15,
  'terminated': 12,
  'killed': 12,
  'segfault': 25,
  'segmentation fault': 25,
  'core dump': 20,
  'panic': 20,
  'fatal': 20,
  // Retry/recovery indicators (suggest prior failure)
  'retry': 8,
  'retrying': 8,
  'retried': 8,
  'recovering': 8,
  'recovery': 8,
  'fallback': 8,
  'degraded': 10,
  // Rejection indicators
  'rejected': 12,
  'reject': 10,
  'declined': 10,
  'refused': 12,
  // Status indicators
  'unsuccessful': 15,
  'incomplete': 10,
  'partial': 8,
  'skipped': 8,
  'ignored': 6,
  'dropped': 12,
  'lost': 12,
  'blocked': 10,
  'stuck': 10,
  'hung': 12,
  'frozen': 12,
  'unresponsive': 15,
};

/**
 * Null/undefined value indicators - these indicate missing or invalid data
 */
const NULL_VALUE_INDICATORS = [
  'undefined', 'null', 'nil', 'none', 'empty', 'n/a', 'na', 'not available',
  'not set', 'unset', 'missing', 'absent', 'void', 'blank', '""', "''",
  '[]', '{}', '<null>', '<undefined>', '<empty>', '<none>', '[null]',
  '[undefined]', '(null)', '(undefined)', 'NaN', 'unknown', 'not defined',
];

/**
 * Failure/error status indicators
 */
const FAILURE_STATUS_INDICATORS = [
  'failed', 'failure', 'error', 'err', 'unsuccessful', 'rejected', 'denied',
  'refused', 'timeout', 'timed out', 'expired', 'invalid', 'broken', 'corrupt',
  'disconnected', 'unreachable', 'unavailable', 'down', 'offline', 'stopped',
  'terminated', 'aborted', 'crashed', 'killed', 'dead', 'exception', 'fault',
  'bad', 'wrong', 'incorrect', 'mismatch', 'conflict', 'blocked', 'stuck',
  'hung', 'frozen', 'unresponsive', 'skipped', 'ignored', 'dropped', 'lost',
];

/**
 * Build dynamic regex for field: value patterns where value indicates an issue
 * This catches patterns like "Session ID: undefined", "User ID: null", etc.
 */
function buildFieldValuePatterns() {
  const patterns = [];

  // Create pattern for "Field Name: <null_value>" - captures the specific case mentioned
  const nullValueRegex = NULL_VALUE_INDICATORS.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  // Pattern: "Something Something: undefined" or "Something_Something: null" etc.
  patterns.push({
    regex: new RegExp(`[A-Za-z][A-Za-z0-9_ ]*:\\s*(${nullValueRegex})\\s*($|[,;\\]\\)\\}])`, 'i'),
    score: 28,
    category: 'NULL_VALUE_ASSIGNMENT'
  });

  // Pattern: "Something = undefined" or "something=null"
  patterns.push({
    regex: new RegExp(`[A-Za-z][A-Za-z0-9_]*\\s*=\\s*(${nullValueRegex})\\s*($|[,;\\]\\)\\}])`, 'i'),
    score: 28,
    category: 'NULL_VALUE_ASSIGNMENT'
  });

  // Pattern: value "is undefined/null/empty"
  patterns.push({
    regex: new RegExp(`\\b(is|was|are|were|became|becomes)\\s+(${nullValueRegex})\\b`, 'i'),
    score: 25,
    category: 'NULL_STATE'
  });

  // Pattern: "got undefined", "received null", "returned empty"
  patterns.push({
    regex: new RegExp(`\\b(got|received|returned|yielded|produced|gave|gives)\\s+(${nullValueRegex})\\b`, 'i'),
    score: 25,
    category: 'NULL_RETURN'
  });

  // Create pattern for "Field Name: <failure_status>"
  const failureRegex = FAILURE_STATUS_INDICATORS.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  // Pattern: "Something: failed" or "connection: timeout"
  patterns.push({
    regex: new RegExp(`[A-Za-z][A-Za-z0-9_ ]*:\\s*(${failureRegex})\\s*($|[,;\\]\\)\\}])`, 'i'),
    score: 25,
    category: 'STATUS_FAILURE'
  });

  // Pattern: "Something = failed"
  patterns.push({
    regex: new RegExp(`[A-Za-z][A-Za-z0-9_]*\\s*=\\s*(${failureRegex})\\s*($|[,;\\]\\)\\}])`, 'i'),
    score: 25,
    category: 'STATUS_FAILURE'
  });

  return patterns;
}

/**
 * Structural patterns that indicate error states
 * These are regex-like patterns with scoring
 */
const STRUCTURAL_PATTERNS = [
  // === ARROW PATTERNS (-> or =>) pointing to error states ===
  { regex: /->?\s*(undefined|null|nil|none|false|empty|0|""|''|\[\]|\{\}|N\/A)\s*($|[,;])/i, score: 28, category: 'NULL_STATE' },
  { regex: /=>\s*(undefined|null|nil|none|false|empty|N\/A)\s*($|[,;])/i, score: 28, category: 'NULL_STATE' },

  // === COLON PATTERNS (key: value) - THIS CATCHES "Session ID in Message Data: undefined" ===
  { regex: /[A-Za-z][A-Za-z0-9_ ]*:\s*undefined\s*($|[,;)\]}])/i, score: 30, category: 'UNDEFINED_VALUE' },
  { regex: /[A-Za-z][A-Za-z0-9_ ]*:\s*null\s*($|[,;)\]}])/i, score: 28, category: 'NULL_VALUE' },
  { regex: /[A-Za-z][A-Za-z0-9_ ]*:\s*N\/A\s*($|[,;)\]}])/i, score: 25, category: 'NOT_AVAILABLE' },
  { regex: /[A-Za-z][A-Za-z0-9_ ]*:\s*(empty|none|nil|missing)\s*($|[,;)\]}])/i, score: 25, category: 'EMPTY_VALUE' },
  { regex: /[A-Za-z][A-Za-z0-9_ ]*:\s*(failed|failure|error|timeout)\s*($|[,;)\]}])/i, score: 28, category: 'STATUS_FAILURE' },

  // === EQUALS PATTERNS (key = value) ===
  { regex: /[A-Za-z][A-Za-z0-9_]*\s*=\s*undefined\b/i, score: 28, category: 'UNDEFINED_VALUE' },
  { regex: /[A-Za-z][A-Za-z0-9_]*\s*=\s*null\b/i, score: 26, category: 'NULL_VALUE' },
  { regex: /[A-Za-z][A-Za-z0-9_]*\s*=\s*N\/A\b/i, score: 24, category: 'NOT_AVAILABLE' },

  // === "IS" PATTERNS (value is undefined/null) ===
  { regex: /\b\w+\s+(is|was|are|were)\s+(undefined|null|empty|missing|invalid|unavailable)\b/i, score: 25, category: 'STATE_INVALID' },

  // === RETURN/RESULT PATTERNS ===
  { regex: /returned?\s+(undefined|null|nil|none|nothing|empty|false)/i, score: 25, category: 'NULL_RETURN' },
  { regex: /returns?\s+(undefined|null|nil|none|nothing|empty|false)/i, score: 25, category: 'NULL_RETURN' },
  { regex: /result\s*(is|was|:)?\s*(undefined|null|empty|none|invalid)/i, score: 25, category: 'NULL_RETURN' },
  { regex: /(got|received|yields?|gives?|gave)\s+(undefined|null|empty|nothing|false)/i, score: 24, category: 'NULL_RETURN' },

  // === "NOT FOUND" PATTERNS ===
  { regex: /\b\w+\s+not\s+found\b/i, score: 22, category: 'NOT_FOUND' },
  { regex: /\bnot\s+found\s*[:\-]/i, score: 24, category: 'NOT_FOUND' },
  { regex: /\b(could|can)n?'?t?\s+(find|locate|get|retrieve|fetch|load|access)\b/i, score: 20, category: 'NOT_FOUND' },
  { regex: /\b(no|zero|0)\s+(results?|records?|rows?|entries?|items?|data)\s+(found|returned|available)/i, score: 20, category: 'EMPTY_RESULT' },
  { regex: /\bdoes\s*n'?o?t?\s+exist\b/i, score: 22, category: 'NOT_FOUND' },

  // === "FAILED" PATTERNS ===
  { regex: /\b\w+\s+failed\s*(to|with|:|$)/i, score: 22, category: 'OPERATION_FAILED' },
  { regex: /\bfailed\s+to\s+\w+/i, score: 22, category: 'OPERATION_FAILED' },
  { regex: /\bfailure\s+(in|on|at|during|while|of)\b/i, score: 20, category: 'OPERATION_FAILED' },
  { regex: /\b(operation|request|call|action|process)\s+(failed|unsuccessful|rejected)/i, score: 22, category: 'OPERATION_FAILED' },

  // === EXCEPTION/ERROR PATTERNS ===
  { regex: /\bexception\s*:/i, score: 28, category: 'EXCEPTION' },
  { regex: /\b(throw|threw|thrown|raising?|raised?)\s+\w*exception/i, score: 28, category: 'EXCEPTION' },
  { regex: /\b\w+exception\b/i, score: 22, category: 'EXCEPTION' },
  { regex: /\b\w+error\b/i, score: 18, category: 'ERROR_TYPE' },
  { regex: /\berror\s*:\s*.+/i, score: 22, category: 'ERROR_MESSAGE' },
  { regex: /\b(fatal|critical|severe)\s+(error|exception|failure)/i, score: 30, category: 'CRITICAL_ERROR' },

  // === SESSION/STATE RETRIEVAL FAILURES ===
  { regex: /\b(get|fetch|retrieve|load|read)\s+\w+\s*(variable|value|data|config|setting|property).*[:\-=>\s]+(undefined|null|empty|missing)/i, score: 32, category: 'STATE_RETRIEVAL_FAILURE' },
  { regex: /\b(session|context|state)\s+\w*\s*(not\s+found|undefined|null|expired|invalid|missing|empty)/i, score: 30, category: 'SESSION_ERROR' },
  { regex: /\bvariable\s+(not\s+found|undefined|null|missing|empty)/i, score: 28, category: 'STATE_RETRIEVAL_FAILURE' },
  { regex: /\b(user|account|profile|session)\s*(id|ID|Id)?\s*[:\-=>]?\s*(undefined|null|missing|not\s+found|N\/A)/i, score: 30, category: 'IDENTITY_ERROR' },
  { regex: /\bcache\s+(miss|failure|error|expired|empty|invalid)/i, score: 24, category: 'CACHE_ERROR' },
  { regex: /\b(lookup|search|query)\s+(failed|returned\s+nothing|no\s+results?)/i, score: 22, category: 'LOOKUP_FAILURE' },

  // === DATABASE/QUERY ERRORS ===
  { regex: /\b(sql|database|db|query|transaction)\s*(error|exception|failure|failed)/i, score: 26, category: 'DATABASE_ERROR' },
  { regex: /\bquery\s+(failed|error|timeout)/i, score: 24, category: 'DATABASE_ERROR' },
  { regex: /\bdeadlock\b/i, score: 28, category: 'DATABASE_ERROR' },
  { regex: /\bduplicate\s+(key|entry|record)/i, score: 22, category: 'DATABASE_ERROR' },
  { regex: /\bforeign\s+key\s+(violation|constraint|error)/i, score: 24, category: 'DATABASE_ERROR' },
  { regex: /\bconnection\s+(to\s+)?(database|db)\s*(failed|refused|timeout|lost)/i, score: 26, category: 'DATABASE_ERROR' },

  // === API/HTTP ERRORS ===
  { regex: /\b(http|api|rest|graphql)\s*(error|failure|failed|exception)/i, score: 22, category: 'API_ERROR' },
  { regex: /\bstatus\s*[=:]?\s*(4\d{2}|5\d{2})\b/i, score: 24, category: 'HTTP_ERROR' },
  { regex: /\b(4\d{2}|5\d{2})\s+(error|response|status)/i, score: 24, category: 'HTTP_ERROR' },
  { regex: /\bresponse\s*(is|was|:)?\s*(empty|null|undefined|invalid|malformed)/i, score: 24, category: 'API_ERROR' },
  { regex: /\bapi\s+(call|request)\s+(failed|timeout|rejected)/i, score: 24, category: 'API_ERROR' },

  // === CONNECTION/NETWORK ERRORS ===
  { regex: /\bconnection\s+(failed|refused|reset|timeout|closed|lost|dropped)/i, score: 26, category: 'CONNECTION_ERROR' },
  { regex: /\b(network|socket|tcp|udp)\s*(error|failure|timeout|unreachable)/i, score: 24, category: 'NETWORK_ERROR' },
  { regex: /\bhost\s+(unreachable|unknown|not\s+found)/i, score: 24, category: 'NETWORK_ERROR' },
  { regex: /\bdns\s+(error|failure|timeout|not\s+found)/i, score: 24, category: 'NETWORK_ERROR' },

  // === MEMORY/RESOURCE ERRORS ===
  { regex: /\bout\s+of\s+(memory|space|disk|resources|handles|connections)/i, score: 32, category: 'RESOURCE_ERROR' },
  { regex: /\bmemory\s+(leak|overflow|exhausted|allocation\s+failed)/i, score: 30, category: 'MEMORY_ERROR' },
  { regex: /\bheap\s+(overflow|exhausted|full|out\s+of)/i, score: 30, category: 'MEMORY_ERROR' },
  { regex: /\bstack\s+(overflow|exhausted)/i, score: 32, category: 'MEMORY_ERROR' },
  { regex: /\b(resource|handle|file|socket)\s+(limit|exhausted|leak)/i, score: 26, category: 'RESOURCE_ERROR' },

  // === VALIDATION ERRORS ===
  { regex: /\b(assertion|assert)\s+(failed|error|failure)/i, score: 28, category: 'ASSERTION_FAILURE' },
  { regex: /\bvalidation\s+(failed|error|failure|unsuccessful)/i, score: 22, category: 'VALIDATION_ERROR' },
  { regex: /\binvalid\s+\w+\s*(format|type|value|input|data|syntax|schema)/i, score: 20, category: 'VALIDATION_ERROR' },
  { regex: /\b(schema|format|type)\s+(mismatch|error|invalid|violation)/i, score: 22, category: 'VALIDATION_ERROR' },
  { regex: /\brequired\s+(field|parameter|argument|property)\s+(missing|not\s+provided|undefined|null)/i, score: 26, category: 'VALIDATION_ERROR' },

  // === AUTH ERRORS ===
  { regex: /\b(auth|authentication|authorization|authz?|login)\s*(failed|failure|error|denied|rejected|invalid)/i, score: 24, category: 'AUTH_ERROR' },
  { regex: /\btoken\s+(expired|invalid|missing|rejected|revoked|not\s+found)/i, score: 24, category: 'AUTH_ERROR' },
  { regex: /\bcredentials?\s+(invalid|expired|rejected|failed|incorrect|wrong)/i, score: 24, category: 'AUTH_ERROR' },
  { regex: /\b(access|permission)\s+(denied|forbidden|refused|unauthorized)/i, score: 24, category: 'AUTH_ERROR' },
  { regex: /\bunauthorized\s+(access|request|operation)/i, score: 24, category: 'AUTH_ERROR' },

  // === CONFIG ERRORS ===
  { regex: /\bconfig(uration)?\s*(error|missing|invalid|not\s+found|failed|undefined)/i, score: 22, category: 'CONFIG_ERROR' },
  { regex: /\bmissing\s+(required\s+)?(config|setting|parameter|argument|env|environment)/i, score: 22, category: 'CONFIG_ERROR' },
  { regex: /\benvironment\s+variable\s+(not\s+set|missing|undefined|empty)/i, score: 24, category: 'CONFIG_ERROR' },

  // === TIMEOUT PATTERNS ===
  { regex: /\b(timeout|timed?\s*out)\s*(error|exception|failure|occurred|reached|exceeded)?/i, score: 24, category: 'TIMEOUT' },
  { regex: /\b(operation|request|connection|query)\s+timed?\s*out/i, score: 24, category: 'TIMEOUT' },
  { regex: /\bexceeded\s+(timeout|time\s*limit|deadline)/i, score: 24, category: 'TIMEOUT' },

  // === PARSING/PROCESSING ERRORS ===
  { regex: /\b(parse|parsing|deserialize|unmarshal)\s*(error|failed|failure|exception)/i, score: 22, category: 'PARSE_ERROR' },
  { regex: /\b(json|xml|yaml|csv)\s*(parse|parsing)?\s*(error|failed|invalid|malformed)/i, score: 22, category: 'PARSE_ERROR' },
  { regex: /\bsyntax\s+error/i, score: 24, category: 'PARSE_ERROR' },
  { regex: /\bmalformed\s+(data|input|request|response|message|payload)/i, score: 22, category: 'PARSE_ERROR' },

  // === MESSAGE/EVENT PROCESSING ===
  { regex: /\bmessage\s+(processing|handling)\s+(failed|error|rejected)/i, score: 24, category: 'MESSAGE_ERROR' },
  { regex: /\b(event|message|request)\s+(dropped|lost|rejected|undelivered|unprocessed)/i, score: 24, category: 'MESSAGE_ERROR' },
  { regex: /\bqueue\s+(full|overflow|blocked|error)/i, score: 22, category: 'QUEUE_ERROR' },

  // === DATA INTEGRITY ===
  { regex: /\b(data|record|entry)\s+(corrupt|corrupted|inconsistent|invalid|missing)/i, score: 26, category: 'DATA_INTEGRITY' },
  { regex: /\bchecksum\s+(mismatch|error|failed|invalid)/i, score: 26, category: 'DATA_INTEGRITY' },
  { regex: /\bintegrity\s+(check|violation|error|failed)/i, score: 26, category: 'DATA_INTEGRITY' },

  // === CONCURRENCY/LOCKING ===
  { regex: /\b(lock|mutex|semaphore)\s+(timeout|failed|error|conflict|deadlock)/i, score: 26, category: 'CONCURRENCY_ERROR' },
  { regex: /\brace\s+condition/i, score: 26, category: 'CONCURRENCY_ERROR' },
  { regex: /\bconcurrent\s+(access|modification)\s+(error|conflict|violation)/i, score: 24, category: 'CONCURRENCY_ERROR' },

  // Dynamically generated patterns
  ...buildFieldValuePatterns(),
];

/**
 * Context modifiers that increase/decrease confidence
 */
const CONTEXT_MODIFIERS = {
  // Positive modifiers (increase score)
  amplifiers: [
    { regex: /\b(critical|severe|fatal|serious|major)\b/i, multiplier: 1.5 },
    { regex: /\bunexpected\b/i, multiplier: 1.3 },
    { regex: /\bunhandled\b/i, multiplier: 1.4 },
    { regex: /\buncaught\b/i, multiplier: 1.4 },
  ],
  // Negative modifiers (decrease score) - might be false positives
  dampeners: [
    { regex: /\b(no\s+error|without\s+error|error\s+free|successfully)\b/i, multiplier: 0.3 },
    { regex: /\b(checking\s+for|looking\s+for|searching\s+for)\b/i, multiplier: 0.5 },
    { regex: /\bif\s+.*\s+(error|fail|null|undefined)\b/i, multiplier: 0.4 },
    { regex: /\b(test|mock|stub|fake|dummy)\b/i, multiplier: 0.5 },
    { regex: /\bdebug(ging)?\b/i, multiplier: 0.7 },
  ],
};

/**
 * Minimum score threshold to consider a log entry as an error
 */
const ERROR_SCORE_THRESHOLD = 25;

/**
 * High confidence threshold for prioritizing errors
 */
const HIGH_CONFIDENCE_THRESHOLD = 50;

/**
 * Analyzes a log entry and returns an error score with categorization
 * @param {Object} log - Log entry object
 * @returns {Object} Analysis result with score, category, and reasons
 */
function analyzeLogForErrors(log) {
  const result = {
    score: 0,
    categories: [],
    reasons: [],
    isError: false,
    confidence: 'LOW',
  };

  if (!log) return result;

  const message = log.message || '';
  const logLevel = (log.log?.level || log.level || '').toLowerCase().trim();

  // 1. Check log level first (highest priority indicator)
  if (logLevel && LOG_LEVEL_SEVERITY[logLevel]) {
    const levelInfo = LOG_LEVEL_SEVERITY[logLevel];
    result.score += levelInfo.score;
    result.categories.push(levelInfo.category);
    result.reasons.push(`Log level: ${logLevel.toUpperCase()}`);
  }

  // 2. Check for negative action keywords in message
  const messageLower = message.toLowerCase();
  for (const [keyword, score] of Object.entries(NEGATIVE_ACTION_KEYWORDS)) {
    if (messageLower.includes(keyword)) {
      result.score += score;
      result.reasons.push(`Keyword: "${keyword}"`);
    }
  }

  // 3. Check structural patterns
  for (const pattern of STRUCTURAL_PATTERNS) {
    if (pattern.regex.test(message)) {
      result.score += pattern.score;
      if (!result.categories.includes(pattern.category)) {
        result.categories.push(pattern.category);
      }
      result.reasons.push(`Pattern: ${pattern.category}`);
    }
  }

  // 4. Apply context modifiers
  let modifier = 1.0;
  for (const amp of CONTEXT_MODIFIERS.amplifiers) {
    if (amp.regex.test(message)) {
      modifier *= amp.multiplier;
      result.reasons.push(`Amplifier: severity increased`);
    }
  }
  for (const damp of CONTEXT_MODIFIERS.dampeners) {
    if (damp.regex.test(message)) {
      modifier *= damp.multiplier;
      result.reasons.push(`Dampener: possible false positive`);
    }
  }
  result.score = Math.round(result.score * modifier);

  // 5. Determine if this is an error and confidence level
  result.isError = result.score >= ERROR_SCORE_THRESHOLD;
  if (result.score >= HIGH_CONFIDENCE_THRESHOLD) {
    result.confidence = 'HIGH';
  } else if (result.score >= ERROR_SCORE_THRESHOLD) {
    result.confidence = 'MEDIUM';
  }

  // 6. Assign primary category if none matched
  if (result.categories.length === 0 && result.isError) {
    result.categories.push('GENERAL_ERROR');
  }

  return result;
}

/**
 * Checks if a log message contains error patterns using intelligent scoring
 * @param {string} message - Log message
 * @param {Object} log - Full log object for additional context
 * @returns {boolean} True if contains error patterns
 */
function containsErrorPattern(message, log = {}) {
  const analysis = analyzeLogForErrors({ ...log, message });
  return analysis.isError;
}

/**
 * Summarizes log entries for LLM consumption with intelligent error detection
 * @param {Object[]} logs - Log entries
 * @param {number} maxChars - Maximum characters
 * @returns {string} Summarized log string
 */
function summarizeLogs(logs, maxChars = MAX_CONTEXT_CHARS / 3) {
  // First pass: analyze all logs with intelligent error detection
  const analyzedLogs = logs.map((log, i) => {
    const analysis = analyzeLogForErrors(log);
    return { log, index: i, analysis };
  });

  // Sort by error score (highest first), then separate errors from normal
  const errorLogs = analyzedLogs
    .filter(e => e.analysis.isError)
    .sort((a, b) => b.analysis.score - a.analysis.score);
  const normalLogs = analyzedLogs.filter(e => !e.analysis.isError);

  const formatLogEntry = (entry, highlight = false) => {
    const { log, index, analysis } = entry;
    const parts = [`[${index + 1}]`];

    if (highlight && analysis) {
      const category = analysis.categories[0] || 'ISSUE';
      const confidence = analysis.confidence;
      parts.push(`⚠️ ${category} (${confidence})`);
    }
    if (log['@timestamp']) parts.push(`time: ${log['@timestamp']}`);
    if (log.log?.level) parts.push(`level: ${log.log.level}`);
    if (log.log?.file?.path) parts.push(`file: ${log.log.file.path}`);
    if (log.message) {
      // For error logs, include more context (up to 400 chars)
      // For normal logs, truncate at 200 chars
      const maxLen = highlight ? 400 : 200;
      const msg = log.message.length > maxLen
        ? log.message.substring(0, maxLen) + '...'
        : log.message;
      parts.push(`msg: ${msg}`);
    }

    return parts.join(' | ');
  };

  // Build output: prioritize error logs first (sorted by score), then normal logs
  const summaries = [];

  // Add a header if there are error logs
  if (errorLogs.length > 0) {
    const highConfidence = errorLogs.filter(e => e.analysis.confidence === 'HIGH').length;
    summaries.push(`\n=== DETECTED ERRORS/ISSUES (${errorLogs.length} found, ${highConfidence} high-confidence) ===`);
    errorLogs.forEach(entry => {
      summaries.push(formatLogEntry(entry, true));
    });
    summaries.push(`\n=== ALL OTHER LOGS (${normalLogs.length} entries) ===`);
  }

  // Add normal logs
  normalLogs.forEach(entry => {
    summaries.push(formatLogEntry(entry, false));
  });

  let result = summaries.join('\n');
  if (result.length > maxChars) {
    // When truncating, ensure we keep all error logs
    const errorSection = summaries.slice(0, errorLogs.length + 2).join('\n');
    const remainingChars = maxChars - errorSection.length - 50;

    if (remainingChars > 0) {
      const normalSection = normalLogs.map(e => formatLogEntry(e, false)).join('\n');
      result = errorSection + '\n' + normalSection.substring(0, remainingChars) + '\n... [truncated]';
    } else {
      result = errorSection + '\n... [remaining logs truncated due to size]';
    }
  }
  return result;
}

/**
 * Formats repository context for LLM
 * @param {Object[]} relevantFiles - Relevant files from repos
 * @param {number} maxChars - Maximum characters
 * @returns {string} Formatted context
 */
function formatRepoContext(relevantFiles, maxChars = MAX_CONTEXT_CHARS / 4) {
  if (!relevantFiles || relevantFiles.length === 0) {
    return 'No relevant repository context found.';
  }

  const parts = relevantFiles.map(file => {
    return `--- ${file.repo}/${file.path} (relevance: ${file.relevanceScore?.toFixed(2) || 'N/A'}) ---
${file.content.substring(0, 500)}${file.content.length > 500 ? '...' : ''}`;
  });

  let result = parts.join('\n\n');
  if (result.length > maxChars) {
    result = result.substring(0, maxChars) + '\n... [truncated]';
  }
  return result;
}

/**
 * Extracts error/issue entries from logs using intelligent error detection
 * @param {Object[]} logs - Log entries
 * @returns {Object} Detailed error analysis with entries and statistics
 */
function extractErrorEntries(logs) {
  const errors = [];
  const categoryStats = {};

  logs.forEach((log, i) => {
    const analysis = analyzeLogForErrors(log);

    if (analysis.isError) {
      const msg = log.message || '';
      const excerpt = msg.length > 300 ? msg.substring(0, 300) + '...' : msg;
      const primaryCategory = analysis.categories[0] || 'GENERAL_ERROR';

      // Get the CSV line number (actual line in the file)
      const csvLineNumber = log._csvLineNumber || (i + 2); // +2 for header row and 1-based indexing
      const logFilePath = log.log?.file?.path || log['log.file.path'] || 'unknown';

      // Track category statistics
      categoryStats[primaryCategory] = (categoryStats[primaryCategory] || 0) + 1;

      errors.push({
        index: i + 1,
        csvLineNumber,
        logFilePath,
        category: primaryCategory,
        confidence: analysis.confidence,
        score: analysis.score,
        excerpt,
        reasons: analysis.reasons.slice(0, 3), // Top 3 reasons
      });
    }
  });

  // Sort by score (highest first)
  errors.sort((a, b) => b.score - a.score);

  return {
    entries: errors,
    stats: categoryStats,
    totalErrors: errors.length,
    highConfidenceCount: errors.filter(e => e.confidence === 'HIGH').length,
  };
}

/**
 * Formats extracted errors for the prompt
 * @param {Object} errorData - Result from extractErrorEntries
 * @param {string} csvFileName - Name of the CSV file (for display)
 * @returns {string} Formatted error summary
 */
function formatErrorsForPrompt(errorData, csvFileName = 'CSV') {
  if (errorData.totalErrors === 0) {
    return 'No errors or state issues detected.';
  }

  const lines = [];

  // Add category breakdown
  const categoryBreakdown = Object.entries(errorData.stats)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => `${cat}: ${count}`)
    .join(', ');
  lines.push(`Categories: ${categoryBreakdown}`);
  lines.push('');

  // Add individual errors (limit to top 10 for prompt size)
  const topErrors = errorData.entries.slice(0, 10);
  for (const err of topErrors) {
    // Include CSV line number for easy reference
    const lineRef = `Line ${err.csvLineNumber} in ${csvFileName}`;
    const logFile = err.logFilePath !== 'unknown' ? ` | Source: ${err.logFilePath}` : '';
    lines.push(`[${lineRef}${logFile}] ${err.category} (${err.confidence}, score: ${err.score}):`);
    lines.push(`  → ${err.excerpt}`);
  }

  if (errorData.entries.length > 10) {
    lines.push(`... and ${errorData.entries.length - 10} more errors`);
  }

  return lines.join('\n');
}

/**
 * Extracts key-value pairs from log messages for comparison
 * This helps detect when the same field has different values between blue and green
 * @param {Object[]} logs - Log entries
 * @returns {Map} Map of field names to their values
 */
function extractKeyValuePairs(logs) {
  const kvMap = new Map();

  // Patterns to extract key-value pairs
  const kvPatterns = [
    // "Key: Value" or "Key : Value"
    /([A-Za-z][A-Za-z0-9_ ]*?)\s*:\s*([^\s,;)\]]+)/g,
    // "Key = Value" or "Key=Value"
    /([A-Za-z][A-Za-z0-9_]*)\s*=\s*([^\s,;)\]]+)/g,
    // "Key -> Value"
    /([A-Za-z][A-Za-z0-9_ ]*?)\s*->\s*([^\s,;)\]]+)/g,
    // "Key => Value"
    /([A-Za-z][A-Za-z0-9_]*)\s*=>\s*([^\s,;)\]]+)/g,
  ];

  for (const log of logs) {
    const message = log.message || '';

    for (const pattern of kvPatterns) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(message)) !== null) {
        const key = match[1].trim().toLowerCase();
        const value = match[2].trim();

        // Skip very short keys or common non-meaningful keys
        if (key.length < 3 || ['the', 'and', 'for', 'with'].includes(key)) continue;

        // Store the value (keep first occurrence of valid value, or update if current is invalid)
        const isInvalidValue = isNullOrErrorValue(value);
        const existing = kvMap.get(key);

        if (!existing) {
          kvMap.set(key, { value, isInvalid: isInvalidValue, count: 1 });
        } else {
          existing.count++;
          // If existing is invalid but new one is valid, update
          if (existing.isInvalid && !isInvalidValue) {
            existing.value = value;
            existing.isInvalid = false;
          }
        }
      }
    }
  }

  return kvMap;
}

/**
 * Checks if a value represents null/undefined/error state
 * @param {string} value - Value to check
 * @returns {boolean} True if value indicates an error state
 */
function isNullOrErrorValue(value) {
  if (!value) return true;
  const lowerValue = value.toLowerCase().trim();
  const nullIndicators = [
    'undefined', 'null', 'nil', 'none', 'n/a', 'na', 'empty', 'blank',
    '""', "''", '[]', '{}', '<null>', '<undefined>', '<empty>', '<none>',
    '[null]', '[undefined]', '(null)', '(undefined)', 'nan', 'unknown',
    'not defined', 'not set', 'unset', 'missing', 'absent', 'void',
    'failed', 'failure', 'error', 'timeout', 'unavailable',
  ];
  return nullIndicators.some(ind => lowerValue === ind || lowerValue.startsWith(ind));
}

/**
 * Compares key-value pairs between blue and green logs to find value divergences
 * @param {Object[]} blueLogs - Blue log entries
 * @param {Object[]} greenLogs - Green log entries
 * @returns {Object} Comparison result with divergences
 */
function compareLogValues(blueLogs, greenLogs) {
  const blueKV = extractKeyValuePairs(blueLogs);
  const greenKV = extractKeyValuePairs(greenLogs);

  const divergences = [];

  // Check for fields that have valid values in blue but invalid in green
  for (const [key, blueData] of blueKV) {
    const greenData = greenKV.get(key);

    if (greenData) {
      // Field exists in both - check for value divergence
      if (!blueData.isInvalid && greenData.isInvalid) {
        divergences.push({
          field: key,
          blueValue: blueData.value,
          greenValue: greenData.value,
          type: 'GREEN_INVALID',
          severity: 'HIGH',
          description: `Field "${key}" has valid value "${blueData.value}" in BLUE but invalid value "${greenData.value}" in GREEN`,
        });
      } else if (blueData.isInvalid && !greenData.isInvalid) {
        divergences.push({
          field: key,
          blueValue: blueData.value,
          greenValue: greenData.value,
          type: 'BLUE_INVALID',
          severity: 'HIGH',
          description: `Field "${key}" has invalid value "${blueData.value}" in BLUE but valid value "${greenData.value}" in GREEN`,
        });
      }
    }
  }

  // Sort by severity (HIGH first)
  divergences.sort((a, b) => (a.severity === 'HIGH' ? -1 : 1) - (b.severity === 'HIGH' ? -1 : 1));

  return {
    divergences,
    count: divergences.length,
    hasRegressions: divergences.some(d => d.type === 'GREEN_INVALID'),
    hasImprovements: divergences.some(d => d.type === 'BLUE_INVALID'),
  };
}

/**
 * Formats value divergences for the prompt
 * @param {Object} divergenceData - Result from compareLogValues
 * @returns {string} Formatted divergence summary
 */
function formatDivergencesForPrompt(divergenceData) {
  if (divergenceData.count === 0) {
    return 'No significant value divergences detected between blue and green logs.';
  }

  const lines = [];

  if (divergenceData.hasRegressions) {
    lines.push('⚠️ REGRESSIONS DETECTED: Some fields have valid values in BLUE but invalid in GREEN:');
    for (const div of divergenceData.divergences.filter(d => d.type === 'GREEN_INVALID')) {
      lines.push(`  - ${div.description}`);
    }
  }

  if (divergenceData.hasImprovements) {
    lines.push('✅ IMPROVEMENTS: Some fields have invalid values in BLUE but valid in GREEN:');
    for (const div of divergenceData.divergences.filter(d => d.type === 'BLUE_INVALID')) {
      lines.push(`  - ${div.description}`);
    }
  }

  return lines.join('\n');
}

/**
 * Builds the analysis prompt
 * @param {Object} params - Prompt parameters
 * @returns {string} Complete prompt
 */
function buildAnalysisPrompt({ blueLogs, greenLogs, comparisonReport, repoContext, relevantFiles, blueCsvName = 'blue.csv', greenCsvName = 'green.csv' }) {
  const blueLogsSummary = summarizeLogs(blueLogs);
  const greenLogsSummary = summarizeLogs(greenLogs);
  const repoContextStr = formatRepoContext(relevantFiles);

  // Extract and compare errors between blue and green using intelligent detection
  const blueErrorData = extractErrorEntries(blueLogs);

  // Compare key-value pairs between workflows
  const valueDivergences = compareLogValues(blueLogs, greenLogs);
  const greenErrorData = extractErrorEntries(greenLogs);

  const diffSummary = comparisonReport.logDifferences.slice(0, 10).map(d => {
    const diffs = d.differences.map(diff =>
      `  - ${diff.kind} at "${diff.path}": blue="${diff.blueValue}" vs green="${diff.greenValue}"`
    ).join('\n');
    return `Entry #${d.index + 1}:\n${diffs}`;
  }).join('\n\n');

  // Build comparative error section with detailed statistics (include CSV file names for line references)
  const blueErrorSummary = formatErrorsForPrompt(blueErrorData, blueCsvName);
  const greenErrorSummary = formatErrorsForPrompt(greenErrorData, greenCsvName);

  // Determine error comparison analysis
  let errorDifferenceAnalysis = '';
  const blueTotalErrors = blueErrorData.totalErrors;
  const greenTotalErrors = greenErrorData.totalErrors;
  const blueHighConf = blueErrorData.highConfidenceCount;
  const greenHighConf = greenErrorData.highConfidenceCount;

  if (greenTotalErrors > blueTotalErrors) {
    errorDifferenceAnalysis = `⚠️ REGRESSION DETECTED: GREEN workflow has ${greenTotalErrors - blueTotalErrors} MORE errors/issues than BLUE (${greenHighConf} high-confidence in green vs ${blueHighConf} in blue). This strongly suggests a regression or state problem in the green workflow.`;
  } else if (greenTotalErrors < blueTotalErrors) {
    errorDifferenceAnalysis = `✅ IMPROVEMENT: GREEN workflow has ${blueTotalErrors - greenTotalErrors} FEWER errors than BLUE. This may indicate an improvement or fix.`;
  } else if (greenTotalErrors === 0 && blueTotalErrors === 0) {
    errorDifferenceAnalysis = 'Both workflows appear to have no detected errors using intelligent pattern analysis.';
  } else {
    // Same count but might be different errors
    const blueCategories = Object.keys(blueErrorData.stats).sort().join(',');
    const greenCategories = Object.keys(greenErrorData.stats).sort().join(',');
    if (blueCategories === greenCategories) {
      errorDifferenceAnalysis = `Both workflows have ${blueTotalErrors} detected errors with similar categories. The errors may be equivalent - verify the specific messages.`;
    } else {
      errorDifferenceAnalysis = `⚠️ DIFFERENT ERROR TYPES: Both have ${blueTotalErrors} errors but different categories. Blue: [${blueCategories}], Green: [${greenCategories}]. Investigate the differences.`;
    }
  }

  // Build the functional equivalence decision helper
  let equivalenceHint = '';
  if (greenTotalErrors > blueTotalErrors && greenHighConf > 0) {
    equivalenceHint = `
⛔ AUTOMATED VERDICT: The workflows are NOT functionally equivalent.
REASON: Green workflow has ${greenTotalErrors} errors (${greenHighConf} high-confidence) while Blue has ${blueTotalErrors}.
This indicates a REGRESSION in the green workflow. Session state or data retrieval is failing.
YOU MUST report this as a functional difference, NOT a cosmetic one.`;
  } else if (blueTotalErrors > greenTotalErrors && blueHighConf > 0) {
    equivalenceHint = `
✅ AUTOMATED VERDICT: Green workflow may be an IMPROVEMENT over Blue.
REASON: Blue workflow has ${blueTotalErrors} errors while Green has ${greenTotalErrors}.`;
  } else if (greenTotalErrors === 0 && blueTotalErrors === 0) {
    equivalenceHint = `
Both workflows have no detected errors. Focus on other structural differences.`;
  }

  return `## Workflow Comparison Analysis Request

### Summary Statistics
- Blue logs: ${comparisonReport.summary.blueLogCount} entries
- Green logs: ${comparisonReport.summary.greenLogCount} entries
- Matched: ${comparisonReport.summary.matchedCount}
- Mismatched: ${comparisonReport.summary.mismatchedCount}
- Blue only: ${comparisonReport.summary.blueOnlyCount}
- Green only: ${comparisonReport.summary.greenOnlyCount}

### Blue Logs (Expected/Baseline)
${blueLogsSummary}

### Green Logs (Validation)
${greenLogsSummary}

### Key Differences Found
${diffSummary || 'No structural differences detected.'}

### Repository Context
${repoContextStr}

---

## ⛔⚠️ CRITICAL: INTELLIGENT ERROR DETECTION RESULTS ⚠️⛔

The following errors were automatically detected using a scoring-based pattern analysis system.
High-confidence errors (score > 50) are almost certainly real issues that indicate FUNCTIONAL differences.
YOU MUST address these findings in your analysis.

### Blue Workflow Errors (${blueTotalErrors} total, ${blueHighConf} high-confidence):
${blueErrorSummary}

### Green Workflow Errors (${greenTotalErrors} total, ${greenHighConf} high-confidence):
${greenErrorSummary}

### Error Comparison Result:
${errorDifferenceAnalysis}
${equivalenceHint}

### Value Divergence Analysis (Field Comparison):
${formatDivergencesForPrompt(valueDivergences)}

---

### Analysis Request
Based on ALL the information above, especially the ERROR DETECTION RESULTS and VALUE DIVERGENCES, provide:

1. **Functional Equivalence**: Are these workflows functionally identical?
   - Answer YES only if there are no meaningful errors/failures in either workflow OR both have the same errors
   - Answer NO if one workflow has errors/failures that the other doesn't have
   - The ERROR DETECTION RESULTS above show ${greenTotalErrors} errors in GREEN vs ${blueTotalErrors} in BLUE

2. **Meaningful Differences**:
   - List the errors detected above (session variable failures, exceptions, etc.)
   - These are NOT cosmetic - they represent real functional problems

3. **Cosmetic vs Functional**: Categorize the differences
   - Timestamps, IDs = cosmetic
   - Session variable failures, exceptions, undefined values = FUNCTIONAL

4. **Root Cause Suggestions**:
   - For EACH error detected above, provide:
     * The exact CSV line number (e.g., "Line 35 in green.csv")
     * The error category and what went wrong
     * Which code file or component might be responsible
   - IMPORTANT: Always reference the CSV line numbers from the error detection results so the user can locate the exact log entry

5. **Confidence Level**: LOW/MEDIUM/HIGH

6. **Recommendations**: Investigation or fixes needed

Provide a structured response addressing the error detection findings. ALWAYS include the CSV line numbers in Root Cause Suggestions.`;
}

/**
 * Performs RAG analysis on workflow logs
 * @param {Object[]} blueLogs - Blue (expected) logs
 * @param {Object[]} greenLogs - Green (validation) logs
 * @param {Object} comparisonReport - Standard comparison report
 * @param {Object} options - Analysis options
 * @returns {Promise<Object>} AI analysis result
 */
export async function performRagAnalysis(blueLogs, greenLogs, comparisonReport, options = {}) {
  const {
    verbose = false,
    reposDir = '/Users/dipankar/Repos',
    model = DEFAULT_MODEL,
    onProgress = () => {},
    blueCsvName = 'blue.csv',
    greenCsvName = 'green.csv',
  } = options;

  const result = {
    success: false,
    analysis: null,
    prompt: null,
    error: null,
    metadata: {
      model,
      startTime: Date.now(),
      endTime: null,
      repoContextUsed: false,
      relevantFilesCount: 0,
    },
  };

  try {
    // Step 1: Check Ollama availability
    onProgress({ step: 'checking_ollama', message: 'Checking Ollama availability...' });
    const ollamaCheck = await checkOllamaAvailability(model);

    if (!ollamaCheck.available) {
      throw new Error(ollamaCheck.error);
    }

    // Step 2: Gather repository context
    onProgress({ step: 'gathering_context', message: 'Gathering repository context...' });
    let repoContext = null;
    let relevantFiles = [];

    try {
      repoContext = await gatherRepositoryContext({
        reposDir,
        useCache: true,
        onProgress: (p) => onProgress({ step: 'repo_scan', ...p }),
      });

      result.metadata.repoContextUsed = true;

      // Step 3: Find relevant files based on log patterns
      onProgress({ step: 'finding_relevant', message: 'Finding relevant code files...' });
      const patterns = extractLogPatterns([...blueLogs, ...greenLogs]);

      if (verbose) {
        console.log(chalk.dim(`  Extracted ${patterns.length} patterns from logs`));
      }

      relevantFiles = await findRelevantFiles(repoContext, patterns, { topK: 5 });
      result.metadata.relevantFilesCount = relevantFiles.length;

      if (verbose) {
        console.log(chalk.dim(`  Found ${relevantFiles.length} relevant files`));
      }
    } catch (e) {
      if (verbose) {
        console.log(chalk.yellow(`  Warning: Could not gather repo context: ${e.message}`));
      }
    }

    // Step 4: Build the analysis prompt
    onProgress({ step: 'building_prompt', message: 'Building analysis prompt...' });
    const prompt = buildAnalysisPrompt({
      blueLogs,
      greenLogs,
      comparisonReport,
      repoContext,
      relevantFiles,
      blueCsvName,
      greenCsvName,
    });

    result.prompt = prompt;

    if (verbose) {
      console.log(chalk.dim('\n--- PROMPT SENT TO LLM ---'));
      // Show first part and error detection section which is near the end
      const errorSectionStart = prompt.indexOf('## ⛔⚠️ CRITICAL: INTELLIGENT ERROR DETECTION');
      if (errorSectionStart > 0 && prompt.length > 4000) {
        console.log(chalk.dim(prompt.substring(0, 2000) + '\n... [middle truncated] ...\n'));
        console.log(chalk.dim(prompt.substring(errorSectionStart)));
      } else {
        console.log(chalk.dim(prompt.substring(0, 5000) + (prompt.length > 5000 ? '\n... [truncated]' : '')));
      }
      console.log(chalk.dim('--- END PROMPT ---\n'));
    }

    // Step 5: Generate analysis with LLM
    onProgress({ step: 'analyzing', message: 'Analyzing with Llama 3 8B...' });
    const analysis = await generateCompletion(prompt, {
      model,
      system: SYSTEM_PROMPT,
      temperature: 0.5,
      maxTokens: 4096,
    });

    result.analysis = analysis;
    result.success = true;

    if (verbose) {
      console.log(chalk.dim('\n--- LLM RESPONSE ---'));
      console.log(chalk.dim(analysis));
      console.log(chalk.dim('--- END RESPONSE ---\n'));
    }

  } catch (error) {
    result.error = error.message;
  }

  result.metadata.endTime = Date.now();
  result.metadata.durationMs = result.metadata.endTime - result.metadata.startTime;

  return result;
}

/**
 * Parses the LLM analysis response into structured sections
 * @param {string} analysis - Raw LLM response
 * @returns {Object} Parsed analysis
 */
export function parseAnalysisResponse(analysis) {
  if (!analysis) return null;

  const sections = {
    functionalEquivalence: null,
    meaningfulDifferences: [],
    cosmeticVsFunctional: null,
    rootCauseSuggestions: [],
    confidenceLevel: 'UNKNOWN',
    recommendations: [],
    raw: analysis,
  };

  // Extract functional equivalence
  const eqMatch = analysis.match(/functional equivalence[:\s]*(YES|NO|PARTIAL)/i);
  if (eqMatch) {
    sections.functionalEquivalence = eqMatch[1].toUpperCase();
  }

  // Extract confidence level
  const confMatch = analysis.match(/confidence[:\s]*(LOW|MEDIUM|HIGH)/i);
  if (confMatch) {
    sections.confidenceLevel = confMatch[1].toUpperCase();
  }

  return sections;
}

export default {
  performRagAnalysis,
  parseAnalysisResponse,
};

