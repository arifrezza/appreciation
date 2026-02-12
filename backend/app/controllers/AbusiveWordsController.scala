package controllers

import javax.inject._
import play.api.mvc._
import play.api.libs.json._
import services.AbusiveWordsService

@Singleton
class AbusiveWordsController @Inject()(
																		cc: ControllerComponents,
																		languageService: AbusiveWordsService
																	) extends AbstractController(cc) {

	def checkAbusiveWords(): Action[JsValue] = Action(parse.json) { request =>
		val text = (request.body \ "text").as[String]

		val hasAbuse = languageService.containsAbusiveWord(text)

		Ok(Json.obj(
			"abusive" -> hasAbuse
		))
	}
}

