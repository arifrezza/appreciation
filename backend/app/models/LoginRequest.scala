package models

import play.api.libs.json._

case class LoginRequest(username: String, password: String)

object LoginRequest {
  implicit val format: Format[LoginRequest] = Json.format[LoginRequest]
}
