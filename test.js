const Snoowrap = require("snoowrap");
require("dotenv").config();


async function testRedditAPI() {
  try {
    // Initialize Snoowrap with Reddit API credentials
    const r = new Snoowrap({
      userAgent: process.env.REDDIT_USER_AGENT,
      clientId: process.env.REDDIT_CLIENT_ID,
      clientSecret: process.env.REDDIT_CLIENT_SECRET,
      username: process.env.REDDIT_USERNAME,
      password: process.env.REDDIT_PASSWORD,
    });

    // Get subreddit instance
    const subreddit = r.getSubreddit("laptops");

    // Test different API functionalities
    console.log("Testing Reddit API functionalities...\n");

    // 1. Search posts
    console.log("1. Searching for 'surface' posts:");
    const searchResults = await subreddit.search({
      query: "surface",
      sort: "new",
      limit:100
    });
    
    searchResults.forEach(post => {
      console.log(`- Title: ${post.title}`);
      console.log(`  Score: ${post.score}`);
      console.log(`  Score: ${post.url}`);
      console.log(`  Comments: ${post.num_comments}`);
      console.log(`  Created: ${new Date(post.created_utc * 1000).toISOString()}\n`);
    });

    

  } catch (error) {
    console.error("Error testing Reddit API:", error);
  }
}

// Run the test
testRedditAPI()
  .then(() => console.log("Test completed"))
  .catch(error => console.error("Test failed:", error));