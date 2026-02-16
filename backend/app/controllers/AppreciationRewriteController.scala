package controllers

import javax.inject._
import play.api.mvc._
import play.api.libs.json._
import scala.concurrent.ExecutionContext
import services.AppreciationRewriteService

@Singleton
class AppreciationRewriteController @Inject()(
																							 cc: ControllerComponents,
																							 rewriteService: AppreciationRewriteService
																						 )(implicit ec: ExecutionContext)
	extends AbstractController(cc) {

	def rewrite(): Action[JsValue] = Action.async(parse.json) { request =>

		val textOpt = (request.body \ "text").asOpt[String]

		textOpt match {

			case None =>
				scala.concurrent.Future.successful(
					BadRequest(Json.obj(
						"success" -> false,
						"message" -> "Missing text"
					))
				)

			case Some(text) if text.trim.length < 5 =>
				scala.concurrent.Future.successful(
					BadRequest(Json.obj(
						"success" -> false,
						"message" -> "Text too short"
					))
				)

			case Some(text) =>
				rewriteService.rewrite(text).map {
					case Right(rewrite) =>
						Ok(Json.obj(
							"success" -> true,
							"rewrite" -> rewrite
						))

					case Left(error) =>
						InternalServerError(Json.obj(
							"success" -> false,
							"message" -> error
						))
				}
		}
	}
}
