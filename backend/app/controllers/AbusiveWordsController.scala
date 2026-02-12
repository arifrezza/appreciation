package controllers

import javax.inject._
import play.api.mvc._
import play.api.libs.json._
import scala.concurrent.{ExecutionContext, Future}
import services.{AbusiveWordsService, SlangCheckService}
import play.api.Logging

@Singleton
class AbusiveWordsController @Inject()(
																				cc: ControllerComponents,
																				abusiveWordsService: AbusiveWordsService,
																				slangCheckService: SlangCheckService
																			)(implicit ec: ExecutionContext)
	extends AbstractController(cc)
		with Logging {

	def checkAbusiveWords(): Action[JsValue] = Action.async(parse.json) { request =>

		val text = (request.body \ "text").as[String]

		logger.info("Language check request received")

		// 1️⃣ LOCAL CHECK FIRST
		val localAbuse = abusiveWordsService.containsAbusiveWord(text)

		if (localAbuse) {

			logger.info("Blocked by LOCAL abusive word list")

			Future.successful(
				Ok(Json.obj("abusive" -> true))
			)

		} else {

			// 2️⃣ CALL OPENAI ONLY IF LOCAL CLEAN
			slangCheckService.checkSlang(text).map { aiAbuse =>

				if (aiAbuse) {
					logger.info("Blocked by AI slang detection")
				} else {
					logger.info("Passed AI slang detection")
				}

				Ok(Json.obj("abusive" -> aiAbuse))
			}
		}
	}
}
