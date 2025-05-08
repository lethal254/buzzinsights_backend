/**
 * Advanced feedback analyzer for identifying user pain points
 * Uses NLP techniques and weighted scoring to better identify meaningful issues
 */
import * as sw from "stopword"
import * as natural from "natural" // Natural library for NLP capabilities
import Sentiment from "sentiment" // For sentiment analysis

// Type definition for configuration options
interface FeedbackAnalyzerConfig {
  minWordLength: number
  minFrequency: number
  maxResults: number
  includeNgrams: boolean
  ngramMaxSize: number
  includeEntityExtraction: boolean
  includeTopicClustering: boolean
  weightedScoring: boolean
  domainStopwords: string[]
  domainKeywords: string[]
  sentimentAnalysis: boolean
  includeErrorCodeExtraction: boolean
  includeTimeTrendAnalysis: boolean
}

// Type definition for analysis results
interface FeedbackAnalysis {
  significantWords: Record<string, number>
  technicalIssues: Record<string, IssueDetails>
  sentimentScore?: number
  topicClusters?: Record<string, string[]>
  entityMentions?: Record<string, number>
  errorCodes?: Record<string, ErrorCodeDetails>
  componentIssueMatrix?: Record<string, Record<string, number>>
  issueGroups?: Record<string, Array<IssueDetailsWithPhrase>>
  timeBasedAnalysis?: Record<string, Record<string, number>>
}

// Type for detailed issue information
interface IssueDetails {
  count: number
  severity: number
  contextExamples: string[]
}

// Extended IssueDetails with the phrase included
interface IssueDetailsWithPhrase extends IssueDetails {
  phrase: string
}

// Type for error code information
interface ErrorCodeDetails {
  count: number
  contexts: string[]
  associatedIssues: string[]
}

interface FeedbackItem {
  title: string
  content: string
  comments?: string[]
  timestamp?: Date | string // Optional timestamp for trend analysis
}

/**
 * Analyzes user feedback to extract pain points and issues
 *
 */
function analyzeFeedback(
  data: FeedbackItem[],
  options: Partial<FeedbackAnalyzerConfig> = {}
): FeedbackAnalysis {
  // Merge default options with provided options
  const config: FeedbackAnalyzerConfig = {
    minWordLength: 3,
    minFrequency: 3,
    maxResults: 100,
    includeNgrams: true,
    ngramMaxSize: 3,
    includeEntityExtraction: true,
    includeTopicClustering: true, // Advanced feature, enable as needed
    weightedScoring: true,
    domainStopwords: [],
    domainKeywords: [],
    sentimentAnalysis: true,
    includeErrorCodeExtraction: true, // New option
    includeTimeTrendAnalysis: true, // New option
    ...options,
  }

  // Initialize NLP tools
  const tokenizer = new natural.WordTokenizer()
  const stemmer = natural.PorterStemmer
  const TfIdf = natural.TfIdf
  const tfidf = new TfIdf()
  const sentimentAnalyzer = new Sentiment()

  // Initialize stopwords with custom additions
  const baseStopwords = new Set([
    ...sw.eng,
    ...config.domainStopwords,
    // Additional low-value words not covered in standard stopwords
    "actually",
    "basically",
    "definitely",
    "literally",
    "simply",
    "like",
    "just",
    "very",
    "really",
    "quite",
    "pretty",
    "totally",
    "completely",
    "absolutely",
    "certainly",
    "course",
    "etc",
    "stuff",
    "thing",
    "things",
    "way",
    "place",
    "places",
    "times",
    "case",
    "kind",
    "sorts",
    "type",
    "types",
  ])

  // Low value phrases to filter out from n-grams
  const lowValuePhrases = new Set([
    "issue may",
    "issue please",
    "long error",
    "not gibberish",
    "may stumble",
    "please don",
    "issue may stumble",
    "issue please don",
    "don't",
    "won't",
    "didn't",
    "doesn't",
  ])

  // Problem indicators with severity weights
  const problemIndicators: Record<string, number> = {
    // Critical issues (weight 3)
    broken: 3,
    crash: 3,
    crashes: 3,
    crashed: 3,
    dead: 3,
    fail: 3,
    failed: 3,
    failure: 3,
    unusable: 3,
    frozen: 3,
    freezes: 3,
    error: 3,
    corrupted: 3,
    damage: 3,
    damaged: 3,
    unresponsive: 3,

    // Major issues (weight 2)
    problem: 2,
    issue: 2,
    bug: 2,
    glitch: 2,
    stuck: 2,
    slow: 2,
    lag: 2,
    laggy: 2,
    hanging: 2,
    hangs: 2,
    poor: 2,
    stop: 2,
    stopped: 2,
    stopping: 2,
    wrong: 2,
    incorrect: 2,
    defective: 2,
    malfunction: 2,
    malfunctioning: 2,
    terrible: 2,
    awful: 2,

    // Minor issues (weight 1)
    annoying: 1,
    frustrating: 1,
    disappointing: 1,
    finicky: 1,
    unreliable: 1,
    inconsistent: 1,
    weird: 1,
    strange: 1,
    odd: 1,
    difficult: 1,
    tough: 1,
    hard: 1,
    challenging: 1,
    unstable: 1,
  }

  // Technical components commonly mentioned in feedback
  const technicalComponents = new Set([
    "screen",
    "display",
    "keyboard",
    "mouse",
    "touchpad",
    "trackpad",
    "button",
    "battery",
    "charger",
    "charging",
    "port",
    "cable",
    "plug",
    "adapter",
    "wifi",
    "bluetooth",
    "speaker",
    "audio",
    "sound",
    "microphone",
    "mic",
    "camera",
    "webcam",
    "touch",
    "pen",
    "stylus",
    "scroll",
    "scrolling",
    "click",
    "clicking",
    "type",
    "typing",
    "boot",
    "restart",
    "shutdown",
    "login",
    "logon",
    "password",
    "update",
    "upgrade",
    "install",
    "uninstall",
    "driver",
    "drivers",
    "firmware",
    "hardware",
    "software",
    "app",
    "application",
    "memory",
    "ram",
    "storage",
    "processor",
    "cpu",
    "gpu",
    "graphics",
    "cursor",
    "trackpoint",
    "fan",
    "cooling",
    "hinge",
    "cover",
    "case",
    "dock",
    "docking",
    "connector",
    "usb",
    "hdmi",
    "thunderbolt",
    "surface",
    ...config.domainKeywords,
  ])

  // Negation words for context analysis
  const negationWords = new Set([
    "not",
    "no",
    "never",
    "none",
    "nobody",
    "nothing",
    "nowhere",
    "neither",
    "don't",
    "doesn't",
    "didn't",
    "won't",
    "wouldn't",
    "can't",
    "couldn't",
    "haven't",
    "hasn't",
    "hadn't",
    "isn't",
    "aren't",
    "wasn't",
    "weren't",
    "cannot",
    "unable",
    "fail",
    "fails",
    "failed",
    "failing",
    "without",
  ])

  // Storage for analysis results
  const wordFrequency: Record<string, number> = {}
  const technicalIssues: Record<string, IssueDetails> = {}
  let docSentiments: number[] = []

  // Storage for entity extraction and context tracking
  const entityMentions: Record<string, number> = {}
  const uniqueIssueContexts = new Set<string>()
  const componentIssueMatrix: Record<string, Record<string, number>> = {}
  const errorCodesWithContext: Record<string, ErrorCodeDetails> = {}
  const timeBasedIssues: Record<string, Record<string, number>> = {}

  // Function for extracting error codes with a more flexible approach
  const extractErrorCodes = (text: string): string[] => {
    const codes: string[] = []

    // Common error code patterns (with more flexibility)
    const patterns = [
      // Windows-style hex codes
      /\b0x[0-9A-Fa-f]{4,8}\b/g,

      // Error codes with specific prefixes
      /\b(KB\d{6,8}|MS\d{2,6}|CVE-\d{4}-\d{4,7})\b/g,

      // Error codes/IDs with letters, numbers, and common separators
      /\b[A-Z][A-Z0-9_\-]{2,15}\b/g,

      // Update codes and version numbers
      /\b(\d{1,3}\.\d{1,3}\.\d{1,3}(\.\d{1,3})?)\b/g,

      // Named error constants
      /\b(ERROR|ERR|FAIL|EXCEPTION)_[A-Z0-9_]+\b/g,

      // HTTP status codes in context
      /\bstatus (?:code |)(\d{3})\b/gi,

      // Common error IDs
      /\b[A-Z]-\d{2,6}\b/g,

      // Any all-caps code that likely represents an error or status
      /\b[A-Z]{2,10}(?:-|\s)[0-9]{1,6}\b/g,

      // Codes in parentheses after error mentions
      /error.*?\(([A-Z0-9_\-]{3,15})\)/gi,

      // Numbers immediately following error/code/id mentions
      /\b(?:error|code|id)(?:\s|:)\s*(\d{2,10})\b/gi,
    ]

    patterns.forEach((pattern) => {
      const matches = text.match(pattern)
      if (matches) {
        matches.forEach((match) => {
          // For pattern groups that include context words, extract just the code part
          if (
            pattern.toString().includes("error.*?\\(") ||
            pattern.toString().includes("status (?:code |)")
          ) {
            const codeMatch =
              match.match(/\(([A-Z0-9_\-]{3,15})\)/) ||
              match.match(/status (?:code |)(\d{3})/)
            if (codeMatch && codeMatch[1]) {
              codes.push(codeMatch[1])
              return
            }
          }

          // If we get here, use the whole match
          codes.push(match)
        })
      }
    })

    return [...new Set(codes)] // Remove duplicates
  }

  // Function to group by time period for trend analysis
  const groupByTimePeriod = (date: Date): string => {
    return `${date.getFullYear()}-W${Math.ceil(
      (date.getDate() + date.getDay()) / 7
    )}`
  }

  // Process each document (post/comment)
  data.forEach((item, docIndex) => {
    const { title, content, comments, timestamp } = item

    // Handle time-based analysis if timestamps are available
    let timePeriod: string | undefined
    if (config.includeTimeTrendAnalysis && timestamp) {
      const date = new Date(timestamp)
      timePeriod = groupByTimePeriod(date)
      if (!timeBasedIssues[timePeriod]) {
        timeBasedIssues[timePeriod] = {}
      }
    }

    // Combine text with proper identifiers for context preservation
    const documentTexts: { text: string; type: string }[] = [
      { text: title || "", type: "title" },
      { text: content || "", type: "content" },
      ...(comments || []).map((comment) => ({
        text: comment,
        type: "comment",
      })),
    ].filter((item) => item.text.trim().length > 0)

    // Process each text segment
    documentTexts.forEach(({ text, type }) => {
      // Clean text while preserving sentence structure
      const cleanText = text
        .toLowerCase()
        .replace(/<[^>]*>/g, " ") // Remove HTML tags
        .replace(/\bhttps?:\/\/\S+/g, " ") // Remove URLs
        .replace(/[^\w\s'.,!?-]/g, " ") // Keep alphanumeric, apostrophes, and basic punctuation
        .replace(/\.{2,}/g, " ") // Replace ellipses with space
        .replace(/\s+/g, " ") // Normalize spaces
        .trim()

      // Add to TF-IDF for topic analysis
      tfidf.addDocument(cleanText)

      // Extract error codes (using original text to preserve case and special characters)
      if (config.includeErrorCodeExtraction) {
        const extractedCodes = extractErrorCodes(text)

        extractedCodes.forEach((code) => {
          if (!errorCodesWithContext[code]) {
            errorCodesWithContext[code] = {
              count: 0,
              contexts: [],
              associatedIssues: [],
            }
          }

          errorCodesWithContext[code].count += 1

          // Find this code's sentence context
          const sentences = text.split(/[.!?]+/)
          const relevantSentence = sentences.find((s) => s.includes(code))

          if (
            relevantSentence &&
            errorCodesWithContext[code].contexts.length < 3 &&
            !errorCodesWithContext[code].contexts.includes(
              relevantSentence.trim()
            )
          ) {
            errorCodesWithContext[code].contexts.push(relevantSentence.trim())
          }

          // Track for time-based analysis
          if (timePeriod) {
            timeBasedIssues[timePeriod][`error_${code}`] =
              (timeBasedIssues[timePeriod][`error_${code}`] || 0) + 1
          }
        })
      }

      // Analyze sentiment with domain-specific adjustments
      if (config.sentimentAnalysis) {
        const sentimentResult = sentimentAnalyzer.analyze(cleanText)

        // Apply domain-specific adjustments for technical feedback
        if (
          cleanText.includes("error") ||
          cleanText.includes("issue") ||
          cleanText.includes("problem") ||
          cleanText.includes("fail") ||
          cleanText.includes("crash") ||
          cleanText.includes("bug")
        ) {
          // Increase negative weight for technical problem reports
          sentimentResult.score -= 1.5
        }

        docSentiments.push(sentimentResult.score)
      }

      // Split into sentences for contextual analysis
      const sentences = cleanText
        .split(/[.!?]+/)
        .filter((s) => s.trim().length > 0)

      // Process each sentence
      sentences.forEach((sentence) => {
        if (sentence.trim().length < 5) return // Skip very short sentences

        // Check if sentence contains a problem indicator
        const problemWords = Object.keys(problemIndicators).filter(
          (word) =>
            sentence.includes(` ${word} `) ||
            sentence.startsWith(`${word} `) ||
            sentence.endsWith(` ${word}`) ||
            sentence === word
        )

        const hasProblemIndicator = problemWords.length > 0

        // Check if sentence contains a negation
        const negationMatches = Array.from(negationWords).filter(
          (word) =>
            sentence.includes(` ${word} `) ||
            sentence.startsWith(`${word} `) ||
            sentence.endsWith(` ${word}`) ||
            sentence === word
        )

        const hasNegation = negationMatches.length > 0

        // Check if sentence contains a technical component
        const componentMatches = Array.from(technicalComponents).filter(
          (word) =>
            sentence.includes(` ${word} `) ||
            sentence.startsWith(`${word} `) ||
            sentence.endsWith(` ${word}`) ||
            sentence === word
        )

        const hasTechnicalComponent = componentMatches.length > 0

        // Build issue-component correlation matrix
        if ((hasProblemIndicator || hasNegation) && hasTechnicalComponent) {
          uniqueIssueContexts.add(sentence)

          componentMatches.forEach((component) => {
            if (!componentIssueMatrix[component]) {
              componentIssueMatrix[component] = {}
            }

            problemWords.forEach((problem) => {
              componentIssueMatrix[component][problem] =
                (componentIssueMatrix[component][problem] || 0) + 1

              // Track in time-based analysis if available
              if (timePeriod) {
                const issueKey = `${component}_${problem}`
                timeBasedIssues[timePeriod][issueKey] =
                  (timeBasedIssues[timePeriod][issueKey] || 0) + 1
              }
            })

            if (hasNegation && problemWords.length === 0) {
              componentIssueMatrix[component]["not_working"] =
                (componentIssueMatrix[component]["not_working"] || 0) + 1
            }
          })

          // Associate error codes with technical issues
          if (config.includeErrorCodeExtraction) {
            const extractedCodes = extractErrorCodes(text)
            extractedCodes.forEach((code) => {
              if (errorCodesWithContext[code]) {
                // Associate with all technical components mentioned in this context
                componentMatches.forEach((component) => {
                  const issueMarker = hasNegation
                    ? `${component}_issue`
                    : componentMatches.map((c) => c).join("_") + "_issue"

                  if (
                    !errorCodesWithContext[code].associatedIssues.includes(
                      issueMarker
                    )
                  ) {
                    errorCodesWithContext[code].associatedIssues.push(
                      issueMarker
                    )
                  }
                })
              }
            })
          }
        }

        // Tokenize sentence
        const tokens = tokenizer.tokenize(sentence) || []

        // Process individual tokens
        tokens.forEach((token, i) => {
          // Clean token
          const cleanToken = token
            .replace(/^['']|['']$/g, "")
            .replace(/['']s$/g, "")

          // Skip if empty, too short, or a stopword
          if (
            !cleanToken ||
            cleanToken.length < config.minWordLength ||
            baseStopwords.has(cleanToken) ||
            (!cleanToken.includes("'") && !isNaN(Number(cleanToken)))
          ) {
            return
          }

          // Check if token is a technical component
          const isTechnicalComponent = technicalComponents.has(cleanToken)

          // Check if token is a problem indicator
          const problemSeverity = problemIndicators[cleanToken] || 0

          // Check if in negation context
          const isNegationContext =
            i > 0 &&
            Array.from(negationWords).includes(tokens[i - 1].toLowerCase())

          // Add to word frequency with appropriate weight
          const weight = config.weightedScoring
            ? problemSeverity || (isTechnicalComponent ? 1.5 : 1)
            : 1

          wordFrequency[cleanToken] = (wordFrequency[cleanToken] || 0) + weight

          // Add to entity mentions if applicable
          if (isTechnicalComponent && config.includeEntityExtraction) {
            entityMentions[cleanToken] = (entityMentions[cleanToken] || 0) + 1
          }
        })
      })
    })
  })

  // Group similar issues to reduce redundancy
  function groupSimilarIssues(
    issues: Record<string, IssueDetails>
  ): Record<string, Array<IssueDetailsWithPhrase>> {
    const groups: Record<string, Array<IssueDetailsWithPhrase>> = {}
    const processedKeys = new Set<string>()

    Object.entries(issues).forEach(([key, details]) => {
      if (processedKeys.has(key)) return

      processedKeys.add(key)
      const keyTerms = key.split(" ")

      // Find the most significant term to use as group key
      let groupKey = keyTerms[0]

      // Prefer technical components or problem indicators
      for (const term of keyTerms) {
        if (technicalComponents.has(term)) {
          groupKey = term
          break
        } else if (problemIndicators[term]) {
          groupKey = term
          break
        }
      }

      if (!groups[groupKey]) {
        groups[groupKey] = []
      }

      // Add this issue to the group
      groups[groupKey].push({
        phrase: key,
        ...details,
      })

      // Find and add similar issues to the same group
      Object.entries(issues).forEach(([otherKey, otherDetails]) => {
        if (key === otherKey || processedKeys.has(otherKey)) return

        const otherTerms = otherKey.split(" ")

        // Check for overlap in terms
        const sharedTerms = keyTerms.filter((term) => otherTerms.includes(term))

        // Consider similar if they share at least 30% of terms
        if (
          sharedTerms.length > 0 &&
          sharedTerms.length / Math.min(keyTerms.length, otherTerms.length) >=
            0.3
        ) {
          groups[groupKey].push({
            phrase: otherKey,
            ...otherDetails,
          })
          processedKeys.add(otherKey)
        }
      })
    })

    return groups
  }

  // Filter results by minimum frequency and sort by relevance
  const filterAndSort = (dict: Record<string, number>, maxResults: number) => {
    return Object.fromEntries(
      Object.entries(dict)
        .filter(([_, count]) => count >= config.minFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxResults)
    )
  }

  // Filter technical issues and sort by severity and count
  const filterAndSortIssues = (
    dict: Record<string, IssueDetails>,
    maxResults: number
  ) => {
    return Object.fromEntries(
      Object.entries(dict)
        .filter(([_, details]) => details.count >= config.minFrequency)
        .sort((a, b) => {
          // Sort by weighted combination of count and severity
          const scoreA = a[1].count * (1 + a[1].severity / 3)
          const scoreB = b[1].count * (1 + b[1].severity / 3)
          return scoreB - scoreA
        })
        .slice(0, maxResults)
    )
  }

  // Filter error codes and sort by frequency
  const filterAndSortErrorCodes = (
    dict: Record<string, ErrorCodeDetails>,
    maxResults: number
  ) => {
    return Object.fromEntries(
      Object.entries(dict)
        .filter(([_, details]) => details.count >= config.minFrequency)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, maxResults)
    )
  }

  // Prepare results
  const results: FeedbackAnalysis = {
    significantWords: filterAndSort(wordFrequency, config.maxResults),
    technicalIssues: filterAndSortIssues(technicalIssues, config.maxResults),
  }

  // Add sentiment analysis if enabled
  if (config.sentimentAnalysis && docSentiments.length > 0) {
    results.sentimentScore =
      docSentiments.reduce((sum, score) => sum + score, 0) /
      docSentiments.length
  }

  // Add entity mentions if enabled
  if (config.includeEntityExtraction) {
    results.entityMentions = filterAndSort(entityMentions, config.maxResults)
  }

  // Add error codes if enabled
  if (config.includeErrorCodeExtraction) {
    results.errorCodes = filterAndSortErrorCodes(
      errorCodesWithContext,
      config.maxResults
    )
  }

  // Add component-issue correlation matrix
  results.componentIssueMatrix = componentIssueMatrix

  // Add issue groups for similar issues
  results.issueGroups = groupSimilarIssues(technicalIssues)

  // Add time-based analysis if enabled and data is available
  if (
    config.includeTimeTrendAnalysis &&
    Object.keys(timeBasedIssues).length > 0
  ) {
    results.timeBasedAnalysis = timeBasedIssues
  }

  // Add topic clustering if enabled
  if (config.includeTopicClustering) {
    // Basic implementation of topic extraction using TF-IDF
    const topicClusters: Record<string, string[]> = {}

    // For each document, get top terms
    for (let i = 0; i < data.length; i++) {
      const terms = tfidf.listTerms(i).slice(0, 5)
      if (terms.length > 0) {
        const topTerm = terms[0].term
        if (!topicClusters[topTerm]) {
          topicClusters[topTerm] = []
        }
        // Add other terms to this cluster
        terms.slice(1).forEach((term) => {
          if (!topicClusters[topTerm].includes(term.term)) {
            topicClusters[topTerm].push(term.term)
          }
        })
      }
    }

    results.topicClusters = topicClusters
  }

  return results
}

export default analyzeFeedback
