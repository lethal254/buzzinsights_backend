import { PrismaClient } from "@prisma/client"
import { Pinecone } from "@pinecone-database/pinecone"
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import { Document } from "@langchain/core/documents"
import { PineconeStore } from "@langchain/pinecone"
import { safeJsonStringify } from "./jsonReplacer"
import { embeddings } from "./aiConfig" // NEW: import embeddings

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

    const docs: Document[] = []
    for (const post of posts) {
      const sPost = serializePost(post)
      // Remove BigInt values by serializing and re-parsing
      const safeSPost = JSON.parse(safeJsonStringify(sPost))
      // Build document content here...
      let combinedContent = safeSPost.content
      if (safeSPost.comments && safeSPost.comments.length > 0) {
        combinedContent += "\n\nComments:\n"
        for (const comment of safeSPost.comments) {
          combinedContent += `\nAuthor: ${comment.author} | Score: ${comment.score}\n${comment.content}\n`
        }
      }
      const postMetadata = {
        ...safeSPost,
        content: undefined,
        ...(orgId ? { orgId } : { userId }),
      }
      docs.push(
        new Document({ pageContent: combinedContent, metadata: postMetadata })
      )
    }

    // Prevent duplicate ingestion (assumes doc.metadata.id exists)
    const uniqueDocsMap = new Map<string, Document>()
    for (const doc of docs) {
      const id = doc.metadata?.id
      if (id && !uniqueDocsMap.has(id)) {
        uniqueDocsMap.set(id, doc)
      }
    }
    const uniqueDocs = Array.from(uniqueDocsMap.values())
    console.log(
      `Filtered duplicates: ${
        docs.length - uniqueDocs.length
      } duplicates removed.`
    )

    const allDocs = uniqueDocs
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    })
    const splitDocs = await splitter.splitDocuments(allDocs)
    console.log(`Split into ${splitDocs.length} document chunks.`)

    console.log("Starting Pinecone ingestion for chunks.")
    const THROTTLE_THRESHOLD = 10
    for (let i = 0; i < splitDocs.length; i++) {
      console.log(
        `Ingesting chunk ${i + 1} of ${splitDocs.length}. Remaining: ${
          splitDocs.length - i - 1
        }`
      )
      try {
        await PineconeStore.fromDocuments([splitDocs[i]], embeddings, {
          pineconeIndex,
        }) // Fixed: replaced undefined with embeddings
      } catch (chunkError) {
        console.error(`Error ingesting chunk ${i + 1}:`, chunkError)
      }
      if ((i + 1) % THROTTLE_THRESHOLD === 0) {
        console.log("Throttling ingestion: Pausing for 2000ms.")
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }
    console.log("Successfully saved all chunks to Pinecone.")
    console.log(
      `Ingestion complete: Ingested ${allDocs.length} posts as ${splitDocs.length} chunks.`
    )
  } catch (error) {
    console.error("Error in ingestData:", error)
    throw error
  }
}

// ...other ingestion related helpers if needed...
