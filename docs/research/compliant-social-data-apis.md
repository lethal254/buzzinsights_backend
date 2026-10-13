# Compliant ways to get multi-platform social data through one API

Question: is there a compliant way for BuzzInsights to collect public social conversations from several platforms through a single API?

Short answer: the platforms do not offer one official API that covers all of them. The compliant “one API” is a licensed social-listening vendor. That vendor runs one query across the sources it is allowed to carry, and returns one schema. What comes back is often a mention id, a snippet, sentiment, and a link, not the full post. Full text for X, Facebook, Instagram, LinkedIn, Reddit, and TikTok is commonly blocked or has to be fetched again from that platform’s own API.

A second compliant pattern is one official API per platform, hidden behind BuzzInsights’ own connector contract. That is not one vendor API. It is the connector foundation in the incubation proposal.

Scraping aggregators that advertise one key across dozens of networks are a different category. They are not treated here as a compliant source.

## If BuzzInsights is the listening product

Meltwater, Brandwatch, Talkwalker, YouScan, and Brand24 are listening products. Their APIs exist so a customer can read that vendor’s index. The contracts strip or withhold raw posts so the customer does not become a competing listener. That is the wrong supplier when BuzzInsights is the system of record.

Raw posts, stored and shown in BuzzInsights, come from the platform that owns them, under a license that allows a paid product to keep the post.

| Source | Raw post in your own database | What the license actually allows |
| --- | --- | --- |
| Reddit | Yes, from the official Data API, after a written commercial agreement. | Public developer terms forbid use in a monetized product without that agreement. [Developer Terms](https://redditinc.com/policies/developer-terms), [Data API Terms](https://redditinc.com/policies/data-api-terms). |
| X | Yes, from the X API held in BuzzInsights’ own developer account. Post lookup returns the post for display in your application. | You pay per read. Live rates are on the X developer console. A listening vendor’s export is only an id; it is not this license. |
| YouTube | Yes, titles, descriptions, and comments from the Data API, with a refresh rule. | You may sell your own application. You may not sell or sublicense YouTube API data. Comment and title text still follow the 30-day refresh and deletion rule. Metrics can be kept longer when the analytics terms are accepted. [Developer policies](https://developers.google.com/youtube/terms/developer-policies), [storage rules](https://developers.google.com/youtube/terms/derived-metrics-policy). |
| News, blogs, forums | Only from a publisher or a feed whose contract lets you show the text inside your product. | Webz.io’s public terms forbid handing the data to clients, and they do not license the raw page text for use. [Webz terms](https://webz.io/tos/). |
| Facebook, Instagram | Only posts from accounts, pages, or hashtags a customer connects through Meta’s APIs. | No commercial firehose of public posts. |
| LinkedIn | No general raw listening feed. | The Marketing API is for approved apps, and it forbids storing data except where the docs allow. [Marketing API terms](https://www.linkedin.com/legal/l/marketing-api-terms). |
| TikTok | No organic raw firehose for a paid listener. | The Commercial Content API is an ads-transparency library, starting with EU ads, not organic posts. [Commercial Content API](https://developers.tiktok.com/products/commercial-content-api). |

There is still no single upstream API that returns raw posts from all of these networks. The one API is BuzzInsights’ own connector contract. Each row above is a separate license.

Researched 13 October 2026 from vendor and platform primary docs.

## What “compliant” means for this product

BuzzInsights would be a paid B2B product. That changes the rules for the sources it already uses.

- Reddit’s Developer Terms say the Data API may not be used by or for a business, or as part of a monetized product, unless Reddit approves that in writing or in a separate agreement. Selling or deriving revenue from Reddit data is prohibited without that approval. Sources: [Developer Terms](https://redditinc.com/policies/developer-terms), [Data API Terms](https://redditinc.com/policies/data-api-terms).
- Listening vendors publish the same constraint in their own APIs. They can show a post in their product and still be forbidden to hand the full text to a customer API. Meltwater states this directly: provider agreements limit what the API may return, and X posts come back as an id so the customer can rehydrate them on the X API. Source: [Meltwater listening overview](https://developer.meltwater.com/docs/meltwater-api/listening/overview/), [Rehydrating X posts](https://developer.meltwater.com/docs/meltwater-api/listening/rehydrating-x-posts/).

So a compliant integration has two parts: a contract that allows commercial listening, and code that stores only the fields that contract allows.

## Licensed vendors that expose one listening API

These are the products whose own developer docs describe one API over many sources. Coverage and export rights are not the same thing. “Listed as a source” means the vendor indexes it. “Exportable text” is what a customer application is allowed to receive.

| Vendor | One API | Sources the vendor documents | What the API will not hand over |
| --- | --- | --- | --- |
| Meltwater | `https://api.meltwater.com`, v3 listening. One saved search, then search, export, analytics, or a stream. | Analytics sources include news, X, Facebook, Instagram, Reddit, blogs, forums, TikTok, and others. | X exports contain the post id and author id only. Full text requires the customer’s own X API call. |
| Brandwatch Consumer Research | `https://api.brandwatch.com`. One boolean query, `contentSources` selects platforms. | Listen sources include X, Facebook, Instagram, LinkedIn, TikTok, YouTube, Reddit, news, blogs, forums, reviews. X is described as a full firehose via an official partnership. Reddit is described as broad public coverage, not every post. | API data packs strip X mention text and most metadata. News is a 256-character snippet. LinkedIn has no snippet and no full text. |
| Talkwalker | `https://api.talkwalker.com/api/v1/search/results`. One query can span media types. `sourcetype:` filters a network. | Documented social types include X, Facebook, Instagram, YouTube, LinkedIn, TikTok, Threads, and others. | No raw Facebook or Instagram content. X export is tweet id, author id, and Talkwalker sentiment unless an X add-on is bought. No raw Reddit. No raw TikTok. No LinkedIn export. News content is truncated. |
| YouScan | `https://api.youscan.io/api/external`, header `X-API-KEY`. Topics, mentions, statistics. API access is a paid add-on. | Social and web listening platform. The API key only sees topics that user can see in the product. | X mention text, full text, URLs, and author name are removed. Profile id and post id remain. Quora and Reddit are not available through the API. |
| Brand24 | REST API, header `X-Api-Key`. `/mentions` returns mention rows. Paid plan or add-on. | Documented categories include Facebook, Instagram, X, TikTok, YouTube, LinkedIn, Reddit, news, blogs, forums, reviews. | Full text on most sources. Facebook, Instagram, and X text fields come back empty because those platforms’ terms limit post content. |

Sources for that table:

- Meltwater: [Listening overview](https://developer.meltwater.com/docs/meltwater-api/listening/overview/), [Analytics options](https://developer.meltwater.com/docs/meltwater-api/listening/analytics-options/), [Rehydrating X posts](https://developer.meltwater.com/docs/meltwater-api/listening/rehydrating-x-posts/)
- Brandwatch: [Listen sources](https://social-media-management-help.brandwatch.com/en/articles/17449910-sources-for-listen-mentions), [Data restrictions](https://developers.brandwatch.com/docs/data-restrictions), [Creating queries](https://developers.brandwatch.com/docs/creating-queries)
- Talkwalker: [API restrictions](https://developer.talkwalker.com/docs/getting-started/api-restrictions), [Search API](https://developer.talkwalker.com/docs/overview/search-results-api), [Source type values](https://developer.talkwalker.com/docs/protocols-encoding-value-field-options)
- YouScan: [How to use the API](https://help.youscan.io/en/articles/2754452-how-to-use-the-youscan-api), [API reference](https://developers.youscan.io/api/)
- Brand24: [Social listening API](https://brand24.com/social-listening-api/), [Help center](https://help.brand24.com/en/articles/15338472-api-integration)

Sprinklr sells listening across “30+ channels” and says it has firehose access to “10+ channels,” but that claim is product marketing, not a public export-rights document. Source: [Sprinklr social listening](https://www.sprinklr.com/products/consumer-intelligence/social-listening/). A pilot would still need Sprinklr’s API terms before treating it as an integration.

## What one of these APIs is actually good for

They fit the incubation proposal’s “what changed, why it matters, what to do” product better than they fit a copy of every post into Postgres.

Use the vendor API for:

- One query across the sources that vendor may index.
- Volume, sentiment, and source breakdowns.
- Mention ids, urls, and the text fields that vendor is allowed to return.
- A stream or export into the connector layer, after the contract allows that use.

Do not assume the vendor API replaces a platform API when the product needs the full post body. For X, Meltwater, Brandwatch, Talkwalker, and YouScan all document a reduced payload. The compliant way to get the text is a separate X developer app and a rehydration call, which Meltwater documents as `GET /2/tweets` with the exported id. That second call has its own X contract and price.

Facebook and Instagram are the strictest. Talkwalker will not export the content at all, only histogram metrics. Brand24 returns empty text. Brandwatch’s Listen product describes a limited set of public pages and owned or authenticated accounts, which is not “all public Facebook.”

Reddit is uneven. Brandwatch Listen describes large public coverage. Talkwalker will not export raw Reddit, only aggregates. YouScan will not return Reddit through the API. A Reddit-first product cannot assume a listening vendor replaces the current Snoowrap ingestion.

## Direct official APIs, behind one internal contract

This is the other compliant design, and it matches roadmap item 1 in the proposal: one connector contract, many sources.

Each source stays on that platform’s terms.

| Source | Compliant access | Fit for a commercial listening product |
| --- | --- | --- |
| Reddit | Official Data API, plus a written commercial agreement before it is part of a paid product. | Required for the current prototype. The free developer terms do not cover BuzzInsights as a monetized service. |
| YouTube | YouTube Data API, quota-based, under the YouTube API Services Terms. | The proposal’s next official connector. A listening vendor is optional here. |
| X | X API, paid by usage. Also the rehydration endpoint when a vendor returns only ids. | Usable with strict volume caps. Cost scales with posts read. |
| Facebook and Instagram | Meta APIs for accounts, pages, and hashtags the customer connects and is allowed to read. | Owned-channel listening first. Broad public listening is not an open API. |
| LinkedIn | Partner or product-specific access. Brandwatch’s own API returns no LinkedIn text. | Do not plan on broad listening until a partner path is signed. |
| TikTok | Research API is for qualifying non-commercial research, which is the wrong lane for this product. Talkwalker will not export raw TikTok. | Treat as partner-only until a commercial route is in writing. |
| News, blogs, forums | Licensed feeds or a listening vendor’s news index. Full article text is often snippet-only because of copyright. | A good early pilot source if the contract allows the fields the dashboard shows. |

The internal “one API” in this design is BuzzInsights’ own. Callers inside the product see one post shape. Each connector is still a separate legal relationship.

## What not to treat as the compliant option

Services that sell one key over dozens of networks by collecting pages outside each platform’s API are a different product. They can look like the fastest way to get Reddit, X, Instagram, and TikTok in one schema. They do not remove the platform terms. Reddit’s terms require a separate agreement for commercial use, and Reddit has sued scrapers that bypass its access controls. A vendor that does not publish which platforms have licensed it, and which fields may be stored, is not a substitute for the contracts above.

## Practical recommendation

BuzzInsights should hold the raw post. Listening-vendor APIs are the wrong layer for that.

1. Keep Reddit on the official Data API, and get a written commercial agreement before a paying pilot. The public developer terms do not cover a monetized product.
2. Add YouTube as a direct Data API connector, and design storage around the 30-day refresh rule for titles, descriptions, and comments.
3. Add X only through BuzzInsights’ own X developer account, with a volume cap. That account receives the post object. A listening vendor’s id is not a substitute.
4. Treat Facebook, Instagram, LinkedIn, and TikTok as unavailable for raw public listening until each platform offers a license that allows storing the post in your product. Owned or customer-connected accounts are a separate, narrower product.
5. For news, blogs, and forums, accept a feed only when the contract lets BuzzInsights show the text to its own customers. A crawl-and-resell feed does not meet that bar.

The one API in the product is the internal connector contract. There is no compliant upstream API that returns raw posts from every network.
