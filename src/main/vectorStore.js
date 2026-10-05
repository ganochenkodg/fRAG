import path from 'path'
import { app } from 'electron'
import { pipeline, env } from '@huggingface/transformers'
import { Embeddings } from '@langchain/core/embeddings'
import { Document } from '@langchain/core/documents'
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory'

// Configure local models path
env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = app.isPackaged
  ? path.join(process.resourcesPath, 'models')
  : path.join(app.getAppPath(), 'models')

let extractor = null
let vectorStore = null

// Gets or initializes the cached feature extraction pipeline.
export async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline('feature-extraction', 'multilingual-e5-small', {
      dtype: 'q8'
    })
  }
  return extractor
}

// Embeddings adapter using local multilingual-e5-small model.
export class LocalTransformersEmbeddings extends Embeddings {
  async embedDocuments(texts) {
    const ext = await getExtractor()
    return Promise.all(
      texts.map(async (text) => {
        const output = await ext(`passage: ${text}`, { pooling: 'mean', normalize: true })
        return Array.from(output.data)
      })
    )
  }

  async embedQuery(text) {
    const ext = await getExtractor()
    const output = await ext(`query: ${text}`, { pooling: 'mean', normalize: true })
    return Array.from(output.data)
  }
}

// Vectorizes chunks and stores them in MemoryVectorStore.
export async function indexChunks(chunks) {
  const startTime = performance.now()

  const embeddings = new LocalTransformersEmbeddings()
  vectorStore = new MemoryVectorStore(embeddings)

  const documents = chunks.map(
    (chunk) =>
      new Document({
        pageContent: chunk.content,
        metadata: {
          id: chunk.id,
          pageNumber: chunk.metadata?.loc?.pageNumber || 1,
          ...chunk.metadata
        }
      })
  )

  await vectorStore.addDocuments(documents)

  const durationMs = Math.round(performance.now() - startTime)

  return {
    indexedCount: documents.length,
    durationMs
  }
}

// Searches vector store for chunks matching minimum similarity score.
export async function searchChunks(query, limit = 2, minScore = 0.7) {
  if (!vectorStore) return []

  const resultsWithScore = await vectorStore.similaritySearchWithScore(query, limit)
  return resultsWithScore
    .filter(([, score]) => score >= minScore)
    .map(([doc, score]) => ({
      content: doc.pageContent,
      score,
      metadata: doc.metadata
    }))
}

// Clears the in-memory vector store instance.
export function clearVectorStore() {
  vectorStore = null
}
