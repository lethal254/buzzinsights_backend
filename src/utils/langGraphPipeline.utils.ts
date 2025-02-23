import { Annotation, StateGraph, START, END } from "@langchain/langgraph"
import { chatModel } from "./aiConfig"
import { extractDateRange } from "./date.utils"
import { processUserQuery, summarizeChatHistory } from "./langGraphHelpers" // NEW: import helper functions

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

// Node 2: Retrieval
export async function retrievalNode(
  state: typeof GraphAnnotation.State
): Promise<Partial<typeof GraphAnnotation.State>> {
  try {
    // Assume processUserQuery is imported from elsewhere or defined similarly
    const docs = await processUserQuery(state.userQuery, {
      orgId: state.orgId,
      userId: state.userId,
    })
    let ctx = ""
    for (const doc of docs) {
      ctx += doc.pageContent + "\n"
      // ...existing concatenation...
    }
    console.log("LangGraph - Retrieved context length:", ctx.length)
    return {
      context: ctx,
      messages: state.messages.concat([{ type: "retrieval", content: ctx }]),
    }
  } catch (error) {
    console.error("Error in retrievalNode:", error)
    throw error
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
- category: Feedback category (e.g., hardware, software, feature request)
- product: The specific product mentioned
- sentimentScore: (-1 to 1) sentiment rating
- sentimentCategory: ("positive", "negative", "neutral")
- sameIssuesCount: Number of similar reported issues
- sameDeviceCount: Number of similar device mentions
- solutionsCount: Number of provided solutions
- permalink: Reddit post URL (prefix with "https://www.reddit.com")
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
4. Include permalinks to significant posts
5. Never invent or hallucinate data
`

    const prompt = promptTemplate
      .replace("{context}", state.context)
      .replace("{question}", state.userQuery)
    const response = await chatModel.invoke(prompt)

    // Convert response.content to string to satisfy type constraints
    let responseContent: string
    if (typeof response.content === "string") {
      responseContent = response.content
    } else if (Array.isArray(response.content)) {
      responseContent = response.content
        .map((item) =>
          typeof item === "string"
            ? item
            : (item as any).text
            ? (item as any).text
            : JSON.stringify(item)
        )
        .join(" ")
    } else {
      responseContent = String(response.content)
    }

    console.log("LangGraph - AI Response:", responseContent)
    return {
      answer: responseContent,
      messages: state.messages.concat([
        { type: "generation", content: responseContent },
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
    // Assume memorySavers is maintained elsewhere or add it here if needed.
    const requestCheckpointer = new Map<string, any>() // simplified checkpointer map
    const requestGraph = new StateGraph(GraphAnnotation)
      .addNode("dateExtraction", dateExtractionNode)
      .addNode("retrieval", retrievalNode)
      .addNode("generation", generationNode)
      .addEdge(START, "dateExtraction")
      .addEdge("dateExtraction", "retrieval")
      .addEdge("retrieval", "generation")
      .addEdge("generation", END)
      .compile({ checkpointer: requestCheckpointer.get(threadId) })

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
