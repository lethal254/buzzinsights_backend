import { PrismaClient } from "@prisma/client"
import { Pinecone } from "@pinecone-database/pinecone"
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import { Document } from "@langchain/core/documents"
import { PineconeStore } from "@langchain/pinecone"
import { safeJsonStringify } from "./jsonReplacer"
import { embeddings } from "./aiConfig" // NEW: import embeddings
import { removeStopwords } from "stopword"

const prisma = new PrismaClient()
if (!process.env.PINECONE_API_KEY) {
  throw new Error("PINECONE_API_KEY is not defined")
}
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY })
const pineconeIndex = pinecone.Index("buzzinsights")

// Helper to serialize posts properly.
export function serializePost(post: any): any {
  return {
    ...post,
    createdUtc: Number(post.createdUtc),
    score: Number(post.score),
    numComments: Number(post.numComments),
    sentimentScore: Number(post.sentimentScore),
    sameIssuesCount: Number(post.sameIssuesCount),
    sameDeviceCount: Number(post.sameDeviceCount),
    solutionsCount: Number(post.solutionsCount),
    comments: post.comments?.map((comment: any) => ({
      ...comment,
      score: Number(comment.score),
      createdUtc: Number(comment.createdUtc),
      lastUpdated: comment.lastUpdated ? Number(comment.lastUpdated) : null,
      // ...existing properties...
    })),
  }
}

// Add new helper for text preprocessing
function preprocessText(text: string): string {
  return text
    .replace(/\s+/g, " ") // normalize whitespace
    .replace(/[^\w\s.,!?-]/g, "") // remove special characters
    .trim()
}

// Add metadata enrichment
function enrichMetadata(post: any) {
  return {
    ...post,
    timestamp: new Date(post.createdUtc * 1000).toISOString(),
    wordCount: post.content.split(/\s+/).length,
    hasComments: post.comments?.length > 0,
    topKeywords: extractKeywords(post.content),
  }
}

// Improve document creation
function createDocument(post: any, combinedContent: string) {
  const metadata = enrichMetadata(post)
  return new Document({
    pageContent: preprocessText(combinedContent),
    metadata: {
      ...metadata,
      source_type: "reddit_post",
      chunk_type: "full_post",
    },
  })
}

// Add keyword extraction helper
function extractKeywords(text: string): string[] {
  // Convert to lowercase and remove special characters
  const cleanText = text
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  // Split into words and remove stopwords
  const words = cleanText.split(" ")
  const wordsWithoutStops = removeStopwords(words)

  // Count word frequencies
  const wordFreq = new Map<string, number>()
  wordsWithoutStops.forEach((word) => {
    if (word.length > 2) {
      // Only consider words longer than 2 characters
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1)
    }
  })

  // Sort by frequency and get top 10 keywords
  return Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word)
}

export async function ingestData({
  orgId,
  userId,
}: {
  orgId?: string
  userId?: string
}): Promise<void> {
  try {
    console.log("ingestData triggered", { orgId, userId })
    const posts = await prisma.redditPost.findMany({
      where: {
        needsProcessing: false,
        ...(orgId ? { orgId } : { userId }),
      },
      include: { comments: true },
    })

    console.log(`Found ${posts.length} feedback posts to ingest.`)
    if (posts.length === 0) {
      console.warn("No posts found to ingest.")
      return
    }
    console.log(
      `Starting ingestion for ${posts.length} posts from ${
        orgId ? "orgId:" + orgId : "userId:" + userId
      }.`
    )

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 512, // Smaller chunks for better precision
      chunkOverlap: 400, // Larger overlap for better context
      separators: [
        // Custom separators
        "\n\n", // Paragraphs
        "\n", // Lines
        ". ", // Sentences
        "! ", // Exclamations
        "? ", // Questions
        ", ", // Phrases
        " ", // Words
      ],
      lengthFunction: (text) => text.split(/\s+/).length, // Use word count instead of characters
    })

    // Improved document creation with better content combination
    const docs: Document[] = []
    for (const post of posts) {
      const sPost = serializePost(post)
      const safeSPost = JSON.parse(safeJsonStringify(sPost))

      // Better content structuring
      let combinedContent = `Title: ${safeSPost.title}\n\n`
      combinedContent += `Post: ${safeSPost.content}\n\n`

      if (safeSPost.comments?.length > 0) {
        combinedContent += "Comments:\n"
        safeSPost.comments
          .sort((a: any, b: any) => b.score - a.score) // Sort by score
          .slice(0, 5) // Take top 5 comments
          .forEach((comment: any) => {
            combinedContent += `---\nScore: ${comment.score}\n${comment.content}\n`
          })
      }

      const doc = createDocument(safeSPost, combinedContent)
      docs.push(doc)
    }

    // Improved deduplication
    const uniqueDocsMap = new Map<string, Document>()
    for (const doc of docs) {
      const id = doc.metadata?.id
      const existingDoc = uniqueDocsMap.get(id)
      if (
        !existingDoc ||
        doc.metadata.wordCount > existingDoc.metadata.wordCount
      ) {
        uniqueDocsMap.set(id, doc)
      }
    }

    const splitDocs = await splitter.splitDocuments(
      Array.from(uniqueDocsMap.values())
    )

    // Add chunk metadata
    splitDocs.forEach((doc, index) => {
      doc.metadata = {
        ...doc.metadata,
        chunk_index: index,
        chunk_type: "split",
      }
    })

    // Batch processing with improved error handling
    const BATCH_SIZE = 5
    for (let i = 0; i < splitDocs.length; i += BATCH_SIZE) {
      const batch = splitDocs.slice(i, i + BATCH_SIZE)
      try {
        await PineconeStore.fromDocuments(batch, embeddings, {
          pineconeIndex,
          maxConcurrency: 5,
        })
      } catch (error) {
        console.error(`Error ingesting batch ${i}-${i + BATCH_SIZE}:`, error)
        // Retry failed batch with smaller size
        for (const doc of batch) {
          try {
            await PineconeStore.fromDocuments([doc], embeddings, {
              pineconeIndex,
            })
          } catch (retryError) {
            console.error(`Failed to ingest document:`, retryError)
          }
        }
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    console.log("Successfully saved all chunks to Pinecone.")
    console.log(
      `Ingestion complete: Ingested ${splitDocs.length} posts as ${splitDocs.length} chunks.`
    )
  } catch (error) {
    console.error("Error in ingestData:", error)
    throw error
  }
}

// ...other ingestion related helpers if needed...
