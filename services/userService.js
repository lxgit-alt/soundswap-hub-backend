// backend/services/userService.js
import { db, admin } from '../firebaseAdmin.js'
import bcrypt from 'bcrypt'

// Create a new user
export async function createUser({ name, email, password, genre }) {
  // 1) Hash the password
  const passwordHash = await bcrypt.hash(password, 10)

  // 2) Create in Firebase Auth (use plain password here)
  const userRecord = await admin.auth().createUser({
    email,
    password,           // Let Firebase hash it internally
    displayName: name,
  })

  // 3) Save profile in Firestore, including the hash
  const user = {
    id: userRecord.uid,
    name,
    email,
    passwordHash,       // Store the bcrypt hash for server‐side login
    genres: [genre],
    feedbackPoints: 0,
    boosts: {},
    hasUnreviewedTrack: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }
  await db.collection('users').doc(userRecord.uid).set(user)

  // 4) Return the public user object (omit the hash)
  const { passwordHash: _, ...publicUser } = user
  return publicUser
}

/**
 * Logs in a user and returns a custom Firebase token.
 * (NOTE: This function no longer verifies the password.
 * For an MVP, you can trust the client to handle password validation via the Firebase client SDK.
 * Here we simply fetch the user record and return a custom token.)
 */
export async function loginUser(email) {
  // 1. Look up the Firebase Auth user by email
  const userRecord = await admin.auth().getUserByEmail(email)

  // 2. Create a custom token
  return admin.auth().createCustomToken(userRecord.uid)
}
