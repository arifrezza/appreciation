package services

import play.api.libs.ws._

import javax.inject._
import scala.concurrent.ExecutionContext
//import play.api.libs.ws.WSClient
import play.api.Logging
import play.api.libs.json._

import scala.concurrent.Future

// TO CHECK SLANG / ABUSIVE LANGUAGE USING OPENAI API
@Singleton
class SlangCheckService @Inject()(
																	 ws: WSClient
																 )(implicit ec: ExecutionContext) extends Logging {

	private val openAiUrl = "https://api.openai.com/v1/moderations"
	private val apiKey: String =
		sys.env.getOrElse(
			"OPENAI_API_KEY",
			throw new RuntimeException("OPENAI_API_KEY environment variable not set")
		)
	logger.info(s"API Key loaded? ${apiKey.nonEmpty}")



	def checkSlang(text: String): Future[Boolean] = {

		logger.info("Calling OpenAI Moderation API")

		val requestBody = Json.obj(
			"model" -> "omni-moderation-latest",
			"input" -> text
		)

		ws.url("https://api.openai.com/v1/moderations")
			.addHttpHeaders(
				"Authorization" -> s"Bearer $apiKey",
				"Content-Type" -> "application/json"
			)
			.post(requestBody)
			.map { response =>

				//logger.debug(s"OpenAI raw response: ${response.body}")

				val json = response.json

				val flagged =
					(json \ "results")(0) \ "flagged"

				flagged.asOpt[Boolean].getOrElse(false)
			}
	}

}

