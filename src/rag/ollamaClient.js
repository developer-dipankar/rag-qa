/**
 * Ollama Client Module
 * Interfaces with locally running Ollama API for Llama 3 8B model
 */

export const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
export const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3:8b';

/**
 * Checks if Ollama is running and the model is available
 * @param {string} model - Model name to check
 * @returns {Promise<{available: boolean, error?: string}>}
 */
export async function checkOllamaAvailability(model = DEFAULT_MODEL) {
  try {
    // Check if Ollama is running
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!response.ok) {
      return { available: false, error: 'Ollama API is not responding' };
    }

    const data = await response.json();
    const models = data.models || [];
    
    // Check if the requested model is available
    const modelAvailable = models.some(m => 
      m.name === model || m.name.startsWith(model.split(':')[0])
    );

    if (!modelAvailable) {
      const availableModels = models.map(m => m.name).join(', ');
      return { 
        available: false, 
        error: `Model '${model}' not found. Available models: ${availableModels || 'none'}` 
      };
    }

    return { available: true, model };
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      return { available: false, error: 'Ollama is not running. Start it with: ollama serve' };
    }
    return { available: false, error: `Failed to connect to Ollama: ${error.message}` };
  }
}

/**
 * Generates a completion using Ollama
 * @param {string} prompt - The prompt to send to the model
 * @param {Object} options - Generation options
 * @param {string} options.model - Model to use (default: llama3:8b)
 * @param {string} options.system - System prompt
 * @param {number} options.temperature - Temperature for generation (default: 0.3)
 * @param {number} options.maxTokens - Maximum tokens to generate
 * @param {boolean} options.stream - Whether to stream the response
 * @returns {Promise<string>} Generated text
 */
export async function generateCompletion(prompt, options = {}) {
  const {
    model = DEFAULT_MODEL,
    system = '',
    temperature = 0.3,
    maxTokens = 4096,
    stream = false,
  } = options;

  const requestBody = {
    model,
    prompt,
    system,
    stream,
    options: {
      temperature,
      num_predict: maxTokens,
    },
  };

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const data = await response.json();
    return data.response;
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Ollama is not running. Start it with: ollama serve');
    }
    throw error;
  }
}

/**
 * Generates embeddings for text using Ollama
 * @param {string} text - Text to embed
 * @param {string} model - Embedding model (default: llama3:8b)
 * @returns {Promise<number[]>} Embedding vector
 */
export async function generateEmbedding(text, model = DEFAULT_MODEL) {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${await response.text()}`);
    }

    const data = await response.json();
    return data.embedding;
  } catch (error) {
    throw new Error(`Failed to generate embedding: ${error.message}`);
  }
}

/**
 * Calculates cosine similarity between two vectors
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} Cosine similarity (-1 to 1)
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export default {
  checkOllamaAvailability,
  generateCompletion,
  generateEmbedding,
  cosineSimilarity,
  OLLAMA_BASE_URL,
  DEFAULT_MODEL,
};

