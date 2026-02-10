package database

import io.getquill._
import javax.inject.{Inject, Singleton}
import play.api.db.Database
import java.io.Closeable
import javax.sql.DataSource

/**
 * Database context for Quill queries
 * 
 * This class provides:
 * - Quill context for writing type-safe SQL queries
 * - MySQL dialect support
 * - Connection from Play's database pool
 * 
 * All queries are synchronous but executed in separate thread pools
 * to avoid blocking Play's main thread pool
 */
@Singleton
class DatabaseContext @Inject()(database: Database) {
  
  // Wrap Play's DataSource to satisfy Quill's type requirement
  private val closeableDataSource: DataSource with Closeable = new DataSource with Closeable {
    private val underlying = database.dataSource
    def getConnection() = underlying.getConnection()
    def getConnection(username: String, password: String) = underlying.getConnection(username, password)
    def getLogWriter() = underlying.getLogWriter()
    def setLogWriter(out: java.io.PrintWriter) = underlying.setLogWriter(out)
    def setLoginTimeout(seconds: Int) = underlying.setLoginTimeout(seconds)
    def getLoginTimeout() = underlying.getLoginTimeout()
    def getParentLogger() = underlying.getParentLogger()
    def unwrap[T](iface: Class[T]) = underlying.unwrap(iface)
    def isWrapperFor(iface: Class[_]) = underlying.isWrapperFor(iface)
    def close() = database.shutdown()
  }
  
  /**
   * Quill context configured for MySQL
   * Uses SnakeCase naming strategy (database_column_name)
   */
  val ctx = new MysqlJdbcContext(SnakeCase, closeableDataSource)
  
  import ctx._
  
  /**
   * Users table schema
   * Quill will map this to the 'users' table in MySQL
   */
  val users = quote {
    querySchema[models.User]("users")
  }
}
