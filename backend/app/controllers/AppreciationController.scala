package controllers

import javax.inject.Inject
import play.api.mvc._
import play.api.libs.json._
import services.SlangFilterService

class AppreciationController @Inject() (
																				 cc: ControllerComponents,
																				 slangFilter: SlangFilterService
																			 ) extends AbstractController(cc) {

	def submitAppreciation() = Action(parse.json) { request =>
		val message = (request.body \ "message").as[String]

		if (slangFilter.containsAbusiveWord(message)) {
			BadRequest("Abusive language detected")
		} else {
			Ok("Appreciation saved")
		}
	}
}

