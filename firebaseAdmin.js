// backend/firebaseAdmin.js
import admin from 'firebase-admin'
import fs from 'fs'
import path from 'path'

// Load service account from env or file
let serviceAccount
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
} else {
  const filePath = path.join(process.cwd(), 'serviceAccountKey.json')
  const fileContents = fs.readFileSync(filePath, 'utf8')
  serviceAccount = JSON.parse(fileContents)
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  })
}

const db = admin.firestore()
export { admin, db }
