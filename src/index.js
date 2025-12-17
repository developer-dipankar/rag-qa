#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import { resolveFilePath, readLogsFromCsv, listAvailableLogs } from './csvReader.js';
import { compareWorkflowLogs } from './logComparator.js';
import { generateFullReport } from './reportGenerator.js';
import { performRagAnalysis } from './rag/ragAnalyzer.js';

program
  .name('elk-blue-green')
  .description('Blue-green testing framework for comparing ELK logs from different workflow executions')
  .version('1.0.0');

program
  .command('compare')
  .description('Compare logs from two message IDs or CSV files')
  .requiredOption('-b, --blue <fileOrMessageId>', 'Message ID or CSV file path for the blue (expected/baseline) execution')
  .requiredOption('-g, --green <fileOrMessageId>', 'Message ID or CSV file path for the green (validation) execution')
  .option('-d, --input-dir <directory>', 'Directory containing CSV files', 'input')
  .option('--ignore <fields>', 'Comma-separated list of additional fields to ignore')
  .option('--ignore-pattern <patterns>', 'Comma-separated list of additional regex patterns to ignore')
  .option('-v, --verbose', 'Show full log content in differences', false)
  .option('--no-show-ignored', 'Hide ignored fields in report')
  .option('--no-unflatten', 'Do not convert dot-notation columns to nested objects')
  .option('--sort-field <field>', 'Field to sort logs by', '@timestamp')
  .option('--sort-order <order>', 'Sort order (asc or desc)', 'asc')
  // RAG options
  .option('--use-rag', 'Enable AI-powered analysis using Llama 3 8B via Ollama', false)
  .option('--rag-verbose', 'Show detailed RAG prompts and LLM reasoning', false)
  .option('--rag-model <model>', 'Ollama model to use for RAG analysis', 'llama3:8b')
  .option('--repos-dir <directory>', 'Directory containing repositories for context', '/Users/dipankar/Repos')
  .action(async (options) => {
    try {
      console.log(chalk.cyan('\n🔍 ELK Blue-Green Comparison Tool (CSV Mode)\n'));

      // Parse additional ignore fields and patterns
      const ignoreFields = options.ignore ? options.ignore.split(',').map(f => f.trim()) : [];
      const ignorePatterns = options.ignorePattern ? options.ignorePattern.split(',').map(p => p.trim()) : [];

      // Resolve file paths
      const blueFilePath = resolveFilePath(options.blue, options.inputDir);
      const greenFilePath = resolveFilePath(options.green, options.inputDir);

      // Read blue logs
      console.log(chalk.blue(`\nReading blue logs from: ${blueFilePath}`));
      const blueLogs = await readLogsFromCsv(blueFilePath, {
        unflatten: options.unflatten,
        sortField: options.sortField,
        sortOrder: options.sortOrder,
      });
      console.log(chalk.blue(`  Found ${blueLogs.length} log entries`));

      // Read green logs
      console.log(chalk.green(`\nReading green logs from: ${greenFilePath}`));
      const greenLogs = await readLogsFromCsv(greenFilePath, {
        unflatten: options.unflatten,
        sortField: options.sortField,
        sortOrder: options.sortOrder,
      });
      console.log(chalk.green(`  Found ${greenLogs.length} log entries`));

      // Compare logs
      console.log(chalk.dim('\nComparing workflow logs...'));
      const report = compareWorkflowLogs(blueLogs, greenLogs, {
        ignoreFields,
        ignorePatterns,
      });

      // Perform RAG analysis if enabled
      let ragResult = null;
      if (options.useRag) {
        console.log(chalk.cyan('\n🤖 Starting AI-powered analysis...\n'));

        // Extract just the file names from the paths for display
        const blueCsvName = blueFilePath.split('/').pop();
        const greenCsvName = greenFilePath.split('/').pop();

        ragResult = await performRagAnalysis(blueLogs, greenLogs, report, {
          verbose: options.ragVerbose,
          reposDir: options.reposDir,
          model: options.ragModel,
          blueCsvName,
          greenCsvName,
          onProgress: (progress) => {
            if (progress.message) {
              console.log(chalk.dim(`  ${progress.message}`));
            }
          },
        });
      }

      // Generate report (with or without RAG analysis)
      const exitCode = generateFullReport(report, ragResult, {
        verbose: options.verbose,
        showIgnored: options.showIgnored,
        blueMessageId: options.blue,
        greenMessageId: options.green,
      });

      process.exit(exitCode);
    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List available log files in the input directory')
  .option('-d, --input-dir <directory>', 'Directory containing CSV files', 'input')
  .action((options) => {
    console.log(chalk.cyan('\n� Available Log Files\n'));

    const logs = listAvailableLogs(options.inputDir);

    if (logs.length === 0) {
      console.log(chalk.yellow(`  No CSV files found in '${options.inputDir}' directory`));
      console.log(chalk.dim(`\n  To use this tool, export logs from ELK as CSV and place them in the '${options.inputDir}' folder.`));
      console.log(chalk.dim(`  Name the files using the message ID, e.g., 'input/<message-id>.csv'\n`));
    } else {
      console.log(chalk.dim(`  Found ${logs.length} log file(s) in '${options.inputDir}':\n`));
      logs.forEach(log => {
        console.log(chalk.white(`    • ${log}`));
      });
      console.log();
    }
  });

// Parse and run
program.parse();

