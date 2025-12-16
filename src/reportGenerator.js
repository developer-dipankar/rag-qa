import chalk from 'chalk';

/**
 * Formats a diff kind code into a readable label
 * @param {string} kind - The diff kind (N, D, E, A)
 * @returns {string} Human-readable label
 */
function formatDiffKind(kind) {
  const kinds = {
    N: chalk.green('ADDED'),
    D: chalk.red('DELETED'),
    E: chalk.yellow('CHANGED'),
    A: chalk.blue('ARRAY CHANGED'),
  };
  return kinds[kind] || kind;
}

/**
 * Formats a value for display, truncating if too long
 * @param {any} value - The value to format
 * @param {number} maxLength - Maximum string length
 * @returns {string} Formatted value
 */
function formatValue(value, maxLength = 80) {
  if (value === undefined) return chalk.dim('undefined');
  if (value === null) return chalk.dim('null');
  
  let str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (str.length > maxLength) {
    str = str.substring(0, maxLength) + '...';
  }
  return str;
}

/**
 * Prints a horizontal divider
 * @param {string} char - Character to use for the divider
 * @param {number} length - Length of the divider
 */
function printDivider(char = '─', length = 80) {
  console.log(chalk.dim(char.repeat(length)));
}

/**
 * Prints the summary section of the comparison report
 * @param {Object} report - The comparison report
 */
function printSummary(report) {
  console.log('\n');
  printDivider('═');
  console.log(chalk.bold.cyan('  📊 COMPARISON SUMMARY'));
  printDivider('═');
  console.log();

  const { summary } = report;

  // Log counts
  console.log(chalk.bold('  Log Counts:'));
  console.log(`    Blue (Expected):    ${chalk.blue(summary.blueLogCount)} logs`);
  console.log(`    Green (Validation): ${chalk.green(summary.greenLogCount)} logs`);
  
  if (report.countMismatch) {
    console.log(chalk.yellow(`    ⚠️  Count mismatch detected!`));
  }
  console.log();

  // Match statistics
  console.log(chalk.bold('  Comparison Results:'));
  console.log(`    ✅ Matched:      ${chalk.green(summary.matchedCount)}`);
  console.log(`    ❌ Mismatched:   ${chalk.red(summary.mismatchedCount)}`);
  console.log(`    🔵 Blue Only:    ${chalk.blue(summary.blueOnlyCount)}`);
  console.log(`    🟢 Green Only:   ${chalk.green(summary.greenOnlyCount)}`);
  console.log();

  // Overall status
  const isMatch = summary.mismatchedCount === 0 && 
                  summary.blueOnlyCount === 0 && 
                  summary.greenOnlyCount === 0;
  
  if (isMatch) {
    console.log(chalk.bold.green('  ✅ RESULT: Workflows match!'));
  } else {
    console.log(chalk.bold.red('  ❌ RESULT: Workflows have differences'));
  }
  console.log();
}

/**
 * Prints details of log differences
 * @param {Object} report - The comparison report
 * @param {boolean} verbose - Whether to show full log content
 */
function printDifferences(report, verbose = false) {
  if (report.logDifferences.length === 0) {
    return;
  }

  printDivider('═');
  console.log(chalk.bold.yellow('  🔍 LOG DIFFERENCES'));
  printDivider('═');
  console.log();

  for (const diff of report.logDifferences) {
    console.log(chalk.bold(`  Log Entry #${diff.index + 1}`));
    printDivider('─', 60);

    for (const d of diff.differences) {
      console.log(`    ${formatDiffKind(d.kind)} at ${chalk.cyan(d.path || 'root')}`);
      
      if (d.kind === 'E') {
        console.log(`      Blue:  ${formatValue(d.blueValue)}`);
        console.log(`      Green: ${formatValue(d.greenValue)}`);
      } else if (d.kind === 'N') {
        console.log(`      Added: ${formatValue(d.greenValue)}`);
      } else if (d.kind === 'D') {
        console.log(`      Removed: ${formatValue(d.blueValue)}`);
      } else if (d.kind === 'A') {
        console.log(`      Index: ${d.index}`);
        console.log(`      Change: ${formatValue(d.item)}`);
      }
    }

    if (verbose) {
      console.log(chalk.dim('\n    Full Blue Log:'));
      console.log(chalk.dim(JSON.stringify(diff.blueLog, null, 2).split('\n').map(l => '    ' + l).join('\n')));
      console.log(chalk.dim('\n    Full Green Log:'));
      console.log(chalk.dim(JSON.stringify(diff.greenLog, null, 2).split('\n').map(l => '    ' + l).join('\n')));
    }

    console.log();
  }
}

/**
 * Prints logs that only exist in one set
 * @param {Object} report - The comparison report
 */
function printOrphanLogs(report) {
  if (report.blueOnlyLogs.length > 0) {
    printDivider('═');
    console.log(chalk.bold.blue('  🔵 BLUE-ONLY LOGS (Missing in Green)'));
    printDivider('═');
    console.log();

    for (const item of report.blueOnlyLogs) {
      console.log(chalk.blue(`  Log Entry #${item.index + 1}`));
      console.log(`    ${chalk.dim(formatValue(JSON.stringify(item.log), 200))}`);
      console.log();
    }
  }

  if (report.greenOnlyLogs.length > 0) {
    printDivider('═');
    console.log(chalk.bold.green('  🟢 GREEN-ONLY LOGS (Extra in Green)'));
    printDivider('═');
    console.log();

    for (const item of report.greenOnlyLogs) {
      console.log(chalk.green(`  Log Entry #${item.index + 1}`));
      console.log(`    ${chalk.dim(formatValue(JSON.stringify(item.log), 200))}`);
      console.log();
    }
  }
}

/**
 * Prints the ignored fields configuration
 * @param {Object} report - The comparison report
 */
function printIgnoredFields(report) {
  printDivider('─');
  console.log(chalk.dim('  Ignored Fields: ' + report.ignoredFields.slice(0, 5).join(', ') +
    (report.ignoredFields.length > 5 ? ` and ${report.ignoredFields.length - 5} more...` : '')));
  console.log(chalk.dim('  Ignored Patterns: ' + report.ignoredPatterns.join(', ')));
  printDivider('─');
}

/**
 * Generates and prints the full comparison report to console
 * @param {Object} report - The comparison report from compareWorkflowLogs
 * @param {Object} options - Display options
 * @param {boolean} options.verbose - Show full log content in differences
 * @param {boolean} options.showIgnored - Show ignored fields configuration
 * @param {string} options.blueMessageId - Blue message ID for display
 * @param {string} options.greenMessageId - Green message ID for display
 */
export function generateConsoleReport(report, options = {}) {
  const { verbose = false, showIgnored = true, blueMessageId, greenMessageId } = options;

  console.log('\n');
  console.log(chalk.bold.magenta('═══════════════════════════════════════════════════════════════════════════════'));
  console.log(chalk.bold.magenta('                    ELK BLUE-GREEN WORKFLOW COMPARISON REPORT                   '));
  console.log(chalk.bold.magenta('═══════════════════════════════════════════════════════════════════════════════'));

  if (blueMessageId || greenMessageId) {
    console.log();
    console.log(chalk.dim(`  Blue Message ID:  ${blueMessageId || 'N/A'}`));
    console.log(chalk.dim(`  Green Message ID: ${greenMessageId || 'N/A'}`));
  }

  if (showIgnored) {
    printIgnoredFields(report);
  }

  printSummary(report);
  printDifferences(report, verbose);
  printOrphanLogs(report);

  console.log(chalk.bold.magenta('═══════════════════════════════════════════════════════════════════════════════'));
  console.log(chalk.dim(`  Report generated at: ${new Date().toISOString()}`));
  console.log(chalk.bold.magenta('═══════════════════════════════════════════════════════════════════════════════'));
  console.log('\n');

  // Return exit code suggestion based on comparison result
  const isMatch = report.summary.mismatchedCount === 0 &&
                  report.summary.blueOnlyCount === 0 &&
                  report.summary.greenOnlyCount === 0;
  return isMatch ? 0 : 1;
}

/**
 * Prints the AI-powered analysis section
 * @param {Object} ragResult - Result from RAG analysis
 */
export function printAiAnalysis(ragResult) {
  console.log('\n');
  printDivider('═');
  console.log(chalk.bold.cyan('  🤖 AI-POWERED ANALYSIS'));
  console.log(chalk.dim('     Powered by Llama 3 8B via Ollama'));
  printDivider('═');
  console.log();

  // Disclaimer
  console.log(chalk.yellow('  ⚠️  DISCLAIMER: This analysis is generated by an AI model and should be'));
  console.log(chalk.yellow('     verified by a human. LLMs can make mistakes or miss important details.'));
  console.log();
  printDivider('─', 60);

  if (!ragResult.success) {
    console.log(chalk.red(`  ❌ AI Analysis Failed: ${ragResult.error}`));
    console.log();
    return;
  }

  // Print the analysis
  const lines = ragResult.analysis.split('\n');
  for (const line of lines) {
    // Highlight section headers
    if (line.match(/^\d+\.\s+\*\*|^#+\s+|^\*\*[^*]+\*\*:/)) {
      console.log(chalk.cyan(`  ${line}`));
    } else if (line.toLowerCase().includes('yes') && line.toLowerCase().includes('functional')) {
      console.log(chalk.green(`  ${line}`));
    } else if (line.toLowerCase().includes('no') && line.toLowerCase().includes('functional')) {
      console.log(chalk.red(`  ${line}`));
    } else if (line.toLowerCase().includes('high') && line.toLowerCase().includes('confidence')) {
      console.log(chalk.green(`  ${line}`));
    } else if (line.toLowerCase().includes('low') && line.toLowerCase().includes('confidence')) {
      console.log(chalk.yellow(`  ${line}`));
    } else {
      console.log(chalk.white(`  ${line}`));
    }
  }

  console.log();
  printDivider('─', 60);

  // Metadata
  console.log(chalk.dim(`  Analysis completed in ${(ragResult.metadata.durationMs / 1000).toFixed(1)}s`));
  console.log(chalk.dim(`  Model: ${ragResult.metadata.model}`));
  if (ragResult.metadata.repoContextUsed) {
    console.log(chalk.dim(`  Repository context: ${ragResult.metadata.relevantFilesCount} relevant files found`));
  }
  console.log();
}

/**
 * Generates complete report including optional AI analysis
 * @param {Object} report - Comparison report
 * @param {Object} ragResult - Optional RAG analysis result
 * @param {Object} options - Display options
 * @returns {number} Exit code (0 = match, 1 = differences)
 */
export function generateFullReport(report, ragResult = null, options = {}) {
  const exitCode = generateConsoleReport(report, options);

  if (ragResult) {
    printAiAnalysis(ragResult);

    console.log(chalk.bold.magenta('═══════════════════════════════════════════════════════════════════════════════'));
    console.log(chalk.bold.magenta('                              END OF REPORT                                    '));
    console.log(chalk.bold.magenta('═══════════════════════════════════════════════════════════════════════════════'));
    console.log('\n');
  }

  return exitCode;
}

export default {
  generateConsoleReport,
  printAiAnalysis,
  generateFullReport,
};

