package controllers

import javax.inject._
import play.api.mvc._
import play.api.libs.json._
import scala.concurrent.{ExecutionContext, Future}
import services.AuthService
import models.LoginRequest

@Singleton
class AuthController @Inject()(
  cc: ControllerComponents,
  authService: AuthService
)(implicit ec: ExecutionContext) extends AbstractController(cc) {

  /**
   * Login endpoint
   * POST /api/login
   * Body: { "username": "...", "password": "..." }
   * Returns: { "success": true, "token": "...", "user": {...} }
   */
  def login: Action[JsValue] = Action.async(parse.json) { request =>
    request.body.validate[LoginRequest].fold(
      errors => {
        Future.successful(BadRequest(Json.obj(
          "success" -> false,
          "message" -> "Invalid request payload"
        )))
      },
      loginRequest => {
        authService.authenticate(loginRequest.username, loginRequest.password).map { authenticated =>
          if (authenticated) {
            val token = authService.generateToken(loginRequest.username)
            Ok(Json.obj(
              "success" -> true,
              "token" -> token,
              "user" -> Json.obj(
                "username" -> loginRequest.username,
                "name" -> loginRequest.username // TODO: Get from database
              )
            ))
          } else {
            Unauthorized(Json.obj(
              "success" -> false,
              "message" -> "Invalid credentials"
            ))
          }
        }
      }
    )
  }
}
