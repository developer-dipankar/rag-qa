import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

const DEFAULT_INPUT_DIR = 'input';

/**
 * Resolves the CSV file path for a given message ID or file path
 * @param {string} fileOrMessageId - Either a file path or a message ID
 * @param {string} inputDir - Directory containing CSV files (default: 'input')
 * @returns {string} Resolved file path
 */
export function resolveFilePath(fileOrMessageId, inputDir = DEFAULT_INPUT_DIR) {
  // If it looks like a file path (contains path separator or ends with .csv), use it directly
  if (fileOrMessageId.includes(path.sep) || fileOrMessageId.includes('/') || fileOrMessageId.endsWith('.csv')) {
    return fileOrMessageId;
  }
  
  // Otherwise, treat it as a message ID and look for it in the input directory
  const csvPath = path.join(inputDir, `${fileOrMessageId}.csv`);
  return csvPath;
}

/**
 * Parses a value attempting to convert to appropriate type
 * @param {string} value - The string value to parse
 * @returns {any} Parsed value (number, boolean, null, or original string)
 */
function parseValue(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  
  // Check for null/undefined strings
  if (value.toLowerCase() === 'null') return null;
  if (value.toLowerCase() === 'undefined') return undefined;
  
  // Check for boolean
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  
  // Check for number
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') {
    return num;
  }
  
  // Try to parse JSON (for nested objects/arrays)
  if ((value.startsWith('{') && value.endsWith('}')) || 
      (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value);
    } catch (e) {
      // Not valid JSON, return as string
    }
  }
  
  return value;
}

/**
 * Converts flat CSV row with dot-notation keys to nested object
 * @param {Object} flatRow - Flat object with dot-notation keys
 * @returns {Object} Nested object
 */
function unflattenObject(flatRow) {
  const result = {};
  
  for (const [key, value] of Object.entries(flatRow)) {
    const keys = key.split('.');
    let current = result;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      // Check if next key is a number (array index)
      const nextKey = keys[i + 1];
      const isNextArray = /^\d+$/.test(nextKey);
      
      if (!(k in current)) {
        current[k] = isNextArray ? [] : {};
      }
      current = current[k];
    }
    
    const finalKey = keys[keys.length - 1];
    current[finalKey] = parseValue(value);
  }
  
  return result;
}

/**
 * Reads and parses a CSV file containing ELK logs
 * @param {string} filePath - Path to the CSV file
 * @param {Object} options - Parsing options
 * @param {boolean} options.unflatten - Convert dot-notation columns to nested objects (default: true)
 * @param {string} options.sortField - Field to sort by (default: '@timestamp')
 * @param {string} options.sortOrder - Sort order 'asc' or 'desc' (default: 'asc')
 * @returns {Promise<Array>} Array of log objects
 */
export async function readLogsFromCsv(filePath, options = {}) {
  const {
    unflatten = true,
    sortField = '@timestamp',
    sortOrder = 'asc',
  } = options;

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found: ${filePath}`);
  }

  // Read file content
  const fileContent = fs.readFileSync(filePath, 'utf-8');

  // Parse CSV
  const records = parse(fileContent, {
    columns: true,           // Use first row as headers
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  });

  // Convert records to log objects
  let logs = records.map((record, index) => {
    const log = unflatten ? unflattenObject(record) : record;
    // Add index for reference if not present
    if (!log._csvIndex) {
      log._csvIndex = index;
    }
    return log;
  });

  // Sort logs if sortField exists in the data
  logs.sort((a, b) => {
    const aVal = getNestedValue(a, sortField);
    const bVal = getNestedValue(b, sortField);
    
    if (aVal === undefined && bVal === undefined) return 0;
    if (aVal === undefined) return 1;
    if (bVal === undefined) return -1;
    
    const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  return logs;
}

/**
 * Gets a nested value from an object using dot notation
 * @param {Object} obj - The object to get value from
 * @param {string} path - Dot-notation path
 * @returns {any} The value at the path
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined;
  }, obj);
}

/**
 * Lists available CSV files in the input directory
 * @param {string} inputDir - Directory to search (default: 'input')
 * @returns {string[]} Array of CSV file names (without extension)
 */
export function listAvailableLogs(inputDir = DEFAULT_INPUT_DIR) {
  if (!fs.existsSync(inputDir)) {
    return [];
  }
  
  return fs.readdirSync(inputDir)
    .filter(file => file.endsWith('.csv'))
    .map(file => file.replace('.csv', ''));
}

export default {
  resolveFilePath,
  readLogsFromCsv,
  listAvailableLogs,
};

