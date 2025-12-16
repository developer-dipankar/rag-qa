/**
 * Repository Context Gatherer
 * Scans repositories for relevant workflow definitions and code context
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { generateEmbedding, cosineSimilarity } from './ollamaClient.js';

const DEFAULT_REPOS_DIR = '/Users/dipankar/Repos';
const CACHE_DIR = '.rag-cache';
const CACHE_FILE = 'repo-context-cache.json';

// File patterns to look for workflow-related code
const RELEVANT_FILE_PATTERNS = [
  '**/*.yaml',
  '**/*.yml',
  '**/*.json',
  '**/*.xml',
  '**/*.js',
  '**/*.ts',
  '**/*.py',
  '**/*.java',
  '**/*.conf',
  '**/*.cfg',
  '**/*.properties',
];

// Directories to exclude
const EXCLUDE_DIRS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/target/**',
  '**/__pycache__/**',
  '**/venv/**',
  '**/.venv/**',
  '**/vendor/**',
];

// Keywords that indicate workflow-related content
const WORKFLOW_KEYWORDS = [
  'workflow', 'pipeline', 'step', 'stage', 'task', 'job',
  'handler', 'processor', 'dispatcher', 'router', 'controller',
  'service', 'queue', 'message', 'event', 'trigger',
  'state', 'transition', 'action', 'command',
];

/**
 * Gets the cache file path
 * @returns {string} Cache file path
 */
function getCachePath() {
  const cacheDir = path.join(process.cwd(), CACHE_DIR);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return path.join(cacheDir, CACHE_FILE);
}

/**
 * Loads cached repository context
 * @returns {Object|null} Cached context or null
 */
function loadCache() {
  const cachePath = getCachePath();
  if (fs.existsSync(cachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      // Check if cache is less than 1 hour old
      if (Date.now() - data.timestamp < 3600000) {
        return data;
      }
    } catch (e) {
      // Cache corrupted, ignore
    }
  }
  return null;
}

/**
 * Saves repository context to cache
 * @param {Object} context - Context to cache
 */
function saveCache(context) {
  const cachePath = getCachePath();
  fs.writeFileSync(cachePath, JSON.stringify({
    ...context,
    timestamp: Date.now(),
  }, null, 2));
}

/**
 * Checks if a file contains workflow-related content
 * @param {string} content - File content
 * @returns {boolean} Whether file is relevant
 */
function isWorkflowRelated(content) {
  const lowerContent = content.toLowerCase();
  return WORKFLOW_KEYWORDS.some(keyword => lowerContent.includes(keyword));
}

/**
 * Extracts a summary snippet from file content
 * @param {string} content - Full file content
 * @param {number} maxLines - Maximum lines to extract
 * @returns {string} Summarized content
 */
function extractSnippet(content, maxLines = 50) {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  
  // Take first 25 and last 25 lines
  const firstHalf = lines.slice(0, Math.floor(maxLines / 2));
  const secondHalf = lines.slice(-Math.floor(maxLines / 2));
  
  return [...firstHalf, '... [truncated] ...', ...secondHalf].join('\n');
}

/**
 * Lists all repositories in a directory
 * @param {string} reposDir - Directory containing repositories
 * @returns {string[]} List of repository paths
 */
export function listRepositories(reposDir = DEFAULT_REPOS_DIR) {
  if (!fs.existsSync(reposDir)) {
    return [];
  }

  return fs.readdirSync(reposDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .filter(dirent => !dirent.name.startsWith('.'))
    .filter(dirent => fs.existsSync(path.join(reposDir, dirent.name, '.git')))
    .map(dirent => path.join(reposDir, dirent.name));
}

/**
 * Scans a repository for workflow-related files
 * @param {string} repoPath - Path to the repository
 * @returns {Promise<Object[]>} Array of file context objects
 */
async function scanRepository(repoPath) {
  const repoName = path.basename(repoPath);
  const files = [];

  for (const pattern of RELEVANT_FILE_PATTERNS) {
    try {
      const matches = await glob(pattern, {
        cwd: repoPath,
        ignore: EXCLUDE_DIRS,
        nodir: true,
        absolute: false,
      });

      for (const match of matches) {
        const filePath = path.join(repoPath, match);
        try {
          const stat = fs.statSync(filePath);
          // Skip files larger than 100KB
          if (stat.size > 100 * 1024) continue;

          const content = fs.readFileSync(filePath, 'utf-8');

          if (isWorkflowRelated(content)) {
            files.push({
              repo: repoName,
              path: match,
              fullPath: filePath,
              content: extractSnippet(content),
              size: stat.size,
            });
          }
        } catch (e) {
          // Skip unreadable files
        }
      }
    } catch (e) {
      // Pattern match failed, skip
    }
  }

  return files;
}

/**
 * Gathers context from all repositories
 * @param {Object} options - Options
 * @param {string} options.reposDir - Directory containing repos
 * @param {boolean} options.useCache - Whether to use cache
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} Repository context
 */
export async function gatherRepositoryContext(options = {}) {
  const {
    reposDir = DEFAULT_REPOS_DIR,
    useCache = true,
    onProgress = () => {},
  } = options;

  // Try to load from cache
  if (useCache) {
    const cached = loadCache();
    if (cached && cached.reposDir === reposDir) {
      onProgress({ status: 'cache_hit', message: 'Using cached repository context' });
      return cached;
    }
  }

  onProgress({ status: 'scanning', message: 'Scanning repositories...' });

  const repos = listRepositories(reposDir);
  const allFiles = [];
  const repoSummaries = {};

  for (let i = 0; i < repos.length; i++) {
    const repoPath = repos[i];
    const repoName = path.basename(repoPath);

    onProgress({
      status: 'scanning_repo',
      message: `Scanning ${repoName} (${i + 1}/${repos.length})`,
      progress: (i + 1) / repos.length,
    });

    const files = await scanRepository(repoPath);
    allFiles.push(...files);

    repoSummaries[repoName] = {
      path: repoPath,
      fileCount: files.length,
      files: files.map(f => f.path),
    };
  }

  const context = {
    reposDir,
    repoCount: repos.length,
    fileCount: allFiles.length,
    repos: repoSummaries,
    files: allFiles,
  };

  // Save to cache
  if (useCache) {
    saveCache(context);
    onProgress({ status: 'cached', message: 'Repository context cached' });
  }

  return context;
}

/**
 * Finds files relevant to log patterns using semantic search
 * @param {Object} repoContext - Repository context
 * @param {string[]} logPatterns - Patterns extracted from logs
 * @param {Object} options - Search options
 * @returns {Promise<Object[]>} Relevant files with similarity scores
 */
export async function findRelevantFiles(repoContext, logPatterns, options = {}) {
  const { topK = 10, useEmbeddings = false } = options;

  if (!repoContext.files || repoContext.files.length === 0) {
    return [];
  }

  // Simple keyword-based matching (faster, no embeddings required)
  if (!useEmbeddings) {
    const scored = repoContext.files.map(file => {
      let score = 0;
      const lowerContent = file.content.toLowerCase();
      const lowerPath = file.path.toLowerCase();

      for (const pattern of logPatterns) {
        const lowerPattern = pattern.toLowerCase();
        if (lowerContent.includes(lowerPattern)) score += 2;
        if (lowerPath.includes(lowerPattern)) score += 3;
      }

      return { ...file, relevanceScore: score };
    });

    return scored
      .filter(f => f.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, topK);
  }

  // Embedding-based semantic search (slower but more accurate)
  try {
    const queryText = logPatterns.join(' ');
    const queryEmbedding = await generateEmbedding(queryText);

    const scored = await Promise.all(
      repoContext.files.slice(0, 100).map(async (file) => {
        try {
          const fileEmbedding = await generateEmbedding(file.content.slice(0, 1000));
          const similarity = cosineSimilarity(queryEmbedding, fileEmbedding);
          return { ...file, relevanceScore: similarity };
        } catch (e) {
          return { ...file, relevanceScore: 0 };
        }
      })
    );

    return scored
      .filter(f => f.relevanceScore > 0.3)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, topK);
  } catch (e) {
    // Fall back to keyword matching
    return findRelevantFiles(repoContext, logPatterns, { ...options, useEmbeddings: false });
  }
}

/**
 * Extracts key patterns from logs for context matching
 * @param {Object[]} logs - Log entries
 * @returns {string[]} Extracted patterns
 */
export function extractLogPatterns(logs) {
  const patterns = new Set();

  for (const log of logs) {
    // Extract from message field
    if (log.message) {
      // Extract bracketed terms like [nSM:xxx]
      const brackets = log.message.match(/\[([^\]]+)\]/g) || [];
      brackets.forEach(b => {
        const term = b.replace(/[\[\]]/g, '').split(':')[0];
        if (term && term.length > 2) patterns.add(term);
      });
    }

    // Extract from log file path
    if (log.log?.file?.path) {
      const filename = path.basename(log.log.file.path, path.extname(log.log.file.path));
      patterns.add(filename);
    }

    // Extract from event type
    if (log.event?.type) patterns.add(log.event.type);
    if (log.event?.action) patterns.add(log.event.action);

    // Extract from service name
    if (log.service?.name) patterns.add(log.service.name);
  }

  return Array.from(patterns).filter(p => p.length > 2);
}

export default {
  listRepositories,
  gatherRepositoryContext,
  findRelevantFiles,
  extractLogPatterns,
};

