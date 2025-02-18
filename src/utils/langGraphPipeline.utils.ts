import { Annotation, StateGraph, START, END } from "@langchain/langgraph"
import { chatModel } from "./aiConfig"
import { extractDateRange } from "./date.utils"
import { summarizeChatHistory } from "./langGraphHelpers"
import { retrievalNode, calculateRelevance } from "./ragflow" // Update import to include calculateRelevance
import { Document } from "@langchain/core/documents"

// Define GraphAnnotation schema
export const GraphAnnotation = Annotation.Root({
  messages: Annotation<any[]>({
    reducer: (prev, curr) => prev.concat(curr),
    default: () => [],
  }),
  userQuery: Annotation<string>({ value: (prev, curr) => curr }),
  dateRange: Annotation<{ start: string; end: string } | undefined>({
    value: (prev, curr) => curr,
    default: () => undefined,
  }),
  context: Annotation<string>({
    value: (prev, curr) => curr,
    default: () => "",
  }),
  answer: Annotation<string>({
    value: (prev, curr) => curr,
    default: () => "",
  }),
  orgId: Annotation<string | undefined>({
    value: (prev, curr) => curr,
    default: () => undefined,
  }),
  userId: Annotation<string | undefined>({
    value: (prev, curr) => curr,
    default: () => undefined,
  }),
})

// Node 1: Date Extraction
export async function dateExtractionNode(
  state: typeof GraphAnnotation.State
): Promise<Partial<typeof GraphAnnotation.State>> {
  try {
    const dr = extractDateRange(state.userQuery)
    console.log("LangGraph - Extracted date range:", dr)
    return { dateRange: dr ?? undefined }
  } catch (error) {
    console.error("Error in dateExtractionNode:", error)
    throw error
  }
}

// Optimize context compression
async function compressContext(
  docs: Document[],
  query: string,
  maxTokens: number = 3000
): Promise<string> {
  console.log("Initial docs count:", docs.length)

  const relevantDocs = docs
    .map((doc) => ({
      doc,
      score: calculateRelevance(query, doc.pageContent),
    }))
    .filter((item) => item.score > 0.05) // Lower threshold to get more results
    .sort((a, b) => b.score - a.score)
    .map((item) => item.doc)
    .slice(0, 8) // Increase limit

  console.log("Relevant docs after filtering:", relevantDocs.length)
  console.log(
    "Relevance scores:",
    relevantDocs.map((doc) => calculateRelevance(query, doc.pageContent))
  )

  // Simple concatenation with key info
  return relevantDocs
    .map((doc) => {
      const metadata = doc.metadata
      return `
Post: ${doc.pageContent.slice(0, 500)}...
Category: ${metadata.category || "N/A"}
Product: ${metadata.product || "N/A"}
Sentiment: ${metadata.sentimentCategory || "N/A"}
URL: ${metadata.permalink || "N/A"}
---
`
    })
    .join("\n")
}

// Optimize fact verification to be faster
async function verifyFacts(
  response: string,
  context: string,
  query: string
): Promise<{ verified: string; confidence: number }> {
  // Skip verification for short or simple responses
  if (
    response.length < 100 &&
    !response.includes("number") &&
    !response.includes("statistic")
  ) {
    return { verified: response, confidence: 1.0 }
  }

  // Use simpler verification prompt
  const verificationPrompt = `
Verify this response is supported by the context. If not, correct any unsupported claims.
Query: ${query}
Response: ${response}
Context: ${context}
`

  const verificationResult = await chatModel.invoke(verificationPrompt)
  const content =
    typeof verificationResult.content === "string"
      ? verificationResult.content
      : String(verificationResult.content)

  return {
    verified: content,
    confidence: content === response ? 1.0 : 0.8,
  }
}

// Node 3: Generation with Conversation History
export async function generationNode(
  state: typeof GraphAnnotation.State
): Promise<Partial<typeof GraphAnnotation.State>> {
  try {
    const conversationHistoryLimit = 3
    let contextBlock = ""
    if (state.messages.length > conversationHistoryLimit) {
      const summary = await summarizeChatHistory(state.messages)
      contextBlock = `Conversation Summary:\n${summary}\n\n`
    } else {
      const trimmedMessages = state.messages.slice(-conversationHistoryLimit)
      contextBlock = `Conversation History:\n${trimmedMessages
        .filter((msg) => ["user", "generation"].includes(msg.type))
        .map((msg) =>
          msg.type === "user"
            ? `User: ${msg.content}`
            : `Assistant: ${msg.content}`
        )
        .join("\n\n")}\n\n`
    }
    const promptTemplate = `
You are an AI assistant analyzing Reddit feedback data. Respond based on these specific scenarios:

1. **Casual Greetings** (e.g., "hi", "hello")
- Respond: "Hi! I can help you analyze Reddit feedback data. What would you like to know?"

2. **Data Analysis Requests** (e.g., "what's trending", "show feedback about X")
When relevant data exists, provide:

A. Issue Overview
   * Total complaints/mentions
   * Categorized issues by frequency
   * Most affected products/features
   * Sentiment distribution

B. Technical Details
   * Reproduction steps (if available)
   * Device/system configurations
   * Software versions mentioned
   * Common error messages

C. Impact Analysis
   * Number of users affected (sameIssuesCount)
   * Similar device reports (sameDeviceCount)
   * Solution success rate (solutionsCount)
   * User satisfaction metrics

D. Solutions & Workarounds
   * Verified solutions
   * Community workarounds
   * Official responses
   * Success rates

If no relevant data: "I don't see any relevant data about that in the current context."

3. **Data Structure Available**
Each post contains:
- content: Main post text
- permalink: Full Reddit URL (already includes "https://www.reddit.com")
- category: Feedback category (e.g., hardware, software, feature request)
- sentimentScore: (-1 to 1) sentiment rating
- sentimentCategory: ("positive", "negative", "neutral")
- sameIssuesCount: Number of similar reported issues
- sameDeviceCount: Number of similar device mentions
- solutionsCount: Number of provided solutions
- labels: Topic labels array
- comments: Array of related comments with similar fields

### Current Context:
{context}

### User Query:
{question}

Remember: 
1. Only analyze data present in the context
2. Provide specific numbers and metrics
3. Quote relevant user feedback for key points
4. When referencing posts, use the exact permalink provided
5. Never modify or construct permalinks manually
6. Never invent or hallucinate data
`

    const prompt = promptTemplate
      .replace("{context}", state.context)
      .replace("{question}", state.userQuery)

    const response = await chatModel.invoke(prompt)
    let responseContent: string =
      typeof response.content === "string"
        ? response.content
        : String(response.content)

    // Skip verification for greetings or empty context
    if (!state.context || state.context.trim() === "") {
      return {
        answer: responseContent,
        messages: state.messages.concat([
          { type: "generation", content: responseContent },
        ]),
      }
    }

    // Verify facts in the response
    const { verified, confidence } = await verifyFacts(
      responseContent,
      state.context,
      state.userQuery
    )

    // Create final response with confidence disclaimer if needed
    const finalResponse =
      confidence < 0.8
        ? `${responseContent}\n\nNote: Some information in this response may be incomplete or require additional verification.`
        : responseContent

    console.log("LangGraph - AI Response:", finalResponse)
    console.log("Response confidence:", confidence)

    return {
      answer: finalResponse,
      messages: state.messages.concat([
        { type: "generation", content: finalResponse },
      ]),
    }
  } catch (error) {
    console.error("Error in generationNode:", error)
    throw error
  }
}

// (Assume summarizeChatHistory and processUserQuery are defined or imported accordingly)

// Expose the makeRAGQuery function
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
    const requestGraph = new StateGraph(GraphAnnotation)
      .addNode("dateExtraction", dateExtractionNode)
      .addNode("retrieval", retrievalNode)
      .addNode("generation", generationNode)
      .addEdge(START, "dateExtraction")
      .addEdge("dateExtraction", "retrieval")
      .addEdge("retrieval", "generation")
      .addEdge("generation", END)
      .compile()

    const partialState = {
      userQuery,
      orgId,
      userId,
      messages: [{ type: "user", content: userQuery }],
    }
    const config = { configurable: { thread_id: threadId } }
    const finalState = await requestGraph.invoke(partialState, config)
    return finalState.answer
  } catch (error) {
    console.error("Error in makeRAGQuery:", error)
    throw error
  }
}
