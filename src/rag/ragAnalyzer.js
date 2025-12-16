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
  // Missing/absence indicators
  'missing': 12,
  'absent': 10,
  'not found': 15,
  'notfound': 15,
  'no such': 12,
  'does not exist': 12,
  'doesn\'t exist': 12,
  'nonexistent': 10,
  // Invalid/bad state indicators
  'invalid': 12,
  'malformed': 12,
  'corrupt': 15,
  'corrupted': 15,
  'broken': 12,
  'bad': 8,
  'illegal': 12,
  // Timeout/connection issues
  'timeout': 15,
  'timed out': 15,
  'timedout': 15,
  'expired': 10,
  'expiration': 8,
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
  // Access/permission issues
  'denied': 12,
  'forbidden': 12,
  'unauthorized': 12,
  'unauthenticated': 12,
  'permission denied': 15,
  'access denied': 15,
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
  // Retry/recovery indicators (suggest prior failure)
  'retry': 8,
  'retrying': 8,
  'retried': 8,
  'recovering': 8,
  'recovery': 8,
  'fallback': 8,
  // Rejection indicators
  'rejected': 12,
  'reject': 10,
  'declined': 10,
  'refused': 12,
};

/**
 * Structural patterns that indicate error states
 * These are regex-like patterns with scoring
 */
const STRUCTURAL_PATTERNS = [
  // Arrow patterns pointing to error states
  { regex: /->?\s*(undefined|null|nil|none|false|empty|0|""|''|\[\]|\{\})\s*$/i, score: 25, category: 'NULL_STATE' },
  { regex: /=>\s*(undefined|null|nil|none|false|empty)\s*$/i, score: 25, category: 'NULL_STATE' },
  { regex: /:\s*(undefined|null|nil|none)\s*$/i, score: 20, category: 'NULL_STATE' },
  { regex: /returned?\s+(undefined|null|nil|none|nothing|empty)/i, score: 22, category: 'NULL_RETURN' },
  { regex: /returns?\s+(undefined|null|nil|none|nothing|empty)/i, score: 22, category: 'NULL_RETURN' },

  // "X not found" patterns
  { regex: /\b\w+\s+not\s+found\b/i, score: 20, category: 'NOT_FOUND' },
  { regex: /\bnot\s+found\s*:/i, score: 22, category: 'NOT_FOUND' },
  { regex: /\b(could|can)n?[o']?t?\s+(find|locate|get|retrieve|fetch|load)\b/i, score: 18, category: 'NOT_FOUND' },

  // "X failed" patterns
  { regex: /\b\w+\s+failed\s*(to|with|:|\[|\(|$)/i, score: 20, category: 'OPERATION_FAILED' },
  { regex: /\bfailed\s+to\s+\w+/i, score: 20, category: 'OPERATION_FAILED' },
  { regex: /\bfailure\s+(in|on|at|during|while)\b/i, score: 18, category: 'OPERATION_FAILED' },

  // Exception patterns
  { regex: /\bexception\s*:/i, score: 25, category: 'EXCEPTION' },
  { regex: /\b(throw|threw|thrown)\s+\w*exception/i, score: 25, category: 'EXCEPTION' },
  { regex: /\b\w+exception\b/i, score: 20, category: 'EXCEPTION' },
  { regex: /\b\w+error\b/i, score: 18, category: 'ERROR_TYPE' },

  // State retrieval failures
  { regex: /\b(get|fetch|retrieve|load|read)\s+\w+\s*(variable|value|data|config|setting|property).*->\s*(undefined|null)/i, score: 30, category: 'STATE_RETRIEVAL_FAILURE' },
  { regex: /\bvariable\s+not\s+found\b/i, score: 25, category: 'STATE_RETRIEVAL_FAILURE' },
  { regex: /\bsession\s+\w*\s*(not\s+found|undefined|null|expired|invalid)/i, score: 28, category: 'SESSION_ERROR' },
  { regex: /\bcache\s+(miss|failure|error|expired)/i, score: 22, category: 'CACHE_ERROR' },

  // Database/query errors
  { regex: /\b(sql|database|db|query)\s*(error|exception|failure|failed)/i, score: 25, category: 'DATABASE_ERROR' },
  { regex: /\bquery\s+failed\b/i, score: 22, category: 'DATABASE_ERROR' },
  { regex: /\bdeadlock\b/i, score: 25, category: 'DATABASE_ERROR' },
  { regex: /\bduplicate\s+(key|entry)\b/i, score: 20, category: 'DATABASE_ERROR' },

  // API/HTTP errors
  { regex: /\b(http|api)\s*(error|failure|failed|\d{3})/i, score: 20, category: 'API_ERROR' },
  { regex: /\bstatus\s*[=:]?\s*(4\d{2}|5\d{2})\b/i, score: 22, category: 'HTTP_ERROR' },
  { regex: /\b(4\d{2}|5\d{2})\s+(error|response|status)/i, score: 22, category: 'HTTP_ERROR' },

  // Memory/resource errors
  { regex: /\bout\s+of\s+(memory|space|disk|resources)/i, score: 30, category: 'RESOURCE_ERROR' },
  { regex: /\bmemory\s+(leak|overflow|exhausted)/i, score: 28, category: 'MEMORY_ERROR' },
  { regex: /\bheap\s+(overflow|exhausted|full)/i, score: 28, category: 'MEMORY_ERROR' },
  { regex: /\bstack\s+overflow\b/i, score: 30, category: 'MEMORY_ERROR' },

  // Assertion/validation failures
  { regex: /\bassertion\s+(failed|error)/i, score: 25, category: 'ASSERTION_FAILURE' },
  { regex: /\bvalidation\s+(failed|error|failure)/i, score: 20, category: 'VALIDATION_ERROR' },
  { regex: /\binvalid\s+\w+\s*(format|type|value|input|data)/i, score: 18, category: 'VALIDATION_ERROR' },

  // Authentication/authorization errors
  { regex: /\b(auth|authentication|authorization)\s*(failed|failure|error|denied)/i, score: 22, category: 'AUTH_ERROR' },
  { regex: /\btoken\s+(expired|invalid|missing|rejected)/i, score: 22, category: 'AUTH_ERROR' },
  { regex: /\bcredentials?\s+(invalid|expired|rejected|failed)/i, score: 22, category: 'AUTH_ERROR' },

  // Configuration errors
  { regex: /\bconfig(uration)?\s*(error|missing|invalid|not\s+found)/i, score: 20, category: 'CONFIG_ERROR' },
  { regex: /\bmissing\s+(required\s+)?(config|setting|parameter|argument)/i, score: 20, category: 'CONFIG_ERROR' },
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

      // Track category statistics
      categoryStats[primaryCategory] = (categoryStats[primaryCategory] || 0) + 1;

      errors.push({
        index: i + 1,
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
 * @returns {string} Formatted error summary
 */
function formatErrorsForPrompt(errorData) {
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
    lines.push(`[${err.index}] ${err.category} (${err.confidence}, score: ${err.score}): ${err.excerpt}`);
  }

  if (errorData.entries.length > 10) {
    lines.push(`... and ${errorData.entries.length - 10} more errors`);
  }

  return lines.join('\n');
}

/**
 * Builds the analysis prompt
 * @param {Object} params - Prompt parameters
 * @returns {string} Complete prompt
 */
function buildAnalysisPrompt({ blueLogs, greenLogs, comparisonReport, repoContext, relevantFiles }) {
  const blueLogsSummary = summarizeLogs(blueLogs);
  const greenLogsSummary = summarizeLogs(greenLogs);
  const repoContextStr = formatRepoContext(relevantFiles);

  // Extract and compare errors between blue and green using intelligent detection
  const blueErrorData = extractErrorEntries(blueLogs);
  const greenErrorData = extractErrorEntries(greenLogs);

  const diffSummary = comparisonReport.logDifferences.slice(0, 10).map(d => {
    const diffs = d.differences.map(diff =>
      `  - ${diff.kind} at "${diff.path}": blue="${diff.blueValue}" vs green="${diff.greenValue}"`
    ).join('\n');
    return `Entry #${d.index + 1}:\n${diffs}`;
  }).join('\n\n');

  // Build comparative error section with detailed statistics
  const blueErrorSummary = formatErrorsForPrompt(blueErrorData);
  const greenErrorSummary = formatErrorsForPrompt(greenErrorData);

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

---

### Analysis Request
Based on ALL the information above, especially the ERROR DETECTION RESULTS, provide:

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

4. **Root Cause Suggestions**: Which code files might be responsible?

5. **Confidence Level**: LOW/MEDIUM/HIGH

6. **Recommendations**: Investigation or fixes needed

Provide a structured response addressing the error detection findings.`;
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
    });

    result.prompt = prompt;

    if (verbose) {
      console.log(chalk.dim('\n--- PROMPT SENT TO LLM ---'));
      console.log(chalk.dim(prompt.substring(0, 2000) + (prompt.length > 2000 ? '\n... [truncated]' : '')));
      console.log(chalk.dim('--- END PROMPT ---\n'));
    }

    // Step 5: Generate analysis with LLM
    onProgress({ step: 'analyzing', message: 'Analyzing with Llama 3 8B...' });
    const analysis = await generateCompletion(prompt, {
      model,
      system: SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 2048,
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

