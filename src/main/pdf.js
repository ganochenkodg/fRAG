import path from 'path'
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

// In-memory cache for loaded PDF documents
const docsCache = new Map()

// Reads a PDF file without splitting into chunks.
export async function readPdf(filePath) {
  const loader = new PDFLoader(filePath)
  const docs = await loader.load()
  docsCache.set(filePath, docs)

  return {
    filePath,
    fileName: path.basename(filePath),
    totalPages: docs.length
  }
}

// Splits document into chunks using RecursiveCharacterTextSplitter.
export async function splitPdf(filePath, options = {}) {
  let docs = docsCache.get(filePath)
  if (!docs) {
    const loader = new PDFLoader(filePath)
    docs = await loader.load()
    docsCache.set(filePath, docs)
  }

  const { chunkSize = 1000, chunkOverlap = 150 } = options
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap
  })

  const splitDocs = await splitter.splitDocuments(docs)

  const chunks = splitDocs.map((doc, idx) => ({
    id: idx,
    content: doc.pageContent,
    metadata: doc.metadata
  }))

  return {
    filePath,
    fileName: path.basename(filePath),
    chunksCount: chunks.length,
    chunks
  }
}

// Loads a PDF and splits it into chunks in a single call.
export async function loadAndSplitPdf(filePath, options = {}) {
  const readResult = await readPdf(filePath)
  const splitResult = await splitPdf(filePath, options)

  return {
    ...readResult,
    chunksCount: splitResult.chunksCount,
    chunks: splitResult.chunks
  }
}
