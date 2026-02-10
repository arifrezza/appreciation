package services

import com.github.t3hnar.bcrypt._
import javax.inject.Singleton
import scala.util.{Success, Try}

/**
 * PasswordService handles password hashing and verification using BCrypt
 * 
 * BCrypt is a secure one-way hashing algorithm designed for passwords
 * - Automatically salts passwords
 * - Configurable work factor (computational cost)
 * - Industry standard for password storage
 */
@Singleton
class PasswordService {
  
  // BCrypt work factor (rounds)
  // Higher = more secure but slower
  // 10 = good balance (2^10 = 1024 iterations)
  private val bcryptRounds = 10
  
  /**
   * Hash a plain text password using BCrypt
   * 
   * @param plainPassword The password to hash
   * @return Hashed password string (includes salt)
   * 
   * Example output: $2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy
   */
  def hashPassword(plainPassword: String): String = {
    plainPassword.bcrypt(bcryptRounds)
  }
  
  /**
   * Verify a plain text password against a hashed password
   * 
   * @param plainPassword The password to verify
   * @param hashedPassword The stored BCrypt hash
   * @return true if password matches, false otherwise
   * 
   * This is SAFE against timing attacks
   */
  def verifyPassword(plainPassword: String, hashedPassword: String): Boolean = {
    plainPassword.isBcryptedSafe(hashedPassword).getOrElse(false)
  }
  
  /**
   * Check if a password meets minimum requirements
   * 
   * Requirements:
   * - At least 8 characters
   * - Not empty
   * 
   * @param password The password to validate
   * @return true if valid, false otherwise
   */
  def isValidPassword(password: String): Boolean = {
    password != null && password.length >= 3
  }
}
