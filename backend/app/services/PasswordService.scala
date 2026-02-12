package services

import com.github.t3hnar.bcrypt._
import javax.inject.Singleton
import scala.util.Try

/**
 * PasswordService - Handles password hashing and verification using BCrypt
 * 
 * BCrypt is a one-way hashing algorithm:
 * - "One-way" = you can't reverse the hash to get the password
 * - Automatically adds random "salt" to prevent rainbow table attacks
 * - Deliberately slow to prevent brute-force attacks
 * 
 * Called by: AuthService.authenticateAndGetUser()
 */
@Singleton
class PasswordService {
  
  // BCrypt rounds: 10 = 2^10 = 1024 iterations (good balance of security/speed)
  private val bcryptRounds: Int = 10
  
  /**
   * Hash a password for storage in database (used during registration)
   * 
   * Example: "myPassword123" → "$2a$10$N9qo8uLOickgx2ZMRZoMye..."
   */
  def hashPassword(plainPassword: String): String = {
    plainPassword.bcrypt(bcryptRounds)
  }
  
  /**
   * Verify a password against stored hash (used during login)
   * 
   * @param plainPassword The password user typed at login
   * @param hashedPassword The hash stored in database
   * @return true if password is correct, false otherwise
   */
  def verifyPassword(plainPassword: String, hashedPassword: String): Boolean = {
    // STEP 1: BCrypt compares the plain password against the stored hash
    // It extracts the salt from hashedPassword, hashes plainPassword with it,
    // then compares the two hashes
    val verificationResult: Try[Boolean] = plainPassword.isBcryptedSafe(hashedPassword)
    
    // STEP 2: Return result (default to false if any error occurred)
    val isMatch: Boolean = verificationResult.getOrElse(false)
    isMatch
  }
  
  /**
   * Check if a password meets minimum requirements (at least 3 characters)
   */
  def isValidPassword(password: String): Boolean = {
    password != null && password.length >= 3
  }
}
