package controllers

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}
import play.api.mvc._
import play.api.libs.json._
import play.api.Logging
import services.AuthService
import models.{LoginRequest, UserResponse}

@Singleton
class AuthController @Inject()(
  cc: ControllerComponents,
  authService: AuthService
)(implicit ec: ExecutionContext) extends AbstractController(cc) with Logging {
  
  // JSON formatter for UserResponse
  implicit val userResponseWrites: Writes[UserResponse] = Json.writes[UserResponse]

  /**
   * Login endpoint with MySQL database authentication
   * 
   * POST /api/login
   * Body: { "username": "...", "password": "..." }
   * 
   * Flow:
   * 1. Parse and validate JSON request
   * 2. Call AuthService.authenticateAndGetUser (async database lookup)
   * 3. If authenticated:
   *    - Generate JWT token
   *    - Return user data + token
   * 4. If not authenticated:
   *    - Return 401 Unauthorized
   * 
   * Returns: 
   * Success: { "success": true, "token": "...", "user": {...} }
   * Failure: { "success": false, "message": "..." }
   */
  def login: Action[JsValue] = Action.async(parse.json) { request =>
    request.body.validate[LoginRequest].fold(
      errors => {
        // JSON validation failed
        Future.successful(BadRequest(Json.obj(
          "success" -> false,
          "message" -> "Invalid request payload"
        )))
      },
      loginRequest => {
        // Log incoming request values
        logger.debug(s"Received login request: email='${loginRequest.email}', password length=${loginRequest.password.length}")
        
        // Authenticate user against database
        authService.authenticateAndGetUser(
          loginRequest.email, 
          loginRequest.password
        ).map {
          case Some(user) =>
            // Authentication successful
            val token = authService.generateToken(user.id)
            Ok(Json.obj(
              "success" -> true,
              "token" -> token,
              "user" -> Json.toJson(user)
            ))
            
          case None =>
            // Authentication failed (user not found or wrong password)
            Unauthorized(Json.obj(
              "success" -> false,
              "message" -> "Invalid username or password"
            ))
        }.recover {
          case ex: Exception =>
            // Database error or other exception
            play.api.Logger("auth").error("Login error", ex)
            InternalServerError(Json.obj(
              "success" -> false,
              "message" -> "An error occurred during login"
            ))
        }
      }
    )
  }
  
  /**
   * Get current user info (requires valid token)
   * 
   * GET /api/me
   * Header: Authorization: Bearer <token>
   * 
   * TODO: Implement token validation middleware
   */
  def getCurrentUser: Action[AnyContent] = Action.async { request =>
    // TODO: Extract and validate token from Authorization header
    // For now, just return unauthorized
    Future.successful(Unauthorized(Json.obj(
      "success" -> false,
      "message" -> "Token validation not yet implemented"
    )))
  }
}
