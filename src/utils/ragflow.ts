import { config } from "dotenv"
config()

// ----- Imports -----
import { Pinecone } from "@pinecone-database/pinecone"
import { StateGraph, START, END, Annotation } from "@langchain/langgraph"
import { MemorySaver } from "@langchain/langgraph"

import {
  GraphAnnotation,
  dateExtractionNode,
  retrievalNode,
  generationNode,
} from "./langGraphPipeline.utils"

// ----- Message Store -----
interface ChatMessage {
  type: "user" | "assistant"
  content: string
}

// Update the message store to use proper typing
const messageStore: Record<string, ChatMessage[]> = {}

// ----- Initialize Prisma and Pinecone -----
if (!process.env.PINECONE_API_KEY) {
  throw new Error("PINECONE_API_KEY is not defined")
}
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY })

// ----- Global MemorySaver Storage -----
// Add a global map to persist MemorySaver instances by thread id.
const memorySavers = new Map<string, MemorySaver>()

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

    // Initialize message history for this thread if it doesn't exist
    if (!messageStore[threadId]) {
      messageStore[threadId] = []
    }

    // Add the new user message to the history
    messageStore[threadId].push({ type: "user", content: userQuery })

    // Retrieve or create a MemorySaver for the thread from in-memory storage
    let memorySaver = memorySavers.get(threadId)
    if (!memorySaver) {
      memorySaver = new MemorySaver()
      memorySavers.set(threadId, memorySaver)
    }

    const requestGraph = new StateGraph(GraphAnnotation)
      .addNode("dateExtraction", dateExtractionNode)
      .addNode("retrieval", retrievalNode)
      .addNode("generation", generationNode)
      .addEdge(START, "dateExtraction")
      .addEdge("dateExtraction", "retrieval")
      .addEdge("retrieval", "generation")
      .addEdge("generation", END)
      .compile({ checkpointer: memorySaver })

    const partialState = {
      userQuery,
      orgId,
      userId,
      messages: messageStore[threadId], // Pass the full message history
    }
    const config = { configurable: { thread_id: threadId } }
    const finalState = await requestGraph.invoke(partialState, config)

    // Store the assistant's response in the message history
    messageStore[threadId].push({
      type: "assistant",
      content: finalState.answer,
    })

    return finalState.answer
  } catch (error) {
    console.error("Error in makeRAGQuery:", error)
    throw error
  }
}

// Add a function to clear chat history if needed
export const clearChatHistory = (threadId: string) => {
  messageStore[threadId] = []
  memorySavers.delete(threadId)
}
