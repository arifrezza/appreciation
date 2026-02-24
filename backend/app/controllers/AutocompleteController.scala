package controllers

import javax.inject._
import play.api.mvc._
import play.api.libs.json._
import scala.concurrent.ExecutionContext
import services.AutocompleteService

@Singleton
class AutocompleteController @Inject()(
	cc: ControllerComponents,
	autocompleteService: AutocompleteService
)(implicit ec: ExecutionContext)
	extends AbstractController(cc) {

	def autocomplete(): Action[JsValue] = Action.async(parse.json) { request =>

		val textOpt = (request.body \ "text").asOpt[String]
		val failingCriteria = (request.body \ "failingCriteria").asOpt[Seq[String]].getOrElse(Seq.empty)
		val targetCriterion = (request.body \ "targetCriterion").asOpt[String]

		textOpt match {

			case None =>
				scala.concurrent.Future.successful(
					BadRequest(Json.obj(
						"success" -> false,
						"message" -> "Missing text"
					))
				)

			case Some(text) if text.trim.length < 10 =>
				scala.concurrent.Future.successful(
					BadRequest(Json.obj(
						"success" -> false,
						"message" -> "Text too short"
					))
				)

			case Some(_) if failingCriteria.isEmpty =>
				scala.concurrent.Future.successful(
					BadRequest(Json.obj(
						"success" -> false,
						"message" -> "No failing criteria provided"
					))
				)

			case Some(text) =>
				autocompleteService.complete(text, failingCriteria, targetCriterion).map {
					case Right(result) =>
						Ok(Json.obj(
							"success" -> true,
							"completion" -> result.completion,
							"corrections" -> Json.toJson(result.corrections)(Writes.seq(autocompleteService.spellCorrectionWrites))
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
