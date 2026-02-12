package controllers

import models.UserResponse
import play.api.libs.json._
import play.api.mvc._
import repositories.UserRepository

import javax.inject._
import scala.concurrent.ExecutionContext

@Singleton
class UserController @Inject()(
																cc: ControllerComponents,
																userRepository: UserRepository
															)(implicit ec: ExecutionContext) extends AbstractController(cc) {

	implicit val userResponseWrites: Writes[UserResponse] =
		Json.writes[UserResponse]

	/**
	 * GET /api/users/:currentUserId
	 * Returns all active users except logged-in user
	 */
	def getAllUsers(currentUserId: Long): Action[AnyContent] = Action.async {

		userRepository.getAllActiveExcept(currentUserId).map { users =>

			val response = users.map(UserResponse.fromUser)

			Ok(Json.obj(
				"success" -> true,
				"users" -> response
			))
		}
	}
}
