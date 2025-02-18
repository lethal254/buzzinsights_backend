import { config } from "dotenv"
config()

// ----- Imports -----
import { Pinecone } from "@pinecone-database/pinecone"
import { StateGraph, START, END, Annotation } from "@langchain/langgraph"
import { MemorySaver } from "@langchain/langgraph"
import { PineconeStore } from "@langchain/pinecone"
import { chatModel, embeddings } from "./aiConfig"
import { Document } from "@langchain/core/documents"

import {
  GraphAnnotation,
  dateExtractionNode,
  generationNode,
} from "./langGraphPipeline.utils"

// ----- Message Store -----
interface ChatMessage {
  type: "user" | "assistant"
  content: string
}

// ----- Initialize Prisma and Pinecone -----
if (!process.env.PINECONE_API_KEY) {
  throw new Error("PINECONE_API_KEY is not defined")
}
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY })
const pineconeIndex = pinecone.Index("buzzinsights")

// Add query preprocessing
function preprocessQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\w\s?]/g, " ")
    .trim()
}

// Add query expansion
async function expandQuery(query: string): Promise<string[]> {
  const prompt = `Generate 2-3 alternative ways to ask this question, keeping the same meaning: "${query}"`
  const response = await chatModel.invoke(prompt)
  const content =
    typeof response.content === "string"
      ? response.content
      : Array.isArray(response.content)
      ? response.content.map((c) => (typeof c === "string" ? c : "")).join("\n")
      : ""

  const variations = content.split("\n").map((v: string) => v.trim())
  return [query, ...variations.filter((v: string) => v.length > 0)]
}

// Add cosine similarity function
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0)
  const magnitudeA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0))
  const magnitudeB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0))
  return dotProduct / (magnitudeA * magnitudeB)
}

// Add MMR implementation
async function diversifyResults(
  candidates: Document[],
  query: string,
  k: number = 5,
  lambdaParam: number = 0.5
): Promise<Document[]> {
  if (candidates.length <= k) return candidates

  // Get embeddings for query and all documents
  const queryEmbedding = await embeddings.embedQuery(query)
  const docEmbeddings = await Promise.all(
    candidates.map((doc) => embeddings.embedQuery(doc.pageContent))
  )

  // Calculate relevance scores
  const relevanceScores = docEmbeddings.map((embedding) =>
    cosineSimilarity(queryEmbedding, embedding)
  )

  const selected: number[] = []
  const selectedDocs: Document[] = []

  // Select first document with highest relevance
  let nextIdx = relevanceScores.indexOf(Math.max(...relevanceScores))
  selected.push(nextIdx)
  selectedDocs.push(candidates[nextIdx])

  // Select remaining documents using MMR
  while (selected.length < k && selected.length < candidates.length) {
    let maxScore = -Infinity
    let maxIdx = -1

    // For each candidate document
    for (let i = 0; i < candidates.length; i++) {
      if (selected.includes(i)) continue

      // Calculate relevance term
      const relevanceTerm = relevanceScores[i]

      // Calculate diversity term
      let maxSimilarity = -Infinity
      for (const selectedIdx of selected) {
        const similarity = cosineSimilarity(
          docEmbeddings[i],
          docEmbeddings[selectedIdx]
        )
        maxSimilarity = Math.max(maxSimilarity, similarity)
      }

      // Calculate MMR score
      const mmrScore =
        lambdaParam * relevanceTerm - (1 - lambdaParam) * maxSimilarity

      // Update maximum if this is the highest MMR score
      if (mmrScore > maxScore) {
        maxScore = mmrScore
        maxIdx = i
      }
    }

    if (maxIdx === -1) break
    selected.push(maxIdx)
    selectedDocs.push(candidates[maxIdx])
  }

  return selectedDocs
}

// Add context compression
async function compressContext(
  docs: Document[],
  query: string,
  maxTokens: number = 3000
): Promise<string> {
  // First, sort documents by relevance to query
  const relevanceScores = docs.map((doc) => ({
    doc,
    score: calculateRelevance(query, doc.pageContent),
  }))
  const sortedDocs = relevanceScores
    .sort((a, b) => b.score - a.score)
    .map((item) => item.doc)

  // Initialize compressed context
  let compressedContext = ""
  let currentTokenCount = 0

  for (const doc of sortedDocs) {
    // Extract key information
    const keyInfo = await extractKeyInformation(doc, query)

    // Skip if this document adds no value
    if (!keyInfo) continue

    // Estimate tokens (rough approximation: 4 chars = 1 token)
    const estimatedTokens = Math.ceil(keyInfo.length / 4)

    if (currentTokenCount + estimatedTokens > maxTokens) {
      break
    }

    compressedContext += keyInfo + "\n\n"
    currentTokenCount += estimatedTokens
  }

  return compressedContext.trim()
}

// Helper function to extract key information
async function extractKeyInformation(
  doc: Document,
  query: string
): Promise<string | null> {
  const prompt = `
Given this query: "${query}"
And this document:
---
${doc.pageContent}
---

Extract only the most relevant information that directly answers or relates to the query.
Include:
1. Key facts and figures
2. Direct quotes if relevant
3. Important context
4. Metadata if significant

Exclude any redundant or irrelevant information.
Keep the response concise and focused.
If nothing is relevant, respond with "NONE".
`

  const response = await chatModel.invoke(prompt)
  const content =
    typeof response.content === "string"
      ? response.content
      : String(response.content)

  return content === "NONE" ? null : content
}

// Update hybridSearch function
async function hybridSearch(
  query: string,
  pineconeIndex: any,
  k: number = 5,
  intent?: QueryIntent
): Promise<Document[]> {
  const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex,
  })

  console.log("Searching for query:", query)

  // Increase initial results to get more candidates
  const vectorResults = await vectorStore.similaritySearch(query, k * 3)

  // Apply post-retrieval filtering with fuzzy matching
  const filteredResults = vectorResults.filter((doc) => {
    console.log("Document metadata:", doc.metadata)

    if (intent?.constraints.product) {
      const productName = intent.constraints.product.toLowerCase()
      const docProduct = doc.metadata.product?.toLowerCase() || ""
      const docTitle = doc.metadata.title?.toLowerCase() || ""
      const docContent = doc.pageContent.toLowerCase()

      // Check if product name appears in any of these fields
      const productMatch =
        docProduct.includes(productName) ||
        docTitle.includes(productName) ||
        docContent.includes(productName)

      if (!productMatch) return false
    }
    return true
  })

  console.log("Found documents:", filteredResults.length)
  console.log("Sample content:", filteredResults[0]?.pageContent)
  return filteredResults
}

// Update analyzeQueryIntent prompt
async function analyzeQueryIntent(query: string): Promise<QueryIntent> {
  const prompt = `
Analyze this query: "${query}"

Determine:
1. Query type (choose one):
   - greeting (just saying hi/hello)
   - trend_analysis (looking for patterns/trends)
   - issue_search (looking for specific problems)
   - comparison (comparing products/issues)
   - solution_request (looking for fixes)
   - general (other queries)

2. Key entities mentioned:
   - Extract exact product names (e.g., "Surface", "Surface Pro", "Teams")
   - Extract features or components
   - Extract issue types

3. Constraints:
   - Time periods
   - Categories
   - Sentiments

Respond in JSON format only, keeping product names exactly as mentioned:
{
  "type": "query_type",
  "entities": ["exact_entity1", "exact_entity2"],
  "constraints": {
    "timeRange": {"start": "ISO_DATE", "end": "ISO_DATE"} or null,
    "product": "exact_product_name" or null,
    "category": "category_name" or null,
    "sentiment": "positive/negative/neutral" or null
  },
  "confidence": 0.0 to 1.0
}
`
  const response = await chatModel.invoke(prompt)
  const content =
    typeof response.content === "string"
      ? response.content
      : String(response.content)

  try {
    return JSON.parse(content)
  } catch (error) {
    console.error("Error parsing intent analysis:", error)
    return {
      type: "general",
      entities: [],
      constraints: {},
      confidence: 0,
    }
  }
}

// Add at the top with other interfaces
interface QueryIntent {
  type:
    | "greeting"
    | "trend_analysis"
    | "issue_search"
    | "comparison"
    | "solution_request"
    | "general"
  entities: string[]
  constraints: {
    timeRange?: { start: string; end: string }
    product?: string
    category?: string
    sentiment?: string
  }
  confidence: number
}

// Add back the clearChatHistory function
export const clearChatHistory = (threadId: string) => {
  console.log(`Chat history clear requested for thread ${threadId} (no-op)`)
  return true
}

export const makeRAGQuery = async ({
  userQuery,
  orgId,
  userId,
}: {
  userQuery: string
  orgId?: string
  userId?: string
}) => {
  try {
    const threadId = orgId || userId || "default_thread"

    // Create fresh state for this query
    const memorySaver = new MemorySaver()

    const requestGraph = new StateGraph(GraphAnnotation)
      .addNode("dateExtraction", dateExtractionNode)
      .addNode("retrieval", retrievalNode)
      .addNode("generation", generationNode)
      .addEdge(START, "dateExtraction")
      .addEdge("dateExtraction", "retrieval")
      .addEdge("retrieval", "generation")
      .addEdge("generation", END)
      .compile()

    // Initialize state with just the current query
    const partialState = {
      userQuery,
      orgId,
      userId,
      messages: [
        {
          type: "user",
          content: userQuery,
          metadata: { timestamp: new Date().toISOString() },
        },
      ],
    }

    const finalState = await requestGraph.invoke(partialState)
    return finalState.answer
  } catch (error) {
    console.error("Error in makeRAGQuery:", error)
    throw error
  }
}

// Update retrievalNode to pass intent to hybridSearch
export async function retrievalNode(
  state: typeof GraphAnnotation.State
): Promise<Partial<typeof GraphAnnotation.State>> {
  try {
    // Analyze query intent
    const intent = await analyzeQueryIntent(state.userQuery)
    console.log("Query intent:", intent)

    // Skip retrieval for greetings
    if (intent.type === "greeting") {
      return {
        context: "",
        messages: state.messages.concat([{ type: "retrieval", content: "" }]),
      }
    }

    const processedQuery = preprocessQuery(state.userQuery)

    // Adjust query based on intent
    const queryVariations = await expandQuery(processedQuery)
    const enhancedVariations =
      intent.entities.length > 0
        ? [
            ...queryVariations,
            ...intent.entities.map((e: string) => `${processedQuery} ${e}`),
          ]
        : queryVariations

    const allResults: Document[] = []
    for (const query of enhancedVariations) {
      console.log("Trying query variation:", query)
      const results = await hybridSearch(
        query,
        pineconeIndex,
        intent.type === "trend_analysis" ? 10 : 5,
        intent // Pass intent to hybridSearch
      )
      allResults.push(...results)
    }

    // Filter results based on intent constraints
    const filteredResults = allResults.filter((doc) => {
      if (intent.constraints.timeRange) {
        const docDate = new Date(doc.metadata.timestamp)
        const startDate = new Date(intent.constraints.timeRange.start)
        const endDate = new Date(intent.constraints.timeRange.end)
        if (docDate < startDate || docDate > endDate) return false
      }
      if (
        intent.constraints.product &&
        doc.metadata.product !== intent.constraints.product
      ) {
        return false
      }
      if (
        intent.constraints.category &&
        doc.metadata.category !== intent.constraints.category
      ) {
        return false
      }
      if (
        intent.constraints.sentiment &&
        doc.metadata.sentimentCategory !== intent.constraints.sentiment
      ) {
        return false
      }
      return true
    })

    // Deduplicate results
    const uniqueResults = Array.from(
      new Map(filteredResults.map((doc) => [doc.metadata.id, doc])).values()
    )

    // Apply context compression with intent-specific parameters
    const compressedContext = await compressContext(
      uniqueResults,
      state.userQuery,
      intent.type === "trend_analysis" ? 4000 : 3000
    )

    console.log("Retrieved context length:", compressedContext.length)

    return {
      context: compressedContext,
      messages: state.messages.concat([
        { type: "retrieval", content: compressedContext },
      ]),
    }
  } catch (error) {
    console.error("Error in retrievalNode:", error)
    throw error
  }
}

export function calculateRelevance(query: string, content: string): number {
  const queryWords = new Set(query.toLowerCase().split(" "))
  const contentWords = new Set(content.toLowerCase().split(" "))

  // Jaccard similarity
  const intersection = new Set(
    [...queryWords].filter((x) => contentWords.has(x))
  )
  const union = new Set([...queryWords, ...contentWords])

  return intersection.size / union.size
}
