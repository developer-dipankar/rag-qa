# Trace IQ

### AI-Powered Log Analysis & Regression Detection Tool

---

**Team:** 🚀 **Quantum Coders**

---

## 📋 Overview

The **Trace IQ** is an intelligent log analysis tool that compares workflow executions from ELK (Elasticsearch/Kibana) logs. It leverages AI-powered analysis using Llama 3 8B to automatically detect errors, identify regressions, and pinpoint root causes across distributed systems.

## ✨ Key Features

- **Blue-Green Comparison**: Compare baseline (blue) and validation (green) workflow logs side-by-side
- **Intelligent Error Detection**: Pattern-agnostic scoring system that automatically identifies errors without hardcoded patterns
- **AI-Powered Analysis**: Uses Llama 3 8B via Ollama for deep log analysis and root cause suggestions
- **CSV Line Number References**: Pinpoints exact log entries for quick investigation
- **Repository Context Awareness**: Correlates errors with relevant code files

## 🎯 Benefits

### 1. Easy Root Cause Identification
> **Pinpoint issues across Server, ML App, or Alloy Teams with precision**

The tool automatically identifies which component is responsible for failures by:
- Detecting error patterns in logs from different services
- Correlating failures with specific code files and functions
- Providing exact CSV line numbers for quick log navigation
- Categorizing errors by type (NULL_STATE, EXCEPTION, SESSION_ERROR, etc.)

### 2. Faster and More Efficient
> **Reduce debugging time from hours to minutes**

- **Automated Analysis**: No manual log parsing required
- **Intelligent Scoring**: High-confidence errors are prioritized automatically
- **Structured Reports**: Clear, actionable insights instead of raw log data
- **One Command**: Get comprehensive analysis with a single CLI command

### 3. Regression Automation Testing
> **Enable continuous quality assurance for future developments**

- **Baseline Comparison**: Compare new deployments against known-good baselines
- **Automated Detection**: Catch regressions before they reach production
- **CI/CD Integration**: Can be integrated into deployment pipelines
- **Historical Analysis**: Track workflow behavior changes over time

### 4. Secure & Private
> **Your data never leaves your environment**

- **Offline AI Model**: Uses locally-hosted Llama 3 8B via Ollama - no cloud API calls
- **No Data Exposure**: Sensitive log data stays within your infrastructure
- **Air-gapped Compatible**: Can run in environments without internet access
- **Compliance Friendly**: Meets data residency and privacy requirements

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Ollama with Llama 3 8B model (`ollama pull llama3:8b`)
- **Repository Path**: Path to your codebase for functional workflow analysis
  - The tool scans your code repositories to correlate log errors with specific code files
  - Default: `/Users/dipankar/Repos` (configurable via `--repos-dir`)

### Installation

```bash
npm install
```

### Usage

```bash
# Compare two workflow logs with AI analysis
npm run compare -- compare -b "blue.csv" -g "green.csv" --use-rag

# Specify custom repository path for code context
npm run compare -- compare -b "blue.csv" -g "green.csv" --use-rag --repos-dir "/path/to/your/repos"

# With verbose output (shows prompts and LLM reasoning)
npm run compare -- compare -b "blue.csv" -g "green.csv" --use-rag --rag-verbose

# List available log files
npm run compare -- list
```

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-b, --blue <file>` | Blue (baseline) log file | Required |
| `-g, --green <file>` | Green (validation) log file | Required |
| `--use-rag` | Enable AI-powered analysis | `false` |
| `--repos-dir <path>` | Repository path for code context | `/Users/dipankar/Repos` |
| `--rag-model <model>` | Ollama model to use | `llama3:8b` |
| `--rag-verbose` | Show detailed prompts/reasoning | `false` |

## 📊 Sample Output

```
════════════════════════════════════════════════════════════════════════════════
  🤖 AI-POWERED ANALYSIS
════════════════════════════════════════════════════════════════════════════════

### Root Cause Suggestions:

1. **Line 35 in green.csv**:
   * Error category: Session variable failure
   * What went wrong: The `ApplicationController` failed to encode parameters.
   * Responsible component: `ApplicationController`

2. **Line 60 in green.csv**:
   * Error category: Session variable failure  
   * What went wrong: The `Event_Controller` failed to process the command.
   * Responsible component: `Event_Controller`

### Confidence Level: HIGH

### Recommendations:
1. Investigate the root causes of session variable failures
2. Fix the issues found in the Green workflow
```

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   Blue Logs     │     │   Green Logs    │
│   (Baseline)    │     │  (Validation)   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │  Intelligent Error    │
         │  Detection Engine     │
         │  (Scoring-based)      │
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │   Llama 3 8B (RAG)    │
         │   Analysis Engine     │
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │   Structured Report   │
         │   with Line Numbers   │
         └───────────────────────┘
```

## 📁 Project Structure

```
elk-blue-green/
├── src/
│   ├── index.js            # CLI entry point
│   ├── csvReader.js        # CSV parsing with line numbers
│   ├── logComparator.js    # Log comparison logic
│   ├── reportGenerator.js  # Report formatting
│   └── rag/
│       └── ragAnalyzer.js  # AI-powered analysis engine
├── input/                  # CSV log files
└── package.json
```

## � Future Proposals

> **Roadmap for upcoming enhancements**

### 1. ELK API Integration
- **Direct Log Fetching**: Integrate with Elasticsearch APIs to fetch logs directly without manual CSV exports
- **Real-time Comparison**: Compare live workflows as they execute
- **Query Flexibility**: Use Elasticsearch queries to filter specific time ranges, sessions, or services
- **Scalable Processing**: Handle large log volumes efficiently through API pagination

### 2. Web Dashboard
- **Interactive UI**: Browser-based interface for log comparison and analysis
- **Visual Diff View**: Side-by-side log comparison with highlighted differences
- **Error Heatmaps**: Visual representation of error distribution across services
- **Historical Trends**: Charts showing regression patterns over time

### 3. Multi-Model AI Support
- **Model Selection**: Support for multiple LLM providers (OpenAI, Anthropic, local models)
- **Fine-tuned Models**: Custom models trained on internal log patterns
- **Ensemble Analysis**: Combine insights from multiple AI models for higher accuracy

### 4. CI/CD Pipeline Integration
- **GitHub Actions**: Ready-to-use workflow templates for automated regression testing
- **Jenkins Plugin**: Native integration with Jenkins pipelines
- **Slack/Teams Notifications**: Alert teams when regressions are detected
- **Automated Ticket Creation**: Create JIRA/ServiceNow tickets for detected issues

### 5. Advanced Analytics
- **Anomaly Detection**: ML-based detection of unusual patterns beyond errors
- **Performance Regression**: Detect latency and throughput regressions
- **Cross-Service Correlation**: Trace issues across microservices boundaries
- **Predictive Analysis**: Predict potential failures based on log patterns

---

## �👥 Team - Quantum Coders

Building intelligent solutions for complex distributed systems debugging.

