package models

import java.time.LocalDateTime

/**
 * User model representing a user in the database
 * 
 * @param id User's unique ID
 * @param username Unique username for login
 * @param email User's email address
 * @param passwordHash BCrypt hashed password (never store plain text!)
 * @param fullName User's display name
 * @param createdAt Timestamp when user was created
 * @param updatedAt Timestamp when user was last updated
 * @param isActive Whether the user account is active
 */
case class User(
  id: Long,
  username: String,
  email: String,
  passwordHash: String,
  fullName: String,
  designation: String,
  createdAt: LocalDateTime,
  updatedAt: LocalDateTime,
  isActive: Boolean
)

/**
 * User data for API responses (without sensitive data)
 */
case class UserResponse(
  id: Long,
  username: String,
  email: String,
  fullName: String,
  designation: String
)

object UserResponse {
  def fromUser(user: User): UserResponse = UserResponse(
    id = user.id,
    username = user.username,
    email = user.email,
    fullName = user.fullName,
    designation = user.designation
  )
}
