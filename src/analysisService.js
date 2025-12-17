/**
 * Analysis Service Module
 * Provides log comparison and RAG analysis functionality for both CLI and web interfaces
 */

import { readLogsFromCsv } from './csvReader.js';
import { compareWorkflowLogs } from './logComparator.js';
import { performRagAnalysis } from './rag/ragAnalyzer.js';

/**
 * Performs complete log analysis
 * @param {Object} options - Analysis options
 * @param {string} options.blueFilePath - Path to blue CSV file
 * @param {string} options.greenFilePath - Path to green CSV file
 * @param {string} options.blueCsvName - Display name for blue CSV
 * @param {string} options.greenCsvName - Display name for green CSV
 * @param {boolean} options.useRag - Enable AI-powered analysis
 * @param {string} options.reposDir - Repository directory for context
 * @param {string} options.model - Ollama model to use
 * @param {boolean} options.verbose - Verbose RAG output
 * @param {string[]} options.ignoreFields - Fields to ignore in comparison
 * @param {string[]} options.ignorePatterns - Patterns to ignore in comparison
 * @param {boolean} options.unflatten - Convert dot-notation to nested objects
 * @param {string} options.sortField - Field to sort by
 * @param {string} options.sortOrder - Sort order (asc/desc)
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} Analysis result with report and optional ragResult
 */
export async function analyzeWorkflowLogs(options = {}) {
  const {
    blueFilePath,
    greenFilePath,
    blueCsvName = blueFilePath.split('/').pop(),
    greenCsvName = greenFilePath.split('/').pop(),
    useRag = false,
    reposDir = '/Users/dipankar/Repos',
    model = 'llama3:8b',
    verbose = false,
    ignoreFields = [],
    ignorePatterns = [],
    unflatten = true,
    sortField = '@timestamp',
    sortOrder = 'asc',
    onProgress = () => {},
  } = options;

  // Read blue logs
  onProgress({ stage: 'reading', message: `Reading blue logs from: ${blueCsvName}` });
  const blueLogs = await readLogsFromCsv(blueFilePath, {
    unflatten,
    sortField,
    sortOrder,
  });
  onProgress({ stage: 'reading', message: `Found ${blueLogs.length} blue log entries` });

  // Read green logs
  onProgress({ stage: 'reading', message: `Reading green logs from: ${greenCsvName}` });
  const greenLogs = await readLogsFromCsv(greenFilePath, {
    unflatten,
    sortField,
    sortOrder,
  });
  onProgress({ stage: 'reading', message: `Found ${greenLogs.length} green log entries` });

  // Compare logs
  onProgress({ stage: 'comparing', message: 'Comparing workflow logs...' });
  const report = compareWorkflowLogs(blueLogs, greenLogs, {
    ignoreFields,
    ignorePatterns,
  });

  // Perform RAG analysis if enabled
  let ragResult = null;
  if (useRag) {
    onProgress({ stage: 'rag', message: 'Starting AI-powered analysis...' });

    ragResult = await performRagAnalysis(blueLogs, greenLogs, report, {
      verbose,
      reposDir,
      model,
      blueCsvName,
      greenCsvName,
      onProgress: (progress) => {
        if (progress.message) {
          onProgress({ stage: 'rag', message: progress.message });
        }
      },
    });

    onProgress({ stage: 'rag', message: 'AI analysis complete' });
  }

  onProgress({ stage: 'complete', message: 'Analysis complete' });

  return {
    report,
    ragResult,
    blueCsvName,
    greenCsvName,
    blueLogCount: blueLogs.length,
    greenLogCount: greenLogs.length,
  };
}

export default {
  analyzeWorkflowLogs,
};

