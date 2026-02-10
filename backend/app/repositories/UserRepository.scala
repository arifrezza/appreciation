package repositories

import database.DatabaseContext
import models.User
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import play.api.Logging

/**
 * UserRepository handles all database operations for users
 * 
 * All methods return Future to ensure non-blocking async execution
 * Database queries run in a separate thread pool (DatabaseExecutionContext)
 */
@Singleton
class UserRepository @Inject()(
  dbContext: DatabaseContext
)(implicit ec: ExecutionContext) extends Logging {
  
  import dbContext.ctx._
  
  /**
   * Find a user by username
   * 
   * @param username The username to search for
   * @return Future[Option[User]] - User if found, None otherwise
   */
  def findByUsername(username: String): Future[Option[User]] = Future {
    // Quill query - compiles to: SELECT * FROM users WHERE username = ?
    val query = quote {
      dbContext.users.filter(u => u.username == lift(username))
    }
    
    run(query).headOption
  }
  
  /**
   * Find a user by email
   * 
   * @param email The email to search for
   * @return Future[Option[User]] - User if found, None otherwise
   */
  def findByEmail(email: String): Future[Option[User]] = Future {
    logger.debug(s"findByEmail called with: '$email'")
    
    val query = quote {
      dbContext.users.filter(u => u.email == lift(email))
    }
    
    val result = run(query).headOption
    logger.debug(s"Query result: ${result.map(u => s"User(id=${u.id}, email=${u.email}, isActive=${u.isActive})").getOrElse("None")}")
    result
  }
  
  /**
   * Find a user by ID
   * 
   * @param id The user ID
   * @return Future[Option[User]] - User if found, None otherwise
   */
  def findById(id: Long): Future[Option[User]] = Future {
    val query = quote {
      dbContext.users.filter(u => u.id == lift(id))
    }
    
    run(query).headOption
  }
  
  /**
   * Check if a username already exists
   * 
   * @param username The username to check
   * @return Future[Boolean] - true if exists, false otherwise
   */
  def usernameExists(username: String): Future[Boolean] = Future {
    val query = quote {
      dbContext.users.filter(u => u.username == lift(username))
    }
    
    run(query).nonEmpty
  }
  
  /**
   * Create a new user
   * 
   * @param user The user to create
   * @return Future[Long] - The ID of the created user
   */
  def create(user: User): Future[Long] = Future {
    val query = quote {
      dbContext.users.insertValue(lift(user)).returningGenerated(_.id)
    }
    
    run(query)
  }
  
  /**
   * Update user's last login timestamp
   * 
   * @param userId The user ID
   * @return Future[Unit]
   */
  def updateLastLogin(userId: Long): Future[Unit] = Future {
    // This would require adding a last_login column to the users table
    // For now, we'll skip this - add it in a future evolution if needed
    ()
  }
  
  /**
   * Get all active users
   * 
   * @return Future[List[User]] - List of all active users
   */
  def getAllActive(): Future[List[User]] = Future {
    val query = quote {
      dbContext.users.filter(u => u.isActive)
    }
    
    run(query)
  }
}
