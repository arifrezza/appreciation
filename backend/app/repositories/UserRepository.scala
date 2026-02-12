package repositories

import database.DatabaseContext
import models.User
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import akka.actor.ActorSystem
import play.api.Logging

/**
 * UserRepository handles all database operations for users.
 *
 * Database queries run on a dedicated DB dispatcher
 * to prevent blocking Play's default thread pool.
 */
@Singleton
class UserRepository @Inject()(
                                dbContext: DatabaseContext,
                                actorSystem: ActorSystem
                              ) extends Logging {

  import dbContext.ctx._

  // Dedicated ExecutionContext for blocking DB operations
  private implicit val dbExecutionContext: ExecutionContext =
    actorSystem.dispatchers.lookup("db-dispatcher")

  def findByUsername(username: String): Future[Option[User]] = Future {
    val query = quote {
      dbContext.users.filter(u => u.username == lift(username))
    }
    run(query).headOption
  }

  def findByEmail(email: String): Future[Option[User]] = Future {

    val query = quote {
      dbContext.users.filter(u => u.email == lift(email))
    }

    val result = run(query).headOption
    result
  }

  def findById(id: Long): Future[Option[User]] = Future {
    val query = quote {
      dbContext.users.filter(u => u.id == lift(id))
    }
    run(query).headOption
  }

  def usernameExists(username: String): Future[Boolean] = Future {
    val query = quote {
      dbContext.users.filter(u => u.username == lift(username))
    }
    run(query).nonEmpty
  }

  def create(user: User): Future[Long] = Future {
    val query = quote {
      dbContext.users
        .insertValue(lift(user))
        .returningGenerated(_.id)
    }
    run(query)
  }

  def updateLastLogin(userId: Long): Future[Unit] = Future {
    // Placeholder for future enhancement
    ()
  }

  def getAllActive(): Future[List[User]] = Future {
    val query = quote {
      dbContext.users.filter(_.isActive)
    }
    run(query)
  }

  /**
   * Get all active users except the logged-in user
   */
  def getAllActiveExcept(userId: Long): Future[List[User]] = Future {

    val query = quote {
      dbContext.users.filter(u => u.isActive && u.id != lift(userId))
    }

    run(query)
  }

}
