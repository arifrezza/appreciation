package controllers

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}
import play.api.mvc._
import play.api.libs.json._
import play.api.Logging
import services.AuthService
import models.{LoginRequest, UserResponse}

/**
 * AuthController - Handles user authentication (login)
 * 
 * FLOW: Request → Validate JSON → AuthService.authenticate → Generate token → Response
 */
@Singleton
class AuthController @Inject()(
  cc: ControllerComponents,
  authService: AuthService
)(implicit ec: ExecutionContext) extends AbstractController(cc) with Logging {
  
  implicit val userResponseWrites: Writes[UserResponse] = Json.writes[UserResponse]

  /**
   * POST /api/login
   * Body: { "email": "user@example.com", "password": "secret" }
   * 
   * Returns: { "success": true, "token": "...", "user": {...} }
   *      OR: { "success": false, "message": "..." }
   */
  def login: Action[JsValue] = Action.async(parse.json) { request =>
    // STEP 1: Parse JSON into LoginRequest object
    val validationResult: JsResult[LoginRequest] = request.body.validate[LoginRequest]
    
    validationResult match {
      case JsError(_) =>
        // JSON was invalid - return error
        Future.successful(BadRequest(Json.obj(
          "success" -> false,
          "message" -> "Invalid request payload"
        )))
        
      case JsSuccess(loginRequest, _) =>
        // STEP 2: Extract email and password
        val email: String = loginRequest.email
        val password: String = loginRequest.password
        logger.debug(s"Login attempt for email: $email")
        
        // STEP 3: Call AuthService to authenticate (this queries the database)
        // ──────────────────────────────────────────────────────────────────────
        // NEXT: Go to AuthService.authenticateAndGetUser() to follow the flow
        // ──────────────────────────────────────────────────────────────────────
        val authResultFuture: Future[Option[UserResponse]] = 
          authService.authenticateAndGetUser(email, password)
        
        // STEP 4: Handle the result when it comes back
        authResultFuture.map { authResult: Option[UserResponse] =>
          authResult match {
            case Some(user) =>
              // SUCCESS - generate token and return user data
              val token: String = authService.generateToken(user.id)
              Ok(Json.obj(
                "success" -> true,
                "token" -> token,
                "user" -> Json.toJson(user)
              ))
              
            case None =>
              // FAILED - wrong email or password
              Unauthorized(Json.obj(
                "success" -> false,
                "message" -> "Invalid username or password"
              ))
          }
        }.recover {
          // STEP 5: Handle database errors
          case ex: Exception =>
            play.api.Logger("auth").error("Login error", ex)
            InternalServerError(Json.obj(
              "success" -> false,
              "message" -> "An error occurred during login"
            ))
        }
    }
  }
  
  /**
   * GET /api/me - Get current user info (requires valid token)
   * TODO: Implement token validation
   */
  def getCurrentUser: Action[AnyContent] = Action.async { request =>
    Future.successful(Unauthorized(Json.obj(
      "success" -> false,
      "message" -> "Token validation not yet implemented"
    )))
  }
}
