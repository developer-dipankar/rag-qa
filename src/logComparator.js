import deepDiff from 'deep-diff';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { diff } = deepDiff;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Loads default ignore fields from configuration
 * @returns {Object} Configuration with ignoreFields and ignorePatterns
 */
export function loadDefaultIgnoreFields() {
  const configPath = path.join(__dirname, '../config/default-ignore-fields.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      ignoreFields: config.ignoreFields || [],
      ignorePatterns: config.ignorePatterns || [],
    };
  } catch (error) {
    console.warn('Could not load default ignore fields config, using empty defaults');
    return { ignoreFields: [], ignorePatterns: [] };
  }
}

/**
 * Checks if a field path should be ignored based on exact match or pattern
 * @param {string} fieldPath - Dot-notation field path (e.g., 'event.timestamp')
 * @param {string[]} ignoreFields - Array of field names to ignore
 * @param {string[]} ignorePatterns - Array of regex patterns to match against
 * @returns {boolean} True if the field should be ignored
 */
export function shouldIgnoreField(fieldPath, ignoreFields, ignorePatterns) {
  // Check exact match (including nested paths)
  if (ignoreFields.includes(fieldPath)) {
    return true;
  }

  // Check if any part of the path matches ignore fields
  const pathParts = fieldPath.split('.');
  if (pathParts.some((part) => ignoreFields.includes(part))) {
    return true;
  }

  // Check against regex patterns
  for (const pattern of ignorePatterns) {
    try {
      const regex = new RegExp(pattern);
      if (regex.test(fieldPath) || pathParts.some((part) => regex.test(part))) {
        return true;
      }
    } catch (e) {
      // Invalid regex pattern, skip
    }
  }

  return false;
}

/**
 * Removes ignored fields from an object (deep clone with filtering)
 * @param {Object} obj - The object to filter
 * @param {string[]} ignoreFields - Fields to ignore
 * @param {string[]} ignorePatterns - Patterns to ignore
 * @param {string} parentPath - Parent path for nested objects
 * @returns {Object} Filtered object
 */
export function removeIgnoredFields(obj, ignoreFields, ignorePatterns, parentPath = '') {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item, index) => 
      removeIgnoredFields(item, ignoreFields, ignorePatterns, `${parentPath}[${index}]`)
    );
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = parentPath ? `${parentPath}.${key}` : key;
    
    if (!shouldIgnoreField(fullPath, ignoreFields, ignorePatterns)) {
      result[key] = removeIgnoredFields(value, ignoreFields, ignorePatterns, fullPath);
    }
  }
  return result;
}

/**
 * Converts deep-diff path array to dot notation string
 * @param {Array} pathArray - Path array from deep-diff
 * @returns {string} Dot notation path
 */
function pathToString(pathArray) {
  if (!pathArray) return '';
  return pathArray.map((p, i) => {
    if (typeof p === 'number') return `[${p}]`;
    return i === 0 ? p : `.${p}`;
  }).join('');
}

/**
 * Compares two log entries and returns differences
 * @param {Object} blueLog - Log from the "blue" (expected) execution
 * @param {Object} greenLog - Log from the "green" (to validate) execution
 * @param {string[]} ignoreFields - Fields to ignore
 * @param {string[]} ignorePatterns - Patterns to ignore
 * @returns {Object} Comparison result with differences
 */
export function compareLogEntries(blueLog, greenLog, ignoreFields, ignorePatterns) {
  const filteredBlue = removeIgnoredFields(blueLog, ignoreFields, ignorePatterns);
  const filteredGreen = removeIgnoredFields(greenLog, ignoreFields, ignorePatterns);

  const differences = diff(filteredBlue, filteredGreen) || [];

  return {
    hasDifferences: differences.length > 0,
    differences: differences.map((d) => ({
      kind: d.kind, // N: new, D: deleted, E: edited, A: array change
      path: pathToString(d.path),
      blueValue: d.lhs,
      greenValue: d.rhs,
      index: d.index,
      item: d.item,
    })),
  };
}

/**
 * Compares two sets of workflow logs
 * @param {Array} blueLogs - Logs from the "blue" (expected) execution
 * @param {Array} greenLogs - Logs from the "green" (to validate) execution
 * @param {Object} options - Comparison options
 * @param {string[]} options.ignoreFields - Additional fields to ignore
 * @param {string[]} options.ignorePatterns - Additional patterns to ignore
 * @param {string} options.matchField - Field to use for matching logs between sets
 * @returns {Object} Full comparison report
 */
export function compareWorkflowLogs(blueLogs, greenLogs, options = {}) {
  const defaultConfig = loadDefaultIgnoreFields();
  const ignoreFields = [...defaultConfig.ignoreFields, ...(options.ignoreFields || [])];
  const ignorePatterns = [...defaultConfig.ignorePatterns, ...(options.ignorePatterns || [])];
  const matchField = options.matchField || 'log.level';

  const report = {
    summary: {
      blueLogCount: blueLogs.length,
      greenLogCount: greenLogs.length,
      matchedCount: 0,
      mismatchedCount: 0,
      blueOnlyCount: 0,
      greenOnlyCount: 0,
    },
    countMismatch: blueLogs.length !== greenLogs.length,
    sequenceDifferences: [],
    logDifferences: [],
    blueOnlyLogs: [],
    greenOnlyLogs: [],
    ignoredFields: ignoreFields,
    ignoredPatterns: ignorePatterns,
  };

  // Compare logs by index (sequence comparison)
  const maxLength = Math.max(blueLogs.length, greenLogs.length);

  for (let i = 0; i < maxLength; i++) {
    const blueLog = blueLogs[i];
    const greenLog = greenLogs[i];

    if (!blueLog) {
      report.greenOnlyLogs.push({ index: i, log: greenLog });
      report.summary.greenOnlyCount++;
      continue;
    }

    if (!greenLog) {
      report.blueOnlyLogs.push({ index: i, log: blueLog });
      report.summary.blueOnlyCount++;
      continue;
    }

    const comparison = compareLogEntries(blueLog, greenLog, ignoreFields, ignorePatterns);

    if (comparison.hasDifferences) {
      report.summary.mismatchedCount++;
      report.logDifferences.push({
        index: i,
        blueLog: removeIgnoredFields(blueLog, ignoreFields, ignorePatterns),
        greenLog: removeIgnoredFields(greenLog, ignoreFields, ignorePatterns),
        differences: comparison.differences,
      });
    } else {
      report.summary.matchedCount++;
    }
  }

  return report;
}

export default {
  loadDefaultIgnoreFields,
  shouldIgnoreField,
  removeIgnoredFields,
  compareLogEntries,
  compareWorkflowLogs,
};

