import { OpenAI } from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Interface abstracting the embedding provider implementation.
 */
export interface EmbeddingProvider {
  /**
   * Generates embeddings for an array of input strings.
   * @param inputs Array of text strings to embed.
   * @returns Array of embedding vectors, preserving the order of the inputs.
   */
  generateEmbeddings(inputs: string[]): Promise<number[][]>;
  
  /**
   * Returns the vector dimension for this provider.
   */
  getDimension(): number;
}

/**
 * Implementation of EmbeddingProvider using Google Gemini (text-embedding-004).
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private ai: GoogleGenerativeAI;
  private modelName = 'gemini-embedding-2';
  
  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined');
    }
    this.ai = new GoogleGenerativeAI(apiKey);
  }

  async generateEmbeddings(inputs: string[]): Promise<number[][]> {
    const model = this.ai.getGenerativeModel({ model: this.modelName });
    
    // Process in batches if necessary, but the API supports multiple requests.
    // However, the official SDK doesn't have a single `embedBatch` helper in the same way,
    // so we map over inputs and call embedContent concurrently.
    const requests = inputs.map(text => model.embedContent(text));
    const responses = await Promise.all(requests);
    
    return responses.map(r => r.embedding.values);
  }

  getDimension(): number {
    return 3072; // gemini-embedding-2 produces 3072-dimensional vectors
  }
}

/**
 * Implementation of EmbeddingProvider using OpenAI (text-embedding-3-small).
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private openai: OpenAI;
  private modelName = 'text-embedding-3-small';

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not defined');
    }
    this.openai = new OpenAI({ apiKey });
  }

  async generateEmbeddings(inputs: string[]): Promise<number[][]> {
    const response = await this.openai.embeddings.create({
      model: this.modelName,
      input: inputs,
    });
    
    return response.data.map(d => d.embedding);
  }

  getDimension(): number {
    return 1536; // text-embedding-3-small produces 1536-dimensional vectors
  }
}

/**
 * Factory function to retrieve the preferred embedding provider.
 * Currently hardcoded to prefer Gemini as requested.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  // Check if Gemini API key exists, otherwise fallback to OpenAI or throw
  if (process.env.GEMINI_API_KEY) {
    return new GeminiEmbeddingProvider();
  } else if (process.env.OPENAI_API_KEY) {
    return new OpenAIEmbeddingProvider();
  }
  
  throw new Error('No embedding provider API keys found. Please define GEMINI_API_KEY.');
}
