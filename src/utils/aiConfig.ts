import { AzureChatOpenAI, AzureOpenAIEmbeddings } from "@langchain/openai"

export const chatModel = new AzureChatOpenAI({
  model: "gpt-4o-mini",
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
  azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
})

export const embeddings = new AzureOpenAIEmbeddings({
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  azureOpenAIApiDeploymentName: "text-embedding-3-small",
  azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
})
