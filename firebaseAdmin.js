import admin from 'firebase-admin'

let serviceAccount

// Try to get service account from environment variables
if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  // Decode from Base64 string
  try {
    const jsonString = Buffer.from(
      process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 
      'base64'
    ).toString('utf-8')
    serviceAccount = JSON.parse(jsonString)
    console.log('Loaded service account from Base64 environment variable')
  } catch (error) {
    console.error('Error parsing Base64 service account:', error.message)
  }
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Fallback: Direct JSON string (if you set it as plain JSON)
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    console.log('Loaded service account from JSON environment variable')
  } catch (error) {
    console.error('Error parsing JSON service account:', error.message)
  }
} else {
  // Local development: Load from file
  try {
    // Use dynamic import for ES modules
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    
    const filePath = join(process.cwd(), 'serviceAccountKey.json')
    const fileContents = readFileSync(filePath, 'utf8')
    serviceAccount = JSON.parse(fileContents)
    console.log('Loaded service account from local file')
  } catch (error) {
    console.error('Failed to load service account:', error.message)
    console.error('Make sure you have serviceAccountKey.json in project root or set FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable')
    throw error
  }
}

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    })
    console.log('✅ Firebase Admin initialized successfully')
  } catch (error) {
    console.error('❌ Firebase Admin initialization error:', error.message)
    console.error('Full error:', error)
    throw error
  }
}

const db = admin.firestore()
const auth = admin.auth()
const storage = admin.storage ? admin.storage() : null

export { admin, db, auth, storage }