import { generateRSS } from '../src/utils/generateRSS.js';

// Your blog posts data (you might want to move this to a shared file)
const blogPosts = {
  'organic-music-promotion-guide': {
    id: 1,
    title: "What is Organic Music Promotion and Why It Matters",
    excerpt: "Learn why organic music promotion is essential for building a sustainable music career in 2024.",
    date: "January 15, 2024",
    readTime: "5 min read",
    category: "Music Promotion",
    image: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=800&h=400&fit=crop",
    author: {
      name: "Alex Chen",
      role: "Music Marketing Specialist",
      avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop&crop=face"
    },
    tags: ["organic promotion", "music marketing", "audience growth", "independent artists"]
  },
  'organic-promotion-strategies': {
    id: 2,
    title: "10 Organic Music Promotion Strategies That Actually Work",
    excerpt: "Discover proven strategies to grow your audience naturally without paid advertising.",
    date: "January 10, 2024",
    readTime: "7 min read",
    category: "Growth Strategies",
    image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&h=400&fit=crop",
    author: {
      name: "Maria Rodriguez",
      role: "Artist Development Coach",
      avatar: "https://images.unsplash.com/photo-1494790108755-2616b612b786?w=200&h=200&fit=crop&crop=face"
    },
    tags: ["growth strategies", "music promotion", "audience building", "social media", "networking"]
  },
  'grow-music-audience-organically': {
    id: 3,
    title: "How to Grow Your Music Audience Organically in 2024",
    excerpt: "Step-by-step guide to building a genuine fanbase that supports your musical journey.",
    date: "January 5, 2024",
    readTime: "6 min read",
    category: "Audience Building",
    image: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&h=400&fit=crop",
    author: {
      name: "David Kim",
      role: "Music Business Consultant",
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face"
    },
    tags: ["audience growth", "fan building", "music career", "engagement", "community"]
  }
};

export default function handler(req, res) {
  const baseUrl = 'https://www.soundswap.live';
  
  const rssItems = Object.values(blogPosts).map(post => {
    const slug = Object.keys(blogPosts).find(key => blogPosts[key].id === post.id);
    return `
    <item>
      <title><![CDATA[${post.title}]]></title>
      <description><![CDATA[${post.excerpt}]]></description>
      <link>${baseUrl}/blog/${slug}</link>
      <guid>${baseUrl}/blog/${slug}</guid>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
      <author>${post.author.name} (${post.author.role})</author>
      <category>${post.category}</category>
      ${post.tags.map(tag => `<category>${tag}</category>`).join('')}
    </item>
  `}).join('');

  const rss = `<?xml version="1.0" encoding="UTF-8" ?>
  <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
    <channel>
      <title>SoundSwap Blog</title>
      <description>Music Promotion Tips, Growth Strategies, and Artist Resources</description>
      <link>${baseUrl}</link>
      <atom:link href="${baseUrl}/api/rss" rel="self" type="application/rss+xml" />
      <language>en-us</language>
      <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
      <image>
        <url>${baseUrl}/soundswap-logo.png</url>
        <title>SoundSwap Blog</title>
        <link>${baseUrl}</link>
      </image>
      ${rssItems}
    </channel>
  </rss>`;

  res.setHeader('Content-Type', 'application/rss+xml');
  res.setHeader('Cache-Control', 'public, s-maxage=1200, stale-while-revalidate=600');
  res.send(rss);
}