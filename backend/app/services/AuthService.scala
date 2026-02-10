package services

import models.{User, UserResponse}
import repositories.UserRepository
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}
import play.api.Logging

/**
 * AuthService handles authentication logic
 * 
 * Now uses:
 * - MySQL database via UserRepository
 * - BCrypt password verification via PasswordService
 * - Async/non-blocking operations (Future-based)
 */
@Singleton
class AuthService @Inject()(
  userRepository: UserRepository,
  passwordService: PasswordService
)(implicit ec: ExecutionContext) extends Logging {
  
  /**
   * Authenticate user with email and password
   * 
   * Flow:
   * 1. Look up user by email in database (async)
   * 2. Check if user exists and is active
   * 3. Verify password (demo mode: plain text comparison)
   * 4. Return user data if successful
   * 
   * @param email Email to authenticate
   * @param password Plain text password
   * @return Future[Option[User]] - User if authenticated, None otherwise
   */
  def authenticate(email: String, password: String): Future[Option[User]] = {
    logger.debug(s"Attempting login for email: $email")
    userRepository.findByEmail(email).map {
      case Some(user) if user.isActive =>
        logger.debug(s"User found - isActive: ${user.isActive}, hash: ${user.passwordHash}")
        // User found and active - verify password using BCrypt
        val isValid = passwordService.verifyPassword(password, user.passwordHash)
        logger.debug(s"Password verification result: $isValid")
        if (isValid) {
          Some(user)
        } else {
          None // Password incorrect
        }
      case Some(user) =>
        logger.debug(s"User found but isActive=${user.isActive}")
        None
      case None =>
        logger.debug(s"No user found for email: $email")
        None
    }
  }
  
  /**
   * Authenticate and return user response (without password hash)
   * 
   * @param email Email to authenticate
   * @param password Plain text password
   * @return Future[Option[UserResponse]] - User data if authenticated
   */
  def authenticateAndGetUser(email: String, password: String): Future[Option[UserResponse]] = {
    authenticate(email, password).map {
      case Some(user) => Some(UserResponse.fromUser(user))
      case None => None
    }
  }
  
  /**
   * Generate a JWT token for authenticated user
   * 
   * TODO: Implement proper JWT token generation with:
   * - User ID in payload
   * - Expiration time
   * - Secret key signing
   * - Token refresh mechanism
   * 
   * For now, returns a placeholder token
   * 
   * @param userId User ID to encode in token
   * @return JWT token string
   */
  def generateToken(userId: Long): String = {
    // Placeholder - implement proper JWT
    // Recommended library: authentikat-jwt or pdi-jwt
    s"jwt-token-user-$userId-${System.currentTimeMillis()}"
  }
  
  /**
   * Validate a JWT token and return user ID
   * 
   * TODO: Implement proper JWT validation
   * 
   * @param token JWT token string
   * @return Future[Option[Long]] - User ID if valid, None otherwise
   */
  def validateToken(token: String): Future[Option[Long]] = Future {
    // Placeholder - implement proper JWT validation
    None
  }
  
  /**
   * Get user by ID (for token-based auth)
   * 
   * @param userId User ID
   * @return Future[Option[UserResponse]] - User data if found
   */
  def getUserById(userId: Long): Future[Option[UserResponse]] = {
    userRepository.findById(userId).map {
      case Some(user) if user.isActive => Some(UserResponse.fromUser(user))
      case _ => None
    }
  }
}
