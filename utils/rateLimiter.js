class TwitterRateLimiter {
  constructor() {
    this.actions = [];
    this.limits = {
      tweets: { per15min: 50, perDay: 300 },
      likes: { perDay: 1000 },
      follows: { perDay: 400 }
    };
  }

  canTweet() {
    const last15min = this.actions.filter(action => 
      action.type === 'tweet' && 
      Date.now() - action.timestamp < 15 * 60 * 1000
    );
    return last15min.length < this.limits.tweets.per15min;
  }

  recordAction(type) {
    this.actions.push({
      type,
      timestamp: Date.now()
    });
    
    // Keep only last 24 hours of actions
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.actions = this.actions.filter(action => action.timestamp > oneDayAgo);
  }
}

export default new TwitterRateLimiter();