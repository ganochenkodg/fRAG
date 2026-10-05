import { getCurrentApiKey } from './config'
import { BufferWindowMemory } from '@langchain/classic/memory'

const SYSTEM_PROMPT = `You are an intelligent, precise document analysis assistant. Your mission is to assist the user in exploring and comprehending information retrieved from their documents.

Follow these operational directives strictly:
1. PRIMARY SOURCE (DOCUMENT CONTEXT):
   - Anchor your answer strictly in the provided document excerpts.
   - Keep answers concise, direct, and factual. Avoid conversational filler, preamble, and unnecessary repetition.

2. SPECIFIC OR DOCUMENT-DEPENDENT QUESTIONS:
   - If the provided document excerpts do not contain the answer to a domain-specific or document-specific inquiry, explicitly state that you do not know based on the provided document.
   - NEVER fabricate facts, extrapolate beyond what is documented, or hallucinate citations.

3. GENERAL KNOWLEDGE QUESTIONS:
   - If the inquiry pertains to widely known general-knowledge facts (or foundational concepts) and you are 100% certain of the answer, you may answer concisely.
   - However, you MUST explicitly include a clear disclaimer stating that this answer is derived from general knowledge and was not found in the provided document.

4. LANGUAGE MATCHING:
   - Always respond in the language in which the user asked the question (e.g., if the user asks in Russian, answer in Russian; if in English, answer in English).

5. SOURCE CITATION:
   - At the very end of your response, if you used information from the document excerpts, state only the page number(s) on a new line in the exact format: "\nSource: page <number>" (or "\nSource: pages <numbers>"). Do not add extra words or explanations to the citation.
   - If no document information was used (or general knowledge was used), do not output a page citation.`

// Conversational memory with a sliding window of the last 2 interactions (2 pairs of user + assistant turns)
const memory = new BufferWindowMemory({
  k: 2,
  returnMessages: true
})

// Clears conversational memory buffer.
export async function clearMemory() {
  await memory.clear()
}

// Sends retrieved context chunks and query to Groq Cloud chat completions.
export async function askGroq({ query, chunks = [], model }) {
  const apiKey = getCurrentApiKey()
  if (!apiKey) {
    throw new Error('Groq API key is not configured. Please set your API key.')
  }

  let userContent = ''
  if (chunks.length > 0) {
    const contextText = chunks
      .map((chunk, idx) => {
        const page = chunk.metadata?.pageNumber
          ? `Page ${chunk.metadata.pageNumber}`
          : `Excerpt #${idx + 1}`
        const score =
          typeof chunk.score === 'number' ? ` | Relevance: ${chunk.score.toFixed(3)}` : ''
        return `[Source ${idx + 1} (${page}${score})]\n${chunk.content}`
      })
      .join('\n\n---\n\n')

    userContent = `Context from document:\n---\n${contextText}\n---\n\nUser Question:\n${query}`
  } else {
    userContent = `[No relevant document excerpts found with similarity score >= 0.7]\n\nUser Question:\n${query}`
  }

  // Load previous conversational turns from memory
  const memoryVars = await memory.loadMemoryVariables({})
  const historyMessages = (memoryVars.history || []).map((msg) => ({
    role: msg._getType() === 'human' ? 'user' : 'assistant',
    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
  }))

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...historyMessages,
    { role: 'user', content: userContent }
  ]

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2
    })
  })

  if (!response.ok) {
    let errorMessage = `Groq API request failed with status ${response.status} (${response.statusText})`
    try {
      const errJson = await response.json()
      if (errJson?.error?.message) {
        errorMessage = errJson.error.message
      }
    } catch {
      // Ignore JSON parse failure
    }
    throw new Error(errorMessage)
  }

  const data = await response.json()
  const answer = data.choices?.[0]?.message?.content || ''

  // Save the current turn into conversational memory for future turns
  await memory.saveContext({ input: query }, { output: answer })

  return {
    answer,
    model: data.model || model,
    usage: data.usage || null,
    chunks
  }
}
