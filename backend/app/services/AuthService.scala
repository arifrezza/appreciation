package services

import models.{User, UserResponse}
import repositories.UserRepository
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}
import play.api.Logging

/**
 * AuthService - Core authentication logic
 * 
 * FLOW: Email+Password → Find user in DB → Check active → Verify password → Return user
 * 
 * Called by: AuthController.login()
 */
@Singleton
class AuthService @Inject()(
  userRepository: UserRepository,
  passwordService: PasswordService
)(implicit ec: ExecutionContext) extends Logging {
  
  /**
   * Main method called by AuthController
   * Authenticates and returns UserResponse (without password hash)
   */
  def authenticateAndGetUser(email: String, password: String): Future[Option[UserResponse]] = {
    logger.debug(s"STEP 1: Starting authentication for email: $email")
    
    // STEP 2: Query database for user with this email
    // ──────────────────────────────────────────────────────────────────────
    // NEXT: Go to UserRepository.findByEmail() to see the database query
    // ──────────────────────────────────────────────────────────────────────
    val userLookupFuture: Future[Option[User]] = userRepository.findByEmail(email)
    
    // STEP 3: When database returns, process the result
    userLookupFuture.map { lookupResult: Option[User] =>
      
      lookupResult match {
        case None =>
          // No user found with this email
          logger.debug("STEP 3: No user found with this email")
          None
          
        case Some(user) =>
          // STEP 4: Check if account is active
          val isActive: Boolean = user.isActive
          logger.debug(s"STEP 4: User found, isActive = $isActive")
          
          if (!isActive) {
            logger.debug("STEP 4: Account is not active, denying login")
            None
          } else {
            // STEP 5: Verify the password using BCrypt
            // ──────────────────────────────────────────────────────────────────────
            // NEXT: Go to PasswordService.verifyPassword() to see BCrypt verification
            // ──────────────────────────────────────────────────────────────────────
            val storedHash: String = user.passwordHash
            val passwordMatches: Boolean = passwordService.verifyPassword(password, storedHash)
            logger.debug(s"STEP 5: Password verification result = $passwordMatches")
            
            if (passwordMatches) {
              // STEP 6: Success! Convert User to UserResponse (removes password hash)
              logger.debug("STEP 6: Authentication successful!")
              Some(UserResponse.fromUser(user))
            } else {
              logger.debug("STEP 5: Password incorrect, denying login")
              None
            }
          }
      }
    }
  }
  
  /**
   * Generate a JWT token for a user (placeholder - TODO: implement real JWT)
   */
  def generateToken(userId: Long): String = {
    val timestamp: Long = System.currentTimeMillis()
    s"jwt-token-user-$userId-$timestamp"
  }
  
  /**
   * Validate a JWT token (TODO: implement real validation)
   */
  def validateToken(token: String): Future[Option[Long]] = {
    Future.successful(None)
  }
  
  /**
   * Get user by ID (for token-based requests after initial login)
   */
  def getUserById(userId: Long): Future[Option[UserResponse]] = {
    userRepository.findById(userId).map {
      case Some(user) if user.isActive => Some(UserResponse.fromUser(user))
      case _ => None
    }
  }
}
