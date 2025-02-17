import { Document } from "@langchain/core/documents"
import { Pinecone } from "@pinecone-database/pinecone"
import { PineconeStore } from "@langchain/pinecone"
import { embeddings, chatModel } from "./aiConfig"

// Complete implementation for processUserQuery
export async function processUserQuery(
  query: string,
  options: { orgId?: string; userId?: string }
): Promise<Document[]> {
  // Initialize Pinecone index instance
  if (!process.env.PINECONE_API_KEY) {
    throw new Error("PINECONE_API_KEY is not defined")
  }
  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY })
  const pineconeIndex = pinecone.Index("buzzinsights")

  // Create a store from the existing index
  const store = await PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex,
  })

  // Perform a similarity search for the query
  const k = 5 // number of results to return
  let docs = await store.similaritySearch(query, k)

  // Filter retrieved documents by orgId and/or userId if provided
  if (options.orgId || options.userId) {
    docs = docs.filter((doc) => {
      const meta = (doc.metadata as any) || {}
      if (options.orgId) {
        return meta.orgId === options.orgId
      }
      if (options.userId) {
        return meta.userId === options.userId
      }
      return true
    })
  }
  return docs
}

// Complete implementation for summarizeChatHistory
export async function summarizeChatHistory(messages: any[]): Promise<string> {
  // Create a prompt by concatenating conversation messages
  const conversationText = messages
    .map(
      (msg) => `${msg.type === "user" ? "User" : "Assistant"}: ${msg.content}`
    )
    .join("\n")

  const prompt = `Summarize the following conversation succinctly:\n\n${conversationText}\n\nSummary:`

  // Invoke the chat model to generate a summary
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

  return responseContent
}
