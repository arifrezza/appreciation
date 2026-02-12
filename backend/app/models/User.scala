package models

import java.time.LocalDateTime

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
